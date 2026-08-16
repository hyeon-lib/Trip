# Together Trip — Firebase 공동여행 웹앱

npm 설치 없이 실행되는 Firebase 기반 정적 웹앱입니다. 한 Firebase 프로젝트 안에서 여행을 계속 추가할 수 있습니다.

## 포함 기능
- 이메일/비밀번호 로그인, Google 로그인
- 여러 여행방 생성
- 6자리 방장 발급 초대코드로 동행자 참가
- Firestore 실시간 공동편집
- 일자별 여행 일정
- 추천 장소 공동 저장 + Google Maps 검색 연결
- Open-Meteo 실제 날씨
- 항공편/숙소 정보
- 공동비용/개인비용, 결제자 및 개인 사용자 드롭다운
- 실시간 환율 적용 지출 기록
- 분할 환전, 실제 평균 환전가, 환전 진행률
- 공동비 자동 분배 및 최소 송금 정산
- 준비물 공동 체크리스트
- 공동 메모
- 반응형 모바일 UI

## 1. Firebase 프로젝트 1개 만들기
Firebase Console에서 프로젝트를 하나 만듭니다. 여행마다 프로젝트를 새로 만들 필요가 없습니다.

## 2. 웹 앱 등록
프로젝트 설정 → 내 앱 → 웹(</>) 앱 추가 → Firebase 구성(firebaseConfig)을 복사합니다.
`firebase-config.js`의 값을 그대로 교체하세요.

## 3. Authentication 켜기
Authentication → Sign-in method에서 다음 제공업체를 활성화합니다.
- Email/Password
- Google (Google 로그인 버튼을 쓸 경우)

## 4. Firestore 만들기
Firestore Database → Create database → Standard edition으로 데이터베이스를 생성합니다.
위치는 한국 사용이 중심이면 가까운 리전을 선택하세요.

## 5. 보안 규칙 적용
Firestore → Rules에서 이 프로젝트의 `firestore.rules` 내용을 전부 붙여넣고 Publish 합니다.

## 6. 실행
이 앱은 ES Modules를 사용하므로 `index.html`을 파일 더블클릭(file://)으로 열지 말고 간단한 로컬 서버로 실행하세요.

Python이 있으면 프로젝트 폴더에서:
`python -m http.server 8080`

그 후 브라우저에서:
`http://localhost:8080`

VS Code가 있다면 Live Server 확장으로 `index.html`을 열어도 됩니다.

## 7. GitHub Pages 배포
GitHub 저장소에 파일 전체를 올립니다. Settings → Pages → Deploy from a branch → main / root를 선택합니다.
Firebase Console → Authentication → Settings → Authorized domains에 GitHub Pages 도메인을 추가하세요.

## Firestore 데이터 구조
- `users/{uid}`
- `trips/{tripId}` — 여행 기본정보, memberIds, members, 방장 발급 초대코드
- `invites/{code}` — 방장 발급 초대코드 → tripId 연결
- `trips/{tripId}/itinerary`
- `trips/{tripId}/places`
- `trips/{tripId}/flights`
- `trips/{tripId}/stays`
- `trips/{tripId}/expenses`
- `trips/{tripId}/exchanges`
- `trips/{tripId}/packing`
- `trips/{tripId}/memos`

## API
- Firebase Web SDK: 인증/Firestore/실시간 동기화
- Open-Meteo: 위치검색 및 실제 날씨 예보 (키 없이 사용 가능, 서비스 약관/표시 조건 확인)
- Frankfurter: 환율 조회
- Google Maps URL: 장소 검색 연결. 별도 키 없이 Maps 검색 페이지로 이동.

## 환전 계산 방식
환전할 때 실제 원화 사용액과 실제 받은 외화를 기록합니다.
`실제 평균 환전가 = 전체 원화 사용액 / 전체 외화 수령액`
JPY는 화면에서 보기 좋게 `100 JPY당 KRW` 형태로 표시합니다.

## 공동비 정산 방식
공동비는 기본적으로 현재 동행자 전체에 균등 분배합니다. 실제 결제자의 선지불액을 반영해 각자의 순잔액을 구한 뒤, 채무자와 채권자를 매칭해 필요한 송금 건수를 줄여 표시합니다.
개인비용은 `결제자`와 `실제 비용 사용자`를 각각 선택할 수 있어 대신 결제한 비용도 정산됩니다.

## 주의
Firebase 웹 설정의 apiKey는 클라이언트 앱 식별용 설정이며 서비스 계정 비밀키와 다릅니다. 보안은 Firestore Security Rules와 Authentication으로 제어해야 합니다. 서비스 계정 JSON/비밀키는 절대 이 폴더나 GitHub에 올리지 마세요.
