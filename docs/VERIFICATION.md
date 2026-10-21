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
| Firebase 웹 앱·공개 API | `bizhannun-web` 구성; 후속 `/api/config` HTTP 200·Pages CORS 허용, Google·email `configured: true`, kakao·naver `false` 확인 | 카카오·네이버 인증값 등록 후 실제 인증 |
| Firestore 데이터베이스 | Enterprise Native `bizhannun`, `asia-northeast3`, 실시간 기능·보안 규칙 게시; 운영 저장 직후 성공 표시·새로고침 복원 및 최종 revision 4 확인 | 다른 물리 기기에서 재조회 |
| 구글 로그인 | 같은 Chrome의 Pages·Vercel 두 origin에서 Google 로그인 성공; Pages 재로그인과 별도 origin의 동일 계정 자료 복원 확인 | 다른 물리 기기에서 동일 계정 인증·조회 |
| 이메일 로그인 | Console 제공자 활성화, 가입·로그인·재설정·인증 메일 UI와 클라이언트 구현·자동 검사 | 실제 이메일 가입·메일 수신 확인 |
| 승인된 도메인 | `softm.github.io`, `bizhannun.vercel.app` 등록; 두 origin에서 Google 인증 성공 | 별도 도메인 추가 시 재확인 |
| 계정 분리 정책 | Console의 `ID 공급업체별로 여러 계정 만들기` 저장; 이메일 자동 병합 없음; 에뮬레이터에서 다른 UID 접근 거부 | 다른 실제 계정·다른 물리 기기 간 검증 |
| 카카오·네이버 로그인 | OAuth 서버·상태 쿠키·제공자 확인·Custom Token 구현; Vercel 환경변수 메타데이터에서 Production `AUTH_SESSION_SECRET`만 등록된 상태 재확인 | 앱 인증값·Firebase Admin 설정 및 실제 인증 |
| 계정 정보 저장 | 운영 프로필 저장·새로고침·별도 origin 복원 확인; 다른 앱 인스턴스의 변경 안내와 최신 기록 불러오기 확인; 테스트 사업체명을 빈 값으로 정리하고 revision 4 저장 성공 | 실제 거래처·메모·조회 이력의 운영 저장 검증 |
| 기존 기기 자료 이전 | Vercel에서 명시적 가져오기 후 revision 3 저장 성공, 계정의 기존 프로필 유지, 로그아웃 후 기기 프로필 원문 복원 확인 | 거래처 0곳으로 시험했으므로 실제 거래처·사업자번호 중복 사례는 미검증 |
| 미저장 프로필 보호 | Vercel 비로그인 공간에서 Google 로그인 전 안내, 내 사업으로 돌아온 뒤 입력 보존, 프로필 저장 후 인증 팝업 시작 확인 | 이메일 가입·로그인 등 미검증 인증 흐름은 별도 확인 |
| v0.2 배포 | 커밋 `6194f8f`의 Pages Actions `39542201349` completed/success; Vercel `dpl_6kocPJjMKx5CXjjxAcva1WHVLLpN` READY·운영 alias, 양쪽 공개 모듈의 로그인 전 가드와 안내 문구 HTTP 확인 | — |
| 국세청·공정위 | 후속 `/api/health` HTTP 200·Pages CORS 허용, 두 제공자 모두 `configuration: missing_key`·`authentication: not_checked`; 환경변수 메타데이터에서도 미설정 재확인 | Production 키 등록·재배포 후 실제 기관 응답 확인 |

Firestore Console에서 `bizhannun` 규칙 게시와 새 활성 버전을 확인했습니다. 게시 규칙의 SHA-256은 `32b7854f24bd2a9f28ff7f34fce12730bdeb619a9127a9d69b8b2239c1a8479b`입니다. 규칙 게시, 에뮬레이터 시험, 실제 계정 시험의 범위를 구분합니다.

## v0.2 운영 브라우저·API 확인

2026-10-21 한국 시간의 최초 운영 확인에서 다음 동작을 실제 운영 주소에서 확인했습니다.

- 로그인 설정을 다시 불러오자 Google 버튼과 이메일 폼이 활성화됐습니다. 인증값이 없는 카카오·네이버는 `준비 중`으로 표시됐습니다.
- Google 팝업에서 계정을 선택한 뒤 운영 앱의 `로그인됨`과 `계정 저장소 연결됨`, 저장 버전 0을 확인했습니다.
- 비어 있던 내 사업 프로필에 검증용 문구만 입력하고 저장했습니다. 실제 Firestore 커밋은 성공했지만 저장 직후 확인 과정에서 충돌 안내가 표시됐습니다.
- `계정 기록 다시 불러오기`를 실행하자 저장 버전 1, 마지막 저장 시각, `서버 확인 완료`가 표시됐습니다. 서버 저장과 재조회가 성공했음을 확인했습니다.
- 로그아웃 후 계정 자료가 화면에서 제거되고 비로그인 공간·로그인 폼으로 돌아오는 것을 확인했습니다.
- 쿠키 없이 호출한 `/api/config`와 `/api/health`가 HTTP 200을 반환하고 `Access-Control-Allow-Origin: https://softm.github.io`를 제공했습니다.

위 확인 직후에는 브라우저 연결이 끊겨 수정 배포 후의 재로그인·새로고침·다른 기기 조회를 추가 확인하지 못했습니다. 이는 당시 검증의 제한이며, 이후 확인한 범위는 아래 후속 운영 검증에 구분해 기록합니다. 이메일 가입·메일 수신, 카카오·네이버 실제 로그인, 국세청 원천 인증 성공은 아직 완료로 표시하지 않습니다.

### 로그인 화면

아래는 v0.2 운영 Pages의 실제 로그인 화면입니다. Google은 활성 상태이며 카카오·네이버의 설정 대기를 함께 표시합니다.

![사업자한눈 v0.2 로그인 화면](screenshots/login-v02.jpg)

### 저장 직후 확인 보완

실제 운영에서 커밋 후 재조회에는 성공했지만 저장 직후 확인에서 충돌로 표시되는 경합을 발견했습니다. 설치된 Firebase SDK의 `getDocFromServer`가 기존 실시간 listener의 마지막 서버 스냅샷을 이용하는 경로를 확인했습니다. 이전 head를 반환하는 조건을 강제로 재현한 시험은 수정 전 저장 후 `cloud/conflict`로 실패했고, 수정 후 통과했습니다. 운영 서버의 스트림 순서를 직접 계측한 것은 아니므로 이 재현 시험과 실제 운영 관찰을 구분합니다.

변경 가능한 head를 읽기 전용 `runTransaction(transaction.get)`으로 확인하도록 수정했습니다. 실제 더 높은 revision은 계속 충돌로 처리하며, 커밋 후 최신 head를 확인하지 못하면 `cloud/confirmation-pending`으로 안내하고 커밋한 자료를 보존합니다. Rules나 저장 스키마는 변경하지 않았습니다. 저장 어댑터 **16/16**, 실제 Firebase SDK와 Enterprise 에뮬레이터 **8/8**이 통과했습니다. `check`·기본 테스트·`build`·`git diff --check`도 통과했습니다. 이 수정 직후에는 연결 상실로 운영 브라우저 재검증을 완료하지 못했으며, 이후 저장 성공 표시를 확인한 결과를 다음 절에 기록합니다.

수정 커밋은 [`81cd1c1`](https://github.com/softm/bizhannun/commit/81cd1c12eaeaf5a046840883d64569c3f8845dcc)이며, [당시 Pages 배포 실행](https://github.com/softm/bizhannun/actions/runs/39513872679)의 build·deploy가 모두 성공했습니다. 당시 Vercel 배포 `dpl_HCF4kEu78nQGDhgxWJf8SVUgqPDN`의 READY 상태와 `bizhannun.vercel.app` 연결을 확인했습니다. 양쪽 공개 HTML에서 실제 모듈 URL을 따라가 저장 확인 로직과 프로필 보관 안내 문구를 확인했습니다. 운영 `/api/config`와 `/api/health`도 HTTP 200·Pages CORS 허용을 다시 확인했습니다. 국세청·공정위 키와 카카오·네이버 서버 인증값은 여전히 설정 대기였습니다.

### 2026-10-21 후속 운영 검증

한국 시간 2026-10-21에 실제 브라우저에서 다음 범위를 추가 확인했습니다. Pages와 Vercel은 **같은 Chrome의 서로 다른 origin**에서 실행했습니다. 서로 다른 물리 기기나 서로 다른 실제 계정을 사용한 시험은 아닙니다.

1. Pages 운영 앱에서 Google로 다시 로그인하자 기존에 저장한 revision 1의 프로필이 복원됐습니다.
2. 테스트 사업체명만 `Firestore 저장·복원 검증용 · 테스트`로 변경해 저장했습니다. 저장 직후 `서버 확인 완료`와 저장 버전 2가 표시됐습니다.
3. Pages를 새로고침한 뒤 동일한 테스트 사업체명이 복원되는 것을 확인했습니다.
4. Vercel의 별도 origin에서 비로그인 상태로 사업 프로필을 입력한 다음 Google 로그인을 눌렀습니다. `작성 중인 사업 프로필을 먼저 저장해 주세요` 안내가 표시됐고, `내 사업으로 돌아가 저장하기`를 누르자 입력이 그대로 유지됐습니다. 프로필을 기기에 저장한 후에는 Google 인증 팝업이 정상적으로 시작됐습니다.
5. Vercel origin에서도 Google 로그인을 완료했습니다. 서버의 revision 2와 Pages에서 저장한 `Firestore 저장·복원 검증용 · 테스트` 프로필이 동일하게 복원됐습니다.
6. Vercel 기기 공간에 `로그인 전 기기 저장 검증용 · 테스트` 프로필이 있는 상태에서 명시적 가져오기를 실행했습니다. `서버 확인 완료`와 revision 3을 확인했으며, 계정의 기존 프로필을 유지했습니다. 이 시험의 거래처는 0곳이므로 실제 거래처 추가나 사업자번호 중복 사례를 검증한 것으로 보지 않습니다.
7. Vercel에서 로그아웃하자 기기의 `로그인 전 기기 저장 검증용 · 테스트` 프로필 원문이 그대로 복원됐습니다. 원본 보존을 확인한 뒤 기기 테스트 사업체명을 빈 값으로 저장했고, 페이지를 새로고침한 후에도 빈 값으로 유지되는 것을 확인했습니다.
8. Pages의 다른 앱 인스턴스에 `다른 기기에서 기록이 변경되었습니다`라는 안내가 표시됐습니다. `최신 기록 확인`을 눌러 계정의 최신 기록을 정상적으로 불러왔습니다. 안내 문구에 “다른 기기”가 포함되지만, 실제 확인한 대상은 같은 Chrome의 별도 origin입니다.
9. 마지막으로 Pages 계정의 테스트 사업체명을 빈 값으로 저장해 정리했고, `서버 확인 완료`와 저장 버전 4를 확인했습니다.

아래 이미지는 Pages에서 revision 2를 저장한 **당시의 확인 화면**입니다. 이후 가져오기와 테스트 사업체명 정리까지 마친 최종 확인 버전은 revision 4입니다.

![운영 Pages에서 프로필 저장 직후 서버 확인 완료와 저장 버전 2](screenshots/firestore-save-confirmed-v02.jpg)

Vercel에서 확인한 미저장 프로필 로그인 안내:

![작성 중인 사업 프로필을 먼저 저장하도록 안내하는 로그인 가드](screenshots/profile-login-guard-v02.jpg)

현재 후속 배포의 코드 커밋은 [`6194f8f`](https://github.com/softm/bizhannun/commit/6194f8f8756637e3d7cd17e11f5d72315e6c9970)입니다. [Pages 실행 `39542201349`](https://github.com/softm/bizhannun/actions/runs/39542201349)은 completed/success이며, Vercel 배포 `dpl_6kocPJjMKx5CXjjxAcva1WHVLLpN`의 READY 상태와 `bizhannun.vercel.app` 연결도 확인했습니다. 두 공개 앱 HTML이 참조하는 실제 module URL을 따라가 `blockLoginForProfileDraft`와 한국어 안내 문구가 양쪽 모두 포함된 것을 HTTP로 확인했습니다.

후속 `/api/config`와 `/api/health` 요청은 각각 HTTP 200을 반환했고 Pages origin의 CORS를 허용했습니다. 공개 설정은 Google·email의 `configured: true`, kakao·naver의 `configured: false`를 반환했습니다. 기관 상태는 국세청·공정위 모두 `configuration: missing_key`, `authentication: not_checked`였습니다. 제공자 설정 플래그를 실제 이메일·SNS 로그인 성공으로 해석하지 않습니다.

Vercel 환경변수 메타데이터에는 Production `AUTH_SESSION_SECRET`만 등록된 것을 재확인했습니다. 국세청·공정위 키, 카카오·네이버 앱 인증값, Firebase Admin 서비스 계정은 미설정 상태입니다. 이 확인은 비밀값 자체나 원천 서비스의 인증 성공을 검사한 결과가 아닙니다.

Vercel 별도 origin에서의 Google 로그인·계정 자료 조회·명시적 가져오기·로그아웃 후 기기 원본 복원을 확인했습니다. 기기와 계정의 테스트 사업체명은 모두 빈 값으로 정리 완료했습니다. 기존 저장 버전이나 기록 전체를 삭제한 것은 아닙니다. 확인 범위는 프로필 중심이며 실제 거래처의 사업자번호 중복 사례는 포함하지 않습니다. 이메일 가입·메일 수신, 카카오·네이버 실제 로그인, 다른 물리 기기, 다른 실제 계정의 분리는 아직 검증하지 않았습니다.

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
