import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { ElTable, ElTableColumn } from 'element-plus'
import 'element-plus/dist/index.css'
import '@/assets/tokens.css'
import '@/assets/theme.css'
// 2026-09-12 审计 T57：18 个后台列表页实际走的是 body.admin-scope 下 admin-shell.css 的固定列 hover 规则
// （admin-shell.css:212-217 用 --bg-admin-row-hover 叠色；tokens.css:145 浅色不透明 #f7faf8 / :221 暗色映射 --bg-hover），
// 原用例只在无 admin-scope 下跑，后台真实规则不在闸内。此文件另加一组 admin-scope 变体；
// admin-shell.css 全部规则以 body.admin-scope 限定，引入后不影响原组用例。
import '@/assets/admin-shell.css'

/**
 * 视觉效果守卫 · 表格固定列不透底（真浏览器，质量闸 #3 首批用例，2026-08-08）。
 *
 * 背景：EP 固定列 = sticky + background:inherit，主题层 hover/斑马纹色是半透明 token，
 * 曾致悬浮行固定列透出横向滚动内容（docs/update/2026-08-08.md §1）。该缺陷在 jsdom 里
 * 无法表达（不渲染不合成），本用例在真 Chromium 断言**计算样式层的合成事实**：
 *  - 悬浮行/斑马纹行的固定列单元格：背景色必须完全不透明（alpha=1）+ 渐变叠层在位；
 *  - 非固定列悬浮仍保持半透明 hover 色（证明修复是定点的，未误伤整表 hover 观感）；
 *  - 固定列仍是 sticky 实现（EP 换实现时本守卫翻红，提示主题层修复口径需重审）。
 * 浅/暗双主题各跑一遍（主题切换 = :root[data-theme] 变量重解析）。
 *
 * 第二组「admin-scope 变体」（2026-09-12 审计 T57）：给 body 挂 admin-scope 后再跑一遍——后台列表页的行 hover
 * 色是 --bg-admin-row-hover（浅色下不透明 #f7faf8，故「非固定列 hover 半透明」的对照断言在此不成立），
 * 守的契约改为：固定列底色仍是不透明表面色 + 叠色（inset box-shadow）颜色 == 非固定列的 hover 背景色，
 * 即固定列与普通列合成结果一致、不透底。
 */

const ROWS = [
  { a: 'a1', b: 'b1', c: 'c1' },
  { a: 'a2', b: 'b2', c: 'c2' },
  { a: 'a3', b: 'b3', c: 'c3' }
]

/** 主题 → 期望的表面底色（tokens.css --bg-surface 的浏览器计算值）。 */
const SURFACE = {
  light: 'rgb(255, 255, 255)',
  dark: 'rgb(31, 31, 31)'
}

let app, host

function mountTable() {
  host = document.createElement('div')
  host.style.width = '420px' // 列总宽 720 > 容器 420 → 强制横向滚动（固定列遮挡场景成立）
  document.body.appendChild(host)
  app = createApp({
    render: () =>
      h(
        ElTable,
        { data: ROWS, stripe: true, style: { width: '100%' } },
        {
          default: () => [
            h(ElTableColumn, { prop: 'a', label: 'A', width: 200 }),
            h(ElTableColumn, { prop: 'b', label: 'B', width: 200 }),
            h(ElTableColumn, { prop: 'c', label: 'C', width: 200 }),
            h(
              ElTableColumn,
              { label: '操作', width: 120, fixed: 'right' },
              { default: () => h('span', '编辑') }
            )
          ]
        }
      )
  })
  app.mount(host)
}

/** 等浏览器完成一帧渲染（样式注入 + 布局）。 */
async function frame() {
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

function bodyRows() {
  return [...host.querySelectorAll('.el-table__body tbody tr.el-table__row')]
}
function fixedTdOf(tr) {
  return tr.querySelector('td.el-table-fixed-column--right')
}
function normalTdOf(tr) {
  return tr.querySelector('td:not(.el-table-fixed-column--right)')
}
function alphaOf(cssColor) {
  const m = cssColor.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(',').map((s) => parseFloat(s))
  return parts.length === 4 ? parts[3] : 1
}

afterEach(() => {
  app?.unmount()
  host?.remove()
  // 主题是挂在 <html> 上的全局态，必须逐例清理：否则残留会污染同 worker 内后续文件
  // （themeTokens/skillEditorLayout 也读 data-theme）。
  document.documentElement.removeAttribute('data-theme')
  document.body.classList.remove('admin-scope')
})

/** box-shadow 计算值里的颜色部分（Chromium 序列化为 "rgb(...) 0px 0px 0px 9999px inset"）。 */
function shadowColorOf(boxShadow) {
  const m = boxShadow.match(/rgba?\([^)]+\)/)
  return m ? m[0] : null
}

describe.each(['light', 'dark'])('固定列不透底 · %s 主题', (theme) => {
  // 用 beforeEach 而非 beforeAll（2026-08-24 修间歇性假红）：describe.each 会把两个 describe 的
  // beforeAll 都在文件加载期注册，light/dark 两组的 beforeAll 可能在同一 worker 里先后抢跑，
  // 导致 dark 的 setAttribute 覆盖掉 light 用例正在依赖的主题 → 读到另一主题的令牌、
  // 断言 alpha>0 拿到 0。beforeEach 紧贴每个用例执行，不会被另一组抢跑。
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', theme)
  })

  it('悬浮行固定列：不透明表面底色 + 叠层；非固定列保持半透明 hover 色', async () => {
    mountTable()
    await frame()
    const tr = bodyRows()[0]
    tr.classList.add('hover-row') // EP 悬浮语义（类由 EP 事件层负责，此处直接置类测 CSS 合成层）
    await frame()

    const fixedCs = getComputedStyle(fixedTdOf(tr))
    // 核心断言：固定列在悬浮态的背景必须完全不透明（bug 形态 = 半透明 rgba 直接盖上去）
    expect(fixedCs.backgroundColor).toBe(SURFACE[theme])
    expect(alphaOf(fixedCs.backgroundColor)).toBe(1)
    // 叠色机制（2026-08-20 改）：不再用 background-image 渐变——linear-gradient 之间浏览器不做插值，
    // 会导致固定列底色瞬变、与普通列的 background-color 过渡不同步。改用可插值的 inset box-shadow 承载。
    expect(fixedCs.boxShadow).toContain('inset')
    expect(alphaOf(fixedCs.boxShadow)).toBeGreaterThan(0)

    // 对照断言：非固定列 hover 观感未被误伤（仍是半透明 hover token 叠在行底色上）
    const normalCs = getComputedStyle(normalTdOf(tr))
    expect(alphaOf(normalCs.backgroundColor)).toBeLessThan(1)
  })

  it('斑马纹行（非悬浮）固定列：同样不透明 + 叠层', async () => {
    mountTable()
    await frame()
    const striped = bodyRows().find((tr) => tr.classList.contains('el-table__row--striped'))
    expect(striped).toBeTruthy()

    const cs = getComputedStyle(fixedTdOf(striped))
    expect(cs.backgroundColor).toBe(SURFACE[theme])
    expect(cs.boxShadow).toContain('inset')
    expect(alphaOf(cs.boxShadow)).toBeGreaterThan(0)
  })

  it('EP 固定列实现仍为 sticky（主题层修复的前提假设，实现变更时本守卫翻红提醒重审）', async () => {
    mountTable()
    await frame()
    expect(getComputedStyle(fixedTdOf(bodyRows()[0])).position).toBe('sticky')
  })

  it('选中行（current-row）固定列：不透明（守 --c-accent-fill 不被改成半透明）', async () => {
    mountTable()
    await frame()
    const tr = bodyRows()[0]
    tr.classList.add('current-row')
    await frame()
    expect(alphaOf(getComputedStyle(fixedTdOf(tr)).backgroundColor)).toBe(1)
  })

  it('固定表头单元格：不透明（守 --bg-sunken 表头底不被改成半透明）', async () => {
    mountTable()
    await frame()
    const th = host.querySelector('.el-table__header-wrapper th.el-table-fixed-column--right')
    expect(th).toBeTruthy()
    expect(alphaOf(getComputedStyle(th).backgroundColor)).toBe(1)
  })
})

describe.each(['light', 'dark'])('固定列不透底 · admin-scope（后台列表页实际规则）· %s 主题', (theme) => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.body.classList.add('admin-scope') // router.afterEach 在 /admin 路由下挂的类（router/index.js:441）
  })

  it('悬浮行固定列：不透明表面底色 + inset 叠色，叠色 == 非固定列 hover 背景色（--bg-admin-row-hover，合成一致）', async () => {
    mountTable()
    await frame()
    const tr = bodyRows()[0]
    tr.classList.add('hover-row')
    await frame()

    const fixedCs = getComputedStyle(fixedTdOf(tr))
    const normalCs = getComputedStyle(normalTdOf(tr))
    // 底色：仍是 theme.css 打的不透明表面色（admin-shell 只改 box-shadow，不碰 background-color）
    expect(fixedCs.backgroundColor).toBe(SURFACE[theme])
    expect(alphaOf(fixedCs.backgroundColor)).toBe(1)
    expect(fixedCs.boxShadow).toContain('inset')
    // 叠色：admin-shell.css:212-217 用 --bg-admin-row-hover；非固定列 hover 走 --el-table-row-hover-bg-color
    // = 同一令牌（admin-shell.css:67）。两者必须相等，否则固定列与普通列 hover 颜色对不上。
    expect(shadowColorOf(fixedCs.boxShadow)).toBe(normalCs.backgroundColor)
    // 叠色必须可见（alpha > 0）。真浏览器实测（2026-09-12 首次取基线）：浅色下 EP 把 hover 色合成为
    // rgba(247,250,248,0.063) 而非 tokens.css:145 的原始 #f7faf8，所以这里只守「有叠色且两处一致」，不钉具体值。
    expect(alphaOf(normalCs.backgroundColor)).toBeGreaterThan(0)
    expect(alphaOf(normalCs.backgroundColor)).toBeLessThanOrEqual(1)
  })

  it('斑马纹行（非悬浮）固定列：admin-scope 下沿用 theme.css 规则，仍不透明 + 叠层', async () => {
    mountTable()
    await frame()
    const striped = bodyRows().find((tr) => tr.classList.contains('el-table__row--striped'))
    expect(striped).toBeTruthy()
    const cs = getComputedStyle(fixedTdOf(striped))
    expect(cs.backgroundColor).toBe(SURFACE[theme])
    expect(cs.boxShadow).toContain('inset')
    expect(alphaOf(cs.boxShadow)).toBeGreaterThan(0)
  })

  it('固定表头单元格：admin-scope 表头底（--bg-admin-head）不透明', async () => {
    mountTable()
    await frame()
    const th = host.querySelector('.el-table__header-wrapper th.el-table-fixed-column--right')
    expect(th).toBeTruthy()
    expect(alphaOf(getComputedStyle(th).backgroundColor)).toBe(1)
  })
})
