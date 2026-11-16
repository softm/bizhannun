# 사업자한눈: 공정위 사업자등록번호 JSON 검색

## 목적과 원칙
- DB 없이 공정위 공개 데이터 → Python 수집 → 분할 JSON → GitHub Pages 검색.
- 비즈노 API·크롤링은 사용하지 않습니다.
- 기존 소진공 상가 명부에는 번호가 없으므로 상호·주소만으로 번호를 자동 붙이지 않습니다.
- 공정위 공개 통신판매업 자료는 전국 모든 사업자를 포함하지 않습니다.
- 국세청 계속사업·휴폐업 상태는 등록번호 선택 후 별도로 조회합니다.

## 공식 데이터
- 공정위 등록현황 API: https://www.data.go.kr/data/15126311/openapi.do
- 공정위 지역별 CSV: https://www.data.go.kr/data/15083251/fileData.do
- 국세청 상태조회: https://www.data.go.kr/data/15081808/openapi.do

## 자동 수집 준비
1. 공공데이터포털에서 공정위 통신판매사업자 등록현황 API를 활용 신청합니다.
2. GitHub 저장소 Settings → Secrets and variables → Actions에서 FTC_SERVICE_KEY를 추가합니다.
3. 기존 pages.yml이 자동 실행되면 수집기를 실행합니다. 정상 스냅샷은 6일간 재사용합니다.
4. 데이터가 유효하면 data/business-numbers/manifest.json, routing.json.gz, shards/*.json.gz를 게시합니다.
5. 마지막 시도·성공·실패는 data/business-number-status.json에서 확인합니다.

## 지역별 공개 CSV 수동 초기 적재
다음 명령에 공식 지역별 CSV를 여러 번 지정할 수 있습니다.

    python3 scripts/collect-business-number-catalog.py --csv /path/서울.csv --csv /path/경기.csv --strict

전체 지역을 지정하지 않았다면 전국 전체 명부라고 표시하지 않습니다.
키 미설정, API 실패, 불완전한 페이지, 이전 대비 과도한 감소는 기존 JSON을 지우지 않습니다.

## 테스트
    python3 -m unittest discover -s tests -p '*_test.py'
    npm test
    npm run check
    npm run build

검색: https://softm.github.io/bizhannun/
데이터 현황: https://softm.github.io/bizhannun/data-status.html
자동 실행: https://github.com/softm/bizhannun/actions/workflows/pages.yml
