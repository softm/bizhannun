import csv
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).parents[1] / 'scripts/collect-store-catalog.py')
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)
DETAIL = 'uddi:b3094bc9-8756-4ecc-9141-9144b98a531e'
FILE = {'atchFileId': 'FILE_123', 'fileDetailSn': '1', 'orginlFileNm': '상가정보_20260630.zip'}


class CatalogImportTest(unittest.TestCase):
    def test_current_official_metadata_wrapper(self):
        responses = [DETAIL.encode(), json.dumps({'status': True, 'fileDataRegistVO': FILE}).encode()]
        with patch.object(catalog, 'request', side_effect=responses):
            found = catalog.discover_source(None, catalog.read_json(catalog.SOURCE))
        self.assertEqual(found['sourceDate'], '2026-06-30')
        self.assertEqual(found['attachmentId'], 'FILE_123')

    def test_ambiguous_or_invalid_sources_are_not_imported(self):
        for page in ['', DETAIL + ' uddi:00000000-0000-0000-0000-000000000000']:
            with patch.object(catalog, 'request', return_value=page.encode()):
                with self.assertRaises(ValueError):
                    catalog.discover_source(None, catalog.read_json(catalog.SOURCE))
        for item in [{**FILE, 'orginlFileNm': 'unknown.zip'}, {**FILE, 'atchFileId': '../secret'}]:
            with patch.object(catalog, 'request', side_effect=[DETAIL.encode(), json.dumps({'status':True, 'data':item}).encode()]):
                with self.assertRaises(ValueError):
                    catalog.discover_source(None, catalog.read_json(catalog.SOURCE))

    def test_captcha_stops_before_any_download(self):
        with patch.object(catalog, 'request', return_value=b'{"needCaptcha":true}') as request:
            with self.assertRaisesRegex(ValueError, 'CAPTCHA'):
                catalog.download_source(None, {'attachmentId':'FILE_123','fileDetailSn':'1'}, Path('unused.zip'))
            self.assertEqual(request.call_count, 1)

    def test_import_reconciles_counts_and_never_invents_registration(self):
        row = {'상가업소번호':'2208162517','상호명':'테스트 가게','시도코드':'42',
               '도로명주소':'강원특별자치도 강릉시 테스트길 1','지번주소':'',
               '상권업종소분류코드':'I21201','상권업종소분류명':'한식 일반 음식점'}
        stream = io.StringIO(); writer = csv.DictWriter(stream, fieldnames=list(row)); writer.writeheader()
        writer.writerows([row, row, {**row,'상가업소번호':''}])
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp); archive = path/'source.zip'
            with zipfile.ZipFile(archive,'w') as z: z.writestr('강원.csv',stream.getvalue())
            config={**catalog.read_json(catalog.SOURCE),'minimumRows':1,'requiredRegionCount':1,'requiredRegionCodes':['51']}
            manifest=catalog.build_catalog(archive,path/'out',config,'2026-06-30')
            self.assertEqual([manifest[k] for k in ['sourceCount','acceptedCount','duplicateCount','rejectedCount']],[3,1,1,1])
            self.assertEqual(manifest['regions'][0]['code'],'51')
            self.assertFalse(manifest['businessNumberAvailable'])
            rows=json.loads(catalog.gzip.decompress((path/'out'/manifest['shards'][0]['path']).read_bytes()))
            self.assertEqual(len(rows[0]),11)
            self.assertEqual(rows[0][0],'2208162517')

    def test_failed_publication_retains_previous_catalog(self):
        with tempfile.TemporaryDirectory() as temp:
            old=Path(temp)/'catalog';old.mkdir();(old/'manifest.json').write_text('previous')
            with self.assertRaises(FileNotFoundError):catalog.publish_catalog(Path(temp)/'missing',old)
            self.assertEqual((old/'manifest.json').read_text(),'previous')

if __name__ == '__main__': unittest.main()
