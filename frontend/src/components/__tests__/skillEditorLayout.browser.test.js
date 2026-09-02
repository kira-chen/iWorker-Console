import { describe, it, expect, afterEach, vi } from 'vitest'
import { page } from 'vitest/browser'
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '@/assets/tokens.css'
import '@/assets/theme.css'

/**
 * 视觉效果守卫 · 技能编辑器响应式布局契约（真浏览器 + 真媒体查询，2026-08-08 编辑器加固批）。
 *
 * 布局规格（SkillFocusEditor §1.3/§2.3/§12）按视口穷举：
 *  - ≥1280px：包模式三栏（树 / 编辑器 / dock），「☰ 文件」抽屉触发隐藏；
 *  - ≤1100px：树栏从 grid 移除（display:none），「☰ 文件」出现，点击弹出抽屉复用同一文件树；
 *  - ≤900px：单列堆叠，树以限高块回归、抽屉触发隐藏（消除双入口）。
 * 另钉「文件区与 files 是否为空解耦」：files=[] 时树栏容器仍渲染（曾有静默消失 bug，修复核心）。
 *
 * 媒体查询/grid 重排在 jsdom 里不存在，必须真浏览器；重子组件（Milkdown/树/坞）打桩——
 * 本守卫测的是编辑器自身的 grid + 断点 CSS，桩根元素同样携带父作用域样式类。
 */

vi.mock('@/components/position/SkillMilkdownEditor.vue', async () => {
  const { h: hh } = await import('vue')
  return { default: { name: 'SkillMilkdownEditor', setup: () => () => hh('div', { class: 'stub-milkdown' }) } }
})
vi.mock('@/components/position/CodeTextEditor.vue', async () => {
  const { h: hh } = await import('vue')
  return { default: { name: 'CodeTextEditor', setup: () => () => hh('div', { class: 'stub-code' }) } }
})
vi.mock('@/components/position/SkillFileTree.vue', async () => {
  const { h: hh } = await import('vue')
  return { default: { name: 'SkillFileTree', setup: () => () => hh('div', { class: 'stub-tree' }) } }
})
vi.mock('@/components/position/ToolDock.vue', async () => {
  const { h: hh } = await import('vue')
  return { default: { name: 'ToolDock', setup: () => () => hh('div', { class: 'stub-dock' }) } }
})

const SkillFocusEditor = (await import('@/components/position/SkillFocusEditor.vue')).default

let app, host

function mountEditor() {
  document.documentElement.setAttribute('data-theme', 'light')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () =>
      h(SkillFocusEditor, {
        skill: { skillId: 1, name: 't', triggers: ['t1'], skillMd: '# md', referencedTools: [], category: null },
        files: [], // 有意为空：树栏渲染与 files 解耦（静默消失 bug 的回归钉）
        activeFilePath: 'SKILL.md',
        activeFileType: 'md',
        activeFileContent: '# md'
      })
  })
  app.use(ElementPlus)
  app.mount(host)
  return host
}

async function frame() {
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

async function setWidth(w) {
  await page.viewport(w, 800)
  await frame()
}

afterEach(async () => {
  app?.unmount()
  host?.remove()
  await page.viewport(1400, 800)
})

describe('技能编辑器响应式布局契约（视口穷举）', () => {
  it('宽视口（1400）：三栏在位——树栏可见（files 为空也渲染）、抽屉触发隐藏', async () => {
    await setWidth(1400)
    const el = mountEditor()
    await frame()
    const tree = el.querySelector('.ed-tree')
    expect(tree, '树栏容器必须渲染（与 files 是否为空解耦）').toBeTruthy()
    expect(getComputedStyle(tree).display).not.toBe('none')
    expect(el.querySelector('.stub-dock')).toBeTruthy()
    const trigger = el.querySelector('.ed-drawer-trigger')
    expect(getComputedStyle(trigger).display).toBe('none')
  })

  it('窄视口（1000，≤1100 断点）：树栏折叠、「☰ 文件」出现，点击弹出文件抽屉', async () => {
    await setWidth(1000)
    const el = mountEditor()
    await frame()
    expect(getComputedStyle(el.querySelector('.ed-tree')).display).toBe('none')
    const trigger = el.querySelector('.ed-drawer-trigger')
    expect(getComputedStyle(trigger).display).not.toBe('none')

    trigger.click()
    await frame()
    await new Promise((r) => setTimeout(r, 350)) // 等抽屉进入动画
    const drawer = document.querySelector('.ed-tree-drawer')
    expect(drawer, '抽屉应弹出并复用同一文件树').toBeTruthy()
    expect(drawer.querySelector('.stub-tree')).toBeTruthy()
  })

  it('超窄视口（800，≤900 断点）：单列堆叠——树以限高块回归、抽屉触发隐藏（无双入口）', async () => {
    await setWidth(800)
    const el = mountEditor()
    await frame()
    const tree = el.querySelector('.ed-tree')
    expect(getComputedStyle(tree).display).toBe('block')
    expect(getComputedStyle(tree).maxHeight).toBe('200px')
    expect(getComputedStyle(el.querySelector('.ed-drawer-trigger')).display).toBe('none')
  })
})
