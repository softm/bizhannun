# GitHub Pages 직접 조회 운영 — 2026-10-21

사용자 요청에 따라 Vercel을 운영 호출 경로에서 제외했습니다.

| 기능 | 연결 경로 |
| --- | --- |
| 상태조회·등록정보 진위확인 | 브라우저 → api.odcloud.kr 국세청 API |
| Google·이메일 로그인 | 브라우저 → Firebase Authentication |
| 거래처·메모·사업 프로필·조회 기록 | 브라우저 → 기존 Firestore bizhannun DB |
| 사업자 공개 웹·등록자료·검색 후보 | GitHub Actions 수집 → 출처·동일성·시각을 포함한 Pages JSON |
| 지원사업 목록 | GitHub Actions 수집 → Pages JSON |
| 카카오·네이버 로그인 | 비활성 유지. 서버 Custom Token 발급은 별도 대안 필요 |
| 카카오 로컬·네이버 검색 | 정기 수집 어댑터 연결. 로그인과 별도 인증키 필요 |
| 공정위 통신판매업 | 별도 인증키 미등록으로 연결 대기 |

## 인증키 등록과 배포

1. https://github.com/softm/bizhannun/settings/secrets/actions/new 에서 Repository Secret `NTS_SERVICE_KEY`를 등록합니다.
2. 값에는 기존 공공데이터포털의 국세청 API 일반 인증키를 사용합니다. Decoding 키를 권장하며 Encoding 키도 한 번 디코딩해 사용합니다.
3. https://github.com/softm/bizhannun/actions/workflows/pages.yml 에서 Run workflow를 실행합니다. 소스 push와 매일 한국 시간 06:17 예약 실행도 배포합니다.
4. https://softm.github.io/bizhannun/#data 에서 직접 호출 표시와 키 설정 상태를 확인한 뒤 실제 사업자 상태조회로 확인합니다.

GitHub Secret은 저장소와 CI 로그에서 값을 숨기지만, 브라우저 직접 호출에 필요한 키는 빌드 시 dist/app-config.js에 포함됩니다. 배포 파일과 브라우저 네트워크 요청에서는 키가 보입니다. 사용자가 이 구조를 지정했습니다. dist와 로컬 환경파일은 git에 커밋하지 않습니다. Firebase Admin 개인키나 SNS Client Secret은 이 방식으로 주입하지 않습니다.

## 배포 동작

- CI에서 `NTS_SERVICE_KEY`가 없으면 빌드를 실패시켜, 정상 운영 중인 이전 배포를 인증키 없는 버전으로 교체하지 않습니다.
- Vercel 주소를 담은 기존 기기 설정은 직접 조회 모드에서 무시합니다.
- Firebase 공개 웹 설정은 config/firebase-public.json을 배포 설정에 포함합니다. 인증·Firestore 보안 규칙과 저장 데이터는 변경하지 않습니다.
- 기존 server/api/ 및 vercel.json은 과거 구현 및 테스트 호환용 소스입니다. Pages 빌드에 포함하지 않으며 운영에서 호출하지 않습니다.
- Vercel 프로젝트 자체는 삭제하지 않습니다. 새 Pages 배포 완료와 직접 조회 확인 후 필요하면 별도로 정리할 수 있습니다.

과거 문서의 Vercel 운영 환경변수·콜백 주소 안내보다 이 문서의 현재 운영 구성이 우선합니다.

## 사업자 통합정보 v0.4

공개 카탈로그를 한 번 읽어 조회·거래처 목록·상세에 연결합니다. `공개정보 보관`은 출처·값·확인 시각을 구조화해 현재 계정/기기에 저장하고, `내 사업으로 사용`은 검토 가능한 프로필 초안을 만듭니다. 사용자 이름·메모와 공개 사실은 별도로 유지합니다.

일별 수집에는 공개 웹, 고용·산재보험, 공정위, DART 기업개황, 금융위 기업기본정보, 네이버 뉴스·블로그·지역, 카카오 로컬 어댑터가 연결됩니다. 실제 인증키·활용승인·수집 가능 여부는 [사업자 통합정보 안내](BUSINESS_ENRICHMENT.md)와 데이터 현황을 확인하세요. 추가 수집 키는 Actions에서만 사용하며 Pages 빌드에 주입하지 않습니다.
