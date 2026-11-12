#!/usr/bin/env node
// 圆桌 CLI v2：兼容 v0.5 命令（topics/show/new-topic/post/say/task/seats/next），
// 新增 skill / worktree / mobile / review / handoff / summary。
// 用法（小新 PowerShell 里跑，不要跑进 CMD）：
//   node cli.mjs --base D:\圆桌会议\data topics
//   node cli.mjs --base <base> new-topic "标题" --seats Muse,Codex,Antigravity
//   node cli.mjs --base <base> post <议题ID> --seat Codex "文本"
//   node cli.mjs --base <base> say <议题ID> "文本"
//   node cli.mjs --base <base> next <议题ID>
//   node cli.mjs --base <base> task <议题ID> --title "…" --owner Codex --checker Muse --type design-audit --skill Impeccable
//   node cli.mjs --base <base> skill-propose <议题ID> Impeccable --on --for "…" --against "…"
//   node cli.mjs --base <base> skill-decide <议题ID> Impeccable follow-proposal --reason "…"
//   node cli.mjs --base <base> worktree <议题ID> Codex
//   node cli.mjs --base <base> mobile <议题ID>
//   node cli.mjs --base <base> summary <议题ID>
// 默认 base：./data（本地测试用），小新上须显式传 D:\圆桌会议 相关 data 目录，不要默认覆盖现行版。
import { createTopic, loadBase, getMeeting, post, say, nextSeat, setSeats, createTask, reviewTask, proposeSkill, decideSkill, lockSkill, summary, createWorktree, titleOf, seatsOf } from './lib/roundtable.mjs';
import { mobileStatus, mobileReplyInstructions, hostConfig } from './lib/mobile.mjs';

function arg(name, def = '') { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
function has(name) { return process.argv.includes(name); }
const base = arg('--base', './data');
// 位置参数：去掉所有 --flag 及其取值后剩下的就是 [命令, 议题ID, 其余文本…]，--base 放前放后都能用。
const FLAG_WITH_VALUE = new Set(['--base', '--seats', '--seat', '--title', '--owner', '--checker', '--type', '--skill', '--no', '--reviewer', '--verdict', '--note', '--for', '--against', '--reason']);
const pos = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (FLAG_WITH_VALUE.has(a)) { i++; continue; }
  if (a.startsWith('--')) continue;
  pos.push(a);
}
const cmd = pos[0];
const id = pos[1];
const rest = pos.slice(2);
try {
  if (cmd === 'topics') { console.log(JSON.stringify(loadBase(base).meetings.map((m) => ({ id: m.id, title: titleOf(m), status: m.status || '待开会', seats: seatsOf(m), next: nextSeat(m) })), null, 2)); }
  else if (cmd === 'new-topic') { const title = rest.join(' '); const seats = arg('--seats', '').split(',').filter(Boolean); console.log(JSON.stringify(createTopic(base, title, seats.length ? seats : undefined), null, 2)); }
  else if (cmd === 'show') { const { m } = getMeeting(base, id); console.log(JSON.stringify(m, null, 2)); }
  else if (cmd === 'post') { const seat = arg('--seat'); const text = rest.join(' '); const r = post(base, id, seat, text); if (r.warning) console.log(r.warning); console.log(`下一位：${r.next}`); }
  else if (cmd === 'say') { const text = rest.join(' '); const r = say(base, id, text); console.log(`下一位仍为：${r.next}（用户插话不吃 agent 轮次）`); }
  else if (cmd === 'next') { const { m } = getMeeting(base, id); console.log(nextSeat(m)); }
  else if (cmd === 'seats') { const seats = arg('--seats').split(',').filter(Boolean); console.log(JSON.stringify(setSeats(base, id, seats), null, 2)); }
  else if (cmd === 'task') { const t = createTask(base, id, { title: arg('--title'), owner: arg('--owner'), checker: arg('--checker'), type: arg('--type', 'general'), skill: arg('--skill', '') }); console.log(JSON.stringify(t, null, 2)); }
  else if (cmd === 'review') { const t = reviewTask(base, id, arg('--no'), { reviewer: arg('--reviewer'), verdict: arg('--verdict'), note: arg('--note', '') }); console.log(JSON.stringify(t, null, 2)); }
  else if (cmd === 'skill-propose') { const skill = rest[0]; console.log(JSON.stringify(proposeSkill(base, id, skill, { suggestOn: has('--on'), reasonFor: arg('--for', ''), reasonAgainst: arg('--against', '') }), null, 2)); }
  else if (cmd === 'skill-decide') { const skill = rest[0]; const decision = rest[1]; console.log(JSON.stringify(decideSkill(base, id, skill, decision, arg('--reason', '')), null, 2)); }
  else if (cmd === 'skill-lock') { const skill = rest[0]; console.log(JSON.stringify(lockSkill(base, id, skill, true), null, 2)); }
  else if (cmd === 'worktree') { const seat = rest[0]; console.log(createWorktree(base, id, seat)); }
  else if (cmd === 'mobile') { console.log(JSON.stringify({ status: mobileStatus(base, id), reply: mobileReplyInstructions(), host: hostConfig({ tailscaleIp: '100.x.x.x' }) }, null, 2)); }
  else if (cmd === 'summary') { console.log(JSON.stringify(summary(base, id), null, 2)); }
  else { console.log('用法见文件头注释：topics/show/new-topic/post/say/next/seats/task/review/skill-propose/skill-decide/skill-lock/worktree/mobile/summary'); }
} catch (e) { console.error(`失败：${e.message}`); process.exit(1); }
