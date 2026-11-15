#!/usr/bin/env node
// Codex Worker：接 Ticket → codex exec headless（只读沙箱）→ 写自己名下目录 → 产出 + 回执。
// 铁律：只写 Agent输出\Codex\ 自己名下目录；绝不直接写 meetings.json；不调用付费 API。
// 用法：node codex-worker.mjs <ticket.json>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as L from './superagent-lib.mjs';

const CODEX_TIMEOUT_MS = 600000;
const CODEX_OUT_DIR = path.join(L.DATA_ROOT, 'Agent输出', 'Codex');
const CODEX_EXEC = 'codex exec --json --ephemeral --sandbox read-only --skip-git-repo-check -c model_reasoning_effort="high" -';
function codexEnvironment() {
  const env = { ...process.env };
  // Codex uses its normal local provider/login setup; never expose Feishu credentials to the CLI.
  for (const key of Object.keys(env)) {
    if (key.startsWith('FEISHU_')) delete env[key];
  }
  return env;
}

function redactError(value) {
  return String(value || '')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})\b/gi, '[已隐藏密钥]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|token|secret)\s*[:=]\s*)\S+/gi, '$1[已隐藏]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
    .slice(0, 800);
}

function runCodex(prompt) {
  const result = spawnSync(CODEX_EXEC, {
    input: prompt,
    shell: true,
    encoding: 'utf8',
    timeout: CODEX_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: codexEnvironment(),
    windowsHide: true,
  });
  if (result.error) throw new Error(`codex exec 启动/执行失败：${result.error.message}`);
  const output = (result.stdout || '').trim();
  if (result.status !== 0) {
    throw new Error(`codex exec 退出码 ${result.status}：${redactError(result.stderr || '')}`);
  }

  let finalText = '';
  let usage = null;
  for (const line of output.split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
      finalText = event.item.text;
    }
    if (event.type === 'turn.completed' && event.usage) usage = event.usage;
  }
  if (!finalText) finalText = output.slice(-2000); // JSON 事件缺少最终文本时，同 dsh Worker 一样取 stdout 尾部。
  if (!finalText) throw new Error('codex exec 成功退出，但没有返回最终文本');
  return { finalText, usage };
}

function main() {
  const ticketPath = process.argv[2];
  if (!ticketPath) { console.error('用法：node codex-worker.mjs <ticket.json>'); process.exit(2); }
  const ticket = L.readTicket(ticketPath, 'codex');
  const seat = L.loadSeatConfig('codex');

  // 输入文件由 Worker 读取，不把全文放入 Ticket；与 dsh Worker 保持一致，最多 8000 字。
  let inputText = '';
  if (ticket.inputFile) {
    if (!fs.existsSync(ticket.inputFile)) throw new Error(`输入文件不存在：${ticket.inputFile}`);
    inputText = fs.readFileSync(ticket.inputFile, 'utf8').slice(0, 8000);
  }
  const prompt = [ticket.description, inputText ? `\n\n输入文件内容（${ticket.inputFile}）：\n${inputText}` : ''].join('').trim();

  const { finalText, usage } = runCodex(prompt);
  const inputTokens = Number(usage?.input_tokens) || Math.ceil(prompt.length / 1.6);
  const outputTokens = Number(usage?.output_tokens) || Math.ceil(finalText.length / 1.6);
  const totalTokens = inputTokens + outputTokens;

  // 只写 Codex 自己名下目录；Writer 仍是唯一写入 meetings.json 的路径。
  const outDir = path.join(CODEX_OUT_DIR, ticket.topicId);
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, '产出.md');
  fs.writeFileSync(outputFile, `# Codex 产出：${ticket.topicId}\n\nTicket：${ticket.id}\n任务：${ticket.description}\n\n${finalText}\n`, 'utf8');

  const conclusion = finalText.replace(/\s+/g, ' ').slice(0, 200);
  const receipt = {
    ticketId: ticket.id,
    topicId: ticket.topicId,
    worker: 'codex',
    status: 'done',
    model: seat.model,
    outputFile,
    conclusion,
    needsFollowUp: conclusion.length === 0,
    inputTokens,
    outputTokens,
    totalTokens,
    estRmb: 0,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, '回执.json'), JSON.stringify(receipt, null, 2), 'utf8');
  console.log(JSON.stringify(receipt, null, 2));
}

try { main(); } catch (error) {
  console.error(`codex-worker 失败：${redactError(error?.message || 'unknown error')}`);
  process.exit(1);
}
