#!/usr/bin/env python3
"""Import the official nationwide SEMAS CSV ZIP into a static, searchable catalog.

Only public store fields are retained. A store ID is NEVER a business registration
number. No CAPTCHA bypass, credentials, private workspace data or external mirror.
Run without arguments for the scheduled source check, or --zip FILE --source-date
YYYY-MM-DD to import an already downloaded official ZIP reproducibly.
"""
import argparse
import csv
import datetime as dt
import gzip
import hashlib
import html
import http.cookiejar
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "config/store-catalog-source.json"
CATALOG = ROOT / "data/store-catalog"
STATUS = ROOT / "data/store-catalog-status.json"
PORTAL = "https://www.data.go.kr"
MAX_ZIP_BYTES = 900 * 1024 * 1024
MAX_RAW_BYTES = 5 * 1024 * 1024 * 1024
MAX_SHARD_BYTES = 4 * 1024 * 1024
REGIONS = {"11": "서울", "12": "전남광주", "26": "부산", "27": "대구", "28": "인천", "29": "광주",
           "30": "대전", "31": "울산", "36": "세종", "41": "경기", "43": "충북",
           "44": "충남", "46": "전남", "47": "경북", "48": "경남", "50": "제주",
           "51": "강원", "52": "전북"}
CORPORATE = r"(?:(?:주식회사|유한책임회사|유한회사|합자회사|합명회사|사단법인|재단법인)|\(\s*(?:주|유|사|재)\s*\))"


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def text(value, maximum=200):
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", str(value or ""))).strip()[:maximum]


def normalize_name(value):
    value = unicodedata.normalize("NFKC", text(value)).lower()
    for _ in range(4):
        next_value = re.sub(CORPORATE + r"\s*$", "", re.sub(r"^" + CORPORATE + r"\s*", "", value)).strip()
        if next_value == value:
            break
        value = next_value
    return re.sub(r"\s+", "", value)


def name_grams(row):
    grams = set()
    # Both aliases are matched in the browser; include both in routing to avoid
    # false negatives when corporate suffixes move in front of a branch name.
    for value in (row[1], row[1] + " " + row[2]):
        name = normalize_name(value)
        grams.update(name)
        grams.update(name[i:i + 2] for i in range(len(name) - 1))
    return grams


def make_opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(opener, url, *, data=None, maximum=8 * 1024 * 1024):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "www.data.go.kr":
        raise ValueError("공식 공공데이터포털 주소만 수집할 수 있습니다.")
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": "BizhannunPublicCatalog/1.0 (+https://github.com/softm/bizhannun)",
        "Referer": PORTAL + "/data/15083033/fileData.do",
    })
    with opener.open(req, timeout=45) as response:
        result = response.read(maximum + 1)
        if len(result) > maximum:
            raise ValueError("원천 응답 크기가 제한을 초과했습니다.")
        return result


def discover_source(opener, config):
    page = request(opener, config["url"]).decode("utf-8")
    # The public detail page embeds its current detail UUID beside the dataset
    # key; never guess an attachment ID or a publication date.
    candidates = re.findall(r"uddi:[0-9a-fA-F-]{36}", html.unescape(page))
    candidates = list(dict.fromkeys(candidates))
    if not candidates:
        raise ValueError("공식 페이지에서 최신 파일 식별자를 확인하지 못했습니다.")
    # A detail page must expose one current version. Ambiguity must not silently
    # select an older attachment; update the parser when upstream markup changes.
    if len(candidates) != 1:
        raise ValueError("공식 페이지의 파일 식별자가 모호합니다. 최신 버전 확인이 필요합니다.")
    params = urllib.parse.urlencode({"publicDataPk": config["publicDataPk"], "publicDataDetailPk": candidates[0]})
    metadata = json.loads(request(opener, PORTAL + "/tcs/dss/selectFileDataDownload.do?" + params))
    # The portal wraps its public attachment in a data object on some versions.
    data = metadata.get("fileDataRegistVO") or metadata.get("data", metadata)
    if isinstance(data, list):
        data = data[0] if len(data) == 1 else {}
    if not metadata.get("status") or not isinstance(data, dict):
        raise ValueError("공식 파일 메타데이터를 확인하지 못했습니다.")
    attachment = data.get("atchFileId")
    sequence = str(data.get("fileDetailSn", ""))
    filename = data.get("orginlFileNm") or data.get("dataNm") or ""
    if not re.fullmatch(r"FILE_[0-9]+", str(attachment)) or not sequence.isdigit():
        raise ValueError("공식 파일 식별자 형식이 올바르지 않습니다.")
    date_match = re.search(r"_(\d{8})\.zip$", filename, re.I)
    if not date_match:
        raise ValueError("공식 파일명에서 자료 기준일을 확인하지 못했습니다.")
    source_date = dt.datetime.strptime(date_match[1], "%Y%m%d").date().isoformat()
    return {"attachmentId": attachment, "fileDetailSn": sequence, "filename": filename,
            "detailId": candidates[0], "sourceDate": source_date}


def download_source(opener, metadata, destination):
    form = urllib.parse.urlencode({"atchFileId": metadata["attachmentId"], "fileDetailSn": metadata["fileDetailSn"]}).encode()
    check = json.loads(request(opener, PORTAL + "/cmm/cmm/check-limit.json", data=form))
    if check.get("needCaptcha") is not False:
        raise ValueError("공식 다운로드에 CAPTCHA 또는 추가 확인이 필요합니다. 자동 수집을 중단했습니다.")
    params = urllib.parse.urlencode({"atchFileId": metadata["attachmentId"], "fileDetailSn": metadata["fileDetailSn"], "dataNm": metadata["filename"]})
    req = urllib.request.Request(PORTAL + "/cmm/cmm/fileDownload.do?" + params, headers={
        "User-Agent": "BizhannunPublicCatalog/1.0 (+https://github.com/softm/bizhannun)",
        "Referer": PORTAL + "/data/15083033/fileData.do",
    })
    total = 0
    deadline = time.monotonic() + 1200
    with opener.open(req, timeout=60) as response, open(destination, "wb") as target:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > MAX_ZIP_BYTES or time.monotonic() > deadline:
                raise ValueError("공식 ZIP의 다운로드 크기 또는 시간이 제한을 초과했습니다.")
            target.write(block)
    if not zipfile.is_zipfile(destination):
        raise ValueError("공식 다운로드가 CSV ZIP을 반환하지 않았습니다.")
    print(f"Official ZIP downloaded: {total:,} bytes", flush=True)


def row_from_csv(row):
    store_id, name = text(row.get("상가업소번호"), 100), text(row.get("상호명"))
    code = text(row.get("시도코드"), 2)
    # Previous province codes refer to the same provinces, not a new business.
    code = {"42": "51", "45": "52"}.get(code, code)
    if not store_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", store_id) or not name or code not in REGIONS:
        return None
    road, land = text(row.get("도로명주소"), 500), text(row.get("지번주소"), 500)
    if not road and not land:
        return None
    def coordinate(key, minimum, maximum):
        try:
            value = float(row.get(key, ""))
            return round(value, 7) if minimum <= value <= maximum else None
        except (ValueError, TypeError):
            return None
    return [store_id, name, text(row.get("지점명")), road, land, code,
            text(row.get("시군구명")), text(row.get("상권업종소분류코드"), 30),
            text(row.get("상권업종소분류명")), coordinate("경도", -180, 180), coordinate("위도", -90, 90)]


def compressed_file(directory, relative, value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    path = directory / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(compressed)
    return {"path": relative, "compressedBytes": len(compressed), "uncompressedBytes": len(raw),
            "sha256": hashlib.sha256(compressed).hexdigest()}


def build_catalog(zip_path, output, config, source_date, *, metadata=None, now=None, minimum_rows=None):
    dt.date.fromisoformat(source_date)
    now = now or utcnow()
    minimum_rows = config.get("minimumRows", 100000) if minimum_rows is None else minimum_rows
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with open(zip_path, "rb") as source_file:
        for block in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(block)
    archive_hash = digest.hexdigest()
    database = output.parent / "staging.sqlite"
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA journal_mode=OFF")
    connection.execute("PRAGMA synchronous=OFF")
    connection.execute("CREATE TABLE stores (id TEXT PRIMARY KEY, region TEXT, name TEXT, payload TEXT)")
    counts = {"sourceCount": 0, "acceptedCount": 0, "rejectedCount": 0, "duplicateCount": 0}
    region_counts = {}
    try:
        with zipfile.ZipFile(zip_path) as archive:
            files = [item for item in archive.infolist() if item.filename.lower().endswith(".csv") and not item.is_dir()]
            if not files or len(files) > 100 or sum(item.file_size for item in files) > MAX_RAW_BYTES:
                raise ValueError("원천 CSV 구성 또는 압축 해제 크기가 올바르지 않습니다.")
            for item in files:
                with archive.open(item) as binary, io.TextIOWrapper(binary, encoding="utf-8-sig", newline="") as stream:
                    reader = csv.DictReader(stream)
                    required = {"상가업소번호", "상호명", "시도코드", "도로명주소", "지번주소", "상권업종소분류코드", "상권업종소분류명"}
                    if not required.issubset(set(reader.fieldnames or [])):
                        raise ValueError("공식 CSV 열 구성이 바뀌었습니다. 필드 연결 확인이 필요합니다.")
                    for original in reader:
                        counts["sourceCount"] += 1
                        row = row_from_csv(original)
                        if row is None:
                            counts["rejectedCount"] += 1
                            continue
                        payload = json.dumps(row, ensure_ascii=False, separators=(",", ":"))
                        cursor = connection.execute("INSERT OR IGNORE INTO stores VALUES (?, ?, ?, ?)", (row[0], row[5], normalize_name(row[1]), payload))
                        if cursor.rowcount == 0:
                            existing = connection.execute("SELECT payload FROM stores WHERE id=?", (row[0],)).fetchone()[0]
                            if existing != payload:
                                raise ValueError("같은 상가업소번호의 서로 다른 행을 발견했습니다. 원천 검토가 필요합니다.")
                            counts["duplicateCount"] += 1
                        else:
                            counts["acceptedCount"] += 1
                            region_counts[row[5]] = region_counts.get(row[5], 0) + 1
                connection.commit()
                print(f"Parsed {counts['sourceCount']:,} source rows", flush=True)
        if counts["acceptedCount"] < minimum_rows:
            raise ValueError("정상 전국 목록으로 배포하기에 수집 건수가 부족합니다.")
        if len(region_counts) != config.get("requiredRegionCount", 16) or (config.get("requiredRegionCodes") and set(region_counts) != set(config["requiredRegionCodes"])):
            raise ValueError("공식 원천의 전국 지역 구성이 모두 확인되지 않았습니다.")
        if counts["rejectedCount"] > max(100, counts["sourceCount"] * 0.01):
            raise ValueError("누락 또는 잘못된 행이 1%를 초과했습니다. 기존 정상 자료를 유지합니다.")
        connection.execute("CREATE INDEX name_order ON stores (region, name, id)")
        connection.commit()
        shards, routing = [], {}
        target_bytes = min(config.get("shardTargetBytes", 524288), MAX_SHARD_BYTES - 10000)
        batch, batch_bytes, batch_region = [], 2, ""

        def flush():
            nonlocal batch, batch_bytes
            if not batch:
                return
            index = len(shards)
            shard_id = f"{batch_region}-{index:05d}"
            descriptor = compressed_file(output, f"shards/{shard_id}.json.gz", batch)
            if descriptor["uncompressedBytes"] > MAX_SHARD_BYTES:
                raise ValueError("검색 조각의 압축 해제 크기가 제한을 초과했습니다.")
            descriptor.update({"id": shard_id, "regionCode": batch_region, "rowCount": len(batch)})
            shards.append(descriptor)
            grams = set()
            for row in batch:
                grams.update(name_grams(row))
            for gram in sorted(grams):
                routing.setdefault(gram, []).append(index)
            batch, batch_bytes = [], 2

        for region, payload in connection.execute("SELECT region, payload FROM stores ORDER BY region, name, id"):
            row_bytes = len(payload.encode("utf-8")) + 1
            if batch and (region != batch_region or batch_bytes + row_bytes > target_bytes):
                flush()
            batch_region = region
            batch.append(json.loads(payload))
            batch_bytes += row_bytes
        flush()
        route_file = compressed_file(output, "routing.json.gz", {"schemaVersion": 1, "grams": routing})
        manifest = {"schemaVersion": 1, "version": archive_hash[:20], "sourceDate": source_date, "collectedAt": now,
                    **counts, "source": {key: config[key] for key in ("provider", "name", "url", "license")},
                    "sourceArchive": {"sha256": archive_hash, "bytes": Path(zip_path).stat().st_size, **(metadata or {})},
                    "regions": [{"code": code, "name": REGIONS[code], "count": region_counts[code]} for code in sorted(region_counts)],
                    "shards": shards, "routing": route_file, "schedule": config["schedule"],
                    "coverage": "전국 상가(상권)정보에 수록된 상가업소. 모든 사업자등록 업체를 포함하는 자료는 아닙니다.",
                    "businessNumberAvailable": False}
        write_json(output / "manifest.json", manifest)
    finally:
        connection.close()
        database.unlink(missing_ok=True)
    print(f"Catalog built: {counts['acceptedCount']:,} stores, {len(shards):,} shards, routing {route_file['compressedBytes']:,} bytes", flush=True)
    return manifest


def publish_catalog(staged, destination):
    destination = Path(destination)
    backup = destination.with_name(destination.name + ".previous")
    if backup.exists():
        raise ValueError("이전 수집 복구 경로가 남아 있습니다. 기존 자료를 보존합니다.")
    had_previous = destination.exists()
    if had_previous:
        destination.replace(backup)
    try:
        Path(staged).replace(destination)
    except Exception:
        if had_previous:
            backup.replace(destination)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path)
    parser.add_argument("--source-date")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--strict", action="store_true", help="Exit nonzero on an expected upstream error")
    args = parser.parse_args()
    config = read_json(SOURCE)
    old = read_json(CATALOG / "manifest.json", {})
    previous_status = read_json(STATUS, {})
    now = utcnow()
    status = {"schemaVersion": 1, "provider": "semas", "schedule": config["schedule"],
              "lastAttemptAt": now, "lastSuccessAt": previous_status.get("lastSuccessAt") or old.get("collectedAt"),
              "status": "checking", "lastError": "", "sourceDate": old.get("sourceDate"),
              "acceptedCount": old.get("acceptedCount", 0)}
    try:
        with tempfile.TemporaryDirectory(prefix=".store-catalog-", dir=ROOT / "data") as temporary:
            folder = Path(temporary)
            if args.zip:
                if not args.source_date:
                    raise ValueError("직접 가져올 공식 ZIP에는 --source-date가 필요합니다.")
                zip_path, metadata = args.zip.resolve(), {"sourceDate": args.source_date, "importedOfficialZip": True}
            else:
                opener = make_opener()
                metadata = discover_source(opener, config)
                # Every day records an actual successful version check; download
                # time and the prior source date stay unchanged when content does.
                if not args.force and all(old.get("sourceArchive", {}).get(key) == metadata[key] for key in ("attachmentId", "fileDetailSn", "filename")):
                    status.update({"status": "unchanged", "lastCheckedAt": utcnow()})
                    write_json(STATUS, status)
                    print("Official source version unchanged; existing catalog retained.")
                    return
                zip_path = folder / "source.zip"
                download_source(opener, metadata, zip_path)
            staged = folder / "catalog"
            manifest = build_catalog(zip_path, staged, config, metadata["sourceDate"], metadata=metadata)
            if old.get("acceptedCount", 0) and manifest["acceptedCount"] < old["acceptedCount"] * 0.7:
                raise ValueError("이전 수집보다 목록이 30% 이상 줄었습니다. 자동 교체를 중단했습니다.")
            publish_catalog(staged, CATALOG)
            status.update({"status": "success", "lastSuccessAt": manifest["collectedAt"], "lastCheckedAt": utcnow(),
                           "sourceDate": manifest["sourceDate"], "acceptedCount": manifest["acceptedCount"],
                           "version": manifest["version"]})
    except (OSError, ValueError, csv.Error, zipfile.BadZipFile) as error:
        # Expected upstream failures retain the complete previous catalog. The
        # status is public but contains no response body, session cookie or key.
        status.update({"status": "failed", "lastError": str(error)[:500]})
        print(f"Catalog collection failed; previous snapshot retained: {status['lastError']}", file=sys.stderr)
        write_json(STATUS, status)
        if args.strict:
            raise SystemExit(1)
        return
    write_json(STATUS, status)


if __name__ == "__main__":
    main()
