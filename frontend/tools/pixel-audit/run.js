#!/usr/bin/env node
/**
 * pixel-audit CLI 入口
 * ==========================================================================
 * 用法（在 frontend/ 下）：
 *   npm run audit:pixel                    跑全部单元
 *   npm run audit:pixel -- --unit=agents   只跑 key=agents 的单元
 *   npm run audit:pixel -- --headed        带界面跑（调选择器时用）
 *
 * 前置：现状侧要有 dev 服务在跑（另开一个终端 `npm run dev`）。
 * 输出：out/report.md（人看的）+ out/report.json（机器看的，便于下一轮对比）
 */

import { chromium } from '@playwright/test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { collectBoxes } from './collect.js'
import { diffUnit, renderReport, renderJson } from './report.js'
import { units, PROTO_HTML, APP_BASE } from './units.config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')   // frontend/tools/pixel-audit -> 仓库根
const OUT_DIR = join(__dirname, 'out')

// ---------------------------------------------------------------- 参数
function parseArgs (argv) {
  const args = { unit: null, headed: false, tolerance: 1 }
  for (const a of argv.slice(2)) {
    if (a.startsWith('--unit=')) args.unit = a.slice(7)
    else if (a === '--headed') args.headed = true
    else if (a.startsWith('--tolerance=')) args.tolerance = Number(a.slice(12))
  }
  return args
}

// ---------------------------------------------------------------- 步骤执行
/**
 * 执行一条进入路径步骤。
 * 支持 click / waitFor / waitTimeout / eval —— 见 units.config.js 顶部说明。
 */
async function runStep (page, step, label) {
  if (step.click) {
    const loc = page.locator(step.click).first()
    await loc.waitFor({ state: 'visible', timeout: 15000 })
    await loc.click()
    return
  }
  if (step.waitFor) {
    // 注意：这里等的是 visible，不是 attached。
    // 【坑 1 的一部分】el-tabs 把所有 pane 都 attach 在 DOM 里，
    // 等 attached 会立刻通过而页面其实还没切过去。
    await page.locator(step.waitFor).first().waitFor({ state: 'visible', timeout: 15000 })
    return
  }
  if (step.waitTimeout) {
    await page.waitForTimeout(step.waitTimeout)
    return
  }
  if (step.eval) {
    await page.evaluate(step.eval)
    return
  }
  throw new Error(`${label}：无法识别的步骤 ${JSON.stringify(step)}`)
}

async function runSteps (page, steps, label) {
  for (const step of steps || []) await runStep(page, step, label)
}

// ---------------------------------------------------------------- 单侧采集
async function collectSide (browser, { url, steps, root, mapping, label }) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    await runSteps(page, steps, label)
    const out = await collectBoxes(page, { mapping, rootSelector: root, visibleOnly: true })
    // 把选择器带回去，豁免的 match() 要靠选择器判断作用域
    out.selectors = mapping
    return out
  } finally {
    await page.close()
  }
}

// ---------------------------------------------------------------- 主流程
async function main () {
  const args = parseArgs(process.argv)
  const startedAt = new Date().toISOString()

  let selected = units
  if (args.unit) {
    selected = units.filter((u) => u.key === args.unit)
    if (!selected.length) {
      console.error(`找不到单元 --unit=${args.unit}。可选：${units.map((u) => u.key).join(', ')}`)
      process.exit(2)
    }
  }

  const protoUrl = pathToFileURL(join(REPO_ROOT, PROTO_HTML)).href
  console.log(`原型：${protoUrl}`)
  console.log(`现状：${APP_BASE}`)
  console.log(`单元：${selected.map((u) => u.key).join(', ')}\n`)

  const browser = await chromium.launch({ headless: !args.headed })
  const results = []

  try {
    for (const unit of selected) {
      process.stdout.write(`[${unit.key}] ${unit.name} … `)
      try {
        // 容器映射表拆成两侧各自的 { 语义名: 选择器 }
        const protoMapping = {}
        const appMapping = {}
        for (const [name, pair] of Object.entries(unit.containers)) {
          protoMapping[name] = pair.proto
          appMapping[name] = pair.app
        }

        const protoResult = await collectSide(browser, {
          url: protoUrl,
          steps: unit.proto.steps,
          root: unit.proto.root,
          mapping: protoMapping,
          label: `${unit.key}/原型`
        })

        const appResult = await collectSide(browser, {
          url: APP_BASE + unit.app.url,
          steps: unit.app.steps,
          root: unit.app.root,
          mapping: appMapping,
          label: `${unit.key}/现状`
        })

        const d = diffUnit(unit.name, protoResult, appResult, { tolerancePx: args.tolerance })
        results.push({ unit: unit.name, key: unit.key, ...d })
        console.log(`主差异 ${d.diffs.length} · 豁免 ${d.exempted.length} · 未命中 ${d.missing.length}`)
      } catch (err) {
        results.push({ unit: unit.name, key: unit.key, error: err.message, diffs: [], exempted: [], missing: [], notes: [] })
        console.log(`跑挂了：${err.message}`)
      }
    }
  } finally {
    await browser.close()
  }

  const meta = { startedAt, filter: args.unit }
  const md = renderReport(results, meta)
  const json = renderJson(results, meta)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, 'report.md'), md, 'utf8')
  await writeFile(join(OUT_DIR, 'report.json'), JSON.stringify(json, null, 2), 'utf8')

  console.log('\n' + '='.repeat(70))
  console.log(md)
  console.log('='.repeat(70))
  console.log(`\n报告已写入：${join(OUT_DIR, 'report.md')} / report.json`)

  // 退出码：只有「跑挂」才算失败。主差异不为 0 是给人看的结论，不该让 CI 红，
  // 因为差异要不要修是负责人的判断，不是工具的判断。
  process.exit(json.summary.errors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
