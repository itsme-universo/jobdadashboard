# JOBDA 행동 대시보드 (jobdadashboard)

MongoDB(jobda) 행동 데이터를 집계해 정적 HTML로 서빙하는 대시보드. 집계 전용·개인정보 없음.

## 페이지
- `/strategy/jobdabehavior/dailyarchive/` — 일별 누적 행동 리포트 (월간 요약·기간 필터·용어 툴팁)
- `/strategy/jobdabehavior/campaigns/` — 마케팅 캠페인 유입→전환 (발송 규모·CTR·유입 학교)

## 브랜치
- `main` — 배포본
- `develop` — 작업 브랜치

## 생성/갱신
```
cd tools/jobda-report && npm install
MONGODB_PASSWORD=... node build.cjs   # strategy/jobdabehavior/ 아래 재생성
```

## 자동화
`.github/workflows/jobda-daily-report.yml` — 매일 KST 08시 실행 → 변경분을 PR로 생성.
필요: 저장소 Secret `MONGODB_PASSWORD`, Atlas Network Access에 GitHub Actions IP 허용,
Settings→Actions→General→"Allow GitHub Actions to create and approve pull requests" ON.

## 원칙
집계 전용·개인 식별정보 미출력. 로켓 퍼널 monotonic·최종 제출=크레딧 차감 실제값(유니크).
순 사용자=tracking_user_daily_stat.userSn distinct.
