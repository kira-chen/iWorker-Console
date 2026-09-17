#!/usr/bin/env node
/**
 * 本地审查门禁（软）：改了 PRD 的批次必须跑过 /prd-import，改了前端代码的批次必须跑过 /test-audit。
 * ============================================================================
 * 【为什么有这个】
 * 这两个审查要读 md、看页面、做判断，是 Claude 在本地干的活，跑不上 CI；审查产物放本地 `.review/`（不入库）。
 * 唯一入库的是技能在收口 commit 说明里写的一行签名：
 *     review: prd-import <基线>..<终点> ok
 *     review: test-audit <范围> ok
 * 本脚本只核「签没签」，不核审查质量——作者对自己的产物负责（2026-09-17 负责人定）。
 *
 * 【软 / 硬】
 * 2026-09-17 起先跑软的：缺签名只打 ::warning:: 提示、不让 CI 红（负责人指示先看大家跑不跑得动）。
 * 要改硬，把下面 STRICT 改 true（或 CI 传 REVIEW_GATE_STRICT=1）即可，其余不动。
 *
 * 【用法】
 *   node scripts/review-gate.mjs <git 范围>      例：node scripts/review-gate.mjs origin/main..HEAD
 */
import { execSync } from 'node:child_process'

const STRICT = process.env.REVIEW_GATE_STRICT === '1'
const range = process.argv[2]
if (!range) { console.error('用法：node scripts/review-gate.mjs <git 范围>'); process.exit(2) }

const sh = (c) => execSync(c, { encoding: 'utf8' }).trim()
const files = sh(`git diff --name-only ${range}`).split('\n').filter(Boolean)
const msgs = sh(`git log --format=%B ${range}`)

const RULES = [
  { name: 'prd-import', touches: (f) => f.startsWith('docs/PRD/') && f.endsWith('.md'), sig: /review:\s*prd-import\b.*\bok\b/i,
    hint: '本批改了 docs/PRD/ 下的 md：开 PR 前请在本地跑 /prd-import（产物落 .review/），技能收口时会在 commit 说明写「review: prd-import <基线>..<终点> ok」' },
  { name: 'test-audit', touches: (f) => f.startsWith('frontend/src/') && !f.includes('__tests__'), sig: /review:\s*test-audit\b.*\bok\b/i,
    hint: '本批改了 frontend/src/ 产品代码：开 PR 前请在本地跑 /test-audit changed（产物落 .review/），技能收口时会在 commit 说明写「review: test-audit <范围> ok」' }
]

let missing = 0
for (const r of RULES) {
  const hit = files.filter(r.touches)
  if (!hit.length) { console.log(`[review-gate] ${r.name}：本批未触及，跳过`); continue }
  if (r.sig.test(msgs)) { console.log(`[review-gate] ${r.name}：已签名 ✓（涉及 ${hit.length} 个文件）`); continue }
  missing++
  const line = `[review-gate] ${r.name}：缺签名——${r.hint}（涉及 ${hit.length} 个文件，如 ${hit[0]}）`
  console.log(STRICT ? `::error::${line}` : `::warning::${line}`)
}
if (missing && STRICT) process.exit(1)
console.log(missing ? `[review-gate] ${missing} 项缺签名（软门禁，仅提示）` : '[review-gate] ✓ 通过')
