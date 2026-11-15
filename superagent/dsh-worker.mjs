#!/usr/bin/env node
// dsh Worker：接 Ticket → 记账熔断 → dsh headless 跑任务 → 写自己名下目录 → 产出 + 回执。
// 铁律：只写 Agent输出\dsh\ 自己名下目录，绝不直接写 meetings.json；key 不读不传（dsh 自己持有）。
// 用法：node dsh-worker.mjs <ticket.json>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as L from './superagent-lib.mjs';

const DSH_CMD = 'D:\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd';
// dsh 建议（2026-11-15）：300 秒会截断长任务并退化成“处理未完成”回执；放宽到 600 秒，复杂任务仍建议拆小。
const DSH_TIMEOUT_MS = 600000;

function main() {
  const ticketPath = process.argv[2];
  if (!ticketPath) { console.error('用法：node dsh-worker.mjs <ticket.json>'); process.exit(2); }
  const ticket = L.readTicket(ticketPath);

  const ledger = L.loadLedger();
  const seat = L.loadSeatConfig(L.DSH_SEAT); // 席位配置现读，改后下次即生效

  // 输入文件：Ticket 只传绝对路径，Worker 自己读（截断防超长）。
  let inputText = '';
  if (ticket.inputFile) {
    if (!fs.existsSync(ticket.inputFile)) throw new Error(`输入文件不存在：${ticket.inputFile}`);
    inputText = fs.readFileSync(ticket.inputFile, 'utf8').slice(0, 8000);
  }
  const prompt = [ticket.description, inputText ? `\n\n输入文件内容（${ticket.inputFile}）：\n${inputText}` : ''].join('').trim();

  // 熔断：派活前估算，超 10 元/天就停派并给回执。
  const budget = L.wouldExceedBudget(ledger, prompt.length);
  if (budget.over) {
    const receipt = {
      ticketId: ticket.id, topicId: ticket.topicId, worker: L.DSH_SEAT, status: 'refused',
      reason: `当日 dsh 花费已达/将超硬上限 ${L.DAILY_CAP_RMB} 元，已停派（本单估算约 ${budget.estRmb.toFixed(4)} 元）`,
      at: new Date().toISOString(),
    };
    writeReceipt(ticket.topicId, receipt);
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  // 跑 dsh headless（--json 拿真实 token usage），任务经 stdin 传入，避免 shell 转义。
  const r = spawnSync(`"${DSH_CMD}" headless --json -`, {
    input: prompt, shell: true, encoding: 'utf8', timeout: DSH_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env },
  });
  if (r.error) throw new Error(`dsh 启动失败：${r.error.message}`);
  const out = (r.stdout || '').trim();
  if (r.status !== 0) throw new Error(`dsh 退出码 ${r.status}：${(r.stderr || '').slice(0, 500)}`);

  // 解析 usage 与最终答案。
  let usage = null;
  let finalText = '';
  for (const line of out.split('\n')) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'final' && ev.text) finalText = ev.text;
    if (ev.type === 'status' && ev.usage) usage = ev.usage;
  }
  if (!finalText) finalText = out.slice(-2000); // 兜底：非 JSON 输出取尾部
  const u = usage || {
    inputTokens: Math.ceil(prompt.length / 1.6),
    outputTokens: Math.ceil(finalText.length / 1.6),
  };
  u.totalTokens = u.totalTokens || (u.inputTokens + u.outputTokens);
  const estRmb = L.estRmbFromTokens(u.inputTokens, u.outputTokens);

  // 写产出到自己名下目录。
  const outDir = path.join(L.DSH_OUT_DIR, ticket.topicId);
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, '产出.md');
  fs.writeFileSync(outputFile, `# dsh 产出：${ticket.topicId}\n\nTicket：${ticket.id}\n任务：${ticket.description}\n\n${finalText}\n`, 'utf8');

  // 记账（真实 usage）。
  L.recordRun(ledger, {
    runId: randomUUID(), ticketId: ticket.id, topicId: ticket.topicId,
    at: new Date().toISOString(),
    inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens,
    estRmb: Number(estRmb.toFixed(4)),
  });

  // 回执（只给产出路径 + 简短结论 + 是否追问，不含全文）。
  const conclusion = finalText.replace(/\s+/g, ' ').slice(0, 200);
  const receipt = {
    ticketId: ticket.id, topicId: ticket.topicId, worker: L.DSH_SEAT, status: 'done',
    model: seat.model, outputFile, conclusion, needsFollowUp: conclusion.length === 0,
    inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens,
    estRmb: Number(estRmb.toFixed(4)), at: new Date().toISOString(),
  };
  writeReceipt(ticket.topicId, receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

function writeReceipt(topicId, receipt) {
  const outDir = path.join(L.DSH_OUT_DIR, topicId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '回执.json'), JSON.stringify(receipt, null, 2), 'utf8');
}

try { main(); } catch (e) { console.error(`dsh-worker 失败：${e.message}`); process.exit(1); }
