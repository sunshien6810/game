# KBO Play Beta v31

서비스 기획서 기준 구조 개편 버전입니다.

## 주요 반영
- 홈: 나의 상태 → 오늘 경기 → 승부 예측 → 참여 메뉴
- Play: 승부 예측 요약만 제공
- Play+: 상세 승부 예측 열기/접기
- Bingo: 압축형 승부 예측 유지
- Mission Tray: 타자형 / 투수형 / 균형형 / AI Pick / 내맘대로
- AI Pick: Play+ 전용, 바로 적용 가능
- 기존 Bingo, Hero/Horror, Live, Ranking 및 실 API 연동 유지

## API
- 경기 정보: GET /kbo/game/gamebutton
- 승부 예측: POST /spotv_data/kbo/data/win_probability
