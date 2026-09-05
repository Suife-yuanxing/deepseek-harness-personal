/**
 * 上游适配体检:评估"本地 fork + profile junction"组合升级到目标 dsh 版本的风险。
 *
 * 背景:本地仅 fork 了 OVERRIDES 里的包(见 profile-overrides.ts),其余包
 * 由 npx 安装的目标版 dsh 提供。上游发新版(如 rc.7)时,junction 里的本地
 * 构建产物仍是旧基线,可能与目标版其余包产生契约漂移。本脚本把已知的
 * 契约面逐项比对,给出 PASS / WARN / FAIL:
 *
 *   A. junction 状态     覆盖包当前已正确链接到仓库目录
 *   B. 本地产物存在     lib/client.js 已构建(先 pnpm run build)
 *   C. 版本漂移         本地 package.json version vs 目标版(信息性)
 *   D. 槽位集合         目标版 ui-conversation 新增的 conversation.* 槽位,
 *                        本地必须同样定义(web-app 可能注入)
 *   E. 滚动条令牌       本地"靠近显示"改造依赖的滚动条契约令牌,
 *                        目标版 ui-theme 必须仍定义
 *   F. 版本 tab 槽位     dshvt 注入的 settings.plugins.tab 在目标版
 *                        ui-settings 中仍存在
 *   G. 上游行为快照      目标版 session-log-export 是否仍注入 Header 槽位
 *                        (仅信息:展示本地覆盖掉了什么)
 *
 * 用法:
 *   pnpm run check:upstream                # 比对 npm latest
 *   pnpm run check:upstream -- 0.1.0-rc.7  # 比对指定版本
 *   pnpm run check:upstream -- --keep      # 保留解压目录人工检查
 *
 * 退出码:存在 FAIL 为 1,否则 0。网络失败同样退出 1。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OVERRIDES } from './profile-overrides.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileModules = join(dshHome, 'profiles', 'web', 'node_modules')

// dsh 家族版本严格同步(rc.2/rc.3/rc.6 全族同版),覆盖包按同版本号拉取
const UI_THEME = '@deepseek-ai/dsh-client-ui-theme'
const UI_SETTINGS = '@deepseek-ai/dsh-client-ui-settings'
const UI_SETTINGS_PLUGINS = '@deepseek-ai/dsh-client-ui-settings-plugins'
const FAMILY: readonly string[] = [...Object.keys(OVERRIDES), UI_THEME, UI_SETTINGS, UI_SETTINGS_PLUGINS]

// dsh-desktop 版本 tab 插件(D:/dshvt)注入的槽位;它不在本仓库,标记硬编码。
// 该槽位由 ui-settings 定义、ui-settings-plugins 渲染,两包并集检查。
const DSHVT_SLOT = 'settings.plugins.tab'

// 滚动条契约令牌:本地"靠近显示"改造依赖的跨包令牌,必须由目标版 ui-theme 定义。
// (ui-conversation 消费的其他 composer/alias 令牌随包自身 fork,自洽,不跨包检查)
const SCROLLBAR_TOKENS = [
  '--dsh-scrollbar-thumb',
  '--dsh-scrollbar-thumb-hover',
  '--dsh-scrollbar-width',
  '--dsw-alias-scrollbar-bg-l1',
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l2',
] as const

type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'INFO'
const results: Array<{ id: string; verdict: Verdict; note: string }> = []
function record(id: string, verdict: Verdict, note: string) {
  results.push({ id, verdict, note })
  const tag = verdict === 'PASS' ? ' ok ' : verdict === 'FAIL' ? 'FAIL' : verdict === 'WARN' ? 'warn' : 'info'
  console.log(`[${tag}] ${id} ${note}`)
}

// ---------- 参数 ----------

const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const targetArg = argv.find(a => !a.startsWith('--'))

// ---------- registry 访问 ----------

type PkgMeta = { versions: Record<string, { dist?: { tarball?: string } }>; 'dist-tags'?: Record<string, string> }

async function fetchMeta(name: string): Promise<PkgMeta> {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`${name}: registry HTTP ${res.status}`)
  return res.json() as Promise<PkgMeta>
}

/** 下载目标版本 tarball 并解压(npm tarball 根目录为 package/),返回解压根。 */
async function fetchPackage(name: string, version: string, tmpRoot: string): Promise<string> {
  const meta = await fetchMeta(name)
  const tarball = meta.versions[version]?.dist?.tarball
  if (!tarball) {
    const available = Object.keys(meta.versions).join(', ')
    throw new Error(`${name}@${version} 不存在(可用:${available})——家族版本可能已不再同步)`)
  }
  const tgz = join(tmpRoot, `${name.replace('@', '').replace('/', '-')}-${version}.tgz`)
  const body = await (await fetch(tarball, { signal: AbortSignal.timeout(120_000) })).arrayBuffer()
  writeFileSync(tgz, Buffer.from(body))
  const dir = join(tmpRoot, `${name.replace('@', '').replace('/', '-')}-${version}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true }) // tar -C 要求目标目录已存在
  const extracted = spawnSync('tar', ['-xzf', tgz, '-C', dir], { encoding: 'utf8' }) // Windows 自带 bsdtar
  if (extracted.status !== 0) throw new Error(`${name}@${version} 解压失败: ${extracted.stderr}`)
  return join(dir, 'package')
}

// ---------- 提取器 ----------

/** FAMILY 清单保证取到;缺失说明抓取层失约,显式失败而非静默非空断言。 */
function familyText(map: Map<string, string>, name: string): string {
  const text = map.get(name)
  if (text === undefined) throw new Error(`目标版包缺失:${name}(FAMILY 清单与抓取结果不一致)`)
  return text
}

/** 读取包 lib/ 产物的全部文本(.js 与 .css,含 host 面 index.js;排除 sourcemap)。 */
function distText(pkgDir: string): string {
  const libDir = join(pkgDir, 'lib')
  if (!existsSync(libDir)) return ''
  return readDirFlat(libDir)
    .filter(f => (f.endsWith('.js') || f.endsWith('.css')) && !f.endsWith('.map'))
    .map(f => readFileSync(f, 'utf8'))
    .join('\n')
}

function readDirFlat(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? readDirFlat(p) : [p]
  })
}

/** 提取 dist 中出现的槽位 ID(如 conversation.session.header.utilities)。 */
function slotIds(text: string): Set<string> {
  return new Set([...text.matchAll(/"(conversation\.[a-z][a-z0-9.-]+)"/g)].map(m => m[1] as string))
}

/** 判断令牌在定义端文本中是否有定义:css `--x:` 形式或 js 引号字符串形式。 */
function definesToken(text: string, token: string): boolean {
  return text.includes(`${token}:`) || text.includes(`'${token}'`) || text.includes(`"${token}"`)
}

// ---------- 主流程 ----------

async function main() {
  // 目标版本:参数或 @deepseek-ai/dsh 的 latest
  const dshMeta = await fetchMeta('@deepseek-ai/dsh')
  const target = targetArg ?? dshMeta['dist-tags']?.latest
  if (!target) throw new Error('无法确定目标版本(npm 无 dist-tags.latest)')
  console.log(`上游适配体检:目标 @deepseek-ai/dsh@${target}\n`)

  const tmpRoot = mkdtempSync(join(homedir(), '.dsh-upstream-check-'))
  try {
    const remote = new Map<string, string>()
    for (const name of FAMILY) remote.set(name, await fetchPackage(name, target, tmpRoot))

    // A/B. junction 状态与本地构建产物
    for (const [name, rel] of Object.entries(OVERRIDES)) {
      const localDir = join(repoRoot, rel)
      const link = join(profileModules, name)
      let pointsTo: string | undefined
      try { pointsTo = realpathSync(readlinkSync(link)) } catch { /* 未链接 */ }
      if (pointsTo === realpathSync(localDir)) record(`A ${name}`, 'PASS', 'junction 正确')
      else record(`A ${name}`, 'WARN', `junction 缺失或指向异常(当前 → ${pointsTo ?? '无'});运行 pnpm run link:profile 重建`)

      if (existsSync(join(localDir, 'lib', 'client.js'))) record(`B ${name}`, 'PASS', 'lib/client.js 存在')
      else record(`B ${name}`, 'FAIL', '缺少 lib/client.js;先 pnpm run build')
    }

    // C. 版本漂移(本地 fork 基线 vs 目标家族版本)
    for (const [name, rel] of Object.entries(OVERRIDES)) {
      const local = JSON.parse(readFileSync(join(repoRoot, rel, 'package.json'), 'utf8')).version
      record(
        `C ${name}`,
        local === target ? 'PASS' : 'WARN',
        `本地 ${local} vs 目标 ${target}(本地基线落后属预期;落后越远,下方 D/E 项越需关注)`,
      )
    }

    // D. 槽位集合:目标版新增槽位本地必须同样定义
    const convName = '@deepseek-ai/dsh-client-ui-conversation'
    const localSlots = slotIds(distText(join(repoRoot, OVERRIDES[convName] as string)))
    const targetSlots = slotIds(distText(familyText(remote, convName)))
    const newUpstream = [...targetSlots].filter(s => !localSlots.has(s))
    const staleLocal = [...localSlots].filter(s => !targetSlots.has(s))
    record(
      `D ${convName} 槽位`,
      newUpstream.length ? 'FAIL' : 'PASS',
      newUpstream.length
        ? `目标版新增槽位本地未定义:${newUpstream.join(', ')}(其余目标版包可能注入,junction 需同步上游再重建)`
        : `无新增(本地 ${localSlots.size} 个 / 目标 ${targetSlots.size} 个)`,
    )
    if (staleLocal.length) record(`D ${convName} 槽位`, 'WARN', `本地独有(上游已删除):${staleLocal.join(', ')}`)

    // E. 滚动条令牌契约:本地"靠近显示"改造依赖的令牌,目标版 ui-theme 必须仍定义
    const themeText = distText(familyText(remote, UI_THEME))
    const missingTokens = SCROLLBAR_TOKENS.filter(t => !definesToken(themeText, t))
    record(
      `E 滚动条令牌(ui-theme@${target})`,
      missingTokens.length ? 'FAIL' : 'PASS',
      missingTokens.length
        ? `不再定义:${missingTokens.join(', ')}(本地 hover 渐显滚动条会失效)`
        : `${SCROLLBAR_TOKENS.length} 个契约令牌全部有定义`,
    )

    // F. dshvt 版本 tab 槽位(ui-settings 定义 / ui-settings-plugins 渲染)
    const slotHostText = distText(familyText(remote, UI_SETTINGS)) + distText(familyText(remote, UI_SETTINGS_PLUGINS))
    record(
      `F dshvt ${DSHVT_SLOT}`,
      slotHostText.includes(DSHVT_SLOT) ? 'PASS' : 'FAIL',
      slotHostText.includes(DSHVT_SLOT) ? '槽位链完整,版本 tab 可注入' : '目标版已移除该槽位,dsh-desktop 版本 tab 将消失',
    )

    // G. 上游行为快照(信息)
    const sleText = distText(familyText(remote, '@deepseek-ai/dsh-session-log-export'))
    const headerStillThere = sleText.includes('conversation.session.header.utilities')
    record(
      'G 上游 session-log-export',
      'INFO',
      headerStillThere
        ? `仍注入 ${'conversation.session.header.utilities'}(Session log 按钮)——本地 junction 继续覆盖抑制`
        : '上游已不再注入 Header 槽位(与本地行为趋同,可考虑撤销该覆盖)',
    )
  } finally {
    if (keep) console.log(`\n解压目录已保留: ${tmpRoot}`)
    else rmSync(tmpRoot, { recursive: true, force: true })
  }

  // 摘要
  const fail = results.filter(r => r.verdict === 'FAIL').length
  const warn = results.filter(r => r.verdict === 'WARN').length
  console.log(`\n摘要:${results.length} 项 —— ${fail} FAIL / ${warn} WARN / 其余通过`)
  if (fail) {
    console.log('结论:存在硬性契约断裂,先修复 FAIL 项再切换 dsh 版本。')
    process.exit(1)
  }
  console.log(warn ? '结论:无硬性断裂;WARN 项建议在切换前人工确认。' : '结论:可以切换。')
}

main().catch((e) => {
  console.error(`check-upstream-compat: ${e.message}`)
  process.exit(1)
})
