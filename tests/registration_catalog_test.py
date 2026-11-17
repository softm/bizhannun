import importlib.util
import gzip
import io
import urllib.error
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "registration_catalog",
    Path(__file__).resolve().parents[1] / "scripts/collect-business-number-catalog.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RegistrationCollectorTest(unittest.TestCase):
    def test_validation(self):
        self.assertEqual(module.valid_number("220-81-62517"), "2208162517")
        self.assertEqual(module.valid_number("220-81-62518"), "")
        self.assertEqual(module.normalized_name("(주) 다 온 상 사"), "다온상사")

    def test_public_json_and_failed_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "business-numbers"
            rows = [
                {"사업자등록번호":"220-81-62517","상호":"다온상사","사업장소재지":"서울"},
                {"사업자등록번호":"690-11-00416","상호":"서해박속낙지전문점","사업장소재지":"광명"},
                {"사업자등록번호":"220-81-62517","상호":"다온상사","사업장소재지":"서울"},
                {"사업자등록번호":"111-11-11111","상호":"잘못된 번호","사업장소재지":"서울"},
            ]
            manifest = module.publish(rows,out,source={"name":"공식시험자료","url":module.SOURCE},
                                      now="2026-11-16T00:00:00Z")
            self.assertEqual(manifest["recordCount"],2)
            self.assertEqual(manifest["invalidRows"],1)
            routing=json.loads(gzip.decompress((out/"routing.json.gz").read_bytes()))
            self.assertIn(0,routing["다"])
            shard=json.loads(gzip.decompress((out/"shards/00000.json.gz").read_bytes()))
            self.assertEqual(len(shard),2)
            with self.assertRaises(ValueError):
                module.publish([rows[0]],out,source={"name":"공식시험자료","url":module.SOURCE},
                               now="2026-11-17T00:00:00Z")
            self.assertEqual(json.loads((out/"manifest.json").read_text())["recordCount"],2)

    def test_auth_error_does_not_leak_secret(self):
        error = urllib.error.HTTPError(
            "https://apis.data.go.kr/test?serviceKey=TOPSECRET", 403,
            "Forbidden", {}, io.BytesIO(b"SERVICE_KEY_IS_NOT_REGISTERED_ERROR"))
        message = module.describe_http_error(error)
        self.assertIn("SERVICE_KEY_IS_NOT_REGISTERED_ERROR", message)
        self.assertIn("15126311", message)
        self.assertNotIn("TOPSECRET", message)

    def test_api_response(self):
        entries,total=module.api_items({"response":{"header":{"resultCode":"00"},
            "body":{"items":{"item":[{"brno":"2208162517","bzmnNm":"다온"}]},"totalCount":"1"}}})
        self.assertEqual(total,1)
        self.assertEqual(len(entries),1)
        with self.assertRaises(ValueError):
            module.api_items({"response":{"header":{"resultCode":"30"},"body":{"totalCount":0}}})

if __name__=="__main__":
    unittest.main()
