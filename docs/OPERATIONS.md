# 사업자한눈 운영 안내

이 문서는 저장소에 구현된 웹 앱을 실행·배포·점검하는 절차입니다. 제품 확장 아이디어는 [PRODUCT_PLAN.md](PRODUCT_PLAN.md)에 있으며 현재 운영 기능과 구분합니다.

## 1. 구성과 책임

| 구성 | 역할 | 보관하는 정보 |
| --- | --- | --- |
| 브라우저 UI | 조회 입력, 거래처 관리, 계정 화면, 조건 기반 지원사업 탐색 | 비로그인 IndexedDB 자료·개인 설정, 로그인 계정의 메모리 상태 |
| GitHub Pages | 정적 UI와 공개 지원사업 스냅샷 제공 | 공개 빌드 산출물만 |
| Node.js / Vercel API | 국세청·공정위 요청 중계, 공개 로그인 설정, 카카오·네이버 OAuth | 서버 환경변수의 인증키·서비스 계정·SNS 비밀값, 일시적 요청 제한 상태 |
| Firebase Authentication | 구글·이메일 인증과 검증된 SNS Custom Token 로그인 | 제공자별 사용자 계정과 Firebase UID |
| Firestore | UID별 거래처·메모·프로필·조회 이력 보관 | 계정 업무 공간, 순차 저장 버전과 분할 데이터 |
| GitHub Actions 수집기 | 공개 지원사업 목록 수집, 상태 기록, 정적 배포 | `data/*.json`의 공개 목록과 수집 상태 |

v0.2는 사용자 계정과 Firestore 정보 보관을 구현합니다. 팀 공동 작업과 서버 예약 조회는 포함하지 않습니다. GitHub Actions는 공개 지원사업만 수집하며 개인 거래처를 읽거나 감시하지 않습니다. 로그인·데이터베이스 설정과 실제 연동 확인 절차는 [AUTH_SETUP.md](AUTH_SETUP.md)에 있습니다.

## 2. 환경변수

| 이름 | 위치 | 내용 |
| --- | --- | --- |
| `NTS_SERVICE_KEY` | 로컬 서버 또는 Vercel 서버 환경변수 | 국세청 상태조회·진위 대조에 사용할 인증키 |
| `DATA_GO_KR_SERVICE_KEY` | 서버 환경변수, 선택 | `NTS_SERVICE_KEY`가 비어 있을 때의 국세청 인증키 대안 |
| `FTC_SERVICE_KEY` | 서버 환경변수 | 공정위 통신판매 신고정보 조회 인증키 |
| `ALLOWED_ORIGINS` | 서버 환경변수 | 추가로 허용할 브라우저 origin 목록. 쉼표로 구분 |
| `PORT` | 로컬 개발 서버, 선택 | 기본값 4173. 서버는 127.0.0.1에만 바인딩 |
| `BIZ_API_BASE` | 빌드 환경변수 또는 GitHub Actions 저장소 variable | 브라우저에 공개할 API 서버 origin. 인증키가 아님 |
| `PROVIDER_TIMEOUT_MS` | 서버 환경변수, 선택 | 원천 요청 제한 시간. 코드의 상한과 전체 요청 제한을 함께 적용 |
| `API_RATE_LIMIT_PER_MINUTE` | 서버 환경변수, 선택 | 인스턴스 안에서 제한할 분당 요청 수. 기본 60 |
| `API_RATE_LIMIT_RECORDS_PER_MINUTE` | 서버 환경변수, 선택 | 인스턴스 안에서 제한할 분당 사업자 레코드 수. 기본 1,000 |
| `FIREBASE_WEB_CONFIG` | 서버 환경변수, 선택 | 공개 웹 SDK 설정 JSON. 기본 `config/firebase-public.json`의 Firebase 설정을 덮어씀 |
| `FIREBASE_GOOGLE_ENABLED`, `FIREBASE_EMAIL_ENABLED` | 서버 환경변수, 선택 | 제공자 공개 플래그 `true`/`false`. Console 활성화와 별도로 확인 |
| `FIRESTORE_DATABASE_ID`, `FIRESTORE_EDITION` | 서버 환경변수, 선택 | 기본 `bizhannun`, `ENTERPRISE` |
| `AUTH_PUBLIC_ORIGIN` | 서버 환경변수 | OAuth 콜백 origin. 기본 `https://bizhannun.vercel.app` |
| `AUTH_SESSION_SECRET` | 서버 환경변수 | 최소 32자의 무작위 상태 쿠키 서명값. Production 등록 완료 |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 서버 환경변수 | SNS Custom Token 발급용 Admin 서비스 계정. 공개 설정에 포함 금지 |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | 서버 환경변수 | 서비스 계정 JSON 대신 사용하는 개별 값 |
| `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET` | 서버 환경변수 | 카카오 REST API 앱 키와 활성화한 Client Secret |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 서버 환경변수 | 네이버 로그인 앱의 Client ID·Client Secret |

인증키는 `app-config.js`, 소스 코드, `data/*.json`, 워크플로 YAML 값, 공개 출력 로그에 넣지 않습니다. 개발 환경은 `.env.example`의 변수명만 참고하여 Git 추적 밖의 `.env.local`을 직접 구성합니다.

`BIZ_API_BASE`는 `https://example.vercel.app` 같은 origin만 허용합니다. `/api` 같은 경로·쿼리·사용자명·비밀번호를 붙이면 빌드가 실패합니다. 로컬 개발의 `http://localhost:4173` 또는 `http://127.0.0.1:4173`는 허용됩니다. 이 값은 빌드된 `app-config.js`에 들어가며 누구나 볼 수 있습니다.

`BIZ_API_BASE`가 미설정이거나 공백이면 원본 `app-config.js`를 그대로 복사합니다. 값이 있는 경우에만 빌드 산출물의 API origin을 덮어씁니다.

## 3. 배포 전 확인

```bash
npm ci
npm run check
npm test
npm run test:rules
npm run build
```

`npm run check`는 JavaScript 구문과 공개 JSON을 검사하며 프로그램을 실행하거나 원천 API를 호출하지 않습니다. 동작 테스트의 원천 응답은 제어된 입력으로 검증합니다. 실제 공공데이터 활용 승인·키 유효성·운영기관 응답은 이 검사와 별개입니다.

빌드는 Firebase 웹 SDK를 포함한 브라우저 모듈을 번들합니다. `dist/`에는 지정한 공개 파일·번들·이미지·공개 데이터만 포함합니다. 서버·API 소스, 운영 문서, 테스트, 로컬 인증키는 정적 배포에 복사하지 않습니다. 테스트용 fixture와 에뮬레이터 결과는 실제 계정 로그인·클라우드 저장 결과와 구분합니다.

## 4. GitHub Pages 설정

1. 저장소 Pages 설정에서 Source를 **GitHub Actions**로 지정합니다. 워크플로는 Pages를 임의로 활성화하거나 기존 설정을 바꾸지 않습니다.
2. Actions 워크플로의 저장소 쓰기 권한을 허용합니다. 조직 정책과 브랜치 보호가 `GITHUB_TOKEN`의 공개 데이터 갱신 커밋을 허용하는지 확인합니다.
3. 현재 워크플로의 API 기본 주소는 `https://bizhannun.vercel.app`입니다. 다른 API 서버를 운영하면 저장소 Actions variable `BIZ_API_BASE`로 운영 origin을 덮어씁니다.
4. `main` push 또는 수동 실행으로 배포하고 Actions의 Pages 배포 URL을 확인합니다.

### 수집·보존·배포 순서

워크플로는 최신 `main`을 fast-forward로 확인한 뒤 구문 검사, 동작 테스트, 공개 데이터 수집을 수행합니다. 수집기는 원천 오류를 수집 상태에 남기고 기존 성공본을 유지합니다. 코드 오류나 JSON 손상 등 정상적으로 처리되지 않은 실패는 워크플로를 중단합니다.

수집 후에는 원격 `main`이 검사한 커밋과 같은지 다시 확인합니다. 같을 때만 `data/` 바로 아래의 JSON 변경을 커밋하고 push합니다. 이후 공개 파일을 빌드하여 Pages에 배포합니다. 수집 상태와 마지막 성공본을 저장소에 보존하는 이유는 매번 새로 만들어지는 Actions 실행 환경에서도 이전 성공 데이터를 확실히 이어받기 위해서입니다. 일시적인 캐시에 의존하지 않습니다.

같은 워크플로는 동시 실행하지 않습니다. 수집 중 다른 사람이 `main`을 변경했거나 마지막 push가 경합·권한 문제로 거절되면 배포를 중단합니다. 이때는 최신 `main`에서 다시 실행합니다. 강제 push나 검사하지 않은 코드와의 자동 병합은 하지 않습니다.

`GITHUB_TOKEN`이 만든 데이터 갱신 push는 일반적인 추가 Actions push 실행을 만들지 않으므로 매일 수집 커밋이 자기 자신을 반복 실행하는 방식으로 구성하지 않습니다. 이 동작은 [GitHub의 워크플로 트리거 문서](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow#triggering-a-workflow-from-a-workflow)를 참고합니다.

### 예약 시간

예약식은 `17 21 * * *`입니다. UTC 21:17은 한국 시간 다음 날 06:17입니다. 실행 대기나 GitHub의 예약 이벤트 정책에 따라 지연되거나 실행되지 않을 수 있으며 정확한 시각을 보장하는 작업 스케줄러로 취급하지 않습니다. 마지막 실행은 GitHub Actions에서, 사용자에게 제공되는 시점은 앱의 데이터 현황에서 확인합니다. 자세한 조건은 [GitHub schedule 문서](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)를 확인합니다.

## 5. Vercel API 설정

### 현재 연결 상태와 초기 직접 배포

`bizhannun` 프로젝트는 Node.js 24 환경으로 2026-10-20에 초기 운영 배포를 완료했고, 2026-10-21 한국 시간에 v0.2 로그인·공개 설정 API를 운영 배포했습니다. 공개 운영 origin은 `https://bizhannun.vercel.app`이며 `/api/health`의 익명 JSON 응답과 Pages origin의 CORS를 확인했습니다. 국세청·공정위 키는 미설정 상태입니다. Git 저장소 연결 요청은 필요한 Vercel GitHub App 설치가 없어 완료되지 않았으므로 현재 Git push로 Vercel에 자동 배포되지는 않습니다. 초기 배포는 검증한 로컬 소스를 Vercel REST API로 직접 전달했습니다.

[Create a new deployment](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)의 `POST /v13/deployments` 요청에서 기존 프로젝트 식별자, 팀 식별자, `target: "production"`을 지정하고 `files` 배열로 파일을 전달합니다. 인라인 파일은 다음 형식입니다.

```json
{
  "file": "src/app.mjs",
  "data": "파일 내용 문자열",
  "encoding": "utf-8"
}
```

`file`과 `data`는 필수이며 `encoding`은 `utf-8` 또는 `base64`입니다. 파일 경로는 프로젝트 루트 기준으로 보존합니다. 이 방식에서는 `gitSource`를 함께 지정하지 않습니다. 큰 파일은 먼저 업로드하고 SHA·크기로 참조하는 방식도 제공합니다. 정확한 필드 정의는 [Vercel 공식 OpenAPI 스키마](https://openapi.vercel.sh/)를 기준으로 합니다.

직접 배포에 필요한 소스는 UI·브라우저 모듈·공개 데이터, API 함수와 서버 제공기관 모듈, 빌드 스크립트, `package.json`, `vercel.json`입니다. `dist/`만 전송하면 이 프로젝트의 API 빌드 소스가 빠집니다. 인증키 파일·로컬 사용자 백업·Git 내부 파일은 전송하지 않습니다. 인증키는 프로젝트 서버 환경변수에 설정합니다.

요청 접수만으로 배포 완료로 판단하지 않고 `readyState: "READY"`와 Production 도메인의 실제 응답을 확인합니다. 소스나 공개 JSON이 바뀌면 현재 구성에서는 새 파일 배포를 별도로 수행해야 합니다. 향후 Git 자동 연동을 사용하려면 운영자가 Vercel GitHub App 설치와 해당 저장소 접근 권한을 설정하고 프로젝트 Git 연결을 완료합니다. GitHub Pages의 Actions 배포는 이 Vercel Git 연결과 별개입니다.

### 함수와 연결 확인

`vercel.json`은 `npm run build`와 `dist` 출력을 지정합니다. 기관 API는 `api/health.js`, `api/status.js`, `api/validate.js`, `api/commerce.js`에서 공통 구현 `api/index.mjs`를 호출합니다. `api/config.js`는 공개 설정, `api/auth.js`는 SNS OAuth 시작·콜백을 처리합니다. 총 6개 명시적 함수이며 pathname rewrite를 사용하지 않습니다. [Vercel Node.js 런타임의 Web Handler](https://vercel.com/docs/functions/runtimes/node-js) 형식인 `Request`/`Response` 및 HTTP 메서드별 named export를 사용합니다.

API 환경변수를 설정한 후 운영 배포를 만듭니다. 배포 환경이 Preview인지 Production인지, 키가 그 환경에 설정되어 있는지 구분하세요. 배포 보호가 켜진 주소는 공개 Pages 화면에서 API 호출이 막힐 수 있으므로 사용자에게 공개하도록 의도한 API origin으로 연결합니다. 보호 설정 변경은 운영자가 해당 프로젝트 정책에 맞게 결정합니다.

Standard Protection에 대응하는 `ssoProtection.deploymentType: "all_except_custom_domains"`는 개별 배포의 생성 URL을 보호하며 프로젝트의 Production 도메인은 공개합니다. Production 도메인에는 프로젝트에 할당된 짧은 `vercel.app` 주소도 포함됩니다. `target: "production"`인 배포라도 해시가 붙은 생성 URL 자체는 보호될 수 있습니다. 배포 응답의 `url`과 프로젝트의 Production alias를 구분하고, 후자의 `/api/health`를 로그인 쿠키 없이 확인한 뒤 Pages에 연결합니다. 이 범위는 [공식 Deployment Protection 안내](https://vercel.com/docs/deployment-protection)와 [Vercel Academy의 Production 도메인 예시](https://vercel.com/academy/optimize-your-vercel-account/deployment-protection)를 참고합니다.

로그인 HTML이 돌아오면 먼저 Production 도메인을 사용했는지 확인합니다. 자동화용 보호 우회 비밀값을 공개 브라우저 설정에 넣지 않습니다. 기본 보호 범위를 유지한 채 공개 Production 도메인을 사용하는 구성을 우선 확인합니다.

| 경로 | 메서드 | 입력 | 출력·목적 |
| --- | --- | --- | --- |
| `/api/health` | GET | 없음 | 서버 응답, 제공기관별 설정 여부, 확인 시점 |
| `/api/status` | POST | `businessNumbers`: 1~100개의 사업자번호 | 번호별 상태조회 결과 |
| `/api/validate` | POST | `businesses`: 1~100개의 대조 입력 | 번호별 입력정보 일치 여부 |
| `/api/commerce` | POST | `businessNumber`: 사업자번호 한 개 | 같은 사업자번호의 통신판매 공개 신고정보 |
| `/api/config` | GET, OPTIONS | 없음 | 허용된 공개 Firebase 설정, 제공자 준비 상태, 데이터베이스 ID·edition |
| `/api/auth` | GET | `action=start` 또는 `callback`, `provider=kakao` 또는 `naver` | 브라우저 팝업의 OAuth 이동과 검증된 Custom Token 전달 |

JSON 요청 본문은 256,000바이트를 넘을 수 없습니다. API는 사업자번호 검증번호, 필수 필드, 배열 크기를 검사합니다. 공개 API 키를 반환하지 않으며 예외의 원문 URL이나 오류 메시지를 응답에 그대로 내보내지 않습니다.

### CORS와 호출 제한

동일 origin, 로컬 개발 origin, 기본 Pages origin 및 `ALLOWED_ORIGINS`에 설정된 origin의 브라우저 요청을 허용합니다. CORS는 사용자 인증이 아닙니다. Origin 헤더 없이 호출하는 클라이언트까지 제한하지 않습니다.

요청 제한은 프로세스·인스턴스 메모리 안에서만 작동합니다. 여러 서버 인스턴스가 제공기관의 계정 전체 한도를 공유해서 제어하는 구조가 아닙니다. 운영 트래픽이 늘어나면 실제 호출량·제공기관 한도·호스팅 비용을 확인하고 필요한 인증 및 중앙 요청 제한을 별도로 설계합니다. 현재 기능으로 분산 할당량 제어나 사용자별 과금이 있다고 주장하지 않습니다.

### 정적 화면과 데이터 갱신

Vercel은 직접 전송한 소스에 포함된 공개 JSON을 제공합니다. 일별 수집의 기본 게시 대상은 GitHub Pages입니다. Git 자동 연동이 없는 현재 구성에서는 데이터 커밋을 만들어도 Vercel 배포가 갱신되지 않습니다. Vercel 화면에도 최신 스냅샷을 제공하려면 갱신 파일을 포함한 직접 배포를 수행하고 응답을 확인합니다.

화면의 `Content-Security-Policy`는 로컬 스크립트와 Google 로그인의 `apis.google.com` 스크립트를 허용합니다. Firebase·Google 인증 프레임과 HTTPS API 연결을 허용하며, OAuth 콜백은 자체 nonce 기반 CSP를 사용합니다. 전역 CSP로 콜백의 nonce 스크립트를 차단하지 않도록 HTML 화면 경로에만 화면 CSP를 적용합니다. `X-Content-Type-Options`, 프레임 차단, referrer 및 권한 정책 헤더도 설정합니다. GitHub Pages의 사용자 정의 HTTP 보안 헤더는 이 Vercel 설정으로 변경되지 않습니다.

## 6. 장애 대응

| 증상 | 먼저 확인할 것 | 처리 |
| --- | --- | --- |
| 연결 대기, HTML 응답, API 404 | Pages origin에 API를 요청하고 있는지, 연결 주소에 경로가 붙었는지 | 실제 API origin을 입력하고 `/api/health` 확인 |
| `not_configured` | 해당 배포 환경의 인증키 존재 여부 | 서버 환경변수를 설정한 뒤 적용된 배포 확인 |
| 키가 있는데 원천 조회 실패 | 활용 승인 대상, 승인 상태, 키 형식, 제공기관 점검·한도 | 제공기관의 공식 관리 화면과 응답 코드 확인. 키를 로그나 이슈에 붙이지 않기 |
| 403 origin 오류 | 브라우저의 실제 origin과 허용 목록 | 필요한 origin만 `ALLOWED_ORIGINS`에 추가하고 재배포 |
| 429 또는 조회 지연 | 앱의 요청 제한인지 원천 한도인지 | 기다린 뒤 필요한 번호만 다시 확인. 반복 호출로 한도를 우회하지 않기 |
| 지원사업 최신 수집 실패 | 데이터 현황의 최근 시도와 최근 성공 시각, Actions 수집 로그 | 원천 사이트·수집기 확인. 기존 성공본을 빈 배열로 덮지 않기 |
| 데이터 커밋 push 거절 | main 변경, 브랜치 보호, Actions 쓰기 권한 | 최신 main에서 다시 실행하거나 권한 정책 조정. 강제 push 금지 |
| 거래처가 사라진 것처럼 보임 | 주소·브라우저·프로필 변경, 저장 공간 삭제 | 원래 환경 확인 후 보관한 JSON 백업 복원 |
| 다른 탭 저장 충돌 | 여러 탭의 같은 업무 공간 편집 | 최신 내용을 다시 불러온 뒤 필요한 변경 재적용 |
| 로그인 방식이 설정 대기로 표시 | `/api/config`의 공개 설정·제공자 플래그, 서버 비밀값·프로젝트 일치 | Console 활성화와 설정 등록 후 새 Production 배포 |
| 로그인 후 자료가 없음 | 같은 제공자의 같은 계정인지, 기기 자료 가져오기를 했는지 | 해당 계정을 확인하고 필요한 경우 기기 자료를 명시적으로 가져오기 |
| Firestore 권한 오류 | 프로젝트·`bizhannun` DB 선택, 게시 규칙, 현재 UID | 공개 테스트 규칙으로 풀지 말고 대상 DB·인증·규칙을 확인 |

원천 오류와 `not_found`는 폐업 판정이 아닙니다. 앱은 마지막 성공 상태를 유지하고 최신 실패를 별도로 표시합니다. 장애 때문에 거래처 상태를 수동으로 폐업 처리하거나 변경 이벤트를 생성하지 않습니다.

수집 상태 JSON의 `lastAttempt` 계열 시각과 `lastSuccess` 계열 시각은 서로 다른 의미입니다. 상태 파일의 실제 필드와 화면에 표시되는 수집 시점을 함께 확인하세요. 성공 날짜만 새로 바꾸어 오래된 데이터를 최신으로 표시하면 안 됩니다.

## 7. 사용자 기록과 백업

로그인 계정의 거래처·메모·프로필·확인 이력은 Firebase UID별 Firestore 공간에 저장합니다. 서버 저장 확인과 버전 충돌 검사를 거친 뒤 저장 완료를 표시합니다. 다른 사용자 UID의 공간은 보안 규칙으로 차단합니다. 이메일이 같더라도 서로 다른 SNS 계정을 자동 병합하지 않으며 Console에서 `ID 공급업체별로 여러 계정 만들기`를 유지합니다.

비로그인 자료는 origin별 브라우저 IndexedDB에 유지합니다. Pages와 Vercel, localhost와 127.0.0.1은 서로 다른 기기 저장 공간일 수 있습니다. 사용자가 가져오기를 실행해야 계정으로 이전하며, 중복 사업자번호는 계정 자료를 유지하고 기기 원본은 보존합니다. 배포 되돌리기는 업무 데이터의 과거 버전 복구와 별개입니다.

복원 전 현재 JSON 백업을 내려받고, 복원 미리보기에서 거래처 수 등 내용을 확인합니다. 백업에는 업체명·태그·메모·프로필이 포함되므로 개인 업무 자료로 취급합니다. 공개 `data/` 디렉터리나 GitHub 이슈에 사용자 백업을 첨부하지 않습니다.

확인 이력은 거래처별 최근 50개로 제한됩니다. 상태 변화는 같은 사업자번호·같은 출처의 성공 응답끼리만 비교하며 최초 조회는 변화가 아닙니다. 이메일 알림이나 브라우저 종료 후 자동 조회 기능은 없습니다.

### Firebase 운영 대상과 규칙 배포

프로젝트는 [`biz-hannun`](https://console.firebase.google.com/project/biz-hannun/overview), 웹 앱은 `bizhannun-web`입니다. [Firestore Console](https://console.firebase.google.com/project/biz-hannun/firestore)에서 Enterprise Native 데이터베이스 `bizhannun`을 선택합니다. 위치는 `asia-northeast3`, 실시간 기능은 활성 상태입니다. `(default)`와 혼동하지 않도록 확인합니다. 초기 보안 규칙 게시를 확인했으며, 이후 규칙 변경도 별도로 배포해야 합니다.

```bash
npx -y firebase-tools@latest deploy --only firestore --project biz-hannun
```

이 명령은 Firebase 인증과 해당 프로젝트에 대한 배포 권한이 필요합니다. Pages·Vercel 소스 배포가 Firestore 규칙을 자동으로 적용하지 않습니다. 실제 계정으로 저장 후 새로고침·다른 브라우저의 같은 계정 재로그인을 확인하고 다른 UID의 접근 차단도 확인합니다.

### 국세청 키 미설정

활용신청 승인과 앱 서버의 키 등록은 별개입니다. [Vercel 환경변수](https://vercel.com/softms-projects/bizhannun/settings/environment-variables)에 Production `NTS_SERVICE_KEY`를 만들고 일반 인증키(Decoding)를 등록한 뒤 재배포합니다. 현재 기관 API는 Vercel에서 실행하므로 이 키를 GitHub Secret에 추가할 필요는 없습니다. `/api/health`의 `configured`는 키 존재 여부이며 실제 조회 성공은 별도로 확인합니다. 상세 순서는 [AUTH_SETUP.md](AUTH_SETUP.md)에 있습니다.

## 8. 수정과 되돌리기

오류를 수정하면 로컬 구문 검사·동작 테스트·빌드를 통과시킨 뒤 검토된 `main` 변경으로 배포합니다. 이전 배포로 되돌려야 할 때는 해당 배포를 선택하거나 이전 변경을 취소하는 새 커밋을 사용합니다. 저장소 이력을 강제로 다시 쓰지 않습니다.

지원사업 파서 변경 시에는 공개 출처·필드·기간·페이지 수·수집 범위를 함께 검토합니다. 일부분만 수집한 결과를 전수 수집으로 표시하거나 빈 결과를 원천의 실제 0건으로 단정하지 않습니다. 부분 수집을 성공 처리할지 여부는 수집기의 명시적인 검증과 상태 표시에 따라 결정합니다.

호스팅과 공공 API의 요금·활용 조건은 각 계정의 현재 약관과 설정에 따릅니다. 운영자는 [GitHub Actions](https://docs.github.com/en/actions)와 [Vercel](https://vercel.com/docs)의 현재 운영 조건을 확인합니다.
