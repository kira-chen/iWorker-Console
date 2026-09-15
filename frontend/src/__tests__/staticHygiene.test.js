import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 零依赖静态卫生守卫（2026-08-08，负责人定：先不引 ESLint，做零成本的那一半）。
 *
 * 只收录**实测可靠、存量 0 命中**的检查项——宁少勿滥：一条会误报的规则会训练人忽略红色，
 * 比没有更糟。已评估但**有意不做**的项，见文末说明。
 *
 * 与 moduleGraph.test.js 分工：那个查「跨模块引用是否存在」，这个查「单文件内的卫生」。
 *
 * 2026-09-12 审计 J20 新增三条（实测存量 0 命中：7 键一致 / 56 列 0 缺 / 351 引用 0 未定义）：
 *  ① theme.css `--col-*` 与 utils/tableLayout.js `COL` 同源同值（09-11 令牌漂移教训：JS 改了 CSS 没改，占位框对不齐）；
 *  ② 用 `COL.TIME/STATUS/COUNT/TAG`（含 `POS_COL.` 等派生）定宽的 el-table-column 必须带 col-nowrap / COL_NOWRAP
 *    （09-11 负责人指示「定类型字段不换行」；漏挂即时间折两行读不出分钟）；
 *  ③ assets/*.css 内 `var(--x)`（非 `--el-`）剥注释后必须在 assets 内有定义——与 themeTokens.browser.test.js
 *    互为不同门禁的等价守卫：那个在真浏览器里算 computed style（须起 browser 跑道），这个纯文本零依赖跑在 vitest 常规跑道。
 */

// 基于本文件位置定位 src（本文件在 src/__tests__/ 下），不用 process.cwd()——
// 后者随调用目录变化，从仓库根目录跑会 ENOENT 崩溃而非断言失败（2026-08-08 实测）。
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function collect(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name !== '__tests__') collect(p, exts, out)
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(p)
    }
  }
  return out
}

const rel = (f) => path.relative(SRC, f)

describe('静态卫生守卫（零依赖，存量已全部达标）', () => {
  const vueFiles = collect(SRC, ['.vue'])
  const allFiles = collect(SRC, ['.vue', '.js'])

  it(`v-for 必须带 :key（${vueFiles.length} 个组件）——缺 key 会导致列表更新错位/内容串行`, () => {
    const offenders = []
    for (const f of vueFiles) {
      const tpl = fs.readFileSync(f, 'utf8').match(/<template>([\s\S]*)<\/template>/)
      if (!tpl) continue
      const lines = tpl[1].split('\n')
      lines.forEach((ln, i) => {
        if (!/\sv-for=/.test(ln)) return
        // 同一起始标签可能跨多行：取该行起最多 6 行内的首个 '>' 之前作为标签范围
        const chunk = lines.slice(i, i + 6).join(' ')
        const end = chunk.indexOf('>')
        const tag = end > 0 ? chunk.slice(0, end) : chunk
        if (!/:key=|v-bind:key=/.test(tag)) {
          offenders.push(`${rel(f)}:${i + 1}  ${ln.trim().slice(0, 60)}`)
        }
      })
    }
    expect(offenders, 'v-for 必须显式绑定 :key').toEqual([])
  })

  it('不得残留 debugger 语句', () => {
    const offenders = allFiles.filter((f) => /^\s*debugger\b/m.test(fs.readFileSync(f, 'utf8')))
    expect(offenders.map(rel)).toEqual([])
  })

  it('不得残留 .only / .skip 的测试标记外泄到源码', () => {
    const offenders = allFiles.filter((f) => /\b(describe|it|test)\.(only|skip)\s*\(/.test(fs.readFileSync(f, 'utf8')))
    expect(offenders.map(rel)).toEqual([])
  })

  it('Vue 组件不得同时存在两个 <script setup> 块（合并冲突残留的典型形态）', () => {
    const offenders = vueFiles.filter((f) => {
      const m = fs.readFileSync(f, 'utf8').match(/<script[^>]*\bsetup\b[^>]*>/g)
      return m && m.length > 1
    })
    expect(offenders.map(rel)).toEqual([])
  })

  it('源码不得残留 Git 冲突标记', () => {
    const offenders = allFiles.filter((f) => /^(<{7}|={7}|>{7})\s/m.test(fs.readFileSync(f, 'utf8')))
    expect(offenders.map(rel)).toEqual([])
  })

  it('① theme.css --col-* 与 tableLayout.COL 同源同值（列宽单一真相源，两侧漂移即红）', () => {
    const { diffs, jsVals, cssVals } = diffColTokens(
      fs.readFileSync(path.join(SRC, 'assets/theme.css'), 'utf8'),
      fs.readFileSync(path.join(SRC, 'utils/tableLayout.js'), 'utf8')
    )
    expect(Object.keys(jsVals).length, 'COL 至少应有一个键（解析失败会让规则空转）').toBeGreaterThan(0)
    expect(Object.keys(cssVals).length).toBeGreaterThan(0)
    expect(diffs, 'COL 与 --col-* 不一致').toEqual([])
  })

  it('② 用 COL.TIME/STATUS/COUNT/TAG 定宽的 el-table-column 必须带 col-nowrap / COL_NOWRAP', () => {
    const offenders = []
    let total = 0
    for (const f of vueFiles) {
      const src = fs.readFileSync(f, 'utf8')
      for (const { tag, line } of typedWidthColumns(src)) {
        total++
        if (!hasNowrap(tag)) offenders.push(`${rel(f)}:${line}  ${tag.slice(0, 90)}`)
      }
    }
    expect(total, '至少应扫到一个定宽列（解析失败会让规则空转）').toBeGreaterThan(0)
    expect(offenders, '定类型字段列缺 col-nowrap').toEqual([])
  })

  it('③ assets/*.css 的 var(--x) 引用（剥注释后）必须在 assets 内有定义', () => {
    const cssFiles = collect(path.join(SRC, 'assets'), ['.css'])
    const sources = Object.fromEntries(cssFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]))
    const { refs, missing } = undefinedCssVars(sources)
    expect(refs, '至少应扫到一个 var() 引用').toBeGreaterThan(0)
    expect(missing.map((m) => `${rel(m.file)} ${m.name}`), 'assets 内引用了未定义的 CSS 变量').toEqual([])
  })

  it('自检：规则本身能识别违规样例（防规则写错导致永远通过）', () => {
    const badVFor = '<div v-for="x in list">{{ x }}</div>'
    expect(/:key=|v-bind:key=/.test(badVFor.slice(0, badVFor.indexOf('>')))).toBe(false)
    const goodVFor = '<div v-for="x in list" :key="x.id">'
    expect(/:key=/.test(goodVFor.slice(0, goodVFor.indexOf('>') + 1))).toBe(true)
    expect(/^\s*debugger\b/m.test('  debugger\n')).toBe(true)
    expect(/^(<{7}|={7}|>{7})\s/m.test('<<<<<<< HEAD\n')).toBe(true)
    // ① 值不等 / 单侧缺键 都要报；注释里的假键不得被当成 COL 键
    const badTheme = ':root {\n  --col-status: 84px;\n  --col-time: 152px;\n}'
    const badCol = 'export const COL = {\n  /* OLD: 90, */\n  STATUS: 84,\n  TIME: 168,\n  TAG: 136\n}\n'
    expect(diffColTokens(badTheme, badCol).diffs).toEqual(['COL.TIME=168 ≠ --col-time=152', 'COL.TAG 在 theme.css 无 --col-tag'])
    expect(diffColTokens(':root { --col-status: 84px; --col-user: 132px; }', 'export const COL = {\n  STATUS: 84\n}').diffs)
      .toEqual(['--col-user 在 COL 无对应键'])
    // ② 派生常量（POS_COL.TIME）也算；带 col-nowrap 或 COL_NOWRAP 任一即过；名称列 min-width 不在范围
    const badCols = '<template><el-table-column :width="COL.TIME" />\n<el-table-column\n  :width="POS_COL.COUNT"\n  align="center" />\n<el-table-column :min-width="COL.NAME_MIN" /></template>'
    const found = typedWidthColumns(badCols)
    expect(found.map((c) => c.line)).toEqual([1, 2])
    expect(found.every((c) => !hasNowrap(c.tag))).toBe(true)
    expect(hasNowrap('<el-table-column :width="COL.TIME" class-name="col-nowrap" label-class-name="col-nowrap">')).toBe(true)
    expect(hasNowrap('<el-table-column :width="COL.TIME" :class-name="COL_NOWRAP">')).toBe(true)
    // ③ 注释里的定义不算定义；带 fallback 的引用同样要有定义；--el-* 不查
    const bad = undefinedCssVars({
      'a.css': ':root { --x: 1px; /* --ghost: 2px; */ }\n.a { width: var(--x); height: var(--ghost); color: var(--el-color-primary); }',
      'b.css': '.b { margin: var(--y, 4px); /* padding: var(--in-comment) */ }'
    })
    expect(bad.refs).toBe(3)
    expect(bad.missing.map((m) => m.name)).toEqual(['--ghost', '--y'])
  })
})

/* ================= J20 三条规则的实现（导出给自检用例，纯函数、不读磁盘） ================= */

/** ① 解析 theme.css 的 --col-*（px）与 tableLayout.js 的 COL 块，返回双向差异。键名 STATUS ↔ status、NAME_MIN ↔ name-min。 */
function diffColTokens(themeCss, tableLayoutJs) {
  const cssVals = {}
  for (const m of themeCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--col-([a-z-]+):\s*(\d+)px/g)) cssVals[m[1]] = Number(m[2])
  const start = tableLayoutJs.indexOf('export const COL = {')
  const block = start < 0 ? '' : tableLayoutJs.slice(start, tableLayoutJs.indexOf('\n}', start))
  const jsVals = {}
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').matchAll(/^\s*([A-Z_]+):\s*(\d+)/gm)) jsVals[m[1]] = Number(m[2])
  const toCss = (k) => k.toLowerCase().replace(/_/g, '-')
  const diffs = []
  for (const [k, v] of Object.entries(jsVals)) {
    const c = cssVals[toCss(k)]
    if (c === undefined) diffs.push(`COL.${k} 在 theme.css 无 --col-${toCss(k)}`)
    else if (c !== v) diffs.push(`COL.${k}=${v} ≠ --col-${toCss(k)}=${c}`)
  }
  for (const k of Object.keys(cssVals)) {
    if (!(k.toUpperCase().replace(/-/g, '_') in jsVals)) diffs.push(`--col-${k} 在 COL 无对应键`)
  }
  return { cssVals, jsVals, diffs }
}

/** ② 取 <template> 内所有以 COL.TIME/STATUS/COUNT/TAG（含 *_COL. 派生）定宽的 el-table-column 起始标签及其行号。 */
function typedWidthColumns(src) {
  const tplM = src.match(/<template>([\s\S]*)<\/template>/)
  if (!tplM) return []
  const innerStart = src.indexOf(tplM[0]) + '<template>'.length // m.index 相对模板内层，行号要从 <template> 之后起算
  const out = []
  for (const m of tplM[1].matchAll(/<el-table-column\b[^>]*>/g)) {
    const tag = m[0]
    if (!/:(?:width|min-width)="[^"]*COL\.(TIME|STATUS|COUNT|TAG)\b/.test(tag)) continue
    out.push({ tag, line: src.slice(0, innerStart + m.index).split('\n').length })
  }
  return out
}
const hasNowrap = (tag) => /col-nowrap|COL_NOWRAP/.test(tag)

/** ③ 对一组 css 文本（{ file: source }）：剥注释后收集全部 `--x:` 定义，再逐个 var(--x[, fallback]) 核对；--el-* 跳过。 */
function undefinedCssVars(sources) {
  const stripped = Object.fromEntries(Object.entries(sources).map(([f, s]) => [f, s.replace(/\/\*[\s\S]*?\*\//g, '')]))
  const defined = new Set()
  for (const s of Object.values(stripped)) for (const m of s.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1])
  const missing = []
  let refs = 0
  for (const [file, s] of Object.entries(stripped)) {
    for (const m of s.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,[^)]*)?\)/g)) {
      if (m[1].startsWith('--el-')) continue
      refs++
      if (!defined.has(m[1])) missing.push({ file, name: m[1] })
    }
  }
  return { refs, missing }
}

/*
 * 已评估但有意不做的项（避免后人重复踩坑）：
 *
 * 1. 「模板引用了未在 script 声明的变量」——手写正则实测 148 条命中，几乎全是误报：
 *    v-for 局部变量、slot-scope 解构、对象属性访问都会被误判。要做准必须解析 Vue 模板 AST，
 *    那正是 eslint-plugin-vue 的职责，零依赖手搓不可靠。留待引入 ESLint 时一并解决。
 *
 * 2. 「未使用的具名导入」——首轮扫描命中 6 条，核实后 2 条为真死代码（已清理：
 *    TaskDetail.vue 的 ref、AdminSkillEditPage.vue 的 watch），另 4 条是 $ 前缀标识符的
 *    正则转义误报。判定逻辑（区分模板使用/注释提及/字符串字面量）同样依赖 AST 才能做准，
 *    故不固化为守卫；死导入不影响运行，价值低于误报风险。
 */
