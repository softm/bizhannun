import importlib.util
import tempfile
import unittest
from pathlib import Path
import csv
import json

spec = importlib.util.spec_from_file_location("builder", Path(__file__).resolve().parents[1] / "scripts/build-business-number-index.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class BusinessNumberIndexTest(unittest.TestCase):
    def test_checksum(self):
        self.assertEqual(builder.valid_number("220-81-62517"), "2208162517")
        self.assertIsNone(builder.valid_number("220-81-62518"))
        self.assertIsNone(builder.valid_number("123"))

    def test_export(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "public.csv"
            with source.open("w", encoding="utf-8", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=["사업자등록번호", "상호", "주소"])
                writer.writeheader()
                writer.writerow({"사업자등록번호": "220-81-62517", "상호": "예시업체", "주소": "서울"})
                writer.writerow({"사업자등록번호": "220-81-62517", "상호": "예시업체", "주소": "서울"})
                writer.writerow({"사업자등록번호": "220-81-62518", "상호": "잘못된 번호", "주소": "서울"})
            out = root / "output"
            manifest = builder.build([("test-fixture", source)], out)
            self.assertEqual(manifest["recordCount"], 1)
            self.assertEqual(manifest["stats"]["duplicates"], 1)
            self.assertEqual(manifest["stats"]["skipped"], 1)
            rows = json.loads((out / "220.json").read_text(encoding="utf-8"))
            self.assertEqual(rows[0]["businessNumber"], "2208162517")

if __name__ == "__main__":
    unittest.main()
