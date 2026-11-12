// ClawChat 式管线（抄思路，不抄 ClawChat / OpenClaw 原代码）：
// 握手、回执、心跳、权限门、入站过滤，全部是协议层，与圆桌真相（meetings.json）分离。
// 托管通道：connect code -> POST /v1/agents/connect/check（预检不花掉）
//   -> POST /v1/agents/connect（返回 agent id / owner id / 对话 id / token 对）
//   -> wss://app.clawling.com/ws：服务器先说 connect.challenge，你回 connect，它回 hello-ok。
// 本地通道：同样三步握手，但目标是本机桥（127.0.0.1:3176），不走 clawling.com，token 只存本机。
// 权限门：两个错误码 + 异步 permission_result 裁决，先等裁决再执行敏感操作；
//   /stop 在队列之前先答；入站先过过滤链，再进业务。
export function handshakeFrames() {
  return [
    { from: 'server', type: 'connect.challenge', note: '服务器先说，带 nonce' },
    { from: 'client', type: 'connect', note: '客户端回，带签名 + 设备元数据 + token/密码（本地通道用 deviceToken）' },
    { from: 'server', type: 'hello-ok', note: '成功；失败为 hello-fail，须按原因处理，不重试死循环' },
  ];
}
export function messageAck(messageId) { return { type: 'message.ack', messageId, at: new Date().toISOString() }; }
// 入站过滤链（简化版，顺序不能乱）：帧分流 -> 权限门 -> 去重 -> 席位闸 -> 顺序闸 -> 落盘闸 -> 回推。
export function inboundFilter({ frame, seatChecked, isSensitive }) {
  if (frame.type === 'heartbeat' || frame.type === 'permission_result' || frame.type === 'typing') return { route: 'frame-first', ok: true };
  if (isSensitive) return { route: 'permission-gate', ok: false, need: 'permission_result 裁决 + 用户拍板 + diff 预览' };
  if (!seatChecked) return { route: 'seat-gate', ok: false, reason: '席位未勾选，不发提示、不烧 token' };
  return { route: 'business', ok: true };
}
export function heartbeatConfig() {
  return { intervalMs: 30000, reconnectBackoffMs: [1000, 3000, 10000, 30000], note: '断线按原因退避重连，不用固定间隔轮询网页拿回复' };
}
// 网关客户端最小实现：用 Node 内置 WebSocket（客户端），只做握手 + 发消息 + 收 ack，不做模型调用。
export async function gatewayHandshake(url, token) {
  // 仅做协议演示：真实连接需对方 Gateway 在线；离线时返回可观测的失败，不伪造成功。
  try {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    return await new Promise((resolve) => {
      const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ ok: false, reason: 'timeout：对方 Gateway 未在线或未响应 connect.challenge' }); }, 5000);
      ws.addEventListener('open', () => {});
      ws.addEventListener('message', (ev) => {
        clearTimeout(t);
        try { ws.close(); } catch {}
        resolve({ ok: true, firstFrame: String(ev.data).slice(0, 200) });
      });
      ws.addEventListener('error', () => { clearTimeout(t); resolve({ ok: false, reason: 'WebSocket 连接失败' }); });
    });
  } catch (e) { return { ok: false, reason: String(e.message || e) }; }
}
