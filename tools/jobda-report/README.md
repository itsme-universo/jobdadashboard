# JOBDA 행동 리포트 빌더

MongoDB(jobda)에 직접 접속해 정적 리포트 페이지를 생성합니다. 서버 불필요.

## 산출물
- `public/strategy/jobdabehavior/dailyarchive/<YYYY-MM-DD>/` — 그날까지 누적 행동 리포트
- `public/strategy/jobdabehavior/dailyarchive/` — 날짜 목록
- `public/strategy/jobdabehavior/campaigns/` — 마케팅 캠페인(9/9~) 유입→전환 스냅샷

## 실행
```
cd tools/jobda-report
npm install
MONGODB_PASSWORD=... node build.cjs
```

## 자동화
`.github/workflows/jobda-daily-report.yml` 가 매일 KST 08시 실행 → 변경분을 PR로 생성.
필요: 저장소 Secret `MONGODB_PASSWORD`, Atlas Network Access에 GitHub Actions IP 허용,
그리고 Settings→Actions→General→"Allow GitHub Actions to create and approve pull requests" ON.

## 원칙
집계 전용·개인 식별정보 미출력. 로켓 퍼널은 지원건(사용자×공고) 도달여부 monotonic,
최종 제출 = 크레딧 차감 실제값(유니크). 순 사용자 = tracking_user_daily_stat.userSn distinct.
