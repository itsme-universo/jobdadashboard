// 면접연습(커리어보드) · 인재풀 탭 집계 — 집계 전용, 개인 식별정보 미출력
const KST = '+09:00';
const START = '2026-08-27';
const kstDay = (f) => ({ $dateToString: { format: '%Y-%m-%d', date: f, timezone: KST } });
// tracking_log의 사용자 키는 userSn(로그인) — 비로그인은 세션 단위
const WHO = { $cond: [{ $gt: [{ $ifNull: ['$userSn', 0] }, 0] }, { $concat: ['u:', { $toString: '$userSn' }] }, { $concat: ['s:', { $ifNull: ['$sessionId', '?'] }] }] };
const flag = (cond) => ({ $max: { $cond: [cond, 1, 0] } });
const range = (until) => ({ $gte: new Date(START + 'T00:00:00+09:00'), $lte: new Date(until + 'T23:59:59.999+09:00') });
const agg = (c, p) => c.aggregate(p, { allowDiskUse: true }).toArray();
const DWELL_B = [0, 30000, 60000, 180000, 300000, 600000, 1e9];

// 면접연습 = 커리어보드 위저드(/career-board?ipStep=…, 2026-10-13~). 기준 = 토큰 사용.
//  토큰 사용 1건 = INTERVIEW_SET_CREATE COMPLETE(질문세트 생성 API 성공, 직전 INTERVIEW_START 클릭의 creditCost=1)
//  원본 tracking_log 기준이라 오늘(집계 시각까지) 포함. 사람 = userSn(비로그인은 세션).
const IV_SINCE = '2026-10-13';
const IV_ENTRY_KO = { home_banner: '홈 배너', acca_gate_banner: '역검 응시 화면 배너', acca_result_banner: '역검 결과 배너', gnb: '상단 메뉴(GNB)', welcome_credit: '웰컴 크레딧 팝업',
  memory_panel: '커리어보드 › 커리어메모리 패널', report_repractice: '리포트 → 다시 연습', widget_new: '커리어보드 › 면접 위젯(새로 시작)', widget_resume: '커리어보드 › 면접 위젯(이어하기)', shortcut: '커리어보드 › 바로가기 아이콘', mypage: '마이페이지 › 면접 연습 기록', hook: '서류합격 후킹', external: '외부 링크', internal: '내부 링크' };
const IV_TYPE_KO = { SELF_INTRODUCTION: '자기소개', JOB_FIT: '직무 적합', ONBOARDING: '온보딩(체험)' };
const IV_MODE_KO = { av: '영상(카메라·음성)', text: '텍스트', video: '영상 답변', audio: '음성 답변' };
const IV_INTERVIEWER_KO = { 'interviewer-3d-man-30': '3D 면접관 · 남 30대', 'interviewer-3d-man-40': '3D 면접관 · 남 40대', 'interviewer-3d-woman-30': '3D 면접관 · 여 30대', 'interviewer-3d-woman-40': '3D 면접관 · 여 40대' };
async function buildInterview(db) {
  const tl = db.collection('tracking_log');
  const since = new Date(IV_SINCE + 'T00:00:00+09:00');
  const T = { timestamp: { $gte: since } };
  const isCB = { routeName: 'CAREER_BOARD', feature: 'INTERVIEW' };
  const IVM = { ...T, $or: [isCB, { eventTarget: { $in: ['INTERVIEW_BANNER', 'INTERVIEW_ENTRY', 'INTERVIEW_SET_CREATE', 'INTERVIEW_START', 'INTERVIEW_SESSION_DONE', 'INTERVIEW_REPORT_CREATE', 'INTERVIEW_REPORT', 'INTERVIEW_VIDEO_ANALYSIS_DONE', 'MEMORY_SYNC_INTERVIEW', 'INTERVIEW_SETTING', 'INTERVIEW_ANSWER_SUBMIT', 'INTERVIEW_ATTEMPT_START'] } }] };
  const is = (e, t) => ({ $and: [{ $eq: ['$eventTarget', e] }, ...(t ? [{ $eq: ['$eventType', t] }] : [])] });
  const hourKey = { $dateToString: { format: '%Y-%m-%dT%H', date: '$timestamp', timezone: KST } };
  const [people, daily, hourly, entry, mix, perUser] = await Promise.all([
    agg(tl, [{ $match: IVM }, { $group: { _id: WHO,
      banner: flag(is('INTERVIEW_BANNER', 'VIEW')), click: flag(is('INTERVIEW_ENTRY', 'CLICK')),
      visit: flag({ $and: [{ $eq: ['$routeName', 'CAREER_BOARD'] }, { $eq: ['$feature', 'INTERVIEW'] }, { $eq: ['$eventType', 'VISIT'] }] }),
      setting: flag(is('INTERVIEW_SETTING')), token: flag(is('INTERVIEW_SET_CREATE', 'COMPLETE')), answer: flag(is('INTERVIEW_ANSWER_SUBMIT')),
      done: flag(is('INTERVIEW_SESSION_DONE')), report: flag(is('INTERVIEW_REPORT', 'VIEW')), memory: flag(is('MEMORY_SYNC_INTERVIEW')) } },
      { $group: { _id: null, banner: { $sum: '$banner' }, click: { $sum: '$click' }, visit: { $sum: '$visit' }, setting: { $sum: '$setting' }, token: { $sum: '$token' },
        answer: { $sum: '$answer' }, done: { $sum: '$done' }, report: { $sum: '$report' }, memory: { $sum: '$memory' } } }]),
    // 일별: 토큰 사용 건수·사용자, 면접 완료, 리포트 생성
    agg(tl, [{ $match: { ...T, eventTarget: { $in: ['INTERVIEW_SET_CREATE', 'INTERVIEW_SESSION_DONE', 'INTERVIEW_REPORT_CREATE', 'INTERVIEW_ENTRY'] } } },
      { $group: { _id: kstDay('$timestamp'), tokens: { $sum: { $cond: [is('INTERVIEW_SET_CREATE', 'COMPLETE'), 1, 0] } }, tu: { $addToSet: { $cond: [is('INTERVIEW_SET_CREATE', 'COMPLETE'), WHO, '$$REMOVE'] } },
        done: { $sum: { $cond: [is('INTERVIEW_SESSION_DONE'), 1, 0] } }, reports: { $sum: { $cond: [is('INTERVIEW_REPORT_CREATE'), 1, 0] } }, entries: { $sum: { $cond: [is('INTERVIEW_ENTRY', 'CLICK'), 1, 0] } } } },
      { $project: { tokens: 1, tokenUsers: { $size: '$tu' }, done: 1, reports: 1, entries: 1 } }, { $sort: { _id: 1 } }]),
    agg(tl, [{ $match: { ...T, eventTarget: 'INTERVIEW_SET_CREATE', eventType: 'COMPLETE' } }, { $group: { _id: hourKey, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    // 진입 채널별 노출→클릭
    agg(tl, [{ $match: { ...T, eventTarget: { $in: ['INTERVIEW_BANNER', 'INTERVIEW_ENTRY'] } } }, { $group: { _id: { e: '$eventTarget', ch: { $ifNull: ['$metadata.entry', '(미기재)'] } }, n: { $sum: 1 }, u: { $addToSet: WHO } } }, { $project: { n: 1, u: { $size: '$u' } } }]),
    // 토큰 사용 건 구성 (면접 유형·답변 방식·면접관·세트 종류)
    agg(tl, [{ $match: { ...T, eventTarget: { $in: ['INTERVIEW_ATTEMPT_START', 'INTERVIEW_SETTING', 'INTERVIEW_SET_CREATE', 'INTERVIEW_ANSWER_SUBMIT'] } } }, { $facet: {
      type: [{ $match: { eventTarget: 'INTERVIEW_ATTEMPT_START' } }, { $group: { _id: '$metadata.interviewType', n: { $sum: 1 } } }],
      mode: [{ $match: { eventTarget: 'INTERVIEW_SETTING' } }, { $group: { _id: '$metadata.mode', n: { $sum: 1 } } }],
      interviewer: [{ $match: { eventTarget: 'INTERVIEW_SETTING' } }, { $group: { _id: '$metadata.interviewer', n: { $sum: 1 } } }],
      setType: [{ $match: { eventTarget: 'INTERVIEW_SET_CREATE' } }, { $group: { _id: '$metadata.setType', n: { $sum: 1 } } }],
      answerMode: [{ $match: { eventTarget: 'INTERVIEW_ANSWER_SUBMIT' } }, { $group: { _id: '$metadata.answerMode', n: { $sum: 1 } } }] } }]),
    // 1인당 토큰 사용 분포
    agg(tl, [{ $match: { ...T, eventTarget: 'INTERVIEW_SET_CREATE', eventType: 'COMPLETE' } }, { $group: { _id: WHO, n: { $sum: 1 } } }, { $group: { _id: { $cond: [{ $gte: ['$n', 4] }, 4, '$n'] }, users: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  // 배너 외 진입 경로의 노출 — 정확(해당 요소 노출 이벤트) / 추정(그 요소가 있는 화면의 방문자, 상한)
  const P = (m) => [{ $match: m }, { $group: { _id: WHO } }, { $count: 'n' }];
  const [ex] = await agg(tl, [{ $match: { ...T, $or: [{ eventType: 'VISIT' }, { eventTarget: { $in: ['CREDIT_WELCOME', 'MEMORY_BANNER', 'INTERVIEW_REPORT'] }, eventType: 'VIEW' }] } }, { $facet: {
    gnb: P({ eventType: 'VISIT', timestamp: { $gte: new Date('2026-10-15T00:00:00+09:00') } }),
    welcome_credit: P({ eventTarget: 'CREDIT_WELCOME', eventType: 'VIEW' }),
    memory_panel: P({ eventTarget: 'MEMORY_BANNER', eventType: 'VIEW', 'metadata.state': 'filled' }),
    board: P({ routeName: 'CAREER_BOARD', eventType: 'VISIT' }),
    report_repractice: P({ eventTarget: 'INTERVIEW_REPORT', eventType: 'VIEW' }),
    mypage: P({ routeName: 'MYPAGE_INTERVIEW_HISTORY', eventType: 'VISIT' }),
  } }]);
  const exN = (k) => ex[k][0]?.n || 0;
  const EXPO = {
    gnb: { n: exN('gnb'), basis: '추정', how: '10/15 이후 잡다 웹 방문자 전체 (상단 메뉴는 모든 화면에 있음 · 상한)' },
    welcome_credit: { n: exN('welcome_credit'), basis: '정확', how: '웰컴 크레딧 팝업 노출(CREDIT_WELCOME VIEW)' },
    memory_panel: { n: exN('memory_panel'), basis: '정확', how: '커리어메모리 패널이 ‘채워짐’ 상태로 노출(MEMORY_BANNER VIEW, state=filled) — 이 상태에서만 면접연습 버튼이 보임' },
    widget_new: { n: exN('board'), basis: '추정', how: '커리어보드 방문자 (위젯은 기록 없는 사람에게 ‘새로 시작’ · 상한)' },
    widget_resume: { n: exN('board'), basis: '추정', how: '커리어보드 방문자 (위젯은 진행 중인 사람에게 ‘이어하기’ · 상한)' },
    shortcut: { n: exN('board'), basis: '추정', how: '커리어보드 방문자 (바로가기 아이콘 · 상한)' },
    report_repractice: { n: exN('report_repractice'), basis: '정확', how: '면접 리포트 화면 조회(INTERVIEW_REPORT VIEW)' },
    mypage: { n: exN('mypage'), basis: '정확', how: '마이페이지 › 면접 연습 기록 화면 방문' },
  };
  const ent = {}; for (const r of entry) { const k = r._id.ch; (ent[k] ??= { ch: k, name: IV_ENTRY_KO[k] || k, views: 0, viewUsers: 0, clicks: 0, clickUsers: 0 });
    if (r._id.e === 'INTERVIEW_BANNER') { ent[k].views = r.n; ent[k].viewUsers = r.u; } else { ent[k].clicks = r.n; ent[k].clickUsers = r.u; } }
  const m = mix[0]; const lab = (rows, map) => rows.map((r) => ({ name: map[r._id] || r._id || '(미기재)', n: r.n })).sort((a, b) => b.n - a.n);
  const totals = daily.reduce((a, r) => ({ tokens: a.tokens + r.tokens, done: a.done + r.done, reports: a.reports + r.reports }), { tokens: 0, done: 0, reports: 0 });
  const hours = {}; for (const r of hourly) { const [d, h] = r._id.split('T'); (hours[d] ??= Array(24).fill(0))[+h] = r.n; }
  return { since: IV_SINCE, asOf: new Date().toISOString(), people: people[0] || {}, totals, daily, hours,
    entry: Object.values(ent).map((e) => { if (e.viewUsers) return { ...e, basis: '정확', how: '배너 노출(INTERVIEW_BANNER VIEW)' }; const x = EXPO[e.ch]; return x ? { ...e, viewUsers: x.n, basis: x.basis, how: x.how } : { ...e, basis: null, how: '노출 이벤트 없음' }; }).sort((a, b) => (b.clicks - a.clicks) || (b.views - a.views)),
    mix: { type: lab(m.type, IV_TYPE_KO), mode: lab(m.mode, IV_MODE_KO), interviewer: lab(m.interviewer, IV_INTERVIEWER_KO), setType: lab(m.setType, { normal: '일반 세트', follow_up: '꼬리질문 세트' }), answerMode: lab(m.answerMode, IV_MODE_KO) },
    perUser: perUser.map((r) => ({ name: r._id >= 4 ? '4회 이상' : r._id + '회', n: r.users })) };
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
