# 사업자한눈 · 사업자등록번호 독립 JSON 수집/검색

## 목적과 범위

- **DB 사용 없음. 비즈노 API나 크롤링 의존 없음.** 공정위 공식 통신판매사업자 공개정보를 읽어 JSON/GZIP 정적 파일로 게시합니다.
- 기존 소진공 전국 상가 명부에는 사업자등록번호가 없습니다. **상호·도로명주소가 정확히 일치하는 공개번호도 '동일 사업자 후보'로 표시**하고, 국세청 등록 상태는 해당 번호로 조회할 때만 확인합니다.
- 공정위 278만여 행은 **통신판매사업자 등록자료**이며 모든 사업자등록 업체를 포함한다는 뜻이 아닙니다. 행 수와 중복 제거 후 공개 번호 자료 수를 분리해서 보세요.
- API 전체 페이지가 변경될 수 있으므로 '페이지 순회 완료'와 '현 시점 전체 업체와 정확히 일치'는 다릅니다.

## 공식 출처

- 통신판매사업자 등록현황 API: https://www.data.go.kr/data/15126311/openapi.do
- 통신판매사업자 지역별 공개 CSV: https://www.data.go.kr/data/15083251/fileData.do
- 국세청 등록 상태 조회: https://www.data.go.kr/data/15081808/openapi.do
- 기존 상가 명부: https://www.data.go.kr/data/15083033/fileData.do

## 실행 구조

| 대상 | 실행 일정 (한국시간) | 작업 범위 | Pages 아티팩트 |
| --- | --- | --- | --- |
| .github/workflows/ftc-registration-crawl.yml | 매일 03:09, 09:09, 15:09, 21:09 | 공정위 최대 120페이지 누적, 완전성 검증, JSON만 commit | 없음 |
| .github/workflows/pages.yml | 매일 06:17 + 명시적인 실행/코드 변경 | 기존 서비스 데이터 유지, 공정위 최대 120페이지 누적, 정적 사이트 배포 | 1일 보관 |

정기 시각은 cron 시작 요청 시각이며 GitHub Actions 스케줄 실행이 지연될 수 있습니다.
별도 수집 워크플로는 외부 DB를 사용하지 않고, `GITHUB_TOKEN`으로 데이터만 커밋합니다. 이 커밋은 GitHub의 재귀 실행 방지 규칙 때문에 Pages를 자동 트리거하지 않으며, Pages는 기존 정기 배포에서 축적된 JSON을 반영합니다.
두 수집 워크플로의 예정 시각을 서로 다르게 배치했습니다. 경합 중 main 브랜치가 변경되면 강제 푸시 없이 안전하게 중단합니다.

### 안전 제어

- `FTC_SERVICE_KEY`는 GitHub Secrets에서만 사용하고 공개 JS/JSON에 포함하지 않습니다.
- 수집기 `scripts/collect-business-number-pages.mjs`: 첫 미수집 페이지부터 최대 120페이지, 재시도, 체크섬·등록번호 검증, 중복 제거, 장애 시 기존 정상 JSON 유지
- `scripts/validate-registration-catalog.mjs`: 누적 JSON 조각 전체의 행 수, 검증번호, SHA-256 및 검색 라우팅 참조 검증
- `data/business-number-status.json`: 마지막 시도, 마지막 성공, 오류, 실제 누적 건수, 다음 페이지
- `data/business-numbers/manifest.json`: 전체 소스 행 수, 게시한 레코드 수, `complete`, `nextPageNo`, 원천 URL, 각 조각 SHA-256
- 검색은 `routing.json.gz`와 필요한 `shards/*.json.gz`만 다운로드합니다. 광범위 검색에서 페이지 조각 확인 한도에 도달하면 부분 검색임을 안내합니다.
- 정상 전체 페이지 순회 직후에는 6일 내 중복 전량 수집을 하지 않습니다.
- 대량 수집 중 원본 행 순서 변동 가능성이 있으므로 전체 완료 후 누락률 대조와 재수집 검증을 별도 실시해야 합니다.

## 운영 확인

- [공개 사업자번호 검색](https://softm.github.io/bizhannun/#lookup)
- [데이터 현황](https://softm.github.io/bizhannun/data-status.html)
- [전용 수집 Actions](https://github.com/softm/bizhannun/actions/workflows/ftc-registration-crawl.yml)
- [Pages 정기 배포](https://github.com/softm/bizhannun/actions/workflows/pages.yml)

테스트:

```bash
npm test
node scripts/validate-registration-catalog.mjs
python3 -m unittest discover -s tests -p '*_test.py'
npm run check && npm run build
```

## 주의사항

공개 사업자등록번호가 있다고 해도 같은 상호·주소만으로 국세청이 두 레코드의 관계를 보증하지 않습니다. 사용자에게는 공식 원천 공개번호, 상가 정보, 국세청 등록 상태, 확정되지 않은 연결 후보를 구분해 표시합니다.
