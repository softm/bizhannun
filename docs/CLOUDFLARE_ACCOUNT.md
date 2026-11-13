# 사업자한눈 Cloudflare 공통 로그인 · 회원가입 (2026-11-13)

## 대상과 운영 주소
- 저장소: softm/bizhannun
- 서비스: https://softm.github.io/bizhannun/
- 공통 인증 Worker: https://softm-hannun-account.softm.workers.dev
- 계정 관리: https://softm-hannun-account.softm.workers.dev/account
- 사업자한눈의 Worker 앱 식별자: `bizhannun`. Cloudflare 계정 서버의 기본 허용 origin은 정확히 `https://softm.github.io`.
- 로그인은 신규 서버의 SNS OAuth 및 1회용 PKCE 연결 코드 방식으로 처리한다. API 토큰과 OAuth 비밀키는 GitHub Pages 저장소에 두지 않는다.

## UX
1. 상단 프로필 아이콘 → 로그인 / 회원가입. Google 또는 카카오 선택 후 제공자 인증과 신규 약관 동의(신규 가입 시) 완료.
2. 같은 아이콘에 SNS 프로필 이미지 또는 이름 첫 글자 표시. 계정 관리·로그아웃 제공.
3. 네이버는 인증 서버의 공개 승인 상태를 따른다. 승인 전에는 비활성화한다.
4. 브라우저 탭 내 Cloudflare 앱 세션은 1시간 유효하며, 서버 토큰은 sessionStorage에만 보관한다. 로그인 복귀 시 현재 탭의 세션을 확인한다.
5. 기존 Firebase 계정은 왼쪽 **이전 자료** 메뉴에 남겨 두고, 과거 공통 백업 화면은 https://softm.github.io/bizhannun/?legacyAccount=1#account 에서 명시적으로 접근한다.

## 데이터 안전 기준
- **이번 변경은 로그인·회원가입 UI 전환**이다. 기존 사업자한눈 Firebase 계정, Firestore 거래처·메모·프로필·이력, 기기 IndexedDB, 과거 공통 암호화 백업을 자동 병합·이동·삭제하지 않는다.
- Cloudflare 계정 UID가 기존 Firebase UID와 같다고 가정하지 않는다. 이메일이 같아도 임의 병합하지 않는다.
- 기존 업무용 자료는 현재의 로컬/Firebase 저장 경로를 그대로 사용한다. Cloudflare 인증만으로 새 서버에 거래처가 동기화된다고 표시하지 않는다.
- 추후 업무자료 Cloudflare 전환은 별도 D1 스키마·사용자 데이터 이관·충돌 방지·롤백 검증 후 진행한다.
- 비등록 origin, file://, Android appassets 환경에서는 인증 메뉴를 자동 활성화하지 않는다.

## 배포 후 확인
- [ ] GitHub Pages workflow 빌드 및 배포 완료
- [ ] 첫 방문: 상단 프로필 → 로그인 / 회원가입 열림
- [ ] Google 로그인 성공 후 프로필 사진/첫 글자 표시, 새로고침 시 탭 세션 유지
- [ ] 카카오 로그인 성공, 승인 대기 중인 네이버 버튼 상태 확인
- [ ] 로그아웃 시 프로필 아이콘 복구
- [ ] 이전 자료 탭에서 기존 Firebase 로그인 및 저장 이력 접근
- [ ] ?legacyAccount=1 에서 이전 공통 암호화 백업 접근
- [ ] 비로그인 사업자번호 조회, 거래처 추가·CSV 백업 및 새로고침 후 기기 기록 유지
- [ ] 다른 origin의 PKCE 로그인 연결은 거부됨
- [ ] 운영 SNS 실제 계정 검증 (테스트로 대체 불가)

배포 코드 검증과 OAuth 제공자 실계정 검증은 구분하여 기록한다.
