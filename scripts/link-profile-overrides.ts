/**
 * 构建 profile 链接覆盖:把本地仓库中修改过的 dsh 插件包,以 junction
 * 链接进 `~/.dsh/profiles/web/node_modules`,让 npx 安装的 dsh(rc.6)
 * 运行时优先加载本地构建产物(`lib/client.js`),而非 npm 发布版。
 *
 * 挂在 `pnpm run build` 链尾(package.json `build` 脚本),幂等:
 * 链接已存在且指向正确则保留;指向错误/失效则重建。
 *
 * 为什么不直接 `pnpm dsh web` 从源码跑:tsx 运行时下 vendored loader
 * 解析不了 profile 依赖里的 out-of-tree 链接包(dsh-desktop-version-tab
 * → D:/dshvt),也解析不了运行时动态注册的条目(directory-picker-native);
 * 而 npx 安装版 + profile 内 junction 的组合两条路径都通。
 *
 * 恢复官方 npm 版行为:删除对应 junction 目录,或运行
 * `tsx scripts/link-profile-overrides.ts --unlink`。
 */
import { existsSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OVERRIDES } from './profile-overrides.ts'

const unlinkOnly = process.argv.includes('--unlink')
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileModules = join(dshHome, 'profiles', 'web', 'node_modules')

/** 读取链接当前指向的真实目标;junction 在 Windows 上由 readlinkSync 解析。 */
function currentTarget(link: string): string | undefined {
  try {
    return realpathSync(readlinkSync(link))
  } catch {
    return undefined
  }
}

let kept = 0
let relinked = 0
let removed = 0
const problems: string[] = []

for (const [name, rel] of Object.entries(OVERRIDES)) {
  const target = realpathSync(resolve(repoRoot, rel))
  if (!existsSync(join(target, 'package.json'))) {
    problems.push(`${name}: 仓库内找不到 ${rel}/package.json`)
    continue
  }
  const link = join(profileModules, name)

  if (unlinkOnly) {
    if (existsSync(link)) {
      rmSync(link, { recursive: true, force: true })
      removed += 1
    }
    continue
  }

  mkdirSync(dirname(link), { recursive: true })
  if (currentTarget(link) === target) {
    kept += 1
    continue
  }
  if (existsSync(link)) rmSync(link, { recursive: true, force: true })
  // Windows junction 无需管理员权限;类 POSIX 平台退化为符号链接
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  relinked += 1
}

if (problems.length > 0) {
  console.error(`link-profile-overrides: ${problems.join('; ')}`)
  process.exit(1)
}

const action = unlinkOnly ? 'removed' : 'linked'
console.log(
  `link-profile-overrides: ${action} → ${profileModules}`
  + ` (kept ${kept}, ${unlinkOnly ? 'removed' : 'relinked'} ${unlinkOnly ? removed : relinked})`
  + Object.keys(OVERRIDES).map(n => `\n  ${n}`).join(''),
)
