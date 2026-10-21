# Stitch 거래처 상세·변동 이력 원본

## 거래처 상세 정보 모달

- 프로젝트: **BizHannun Website Redesign**
- 프로젝트 ID: `12315243263796897623`
- 화면: **사업자한눈 - 거래처 상세 정보 모달**
- 화면 ID: `2915ce3088ef4a15bbe4f7e5f9fb7792`
- [Stitch 프로젝트](https://stitch.withgoogle.com/projects/12315243263796897623)
- [해당 화면 미리보기](https://stitch.withgoogle.com/preview/12315243263796897623?node-id=2915ce3088ef4a15bbe4f7e5f9fb7792&raw=1)
- 확보일: 2026-10-22 (한국시간)

## 확보한 파일

| 파일 | 내용과 획득 경로 |
| --- | --- |
| [partner-detail-original.html](partner-detail-original.html) | 선택한 화면의 렌더링 iframe `srcdoc`에서 확보한 원본 HTML. Stitch 미리보기에 삽입된 `data-stitch-injected` 스크립트·스타일만 제거했습니다. 디자인 코드와 탭 동작은 보존했습니다. |
| [partner-detail-original.jpg](partner-detail-original.jpg) | 정확히 지정된 화면의 Stitch 미리보기에서 촬영한 상단 화면. 브라우저 뷰포트에 보이는 범위이며 전체 세로 콘텐츠의 이미지 내보내기는 아닙니다. |
| [assets/profile-reference.png](assets/profile-reference.png) | 원본 HTML의 `Profile` 이미지 호스팅 URL에서 `curl -L`로 내려받은 참고 이미지. 운영 앱의 사용자 프로필로 사용하지 않습니다. |

이미지 다운로드에 사용한 URL:

```sh
curl -L --fail --output assets/profile-reference.png 'https://lh3.googleusercontent.com/aida/AEtjO1WrPSdlSgBjptj-0SfntGAUNWZk9Qu7F4HScLCSwDUk6LiM-AWMK6RoPa8nUg1dMNqrrnaPX298aBnV-rEmn_2_I0B1l2x63BfarvivxRHqntRiNlLSafY9nZ0HzdKOtGqAVdTihlYCLklKfA7zqQpM7opSCOIW3YtQx97Cp6zeB8kcfOz0HBGmA9L4GKMhyeWIlGcLC-2J9gT41hYJ7rSrecW8b-jZXZWixQ-4XbSGQgfnqvaQUxlTi2hk'
```

HTML의 Tailwind·글꼴 CDN 참조는 디자인 기록을 위해 그대로 남겼습니다. 이 디렉터리는 정적 배포에서 제외되며 운영 화면은 로컬 CSS와 SVG 아이콘을 사용합니다.

## 실제 기능으로 옮긴 기준

원본의 상호·번호·대표자·주소·과세 적격·신용 및 자동 알림 표시는 **디자인용 예시**입니다. 검증된 사업자 정보나 현재 운영 기능을 뜻하지 않습니다.

운영 구현은 짙은 녹색·세이지 배경, 기업 식별 헤더, 요약 카드, 탭, 고정 작업 푸터를 계승했습니다. 원본의 자동 알림·계좌 실명조회·세액공제 판정 같은 기능을 가상으로 연결하지 않고, 기존 앱이 확보한 상태 응답·공개자료·조회 이력·메모 저장으로 구성했습니다. 자세한 동작은 [거래처 상세 안내](../../BUSINESS_DETAIL.md)를 참고하세요.

## 변동 이력 Timeline 화면

- 프로젝트: **BizHannun Website Redesign**, `12315243263796897623`
- 화면: **사업자한눈 - 거래처 상세 모달 (변동 이력 Timeline)**
- 화면 ID: `80d49c165f484393942f1eebc0eb624f`
- [해당 화면 미리보기](https://stitch.withgoogle.com/preview/12315243263796897623?node-id=80d49c165f484393942f1eebc0eb624f&raw=1)
- 확보일: 2026-10-22 (한국시간)

| 파일 | 내용과 획득 경로 |
| --- | --- |
| [partner-timeline-original.html](partner-timeline-original.html) | 지정 화면의 미리보기 iframe `srcdoc`에서 확보한 HTML. `data-stitch-injected` 스크립트·스타일만 제거하고 원본 디자인 코드를 보존했습니다. |
| [partner-timeline-original.jpg](partner-timeline-original.jpg) | 지정 화면의 미리보기 배너를 닫은 뒤 촬영한 1440 × 635px 화면. 보이는 상단 범위이며 전체 스크롤 영역을 합성한 이미지는 아닙니다. |
| [partner-timeline-original-events.jpg](partner-timeline-original-events.jpg) | 원본 중단의 날짜순 이력과 주소 변경 전·후 카드 화면. |
| [partner-timeline-original-footer.jpg](partner-timeline-original-footer.jpg) | 원본 하단의 나머지 이력과 CSV·재대조·인쇄 작업 화면. 세 장은 동일 미리보기의 스크롤 위치별 캡처입니다. |
| [assets/profile-reference.png](assets/profile-reference.png) | Timeline HTML에도 같은 Profile 이미지 URL이 포함되어 있습니다. 위 `curl -L --fail` 명령으로 다시 다운로드하여 PNG 형식을 확인했습니다. |

Timeline 원본의 4개 요약 카드, 유형별 필터, 날짜순 세로 이력, 변경 전·후 비교, CSV 작업을 실제 기능에 반영합니다. 운영 타임라인은 저장한 국세청 상태 조회 응답을 기반으로 하며, **실제 상태 변경일이 아니라 조회에서 차이를 확인한 시점**을 표시합니다. 주소·대표자·업종의 과거 스냅샷, 납세 안전 판정, 세무대리 수임, 자동 대조, 법적 증명서 기능은 이 디자인의 예시입니다. 이 값들을 실제 이력으로 생성하지 않습니다.

HTML과 이미지는 디자인 참고자료로만 저장하며 정적 앱 빌드에는 포함하지 않습니다. 운영 화면은 외부 Tailwind·아이콘·프로필 이미지에 의존하지 않습니다.
