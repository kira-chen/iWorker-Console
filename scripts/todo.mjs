#!/usr/bin/env node
/**
 * 跨人待办自动流转（docs/产品经理待办任务/<人>.md）
 * ============================================================================
 * 【这是什么】
 * 待办文件分「## 待处理」「## 已处理」两张表。处理完一条待办的人**不手改文件**，
 * 只在 commit 说明里写 `关闭待办 yuepu#2`（或 `closes yuepu#2` / `done yuepu#2`），
 * 本脚本负责把那一行从「待处理」搬到「已处理」，状态改成「已处理（日期）」。
 *
 * 【谁调用】
 *   1. .githooks/post-commit —— 每次 commit 后自动跑 `close <msgFile>`，搬完 git add 并 amend，
 *      改动并入刚才那条 commit（不用 commit-msg：git 在它之前就定好了树，那时 add 进不去）。
 *   2. CI（.github/workflows/ci.yml）—— 对本次推送的每条 commit 跑 `verify`，
 *      说了关闭却没搬的（比如本地没装钩子）直接红，防止状态与事实脱节。
 *   3. 人工 —— `node scripts/todo.mjs close-id yuepu#2` 可手动补搬。
 *
 * 【用法】
 *   node scripts/todo.mjs close <commit-msg-file>     解析文件里的关闭标记并搬行
 *   node scripts/todo.mjs close-id yuepu#2 [clcao#1]  直接按 id 搬行
 *   node scripts/todo.mjs verify <commit-msg-text>    只校验：标记指向的行必须已在「已处理」表，否则 exit 1
 *
 * 只依赖 Node 内置模块；文件是普通 markdown 表格，逐行文本处理，不引 markdown 解析库。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(ROOT, 'docs/产品经理待办任务')
const PEOPLE = ['slchen', 'clcao', 'dysun', 'yuepu']

// 关闭标记：中文「关闭待办 / 完成待办」或英文 closes / close / done，后接 人#序号，可多个
const MARK_RE = /(?:关闭待办|完成待办|closes?|done)\s*[:：]?\s*([a-z]+)#(\d+)/gi

export function parseMarks(text) {
  const out = []
  for (const m of String(text || '').matchAll(MARK_RE)) {
    const person = m[1].toLowerCase()
    if (PEOPLE.includes(person)) out.push({ person, id: Number(m[2]) })
  }
  return out
}

function todayStr() {
  // 北京时间自然日
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function splitSections(md) {
  const pendIdx = md.indexOf('\n## 待处理')
  const doneIdx = md.indexOf('\n## 已处理')
  if (pendIdx < 0 || doneIdx < 0 || doneIdx < pendIdx) throw new Error('待办文件缺少「## 待处理」「## 已处理」两节')
  return { head: md.slice(0, pendIdx), pend: md.slice(pendIdx, doneIdx), done: md.slice(doneIdx) }
}

const rowRe = (id) => new RegExp(`^\\| ${id} \\| [^|]*\\|.*$`, 'm')

/** 把 person#id 从待处理搬到已处理；返回 'moved' | 'already' | 'missing' */
export function closeOne(person, id, date = todayStr()) {
  const file = resolve(DIR, `${person}.md`)
  if (!existsSync(file)) return 'missing'
  const md = readFileSync(file, 'utf8')
  const { head, pend, done } = splitSections(md)
  if (rowRe(id).test(done)) return 'already'
  const m = pend.match(rowRe(id))
  if (!m) return 'missing'
  const row = m[0].replace(/^\| (\d+) \| [^|]* \|/, `| $1 | 已处理（${date}） |`)
  const newPend = pend.replace(m[0] + '\n', '').replace(m[0], '')
  const newDone = done.replace(/\s*$/, '') + '\n' + row + '\n'
  writeFileSync(file, head + newPend + newDone)
  return 'moved'
}

function verify(text) {
  const marks = parseMarks(text)
  const bad = []
  for (const { person, id } of marks) {
    const file = resolve(DIR, `${person}.md`)
    if (!existsSync(file)) { bad.push(`${person}#${id}（无此人的待办文件）`); continue }
    const { done } = splitSections(readFileSync(file, 'utf8'))
    if (!rowRe(id).test(done)) bad.push(`${person}#${id}`)
  }
  return bad
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'close') {
  const text = readFileSync(args[0], 'utf8')
  const marks = parseMarks(text)
  for (const { person, id } of marks) {
    const r = closeOne(person, id)
    const file = `docs/产品经理待办任务/${person}.md`
    if (r === 'moved') {
      execSync(`git add "${file}"`, { cwd: ROOT })
      console.log(`[todo] 已关闭 ${person}#${id} → 搬入「已处理」（${file} 已随本次提交暂存）`)
    } else if (r === 'already') console.log(`[todo] ${person}#${id} 已在「已处理」，跳过`)
    else console.error(`[todo] ⚠ ${person}#${id} 在「待处理」里找不到，未搬（请检查序号）`)
  }
} else if (cmd === 'close-id') {
  for (const a of args) {
    const [, person, id] = a.match(/^([a-z]+)#(\d+)$/) || []
    if (!person) { console.error(`格式应为 人#序号，收到 ${a}`); process.exit(2) }
    console.log(`${a}: ${closeOne(person, Number(id))}`)
  }
} else if (cmd === 'verify') {
  const bad = verify(args.join(' '))
  if (bad.length) {
    console.error(`[todo] ✗ commit 说明写了关闭，但这些待办仍在「待处理」表：${bad.join('、')}\n` +
      '      本地未装钩子时请手动执行：node scripts/todo.mjs close-id <人#序号> 后再提交。')
    process.exit(1)
  }
  console.log('[todo] ✓ 待办状态与 commit 说明一致')
} else {
  console.log('用法见文件头注释'); process.exit(2)
}
