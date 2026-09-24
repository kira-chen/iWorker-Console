#!/usr/bin/env node
/**
 * PRD 各模块文件夹「变更记录.md」自动生成
 * ============================================================================
 * 【这是什么】
 * `docs/PRD/数字员工管理端PRD/` 走 git 直改模式，「git diff 即变更记录」（见 CLAUDE.md
 * 「改动记录」一节）——本脚本不引入新的记录来源，只是把 git log 按模块文件夹过滤后
 * 渲染成一份人可读的列表，方便不熟悉 git 命令的人翻看某个模块改过什么。**内容口径仍是
 * git log，本文件全量重新生成，不追加、不由人手工编辑**（顶部有「请勿手工编辑」提示）。
 *
 * 【范围】docs/PRD/数字员工管理端PRD/ 下所有「直接含 prd*.md」的叶子文件夹（即每份 PRD
 * 正文所在的文件夹，如 03能力/专家、03能力/连接器/MCP），每个文件夹各生成一份
 * 「变更记录.md」，记录该文件夹内任意文件（正文 md + 配图等）的提交历史。
 *
 * 【什么算一条变更】该文件夹（含子路径下的配图等）内任意文件被某次 commit 改动过，就是一行：
 *   日期 | 提交 hash | commit 标题；新→旧排列；「变更记录.md」自身的改动不计（免自我循环）。
 *   逐条细节看 commit 全文（`git show <hash>`），这里只放标题。
 *
 * 【谁调用】
 *   1. .githooks/post-commit —— 每次 commit 后自动跑，若受影响文件夹的记录有变化，
 *      amend 并入刚才那条 commit（与 scripts/todo.mjs 同一套「跑完自动并入」范式）。
 *      钩子由 frontend/package.json 的 prepare 脚本在 `npm install` 时启用（core.hooksPath）。
 *   2. 人工 —— `node scripts/prd-changelog.mjs` 全量重跑；`--check` 只检查是否有
 *      文件夹漏记了提交（不写文件，退出码 1 表示有漏记，供自查用）。
 *
 * 【--check 的口径与为什么没接进 CI】（2026-09-24 浦月定，待办 yuepu#14②）
 *   - 比对时忽略「提交」hash 一列：钩子把变更记录 amend 进本次 commit 后，这条 commit 的 hash 必然变，
 *     记录里写的永远是 amend 前的 hash（天生落后一步，下次有人 commit 时自愈）。只比 日期 + 标题，
 *     才能分辨「hash 自然漂移」和「真漏记了某次提交」（没装钩子的人改了 PRD 没生成记录）。
 *   - 比对时把 CRLF 当 LF：Windows 检出（autocrlf）的文件是 CRLF，而生成内容恒为 LF。
 *   - 没做成 CI 必过步骤：CI 默认浅克隆（git log 只有一条）、PR 事件下检出的是合成的 merge commit
 *     （两边都改过同一 PRD 文件夹时 git log 会多出一行「Merge …」而记录里不可能有），要接需
 *     fetch-depth: 0 并处理合成合并，代价大于收益——记录落后只影响可读性，不影响任何代码/PRD 正确性，
 *     且下一次有人（装了钩子）提交时会自动补齐。所以只作本地自查，不进 CI。
 *
 * 只依赖 Node 内置模块 + git 命令行；不引 markdown 解析库。
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRD_ROOT = resolve(ROOT, 'docs/PRD/数字员工管理端PRD')
const FILE_NAME = '变更记录.md'
const FS = '\x1f' // 字段分隔符（commit subject 里几乎不会出现的控制字符）

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

/** 找出所有「直接含 prd*.md」的叶子模块文件夹（相对 PRD_ROOT 的 POSIX 路径）。 */
function findModuleFolders(dir = PRD_ROOT, acc = []) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const hasPrdMd = entries.some((e) => e.isFile() && /^prd[.\-].*\.md$/i.test(e.name))
  if (hasPrdMd) acc.push(dir)
  for (const e of entries) {
    if (e.isDirectory() && e.name !== '.obsidian') findModuleFolders(join(dir, e.name), acc)
  }
  return acc
}

/** 某模块文件夹的提交历史（新→旧），排除「变更记录.md」自身避免自我循环记录。 */
function logFor(folderAbs) {
  const rel = relative(ROOT, folderAbs).split('\\').join('/')
  const out = git([
    'log', '--date=short', `--format=%ad${FS}%h${FS}%s`,
    '--', rel, `:(exclude)${rel}/${FILE_NAME}`
  ])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [date, hash, subject] = line.split(FS)
      return { date, hash, subject }
    })
}

function render(folderAbs, commits) {
  const rel = relative(PRD_ROOT, folderAbs).split('\\').join('/')
  const lines = [
    `# ${rel} · 变更记录`,
    '',
    '> 本文件由 `scripts/prd-changelog.mjs` 从 `git log` 自动生成并整份覆盖，**请勿手工编辑**；',
    '> 内容口径仍是 git diff/commit（CLAUDE.md「改动记录」），这里只是可读呈现。',
    '> 逐条含义以对应 commit 的完整说明为准：`git show <commit>`。',
    ''
  ]
  if (!commits.length) {
    lines.push('（暂无提交记录）')
  } else {
    lines.push('| 日期 | 提交 | 修改内容 |', '|---|---|---|')
    for (const c of commits) {
      const subject = c.subject.replace(/\|/g, '\\|')
      lines.push(`| ${c.date} | \`${c.hash}\` | ${subject} |`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

// --check 比对时把「提交」hash 一列抹平（原因见头注释「--check 的口径」）
const maskHashes = (text) => text.replace(/\| `[0-9a-f]{4,40}` \|/g, '| `·` |')

function main() {
  const checkOnly = process.argv.includes('--check')
  const folders = findModuleFolders()
  const stale = []
  for (const folderAbs of folders) {
    const commits = logFor(folderAbs)
    const content = render(folderAbs, commits)
    const target = join(folderAbs, FILE_NAME)
    let current = null
    try {
      // Windows 检出（autocrlf）下文件是 CRLF，而生成内容恒为 LF——按 LF 比对，否则本机 --check 永远判「落后」
      current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
    } catch {
      current = null
    }
    if (current === content) continue
    if (checkOnly && current !== null && maskHashes(current) === maskHashes(content)) continue
    stale.push(relative(ROOT, target).split('\\').join('/'))
    if (!checkOnly) writeFileSync(target, content, 'utf8')
  }
  if (checkOnly) {
    if (stale.length) {
      console.log(`[prd-changelog] ${stale.length} 份漏记了提交（忽略 hash 后仍不一致），需重跑 node scripts/prd-changelog.mjs：`)
      stale.forEach((f) => console.log(`  - ${f}`))
      process.exit(1)
    }
    console.log('[prd-changelog] 全部已是最新')
    return
  }
  if (stale.length) {
    console.log(`[prd-changelog] 已更新 ${stale.length} 份：`)
    stale.forEach((f) => console.log(`  - ${f}`))
  } else {
    console.log('[prd-changelog] 全部已是最新，无需更新')
  }
}

main()
