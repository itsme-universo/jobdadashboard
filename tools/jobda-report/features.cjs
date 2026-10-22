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

// ---- 면접연습 설문 (survey · survey_answer, 2026-10-16~) — 이탈 사유 · 완료 만족도 · 라이브 사전 신청
//  survey_answer는 문항 1행 → submissionId로 묶어 응답 1회. userSn 미반출 · 자유서술은 원문 대신 건수만.
//  응답률 분모: 이탈 = 연습 화면(표지·준비·카운트다운·연습 중)에서 '나가기 확정'(INTERVIEW_LEAVE). 설정 단계(1~5)에선 설문이 뜨지 않음
//             완료 = 면접 완료(INTERVIEW_SESSION_DONE). 둘 다 설문 시작 시각(첫 응답) 이후만 센다.
const SV_KEYS = { INTERVIEW_3D_EXIT: ['exit', '3d'], INTERVIEW_LIVE_EXIT: ['exit', 'live'], INTERVIEW_3D_COMPLETE: ['complete', '3d'], INTERVIEW_LIVE_COMPLETE: ['complete', 'live'], LIVE_INTERVIEW_PRE_REGISTRATION: ['pre', 'live'] };
// 척도 문항은 문구로 식별 (3D/라이브 설문이 문항 id를 따로 가짐)
const SV_SCALE = [['burden', '부담'], ['realism', '실제 면접처럼'], ['report', '강점과 약점'], ['intent', '질문 의도'], ['nps', '추천']];
const scaleKey = (q) => (SV_SCALE.find(([, w]) => (q || '').includes(w)) || [])[0];
async function buildSurvey(db) {
  const keys = Object.keys(SV_KEYS);
  const [defs, rows] = await Promise.all([
    db.collection('survey').find({ surveyKey: { $in: keys } }, { projection: { _id: 0, surveyKey: 1, questionList: 1 } }).toArray(),
    agg(db.collection('survey_answer'), [{ $match: { surveyKey: { $in: keys } } }, { $sort: { createdDateTime: 1 } }, { $project: { _id: 0, k: '$surveyKey', sub: '$submissionId', q: '$questionContent', sk: '$skipped',
      step: '$context.exitStep', score: '$answer.score', opts: '$answer.optionList.optionKey', text: { $gt: [{ $strLenCP: { $ifNull: ['$answer.text', ''] } }, 0] }, d: kstDay('$createdDateTime'), t: '$createdDateTime' } }]),
  ]);
  const since = rows.length ? rows[0].t : new Date();
  const tl = db.collection('tracking_log'), T = { timestamp: { $gte: since, $lte: new Date() } }; // 상한: 시계가 틀린 기기의 미래 시각 로그 제외
  const [leave, done] = await Promise.all([
    agg(tl, [{ $match: { ...T, eventTarget: 'INTERVIEW_LEAVE' } }, { $group: { _id: { d: kstDay('$timestamp'), s: { $cond: [{ $eq: [{ $type: '$metadata.step' }, 'string'] }, { $toUpper: '$metadata.step' }, 'SETUP'] } }, n: { $sum: 1 } } }]),
    agg(tl, [{ $match: { ...T, eventTarget: 'INTERVIEW_SESSION_DONE' } }, { $group: { _id: kstDay('$timestamp'), n: { $sum: 1 } } }]),
  ]);
  // daily[d] = { leave:{단계:n}, done, 'exit:3d':{n,r,st,text}, 'complete:3d':{n,sc,chip,text}, 'pre:live':{n,o} ... }
  const daily = {}, day = (d) => (daily[d] ??= { leave: {}, done: 0 });
  const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  for (const r of leave) inc(day(r._id.d).leave, r._id.s, r.n);
  for (const r of done) day(r._id).done = r.n;
  const subs = new Map(); for (const r of rows) { const s = subs.get(r.sub) || { k: r.k, d: r.d, rows: [] }; s.rows.push(r); subs.set(r.sub, s); }
  for (const s of subs.values()) {
    const [kind, v] = SV_KEYS[s.k], g = (day(s.d)[kind + ':' + v] ??= { n: 0, text: 0 });
    g.n++; g.text += s.rows.filter((r) => r.text).length;
    if (kind === 'exit') { const r = s.rows[0], o = (!r.sk && r.opts && r.opts[0]) || 'NO_ANSWER', st = r.step || 'UNKNOWN';
      inc(g.r ??= {}, o); inc((g.st ??= {})[st] ??= {}, o); }
    else if (kind === 'complete') for (const r of s.rows) { if (r.sk) continue; const sk = scaleKey(r.q);
      if (r.score != null && sk) inc((g.sc ??= {})[sk] ??= {}, r.score); else for (const o of r.opts || []) inc(g.chip ??= {}, o); }
    else for (const r of s.rows) for (const o of r.opts || []) inc(g.o ??= {}, o);
  }
  // 선택지·척도 문항 라벨 (설문 정의 기준)
  const labels = { exit: {}, chip: {}, pre: {}, scales: {} };
  for (const d of defs) { const [kind] = SV_KEYS[d.surveyKey];
    for (const q of d.questionList || []) {
      const sk = q.answerType === 'SCALE' && scaleKey(q.content);
      if (sk) labels.scales[sk] ??= { q: q.content, min: q.scaleMin, max: q.scaleMax };
      else for (const o of q.optionList || []) labels[kind === 'complete' ? 'chip' : kind][o.optionKey] ??= o.content;
    } }
  labels.exit.NO_ANSWER = '응답 안 함';
  return { since: since.toISOString(), asOf: new Date().toISOString(), daily, labels };
}

// ---- 면접연습 질문 설계 (질문별 이탈 · 답변 시간 · 완료) — 세트(assignmentSetSn) 단위
//  대상: [from, to] KST에 만든 세트(INTERVIEW_SET_CREATE COMPLETE). 완료 여부는 집계 시각까지의 기록으로 판단(이어하기로 나중에 끝낸 것도 완료)
//  시작 = 첫 질문 노출(INTERVIEW_QUESTION) · 완료 = 결과표 생성 요청(INTERVIEW_REPORT_CREATE) · 진행 = 제출한 답변 수(ANSWER_SUBMIT COMPLETE)
//  답변의 질문 유형 = 답변 시작 시각(제출 시각 − answerMs) 직전에 뜬 질문. qIndex는 다음 질문 번호로 찍히는 경우가 섞여 쓰지 않음
//  사내 추정 계정 제외: 10/14 이후 서로 다른 계정 IV_INTERNAL_MIN명 이상이 세트를 만든 IP를 사내로 보고, 그 IP로 면접 이벤트를 남긴 계정 전부
//   (면접 이벤트 전체로 세면 통신사 공용 IP까지 걸려 수백 명이 빠짐)
const IV_POS = ['자기소개', '직무 질문 1', '꼬리 질문 1', '직무 질문 2', '꼬리 질문 2', '직무 질문 3', '꼬리 질문 3', '직무 질문 4', '꼬리 질문 4'];
const IV_QTYPE = { self_intro: '자기소개', job: '직무 질문', follow_up: '꼬리 질문', onboarding: '온보딩 질문' };
const IV_INTERNAL_MIN = 5;
const quant = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * p) - 1)]; }; // 최근접 순위
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10), r3 = (x) => Math.round(x * 1000) / 1000;
async function buildIvDesign(db, { from = '2026-10-15', to, cutoff = new Date(), internalMin = IV_INTERNAL_MIN } = {}) {
  const tl = db.collection('tracking_log');
  const T = { $gte: new Date(from + 'T00:00:00+09:00'), $lte: new Date(to + 'T23:59:59.999+09:00') };
  // 사내 추정 계정
  const since14 = { $gte: new Date('2026-10-14T00:00:00+09:00'), $lte: cutoff };
  const ips = (await agg(tl, [{ $match: { timestamp: since14, eventTarget: 'INTERVIEW_SET_CREATE', eventType: 'COMPLETE', userSn: { $gt: 0 } } },
    { $group: { _id: '$clientIp', u: { $addToSet: '$userSn' } } }, { $match: { $expr: { $gte: [{ $size: '$u' }, internalMin] } } }])).map((r) => r._id);
  const internal = new Set(ips.length ? (await agg(tl, [{ $match: { timestamp: since14, clientIp: { $in: ips }, eventTarget: { $regex: '^INTERVIEW_' }, userSn: { $gt: 0 } } }, { $group: { _id: '$userSn' } }])).map((r) => r._id) : []);
  const sets = (await agg(tl, [{ $match: { timestamp: T, eventTarget: 'INTERVIEW_SET_CREATE', eventType: 'COMPLETE', 'metadata.assignmentSetSn': { $ne: null } } },
    { $project: { _id: 0, sn: '$metadata.assignmentSetSn', u: '$userSn', flow: '$metadata.flow', qc: '$metadata.questionCount', t: '$timestamp' } }])).filter((s) => !internal.has(s.u));
  const bySn = new Map(sets.map((s) => [s.sn, { ...s, q: [], a: [], retry: [], start: null, report: false, resume: false }]));
  const ev = await agg(tl, [{ $match: { timestamp: { $gte: T.$gte, $lte: cutoff }, 'metadata.assignmentSetSn': { $in: [...bySn.keys()] },
    eventTarget: { $in: ['INTERVIEW_QUESTION', 'INTERVIEW_ANSWER_SUBMIT', 'INTERVIEW_ANSWER_RETRY', 'INTERVIEW_REPORT_CREATE', 'INTERVIEW_ATTEMPT_START', 'INTERVIEW_RESUME'] } } },
    { $project: { _id: 0, sn: '$metadata.assignmentSetSn', e: '$eventTarget', y: '$eventType', t: '$timestamp', qt: '$metadata.questionType', ms: '$metadata.answerMs', to: '$metadata.timedOut', mode: '$metadata.answerMode' } }, { $sort: { t: 1 } }]);
  for (const x of ev) { const s = bySn.get(x.sn); if (!s) continue;
    if (x.e === 'INTERVIEW_QUESTION') s.q.push({ t: x.t, qt: x.qt });
    else if (x.e === 'INTERVIEW_ANSWER_SUBMIT' && x.y === 'COMPLETE') s.a.push(x);
    else if (x.e === 'INTERVIEW_ANSWER_RETRY') s.retry.push(x);
    else if (x.e === 'INTERVIEW_REPORT_CREATE') { if (!s.report) s.reportT = x.t; s.report = true; }
    else if (x.e === 'INTERVIEW_ATTEMPT_START') s.start ??= x.t;
    else if (x.e === 'INTERVIEW_RESUME') s.resume = true; }
  const qAt = (s, t) => { let q = null; for (const x of s.q) { if (x.t <= t) q = x; else break; } return q; };
  const all = [...bySn.values()], started = all.filter((s) => s.q.length), done = started.filter((s) => s.report), drop = started.filter((s) => !s.report);
  const isQ5 = (s) => s.flow === 'standard' && s.qc === 5;
  const grp = (s) => (isQ5(s) ? 'standard_q5' : s.flow === 'onboarding' ? 'onboarding' : 'other');
  // 1. 질문 순서별 이탈 (일반 · 질문 수 5) — 그만둔 연습은 답변 수+1번째 질문을 보다가 멈춤, 끝낸 연습은 마지막으로 답한 질문까지 옴
  const q5 = started.filter(isQ5);
  const dropoff = IV_POS.map((name, i) => ({ position: i + 1, question: name, reached: q5.filter((s) => (s.report ? s.a.length >= i + 1 : s.a.length >= i)).length, dropped: q5.filter((s) => !s.report && s.a.length === i).length }));
  // 날짜 필터용: 세트를 만든 날(KST)별 도달·이탈 — 세트 단위라 기간 합산이 정확함
  const dropDaily = {};
  for (const s of q5) { const d = new Date(s.t.getTime() + 9 * 3600e3).toISOString().slice(0, 10), o = (dropDaily[d] ??= { r: IV_POS.map(() => 0), x: IV_POS.map(() => 0) });
    IV_POS.forEach((_, i) => { if (s.report ? s.a.length >= i + 1 : s.a.length >= i) o.r[i]++; if (!s.report && s.a.length === i) o.x[i]++; }); }
  const answerCountQ5 = Object.entries(q5.filter((s) => s.report).reduce((m, s) => (m[s.a.length] = (m[s.a.length] || 0) + 1, m), {})).map(([answers, n]) => ({ answers: +answers, sets: n }));
  // 2. 흐름별 끝냄 · 그만둠 (+ 사람)
  const G = { standard_q5: '일반 · 질문 수 5', onboarding: '내 직무 찾기', other: '그 밖의 일반 · 후속 연습' };
  const summary = Object.keys(G).map((k) => { const st = started.filter((s) => grp(s) === k), c = st.filter((s) => s.report).length; return { key: k, group: G[k], started: st.length, completed: c, dropped: st.length - c }; });
  summary.push({ key: 'all_sets', group: '연습 세트 전체', started: started.length, completed: done.length, dropped: drop.length });
  const pStart = new Set(started.map((s) => s.u)), pDone = new Set(done.map((s) => s.u));
  summary.push({ key: 'people', group: '사람', started: pStart.size, completed: pDone.size, dropped: pStart.size - pDone.size });
  // 3. 흐름별 구성과 소요 시간 (끝낸 연습, 소요 = 첫 응시 시작 → 결과표 요청, 이어하기 없는 것만)
  const CG = [['standard_q5', '일반 · 질문 수 5', (s) => isQ5(s)], ['standard_q4', '일반 · 질문 수 4', (s) => s.flow === 'standard' && s.qc === 4], ['standard_q3', '일반 · 질문 수 3', (s) => s.flow === 'standard' && s.qc === 3],
    ['standard_q2', '일반 · 질문 수 2', (s) => s.flow === 'standard' && s.qc === 2], ['onboarding', '내 직무 찾기', (s) => s.flow === 'onboarding']];
  const composition = CG.map(([key, group, f]) => { const ss = done.filter(f), ans = ss.map((s) => s.a.length), mins = ss.filter((s) => !s.resume && s.start && s.reportT).map((s) => (s.reportT - s.start) / 60000);
    return { key, group, completed_sets: ss.length, answers_median: quant(ans, 0.5), answers_mean: r1(ans.reduce((a, b) => a + b, 0) / (ans.length || 1)), minutes_median: r1(quant(mins, 0.5)), minutes_p25: r1(quant(mins, 0.25)), minutes_p75: r1(quant(mins, 0.75)), timed_sets: mins.length }; });
  // 4. 질문 수별 완료 (사람별 첫 연습이 일반 흐름인 경우)
  const firstStd = new Map(); for (const s of [...all].sort((a, b) => a.t - b.t)) if (!firstStd.has(s.u)) firstStd.set(s.u, s);
  for (const [u, s] of firstStd) if (s.flow !== 'standard' || !s.q.length) firstStd.delete(u);
  const byQc = [5, 4, 3, 2].map((qc) => { const ss = [...firstStd.values()].filter((s) => s.qc === qc); return { question_count: qc, started: ss.length, completed: ss.filter((s) => s.report).length }; });
  // 5. 한 번도 못 끝낸 사람의 최대 답변 수
  const maxA = new Map(); for (const s of started) if (!pDone.has(s.u)) maxA.set(s.u, Math.max(maxA.get(s.u) ?? 0, s.a.length));
  const never = Object.entries([...maxA.values()].reduce((m, n) => (m[n] = (m[n] || 0) + 1, m), {})).map(([k, n]) => ({ max_answers: +k, users: n }));
  // 6. 답변 시간 — 질문 유형별(모든 흐름) · 질문 순서별(일반 흐름 영상)
  const answers = started.flatMap((s) => s.a.map((a, i) => ({ s, i, sec: a.ms / 1000, to: !!a.to, mode: a.mode === 'text' ? 'text' : 'video', qt: (qAt(s, new Date(a.t - (a.ms || 0))) || {}).qt })));
  const tstat = (xs, limit) => { const sec = xs.filter((a) => a.sec >= 0).map((a) => a.sec); return { answers: xs.length, p25_sec: r1(quant(sec, 0.25)), median_sec: r1(quant(sec, 0.5)), p75_sec: r1(quant(sec, 0.75)), p90_sec: r1(quant(sec, 0.9)),
    timed_out_rate: xs.length ? r3(xs.filter((a) => a.to).length / xs.length) : null, over80_rate: limit === 90 && sec.length ? r3(sec.filter((x) => x >= 80).length / sec.length) : null, under20_rate: sec.length ? r3(sec.filter((x) => x < 20).length / sec.length) : null }; };
  const byType = []; for (const [mode, label, limit] of [['video', '영상', 90], ['text', '텍스트', 300]]) {
    for (const qt of Object.keys(IV_QTYPE)) byType.push({ key: mode + '_' + qt, mode: label, limit_sec: limit, question_type: qt, type_label: IV_QTYPE[qt], ...tstat(answers.filter((a) => a.mode === mode && a.qt === qt), limit) });
    byType.push({ key: mode + '_all', mode: label, limit_sec: limit, question_type: 'all', type_label: label + ' 전체', ...tstat(answers.filter((a) => a.mode === mode), limit) }); }
  const byPos = IV_POS.map((name, i) => ({ position: i + 1, question: name, ...tstat(answers.filter((a) => a.s.flow === 'standard' && a.mode === 'video' && a.i === i), 90) }));
  // 7. 질문 유형별 다시하기 (다시하기 직전에 뜬 질문 기준, 영상·텍스트 합산)
  const retries = started.flatMap((s) => s.retry.map((r) => (qAt(s, r.t) || {}).qt));
  const retry = Object.keys(IV_QTYPE).map((qt) => ({ question_type: qt, type_label: IV_QTYPE[qt], retries: retries.filter((x) => x === qt).length, answers: answers.filter((a) => a.qt === qt).length }));
  // 8. 시간 초과와 완료
  const timedOut = (ss) => (ss.length ? r3(ss.filter((s) => s.a.some((a) => a.to)).length / ss.length) : null);
  const dropA = drop.filter((s) => s.a.length);
  const timeout = [{ key: 'completed', group: '끝낸 연습', sets: done.length, timed_out_rate: timedOut(done) }, { key: 'dropped_answered', group: '그만둔 연습(답변 1개 이상)', sets: dropA.length, timed_out_rate: timedOut(dropA) }];
  // 9. 진입에서 연습까지 (사람)
  //  사람 = 로그인 계정, 비로그인은 세션 (세션 안에서 로그인했으면 그 계정으로 합침)
  const [ent] = await agg(tl, [{ $match: { timestamp: T, eventTarget: 'INTERVIEW_ENTRY', eventType: 'CLICK', clientIp: { $nin: ips } } }, { $group: { _id: '$sessionId', u: { $max: '$userSn' } } },
    { $match: { u: { $nin: [...internal] } } }, { $group: { _id: { $cond: [{ $gt: [{ $ifNull: ['$u', 0] }, 0] }, { $toString: '$u' }, { $concat: ['s:', { $ifNull: ['$_id', '?'] }] }] } } }, { $count: 'n' }]);
  const funnel = [{ key: 'entry', stage: '면접 연습 진입', people: ent ? ent.n : 0 }, { key: 'set_created', stage: '연습 세트 생성', people: new Set(all.map((s) => s.u)).size },
    { key: 'first_question', stage: '첫 질문 노출', people: pStart.size }, { key: 'completed', stage: '연습 1회 이상 끝냄', people: pDone.size }];
  return { from, to, asOf: cutoff.toISOString(), internalAccounts: internal.size, pos: IV_POS, dropoff, dropDaily, answerCountQ5: answerCountQ5.sort((a, b) => a.answers - b.answers), summary, composition, byQc, never: never.sort((a, b) => a.max_answers - b.max_answers), byType, byPos, retry, timeout, funnel };
}

// ---- 커리어메모리 완성률 (홈 날짜 필터용) — 기간 [a,b]마다 방문자 · 기록 남긴 사람(중복 제거) 정확값
//  사람 수는 일별 합으로 중복 제거가 안 돼, 사람별 방문일·기록일로 모든 (시작,끝) 쌍을 미리 센다. 사람 식별자는 반출하지 않음
//  사람 키·기록 정의는 build.cjs 커리어메모리 퍼널(cmFunnel)과 같음
const CM_IDENT = { $ifNull: ['$userId', { $concat: ['s:', { $ifNull: ['$sessionId', '?'] }] }] };
const CM_ENGAGE = ['MEMORY_NOTE_SAVE', 'MEMORY_FILE_UPLOAD', 'MEMORY_ATTACHMENT_UPLOAD'];
async function buildCmRange(db, days) {
  const idx = new Map(days.map((d, i) => [d, i])), N = days.length;
  const dayIf = (cond) => ({ $addToSet: { $cond: [cond, kstDay('$timestamp'), '$$REMOVE'] } });
  const users = await agg(db.collection('tracking_log'), [
    { $match: { routeName: 'CAREER_MEMORY_SLUG', timestamp: { $gte: new Date(days[0] + 'T00:00:00+09:00'), $lte: new Date(days[N - 1] + 'T23:59:59.999+09:00') } } },
    { $group: { _id: CM_IDENT, v: dayIf({ $eq: ['$eventType', 'VISIT'] }), e: dayIf({ $in: ['$eventTarget', CM_ENGAGE] }) } },
    { $project: { _id: 0, v: 1, e: 1 } },
  ]);
  // 행 a = 시작일, 열 b-a = 끝일. 사람마다 a 이후 첫 해당일에 +1 → 끝일 방향 누적합 = 기간 안에 하루라도 해당한 사람 수
  const count = (key) => {
    const m = Array.from({ length: N }, () => new Int32Array(N));
    for (const u of users) {
      const ds = u[key].map((d) => idx.get(d)).filter((i) => i != null).sort((x, y) => x - y);
      for (let a = 0, j = 0; a < N && j < ds.length; a++) { while (j < ds.length && ds[j] < a) j++; if (j < ds.length) m[a][ds[j]]++; }
    }
    return m.map((row, a) => { const out = []; let s = 0; for (let b = a; b < N; b++) out.push(s += row[b]); return out; });
  };
  return { days, visitors: count('v'), engaged: count('e') };
}

module.exports = { buildInterview, buildTalentPool, buildSurvey, buildCmRange, buildIvDesign };
