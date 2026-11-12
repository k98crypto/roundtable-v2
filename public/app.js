// 圆桌 v2 前端：只读总结 + 深链，点“请 xx 发言”以后是写 jobs 文件（由 CLI/桥落盘），不是去点网页按钮。
// 发言人颜色/标识、正在思考/正在回复状态，复用旧 WebUI 已确认的两点。
async function load() {
  const v = await (await fetch('/api/version')).json();
  document.getElementById('version').textContent = `版本：${v.version}，端口：${v.port}，只监听本机`;
  const topics = await (await fetch('/api/topics')).json();
  document.getElementById('topics').innerHTML = topics.map((t) => `<div><b>${t.id}</b> ${t.title} ｜ 状态：${t.status} ｜ 席位：${t.seats.join('、')} ｜ 下一位：${t.next} <button onclick="showSummary('${t.id}')">看总结+深链</button></div>`).join('') || '暂无议题，先用 CLI new-topic';
  const es = new EventSource('/api/events');
  es.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type !== 'heartbeat') document.getElementById('summary').textContent = JSON.stringify(d); };
}
async function showSummary(id) {
  const s = await (await fetch(`/api/summary/${id}`)).json();
  document.getElementById('summary').innerHTML = `<pre>${JSON.stringify(s, null, 2)}</pre><p>深链：${s.deepLink}（按深链拉原文，不发全文）</p>`;
}
load();
