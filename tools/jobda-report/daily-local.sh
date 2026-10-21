#!/usr/bin/env bash
# 로컬(사내망) 일별 갱신: 최신 main 받기 → 빌드 → 변경 있으면 커밋·푸시 (Vercel이 main 푸시를 자동 배포)
# DB가 사내망 전용 주소라 GitHub Actions에서는 접속이 안 됨 → 사내 PC의 작업 스케줄러가 매일 10:00 실행
set -euo pipefail
cd "$(dirname "$0")/../.."
LOG=tools/jobda-report/daily-local.log
exec >>"$LOG" 2>&1
echo "=== $(date '+%F %T') 시작"
git pull --ff-only origin main
cd tools/jobda-report
[ -d node_modules ] || npm install --no-audit --no-fund
set -a; . ./.env.local; set +a
node build.cjs
cd ../..
git add index.html strategy/jobdabehavior
if git diff --cached --quiet; then echo "변경 없음"
else
  git commit -m "data: $(date -d yesterday +%m/%d)까지 리포트 자동 갱신"
  git push origin main
fi
echo "=== $(date '+%F %T') 완료"
