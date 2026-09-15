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
 * 第三方包不在范围内（由 npm 保证）。
 *
 * 2026-09-12 审计 J20④ 扩：路径存在性从「`@/` 具名导入」扩到 默认导入 / 相对路径导入 / 动态 `import()`
 * （实测存量 312 / 138 / 66 处 0 缺）。三者构建期同样不报——vite 对 .vue 路由懒加载 `import()` 只在点到时才解析；
 * 统一经 `resolveSpec(fromFile, spec)` 解析（`@/` 与相对路径都试 原样/.js/.vue/index.js，裸包名跳过）。
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
  return resolveSpec(null, spec)
}

/**
 * 通用路径解析（J20④）：`@/` 别名 → src 下；`./` `../` 相对 → 相对 fromFile 所在目录；
 * 其它（裸包名 / 协议前缀）视为第三方，返回 'pkg' 不查。找不到文件返回 null。
 */
function resolveSpec(fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return 'pkg'
  for (const cand of [base, `${base}.js`, `${base}.vue`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand
  }
  return null
}

/** 默认导入 `import X from '...'`（可带 `, { ... }`）、相对路径导入（任意形态）、动态 `import('...')` 三类 spec 提取。 */
const DEFAULT_IMPORT_RE = /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/g
const RELATIVE_IMPORT_RE = /import\s*(?:[^'"]*?)\s*from\s*['"](\.[^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g
function extractSpecs(src) {
  return {
    default: [...src.matchAll(DEFAULT_IMPORT_RE)].map((m) => m[2]),
    relative: [...src.matchAll(RELATIVE_IMPORT_RE)].map((m) => m[1]),
    dynamic: [...src.matchAll(DYNAMIC_IMPORT_RE)].map((m) => m[1])
  }
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

/**
 * 解析 import 大括号内的导入名。先剥掉块内 `//` 与注释（2026-09-10 负责人批
 * 准修复：此前注释文字会被并进导入名导致误报，2026-09-09 批 2-2 实施时炸过一次、
 * 当时以挪注释规避），再按逗号切分、去 as 别名。
 */
function parseImportNames(braceContent) {
  return braceContent
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split(',')
    .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
    .filter((s) => s && s !== 'default')
}

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
        const names = parseImportNames(m[1])
        for (const n of names) {
          if (!hasNamedExport(targetSrc, n)) {
            broken.push(`${path.relative(SRC, f)} 导入 { ${n} } 自 ${m[2]}`)
          }
        }
      }
    }
    expect(broken, '以下具名导入在目标模块中找不到对应导出').toEqual([])
  })

  it('默认导入 / 相对路径导入 / 动态 import() 的模块路径均存在（J20④；第三方包跳过）', () => {
    const missing = []
    const counts = { default: 0, relative: 0, dynamic: 0 }
    for (const f of files) {
      const specs = extractSpecs(fs.readFileSync(f, 'utf8'))
      for (const kind of ['default', 'relative', 'dynamic']) {
        for (const spec of specs[kind]) {
          const r = resolveSpec(f, spec)
          if (r === 'pkg') continue
          counts[kind]++
          if (!r) missing.push(`${kind} 导入 ${path.relative(SRC, f)} → ${spec}`)
        }
      }
    }
    // 三类各自必须扫到（解析失败会让规则空转）
    expect(counts.default).toBeGreaterThan(0)
    expect(counts.relative).toBeGreaterThan(0)
    expect(counts.dynamic).toBeGreaterThan(0)
    expect(missing, '以下导入指向不存在的模块').toEqual([])
  })

  it('自检：守卫本身能识别不存在的导出（防规则写错导致永远通过）', () => {
    const fake = 'export const realOne = 1\nexport async function realTwo() {}\n'
    expect(hasNamedExport(fake, 'realOne')).toBe(true)
    expect(hasNamedExport(fake, 'realTwo')).toBe(true) // async function 形态
    expect(hasNamedExport(fake, 'notExported')).toBe(false)
    expect(hasNamedExport('export { a, b } from "./x"', 'b')).toBe(true)
    // import 块内注释不得被并进导入名（2026-09-10 修复的回归 fixture）
    expect(parseImportNames('a, // 行注释\n b as c, /* 块注释 */ d')).toEqual(['a', 'b', 'd'])
    expect(parseImportNames('\n  // 整行注释\n  x,\n  y as z\n')).toEqual(['x', 'y'])
    // J20④：三类 spec 都能抽到；裸包名判 'pkg'；不存在的相对 / 别名路径判 null，存在的解析到文件
    const specs = extractSpecs([
      "import request from './request'",
      "import Foo, { bar } from '@/utils/foo'",
      "import { x } from '../x'",
      "import ElementPlus from 'element-plus'",
      "const Page = () => import('@/views/Nope.vue')"
    ].join('\n'))
    expect(specs.default).toEqual(['./request', '@/utils/foo', 'element-plus'])
    expect(specs.relative).toEqual(['./request', '../x'])
    expect(specs.dynamic).toEqual(['@/views/Nope.vue'])
    const here = fileURLToPath(import.meta.url)
    expect(resolveSpec(here, 'element-plus')).toBe('pkg')
    expect(resolveSpec(here, '@/views/Nope.vue')).toBeNull()
    expect(resolveSpec(here, './__no_such_file__')).toBeNull()
    expect(resolveSpec(here, './moduleGraph.test.js')).toBe(here)
    expect(resolveSpec(here, '@/utils/tableLayout')).toMatch(/tableLayout\.js$/)
  })
})
