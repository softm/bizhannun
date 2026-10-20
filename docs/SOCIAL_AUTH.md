# 카카오·네이버 로그인 설정

카카오·네이버 로그인은 제공자의 OAuth 승인 코드와 사용자 프로필을 서버에서 확인한 뒤 Firebase Custom Token으로 앱에 로그인합니다. 버튼 표시만 구현한 흐름이 아니며, 로그인 이후의 업무 자료는 Firebase UID별 Firestore 공간에 저장합니다. 실제 제공자 앱과 서버 인증값을 등록해야 운영 로그인이 활성화됩니다.

## 운영 경로

| 제공자 | 개발자 콘솔에 등록할 정확한 콜백 |
| --- | --- |
| 카카오 | `https://bizhannun.vercel.app/api/auth?action=callback&provider=kakao` |
| 네이버 | `https://bizhannun.vercel.app/api/auth?action=callback&provider=naver` |

서비스 화면은 `https://softm.github.io/bizhannun/`, 서비스 origin은 `https://softm.github.io`입니다. OAuth 콜백은 Vercel 서버에서 실행합니다. 콜백의 쿼리 문자열도 등록 주소에 포함합니다.

## 카카오

1. [Kakao Developers](https://developers.kakao.com/)에서 서비스 앱을 등록하고 카카오 로그인을 활성화합니다.
2. 웹 서비스 도메인과 위 콜백을 앱 설정에 등록합니다. 화면 표시·동의 항목·사용 가능한 사용자 범위 등은 실제 서비스 등록 상태에 맞게 설정합니다.
3. 앱의 REST API 키를 `KAKAO_CLIENT_ID`로 사용합니다. JavaScript 키나 Admin 키를 사용하지 않습니다.
4. Client Secret을 활성화하고 `KAKAO_CLIENT_SECRET`에 등록합니다. 이 구현은 Client Secret이 준비된 경우에만 카카오를 구성 완료로 표시합니다.
5. 실제 사용자 로그인, 사용자 취소, 미동의 상태를 운영 도메인에서 확인합니다. 닉네임은 제공 동의 범위에 따라 생략될 수 있으며 계정 식별에는 서버가 받은 서비스 사용자 ID를 사용합니다.

프로토콜은 [카카오 로그인 REST API 공식 문서](https://developers.kakao.com/docs/latest/ko/kakaologin/rest-api)를 따릅니다.

## 네이버

1. [NAVER Developers](https://developers.naver.com/)에서 네이버 로그인 앱을 등록합니다.
2. 실제 서비스 URL과 위 콜백을 등록하고 서비스 공개에 필요한 검수·동의 항목을 설정합니다. 개발 중 접근 가능한 테스트 계정 범위는 앱 설정을 확인합니다.
3. 발급받은 Client ID와 Client Secret을 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`에 등록합니다.
4. 운영 도메인에서 실제 로그인·취소·잘못된 상태 요청을 확인합니다.

서버는 [네이버 로그인 API](https://developers.naver.com/docs/login/api/api.md)로 토큰을 교환하고 [회원 프로필 조회 API](https://developers.naver.com/docs/login/profile/profile.md)의 성공 코드와 앱별 사용자 ID를 확인합니다. 브라우저가 보내는 사용자 ID·이메일은 신뢰하지 않습니다.

## Vercel 서버 설정

| 변수 | 용도 |
| --- | --- |
| `AUTH_PUBLIC_ORIGIN` | `https://bizhannun.vercel.app`; 경로·마지막 슬래시 없이 정확한 origin |
| `AUTH_SESSION_SECRET` | OAuth 상태 쿠키 서명용 무작위 값, 최소 32자 |
| `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET` | 카카오 앱 REST API 키와 활성화한 Client Secret |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 네이버 앱 Client ID와 Client Secret |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Custom Token 발급용 서버 서비스 계정 JSON |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | 위 JSON 대신 사용할 수 있는 서비스 계정의 개별 값 |
| `ALLOWED_ORIGINS` | 기본 Pages·운영 origin 외에 명시적으로 허용할 웹 origin |

서비스 계정 프로젝트는 공개 웹 앱의 `biz-hannun`과 일치해야 합니다. JSON 변수와 개별 변수 방식 중 하나를 사용합니다. 개인키의 실제 줄바꿈과 `\n` 표기를 모두 처리합니다. 서버 서비스 계정은 브라우저 SDK 설정에 넣지 않습니다. Firebase 공식 [Custom Token 생성 문서](https://firebase.google.com/docs/auth/admin/create-custom-tokens)를 참고합니다.

2026-10-21 한국 시간 기준으로 `AUTH_SESSION_SECRET`은 Vercel Production에 민감 환경변수로 등록했습니다. 카카오·네이버 앱 인증값과 Firebase Admin 서비스 계정은 아직 등록하지 않았습니다. 비밀값 등록 후 새 Production 배포가 필요합니다. 실제 토큰 교환·Firebase 로그인 성공은 별도 검증 대상입니다.

## 앱과 서버의 인터페이스

앱은 사용자 클릭으로 팝업을 연 뒤 `/api/auth?action=start&provider=kakao|naver&returnOrigin=...&nonce=...`로 이동합니다. `returnOrigin`은 정확히 허용된 origin이어야 하고 `nonce`는 브라우저에서 생성한 무작위 base64url 문자열 22~128자입니다.

서버는 10분 유효한 서명 상태를 `HttpOnly; SameSite=Lax` 쿠키에 보관합니다. HTTPS에서는 `Secure`와 `__Host-` 접두어를 적용합니다. 쿠키·응답 state·제공자·만료·return origin을 확인한 뒤 서버가 토큰과 프로필을 조회합니다. 같은 제공자의 새 로그인 시작은 그 브라우저에서 이전 대기 요청을 대체합니다.

검증에 성공한 콜백은 정확한 opener origin에 다음 메시지를 전달합니다.

```js
{ type: 'bizhannun:oauth', provider: 'kakao', nonce: '원래 브라우저 nonce', customToken: 'Firebase Custom Token' }
```

실패는 `customToken` 대신 `{ error: { code, message } }`를 보냅니다. 클라이언트는 메시지 origin·source 창·nonce·provider를 모두 확인하고 Firebase `signInWithCustomToken`을 실행합니다. OAuth access/refresh token은 서버에서만 사용하며 클라이언트로 보내지 않습니다. Custom Token을 URL·쿼리·로그에 넣지 않습니다. 콜백은 자체 nonce 기반 CSP를 적용하고 query가 포함된 주소를 브라우저 기록에서 치웁니다.

카카오·네이버 UID는 제공자 이름과 제공자 사용자 ID의 SHA-256을 조합합니다. 이메일을 계정 연결 기준으로 사용하지 않고, 다른 SNS 계정이나 구글·이메일 계정과 자동으로 병합하지 않습니다. 다른 기기에서도 **같은 로그인 제공자의 같은 계정**을 사용해야 동일한 자료를 불러옵니다. Firebase Authentication Console의 **`ID 공급업체별로 여러 계정 만들기`** 설정을 유지합니다.

시작 요청 제한과 이미 소비한 state의 추가 검사는 서버 인스턴스 메모리 범위입니다. 분산된 전역 제한이나 영구 세션 저장소라고 주장하지 않습니다. 제공자가 발급한 승인 코드는 한 번 교환하는 흐름을 사용하며, 처리 후 상태 쿠키를 삭제합니다.

## 검증 범위

`tests/social-auth.test.mjs`는 origin 위조, nonce 오류, state 불일치·만료·쿠키 변조·중복, 제공자 혼동, 취소, 토큰·프로필 실패, 크기 제한, Custom Token 발급 실패, 비밀값 미노출을 검사합니다. 서버 fixture 테스트는 실제 카카오·네이버 계정 로그인을 대신하지 않습니다. 환경설정과 배포 후 [AUTH_SETUP.md](AUTH_SETUP.md)의 계정 저장·재조회 절차까지 확인합니다.
