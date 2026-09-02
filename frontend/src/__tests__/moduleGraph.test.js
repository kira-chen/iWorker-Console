import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 模块图静态守卫（2026-08-08 质量强化，零新依赖替代 lint 的一部分职责）。
 *
 * 本仓无 ESLint（引入属新技术栈，须先经负责人同意），而以下两类问题构建期不报错、
 * 只在用户点到那条路径时才在运行时炸：
 *  1. import 的模块路径不存在（拼错 / 文件被删改名）；
 *  2. import 的具名导出在目标模块中不存在（导出被改名而引用侧漏改）。
 *
 * 用测试实现静态检查：遍历 src 下全部 .js/.vue（排除测试自身），解析 `@/` 别名导入并核对。
 * 覆盖 `export const/function/async function/class/let/var`、`export {}` 重导出、`export *`。
 * 动态导入与第三方包不在范围内（前者由构建解析，后者由 npm 保证）。
 */

// 基于本文件位置定位 src（本文件在 src/__tests__/ 下），不用 process.cwd()——
// 后者随调用目录变化，从仓库根目录跑会 ENOENT 崩溃而非断言失败，排查困惑（2026-08-08 实测）。
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 递归收集源码文件（跳过测试目录）。 */
function collect(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name === '__tests__') continue
      collect(p, out)
    } else if (/\.(js|vue)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

/** 把 `@/x` 解析为磁盘文件（依次试 原样/.js/.vue/index.js）。 */
function resolveAlias(spec) {
  const base = path.join(SRC, spec.slice(2))
  for (const cand of [base, `${base}.js`, `${base}.vue`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand
  }
  return null
}

/** 目标模块是否导出了该具名符号。 */
function hasNamedExport(source, name) {
  if (/export\s+\*/.test(source)) return true // 重导出全部，无法静态确定 → 放行
  const patterns = [
    new RegExp(`export\\s+(?:async\\s+)?(?:const|function|class|let|var)\\s+${name}\\b`),
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`)
  ]
  return patterns.some((re) => re.test(source))
}

const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"](@\/[^'"]+)['"]/g

describe('模块图静态守卫（构建期不报、运行时才炸的两类问题）', () => {
  const files = collect(SRC)

  it(`扫描 ${files.length} 个源文件：@/ 别名导入的模块路径均存在`, () => {
    const missing = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      for (const m of src.matchAll(IMPORT_RE)) {
        if (!resolveAlias(m[2])) {
          missing.push(`${path.relative(SRC, f)} → ${m[2]}`)
        }
      }
    }
    expect(missing, '以下导入指向不存在的模块').toEqual([])
  })

  it('@/ 别名导入的具名导出均在目标模块中存在（防导出改名漏改引用侧）', () => {
    const broken = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      for (const m of src.matchAll(IMPORT_RE)) {
        const target = resolveAlias(m[2])
        if (!target || !target.endsWith('.js')) continue // .vue 的具名导出不适用
        const targetSrc = fs.readFileSync(target, 'utf8')
        const names = m[1]
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
          .filter((s) => s && s !== 'default')
        for (const n of names) {
          if (!hasNamedExport(targetSrc, n)) {
            broken.push(`${path.relative(SRC, f)} 导入 { ${n} } 自 ${m[2]}`)
          }
        }
      }
    }
    expect(broken, '以下具名导入在目标模块中找不到对应导出').toEqual([])
  })

  it('自检：守卫本身能识别不存在的导出（防规则写错导致永远通过）', () => {
    const fake = 'export const realOne = 1\nexport async function realTwo() {}\n'
    expect(hasNamedExport(fake, 'realOne')).toBe(true)
    expect(hasNamedExport(fake, 'realTwo')).toBe(true) // async function 形态
    expect(hasNamedExport(fake, 'notExported')).toBe(false)
    expect(hasNamedExport('export { a, b } from "./x"', 'b')).toBe(true)
  })
})
