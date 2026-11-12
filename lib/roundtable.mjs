// 圆桌 v2 核心逻辑：CLI 和桥共用同一份代码，不另建真相。
// 真相 = meetings.json + 总基地文件夹（议题/会议记录/任务分工/成果/铁律/工具）。
// 规则来源：CLI v0.5 已落地机制 + 2026-10-30 技能/Orca 方案（0-5 步），不改动已定铁律。
// 注意：worktree 隔离是 Orca 式“点子借鉴”，不是 Orca 代码复制；部署到小新之前，
// 须先按 Orca-REA 提醒叫 Codex 用 REA 拆 Orca（见 README 第 0 节），现阶段不装 Orca 本体。
import fs from 'node:fs';
import path from 'node:path';

export const ALL_SEATS = ['Muse', 'Codex', 'Antigravity', 'Trae', 'WorkBuddy'];
export const DEFAULT_SEATS = ['Muse', 'Codex', 'Antigravity'];
export const SKILLS = {
  Impeccable: { repo: 'pbakaus/impeccable', license: 'Apache-2.0', def: 'off', note: '设计技能，24 命令、62 条确定性规则；hook 不自动装，装前须审，审 WebUI 一页做单测' },
  Ponytail: { repo: 'DietrichGebert/ponytail', license: 'MIT', def: 'off', note: '精简技能，懒人梯子决策阶梯；严谨实测代码少约 54%、token 少约 22%，勿用 94% 宣传口径；取代原模糊“手术式小改”说法，不双轨' },
  'security-audit': { repo: 'cloudflare/security-audit-skill', license: 'MIT', def: 'off', note: '安全技能，六阶段，猎手与证伪者分离，verdict 为 confirmed/needs_validation/rejected；只在无网络沙箱、只审用户自有代码，约 30k 行需 3-4 小时，先审小测试库' },
  Graphify: { repo: 'Graphify-Labs/graphify', license: 'Apache-2.0', def: 'off', note: '只读索引，永不当真相；本地 tree-sitter 解析，产出 graph.html/GRAPH_REPORT.md/graph.json；先做门槛测试（临时夹对圆桌代码与 CS-Knife 各跑一次，比图谱查调用关系与 grep 的 token/时间），不开 --strict 与 git hook，私有代码不开 --deep 除非用户另批' },
};
export const TASK_TYPES = ['design-audit', 'minimal-review', 'security-audit', 'graph-index', 'general'];

export function seatsOf(m) { return (m.seats && m.seats.length ? m.seats : m.order) || []; }
export function titleOf(m) { return m.topic || m.title || m.id; }
export function loadBase(base) {
  const f = path.join(base, 'meetings.json');
  if (!fs.existsSync(f)) return { version: 'roundtable-v2', meetings: [] };
  const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
  // 兼容现行版：现行 meetings.json 顶层就是数组（v0.5 格式），不是 {meetings: []}。
  // 旧会议字段：id, topic（不是 title）, createdAt/updatedAt 为时间戳, messages, minutes, turnIndex, order。
  // 旧会议可能没有 seats 字段，席位就等于 order；Gemini 已退役，旧会议里出现 Gemini 时 next 计算要过滤到当前勾选席位。
  if (Array.isArray(parsed)) return { version: 'roundtable-v2', meetings: parsed };
  if (parsed && Array.isArray(parsed.meetings)) return { version: 'roundtable-v2', meetings: parsed.meetings };
  return { version: 'roundtable-v2', meetings: [] };
}
export function saveBase(base, data) {
  fs.mkdirSync(base, { recursive: true });
  // 只追加式保存：写临时文件再原子替换，绝不因新建会议删历史。
  // 保存格式永远是顶层数组，与现行 v0.5 / WebUI 兼容，不写 {meetings: []} 包装。
  const tmp = path.join(base, 'meetings.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data.meetings, null, 2));
  fs.renameSync(tmp, path.join(base, 'meetings.json'));
  syncFolders(base, data.meetings);
}
// 文件夹同步（只在总基地才触发，临时测试目录没有 01_议题/02_会议记录时跳过）：
// 每次保存后，把每场会议的 messages.json、完整记录.md、会议快照.json 同步到对应文件夹，
// 与旧 CLI saveMeeting 的口径一致，避免 v2 只写 meetings.json、文件夹链路断掉。
// 注意：同步是 meetings.json 单向输出到文件夹，不反向读文件夹改 meetings.json，真相仍是 meetings.json。
export function syncFolders(base, meetings) {
  const hasTopicDir = fs.existsSync(path.join(base, '01_议题'));
  const hasRecordDir = fs.existsSync(path.join(base, '02_会议记录'));
  if (!hasTopicDir && !hasRecordDir) return;
  for (const m of meetings || []) {
    if (!m || !m.id) continue;
    try {
      if (hasRecordDir) {
        const rd = path.join(base, '02_会议记录', m.id);
        fs.mkdirSync(rd, { recursive: true });
        fs.writeFileSync(path.join(rd, 'messages.json'), JSON.stringify(m.messages || [], null, 2));
        const body = (m.messages || []).map((x) => `## ${x.speaker || '未知发言人'}\n\n${x.text || ''}`).join('\n\n');
        fs.writeFileSync(path.join(rd, '完整记录.md'), `# ${titleOf(m)}\n\n会议 ID：${m.id}\n\n${body}\n`, 'utf8');
      }
      const outDir = path.join(base, '04_成果', m.id);
      if (fs.existsSync(path.join(base, '04_成果'))) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, '会议快照.json'), JSON.stringify(m, null, 2));
      }
    } catch (e) { /* 文件夹同步失败要显性报错，不能悄悄断链 */ throw new Error(`文件夹同步失败 ${m.id}：${e.message}`); }
  }
}
export function newMeetingId(d = new Date(), existing = []) {
  const p = (n) => String(n).padStart(2, '0');
  const datePart = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const seq = existing.filter((m) => String(m.id).startsWith(datePart + '-')).length + 1;
  return `${datePart}-${String(seq).padStart(2, '0')}`;
}
export function createTopic(base, title, seats = DEFAULT_SEATS) {
  const data = loadBase(base);
  const id = newMeetingId(new Date(), data.meetings);
  const m = {
    id, topic: title, title, status: '待开会', seats: [...seats], order: [...seats],
    messages: [], minutes: null, turnIndex: 0,
    tasks: [], skills: Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, { on: false, locked: false, reviewed: false, reason: '' }])),
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  data.meetings.push(m); saveBase(base, data);
  // 总基地才建议题夹：01_议题/<id>/议题.md + index.json（旧 CLI 口径），临时测试目录没有 01_议题时跳过。
  if (fs.existsSync(path.join(base, '01_议题'))) {
    const dir = path.join(base, '01_议题', id);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, '议题.md'))) fs.writeFileSync(path.join(dir, '议题.md'), `# ${title}\n\n目标：待补充\n\n约束：按总基地铁律\n\n状态：待开会\n`, 'utf8');
    if (!fs.existsSync(path.join(dir, 'index.json'))) fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ id, title, goal: '', seats: [...seats], status: '待开会', createdAt: Date.now(), deepLink: path.join(dir, '议题.md') }, null, 2));
  }
  return m;
}
export function getMeeting(base, id) {
  const data = loadBase(base);
  const m = data.meetings.find((x) => x.id === id);
  if (!m) throw new Error(`议题不存在：${id}`);
  return { data, m };
}
// next：按顺序 + 最近一条 agent 发言推导，不单独存储；跳过“你”和“系统”，用户插话不吃 agent 轮次。
// 席位取 seats，旧会议没有 seats 时取 order；最近发言人不在当前席位里（如已退役 Gemini）时回到席位首位。
export function nextSeat(m) {
  const seats = seatsOf(m);
  if (!seats.length) return null;
  const msgs = m.messages || [];
  let last = null;
  for (let i = msgs.length - 1; i >= 0; i--) { if (seats.includes(msgs[i].speaker)) { last = msgs[i].speaker; break; } }
  if (!last) return seats[0];
  const i = seats.indexOf(last);
  if (i < 0) return seats[0];
  return seats[(i + 1) % seats.length];
}
export function post(base, id, speaker, text, isUser = false) {
  const { data, m } = getMeeting(base, id);
  const label = isUser ? '你' : speaker;
  const seats = seatsOf(m);
  // 闸 1：删席位 / 未勾选席位，一律拦，不建消息、不发提示（省 token）。
  if (!isUser && !seats.includes(speaker)) throw new Error(`席位未勾选或已删除，post 被拦：${speaker}`);
  if (!isUser && !ALL_SEATS.includes(speaker) && speaker !== 'Gemini') throw new Error(`未知席位：${speaker}`);
  // 闸 2：发言顺序，越序只提示不拦（返回 warning，不抛错）。
  const expected = nextSeat(m);
  const warning = (!isUser && speaker !== expected) ? `越序提示：下一位应为 ${expected}，本次为 ${speaker}，已记录不拦截` : '';
  m.messages = m.messages || [];
  m.messages.push({ speaker: label, text, at: new Date().toISOString(), createdAt: Date.now() });
  m.updatedAt = Date.now();
  // 新增席位追赶摘要在 seats() 里生成，这里不发全文。
  saveBase(base, data);
  return { meeting: m, warning, next: nextSeat(m) };
}
export function say(base, id, text) { return post(base, id, '你', text, true); }
export function setSeats(base, id, seats, order = null) {
  const { data, m } = getMeeting(base, id);
  const cur = seatsOf(m);
  const added = seats.filter((s) => !cur.includes(s));
  m.seats = [...seats]; m.order = order ? [...order] : [...seats];
  saveBase(base, data);
  const idxFile = path.join(base, '01_议题', id, 'index.json');
  if (fs.existsSync(idxFile)) {
    try { const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')); idx.seats = [...seats]; fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2)); } catch {}
  }
  // 新增席位只生成追赶摘要预览（议题、顺序、条数、下一位、每条约 150 字预览），不发全文。
  const summary = added.length ? {
    topic: m.id, title: titleOf(m), seats: seatsOf(m), count: (m.messages||[]).length, next: nextSeat(m),
    preview: (m.messages||[]).slice(-5).map((x) => ({ speaker: x.speaker, text: String(x.text||'').slice(0, 150) })),
    added,
  } : null;
  return { meeting: m, catchUpSummary: summary };
}
export function createTask(base, id, { title, owner, checker, type = 'general', skill = '' }) {
  const { data, m } = getMeeting(base, id);
  if (!seatsOf(m).includes(owner)) throw new Error(`负责人未勾选，task 被拦：${owner}`);
  if (checker && checker === owner) throw new Error('检查人必须不是原作者');
  if (!TASK_TYPES.includes(type)) throw new Error(`未知任务类型：${type}，可用：${TASK_TYPES.join(', ')}`);
  if (skill && !SKILLS[skill]) throw new Error(`未知技能：${skill}`);
  if (skill && (!m.skills || !m.skills[skill] || !m.skills[skill].on)) throw new Error(`技能未开启，task 被拦：${skill}（须先走技能开关审查）`);
  m.tasks = m.tasks || [];
  const t = { no: `T${String(m.tasks.length + 1).padStart(3, '0')}`, title, owner, checker: checker || '', type, skill, status: '执行中', rework: 0, createdAt: new Date().toISOString() };
  m.tasks.push(t); saveBase(base, data); return t;
}
export function reviewTask(base, id, no, { reviewer, verdict, note = '' }) {
  const { data, m } = getMeeting(base, id);
  const t = (m.tasks || []).find((x) => x.no === no);
  if (!t) throw new Error(`任务不存在：${no}`);
  if (reviewer === t.owner) throw new Error('检查人不能是原作者，不能直接改原作者文件，只能写意见 + 测试结果');
  if (verdict === 'rework') {
    t.rework += 1;
    if (t.rework > 2) { t.status = '开会中'; t.note = '返工两次还不行，回到开会中开短会，不无限循环、不悄悄换人重做'; }
    else t.status = '执行中';
  } else if (verdict === 'pass') t.status = '待交付';
  t.review = { reviewer, verdict, note, at: new Date().toISOString() };
  saveBase(base, data); return t;
}
// 技能开关：手动一律先审查、给具体原因、人工拍板才生效；自动只提议不悄悄开且受手动锁约束。
export function proposeSkill(base, id, skill, { suggestOn, reasonFor, reasonAgainst }) {
  const { data, m } = getMeeting(base, id);
  if (!SKILLS[skill]) throw new Error(`未知技能：${skill}`);
  m.skills = m.skills || Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, { on: false, locked: false, reviewed: false, reason: '' }]));
  const s = m.skills[skill];
  if (s.locked) return { skill, proposal: null, blocked: '手动锁已锁，自动提议不生效' };
  s.proposal = { suggestOn, reasonFor, reasonAgainst, at: new Date().toISOString() };
  saveBase(base, data); return { skill, proposal: s.proposal };
}
export function decideSkill(base, id, skill, decision, reason = '') {
  // decision: follow-proposal | follow-original | cancel
  const { data, m } = getMeeting(base, id);
  m.skills = m.skills || Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, { on: false, locked: false, reviewed: false, reason: '' }]));
  const s = m.skills[skill];
  if (decision === 'cancel') { s.proposal = null; saveBase(base, data); return { skill, on: s.on, decision }; }
  if (decision === 'follow-proposal') s.on = !!s.proposal?.suggestOn;
  else if (decision === 'follow-original') s.on = !s.on; // 按原意执行：与当前状态相反的显式人工选择，须有 reason
  else throw new Error('decision 只能是 follow-proposal / follow-original / cancel');
  s.reviewed = true; s.reason = reason; s.proposal = null; s.locked = false;
  saveBase(base, data); return { skill, on: s.on, decision };
}
export function lockSkill(base, id, skill, locked = true) {
  const { data, m } = getMeeting(base, id);
  m.skills = m.skills || Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, { on: false, locked: false, reviewed: false, reason: '' }]));
  m.skills[skill].locked = locked; saveBase(base, data); return m.skills[skill];
}
// 总结 + 深链：日常只发编号 + 总结 + 深链，不发全文。
export function summary(base, id) {
  const { m } = getMeeting(base, id);
  return {
    topic: m.id, title: titleOf(m), status: m.status || '待开会', seats: seatsOf(m), next: nextSeat(m),
    messageCount: (m.messages||[]).length, taskCount: (m.tasks||[]).length,
    deepLink: `02_会议记录/${m.id}/会议总结.md`,
    preview: (m.messages||[]).slice(-3).map((x) => ({ speaker: x.speaker, text: String(x.text||'').slice(0, 150) })),
  };
}
// Orca 式 worktree 隔离（点子借鉴，不复制 Orca 代码）：只隔离并行代码任务，只合并赢家，合并前用户看 diff，会议数据不进 worktree。
export function worktreePath(base, topicId, seat) {
  return path.join(base, 'worktrees', topicId, seat);
}
export function createWorktree(base, topicId, seat) {
  const dir = worktreePath(base, topicId, seat);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), `# Worktree：${seat} / ${topicId}\n\n- 只写本席位文件夹，不写别人的 worktree、不写 shared/integration/final、不写 05_铁律。\n- 会议数据不进 worktree，worktree 里只放代码任务产出。\n- 合并前用户必须看 diff，只合并赢家，输家 diff 留档不删。\n`);
  return dir;
}
