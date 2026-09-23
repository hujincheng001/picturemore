/**
 * 把仓库发布到 GitHub。
 *
 * 用法：
 *   GITHUB_TOKEN=<你的 token> node scripts/publish-to-github.mjs pictureMore
 *   GITHUB_TOKEN=<你的 token> node scripts/publish-to-github.mjs pictureMore --private
 *
 * token 需要 `repo` 权限（classic）或 `Administration: write` + `Contents: write`（fine-grained）。
 *
 * **为什么不直接 git push**：push 到远端前得先在 GitHub 上把仓库建出来，
 * 而建仓库只能走 API，git 协议本身做不到。所以这里用 API 建、再用 git 推。
 *
 * 没有 token 也能用：先手动在 GitHub 上建一个**空仓库**（不要勾 README / .gitignore /
 * license，否则会有一个初始提交，push 上去要处理冲突），然后跑：
 *   git remote add origin git@github.com:<你的用户名>/<仓库名>.git
 *   git push -u origin main
 *
 * 见 README 的「上传到 GitHub」一节。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const REPO_NAME = args.find((a) => !a.startsWith('--')) ?? 'picturemore'
const PRIVATE = args.includes('--private')
const TOKEN = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? ''

/** 跑一条命令并把输出原样透出来，失败就抛 */
function run(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function runVisible(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit' })
}

/** 建仓库。已存在时返回 false（不当成失败） */
async function createRepo() {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'picturemore-publish',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: REPO_NAME,
      description: '把「发不出去的图」压到能发出去。Windows 桌面图片压缩工具，完全本地运行。',
      private: PRIVATE,
      // 不自动初始化，避免多出一个初始提交导致 push 被拒
      auto_init: false,
      has_issues: true,
      has_wiki: false,
      has_projects: false
    })
  })

  if (res.status === 201) {
    const body = await res.json()
    return { created: true, fullName: body.full_name, login: body.owner.login }
  }

  const body = await res.json().catch(() => ({}))
  const message = String(body.message ?? '')

  // 已存在：把用户名捞出来继续推
  if (res.status === 422 && /already exists/i.test(message)) {
    const me = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'picturemore-publish' }
    }).then((r) => r.json())
    return { created: false, fullName: `${me.login}/${REPO_NAME}`, login: me.login }
  }

  throw new Error(`建仓库失败（HTTP ${res.status}）：${message}`)
}

// ---- 前置检查 ----
const branch = run('git', ['branch', '--show-current']).trim()
if (branch !== 'main') {
  console.error(`[publish] 当前分支是 ${branch}，期望 main。先跑：git branch -m main`)
  process.exit(1)
}

const dirty = run('git', ['status', '--porcelain']).trim()
if (dirty.length > 0) {
  console.error('[publish] 工作区不干净，先提交或 stash：')
  console.error(dirty)
  process.exit(1)
}

const commitCount = Number(run('git', ['rev-list', '--count', 'HEAD']).trim())
console.log(`[publish] 分支 ${branch}，${commitCount} 个提交，工作区干净`)

if (TOKEN.length === 0) {
  console.error('')
  console.error('[publish] 没找到 token。两条路：')
  console.error('')
  console.error('  一、给一个 token，脚本自动建仓库并推送：')
  console.error('      GITHUB_TOKEN=ghp_xxx node scripts/publish-to-github.mjs pictureMore')
  console.error('      token 在 https://github.com/settings/tokens 生成，勾 repo 权限')
  console.error('')
  console.error('  二、自己在 GitHub 上建一个空仓库（不要勾 README / .gitignore / license），然后：')
  console.error(`      git remote add origin git@github.com:<你的用户名>/${REPO_NAME}.git`)
  console.error('      git push -u origin main')
  console.error('')
  console.error('      这条路需要 SSH 公钥已经加到 GitHub。查看本机公钥：')
  console.error('      cat ~/.ssh/id_rsa.pub')
  process.exit(1)
}

// ---- 建仓库 + 推 ----
const repo = await createRepo()
console.log(
  repo.created
    ? `[publish] 已创建仓库 ${repo.fullName}${PRIVATE ? '（私有）' : '（公开）'}`
    : `[publish] 仓库 ${repo.fullName} 已存在，直接推`
)

// 远端已经配好就用配好的，否则按 https + token 加一个
const existing = run('git', ['remote']).split('\n').map((s) => s.trim())
if (!existing.includes('origin')) {
  const url = `https://x-access-token:${TOKEN}@github.com/${repo.fullName}.git`
  runVisible('git', ['remote', 'add', 'origin', url])
  console.log('[publish] 已添加远端 origin')
}

runVisible('git', ['push', '-u', 'origin', 'main'])

// 推完把 token 从远端地址里摘掉，别把它留在 .git/config 里
const remoteUrl = run('git', ['remote', 'get-url', 'origin']).trim()
if (remoteUrl.includes('@github.com') && remoteUrl.includes('x-access-token')) {
  runVisible('git', ['remote', 'set-url', 'origin', `https://github.com/${repo.fullName}.git`])
  console.log('[publish] 已把 token 从 origin 地址里移除（避免留在 .git/config）')
}

console.log('')
console.log(`[publish] 完成：https://github.com/${repo.fullName}`)
if (!existsSync(resolve(ROOT, 'LICENSE'))) {
  console.log('[publish] 注意：仓库还没有 LICENSE，公开前建议先选一个。')
}
