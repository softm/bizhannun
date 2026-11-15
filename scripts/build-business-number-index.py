#!/usr/bin/env python3
"""Build verified business-number JSON from public CSV exports.

Input CSV must have a business registration number and company name.
Never infer a number from similar names/addresses.
"""
import argparse, csv, json, re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

NUMBER_KEYS = ("사업자등록번호", "사업자번호", "businessNumber", "b_no")
NAME_KEYS = ("상호", "상호명", "업체명", "companyName")
ADDRESS_KEYS = ("주소", "사업장주소", "소재지", "address")

def field(row, keys):
    return next((str(row[k]).strip() for k in keys if row.get(k)), "")

def valid_number(value):
    digits = re.sub(r"\D", "", value)
    if len(digits) != 10:
        return None
    weights = (1, 3, 7, 1, 3, 7, 1, 3, 5)
    total = sum(int(digits[i]) * weights[i] for i in range(9))
    total += (int(digits[8]) * 5) // 10
    return digits if (10 - total % 10) % 10 == int(digits[9]) else None

def build(inputs, output):
    by_number = {}
    stats = defaultdict(int)
    for source, path in inputs:
        with open(path, encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                stats["rows"] += 1
                number = valid_number(field(row, NUMBER_KEYS))
                name = field(row, NAME_KEYS)
                if not number or not name:
                    stats["skipped"] += 1
                    continue
                record = {"businessNumber": number, "name": name,
                          "address": field(row, ADDRESS_KEYS), "source": source}
                if number in by_number:
                    old = by_number[number]
                    if old["name"] != name or (old["address"] and record["address"] and old["address"] != record["address"]):
                        stats["conflicts"] += 1
                        continue
                    stats["duplicates"] += 1
                    continue
                by_number[number] = record
    buckets = defaultdict(list)
    for record in by_number.values():
        buckets[record["businessNumber"][:3]].append(record)
    output.mkdir(parents=True, exist_ok=True)
    for prefix, records in sorted(buckets.items()):
        (output / f"{prefix}.json").write_text(
            json.dumps(sorted(records, key=lambda x: x["businessNumber"]), ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8")
    manifest = {"generatedAt": datetime.now(timezone.utc).isoformat(),
                "recordCount": len(by_number), "stats": dict(stats),
                "shards": sorted(f"{prefix}.json" for prefix in buckets),
                "sources": sorted({source for source, _ in inputs})}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", action="append", nargs=2, metavar=("SOURCE_ID", "CSV_PATH"), required=True)
    parser.add_argument("--output", type=Path, default=Path("data/business-numbers"))
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.output), ensure_ascii=False))
