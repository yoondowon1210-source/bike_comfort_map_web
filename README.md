# 🚲 서울 자전거 편의 지도 (웹 버전)

네이버·구글 지도처럼 쓰는 자전거 경로 웹페이지.
경로 계산을 브라우저에서 바로 해서 서버가 필요 없고, 반응이 즉각적이에요.

## 파일 구성
```
index.html   화면 뼈대
style.css    디자인
app.js       화면 동작 (검색, 지도, 카드, 탭)
engine.js    경로 계산 (다익스트라)
config.js    설정 (피드백 링크, 예시 경로) ← 고칠 일 있으면 여기만
vendor/      지도 라이브러리 (MapLibre, deck.gl)
data/
  graph.bin.gz  서울 도로망 + 점수 (약 6MB)
  names.json    도로 이름
  places.json   장소 검색용 장소
```

## 올리는 방법 (GitHub Pages, 무료)
1. GitHub에서 **새 저장소(Public)** 를 만들어요. 예: `bike-map`
2. **uploading an existing file** 을 누르고, 이 폴더 **안의 내용물 전부**(파일 6개 + `vendor`, `data` 폴더)를 끌어다 놓은 뒤 **Commit changes** 를 눌러요.
3. 저장소 **Settings → Pages** 로 가서 **Branch** 를 `main`, 폴더를 `/ (root)` 로 고르고 **Save** 를 눌러요.
4. 1~2분 뒤 같은 화면 위쪽에 주소가 떠요: `https://아이디.github.io/저장소이름/`

수정할 때는 바뀐 파일만 다시 올리면 1분 안에 반영돼요.

## 점수와 경로
- 편안함 점수 = 경사 35% + 도로 유형 30% + 교통(차로·속도) 15% + 포장 10% + 터널·통로 10%
- 경로 비용 = 예상 시간 × (1 + 4 × 편안함 비중 × 불편도)
- 🌿 가장 편한 경로(비중 200%) · ⭐ 내 경로(슬라이더, 기본 70%) · ⚡ 최단 시간 경로(0%)

## 주의
주행 중 조작 금지. 출발 전 경로 숙지용입니다.
지도 배경: OpenFreeMap / © OpenStreetMap 기여자
