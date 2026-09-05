// Web UI 回归验证:固化本地定制点的浏览器断言(替代手动 agent-browser 验证)。
//
// 覆盖本地 junction 定制的两个可见行为:
//   1. Session log 按钮已移除(页面无 "Session log" 文案)
//   2. 聊天滚动条"靠近显示":未 hover 时 thumb 透明,hover 后恢复颜色
//
// 已知约束(agent-browser 会话约 5s 空闲即被重置为 about:blank):
// 全部命令经本脚本 spawnSync 连续执行,间隔毫秒级,不触发重置。
// 断言代码用 base64 传递(eval -b),避开多层引号转义。
//
// 前置:dsh web 服务已在 http://127.0.0.1:3080 运行(未启动则报错退出)。
// 用法:pnpm run verify:web
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'

const URL_BASE = 'http://127.0.0.1:3080'
const SCROLL_SEL = '[data-conversation-scroll]'
const SHOT = 'dist/web-ui-verify.png'

// timeout 兜底:agent-browser 经 node spawn 首连守护进程可能迟滞,防脚本挂死
function ab(args, label, timeoutMs = 45_000) {
  const r = spawnSync('agent-browser', args, { encoding: 'utf8', shell: true, timeout: timeoutMs })
  const out = (r.stdout + r.stderr).trim()
  if (r.status !== 0 || !out) {
    console.error(`✗ ${label} 失败: ${out || `超时(${timeoutMs}ms)无输出`}`)
    process.exit(1)
  }
  return out
}

const b64 = (js) => Buffer.from(js).toString('base64')

// ---------- 前置:服务可达 ----------
await new Promise((resolve) => {
  const sock = createConnection({ host: '127.0.0.1', port: 3080, timeout: 1500 })
  sock.once('connect', () => { sock.destroy(); resolve(true) })
  sock.once('error', () => resolve(false))
  sock.once('timeout', () => { sock.destroy(); resolve(false) })
}).then((up) => {
  if (!up) {
    console.error(`✗ dsh 服务未运行(${URL_BASE});先启动:npx -y @deepseek-ai/dsh@<ver> web`)
    process.exit(1)
  }
})

// ---------- 执行 ----------
ab(['open', URL_BASE], 'open')
ab(['wait', '--load', 'networkidle'], 'wait')

const initial = ab(
  ['eval', '-b', b64(`JSON.stringify({
    hasSessionLog: document.body.innerText.includes('Session log'),
    hasScroll: !!document.querySelector('${SCROLL_SEL}'),
    thumbVar: getComputedStyle(document.querySelector('${SCROLL_SEL}')).getPropertyValue('--dsh-scrollbar-thumb').trim(),
    thumbBg: getComputedStyle(document.querySelector('${SCROLL_SEL}'), '::-webkit-scrollbar-thumb').backgroundColor,
  })`)],
  '初始状态断言',
)

ab(['find', 'first', SCROLL_SEL, 'hover'], 'hover')

const hovered = ab(
  ['eval', '-b', b64(`getComputedStyle(document.querySelector('${SCROLL_SEL}')).getPropertyValue('--dsh-scrollbar-thumb').trim()`)],
  'hover 后断言',
)

try { mkdirSync('dist', { recursive: true }) } catch { /* 已存在 */ }
ab(['screenshot', SHOT], 'screenshot')

// ---------- 判定 ----------
const init = JSON.parse(JSON.parse(initial)) // eval 输出为带引号 JSON 字符串
const hoverVar = JSON.parse(hovered)
const checks = [
  ['Session log 按钮已移除', !init.hasSessionLog],
  ['聊天滚动容器存在', init.hasScroll],
  ['未 hover 时 thumb 透明', init.thumbVar === 'transparent' || init.thumbBg === 'rgba(0, 0, 0, 0)'],
  ['hover 后 thumb 显色', hoverVar !== 'transparent' && hoverVar !== '' && hoverVar !== 'rgba(0, 0, 0, 0)'],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) failed += 1
}
console.log(`截图: ${SHOT}`)
if (failed) {
  console.error(`verify-web-ui: ${failed} 项未通过`)
  process.exit(1)
}
console.log('verify-web-ui: 全部通过')
