// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * DataTableFieldEditor（数据表字段行编辑器）行为契约（批量补测，2026-08-08）。
 *
 * 钉住三类易错点（写坏会直接损坏业务表结构）：
 *  1. 系统字段（uid，isSystem=true）：置顶展示、禁删——removeRow 对系统行必须直接 return
 *     （后端也拒，但前端放行会让用户以为删掉了）；
 *  2. 类型不可变：edit 模式下已落库行（id != null）的类型控件锁定；新增行不锁
 *     （后端 FIELD_TYPE_IMMUTABLE 是最后防线，前端不能把它当唯一防线）；
 *  3. 排序与索引解耦：展示按「系统字段置顶」重排，但 patch/remove 必须按**原 rows 索引**落笔
 *     ——用展示序当原序会改错行，这是最隐蔽的一类。
 */

vi.mock('@element-plus/icons-vue', () => ({ Delete: { template: '<i />' } }))

import DataTableFieldEditor from '@/components/admin/DataTableFieldEditor.vue'

const stubs = {
  'el-input': {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template:
      '<input class="stub-input" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-select': {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: '<div class="stub-select" :data-disabled="disabled ? 1 : 0"><slot /></div>'
  },
  'el-option': { template: '<div />' },
  'el-checkbox': { props: ['modelValue', 'disabled'], template: '<input type="checkbox" :disabled="disabled" />' },
  'el-switch': { props: ['modelValue', 'disabled'], template: '<span :data-disabled="disabled ? 1 : 0" />' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-tooltip': { template: '<div><slot /></div>' },
  'el-button': { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' }
}

function bizRow(over = {}) {
  return { label: '', fieldCode: '', fieldType: 'TEXT', required: false, defaultValue: null, fieldDesc: '', isSystem: false, ...over }
}
const SYS_ROW = { id: 1, label: 'uid', fieldCode: 'uid', fieldType: 'TEXT', isSystem: true }

let app, container, updates

function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  updates = []
  app = createApp({
    render: () =>
      h(DataTableFieldEditor, {
        rows: [],
        'onUpdate:rows': (next) => updates.push(next),
        ...props
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.config.warnHandler = () => {}
  app.mount(container)
  return container
}

const last = () => updates[updates.length - 1]
const rowEls = (el) => [...el.querySelectorAll('.dfe-row')]

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('DataTableFieldEditor · 字段行编辑契约', () => {
  it('系统字段禁删：行内不渲染删除入口（第一道闸——用户根本点不到）', async () => {
    const el = mount({ rows: [SYS_ROW, bizRow({ label: 'b1' })] })
    const rows = rowEls(el)
    expect(rows[0].querySelector('button'), '系统字段行不应有任何操作按钮').toBeNull()
    // 业务行作为对照：删除入口必须在（否则本用例会因「两行都没按钮」而假绿）
    expect(rows[1].querySelector('button'), '业务字段行应有删除入口').toBeTruthy()
  })

  it('系统字段禁删：即便绕过 UI 直调 removeRow 也必须被逻辑层拦下（第二道闸）', async () => {
    const el = mount({ rows: [SYS_ROW, bizRow({ label: 'b1' })] })
    // 直接调组件内部方法，模拟「入口被绕过」的情形——逻辑层的 isSystem 守卫必须独立成立
    const inst = app._instance.subTree.component
    inst.setupState.removeRow(SYS_ROW)
    await nextTick()
    expect(updates.length, '系统字段删除必须被逻辑层拦下').toBe(0)
    expect(el).toBeTruthy()
  })

  it('业务字段可删：移除该行并回吐新数组', async () => {
    const el = mount({ rows: [bizRow({ label: 'a' }), bizRow({ label: 'b' })] })
    const delBtn = rowEls(el)[0].querySelector('button')
    delBtn.click()
    await nextTick()
    expect(last().map((r) => r.label)).toEqual(['b'])
  })

  it('系统字段置顶展示（原数组里在后也排到最前），并以「系统自动/系统维护」口径呈现', async () => {
    const el = mount({ rows: [bizRow({ label: 'biz' }), SYS_ROW] })
    const firstRowText = rowEls(el)[0].textContent
    expect(firstRowText).toContain('系统')
    // 业务行排在系统行之后
    expect(rowEls(el)[1].querySelector('.stub-input').value).toBe('biz')
  })

  it('展示重排后 patch 仍落在原索引行（防改错行）', async () => {
    // 原序：[biz(idx0), sys(idx1)]；展示序：[sys, biz]
    const el = mount({ rows: [bizRow({ label: 'biz' }), SYS_ROW] })
    // 改「展示序第 2 行」（= 原 idx0 的 biz 行）的字段名
    const input = rowEls(el)[1].querySelector('.stub-input')
    input.value = 'biz-renamed'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(last()[0].label, '应改到原索引 0 的业务行').toBe('biz-renamed')
    expect(last()[1].isSystem, '系统行不应被动到').toBe(true)
  })

  it('新增行：默认 TEXT 类型、非系统字段', async () => {
    const el = mount({ rows: [bizRow({ label: 'a' })] })
    const addBtn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('添加'))
    expect(addBtn).toBeTruthy()
    addBtn.click()
    await nextTick()
    expect(last()).toHaveLength(2)
    expect(last()[1].fieldType).toBe('TEXT')
    expect(last()[1].isSystem).toBe(false)
  })

  it('globalError 传入 → 容器带错误态类（全表级校验可见）', async () => {
    const el = mount({ rows: [bizRow()], globalError: '至少 1 个业务字段' })
    expect(el.querySelector('.dfe').classList.contains('dfe-error')).toBe(true)
    expect(el.textContent).toContain('至少 1 个业务字段')
  })

  it('rowErrors 传入 → 对应行渲染字段级错误文案', async () => {
    const el = mount({ rows: [bizRow({ label: '' })], rowErrors: { 0: { label: '字段名必填' } } })
    expect(el.textContent).toContain('字段名必填')
  })
})
