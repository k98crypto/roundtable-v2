// 圆桌 v2 本地实测：不连网、不连小新、不动现行版，用临时 data 目录测闸。
// 预期：全部 PASS 才算改造包可用；任何 FAIL 都先修包，不部署到小新。
import fs from 'node:fs';
import { createTopic, post, say, nextSeat, setSeats, createTask, reviewTask, proposeSkill, decideSkill, lockSkill, summary, createWorktree } from '../lib/roundtable.mjs';
import { inboundFilter, handshakeFrames } from '../lib/gateway.mjs';
import { mobileStatus } from '../lib/mobile.mjs';
const base = './data-test';
fs.rmSync(base, { recursive: true, force: true });
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log(`PASS ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const m = createTopic(base, '测试议题');
check('新建议题默认席位', m.seats.join(',') === 'Muse,Codex,Antigravity');
check('下一位初始为 Muse', nextSeat(m) === 'Muse');
const r1 = post(base, m.id, 'Muse', 'Muse 先发');
check('Muse 发言后下一位 Codex', r1.next === 'Codex');
const r2 = say(base, m.id, '用户插话 1');
check('用户 say 不吃 agent 轮次，下一位仍 Codex', r2.next === 'Codex');
let blocked = false; try { post(base, m.id, 'Trae', '未勾选发言'); } catch { blocked = true; }
check('未勾选 Trae post 被拦', blocked);
const seats = setSeats(base, m.id, ['Muse', 'Codex', 'Antigravity', 'Trae']);
check('新增 Trae 只生成追赶摘要预览，不发全文', !!seats.catchUpSummary && seats.catchUpSummary.added.includes('Trae'));
let checkerBlocked = false; try { createTask(base, m.id, { title: 'x', owner: 'Codex', checker: 'Codex' }); } catch { checkerBlocked = true; }
check('检查人不能是原作者', checkerBlocked);
let skillBlocked = false; try { createTask(base, m.id, { title: 'x', owner: 'Codex', checker: 'Muse', type: 'design-audit', skill: 'Impeccable' }); } catch { skillBlocked = true; }
check('技能未开启时带技能任务被拦', skillBlocked);
const p = proposeSkill(base, m.id, 'Impeccable', { suggestOn: true, reasonFor: '审 WebUI 一页', reasonAgainst: 'hook 可能在拒命令时也运行' });
check('技能自动提议只提议不生效', p.proposal && p.proposal.suggestOn === true);
const d = decideSkill(base, m.id, 'Impeccable', 'follow-proposal', '人工拍板：先审一页');
check('人工拍板后技能才开启', d.on === true);
const t = createTask(base, m.id, { title: '审一页', owner: 'Codex', checker: 'Muse', type: 'design-audit', skill: 'Impeccable' });
check('技能开启后带技能任务可建', t.type === 'design-audit');
lockSkill(base, m.id, 'Ponytail', true);
const lp = proposeSkill(base, m.id, 'Ponytail', { suggestOn: true, reasonFor: '', reasonAgainst: '' });
check('手动锁已锁时自动提议不生效', !!lp.blocked);
const rv = reviewTask(base, m.id, t.no, { reviewer: 'Muse', verdict: 'pass', note: 'ok' });
check('检查通过后状态待交付', rv.status === '待交付');
const w = createWorktree(base, m.id, 'Codex');
check('worktree 目录生成', fs.existsSync(w));
check('网关握手三帧', handshakeFrames().map((x) => x.type).join(',') === 'connect.challenge,connect,hello-ok');
check('入站敏感操作走权限门', inboundFilter({ frame: { type: 'message' }, seatChecked: true, isSensitive: true }).route === 'permission-gate');
check('手机状态为 read-mostly', mobileStatus(base, m.id).mobileView.includes('read-mostly'));
check('总结只含深链不含全文', summary(base, m.id).deepLink.includes(m.id));
console.log(`\n合计 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
