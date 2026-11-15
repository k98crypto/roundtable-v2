#!/usr/bin/env node
// Writer：唯一写盘方。收 Worker 回执 → 校验产出文件与路径 → enqueue worker-receipt job → process-jobs 落盘。
// 铁律：meetings.json 只有 Writer 经 process-jobs 写，任何 Worker 不直接写。Writer 不调度、不派活。
// 用法：node writer.mjs <回执.json>
import fs from 'node:fs';
import path from 'node:path';
import { enqueueWorkerReceiptJob, processJobs, getMeeting } from '../lib/roundtable.mjs';
import * as L from './superagent-lib.mjs';

const BASE = L.DATA_ROOT;
const WORKER_OUT_DIRS = {
  [L.DSH_SEAT]: L.DSH_OUT_DIR,
  codex: path.join(BASE, 'Agent输出', 'Codex'),
};

function main() {
  const receiptPath = process.argv[2];
  if (!receiptPath) { console.error('用法：node writer.mjs <回执.json>'); process.exit(2); }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const topicId = receipt.topicId;
  if (!topicId) throw new Error('回执缺 topicId');

  // 校验议题存在（经 roundtable 的 getMeeting，不存在即抛错）。
  getMeeting(BASE, topicId);

  const worker = receipt.worker || L.DSH_SEAT;
  let text;
  if (receipt.status === 'refused') {
    text = `【Worker 回执 · 熔断停派】${worker} 未执行议题 ${topicId} 的任务（Ticket ${receipt.ticketId}）。原因：${receipt.reason}`;
  } else {
    const outFile = path.resolve(receipt.outputFile);
    const workerOutDir = WORKER_OUT_DIRS[worker];
    if (!workerOutDir) throw new Error(`未知 Worker 的产出目录：${worker}`);
    const allowedDir = path.resolve(workerOutDir);
    if (!outFile.startsWith(allowedDir + path.sep)) throw new Error(`产出文件逃出 Worker 名下目录：${outFile}`);
    if (!fs.existsSync(outFile)) throw new Error(`产出文件不存在：${outFile}`);
    text = [
      `【Worker 回执】${worker} 完成议题 ${topicId} 的任务（Ticket ${receipt.ticketId}）。`,
      `结论：${receipt.conclusion || '（无）'}`,
      receipt.needsFollowUp ? '需追问。' : '无需追问。',
      `深链：${receipt.outputFile}`,
    ].join('\n');
  }

  // enqueue 进 jobs 队列，再经 processJobs 落盘（与 CLI process-jobs 完全同一函数）。
  const { id: jobId } = enqueueWorkerReceiptJob(BASE, { topicId, worker, text });
  const results = processJobs(BASE);
  const mine = results.find((r) => r.jobId === jobId);
  if (mine?.error) throw new Error(`process-jobs 落盘失败：${mine.error}`);
  console.log(JSON.stringify({ jobId, topicId, worker, wrote: true, result: mine }, null, 2));
}

try { main(); } catch (e) { console.error(`writer 失败：${e.message}`); process.exit(1); }
