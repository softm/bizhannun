# 계정 로그인·Firestore·국세청 API 설정

사업자한눈은 로그인 인증과 업무 정보 저장을 함께 연결합니다. 로그인한 사용자의 Firebase UID를 기준으로 거래처·메모·사업 프로필·조회 이력에 접근하며, 비로그인 상태의 브라우저 자료는 별도 공간에 보관합니다.

## 운영 구성과 확인 링크

| 항목 | 주소·설정 |
| --- | --- |
| 사업자한눈 | [softm.github.io/bizhannun](https://softm.github.io/bizhannun/) |
| 계정 설정 응답 | [운영 `/api/config`](https://bizhannun.vercel.app/api/config) |
| 기관 API 설정 상태 | [운영 `/api/health`](https://bizhannun.vercel.app/api/health) |
| Firebase 프로젝트 | [`biz-hannun`](https://console.firebase.google.com/project/biz-hannun/overview), 표시 이름 Biz Hannun, Spark 플랜 |
| 로그인 제공자 | [Firebase Authentication](https://console.firebase.google.com/project/biz-hannun/authentication/providers) |
| Firestore | [Firebase Firestore](https://console.firebase.google.com/project/biz-hannun/firestore) · 데이터베이스 ID `bizhannun`, Enterprise Native, `asia-northeast3` |
| 서버 환경변수 | [Vercel bizhannun 환경변수](https://vercel.com/softms-projects/bizhannun/settings/environment-variables) |

`/api/config`의 `configured`는 웹 SDK 설정이 준비되었는지를, 각 `providers.*.configured`는 설정 파일·환경변수에 등록한 제공자 연결 조건을 뜻합니다. 실제 사용자의 로그인 성공이나 SNS 서비스 검수를 자동으로 확인하는 값은 아닙니다.

## 1. 구글·이메일 로그인

2026-10-21 한국 시간 기준으로 Firebase Console에서 Google·이메일/비밀번호 제공자를 활성화했습니다. Google의 공개 표시 이름은 `사업자한눈`이며, `softm.github.io`와 `bizhannun.vercel.app`를 승인된 도메인에 등록했습니다. 계정 분리 설정도 저장했습니다. 운영 Pages 앱에서 실제 Google 계정으로 로그인·로그아웃했고, 해당 UID의 Firestore 공간을 읽는 동작까지 확인했습니다. 이메일 가입·메일 전송과 카카오·네이버 실제 인증은 별도 검증 항목입니다.

1. Firebase Authentication에서 사용할 제공자를 활성화합니다. 구글은 지원 이메일 등 콘솔에서 요구하는 항목을 설정합니다.
2. Authentication의 승인된 도메인에 `softm.github.io`, `bizhannun.vercel.app`를 등록합니다. 프로토콜·경로·포트는 넣지 않습니다.
3. 로컬에서 실제 로그인을 검증할 때만 `localhost`, `127.0.0.1`을 추가합니다.
4. Authentication의 계정 연결 설정에서 **`ID 공급업체별로 여러 계정 만들기`**를 선택·저장합니다. 이 앱의 제공자별 계정 분리 정책에 필요한 설정입니다. 같은 이메일을 사용하더라도 서로 다른 로그인 제공자의 계정을 자동으로 합치지 않습니다.
5. 공개 웹 앱 설정은 `config/firebase-public.json`의 `firebase` 객체에 저장합니다. 이 파일에는 Firebase 웹 설정만 들어가며 서비스 계정 개인키·국세청 인증키·SNS Client Secret을 넣지 않습니다.
6. 활성화를 확인한 제공자만 같은 파일의 `providers.google.configured`, `providers.email.configured`를 `true`로 둡니다. 서버 환경변수 `FIREBASE_GOOGLE_ENABLED`, `FIREBASE_EMAIL_ENABLED`로 명시적으로 `true`/`false`를 지정할 수도 있습니다.

구글·이메일 로그인은 Firebase 웹 SDK가 처리합니다. Firebase 서버 개인키는 카카오·네이버의 Custom Token 발급에 필요하며 구글·이메일 로그인의 필수 조건은 아닙니다. 자료를 다시 불러올 때는 같은 로그인 제공자의 같은 계정을 사용합니다. 이 버전에는 서로 다른 제공자의 계정을 연결·병합하는 기능이 없습니다.

## 2. Firestore에 업무 정보 보관

Enterprise Native 데이터베이스 `bizhannun`은 `asia-northeast3`에 실시간 기능을 활성화하여 생성했고, Console에서 보안 규칙을 게시한 뒤 새 활성 버전을 확인했습니다. 게시한 규칙의 SHA-256은 `32b7854f24bd2a9f28ff7f34fce12730bdeb619a9127a9d69b8b2239c1a8479b`입니다. 공식 Enterprise 에뮬레이터에서 규칙 검사를 통과했으며, 운영 Google 계정의 프로필을 저장한 뒤 다시 불러와 revision 1을 확인했습니다. 저장 직후 확인 과정에서 발견한 충돌 안내 문제와 수정 검증 범위는 [검증 기록](VERIFICATION.md)에 남깁니다.

- 앱과 데이터베이스는 같은 Firebase 프로젝트를 사용합니다.
- 기본 연결 대상은 `bizhannun` 데이터베이스입니다. `(default)` 데이터베이스와 혼동하지 않도록 콘솔의 데이터베이스 선택기를 확인합니다.
- 저장 규칙은 로그인한 UID가 소유한 경로만 읽고 쓸 수 있도록 배포합니다. 테스트 모드의 전체 공개 읽기·쓰기를 사용하지 않습니다.
- 로그인 계정의 거래처·메모·프로필·조회 기록을 저장하고 다시 읽는 동작을 확인해야 연동 검증이 끝납니다. 로그인 성공만으로 데이터 보관까지 검증한 것으로 보지 않습니다.
- 기존 브라우저의 비로그인 자료는 사용자가 이전 기능을 실행했을 때 계정 자료로 가져옵니다. 사업자번호가 중복되면 계정의 기존 기록을 유지하고 기기의 원본도 보존합니다.
- 저장 실패·권한 오류·동기화 충돌이 발생하면 해당 상태를 표시합니다. 업로드되지 않은 자료를 서버에 저장된 것으로 표시하지 않습니다.

서버에서 다른 데이터베이스를 사용해야 하는 경우 `FIRESTORE_DATABASE_ID`, `FIRESTORE_EDITION`을 설정합니다. 변경 전에 기존 사용자 데이터의 위치와 마이그레이션을 확인합니다.

## 3. 카카오·네이버 로그인

두 방식은 해당 개발자 앱의 등록·키·콜백 설정이 필요합니다. 상세 절차와 보안 동작은 [SOCIAL_AUTH.md](SOCIAL_AUTH.md)를 참고합니다.

| 제공자 | 등록할 운영 콜백 |
| --- | --- |
| 카카오 | `https://bizhannun.vercel.app/api/auth?action=callback&provider=kakao` |
| 네이버 | `https://bizhannun.vercel.app/api/auth?action=callback&provider=naver` |

Vercel에는 `AUTH_SESSION_SECRET`, Firebase 서버 서비스 계정, `KAKAO_CLIENT_ID`·`KAKAO_CLIENT_SECRET`, `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`을 필요한 제공자 범위에 맞게 설정합니다. Firebase 서버 서비스 계정의 프로젝트는 웹 앱 설정의 `biz-hannun`과 일치해야 합니다.

현재 `AUTH_SESSION_SECRET`은 Production에 등록했습니다. Firebase Admin 서비스 계정과 카카오·네이버 앱 인증값은 아직 등록하지 않았으므로 해당 로그인은 설정 대기입니다. 설정이 끝나면 Production을 새로 배포하고 실제 제공자 인증과 자료 저장을 확인합니다.

## 4. “국세청 API 인증키가 설정되지 않았습니다” 해결

**공공데이터포털 활용신청과 앱 서버에 인증키를 등록하는 것은 별개의 단계입니다.** 이 메시지는 현재 실행 중인 API 서버가 `NTS_SERVICE_KEY` 또는 대체키 `DATA_GO_KR_SERVICE_KEY`를 읽지 못했다는 뜻입니다. 활용신청 승인 여부 자체를 조회한 결과가 아닙니다.

Vercel 서버의 국세청·공정위 인증키는 아직 등록하지 않았습니다. 아래 Production 환경변수 등록과 재배포가 필요합니다. 현재 API는 Vercel에서 실행하므로 이 키를 GitHub Secret에 추가할 필요는 없습니다.

1. [국세청 사업자등록정보 진위확인 및 상태조회 서비스](https://www.data.go.kr/data/15081808/openapi.do)에서 신청한 계정의 활용 상태와 발급된 인증키를 확인합니다.
2. [Vercel 환경변수 설정](https://vercel.com/softms-projects/bizhannun/settings/environment-variables)에서 `NTS_SERVICE_KEY`를 추가합니다. 값은 발급된 **일반 인증키(Decoding)**를 사용하고 Production 범위에 등록합니다. 이 구현은 디코딩 키와 퍼센트 인코딩된 키를 한 번만 인코딩하여 처리합니다.
3. 변수를 저장한 다음 `bizhannun` Production을 **재배포**합니다. 기존 배포는 새 환경변수를 자동으로 읽지 않을 수 있습니다.
4. [API 상태](https://bizhannun.vercel.app/api/health)에서 `providers.nts.configured`가 `true`인지 확인합니다. 여기까지는 키의 존재 여부만 확인한 것입니다.
5. 앱에서 조회 권한이 있는 실제 사업자번호로 조회합니다. 키를 읽을 수 있어도 활용 미승인·다른 API용 키·요청 한도·기관 오류라면 조회가 실패할 수 있으므로 실제 응답까지 확인합니다.

키는 채팅이나 공개 저장소, 브라우저의 API 서버 주소 입력란에 넣지 않습니다. `app-config.js`에는 공개 API 주소만 들어갑니다. 공정위 통신판매 조회는 별도 서비스 활용 조건과 `FTC_SERVICE_KEY`를 사용합니다.

## 5. 배포 후 확인 순서

| 순서 | 확인할 동작 |
| --- | --- |
| 1 | `/api/config`가 웹 설정과 제공자 상태를 정상 반환하는지 확인 |
| 2 | 실제 구글 또는 이메일 계정으로 로그인 후 로그아웃 확인 |
| 3 | 로그인 상태에서 테스트 거래처·메모·프로필 저장 후 새로고침으로 유지 확인 |
| 4 | 다른 브라우저에서 같은 제공자의 같은 계정으로 로그인해 서버 자료가 보이는지 확인 |
| 5 | 다른 계정에서는 앞 계정의 자료를 읽거나 변경하지 못하는지 확인 |
| 6 | 카카오·네이버 설정 후 각 제공자의 실제 로그인 및 취소·실패 동작 확인 |
| 7 | 국세청 키 등록·재배포 후 실제 조회 결과와 출처·조회 시각 확인 |

인증키가 없는 제공자는 연결 대기 상태로 남깁니다. 개발용 테스트 응답을 실제 로그인이나 실제 기관 조회 결과로 표시하지 않습니다.
