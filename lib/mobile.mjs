// Orca 式手机通道（抄思路，不装 Orca 本体）：手机 App 是遥控器，不是完整编辑器，桌面永远是事实源。
// 功能：看状态、看终端回放、回短消息、看源码控制、跑 Quick Commands、切换 Agent 账号、看使用量。
// 连接：优先 Tailscale（小火箭 Tailscale 模组），备用 Orca Relay；主机地址可改，改地址不用重配对，token 不变。
// 默认端口参考 Orca 移动端文档：缺端口默认 6768；圆桌桥本地端口为 3176，手机经 Tailscale 连的是桥的 Tailscale 地址，不是 127.0.0.1。
import { summary, getMeeting } from './roundtable.mjs';
export function mobileStatus(base, topicId) {
  const s = summary(base, topicId);
  return { ...s, mobileView: 'read-mostly：看状态、看回放、回短消息、审 diff、跑 Quick Commands；不直接改铁律、不直接改别人文件' };
}
export function mobileReplyInstructions() {
  return [
    '手机上只回短消息：continue / yes / 自由文本，Agent 等输入时才回。',
    '源码控制：手机上可看 changed files、stage/unstage、commit，合并前必须在桌面看 diff。',
    'Quick Commands：与桌面同步的 saved 命令/提示词列表，手机上点一下就发，不在手机上现编长命令。',
    '账号切换：手机上切换 Agent 账号即切换桌面上的账号，能看到使用量和 rate-limit 状态。',
  ];
}
export function hostConfig({ tailscaleIp, bridgePort = 3176, orcaPort = 6768 }) {
  return {
    tailscale: { address: `${tailscaleIp}:${bridgePort}`, note: '小新 Tailscale IP + 桥端口；改地址不用重配对，token 不变' },
    orcaDirect: { address: `${tailscaleIp}:${orcaPort}`, note: '如直接用 Orca 桌面，默认端口 6768；圆桌桥不用这个端口，不要混' },
    relayFallback: { note: '只有 direct 和 DERP 都不通时才临时切 Relay，那段时间只看状态、不发敏感代码和终端全文' },
    tailscaleInShadowrocket: [
      '小火箭 2.2.89+：配置 → Tailscale，填 Auth Key，启用。',
      '加规则：DOMAIN-WILDCARD,tail*.ts.net,TAILSCALE；DOMAIN-SUFFIX,ts.net,TAILSCALE。',
      '删掉配置 → 常规里 100.64.0.0 那条冲突规则；其余 98k 配置不动，微信/京东/抖音直连不动。',
      '小新侧 Clash：100.64/10、ts.net 走 DIRECT / NO_PROXY，不要走代理。',
    ],
  };
}
export function mobileScrollback(base, topicId, n = 20) {
  const { m } = getMeeting(base, topicId);
  return m.messages.slice(-n).map((x) => ({ speaker: x.speaker, text: x.text.slice(0, 500), at: x.at }));
}
