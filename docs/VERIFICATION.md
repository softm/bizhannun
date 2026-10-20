# 구현·배포 검증 기록

v0.1 초기 검증: 2026-10-20. v0.2 로그인·계정 보관 추가 기록: 2026-10-21, 한국 시간 기준. 구현, 인프라 생성, 운영 설정, 실제 계정 검증을 구분합니다.

## 운영 주소

- 화면: [사업자한눈](https://softm.github.io/bizhannun/)
- 데이터 현황: [data-status.html](https://softm.github.io/bizhannun/data-status.html)
- 기관 API 상태: [/api/health](https://bizhannun.vercel.app/api/health)
- 로그인 공개 설정: [/api/config](https://bizhannun.vercel.app/api/config)
- Firebase 프로젝트: [biz-hannun](https://console.firebase.google.com/project/biz-hannun/overview)
- 로그인 제공자: [Authentication](https://console.firebase.google.com/project/biz-hannun/authentication/providers)
- 데이터베이스: [Firestore](https://console.firebase.google.com/project/biz-hannun/firestore)에서 `bizhannun` 선택

## v0.2 현재 확인 상태

| 항목 | 확인된 내용 | 남은 검증 |
| --- | --- | --- |
| Firebase 프로젝트 | `biz-hannun`, 표시 이름 Biz Hannun, Spark 플랜 생성 확인 | 운영 사용량 점검 |
| Firebase 웹 앱·공개 API | `bizhannun-web` 구성, 운영 `/api/config` HTTP 200, Google·email 구성 완료, Pages origin CORS 확인 | 카카오·네이버 인증값 등록 후 실제 인증 |
| Firestore 데이터베이스 | Enterprise Native `bizhannun`, `asia-northeast3`, 실시간 기능·보안 규칙 게시; 운영 프로필 저장 후 revision 1 재조회 | 수정본에서 저장 완료 화면·다른 기기 재조회 확인 |
| 구글 로그인 | 운영 Pages 앱에서 실제 Google 계정 선택, 로그인 완료, 계정 저장소 연결, 로그아웃 확인 | 수정 배포 이후 재로그인·기록 유지 재확인 |
| 이메일 로그인 | Console 제공자 활성화, 가입·로그인·재설정·인증 메일 UI와 클라이언트 구현·자동 검사 | 실제 이메일 가입·메일 수신 확인 |
| 승인된 도메인 | `softm.github.io`, `bizhannun.vercel.app` 등록; Pages에서 Google 인증 성공 | 별도 도메인 추가 시 재확인 |
| 계정 분리 정책 | Console의 `ID 공급업체별로 여러 계정 만들기` 저장; 이메일 자동 병합 없음; 에뮬레이터에서 다른 UID 접근 거부 | 다른 실제 계정·기기 간 검증 |
| 카카오·네이버 로그인 | OAuth 서버·상태 쿠키·제공자 확인·Custom Token 구현; Production `AUTH_SESSION_SECRET` 등록 | 앱 인증값·Firebase Admin 설정 및 실제 인증 |
| 계정 정보 저장 | 거래처·메모·프로필·조회 이력 저장 구현; 실제 운영 프로필 커밋·재조회 확인 | 저장 직후 충돌 안내 보완 후 운영 UI 재확인 |
| 기존 기기 자료 이전 | 명시적 가져오기, 사업자번호 중복 보호, 기기 원본 보존·자동 검사 | 기존 자료가 있는 브라우저의 실제 이전 확인 |
| v0.2 배포 | Pages Actions `39512185369` 성공; Vercel `dpl_3u5Aqo91Zko3kciBYGnDeLPiUrCw` READY·운영 alias 확인 | 저장 검증 보완 배포 결과는 아래에 기록 |
| 국세청·공정위 | 운영 `/api/health` HTTP 200, 두 제공자 모두 `configuration: missing_key`, `authentication: not_checked` | Production 키 등록·재배포 후 실제 기관 응답 확인 |

Firestore Console에서 `bizhannun` 규칙 게시와 새 활성 버전을 확인했습니다. 게시 규칙의 SHA-256은 `32b7854f24bd2a9f28ff7f34fce12730bdeb619a9127a9d69b8b2239c1a8479b`입니다. 규칙 게시, 에뮬레이터 시험, 실제 계정 시험의 범위를 구분합니다.

## v0.2 운영 브라우저·API 확인

2026-10-21 한국 시간에 다음 동작을 실제 운영 주소에서 확인했습니다.

- 로그인 설정을 다시 불러오자 Google 버튼과 이메일 폼이 활성화됐습니다. 인증값이 없는 카카오·네이버는 `준비 중`으로 표시됐습니다.
- Google 팝업에서 계정을 선택한 뒤 운영 앱의 `로그인됨`과 `계정 저장소 연결됨`, 저장 버전 0을 확인했습니다.
- 비어 있던 내 사업 프로필에 검증용 문구만 입력하고 저장했습니다. 실제 Firestore 커밋은 성공했지만 저장 직후 확인 과정에서 충돌 안내가 표시됐습니다.
- `계정 기록 다시 불러오기`를 실행하자 저장 버전 1, 마지막 저장 시각, `서버 확인 완료`가 표시됐습니다. 서버 저장과 재조회가 성공했음을 확인했습니다.
- 로그아웃 후 계정 자료가 화면에서 제거되고 비로그인 공간·로그인 폼으로 돌아오는 것을 확인했습니다.
- 쿠키 없이 호출한 `/api/config`와 `/api/health`가 HTTP 200을 반환하고 `Access-Control-Allow-Origin: https://softm.github.io`를 제공했습니다.

이후 브라우저 연결이 끊겨 수정 배포 후의 실제 재로그인·새로고침·다른 기기 조회는 추가 확인하지 못했습니다. 검증용 프로필 문구는 해당 계정에 남아 있으며 실제 사업체 정보로 바꿔 저장할 수 있습니다. 이메일 가입·메일 수신, 카카오·네이버 실제 로그인, 국세청 원천 인증 성공을 완료로 표시하지 않습니다.

### 로그인 화면

아래는 v0.2 운영 Pages의 실제 로그인 화면입니다. Google은 활성 상태이며 카카오·네이버의 설정 대기를 함께 표시합니다.

![사업자한눈 v0.2 로그인 화면](screenshots/login-v02.jpg)

### 저장 직후 확인 보완

실제 운영에서 커밋 후 재조회에는 성공했지만 저장 직후 확인에서 충돌로 표시되는 경합을 발견했습니다. 설치된 Firebase SDK의 `getDocFromServer`가 기존 실시간 listener의 마지막 서버 스냅샷을 이용하는 경로를 확인했습니다. 이전 head를 반환하는 조건을 강제로 재현한 시험은 수정 전 저장 후 `cloud/conflict`로 실패했고, 수정 후 통과했습니다. 운영 서버의 스트림 순서를 직접 계측한 것은 아니므로 이 재현 시험과 실제 운영 관찰을 구분합니다.

변경 가능한 head를 읽기 전용 `runTransaction(transaction.get)`으로 확인하도록 수정했습니다. 실제 더 높은 revision은 계속 충돌로 처리하며, 커밋 후 최신 head를 확인하지 못하면 `cloud/confirmation-pending`으로 안내하고 커밋한 자료를 보존합니다. Rules나 저장 스키마는 변경하지 않았습니다. 저장 어댑터 **16/16**, 실제 Firebase SDK와 Enterprise 에뮬레이터 **8/8**이 통과했습니다. `check`·기본 테스트·`build`·`git diff --check`도 통과했습니다. 수정 이후 실제 운영 브라우저 재검증은 연결 상실로 완료하지 못했습니다.

## v0.2 자동 검사 범위

| 영역 | 검사 내용 |
| --- | --- |
| 인증 클라이언트 | 공개 설정 allowlist, 오류 메시지 정규화, 팝업 origin·source·nonce·provider 확인, 계정 전환 |
| SNS 서버 | 서명된 상태 쿠키의 위조·만료·중복 거부, 정확한 origin, 제공자 토큰·사용자 검증, 비밀값 유출 방지 |
| 공개 설정 API | private 필드 제거, 잘못된 JSON 거부, CORS, 명명된 DB, Admin/Web 프로젝트 일치 |
| 계정 저장 | 저장 버전 충돌, 분할 기록·무결성, 다른 UID로 전환 중인 요청 차단, 게스트 이전·중복 처리 |
| Firestore 규칙 | 미로그인·다른 UID 접근 차단, 문서 구조·소유자 검증, 변경 불가능한 조각과 순차 저장 버전 |

로컬 `npm run check`, `npm test`, `npm run build`가 통과했습니다. SNS 서버 테스트 13개와 공개 설정 테스트 9개는 각각 직접 실행해서도 모두 통과했습니다. 저장 어댑터 테스트 16개와 공식 Enterprise 에뮬레이터를 이용한 Firestore 실제 SDK·규칙 검사 8개 중 8개 통과 기록을 확보했습니다. fixture 및 에뮬레이터 결과는 실제 제공자 로그인·운영 데이터베이스 저장의 성공을 뜻하지 않습니다.

```bash
npm ci
npm run check
npm test
npm run test:rules
npm run build
```

## v0.1 자동 검사 기록

`npm run check`, `npm test`, `npm run build`가 로컬과 GitHub Actions에서 통과했습니다. 테스트 파일은 도메인 규칙, 기관 API, 지원사업, 저장·복원의 네 영역으로 구성합니다.

사업자번호 검증번호, CSV의 따옴표·개행·중복·오류·수식 삽입 방어, 같은 사업자와 출처의 성공 응답 비교, 늦게 도착한 응답과 실패 응답 처리, 잘못된 백업의 중첩 구조, 사업자번호 불일치, 원천 요청 크기 제한, CORS, 기관 오류 처리와 출처 보존을 검사합니다. 기관 응답 테스트는 제어된 fixture를 사용하며 실제 인증 조회가 아닙니다.

## v0.1 공개 서버 확인

운영 Production 도메인에 로그인 쿠키 없이 요청했습니다.

| 확인 | 결과 |
| --- | --- |
| `GET /api/health` | HTTP 200 JSON, 서비스 배포 상태 확인 |
| Pages origin의 CORS | `https://softm.github.io`를 명시적으로 허용 |
| 올바른 번호 형식의 상태 요청 | HTTP 200, `not_configured`를 명시 |
| 잘못된 번호 형식의 상태 요청 | HTTP 400, `invalid_input` |
| 국세청·공정위 인증키 | 미설정; 실제 기관 인증 성공을 검증하지 않음 |

Vercel의 기본 배포 보호는 유지했습니다. 공개 운영 도메인은 `bizhannun.vercel.app`이며 팀 alias와 개별 배포 주소는 보호될 수 있습니다.

## v0.1 실제 브라우저 확인

- 잘못된 사업자번호에 대한 입력 오류 안내를 확인했습니다.
- 유효한 형식의 번호를 조회하면 인증키 미설정을 사업자 폐업이나 조회 성공으로 표시하지 않습니다.
- 임시 거래처에 태그·메모를 저장하고 새로고침 후 유지되는 것을 확인했습니다. 검증용 임시 거래처는 정리했습니다.
- CSV 미리보기에서 신규 1건, 기존 거래처 1건, 잘못된 행 1건을 구분하는 것을 확인했습니다.
- 지원사업 검색과 조건 확인 창, 원문 링크와 추가 확인 사항을 확인했습니다.
- Pages의 데이터 현황 화면에 2,000건, 원천 39,987건, 선정 범위와 기업마당 원천 기준일이 표시되는 것을 확인했습니다.
- 390 × 844 모바일 화면에서 메뉴 탐색과 조회 화면을 확인했습니다. 문서 너비와 스크롤 너비가 모두 390px로 가로 넘침이 없었습니다. 검증 후 화면 크기 설정은 원래대로 복원했습니다.
- 전국 대상 공고의 카드가 일부 지역만 표시하지 않도록 지역 요약을 개선했습니다.
- 배포 후 오래된 브라우저 모듈이 재사용되는 현상을 확인해 빌드 시 CSS·설정·전체 브라우저 모듈에 같은 콘텐츠 버전을 적용했습니다.

## 공개 데이터 범위

지원한눈 manifest와 gzip 목록의 파일 크기, SHA-256, 공고 건수를 검증했습니다. 원천 39,987건 중 미종료 공고 우선·게시일 순서로 최대 2,000건을 연결합니다. 초기 수집에서 메타데이터 불량 2건, 선택 상한 37,985건을 구분했습니다. 모든 원천 공고를 제공하는 화면은 아닙니다.

원천 전체 목록의 갱신 시각은 2026-10-20T00:27:06.298Z였습니다. 기업마당 부분은 원천의 인증키 미설정 안내에 따라 2026-10-12T12:17:48.234Z의 이전 성공 자료를 사용합니다. 앱의 수집 시각과 원천 자료의 갱신 시각을 구분해서 표시합니다.

## 초기 화면 기록

아래 이미지는 v0.1 초기 배포 화면입니다. v0.2 로그인·동기화 화면의 검증 증거로 사용하지 않습니다.

### 데스크톱

![사업자한눈 데스크톱 화면](screenshots/desktop.jpg)

### 모바일

![사업자한눈 모바일 화면](screenshots/mobile.jpg)

## 현재 운영 범위

v0.2는 Firebase UID별 업무 정보 보관과 로그인 전 기기 자료의 명시적 이전을 구현합니다. 비로그인 IndexedDB 공간을 유지하고 계정 자료와 분리합니다. 원격 변경을 감지하면 최신 기록을 불러오도록 안내하며 충돌을 무조건 덮어쓰지 않습니다. 팀 공동 작업, SNS 계정 자동 병합, 백그라운드 거래처 모니터링은 포함되지 않습니다.

국세청·공정위 원천 조회는 API 활용 승인과 서버 환경변수 설정 후 실제 인증 응답을 확인해야 합니다. 활용신청만으로 Vercel에 인증키가 등록되는 것은 아닙니다. [AUTH_SETUP.md](AUTH_SETUP.md)에 Production `NTS_SERVICE_KEY` 등록·재배포 절차를 안내합니다.

Pages 공개 목록 수집·배포는 매일 한국 시간 06:17로 예약되어 있습니다. Vercel은 소스 직접 배포 방식이며 GitHub App 연동이 없어 Git push만으로 API가 갱신되지는 않습니다. Firestore 규칙 역시 Pages 배포와 별도로 대상 데이터베이스에 적용합니다.
