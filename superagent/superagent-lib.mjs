// super-agent 共享库：Ticket 字段约定、路径、dsh 记账与熔断。
// 只做账与路径，不读、不写任何 key；key 由 dsh 自己的 .credentials.yaml 持有，本库不碰。
import fs from 'node:fs';
import path from 'node:path';

export const DATA_ROOT = 'D:\\圆桌会议';
export const DSH_SEAT = 'dsh';
export const DSH_OUT_DIR = path.join(DATA_ROOT, 'Agent输出', DSH_SEAT);
export const LEDGER_PATH = path.join(DSH_OUT_DIR, '.ledger.json');
export const TICKETS_DIR = path.join(DSH_OUT_DIR, 'tickets');

// 每日硬上限（人民币），按自然日重置。用户 2026-11-14 拍板：约 10 元/天，硬上限。
export const DAILY_CAP_RMB = 10.0;
// 保守单价（按高峰口径，超估不低估）：¥/百万 token。非高峰约半价、闲时更低，账上只按高峰记。
export const INPUT_RMB_PER_MT = 2.2;
export const OUTPUT_RMB_PER_MT = 8.7;

export function todayKey(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function estRmbFromTokens(inputTokens, outputTokens) {
  return (inputTokens * INPUT_RMB_PER_MT + outputTokens * OUTPUT_RMB_PER_MT) / 1_000_000;
}

export function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return { day: todayKey(), totalRmb: 0, runs: [] };
  const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  if (ledger.day !== todayKey()) return { day: todayKey(), totalRmb: 0, runs: [] };
  return ledger;
}

export function saveLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf8');
}

// 派活前估算：系统开销(约 8k 输入) + prompt 估算 + 输出保守缓冲(4k)，超限停派。
export function wouldExceedBudget(ledger, promptChars) {
  const estInput = 8000 + Math.ceil(promptChars / 1.6);
  const estOutput = 4000;
  const estRmb = estRmbFromTokens(estInput, estOutput);
  return { estRmb, over: ledger.totalRmb + estRmb > DAILY_CAP_RMB };
}

export function recordRun(ledger, entry) {
  ledger.runs.push(entry);
  ledger.totalRmb = ledger.runs.reduce((s, r) => s + (r.estRmb || 0), 0);
  saveLedger(ledger);
}

// 席位模型/思考强度集中配置（seats.json）。每次现读不缓存 → 改后下次运行即生效。
import { fileURLToPath } from 'node:url';
const SEATS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seats.json');
export function loadAllSeats() { return JSON.parse(fs.readFileSync(SEATS_PATH, 'utf8')); }
export function loadSeatConfig(seat) {
  const all = loadAllSeats();
  if (!all[seat]) throw new Error(`未知席位：${seat}`);
  return all[seat];
}

export function readTicket(ticketPath, expectedSeat = DSH_SEAT) {
  const t = JSON.parse(fs.readFileSync(ticketPath, 'utf8'));
  for (const k of ['id', 'topicId', 'description', 'seat']) {
    if (typeof t[k] !== 'string' || !t[k].trim()) throw new Error(`Ticket 缺字段：${k}`);
  }
  if (t.seat !== expectedSeat) throw new Error(`Ticket 派给 ${t.seat}，本 Worker 是 ${expectedSeat}`);
  return t;
}
