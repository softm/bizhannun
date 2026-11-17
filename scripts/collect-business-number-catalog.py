#!/usr/bin/env python3
"""공정위 공개 통신판매업 등록자료 -> 독립적인 상호/사업자번호 분할 JSON.

운영: FTC_SERVICE_KEY 로 공정위 등록현황 API 페이징.
수동: --csv 공식 CSV 내보내기 파일로 복원/초기 적재.
외부 API 실패나 일부 페이지 누락 시 정상 배포본은 절대 덮어쓰지 않는다.
"""
import argparse
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import unicodedata
import urllib.parse
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data/business-numbers"
STATUS = ROOT / "data/business-number-status.json"
SOURCE = "https://www.data.go.kr/data/15126311/openapi.do"
SOURCE_CSV = "https://www.data.go.kr/data/15083251/fileData.do"
ENDPOINT = "https://apis.data.go.kr/1130000/MllBs_2Service/getMllBsInfo_2"
FIELDS = {
    "number": ("사업자등록번호", "사업자번호", "brno", "bizno", "b_no", "businessNumber"),
    "name": ("상호", "상호명", "업체명", "bzmnNm", "companyName"),
    "address": ("사업장소재지(도로명)", "사업장소재지", "도로명주소", "소재지", "rnAddr", "lctnAddr", "address"),
    "state": ("업소상태", "운영상태", "operSttusCdNm", "status"),
}
MAX_ROWS = 3_000_000
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_PAGE_COUNT = 10_000
BATCH_SIZE = 1000


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path, fallback=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def value_of(row, keys):
    return next((str(row[key]).strip() for key in keys if row.get(key) not in (None, "")), "")


def valid_number(value):
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    if len(digits) != 10:
        return ""
    factors = (1, 3, 7, 1, 3, 7, 1, 3, 5)
    checksum = sum(int(digits[i]) * factors[i] for i in range(9))
    checksum += int(digits[8]) * 5 // 10
    return digits if (10 - checksum % 10) % 10 == int(digits[9]) else ""


def normalized_name(value):
    text = unicodedata.normalize("NFKC", str(value or "")).lower().strip()
    for _ in range(4):
        before = text
        text = re.sub(r"^(?:주식회사|유한회사|유한책임회사|\(주\))\s*", "", text)
        text = re.sub(r"\s*(?:주식회사|유한회사|유한책임회사|\(주\))$", "", text)
        if text == before:
            break
    return re.sub(r"\s+", "", text)


def clean(value, maximum=200):
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", str(value or ""))).strip()[:maximum]


def normalize_row(raw):
    number = valid_number(value_of(raw, FIELDS["number"]))
    name = clean(value_of(raw, FIELDS["name"]))
    if not number or not name:
        return None
    address = clean(value_of(raw, FIELDS["address"]), 350)
    state = clean(value_of(raw, FIELDS["state"]), 80)
    return [number, name, address, state]


def collect_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if not reader.fieldnames or not any(key in reader.fieldnames for key in FIELDS["number"]):
            raise ValueError("공식 CSV에 사업자등록번호 필드가 없습니다.")
        return list(reader)


def api_items(body):
    if not isinstance(body, dict):
        raise ValueError("공정위 API 응답 형식 오류")
    response = body.get("response", body)
    header = response.get("header", {}) if isinstance(response, dict) else {}
    if header and str(header.get("resultCode", "00")) not in ("00", "0", "SUCCESS", "INFO-000"):
        raise ValueError("공정위 API 오류 코드: " + str(header.get("resultCode")))
    part = response.get("body", response) if isinstance(response, dict) else {}
    items = part.get("items", []) if isinstance(part, dict) else []
    if isinstance(items, dict):
        items = items.get("item", [])
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        raise ValueError("공정위 API 목록 형식 오류")
    total = part.get("totalCount", part.get("total", None)) if isinstance(part, dict) else None
    try:
        total = int(total)
    except (TypeError, ValueError):
        raise ValueError("공정위 API 전체 건수 미확인")
    if total < 0 or total > MAX_ROWS:
        raise ValueError("공정위 API 전체 건수 제한 초과")
    return items, total


def describe_http_error(error):
    # Never print the URL or response body: they could contain the service key.
    body = error.read(4096).decode("utf-8", errors="replace").upper()
    codes = ("SERVICE_ACCESS_DENIED_ERROR", "PERMISSION_DENIED",
             "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "SERVICE_KEY_IS_NULL",
             "BLACKLIST_IP_ACCESS_ERROR", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR")
    reason = next((code for code in codes if code in body), "")
    if error.code in (401, 403):
        return ("공정위 등록현황 API(15126311) HTTP " + str(error.code)
                + (": " + reason if reason else "")
                + " — 해당 API 활용신청·승인, 서비스키 권한 및 호출 IP 제한을 확인하세요.")
    if error.code == 429:
        return "공정위 API 호출한도 초과(HTTP 429). 재호출 시도를 중단합니다."
    return "공정위 등록현황 API HTTP " + str(error.code)


def collect_api(key):
    key = urllib.parse.unquote(key).strip()
    if not key:
        raise ValueError("FTC_SERVICE_KEY 미설정")
    records = []
    expected = None
    for page in range(1, MAX_PAGE_COUNT + 1):
        params = urllib.parse.urlencode({
            "serviceKey": key, "pageNo": page, "numOfRows": BATCH_SIZE, "resultType": "json"
        })
        url = ENDPOINT + "?" + params
        request = urllib.request.Request(url, headers={
            "User-Agent": "BizhannunPublicNumberCollector/1.0",
            "Accept": "application/json",
        })
        # Slow, sequential calls avoid rate spikes.
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            raise ValueError(describe_http_error(error)) from None
        if len(payload) > MAX_RESPONSE_BYTES:
            raise ValueError("공정위 API 응답 용량 초과")
        items, total = api_items(json.loads(payload))
        if expected is None:
            expected = total
        elif expected != total:
            raise ValueError("수집 중 전체 건수가 바뀌었습니다. 다음 실행에서 재확인합니다.")
        if not items and len(records) < expected:
            raise ValueError(f"페이지 {page}에서 예상보다 일찍 자료가 끝났습니다.")
        records.extend(items)
        if len(records) > MAX_ROWS:
            raise ValueError("데이터 행 수 안전 한도 초과")
        if len(records) >= expected:
            if len(records) != expected:
                raise ValueError("페이지 데이터 수와 전체 건수가 일치하지 않습니다.")
            return records
        if page % 25 == 0:
            print(f"공정위 수집 {len(records):,}/{expected:,}행", flush=True)
        time.sleep(0.05)
    raise ValueError("공정위 API 페이지 제한 초과: 전체 수집 미완료")


def publish(rows, destination, *, source, now):
    # Entire indexing happens in a temporary staging folder.
    seen = set()
    valid = []
    missing = 0
    for item in rows:
        entry = normalize_row(item)
        if not entry:
            missing += 1
            continue
        identity = tuple(entry[:3])
        if identity in seen:
            continue
        seen.add(identity)
        valid.append(entry)
    if not valid:
        raise ValueError("사용 가능한 공개 사업자등록번호가 없습니다.")
    if missing > max(100, int(len(rows) * .15)):
        raise ValueError("원천 파일의 무효 사업자번호/상호 비율이 높습니다.")
    valid.sort(key=lambda v: (normalized_name(v[1]), v[0], v[2]))
    destination = Path(destination)
    previous = read_json(destination / "manifest.json", {})
    if previous.get("recordCount", 0) and len(valid) < previous["recordCount"] * .7:
        raise ValueError("직전 수집보다 30% 이상 감소하여 자동 게시를 중단했습니다.")
    temp = Path(tempfile.mkdtemp(prefix=".business-numbers-", dir=destination.parent))
    try:
        chunk = 2500
        shards = []
        routing = {}
        for offset in range(0, len(valid), chunk):
            rowslice = valid[offset:offset + chunk]
            name = f"shards/{len(shards):05d}.json.gz"
            raw = json.dumps(rowslice, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            packed = gzip.compress(raw, compresslevel=8, mtime=0)
            file = temp / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(packed)
            index = len(shards)
            shards.append({"path": name, "bytes": len(packed), "rows": len(rowslice),
                           "sha256": hashlib.sha256(packed).hexdigest()})
            grams = set()
            for row in rowslice:
                label = normalized_name(row[1])
                grams.update(label)
                grams.update(label[i:i+2] for i in range(len(label)-1))
            for gram in grams:
                routing.setdefault(gram, []).append(index)
        routing_path = temp / "routing.json.gz"
        compressed = gzip.compress(json.dumps(routing, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), compresslevel=8, mtime=0)
        routing_path.write_bytes(compressed)
        manifest = {"schemaVersion": 1, "generatedAt": now, "recordCount": len(valid),
                    "inputRows": len(rows), "invalidRows": missing, "shards": shards,
                    "routing": {"path": "routing.json.gz", "bytes": len(compressed),
                                "sha256": hashlib.sha256(compressed).hexdigest()},
                    "source": source,
                    "coverage": "공정거래위원회 통신판매업 공개 등록자료에 수록된 업체에 한함. 전국 모든 사업자 아님."}
        write_json(temp / "manifest.json", manifest)
        old = destination.with_name(destination.name + ".old")
        if old.exists():
            raise ValueError("복구용 기존 데이터 폴더가 남아 있습니다.")
        if destination.exists():
            destination.rename(old)
        try:
            temp.rename(destination)
        except Exception:
            if old.exists():
                old.rename(destination)
            raise
        if old.exists():
            shutil.rmtree(old)
        return manifest
    finally:
        if temp.exists():
            shutil.rmtree(temp)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--csv", action="append", type=Path, help="공식 공개 지역별 CSV 파일, 여러 번 지정 가능")
    p.add_argument("--strict", action="store_true")
    args = p.parse_args()
    now = utcnow()
    previous = read_json(STATUS, {})
    status = {"provider": "ftc", "lastAttemptAt": now,
              "lastSuccessAt": previous.get("lastSuccessAt"), "status": "checking",
              "source": SOURCE}
    try:
        if args.csv:
            raw = []
            for csv_path in args.csv:
                raw.extend(collect_csv(csv_path))
            origin = {"name": "공정거래위원회 공식 CSV", "url": SOURCE_CSV}
        else:
            key = os.environ.get("FTC_SERVICE_KEY", "")
            if not key:
                status.update({"status": "not_configured", "message": "FTC_SERVICE_KEY 미설정: 이전 공개 데이터 유지"})
                write_json(STATUS, status)
                print(status["message"])
                return
            # A full nationwide crawl is expensive. Once weekly is enough for
            # a public registration search index; daily Pages runs reuse it.
            last_success = previous.get("lastSuccessAt")
            if last_success:
                try:
                    age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(last_success.replace("Z", "+00:00"))
                except ValueError:
                    age = dt.timedelta(days=999)
                if age < dt.timedelta(days=6) and (OUTPUT / "manifest.json").exists():
                    status.update({"status": "unchanged", "message": "주간 수집 주기 내: 정상 공개 JSON 유지"})
                    write_json(STATUS, status)
                    return
            raw = collect_api(key)
            origin = {"name": "공정거래위원회 통신판매업 등록현황", "url": SOURCE}
        manifest = publish(raw, OUTPUT, source=origin, now=now)
        status.update({"status": "success", "lastSuccessAt": now,
                       "recordCount": manifest["recordCount"], "inputRows": manifest["inputRows"],
                       "message": ""})
    except (OSError, ValueError, json.JSONDecodeError, csv.Error) as error:
        status.update({"status": "failed", "message": str(error)[:300]})
        print("사업자번호 수집 실패; 정상 기존 자료 유지: " + status["message"], file=sys.stderr)
        if args.strict:
            write_json(STATUS, status)
            raise SystemExit(1)
    write_json(STATUS, status)


if __name__ == "__main__":
    main()
