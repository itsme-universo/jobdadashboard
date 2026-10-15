// 면접연습 · 인재풀(매칭) 탭 집계 — 집계 전용, 개인 식별정보 미출력
const KST = '+09:00';
const START = '2026-08-27';
const kstDay = (f) => ({ $dateToString: { format: '%Y-%m-%d', date: f, timezone: KST } });
// tracking_log의 사용자 키는 userSn(로그인) — 비로그인은 세션 단위
const WHO = { $cond: [{ $gt: [{ $ifNull: ['$userSn', 0] }, 0] }, { $concat: ['u:', { $toString: '$userSn' }] }, { $concat: ['s:', { $ifNull: ['$sessionId', '?'] }] }] };
const flag = (cond) => ({ $max: { $cond: [cond, 1, 0] } });
const range = (until) => ({ $gte: new Date(START + 'T00:00:00+09:00'), $lte: new Date(until + 'T23:59:59.999+09:00') });
const agg = (c, p) => c.aggregate(p, { allowDiskUse: true }).toArray();
const DWELL_B = [0, 30000, 60000, 180000, 300000, 600000, 1e9];

async function buildInterview(db, until, bucketReferrer) {
  const ds = db.collection('tracking_daily_stat'), tl = db.collection('tracking_log');
  const T = { timestamp: range(until) };
  const IV = { $regex: '^(PASS_INTERVIEW|AGENT_INTERVIEW|MYPAGE_INTERVIEW)' };
  const sumIf = (cond) => ({ $sum: { $cond: [cond, '$count', 0] } });
  const isV = (r) => ({ $and: [{ $eq: ['$eventType', 'VISIT'] }, { $eq: ['$routeName', r] }] });
  const [daily, users, practice, referrers, dwell, linkage] = await Promise.all([
    agg(ds, [{ $match: { date: range(until), routeName: IV } }, { $group: { _id: kstDay('$date'),
      home: sumIf(isV('PASS_INTERVIEW')), start: sumIf(isV('PASS_INTERVIEW_START')), practice: sumIf(isV('PASS_INTERVIEW_PRACTICE')),
      history: sumIf(isV('PASS_INTERVIEW_HISTORY')), agent: sumIf({ $and: [{ $eq: ['$eventType', 'VISIT'] }, { $regexMatch: { input: '$routeName', regex: '^AGENT_INTERVIEW' } }] }),
      select: sumIf({ $eq: ['$eventTarget', 'INTERVIEW_QUESTION_SELECT'] }),
      homeUsers: { $sum: { $cond: [isV('PASS_INTERVIEW'), '$uniqueUsers', 0] } } } }, { $sort: { _id: 1 } }]),
    // 사람 단위 도달 여부 (기간 전체)
    agg(tl, [{ $match: { ...T, routeName: IV } }, { $group: { _id: WHO,
      home: flag({ $and: [{ $eq: ['$eventType', 'VISIT'] }, { $eq: ['$routeName', 'PASS_INTERVIEW'] }] }),
      start: flag({ $and: [{ $eq: ['$eventType', 'VISIT'] }, { $eq: ['$routeName', 'PASS_INTERVIEW_START'] }] }),
      select: flag({ $eq: ['$eventTarget', 'INTERVIEW_QUESTION_SELECT'] }),
      practice: flag({ $and: [{ $eq: ['$eventType', 'VISIT'] }, { $eq: ['$routeName', 'PASS_INTERVIEW_PRACTICE'] }] }),
      history: flag({ $and: [{ $eq: ['$eventType', 'VISIT'] }, { $eq: ['$routeName', 'PASS_INTERVIEW_HISTORY'] }] }) } },
      { $group: { _id: null, any: { $sum: 1 }, loggedIn: { $sum: { $cond: [{ $eq: [{ $substrCP: ['$_id', 0, 2] }, 'u:'] }, 1, 0] } },
        home: { $sum: '$home' }, start: { $sum: '$start' }, select: { $sum: '$select' }, practice: { $sum: '$practice' }, history: { $sum: '$history' },
        reach: { $sum: { $max: ['$select', '$practice'] } } } }]),
    // 실제 연습 건수 = interviewPracticeSn 유니크
    agg(tl, [{ $match: { ...T, routeName: 'PASS_INTERVIEW_PRACTICE', eventType: 'VISIT' } },
      { $project: { d: kstDay('$timestamp'), sn: { $arrayElemAt: [{ $split: [{ $arrayElemAt: [{ $split: [{ $ifNull: ['$fullUrl', ''] }, 'interviewPracticeSn='] }, 1] }, '&'] }, 0] } } },
      { $group: { _id: { d: '$d', sn: '$sn' } } }, { $group: { _id: '$_id.d', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    agg(tl, [{ $match: { ...T, routeName: { $in: ['PASS_INTERVIEW', 'PASS_INTERVIEW_START'] }, eventType: 'VISIT' } },
      { $group: { _id: { $arrayElemAt: [{ $split: [{ $ifNull: ['$referrer', ''] }, '?'] }, 0] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 150 }]),
    agg(tl, [{ $match: { ...T, routeName: 'PASS_INTERVIEW_PRACTICE', eventType: 'LEAVE', 'metadata.dwellMs': { $gte: 0 } } }, { $facet: {
      avg: [{ $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$metadata.dwellMs' } } }],
      b: [{ $bucket: { groupBy: '$metadata.dwellMs', boundaries: DWELL_B, default: -1, output: { n: { $sum: 1 } } } }] } }]),
    // 면접연습 사용자(로그인)의 다른 기능 이용
    agg(tl, [{ $match: { ...T, userSn: { $gt: 0 }, eventType: { $in: ['VISIT', 'COMPLETE'] } } }, { $group: { _id: '$userSn',
      iv: flag({ $eq: ['$feature', 'INTERVIEW'] }), acca: flag({ $eq: ['$feature', 'ASSESSMENT'] }), cm: flag({ $eq: ['$routeName', 'CAREER_MEMORY_SLUG'] }),
      match: flag({ $eq: ['$feature', 'MATCHING'] }), rocket: flag({ $eq: ['$eventTarget', 'ROCKET_SUBMIT'] }) } }, { $match: { iv: 1 } },
      { $group: { _id: null, iv: { $sum: 1 }, acca: { $sum: '$acca' }, cm: { $sum: '$cm' }, match: { $sum: '$match' }, rocket: { $sum: '$rocket' } } }]),
  ]);
  const pMap = Object.fromEntries(practice.map((r) => [r._id, r.n]));
  const buckets = new Map();
  for (const r of referrers) { const k = bucketReferrer(r._id || null); buckets.set(k, (buckets.get(k) || 0) + r.n); }
  const refs = [...buckets.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  const top = refs.slice(0, 10); const rest = refs.slice(10).reduce((s, r) => s + r.n, 0); if (rest) top.push({ name: '기타', n: rest });
  return { period: `${START} ~ ${until}`, daily: daily.map((r) => ({ ...r, sessions: pMap[r._id] || 0 })),
    users: users[0] || {}, referrers: top, dwell: { avgMs: dwell[0].avg[0]?.avg || 0, n: dwell[0].avg[0]?.n || 0, buckets: dwell[0].b },
    linkage: linkage[0] || { iv: 0 } };
}

// ---- 인재풀 (talent_pool_resume, 2026-10-15~) — 인재 분포. 개인정보 컬렉션이므로:
//  · 사람(userSn)당 최신 확정본 1건 기준 · 집계값만 반출 · 5명 미만 항목은 '기타'로 병합(k≥5)
//  · 전체 5명 미만이면 분포 자체를 내보내지 않음 · 학교/회사명·basicInfo(인적·병역)·자유서술은 집계 제외
const K_MIN = 5;
const EDU_RANK = { HIGHSCHOOL: 1, ASSOCIATE: 2, BACHELOR: 3, MASTER: 4, DOCTOR: 5 };
const EDU_KO = { 1: '고등학교', 2: '전문학사', 3: '학사', 4: '석사', 5: '박사', 0: '학력 미기재' };
const STATUS_KO = { GRADUATION: '졸업', ATTENDING: '재학', LEAVE: '휴학', EXPECTED: '졸업예정', DROP: '중퇴', COMPLETION: '수료' };
const LEVEL_KO = { BEGINNER: '초급', MIDDLE: '중급', PROFESSIONAL: '고급' };
const ACT_KO = { AWARD: '수상', EXTERNAL: '대외활동', EDUCATION: '교육', VOLUNTEER: '봉사', INTERNAL: '교내활동', CLUB: '동아리' };
const toDate = (s) => ({ $dateFromString: { dateString: { $cond: [{ $eq: [{ $strLenCP: { $ifNull: [s, ''] } }, 7] }, { $concat: [s, '-01'] }, s] }, onError: null, onNull: null } });
function kSafe(rows, map, k = K_MIN) {
  const out = []; let small = 0;
  for (const r of rows) { const name = (map && map[r._id]) || r._id; if (name == null || name === '') { small += r.n; continue; } if (r.n >= k) out.push({ name: String(name), n: r.n }); else small += r.n; }
  if (small >= k && small > 0) out.push({ name: '기타 (5명 미만 항목 합산)', n: small });
  return out;
}
async function buildTalentPool(db, kMin = K_MIN) {
  const col = db.collection('talent_pool_resume');
  const latest = [{ $match: { committedYn: true, userSn: { $gt: 0 } } }, { $sort: { createdDateTime: -1 } }, { $group: { _id: '$userSn', doc: { $first: '$document' }, at: { $first: '$createdDateTime' } } }];
  const countUnwind = (path, key, extra = []) => [{ $unwind: '$doc.' + path }, ...extra, { $group: { _id: { u: '$_id', v: key } } }, { $group: { _id: '$_id.v', n: { $sum: 1 } } }, { $sort: { n: -1 } }];
  const [meta] = await agg(col, [{ $match: { committedYn: true } }, { $facet: {
    docs: [{ $count: 'n' }], users: [{ $group: { _id: '$userSn' } }, { $count: 'n' }], positions: [{ $group: { _id: '$positionSn' } }, { $count: 'n' }],
    daily: [{ $group: { _id: kstDay('$createdDateTime'), docs: { $sum: 1 }, u: { $addToSet: '$userSn' } } }, { $project: { docs: 1, users: { $size: '$u' } } }, { $sort: { _id: 1 } }] } }]);
  const users = meta.users[0]?.n || 0;
  const base = { since: '2026-10-15', users, docs: meta.docs[0]?.n || 0, positions: meta.positions[0]?.n || 0, kMin: K_MIN };
  if (users < kMin) return { ...base, gated: true };   // 분포 미공개
  const rankExpr = { $max: { $map: { input: { $ifNull: ['$doc.educations', []] }, as: 'e', in: { $switch: { branches: Object.entries(EDU_RANK).map(([k, v]) => ({ case: { $eq: ['$$e.schoolType', k] }, then: v })), default: 0 } } } } };
  const ftMonths = { $sum: { $map: { input: { $filter: { input: { $ifNull: ['$doc.careers', []] }, as: 'c', cond: { $eq: ['$$c.employmentType', 'FULL_TIME'] } } }, as: 'c',
    in: { $max: [0, { $ifNull: [{ $dateDiff: { startDate: toDate('$$c.startDate'), endDate: { $ifNull: [toDate('$$c.endDate'), '$$NOW'] }, unit: 'month' } }, 0] }] } } } };
  const has = (p) => ({ $cond: [{ $gt: [{ $size: { $ifNull: ['$doc.' + p, []] } }, 0] }, 1, 0] });
  const [f] = await agg(col, [...latest, { $facet: {
    edu: [{ $group: { _id: { $ifNull: [rankExpr, 0] }, n: { $sum: 1 } } }, { $sort: { _id: -1 } }],
    eduStatus: countUnwind('educations', '$doc.educations.status'),
    career: [{ $project: { m: ftMonths } }, { $bucket: { groupBy: '$m', boundaries: [0, 1, 12, 36, 60, 120, 100000], default: 'x', output: { n: { $sum: 1 } } } }],
    intern: [{ $group: { _id: { $anyElementTrue: [{ $map: { input: { $ifNull: ['$doc.careers', []] }, as: 'c', in: { $eq: ['$$c.employmentType', 'INTERN'] } } }] }, n: { $sum: 1 } } }],
    jobTitle: countUnwind('careers', '$doc.careers.jobTitle.name'),
    skills: countUnwind('skills', '$doc.skills.skill.name'),
    skillLevel: countUnwind('skills', '$doc.skills.level'),
    licenses: countUnwind('licenses', '$doc.licenses.license.name'),
    langExams: countUnwind('languageExams', '$doc.languageExams.examination.name'),
    languages: countUnwind('languageSkills', '$doc.languageSkills.language'),
    activities: countUnwind('activities', '$doc.activities.type'),
    holding: [{ $group: { _id: null, n: { $sum: 1 }, careers: { $sum: has('careers') }, skills: { $sum: has('skills') }, licenses: { $sum: has('licenses') }, langExams: { $sum: has('languageExams') },
      projects: { $sum: has('projects') }, activities: { $sum: has('activities') }, attachments: { $sum: has('attachments') } } }],
  } }]);
  const CAREER_KO = { 0: '신입 (정규직 경력 없음)', 1: '1년 미만', 12: '1~3년', 36: '3~5년', 60: '5~10년', 120: '10년 이상' };
  const h = f.holding[0] || {}; const ks = (rows, map) => kSafe(rows, map, kMin);
  return { ...base, gated: false, daily: meta.daily,
    edu: ks(f.edu, EDU_KO), eduStatus: ks(f.eduStatus, STATUS_KO), career: ks(f.career, CAREER_KO),
    intern: ks(f.intern, { true: '인턴 경험 있음', false: '인턴 경험 없음' }), jobTitle: ks(f.jobTitle).slice(0, 15), skills: ks(f.skills).slice(0, 20),
    skillLevel: ks(f.skillLevel, LEVEL_KO), licenses: ks(f.licenses).slice(0, 15), langExams: ks(f.langExams).slice(0, 10), languages: ks(f.languages).slice(0, 10),
    activities: ks(f.activities, ACT_KO),
    holding: ['careers', 'skills', 'licenses', 'langExams', 'projects', 'activities', 'attachments'].map((k) => ({ key: k, n: h[k] >= kMin || h[k] === 0 ? h[k] : null, of: h.n })) };
}

module.exports = { buildInterview, buildTalentPool };
