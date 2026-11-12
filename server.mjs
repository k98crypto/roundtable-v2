// 圆桌桥 v2：只监听 127.0.0.1:3176，不开放局域网和公网，不存密钥，不申请额外模型 API key。
// 与旧 WebUI 的 3175 端口错开，避免与现行版冲突；CLI 与桥不能同时写同一个 meetings.json，
// 小新部署时二选一：要么 CLI 主写，要么桥主写，另一方只读。默认桥只读 + 写 jobs 经 CLI 落盘模式见 README。
// 零依赖，只用 Node 内置 http；SSE 推总结 + 深链，不推全文。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBase, summary, nextSeat, titleOf, seatsOf } from './lib/roundtable.mjs';

const BASE = process.env.ROUNDTABLE_BASE || './data';
const PORT = Number(process.env.PORT || 3176);
const VERSION = 'roundtable-v2-20261031';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const clients = new Set();
function push(obj) { const s = `data: ${JSON.stringify(obj)}\n\n`; for (const r of clients) { try { r.write(s); } catch {} } }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/api/version') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ version: VERSION, revision: 1, port: PORT, base: BASE })); return; }
  if (u.pathname === '/api/topics') { const d = loadBase(BASE); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d.meetings.map((m) => ({ id: m.id, title: titleOf(m), status: m.status || '待开会', seats: seatsOf(m), next: nextSeat(m) })))); return; }
  if (u.pathname.startsWith('/api/summary/')) { const id = u.pathname.split('/').pop(); try { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(summary(BASE, id))); } catch (e) { res.writeHead(404); res.end(e.message); } return; }
  if (u.pathname === '/api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); clients.add(res); req.on('close', () => clients.delete(res)); return; }
  if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(__dir, 'public/index.html'), 'utf8')); return; }
  if (u.pathname === '/app.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(fs.readFileSync(path.join(__dir, 'public/app.js'), 'utf8')); return; }
  res.writeHead(404); res.end('not found');
});
server.listen(PORT, '127.0.0.1', () => console.log(`圆桌桥 v2 监听 127.0.0.1:${PORT}，base=${BASE}，版本=${VERSION}`));
// 演示用心跳：每 30 秒推一次版本，不推全文、不轮询网页。
setInterval(() => push({ type: 'heartbeat', version: VERSION, at: new Date().toISOString() }), 30000);
