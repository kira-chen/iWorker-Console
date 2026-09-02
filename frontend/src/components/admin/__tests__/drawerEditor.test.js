// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * DrawerEditor.vue 单测 —— 管理后台抽屉编辑器统一外壳。
 *
 * 抽象的边界是「收壳与四态，放内容」：本文件只验外壳职责（标题三态、加载/失败/内容三选一、
 * 底部动作条、各差异入参），字段渲染属各编辑器自己的测试。
 */

const DrawerEditor = (await import('@/components/admin/DrawerEditor.vue')).default

const elDrawer = {
  name: 'el-drawer',
  props: ['modelValue', 'size'],
  emits: ['update:modelValue'],
  template:
    '<div class="el-drawer" v-if="modelValue" :data-size="size">' +
    '<div class="dr-header"><slot name="header" /></div>' +
    '<div class="dr-body"><slot /></div>' +
    '<div class="dr-footer"><slot name="footer" /></div></div>'
}
const elButton = {
  name: 'el-button',
  props: { disabled: Boolean, loading: Boolean, type: String },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :data-loading="loading" @click="!disabled && $emit(\'click\')"><slot /></button>'
}
const elEmpty = { name: 'el-empty', props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }
const elSkeleton = { name: 'el-skeleton', props: ['rows'], template: '<div class="el-skeleton" :data-rows="rows" />' }

let app, container
function mount(props = {}, slots = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () => h(DrawerEditor, { visible: true, entity: '专家', ...props }, {
        default: () => h('div', { class: 'my-fields' }, '字段区'),
        ...slots
      })
    }
  })
  app.component('el-drawer', elDrawer)
  app.component('el-button', elButton)
  app.component('el-empty', elEmpty)
  app.component('el-skeleton', elSkeleton)
  app.mount(container)
  return container
}
const title = () => container.querySelector('.de-head-title')?.textContent.trim()
const btn = (t) => [...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes(t))

afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('DrawerEditor · 标题三态', () => {
  it('新建 / 编辑 / 查看 分别拼出对应标题', () => {
    mount({ isEdit: false })
    expect(title()).toBe('新建专家')
    app.unmount(); container.remove()

    mount({ isEdit: true })
    expect(title()).toBe('编辑专家')
    app.unmount(); container.remove()

    mount({ isEdit: true, readonly: true })
    expect(title()).toBe('查看专家')
  })

  it('显式 title 覆盖拼装结果', () => {
    mount({ isEdit: true, title: '自定义标题' })
    expect(title()).toBe('自定义标题')
  })

  it('title-extra 插槽与标题同行渲染', () => {
    mount({ isEdit: true }, { 'title-extra': () => h('span', { class: 'my-tag' }, '已发布') })
    expect(container.querySelector('.de-head .my-tag')?.textContent).toBe('已发布')
  })
})

describe('DrawerEditor · 四态', () => {
  it('loading → 骨架，不渲染内容', () => {
    mount({ loading: true })
    expect(container.querySelector('.el-skeleton')).toBeTruthy()
    expect(container.querySelector('.my-fields')).toBeNull()
  })

  it('骨架行数可配（默认 8）', () => {
    mount({ loading: true })
    expect(container.querySelector('.el-skeleton').dataset.rows).toBe('8')
    app.unmount(); container.remove()
    mount({ loading: true, skeletonRows: 4 })
    expect(container.querySelector('.el-skeleton').dataset.rows).toBe('4')
  })

  it('error 为字符串 → 作为描述展示；为 true → 兜底文案', () => {
    mount({ error: '拉取超时' })
    expect(container.querySelector('.el-empty').textContent).toContain('拉取超时')
    app.unmount(); container.remove()
    mount({ error: true })
    expect(container.querySelector('.el-empty').textContent).toContain('加载失败')
  })

  it('失败态优先于内容，且「重试」上抛 retry', async () => {
    const onRetry = vi.fn()
    mount({ error: 'x', onRetry })
    expect(container.querySelector('.my-fields')).toBeNull()
    btn('重试').click()
    await nextTick()
    expect(onRetry).toHaveBeenCalled()
  })

  it('正常态渲染默认插槽内容', () => {
    mount()
    expect(container.querySelector('.my-fields')?.textContent).toBe('字段区')
  })
})

describe('DrawerEditor · 底部动作条', () => {
  it('编辑态用 submitText，新建态用 createText', () => {
    mount({ isEdit: true, submitText: '保存', createText: '登记' })
    expect(btn('保存')).toBeTruthy()
    app.unmount(); container.remove()
    mount({ isEdit: false, submitText: '保存', createText: '登记' })
    expect(btn('登记')).toBeTruthy()
  })

  it('只读态：只留「关闭」，无提交按钮', () => {
    mount({ isEdit: true, readonly: true })
    expect(btn('关闭')).toBeTruthy()
    expect(btn('保存')).toBeUndefined()
  })

  it('非只读态取消按钮文案为「取消」', () => {
    mount({ isEdit: true })
    expect(btn('取消')).toBeTruthy()
  })

  it('submitHidden → 隐藏提交但保留取消（如审核期锁定）', () => {
    mount({ isEdit: true, submitHidden: true })
    expect(btn('保存')).toBeUndefined()
    expect(btn('取消')).toBeTruthy()
  })

  it('cancelDisabled / submitDisabled 生效', () => {
    mount({ isEdit: true, cancelDisabled: true, submitDisabled: true })
    expect(btn('取消').disabled).toBe(true)
    expect(btn('保存').disabled).toBe(true)
  })

  it('点保存上抛 save；点取消关抽屉', async () => {
    const onSave = vi.fn()
    const onUpdate = vi.fn()
    mount({ isEdit: true, onSave, 'onUpdate:visible': onUpdate })
    btn('保存').click()
    await nextTick()
    expect(onSave).toHaveBeenCalled()
    btn('取消').click()
    await nextTick()
    expect(onUpdate).toHaveBeenCalledWith(false)
  })

  it('footer 插槽可整体替换默认动作条', () => {
    mount({ isEdit: true }, { footer: () => h('button', { class: 'my-foot' }, '自定义') })
    expect(container.querySelector('.my-foot')).toBeTruthy()
    expect(btn('保存')).toBeUndefined()
  })
})

describe('DrawerEditor · 外壳参数', () => {
  it('默认 720px，可覆盖', () => {
    mount()
    expect(container.querySelector('.el-drawer').dataset.size).toBe('720px')
    app.unmount(); container.remove()
    mount({ size: '480px' })
    expect(container.querySelector('.el-drawer').dataset.size).toBe('480px')
  })

  it('extra 插槽渲染（抽屉内附挂的选择器/弹窗）', () => {
    mount({}, { extra: () => h('div', { class: 'my-extra' }) })
    expect(container.querySelector('.my-extra')).toBeTruthy()
  })
})

/**
 * 全站抽屉一致性守卫 —— 本组件的意义在于「正确做法能传播」，而非只是少写几行。
 * 故除了组件自身行为，另守两条全站口径，防止新抽屉再各写各的。
 */
describe('DrawerEditor · 全站抽屉一致性', () => {
  /** 仍裸用 el-drawer 的白名单：形态不属「表单编辑器」，各有正当理由。 */
  const BARE_DRAWER_ALLOWLIST = {
    'DocDetailDrawer.vue': '只读文档详情，无表单',
    // 2026-09-01 PRD 对齐改造：ReviewDetailDrawer 已废弃删除（详情改复用业务原生只读视图）；
    // GovObjectDetail 的 POSITION 简易只读抽屉（岗位抽屉待拍板的临时形态）为只读详情、无表单
    'GovObjectDetail.vue': '只读业务详情分发器（POSITION 临时只读抽屉），无表单',
    'PositionSampleTaskStage.vue': '只读测试面板，无表单',
    'SkillFocusEditor.vue': '左侧文件栏（direction=ltr/260px），是导航不是编辑器',
    'ConnectorPublishDrawer.vue': '发布流程 + 自定义 header，非标准表单编辑器',
    'DrawerEditor.vue': '外壳自身'
  }

  it('没有新增裸写 el-drawer 的文件（新抽屉一律走 DrawerEditor）', async () => {
    const files = import.meta.glob('@/**/*.vue', { query: '?raw', import: 'default', eager: true })
    // 先自证 glob 真的扫到了文件——否则下面的循环零次执行，断言形同虚设
    expect(Object.keys(files).length).toBeGreaterThan(50)
    const bare = Object.entries(files)
      .filter(([, src]) => /<el-drawer[\s>]/.test(src))
      .map(([path]) => path.split('/').pop())
    for (const f of bare) {
      expect(BARE_DRAWER_ALLOWLIST[f], `${f} 裸写了 el-drawer：请改用 DrawerEditor，或在白名单里写明理由`).toBeTruthy()
    }
  })

  it('含输入控件的裸抽屉必须禁「点遮罩关闭」（防误触丢草稿）', async () => {
    const files = import.meta.glob('@/**/*.vue', { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(files).length).toBeGreaterThan(50)
    let checked = 0
    for (const [path, src] of Object.entries(files)) {
      const name = path.split('/').pop()
      if (name === 'DrawerEditor.vue' || !/<el-drawer[\s>]/.test(src)) continue
      // 抽屉段落内出现输入类控件即视为「有可丢失状态」
      const seg = src.slice(src.indexOf('<el-drawer'))
      const hasInput = /el-checkbox-group|<el-input|<el-switch|<el-radio-group/.test(seg)
      if (hasInput) {
        checked++
        expect(seg, `${name} 抽屉内有输入控件但未禁点遮罩关闭`).toContain('close-on-click-modal')
      }
    }
    // 自证确实检查到了含输入的裸抽屉（当前为 ConnectorPublishDrawer / SkillFocusEditor）
    expect(checked).toBeGreaterThan(0)
  })
})
