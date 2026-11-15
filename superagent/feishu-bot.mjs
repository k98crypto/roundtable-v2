#!/usr/bin/env node
// 飞书入口：群消息 → Ticket → 对应 Worker → Writer/processJobs → 群回复（总结 + 全文）。
// 铁律：meetings.json 只由 Writer 经 processJobs 写；飞书只作入口；密钥只留进程内存。
// 仅使用 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_ALLOWED_CHAT_ID 环境变量，不读配置文件。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getMeeting } from '../lib/roundtable.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ID = process.env.FEISHU_APP_ID || '';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const ALLOWED_CHAT_ID = process.env.FEISHU_ALLOWED_CHAT_ID || '';
const DATA_ROOT = 'D:\\圆桌会议';
const DSH_OUT_DIR = path.join(DATA_ROOT, 'Agent输出', 'dsh');
const CODEX_OUT_DIR = path.join(DATA_ROOT, 'Agent输出', 'Codex');
const WORKER_MAP = Object.freeze({
  dsh: { script: 'dsh-worker.mjs', outDir: DSH_OUT_DIR },
  codex: { script: 'codex-worker.mjs', outDir: CODEX_OUT_DIR },
});
const TICKETS_DIR = path.join(DSH_OUT_DIR, 'tickets');
const LOG_PATH = path.join(HERE, 'feishu-bot.log');
const MAX_TEXT_BYTES = 26000;

let accessToken = '';
let accessTokenExpiresAt = 0;
let accessTokenPromise = null;
let wsClient = null;
let workQueue = Promise.resolve();
const seenMessageIds = new Set();

// ---- 1. 消息 → Ticket（本地可测，不依赖飞书）----
// 约定群里消息：第一行以议题 id 开头（其后同段文字并入任务描述），后续行可带“派给:”“截止:”“优先级:”。
export function parseTicket(text, from = 'feishu-group') {
  const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const first = lines[0] || '';
  const m = first.match(/^([A-Za-z0-9][A-Za-z0-9-]*)/);
  const topicId = m ? m[1] : '';
  if (!topicId) return { error: `第一行必须以议题 id 开头（收到：${first || '空'}）` };
  const firstRest = first.slice(topicId.length).trim();
  const rest = [firstRest, ...lines.slice(1)].filter(Boolean);
  const seat = (rest.find((s) => s.startsWith('派给:')) || '').replace(/^派给:\s*/, '') || 'main';
  const deadline = (rest.find((s) => s.startsWith('截止:')) || '').replace(/^截止:\s*/, '') || '';
  const priority = (rest.find((s) => s.startsWith('优先级:')) || '').replace(/^优先级:\s*/, '') || 'normal';
  const description = rest.filter((s) => !/^(派给|截止|优先级):/.test(s)).join(' ').trim();
  return {
    id: `T-${Date.now()}`, topicId, description: description || '（未填任务描述）',
    seat, deadline, priority, status: 'dispatched', from,
  };
}

// 议题上下文：标题 + 最近 3 条讨论（各截 120 字）。
// dsh 建议（2026-11-15）：群里短句任务描述只有几个字，Worker 得自己翻仓库找上下文；入队前附上，Worker 不用再翻。
export function buildTopicContext(meeting) {
  if (!meeting) return '';
  const parts = [];
  if (meeting.topic) parts.push(`议题：${String(meeting.topic).replace(/\s+/g, ' ').slice(0, 120)}`);
  const messages = Array.isArray(meeting.messages) ? meeting.messages.slice(-3) : [];
  for (const msg of messages) {
    const text = String(msg?.text || '').replace(/\s+/g, ' ').slice(0, 120);
    if (text) parts.push(`${msg?.speaker || '发言'}：${text}`);
  }
  return parts.length ? `【议题上下文】\n${parts.join('\n')}` : '';
}

function scrubSecrets(input) {
  let value = String(input || '')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKLT[A-Za-z0-9-]+|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})\b/gi, '[已隐藏密钥]')
    .replace(/\b(?:app[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[凭据字段已隐藏]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[JWT 已隐藏]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[私钥已隐藏]')
    .replace(/05_铁律|铁律原文/g, '（铁律原文不推送）');
  for (const secret of [APP_SECRET, accessToken]) {
    if (secret) value = value.split(secret).join('[已隐藏密钥]');
  }
  return value;
}

// ---- 2. 回执 → 群回复（总结 + 全文，过滤密钥/铁律）----
export function formatReply(receipt, fullText = '') {
  const summary = scrubSecrets(receipt.conclusion || receipt.reason || '（无结论）');
  const body = scrubSecrets(fullText || summary);
  // 全文=产出正文；不推 key、不推铁律原文。
  return `【${receipt.topicId || ''}】${summary}\n\n${body}`;
}

function redactLog(value) {
  return scrubSecrets(String(value || '').replace(/wss?:\/\/\S+/gi, '[WebSocket URL 已隐藏]')).slice(0, 800);
}

function log(message) {
  fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${redactLog(message)}\n`, 'utf8');
}

function extractText(event) {
  const message = event?.message;
  if (!message || message.message_type !== 'text' || typeof message.content !== 'string') return '';
  try {
    const parsed = JSON.parse(message.content);
    return typeof parsed.text === 'string' ? parsed.text : '';
  } catch {
    return '';
  }
}

function persistTicket(ticket, sourceMessageId) {
  fs.mkdirSync(TICKETS_DIR, { recursive: true });
  // Feishu 可能重投事件；以 message_id 对持久化 Ticket 做幂等检查。
  for (const name of fs.readdirSync(TICKETS_DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(TICKETS_DIR, name), 'utf8'));
      if (existing.sourceMessageId === sourceMessageId) return { path: path.join(TICKETS_DIR, name), duplicate: true };
    } catch { /* 不覆盖或删除既有队列文件；略过无法解析的文件。 */ }
  }
  ticket.id = `T-${Date.now()}-${randomUUID()}`;
  ticket.sourceMessageId = sourceMessageId;
  const file = path.join(TICKETS_DIR, `${Date.now()}-${ticket.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ticket, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { path: file, duplicate: false };
}

function codexChildEnvironment() {
  const env = { ...process.env };
  // Keep Codex's configured provider/login environment; Feishu credentials never leave this process.
  for (const key of Object.keys(env)) {
    if (key.startsWith('FEISHU_')) delete env[key];
  }
  return env;
}

function spawnNode(script, args, sourceEnv = process.env) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...sourceEnv };
    // dsh-worker forwards its process environment to dsh headless; never let Feishu credentials escape this process.
    delete childEnv.FEISHU_APP_ID;
    delete childEnv.FEISHU_APP_SECRET;
    delete childEnv.FEISHU_ALLOWED_CHAT_ID;
    const child = spawn(process.execPath, [script, ...args], {
      cwd: HERE, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: childEnv,
    });
    const stderr = [];
    let stderrBytes = 0;
    child.stderr.on('data', (chunk) => {
      if (stderrBytes >= 6000) return;
      const kept = Buffer.from(chunk).subarray(0, 6000 - stderrBytes);
      stderr.push(kept);
      stderrBytes += kept.length;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        const suffix = detail ? `; stderr: ${redactLog(detail)}` : '';
        reject(new Error(`${path.basename(script)} exited (${code ?? signal ?? 'unknown'})${suffix}`));
      }
    });
  });
}

function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

async function processTicket(ticketPath, ticket, chatId) {
  try {
    const worker = WORKER_MAP[ticket.seat];
    if (!worker) throw new Error('Ticket 指向未配置的 Worker');
    log(`Ticket ${ticket.id}: worker start; topic=${ticket.topicId}; seat=${ticket.seat}`);
    const childEnv = ticket.seat === 'codex' ? codexChildEnvironment() : process.env;
    await spawnNode(path.join(HERE, worker.script), [ticketPath], childEnv);
    const receiptPath = path.join(worker.outDir, ticket.topicId, '回执.json');
    if (!fs.existsSync(receiptPath)) throw new Error('Worker 完成但未找到回执文件');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.ticketId !== ticket.id) throw new Error('回执 Ticket ID 与当前任务不一致');

    // 唯一写盘入口：调用现有 Writer，由 Writer 经 enqueueWorkerReceiptJob + processJobs 落盘。
    await spawnNode(path.join(HERE, 'writer.mjs'), [receiptPath]);

    let fullText = '';
    if (receipt.status === 'done' && receipt.outputFile && isInside(worker.outDir, receipt.outputFile)) {
      fullText = fs.readFileSync(receipt.outputFile, 'utf8');
    }
    await sendText(chatId, formatReply(receipt, fullText));
    log(`Ticket ${ticket.id}: Writer complete; reply sent; topic=${ticket.topicId}`);
  } catch (error) {
    log(`Ticket ${ticket.id}: processing failed; ${redactLog(error?.message || 'unknown error')}`);
    // 详细诊断仅在本目录日志中；群里不回显 Worker/Writer stderr 或潜在敏感输出。
    try { await sendText(chatId, `【${ticket.topicId}】任务处理未完成，请查看 superagent\\feishu-bot.log；Ticket ${ticket.id}。`); }
    catch (sendError) { log(`Ticket ${ticket.id}: failure notice send failed; ${redactLog(sendError?.message)}`); }
  }
}

function enqueueTicket(ticketPath, ticket, chatId) {
  // 串行运行，避免 dsh-worker 对同一议题的固定“回执.json”发生并发覆盖。
  workQueue = workQueue.then(() => processTicket(ticketPath, ticket, chatId));
}

function chunkText(text, maxBytes = MAX_TEXT_BYTES) {
  const chunks = [];
  let current = '';
  let bytes = 0;
  for (const char of String(text)) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > maxBytes && current) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt - 5 * 60 * 1000) return accessToken;
  if (accessTokenPromise) return accessTokenPromise;
  accessTokenPromise = (async () => {
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || result.code !== 0 || !result.app_access_token) {
      throw new Error(`获取 app_access_token 失败（HTTP ${response.status}，code=${result.code ?? 'unknown'}）`);
    }
    accessToken = result.app_access_token;
    accessTokenExpiresAt = Date.now() + Math.max(60, Number(result.expire) || 7200) * 1000;
    return accessToken;
  })().finally(() => { accessTokenPromise = null; });
  return accessTokenPromise;
}

async function sendText(chatId, text) {
  const chunks = chunkText(text);
  for (let i = 0; i < chunks.length; i++) {
    const content = chunks.length === 1 ? chunks[i] : `（${i + 1}/${chunks.length}）\n${chunks[i]}`;
    const token = await getAccessToken();
    const query = new URLSearchParams({ receive_id_type: 'chat_id' });
    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?${query}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: content }) }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      throw new Error(`发送飞书消息失败（HTTP ${response.status}，code=${result.code ?? 'unknown'}）`);
    }
  }
}

function handleMessage(data) {
  const message = data?.message;
  const chatId = message?.chat_id;
  const senderType = data?.sender?.sender_type || data?.event?.sender?.sender_type;
  const messageId = message?.message_id;
  // 只接受明确配置的群、群聊文本、用户发言；其他会话/机器人消息一律忽略。
  if (!chatId || chatId !== ALLOWED_CHAT_ID || message?.chat_type !== 'group' || senderType !== 'user') return;
  if (!messageId || seenMessageIds.has(messageId)) return;
  seenMessageIds.add(messageId);
  if (seenMessageIds.size > 10000) seenMessageIds.clear();

  const text = extractText(data);
  if (!text) return;
  const ticket = parseTicket(text);
  if (ticket.error) {
    void sendText(chatId, '飞书消息未生成 Ticket：第一行必须以议题 id 开头。').catch((error) => log(`拒绝消息的提示发送失败：${redactLog(error?.message)}`));
    return;
  }
  if (!WORKER_MAP[ticket.seat]) {
    void sendText(chatId, `【${ticket.topicId}】当前支持的可执行 Worker 为 dsh、codex；未改派。请在消息中明确写“派给:dsh”或“派给:codex”。`).catch((error) => log(`席位提示发送失败：${redactLog(error?.message)}`));
    log(`Ticket not dispatched; unsupported seat; topic=${ticket.topicId}`);
    return;
  }
  let meeting = null;
  try {
    ({ m: meeting } = getMeeting(DATA_ROOT, ticket.topicId));
  } catch {
    void sendText(chatId, `【${ticket.topicId}】议题不存在；Ticket 未入队，也未启动 Worker。`).catch((error) => log(`议题校验提示发送失败：${redactLog(error?.message)}`));
    log(`Ticket rejected; topic does not exist: ${ticket.topicId}`);
    return;
  }
  // 入队前把议题上下文附在任务描述前，短句任务也不用 Worker 自己翻仓库。
  const topicContext = buildTopicContext(meeting);
  if (topicContext) ticket.description = `${topicContext}\n\n${ticket.description}`;

  try {
    const persisted = persistTicket(ticket, messageId);
    if (persisted.duplicate) {
      log(`Duplicate Feishu event ignored; topic=${ticket.topicId}`);
      return;
    }
    log(`Ticket ${ticket.id} persisted; topic=${ticket.topicId}; seat=dsh`);
    enqueueTicket(persisted.path, ticket, chatId);
  } catch (error) {
    log(`Ticket persistence failed; ${redactLog(error?.message)}`);
    void sendText(chatId, `【${ticket.topicId}】Ticket 未能写入现有 tickets 队列；未启动 Worker。请查看 superagent\\feishu-bot.log。`).catch((sendError) => log(`Ticket failure notice send failed; ${redactLog(sendError?.message)}`));
  }
}

async function startTransport() {
  if (!APP_ID || !APP_SECRET) {
    console.error('飞书未启动：FEISHU_APP_ID / FEISHU_APP_SECRET 未配置在当前进程环境中。');
    return false;
  }
  if (!ALLOWED_CHAT_ID) {
    console.error('飞书未启动：缺少 FEISHU_ALLOWED_CHAT_ID（目标群 chat_id 白名单）；不会监听未指定群。');
    return false;
  }

  // 延迟加载 SDK：保留 `--self-test` 在未配置凭据时的本地验证能力。
  const lark = await import('@larksuiteoapi/node-sdk');
  const silentLogger = Object.freeze({ error() {}, warn() {}, info() {}, debug() {}, trace() {} });
  const dispatcher = new lark.EventDispatcher({ logger: silentLogger }).register({
    'im.message.receive_v1': async (data) => handleMessage(data),
  });
  wsClient = new lark.WSClient({
    appId: APP_ID,
    appSecret: APP_SECRET,
    logger: silentLogger,
    autoReconnect: true,
    onReady: () => log('Feishu long connection ready'),
    onReconnecting: () => log('Feishu long connection reconnecting'),
    onReconnected: () => log('Feishu long connection restored'),
    onError: () => log('Feishu long connection stopped after SDK reconnect attempts'),
  });
  await wsClient.start({ eventDispatcher: dispatcher });
  log('Feishu transport started; target chat allowlist configured');
  console.log('飞书长连接已启动；仅处理白名单群消息。运行日志写入 superagent\\feishu-bot.log。');

  const shutdown = () => {
    try { wsClient?.close({ force: true }); } catch {}
    log('Feishu transport stopped');
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return true;
}

if (process.argv.includes('--self-test')) {
  const t = parseTicket('20261101-01 上线报数：回一句确认\n派给:dsh\n优先级:normal');
  const codexTicket = parseTicket('20261101-01 Codex接线测试\n派给:codex');
  if (codexTicket.error || codexTicket.seat !== 'codex') {
    console.error('Codex派发自检失败');
    process.exitCode = 1;
  }
  const r = formatReply({ topicId: '20261101-01', conclusion: '已接入。sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }, '正文含 sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX 和铁律原文');
  console.log(JSON.stringify({ ticket: t, codexTicket, reply: r }, null, 2));
  console.log('自检：回复中不应出现真实密钥（sk- 已被 [已隐藏密钥] 替换）。');
  const ctx = buildTopicContext({ topic: '确认圆桌会议上线', messages: [{ speaker: '你', text: '飞书接线测试' }] });
  console.log('议题上下文自检：' + JSON.stringify(ctx));
} else if (process.argv.includes('--run')) {
  startTransport().catch((error) => {
    log(`Transport startup failed; ${redactLog(error?.message || 'unknown error')}`);
    console.error('飞书启动失败；详细状态仅写入 superagent\\feishu-bot.log。');
    process.exitCode = 1;
  });
} else if (!APP_ID || !APP_SECRET) {
  console.log('飞书未启动：当前进程未同时检测到 FEISHU_APP_ID 与 FEISHU_APP_SECRET。');
  console.log('设置好环境变量后运行：node feishu-bot.mjs --run');
} else if (!ALLOWED_CHAT_ID) {
  console.log('飞书凭据在当前进程中可用，但目标群未配置。请设置 FEISHU_ALLOWED_CHAT_ID 后运行 --run。');
} else {
  console.log('飞书接线已配置；使用 node feishu-bot.mjs --run 启动长连接。');
}
