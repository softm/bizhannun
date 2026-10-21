> **현재 운영 변경 (2026-10-21):** 국세청은 브라우저에서 직접 호출하며 Vercel에 의존하지 않습니다. GitHub Repository Secret `NTS_SERVICE_KEY`를 Pages 빌드에 주입합니다. 배포 후 키는 브라우저에서 확인 가능합니다. Google·이메일 로그인과 Firestore 저장은 Firebase에 직접 연결합니다. [현재 설정·배포 절차](docs/PAGES_DIRECT.md)를 참고하세요. 아래 Vercel 안내는 이전 구성입니다.

# 사업자한눈

사업자등록번호 또는 상호·업체명으로 사업자를 찾고, 거래처 확인 기록과 지원사업을 관리하는 웹 앱입니다. 이름 검색은 공개 수집자료와 현재 계정·기기의 거래처·내 사업 프로필을 대상으로 하며, 업체를 선택하면 해당 사업자번호로 기존 상태조회와 통합정보를 연결합니다. Firebase 로그인과 계정별 Firestore 정보 보관을 지원하고, 공개정보의 출처·확인 시점과 실제 검색 범위를 표시합니다.

- 실행: [사업자한눈](https://softm.github.io/bizhannun/) · [로그인·계정 보관](https://softm.github.io/bizhannun/#account)
- 데이터 현황: [data-status.html](https://softm.github.io/bizhannun/data-status.html)
- 상호·업체명 검색 사용법·범위·검증: [docs/NAME_SEARCH.md](docs/NAME_SEARCH.md)
- 거래처 정보 연결·사업자 인사이트 기획: [docs/BUSINESS_INSIGHTS.md](docs/BUSINESS_INSIGHTS.md)
- 사업자 통합정보 수집·출처·확장: [docs/BUSINESS_ENRICHMENT.md](docs/BUSINESS_ENRICHMENT.md)
- 저장소: [softm/bizhannun](https://github.com/softm/bizhannun)
- 운영·배포·장애 대응: [docs/OPERATIONS.md](docs/OPERATIONS.md)
- 구현·배포 검증과 화면 기록: [docs/VERIFICATION.md](docs/VERIFICATION.md)
- 로그인·Firestore·국세청 키 연결: [docs/AUTH_SETUP.md](docs/AUTH_SETUP.md)
- 카카오·네이버 앱 등록과 서버 설정: [docs/SOCIAL_AUTH.md](docs/SOCIAL_AUTH.md)
- 초기 제품 기획: [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md). 구현 완료 목록이 아닌 확장 방향을 담은 기획 문서입니다.

## 구현 범위

| 기능 | 제공하는 내용 | 연결 조건과 한계 |
| --- | --- | --- |
| 상호·업체명 검색 | 이름·번호 자동 구분, 부분 이름·공백·법인표기 완화, 후보의 번호·주소·출처 확인 후 선택 | 공개 수집자료와 내 거래처·프로필 범위이며 실제 검색 대상 수를 표시합니다. 전국 사업자 전체 검색은 아닙니다. [사용법과 검증](docs/NAME_SEARCH.md) |
| 거래처 정보 연결·인사이트 | 사업자번호로 조회·목록·상세·검색·내보내기 연결, 상태 재확인·자료 차이·누락 항목·다음 행동 안내 | 사용자 별칭을 보존하고 공개 상호의 출처를 표시합니다. 기본정보 확인 범위와 자료 시점을 제공하며 신용점수·거래 안전등급으로 해석하지 않습니다. |
| 사업자 상태 조회 | 계속·휴업·폐업 등 국세청 응답, 과세유형, 확인 시점 | GitHub Secret 빌드 주입 후 브라우저 직접 조회. 사업자번호만으로 상호·대표자·주소를 역조회하지 않습니다. |
| 사업자 통합정보 | 공개 상호·주소·업태·종목·업무 연락처·웹사이트·제품과 출처, 후보·충돌값 구분 | 등록 대상의 정기 수집본. 접근 가능한 공개 자료와 API 활용승인 범위에 한정됩니다. |
| 등록정보 진위 대조 | 사업자번호·개업일·대표자명 등 입력값 대조 | 국세청 API 연결 필요. 대표자 본인 인증이나 문서 원본 인증이 아닙니다. |
| 통신판매 신고정보 | 사업자번호가 정확히 일치하는 공개 신고정보 | Actions에 별도 공정위 API 인증키 필요. 통신판매 신고 데이터의 수록 범위에 한정됩니다. |
| 로그인·계정 보관 | 구글·이메일 로그인, 카카오·네이버 서버 OAuth, UID별 정보 보관 | 카카오·네이버는 개발자 앱 인증값과 Firebase Admin 설정 필요. 같은 제공자의 같은 계정을 사용합니다. |
| 거래처 관리 | 직접 등록, CSV 가져오기·내보내기, 태그·메모, 일괄 상태 확인 | 로그인 계정은 Firestore에 저장하고, 비로그인 자료는 기기의 IndexedDB에 따로 보관합니다. |
| 변경 기록 | 동일 사업자·동일 출처의 성공 응답 사이에서 확인된 상태 변화 | 최초 확인은 기준점입니다. 미조회·오류·미설정 결과로 폐업이나 상태 변화를 만들지 않습니다. |
| 지원사업 탐색 | 수집한 공개 목록 검색, 입력한 사업 프로필과 관련 조건 표시, 공식 원문 링크 | 자격 충족·선정·수급 가능성을 판정하지 않습니다. 지역·분야 등 공개 목록에 있는 정보만 사용합니다. |
| 데이터 현황 | 출처, 수집 시도와 성공 시점, 제공 범위, API 설정 상태 | 연결 상태는 인증키 존재 여부와 서버 응답을 보여 줍니다. 인증키 유효성이나 원천 데이터의 완전성을 보증하지 않습니다. |
| 백업·복원·이전 | 현재 공간의 거래처·프로필·확인 기록을 JSON으로 내보내고 복원, 기기 자료를 계정으로 가져오기 | 계정 이전은 사용자가 명시적으로 실행합니다. 중복 사업자번호는 계정 기록을 유지하며 기기의 원본은 보존합니다. |

신용등급, 거래 안전 점수, 체납·계좌·민원 이력, 비공개 매출을 제공하지 않습니다. DART·국민연금·조달·인허가 등은 현재 실시간 조회 구현 범위에 포함되지 않습니다. 지원사업 데이터는 수집된 출처와 범위를 화면에 표시하며 모든 공고를 망라한다고 주장하지 않습니다.

## 로컬 실행

Node.js 22 이상이 필요합니다. Firebase 웹 SDK·Admin SDK와 빌드 의존성을 설치합니다.

```bash
npm ci
npm start
```

브라우저에서 `http://127.0.0.1:4173/`를 엽니다. GitHub Pages의 하위 경로를 확인하려면 `http://127.0.0.1:4173/bizhannun/`도 사용할 수 있습니다. 개발 서버는 `127.0.0.1`에만 바인딩합니다.

실제 공공 API를 연결하려면 `.env.example`을 참고해 로컬 환경변수 또는 `.env.local`에 서버 인증키를 설정합니다.

```dotenv
NTS_SERVICE_KEY=국세청_활용승인_인증키
FTC_SERVICE_KEY=공정위_활용승인_인증키
ALLOWED_ORIGINS=https://softm.github.io,http://127.0.0.1:4173
PORT=4173
```

`DATA_GO_KR_SERVICE_KEY`는 `NTS_SERVICE_KEY`가 없을 때만 국세청 키로 사용됩니다. 공정위 키에는 별도 `FTC_SERVICE_KEY`를 사용합니다. 인증키를 `app-config.js`, 브라우저 입력창, CSV, 공개 저장소에 넣지 마세요. `.env.local`은 Git 추적 및 정적 빌드 대상에서 제외됩니다.

인증키 없이도 거래처 등록·태그·메모·백업과 공개 지원사업 탐색을 사용할 수 있습니다. 실제 조회가 준비되지 않은 경우 앱은 연결 대기 또는 설정 필요 상태를 표시합니다. 예시 업체나 가상의 성공 응답으로 대체하지 않습니다.

## 개발 명령

```bash
npm run check   # JS 구문, JSON, 필수 공개 파일 검사
npm test        # 도메인·API·수집 및 매칭 동작 테스트
npm run test:rules # Firestore 보안 규칙 에뮬레이터 검사
npm run collect # 공개 지원사업 데이터 갱신
node scripts/collect-businesses.mjs # 등록한 공개 사업자 정보 수집
npm run build   # 공개 파일만 dist/에 생성
```

`npm run build`는 Firebase 웹 SDK를 포함한 브라우저 코드를 번들하고 공개 HTML·CSS·이미지·JSON을 `dist/`에 생성합니다. `server/`, `api/`, `scripts/`, `tests/`, `docs/`, 서버 인증키 파일은 정적 산출물에 들어가지 않습니다. 개발 서버도 허용한 공개 경로만 제공합니다.

테스트는 입력 검증, 실패 응답 처리, 변경 기록, 수집 데이터 보존 등 동작을 검증합니다. 테스트 통과나 `/api/health`의 `configured: true`를 실제 인증키로 원천 기관 조회까지 성공했다는 뜻으로 해석하면 안 됩니다. 실제 연동 여부는 운영 환경에서 활용 승인·인증키·응답을 별도로 확인합니다.

## 배포 구조

### GitHub Pages

Pages는 화면과 공개 사업자·지원사업 JSON을 제공합니다. 국세청 상태·진위조회는 브라우저에서 직접 호출하고, 웹·공공 등록자료는 GitHub Actions에서 수집합니다.

1. Settings → Pages의 Source를 GitHub Actions로 설정합니다.
2. Repository Secret `NTS_SERVICE_KEY`를 등록합니다. 이 키는 사용자가 선택한 직접 호출 방식에 따라 배포 후 브라우저에서 확인할 수 있습니다.
3. `main` push 또는 Actions 수동 실행으로 수집·검사·배포합니다. 매일 한국 시간 06:17에도 실행하도록 정의했습니다.
4. 사업자 수집 대상·추가 API 승인·실패 시 이전 자료 보존은 [통합정보 안내](docs/BUSINESS_ENRICHMENT.md)를 확인하세요.

현재 운영에서 Vercel을 호출하지 않습니다. Firebase 로그인·계정 저장은 Firebase에 직접 연결합니다. 카카오·네이버 로그인은 별도 서버 인증 설정이 필요한 미완료 기능입니다.

### 이전 서버 구성 기록

아래는 이전 Vercel 서버 구성 기록이며 현재 Pages 운영 경로에는 사용하지 않습니다.

Vercel 배포는 정적 화면과 `/api/health`, `/api/status`, `/api/validate`, `/api/commerce`, `/api/config`, `/api/auth` 함수를 함께 제공합니다. 같은 배포 주소에서 화면을 열면 `BIZ_API_BASE`를 비워 두어도 같은 origin의 API를 사용합니다.

**배포 상태:** 2026-10-20에 Node.js 24 환경으로 초기 운영 배포를 완료했습니다. [운영 API 상태](https://bizhannun.vercel.app/api/health)의 익명 접근, Pages origin의 CORS, 정상 형식·오류 형식의 요청을 검증했습니다. `NTS_SERVICE_KEY`와 `FTC_SERVICE_KEY`는 미설정이며 실제 기관 인증 조회는 아직 수행하지 않았습니다. 소스 파일을 [Vercel 배포 API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)에 직접 전달했습니다. Vercel GitHub App이 설치되지 않아 Git push에 따른 Vercel 자동 배포는 연결되어 있지 않습니다.

v0.2의 Firebase 프로젝트 `biz-hannun`, 웹 앱 `bizhannun-web`, Enterprise Native 데이터베이스 `bizhannun`을 생성했습니다. 데이터베이스 위치는 `asia-northeast3`이며 실시간 기능을 활성화했습니다. Google·이메일/비밀번호 제공자 활성화, 승인 도메인 등록, 제공자별 계정 분리 설정과 보안 규칙 게시를 Console에서 확인했습니다. v0.2 Pages·Vercel 배포를 완료했고 운영 Google 로그인·로그아웃, 프로필 저장 후 재조회까지 확인했습니다. 저장 직후 확인 로직의 보완과 남은 실제 계정 검증 범위는 [검증 기록](docs/VERIFICATION.md)에 구분해서 기록합니다.

1. 검증한 UI·API·서버 모듈·빌드 스크립트·공개 JSON과 `package.json`, `vercel.json`을 기존 Vercel 프로젝트에 직접 배포합니다. `vercel.json`의 빌드 명령은 `npm run build`, 출력 디렉터리는 `dist`입니다. `.env.local` 등 인증키 파일은 전송하지 않습니다.
2. 프로젝트 환경변수에 필요한 `NTS_SERVICE_KEY`, `FTC_SERVICE_KEY`, `ALLOWED_ORIGINS`를 설정합니다. 공개 Pages 화면에서 호출하려면 `https://softm.github.io` 또는 실제 운영 origin을 허용합니다.
3. 배포가 준비되면 프로젝트의 **Production 도메인**에서 `/api/health`를 익명으로 확인하고, 실제로 조회 권한이 있는 사업자 입력으로 원천 연결을 확인합니다. 키 변경 후에는 해당 환경의 새 배포가 필요할 수 있습니다.
4. Pages에서도 사용하려면 확인한 Production origin을 Pages의 `BIZ_API_BASE`에 설정하고 Pages를 다시 빌드합니다. Standard Protection에서는 해시가 붙은 개별 배포 URL이 보호되므로 배포 응답의 `url`을 그대로 사용하지 않습니다. 프로젝트에 할당된 짧은 Production `vercel.app` 도메인 또는 운영 커스텀 도메인을 확인합니다. [공식 보호 범위 안내](https://vercel.com/academy/optimize-your-vercel-account/deployment-protection)

일별 공개 지원사업 수집과 Pages 갱신은 GitHub Actions가 담당합니다. Vercel 빌드 자체는 수집을 실행하지 않으며 직접 전송한 소스에 포함된 JSON으로 빌드합니다. Git 연결이 없는 현재 구성에서 Vercel 화면을 갱신하려면 최신 파일을 별도로 다시 배포해야 합니다. 향후 운영자가 Vercel GitHub App을 설치하고 저장소 연결을 완료하면 Git 자동 배포로 전환할 수 있습니다.

호스팅 요금, API 활용 승인, 요청 한도는 각 서비스와 계정 설정을 확인하세요. 이 저장소는 결제 상품을 신청하거나 유료 한도를 자동으로 확장하지 않습니다.

## 데이터 저장과 해석

로그인 계정의 거래처·태그·메모·프로필·확인 기록은 Firebase UID별 Firestore 공간에 저장합니다. 다른 기기에서도 같은 로그인 제공자의 같은 계정을 사용하면 같은 자료를 읽습니다. 저장 완료는 서버 확인 후 표시하며, 다른 기기의 변경과 충돌하면 최신 기록을 다시 불러오도록 안내합니다. 다른 SNS 계정을 이메일만으로 자동 병합하지 않습니다.

비로그인 상태의 자료는 기존처럼 해당 브라우저·origin의 IndexedDB에 보관합니다. 로그인만으로 기기 자료를 계정에 올리지 않고 명시적인 가져오기 기능을 사용합니다. 기기의 원본을 유지하고 중복 사업자번호는 계정의 기록을 우선합니다. 백업에는 직접 입력한 업무 정보가 포함될 수 있으므로 공개 저장소에 올리지 않습니다. 팀 공동 작업은 현재 범위에 포함되지 않습니다.

조회할 때는 입력한 사업자번호가 설정한 API 서버와 해당 제공기관에 전달됩니다. 등록정보 진위 대조는 별도로 입력한 개업일·대표자명을 국세청으로 전달하지만 거래처 기록에 저장하지 않습니다. 공개 지원사업 조건 비교는 브라우저에서 처리하며, 로그인 계정의 사업 프로필은 계정 자료와 함께 Firestore에 보관합니다.

변경 기록은 사용자가 상태 확인을 실행했을 때 발생합니다. 브라우저가 닫힌 동안 거래처를 자동으로 감시하거나 이메일·메신저로 알림을 보내는 기능은 없습니다. 계속사업자라는 응답은 세무 등록 상태에 관한 사실이며 거래 안전성·지급능력을 뜻하지 않습니다. 미조회와 통신 오류 역시 폐업의 근거가 아닙니다.

CSV 가져오기는 한 번에 최대 1,000개 데이터 행을 받으며 초과분을 몰래 버리지 않습니다. 정상 행, 오류 행, 중복 건수를 등록 전에 확인합니다. CSV 내보내기는 수식으로 해석될 수 있는 텍스트에 방어 처리를 적용합니다. 각 거래처의 확인 이력은 최근 50개까지 보관합니다.

## 출처와 구현 참고

- [국세청 사업자등록정보 진위확인 및 상태조회 서비스](https://www.data.go.kr/data/15081808/openapi.do)
- [공정거래위원회 통신판매사업자 등록상세 조회 서비스](https://www.data.go.kr/data/15126315/openapi.do)
- 지원사업 출처·개별 공고 원문·수집 범위: 앱의 **지원사업 찾기**, **데이터 현황** 및 공개 `data/collection-status.json`에서 확인
- [GitHub Pages 사용자 정의 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Actions 예약 이벤트](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel 프로젝트 설정](https://vercel.com/docs/project-configuration)
- [Firebase Authentication](https://firebase.google.com/docs/auth)
- [Firestore 보안 규칙](https://firebase.google.com/docs/firestore/security/get-started)

표시 내용이 원문과 다르거나 공고가 수정된 경우에는 해당 기관의 최신 원문을 확인합니다. 공개 목록의 이름·주소 유사성만으로 서로 다른 사업자를 같은 업체로 합치지 않습니다.
