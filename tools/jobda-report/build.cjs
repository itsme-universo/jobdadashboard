// JOBDA 행동 리포트 · 자체 완결형 빌드기 (MongoDB 직접 접속, 서버 불필요)
// 로컬: node tools/jobda-report/build.js   ·   CI: GitHub Actions에서 동일 실행
// 산출물: public/strategy/jobdabehavior/dailyarchive/<YYYY-MM-DD>/index.html (+ 목록 index)
//         public/strategy/jobdabehavior/campaigns/index.html
// 집계 전용 · 개인 식별정보 미출력.
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'strategy/jobdabehavior');
const WEB = '/strategy/jobdabehavior/dailyarchive';
const KST = '+09:00';
const START = '2026-08-27';
const CAMPAIGN_SINCE = '2026-09-09';
const PW = process.env.MONGODB_PASSWORD;
if (!PW) { console.error('MONGODB_PASSWORD 필요'); process.exit(1); }
const uri = `mongodb+srv://pwj0507:${encodeURIComponent(PW)}@kr-pr-mongodb-jobda-v1-pl-2.xmxtn.mongodb.net/?readPreference=secondaryPreferred`;

const CM_ROUTE = 'CAREER_MEMORY_SLUG';
const ROCKET_STAGES = ['ROCKET_APPLY_STEP','ROCKET_APPLY_START','ROCKET_ATS_ACCOUNT','ROCKET_DRAFT_CREATE','ROCKET_AUTOFILL_END','ROCKET_SECTION_REVIEW','ROCKET_SUBMIT'];
const IDENT = { $ifNull: ['$userId', { $concat: ['s:', { $ifNull: ['$sessionId', '?'] }] }] };
const kstDay = (f) => ({ $dateToString: { format: '%Y-%m-%d', date: f, timezone: KST } });
const ARCHIVE_START = new Date(START + 'T00:00:00+09:00');
const bound = (field, until, sinceDate) => until ? [{ $match: { [field]: { $gte: sinceDate || ARCHIVE_START, $lte: new Date(until + 'T23:59:59.999+09:00') } } }] : [];
const noLt = (s) => s.replace(/</g, '\\u003c');
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const identJS = (e) => e.userId || ('s:' + (e.sessionId || '?'));
function daysBetween(a, b) { const o = []; let d = new Date(a + 'T00:00:00Z'), e = new Date(b + 'T00:00:00Z'); while (d <= e) { o.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 864e5); } return o; }

function bucketReferrer(ref) {
  if (!ref) return '직접 유입 / 앱';
  let u; try { u = new URL(ref); } catch { return '기타'; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'jobda.im') { const seg = u.pathname.split('/').filter(Boolean)[0] || '홈';
    const n = { '홈':'홈', acca:'ACCA(역량검사)', match:'매칭', position:'포지션', jobs:'공고', join:'회원가입', mypage:'마이페이지', 'career-memory':'커리어메모리', info:'콘텐츠', login:'로그인', phs:'PHS', oauth2:'로그인', pass:'PASS' };
    return `잡다 내부 · ${n[seg] || seg}`; }
  if (host === 'jobda.acca.ai') return '잡다 내부 · 역검 응시(acca.ai)';
  if (/(^|\.)google\.com$/.test(host) && !host.includes('accounts')) return '검색 · Google';
  if (host.includes('search.naver') || host === 'naver.com' || host === 'm.search.naver.com') return '검색 · Naver';
  if (host.includes('daum') || host.includes('bing')) return '검색 · 기타';
  if (/kauth\.kakao|accounts\.kakao|accounts\.google|nid\.naver|appleid\.apple/.test(host)) return '로그인 리다이렉트';
  return `외부 · ${host}`;
}
function parseUtm(sp) {
  if (!sp) return null; const q = {};
  for (const kv of String(sp).split('&')) { const i = kv.indexOf('='); if (i < 0) continue; let v = kv.slice(i + 1); try { v = decodeURIComponent(v); } catch {} q[kv.slice(0, i)] = v; }
  if (!q.utm_source && !q.utm_campaign) return null;
  return { source: q.utm_source || '(none)', medium: q.utm_medium || '(none)', campaign: q.utm_campaign || '(none)', content: q.utm_content || '' };
}

async function buildDashboard(db, until, since) {
  const sinceDate = since ? new Date(since + 'T00:00:00+09:00') : ARCHIVE_START;
  const dailyStat = db.collection('tracking_daily_stat'), userDaily = db.collection('tracking_user_daily_stat'),
    trackingLog = db.collection('tracking_log'), searchLog = db.collection('search_log');
  const agg = (c, p) => c.aggregate(p, { allowDiskUse: true }).toArray();
  const sMatch = { $match: { createdDateTime: { $gte: sinceDate, $lte: new Date(until + 'T23:59:59.999+09:00') } } };
  const kstMonth = { $dateToString: { format: '%Y-%m', date: '$date', timezone: KST } };
  const [dailyVisits, dailyUsers, dailySessions, dailySearches, features, topRoutes, authDaily, topKeywords, monthlyUsers] = await Promise.all([
    agg(dailyStat, [...bound('date', until, sinceDate), { $match: { eventType: 'VISIT' } }, { $group: { _id: kstDay('$date'), visits: { $sum: '$count' }, desktop: { $sum: '$device.desktop' }, mobile: { $sum: '$device.mobile' }, tablet: { $sum: '$device.tablet' } } }, { $sort: { _id: 1 } }]),
    agg(userDaily, [...bound('date', until, sinceDate), { $group: { _id: { d: kstDay('$date'), u: '$userSn' } } }, { $group: { _id: '$_id.d', users: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    agg(trackingLog, [...bound('timestamp', until, sinceDate), { $group: { _id: { d: kstDay('$timestamp'), s: '$sessionId' } } }, { $group: { _id: '$_id.d', sessions: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    agg(searchLog, [sMatch, { $group: { _id: kstDay('$createdDateTime'), searches: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    agg(dailyStat, [...bound('date', until, sinceDate), { $match: { eventType: 'VISIT', feature: { $ne: null } } }, { $group: { _id: '$feature', visits: { $sum: '$count' } } }, { $sort: { visits: -1 } }]),
    agg(dailyStat, [...bound('date', until, sinceDate), { $match: { eventType: 'VISIT' } }, { $group: { _id: '$routeName', visits: { $sum: '$count' } } }, { $sort: { visits: -1 } }, { $limit: 10 }]),
    agg(dailyStat, [...bound('date', until, sinceDate), { $match: { eventType: 'COMPLETE', logName: { $regex: '(ACCOUNT_LOGIN_COMPLETE|ACCOUNT_SIGN_UP_COMPLETE)$' } } }, { $group: { _id: { d: kstDay('$date'), kind: { $cond: [{ $regexMatch: { input: '$logName', regex: 'SIGN_UP_COMPLETE$' } }, 'signup', 'login'] } }, n: { $sum: '$count' } } }, { $sort: { '_id.d': 1 } }]),
    agg(searchLog, [sMatch, { $match: { keyword: { $type: 'string', $ne: '' } } }, { $group: { _id: { $trim: { input: '$keyword' } }, n: { $sum: 1 } } }, { $match: { _id: { $ne: '' } } }, { $sort: { n: -1 } }, { $limit: 15 }]),
    agg(userDaily, [...bound('date', until, sinceDate), { $group: { _id: { m: kstMonth, u: '$userSn' } } }, { $group: { _id: '$_id.m', users: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  return { generatedAt: new Date().toISOString(), dailyVisits, dailyUsers, dailySessions, dailySearches, features, topRoutes, authDaily, topKeywords, monthlyUsers };
}

async function buildCareerMemory(db, until, since) {
  const sinceDate = since ? new Date(since + 'T00:00:00+09:00') : ARCHIVE_START;
  const dailyStat = db.collection('tracking_daily_stat'), trackingLog = db.collection('tracking_log');
  const agg = (c, p) => c.aggregate(p, { allowDiskUse: true }).toArray();
  const flag = (cond) => ({ $max: { $cond: [cond, 1, 0] } });
  const bD = bound('date', until, sinceDate), bT = bound('timestamp', until, sinceDate);
  const [cmDaily, rawReferrers, behavior, cmFunnel, linkage] = await Promise.all([
    agg(dailyStat, [...bD, { $match: { routeName: CM_ROUTE } }, { $group: { _id: kstDay('$date'), visits: { $sum: { $cond: [{ $eq: ['$eventType', 'VISIT'] }, '$count', 0] } }, uniqueUsers: { $sum: { $cond: [{ $eq: ['$eventType', 'VISIT'] }, '$uniqueUsers', 0] } }, noteSaves: { $sum: { $cond: [{ $eq: ['$eventTarget', 'MEMORY_NOTE_SAVE'] }, '$count', 0] } }, fileUploads: { $sum: { $cond: [{ $eq: ['$eventTarget', 'MEMORY_FILE_UPLOAD'] }, '$count', 0] } }, attachUploads: { $sum: { $cond: [{ $eq: ['$eventTarget', 'MEMORY_ATTACHMENT_UPLOAD'] }, '$count', 0] } } } }, { $sort: { _id: 1 } }]),
    agg(trackingLog, [...bT, { $match: { routeName: CM_ROUTE, eventType: 'VISIT' } }, { $group: { _id: { $arrayElemAt: [{ $split: [{ $ifNull: ['$referrer', ''] }, '?'] }, 0] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 150 }]),
    agg(trackingLog, [...bT, { $match: { routeName: CM_ROUTE, eventType: 'LEAVE' } }, { $facet: {
      summary: [{ $group: { _id: null, n: { $sum: 1 }, avgDwellMs: { $avg: '$metadata.dwellMs' }, avgScroll: { $avg: '$metadata.scrollDepth' } } }],
      dwell: [{ $bucket: { groupBy: { $ifNull: ['$metadata.dwellMs', -1] }, boundaries: [0, 10000, 30000, 60000, 180000, 100000000], default: -1, output: { n: { $sum: 1 } } } }],
      scroll: [{ $bucket: { groupBy: { $ifNull: ['$metadata.scrollDepth', -1] }, boundaries: [0, 25, 50, 75, 101], default: -1, output: { n: { $sum: 1 } } } }],
    } }]),
    agg(trackingLog, [...bT, { $match: { routeName: CM_ROUTE } }, { $group: { _id: IDENT, visited: flag({ $eq: ['$eventType', 'VISIT'] }), saved: flag({ $eq: ['$eventTarget', 'MEMORY_NOTE_SAVE'] }), uploaded: flag({ $in: ['$eventTarget', ['MEMORY_FILE_UPLOAD', 'MEMORY_ATTACHMENT_UPLOAD']] }) } }, { $group: { _id: null, visitors: { $sum: '$visited' }, savers: { $sum: '$saved' }, uploaders: { $sum: '$uploaded' }, engaged: { $sum: { $max: ['$saved', '$uploaded'] } } } }]),
    agg(trackingLog, [...bT, { $match: { $or: [{ routeName: CM_ROUTE }, { eventTarget: { $in: ROCKET_STAGES } }] } }, { $group: { _id: IDENT, cm: flag({ $eq: ['$routeName', CM_ROUTE] }), rocket: flag({ $in: ['$eventTarget', ROCKET_STAGES] }), submit: flag({ $eq: ['$eventTarget', 'ROCKET_SUBMIT'] }) } }, { $group: { _id: null, cmUsers: { $sum: '$cm' }, both: { $sum: { $cond: [{ $and: [{ $eq: ['$cm', 1] }, { $eq: ['$rocket', 1] }] }, 1, 0] } }, cmAndSubmit: { $sum: { $cond: [{ $and: [{ $eq: ['$cm', 1] }, { $eq: ['$submit', 1] }] }, 1, 0] } } } }]),
  ]);
  const buckets = new Map();
  for (const r of rawReferrers) { const k = bucketReferrer(r._id || null); buckets.set(k, (buckets.get(k) || 0) + r.n); }
  let referrers = [...buckets.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  const top = referrers.slice(0, 12); const rest = referrers.slice(12).reduce((s, r) => s + r.n, 0);
  if (rest > 0) top.push({ name: '기타', n: rest });
  return { generatedAt: new Date().toISOString(), cmDaily, referrers: top, behavior: behavior[0], cmFunnel: cmFunnel[0] || { visitors: 0, savers: 0, uploaders: 0, engaged: 0 }, linkage: linkage[0] || { cmUsers: 0, both: 0, cmAndSubmit: 0 } };
}

// 로켓 퍼널 (지원건=user×공고 도달여부, monotonic) — until(ms) 이하
function funnelUpTo(ev, untilMs, sinceMs, periodLabel) {
  const apps = new Map(), submitByDay = {}, submitApps = new Set();
  const stageOf = (e) => { const t = e.eventTarget;
    if (t === 'ROCKET_APPLY_START') return 'start';
    if (t === 'ROCKET_APPLY_STEP') return 'step:' + (e.metadata?.step || '?');
    if (t === 'ROCKET_AUTOFILL_END') return e.metadata?.result === 'success' ? 'autofill' : null;
    if (t === 'ROCKET_SECTION_REVIEW') return 'review';
    if (t === 'ROCKET_SUBMIT') return 'submit'; return null; };
  for (const e of ev) { if (e.ts > untilMs) continue; if (sinceMs && e.ts < sinceMs) continue; if (!e.sn) continue;
    const key = identJS(e) + '¦' + e.sn; const st = stageOf(e); if (!st) continue;
    if (!apps.has(key)) apps.set(key, new Set()); apps.get(key).add(st);
    if (st === 'submit') { submitApps.add(key); const d = new Date(e.ts + 9 * 3600e3).toISOString().slice(0, 10); (submitByDay[d] ??= new Set()).add(key); } }
  const ORDER = [{ code: 'start', name: '지원 시작' }, { code: 'step:agreement', name: '약관 동의' }, { code: 'step:sector', name: '지원 부문 선택' }, { code: 'step:form', name: '지원서 작성' }, { code: 'review', name: '섹션 검토 (ATS)' }, { code: 'submit', name: '최종 제출 (크레딧 차감)' }];
  const idxOf = Object.fromEntries(ORDER.map((s, i) => [s.code, i])); const fc = ORDER.map(() => 0); let autofill = 0;
  for (const set of apps.values()) { if (set.has('autofill')) autofill++; let mx = -1; for (const st of set) if (idxOf[st] !== undefined && idxOf[st] > mx) mx = idxOf[st]; for (let i = 0; i <= mx; i++) fc[i] += 1; }
  return { funnel: ORDER.map((s, i) => ({ name: s.name, apps: fc[i] })), submitTotal: submitApps.size, submitByDay: Object.fromEntries(Object.entries(submitByDay).map(([d, s]) => [d, s.size]).sort()), side: { autofillApps: autofill, atsAccountUsers: 0, draftCreateUsers: 0, startApps: fc[0] }, period: periodLabel };
}

// 로켓 제출 상세 (공고명 해석: pageTitle 또는 같은 세션 최근접 JD)
async function resolveSubmits(col) {
  const submits = await col.find({ eventTarget: 'ROCKET_SUBMIT' }, { projection: { sessionId: 1, timestamp: 1, 'metadata.jobnoticeSn': 1, pageTitle: 1 } }).sort({ timestamp: 1 }).toArray();
  const rows = [];
  for (const s of submits) {
    const sn = s.metadata?.jobnoticeSn || '?'; const day = new Date(s.timestamp.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
    let title = s.pageTitle || '', src = 'JD';
    if (!/채용 \|/.test(title)) {
      const visits = await col.find({ sessionId: s.sessionId, routeName: 'POSITION_SN_JD', eventType: 'VISIT' }, { projection: { timestamp: 1, pageTitle: 1 } }).toArray();
      let best = null, gap = Infinity; for (const v of visits) { const g = Math.abs(v.timestamp - s.timestamp); if (g < gap) { gap = g; best = v; } }
      if (best && /채용 \|/.test(best.pageTitle || '')) { title = best.pageTitle; src = `sess:${Math.round(gap / 60000)}`; } else { title = ''; src = 'none'; }
    }
    const clean = title.replace(/ ?\| ?잡다\s*$/, ''); const [company, ...rest] = clean.split(' 채용 | ');
    rows.push({ day, sn, company: rest.length ? company : '', position: rest.length ? rest.join(' ') : '', src });
  }
  const map = new Map();
  for (const r of rows) { const k = [r.day, r.sn, r.company, r.position].join('¦'); if (map.has(k)) map.get(k).count++; else map.set(k, { ...r, count: 1 }); }
  const out = [...map.values()].map((r) => {
    const resolved = r.company && r.company !== ''; let conf, flag = ''; const gm = r.src.match(/sess:(\d+)/);
    if (!resolved) { conf = '해석 불가'; flag = 'unresolved'; } else if (r.src === 'JD') conf = 'JD 확정'; else conf = `세션추정${gm ? `(${gm[1]}분)` : ''}`;
    if (gm && Number(gm[1]) > 120) flag = `저신뢰(${(Number(gm[1]) / 60).toFixed(1)}h차)`;
    if (/마이다스/.test(r.company) && r.count >= 3) flag = '내부테스트 의심';
    return { day: r.day, company: resolved ? r.company : '미확인', position: resolved ? r.position : '—', sn: r.sn, count: r.count, conf, flag };
  });
  return out;
}

// 캠페인 (9/9~) 유입→전환
const CAMPAIGN_DEFS = [
  { id: 'kakao_rocket_cm', name: '카카오 알림톡 · 로켓/커리어메모리', channel: 'KakaoTalk 알림톡', match: (u) => u.source === 'kakao' && u.medium === 'alimtalk',
    dispatch: { sent: 96398, label: '발송 96,398명', detail: 'JOBDA 최근 1개월 내 접속 이력 사용자' } },
  { id: 'email_rocket', name: '이메일 · 커리어센터/로켓', channel: 'Email', match: (u) => u.source === 'career_center' && u.medium === 'email',
    dispatch: { label: '발송 443개교', detail: '대학교·대학원 317개교 + 전문대학 126개교' } },
];
const UNIV_MAP = { kangwon: '강원대학교', ut: '한국교통대학교', pknu: '부경대학교', snu: '서울대학교', korea: '고려대학교', yonsei: '연세대학교', hanyang: '한양대학교', khu: '경희대학교', cau: '중앙대학교', inha: '인하대학교', ajou: '아주대학교', konkuk: '건국대학교', dankook: '단국대학교', pusan: '부산대학교', knu: '경북대학교', cnu: '충남대학교', chungbuk: '충북대학교', jbnu: '전북대학교', jnu: '전남대학교', ynu: '영남대학교', gachon: '가천대학교', sejong: '세종대학교', ssu: '숭실대학교', uos: '서울시립대학교', kaist: 'KAIST' };
function schoolFromReferrer(ref) {
  if (!ref) return null; let host; try { host = new URL(ref).hostname.replace(/^www\./, ''); } catch { return null; }
  const parts = host.split('.'); const i = parts.indexOf('ac'); if (i < 1 || parts[i + 1] !== 'kr') return null;
  const code = parts[i - 1]; return { code, name: UNIV_MAP[code] || `${code}.ac.kr` };
}
async function buildCampaigns(col, since) {
  const start = new Date(since + 'T00:00:00+09:00'); const M = { timestamp: { $gte: start } };
  const kday = (ts) => new Date(ts.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const entries = await col.find({ ...M, eventType: 'VISIT', searchParams: { $regex: 'utm_' } }, { projection: { searchParams: 1, sessionId: 1, userId: 1, routeName: 1, timestamp: 1, referrer: 1 } }).toArray();
  const state = CAMPAIGN_DEFS.map((d) => ({ def: d, sessions: new Set(), users: new Set(), visits: 0, landing: {}, daily: {}, hours: {}, schools: {}, refWith: 0, refNone: 0 }));
  for (const e of entries) { const u = parseUtm(e.searchParams); if (!u) continue;
    for (const s of state) { if (!s.def.match(u)) continue; s.visits++; if (e.sessionId) s.sessions.add(e.sessionId); s.users.add(identJS(e));
      s.landing[e.routeName] = (s.landing[e.routeName] || 0) + 1; const d = kday(e.timestamp); (s.daily[d] ??= { visits: 0, u: new Set() }); s.daily[d].visits++; s.daily[d].u.add(identJS(e));
      const h = new Date(e.timestamp.getTime() + 9 * 3600e3).getUTCHours(); s.hours[h] = (s.hours[h] || 0) + 1;
      if (e.referrer) { s.refWith++; const sc = schoolFromReferrer(e.referrer); if (sc) { (s.schools[sc.name] ??= { name: sc.name, code: sc.code, n: 0 }).n++; } } else s.refNone++; } }
  const allSess = new Set(); for (const s of state) for (const x of s.sessions) allSess.add(x);
  const conv = new Map();
  if (allSess.size) { const evs = await col.find({ ...M, sessionId: { $in: [...allSess] } }, { projection: { sessionId: 1, routeName: 1, eventTarget: 1, eventType: 1 } }).toArray();
    for (const e of evs) { if (!conv.has(e.sessionId)) conv.set(e.sessionId, {}); const v = conv.get(e.sessionId);
      if (e.routeName === CM_ROUTE) v.cm = 1; if (['MEMORY_NOTE_SAVE', 'MEMORY_FILE_UPLOAD', 'MEMORY_ATTACHMENT_UPLOAD'].includes(e.eventTarget)) v.cmSave = 1;
      if (e.eventTarget === 'ROCKET_APPLY_START') v.rocketStart = 1; if (e.eventTarget === 'ROCKET_SUBMIT') v.rocketSubmit = 1;
      if (e.eventTarget === 'ACCOUNT_SIGN_UP' && e.eventType === 'COMPLETE') v.signup = 1; if (e.eventTarget === 'ACCOUNT_LOGIN' && e.eventType === 'COMPLETE') v.login = 1;
      if (/^ACCA/.test(e.routeName || '')) v.acca = 1; } }
  const campaigns = state.map((s) => { const c = { cm: 0, cmSave: 0, login: 0, signup: 0, acca: 0, rocketStart: 0, rocketSubmit: 0 };
    for (const x of s.sessions) { const v = conv.get(x); if (!v) continue; for (const k in c) c[k] += (v[k] || 0); }
    return { id: s.def.id, name: s.def.name, channel: s.def.channel, dispatch: s.def.dispatch || null, visits: s.visits, users: s.users.size, sessions: s.sessions.size,
      daily: Object.entries(s.daily).sort().map(([day, o]) => ({ day, visits: o.visits, users: o.u.size })), conv: c,
      peakHour: Object.entries(s.hours).sort((a, b) => b[1] - a[1])[0]?.[0],
      topLanding: Object.entries(s.landing).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([routeName, n]) => ({ routeName, n })),
      schools: Object.values(s.schools).sort((a, b) => b.n - a.n),
      referrerCoverage: { withRef: s.refWith, noRef: s.refNone } }; });
  return { generatedAt: new Date().toISOString(), since, campaigns };
}

// ---- 페이지 이동 경로 (세션 내 연속 VISIT) — 커리어메모리·로켓 중심 네트워크용
function routeGroup(r) {
  if (!r) return '기타';
  if (r.startsWith('ACCA') || r.startsWith('ACC_') || r.startsWith('PHS')) return '역량검사';
  if (r.startsWith('POSITION') || r.startsWith('JOBS') || r.startsWith('COMPANY') || r === 'CALENDAR') return '공고 탐색';
  if (r.startsWith('MATCH')) return '매칭';
  if (r.startsWith('CAREER_MEMORY')) return '커리어메모리';
  if (r.startsWith('MYPAGE') || r === 'PROFILE') return '마이페이지';
  if (r === 'HOME') return '홈';
  if (r.startsWith('JOIN') || r.startsWith('OAUTH2') || r.includes('LOGIN')) return '로그인/가입';
  if (r.startsWith('INFO') || r.startsWith('CONTENT')) return '콘텐츠';
  if (r.startsWith('INTERVIEW')) return '면접';
  return '기타';
}
async function buildFlows(db) {
  const trackingLog = db.collection('tracking_log'), dailyStat = db.collection('tracking_daily_stat');
  const agg = (col, p) => col.aggregate(p, { allowDiskUse: true }).toArray();
  const PAIR = [
    { $project: { pairs: { $map: { input: { $range: [0, { $max: [0, { $subtract: [{ $size: '$routes' }, 1] }] }] }, as: 'i', in: { f: { $arrayElemAt: ['$routes', '$$i'] }, t: { $arrayElemAt: ['$routes', { $add: ['$$i', 1] }] } } } } } },
    { $unwind: '$pairs' }, { $match: { $expr: { $ne: ['$pairs.f', '$pairs.t'] } } },
    { $group: { _id: { f: '$pairs.f', t: '$pairs.t' }, n: { $sum: 1 } } },
  ];
  const [fr, routeVisits] = await Promise.all([
    agg(trackingLog, [{ $match: { eventType: 'VISIT' } }, { $sort: { sessionId: 1, timestamp: 1 } }, { $group: { _id: '$sessionId', routes: { $push: '$routeName' } } },
      { $facet: {
        pairs: [...PAIR, { $sort: { n: -1 } }, { $limit: 1200 }],
        cm: [...PAIR, { $match: { $or: [{ '_id.f': { $regex: '^CAREER_MEMORY' } }, { '_id.t': { $regex: '^CAREER_MEMORY' } }] } }, { $sort: { n: -1 } }, { $limit: 300 }],
        exits: [{ $project: { last: { $arrayElemAt: ['$routes', -1] } } }, { $group: { _id: '$last', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
        routeSessions: [{ $unwind: '$routes' }, { $group: { _id: { s: '$_id', r: '$routes' } } }, { $group: { _id: '$_id.r', sessions: { $sum: 1 } } }],
      } }]),
    agg(dailyStat, [{ $match: { eventType: 'VISIT' } }, { $group: { _id: '$routeName', visits: { $sum: '$count' } } }]),
  ]);
  const rawPairs = fr[0].pairs, cmPairs = fr[0].cm, exitsRaw = fr[0].exits;
  const routeSessions = new Map(fr[0].routeSessions.map((r) => [r._id, r.sessions]));
  const isCm = (r) => typeof r === 'string' && r.startsWith('CAREER_MEMORY');
  const inflow = new Map(), outflow = new Map();
  for (const p of cmPairs) { const { f, t } = p._id; if (isCm(f) && isCm(t)) continue; if (isCm(t)) inflow.set(f, (inflow.get(f) || 0) + p.n); else if (isCm(f)) outflow.set(t, (outflow.get(t) || 0) + p.n); }
  const toSorted = (m) => [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  const edgeMap = new Map();
  for (const p of rawPairs) { const f = routeGroup(p._id.f), t = routeGroup(p._id.t); if (f === t) continue; const k = `${f}→${t}`; edgeMap.set(k, (edgeMap.get(k) || 0) + p.n); }
  const edges = [...edgeMap.entries()].map(([k, n]) => { const [from, to] = k.split('→'); return { from, to, n }; }).sort((a, b) => b.n - a.n);
  const nodeMap = new Map();
  for (const r of routeVisits) { const g = routeGroup(r._id); nodeMap.set(g, (nodeMap.get(g) || 0) + r.visits); }
  const nodes = [...nodeMap.entries()].map(([name, visits]) => ({ name, visits }));
  const rvMap = new Map(routeVisits.map((r) => [r._id, r.visits]));
  const topPages = [...rvMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, visits]) => ({ name, visits }));
  const topSet = new Set(topPages.map((p) => p.name));
  const routeEdges = rawPairs.filter((p) => topSet.has(p._id.f) && topSet.has(p._id.t)).map((p) => ({ from: p._id.f, to: p._id.t, n: p.n }));
  const exits = exitsRaw.filter((r) => r._id).map((r) => ({ name: r._id, exits: r.n, sessions: routeSessions.get(r._id) || r.n, exitRate: routeSessions.get(r._id) ? +(100 * r.n / routeSessions.get(r._id)).toFixed(1) : null }));
  return { generatedAt: new Date().toISOString(), nodes, edges, cmFlows: { inflow: toSorted(inflow), outflow: toSorted(outflow) }, topPages, routeEdges, exits };
}
// 구간별 distinct 순 사용자 (프리셋 lookback 창) — 최신일 기준
async function computeWindowUsers(db, latest) {
  const userDaily = db.collection('tracking_user_daily_stat');
  const WINDOWS = [1, 3, 7, 14, 30, 60, 90, 120, 180, 270, 365];
  const end = new Date(latest + 'T23:59:59.999+09:00');
  const facet = {};
  for (const w of WINDOWS) { const s = new Date(end.getTime() - (w * 864e5) + 1); facet['w' + w] = [{ $match: { date: { $gte: s, $lte: end } } }, { $group: { _id: '$userSn' } }, { $count: 'n' }]; }
  const [r] = await userDaily.aggregate([{ $facet: facet }], { allowDiskUse: true }).toArray();
  const out = {}; for (const w of WINDOWS) out[w] = r['w' + w]?.[0]?.n || 0;
  return out;
}

function fillReport(tpl, chartjs, data, funnel, submits) {
  const out = tpl.replace('__CHARTJS__', () => chartjs).replace('__DATA__', () => noLt(JSON.stringify(data)))
    .replace('__ROCKETFUNNEL__', () => noLt(JSON.stringify(funnel))).replace('__ROCKET__', () => noLt(JSON.stringify(submits)));
  return `<!DOCTYPE html>\n<html lang="ko" data-theme="dark">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n</head>\n<body>\n${out}\n</body>\n</html>\n`;
}

(async () => {
  const tpl = fs.readFileSync(path.join(HERE, 'report.tpl.html'), 'utf8');
  const chartjs = fs.readFileSync(path.join(HERE, 'chart.umd.js'), 'utf8');
  const campTpl = fs.readFileSync(path.join(HERE, 'campaigns.tpl.html'), 'utf8');
  const css = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');
  const common = fs.readFileSync(path.join(HERE, 'common.js'), 'utf8');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db('jobda'); const tl = db.collection('tracking_log');

  // 공통 로드 (한 번)
  const rocketRaw = await tl.find({ eventTarget: { $regex: '^ROCKET' } }, { projection: { userId: 1, sessionId: 1, eventTarget: 1, 'metadata.jobnoticeSn': 1, 'metadata.step': 1, 'metadata.result': 1, timestamp: 1 } }).toArray();
  const ev = rocketRaw.map((e) => ({ userId: e.userId, sessionId: e.sessionId, eventTarget: e.eventTarget, sn: e.metadata?.jobnoticeSn, metadata: e.metadata, ts: e.timestamp.getTime() }));
  const submitRows = await resolveSubmits(tl);

  const today = kstToday(); const days = daysBetween(START, today);
  const archiveDir = path.join(OUT, 'dailyarchive'); fs.mkdirSync(archiveDir, { recursive: true });
  const made = [];
  const SUBNOTE = "개인 식별자 없이 공고 단위 집계. 공고명은 페이지 제목에서 추출. '세션추정'은 목록/캘린더에서 제출되어 같은 세션의 가장 가까운 JD 방문으로 역추적한 값이라 실제와 다를 수 있음.";
  for (const D of days) {
    const sinceMs = new Date(D + 'T00:00:00+09:00').getTime();
    const untilMs = new Date(D + 'T23:59:59.999+09:00').getTime();
    // 아카이브는 "해당 일자 단독" 집계 (since=until=D)
    const [dash, cm] = await Promise.all([buildDashboard(db, D, D), buildCareerMemory(db, D, D)]);
    if (!dash.dailyVisits.length) { console.log('skip(데이터 없음/당일 집계 전)', D); continue; }
    const funnel = funnelUpTo(ev, untilMs, sinceMs, D);
    const rows = submitRows.filter((r) => r.day === D);
    const submits = { period: D, total: rows.reduce((s, r) => s + r.count, 0), note: SUBNOTE, rows };
    fs.mkdirSync(path.join(archiveDir, D), { recursive: true });
    fs.writeFileSync(path.join(archiveDir, D, 'index.html'), fillReport(tpl, chartjs, { dashboard: dash, careerMemory: cm }, funnel, submits));
    made.push({ day: D, submits: submits.total });
    console.log('생성', D, `(당일 제출 ${submits.total})`);
  }
  // 목록 index (절대경로)
  const rowsHtml = made.slice().reverse().map((m) => `<li><a href="${WEB}/${m.day}/">${m.day}</a> <span class="s">당일 제출 ${m.submits}건</span></li>`).join('\n');
  const latest = made[made.length - 1]?.day;
  fs.writeFileSync(path.join(archiveDir, 'index.html'), `<!DOCTYPE html><html lang="ko" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>JOBDA 행동 리포트 · 일별 아카이브</title><style>
:root{color-scheme:light dark}body{font:15px/1.6 system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif;max-width:680px;margin:0 auto;padding:40px 24px;background:#fcfcfb;color:#0b0b0b}
@media(prefers-color-scheme:dark){body{background:#0d0d0d;color:#fff}a{color:#7ab8ff}.s{color:#898781}}
h1{font-size:22px;margin:0 0 4px}.sub{color:#898781;font-size:13px;margin:0 0 24px}
ul{list-style:none;padding:0;margin:0}li{padding:10px 0;border-bottom:1px solid #e1e0d9}
@media(prefers-color-scheme:dark){li{border-color:#2c2c2a}}
a{font-weight:600;text-decoration:none;color:#2a78d6}a:hover{text-decoration:underline}.s{color:#898781;font-size:13px;margin-left:8px}
.latest{display:inline-block;margin:0 0 20px;padding:8px 16px;background:#2a78d6;color:#fff;border-radius:8px;text-decoration:none}</style></head>
<body><h1>JOBDA 행동 리포트 · 일별 아카이브</h1>
<p class="sub">각 날짜는 그 날 하루치(단일일) 집계 리포트입니다 (개인정보 없음). 커리어메모리·로켓지원 상세는 원본 로그 보관기간(약 5일) 특성상 최근 날짜만 채워집니다. 마지막 생성: ${today}</p>
${latest ? `<a class="latest" href="${WEB}/${latest}/">최신 리포트 (${latest}) 열기 →</a>` : ''}
<ul>\n${rowsHtml}\n</ul></body></html>\n`);

  // 캠페인 스냅샷
  const camp = await buildCampaigns(tl, CAMPAIGN_SINCE);
  let ch = campTpl.replace(/<nav class="tabs">[\s\S]*?<\/nav>/, '<p class="sub" style="margin:0 0 18px">정적 스냅샷 — 실시간 최신은 내부 대시보드에서 확인</p>')
    .replace('<button class="refresh" id="refreshBtn">새로고침</button>', '<span class="sub">스냅샷</span><button id="refreshBtn" hidden></button>')
    .replace('<link rel="stylesheet" href="/style.css">', '<style>\n' + css + '\n</style>');
  const shim = '<script>(function(){const B={"/api/campaigns":' + noLt(JSON.stringify(camp)) + '};window.fetch=async(u)=>{const k=Object.keys(B).find(k=>String(u).startsWith(k));if(k)return{ok:true,json:async()=>B[k]};return{ok:false,status:404,json:async()=>({error:"no"})}};})();</script>';
  ch = ch.replace('<script src="/vendor/chart.umd.js"></script>', shim + '\n<script>\n' + chartjs + '\n</script>').replace('<script src="/common.js"></script>', '<script>\n' + common + '\n</script>');
  const campDir = path.join(OUT, 'campaigns'); fs.mkdirSync(campDir, { recursive: true });
  fs.writeFileSync(path.join(campDir, 'index.html'), `<!DOCTYPE html>\n<html lang="ko" data-theme="dark">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n</head>\n<body>\n${ch}\n</body>\n</html>\n`);
  console.log('캠페인 스냅샷 생성 · 캠페인수', camp.campaigns.length);

  // ===== HOME (기본 화면) — 날짜 필터 + 네트워크 그래프
  const homeTpl = fs.readFileSync(path.join(HERE, 'home.tpl.html'), 'utf8');
  const flows = await buildFlows(db);
  const latestDay = made[made.length - 1].day;
  // HOME은 전체 기간(START~latest) 데이터가 필요 — 아카이브(단일일)와 별도로 빌드
  const homeUntilMs = new Date(latestDay + 'T23:59:59.999+09:00').getTime();
  const [homeDash, homeCm] = await Promise.all([buildDashboard(db, latestDay), buildCareerMemory(db, latestDay)]);
  const homeFunnel = funnelUpTo(ev, homeUntilMs, null, `${START} ~ ${latestDay}`);
  const homeRows = submitRows.filter((r) => r.day <= latestDay);
  const homeSubmits = { period: `${START} ~ ${latestDay}`, total: homeRows.reduce((s, r) => s + r.count, 0), note: SUBNOTE, rows: homeRows };
  const windowUsers = await computeWindowUsers(db, latestDay);
  const byId = (arr, k) => Object.fromEntries(arr.map((r) => [r._id, r[k]]));
  const uMap = byId(homeDash.dailyUsers, 'users'), sMap = byId(homeDash.dailySessions, 'sessions'), qMap = byId(homeDash.dailySearches, 'searches');
  const signMap = {}; for (const r of homeDash.authDaily) if (r._id.kind === 'signup') signMap[r._id.d] = (signMap[r._id.d] || 0) + r.n;
  const fullDaily = homeDash.dailyVisits.map((r) => ({ d: r._id, visits: r.visits, users: uMap[r._id] || 0, sessions: sMap[r._id] || 0, searches: qMap[r._id] || 0, signups: signMap[r._id] || 0, desktop: r.desktop || 0, mobile: r.mobile || 0, tablet: r.tablet || 0 }));
  const HOME = { generatedAt: new Date().toISOString(), latest: latestDay, fullDaily, windowUsers, features: homeDash.features, topRoutes: homeDash.topRoutes, topKeywords: homeDash.topKeywords };
  const homeOut = homeTpl
    .replace('__CHARTJS__', () => chartjs)
    .replace('__DATA__', () => noLt(JSON.stringify({ dashboard: homeDash, careerMemory: homeCm })))
    .replace('__ROCKETFUNNEL__', () => noLt(JSON.stringify(homeFunnel)))
    .replace('__ROCKET__', () => noLt(JSON.stringify(homeSubmits)))
    .replace('__HOME__', () => noLt(JSON.stringify(HOME)))
    .replace('__FLOWS__', () => noLt(JSON.stringify(flows)));
  const homeDoc = `<!DOCTYPE html>\n<html lang="ko" data-theme="dark">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n</head>\n<body>\n${homeOut}\n</body>\n</html>\n`;
  fs.writeFileSync(path.join(REPO, 'index.html'), homeDoc); // 사이트 루트 = HOME
  console.log('HOME 생성 · latest', latestDay, '· 구간사용자', JSON.stringify(windowUsers));

  await client.close();
  console.log(`\n완료: HOME + 아카이브 ${made.length}일치 + 캠페인. today=${today}`);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
