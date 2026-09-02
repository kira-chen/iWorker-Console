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

  it('自检：规则本身能识别违规样例（防规则写错导致永远通过）', () => {
    const badVFor = '<div v-for="x in list">{{ x }}</div>'
    expect(/:key=|v-bind:key=/.test(badVFor.slice(0, badVFor.indexOf('>')))).toBe(false)
    const goodVFor = '<div v-for="x in list" :key="x.id">'
    expect(/:key=/.test(goodVFor.slice(0, goodVFor.indexOf('>') + 1))).toBe(true)
    expect(/^\s*debugger\b/m.test('  debugger\n')).toBe(true)
    expect(/^(<{7}|={7}|>{7})\s/m.test('<<<<<<< HEAD\n')).toBe(true)
  })
})

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
