// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * ProviderSystemEditor.vue 单测（2026-09-12 测试审计 T58 新建；146 行此前零用例）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/API/prd-API.md §二.5 L78 + 一览表 §6.1：
 *   弹窗展示系统名称（必填，最多 64 字符，平台内不可重复）和系统描述（必填，最多 2000 字符）；
 *   保存成功后关闭弹窗并刷新列表，不跳转页面。
 * 桩：api/apiConnector、element-plus（ElMessage）、el-dialog（露 title）/ el-form-item（露 error）等最小桩。
 */

const conn = {
  createProviderSystem: vi.fn(),
  updateProviderSystem: vi.fn(),
  getProviderSystem: vi.fn()
}
vi.mock('@/api/apiConnector', () => conn)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg }))

const stubs = {
  'el-dialog': {
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue" class="el-dialog" :data-title="title"><slot /><div class="footer"><slot name="footer" /></div></div>'
  },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': {
    props: ['label', 'error'],
    template: '<div class="el-form-item" :data-label="label" :data-error="error"><slot /></div>'
  },
  'el-input': {
    props: ['modelValue', 'maxlength', 'placeholder'],
    emits: ['update:modelValue', 'input'],
    template:
      '<input class="el-input" :value="modelValue" :maxlength="maxlength" :placeholder="placeholder"' +
      ' @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />'
  },
  'el-button': {
    props: ['type', 'loading'],
    emits: ['click'],
    template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>'
  }
}

let app, container, visible, saved
async function flush(n = 5) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
async function mountEditor(systemId = null) {
  const { default: Editor } = await import('@/components/admin/ProviderSystemEditor.vue')
  container = document.createElement('div')
  document.body.appendChild(container)
  visible = ref(false)
  saved = vi.fn()
  app = createApp({
    render: () => h(Editor, { visible: visible.value, systemId, 'onUpdate:visible': (v) => (visible.value = v), onSaved: saved })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.directive('loading', {})
  app.mount(container)
  await nextTick()
  visible.value = true
  await flush()
  return container
}
const item = (el, label) => [...el.querySelectorAll('.el-form-item')].find((it) => it.dataset.label === label)
const inputOf = (el, label) => item(el, label).querySelector('input.el-input')
const setInput = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const findBtn = (el, text) => [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)

beforeEach(() => {
  vi.clearAllMocks()
  conn.getProviderSystem.mockResolvedValue({ id: 'pv_1', name: '财务服务系统', description: '聚合报销、付款与财务单据接口' })
  conn.createProviderSystem.mockResolvedValue({ id: 'pv_9', name: 'x', description: 'y' })
  conn.updateProviderSystem.mockResolvedValue({ id: 'pv_1' })
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('ProviderSystemEditor · 服务提供系统弹窗（md §二.5 L78）', () => {
  it('新建：标题「新建服务提供系统」，两个字段占位「如 财务服务系统」/「如 聚合报销、付款与财务单据接口」，底部【取消】【保存】', async () => {
    const el = await mountEditor(null)
    expect(el.querySelector('.el-dialog').dataset.title).toBe('新建服务提供系统')
    expect(inputOf(el, '系统名称').placeholder).toBe('如 财务服务系统')
    expect(inputOf(el, '系统名称').getAttribute('maxlength')).toBe('64')
    expect(inputOf(el, '系统描述').placeholder).toBe('如 聚合报销、付款与财务单据接口')
    expect([...el.querySelectorAll('.footer .el-button')].map((b) => b.textContent.trim())).toEqual(['取消', '保存'])
    expect(conn.getProviderSystem).not.toHaveBeenCalled()
  })

  it('名称 / 描述都空点【保存】 → 两项标红「系统名称必填」「系统描述必填」+ warning「请先修正标红项」，不调 createProviderSystem', async () => {
    const el = await mountEditor(null)
    findBtn(el, '保存').click()
    await flush()
    expect(item(el, '系统名称').dataset.error).toBe('系统名称必填')
    expect(item(el, '系统描述').dataset.error).toBe('系统描述必填')
    expect(msg.warning).toHaveBeenCalledWith('请先修正标红项')
    expect(conn.createProviderSystem).not.toHaveBeenCalled()
    expect(el.querySelector('.el-dialog')).toBeTruthy()
  })

  it('名称 65 字 → 「系统名称最多 64 字符」；描述 2001 字 → 「系统描述最多 2000 字符」；64 / 2000 字通过', async () => {
    const el = await mountEditor(null)
    setInput(inputOf(el, '系统名称'), 'x'.repeat(65))
    setInput(inputOf(el, '系统描述'), 'd'.repeat(2001))
    findBtn(el, '保存').click()
    await flush()
    expect(item(el, '系统名称').dataset.error).toBe('系统名称最多 64 字符')
    expect(item(el, '系统描述').dataset.error).toBe('系统描述最多 2000 字符')
    expect(conn.createProviderSystem).not.toHaveBeenCalled()
    setInput(inputOf(el, '系统名称'), 'x'.repeat(64))
    setInput(inputOf(el, '系统描述'), 'd'.repeat(2000))
    findBtn(el, '保存').click()
    await flush()
    expect(conn.createProviderSystem).toHaveBeenCalledTimes(1)
  })

  it('输入时清掉该字段红框（重新点保存前不残留）', async () => {
    const el = await mountEditor(null)
    findBtn(el, '保存').click()
    await flush()
    expect(item(el, '系统名称').dataset.error).toBe('系统名称必填')
    setInput(inputOf(el, '系统名称'), '客户数据平台')
    await nextTick()
    expect(item(el, '系统名称').getAttribute('data-error')).toBeFalsy()
    expect(item(el, '系统描述').dataset.error).toBe('系统描述必填')
  })

  it('新建合法保存 → payload 做 trim、createProviderSystem 一次 + 「已保存」+ emit saved 带新 id + 弹窗关闭（L78「保存成功后关闭弹窗并刷新列表」）', async () => {
    const el = await mountEditor(null)
    setInput(inputOf(el, '系统名称'), '  内容服务中心  ')
    setInput(inputOf(el, '系统描述'), ' 内容审核与素材服务 ')
    findBtn(el, '保存').click()
    await flush()
    expect(conn.createProviderSystem).toHaveBeenCalledWith({ name: '内容服务中心', description: '内容审核与素材服务' })
    expect(msg.success).toHaveBeenCalledWith('已保存')
    expect(saved).toHaveBeenCalledWith({ id: 'pv_9' })
    expect(visible.value).toBe(false)
    expect(el.querySelector('.el-dialog')).toBeNull()
  })

  it('数据层重名（field=name「系统名称平台内不可重复」）→ 名称标红回显 + error 提示，弹窗仍开、输入保留', async () => {
    conn.createProviderSystem.mockRejectedValueOnce({ field: 'name', message: '系统名称平台内不可重复' })
    const el = await mountEditor(null)
    setInput(inputOf(el, '系统名称'), '财务服务系统')
    setInput(inputOf(el, '系统描述'), '重名测试')
    findBtn(el, '保存').click()
    await flush()
    expect(item(el, '系统名称').dataset.error).toBe('系统名称平台内不可重复')
    expect(msg.error).toHaveBeenCalledWith('系统名称平台内不可重复')
    expect(visible.value).toBe(true)
    expect(el.querySelector('.el-dialog')).toBeTruthy()
    expect(inputOf(el, '系统名称').value).toBe('财务服务系统')
    expect(saved).not.toHaveBeenCalled()
    // 无 field 的失败 → 「保存失败」兜底
    conn.createProviderSystem.mockRejectedValueOnce(new Error(''))
    findBtn(el, '保存').click()
    await flush()
    expect(msg.error).toHaveBeenLastCalledWith('保存失败')
  })

  it('编辑：标题「编辑服务提供系统」，拉详情回填名称 / 描述；保存 → updateProviderSystem(id, payload) + saved 带原 id + 关闭', async () => {
    const el = await mountEditor('pv_1')
    expect(conn.getProviderSystem).toHaveBeenCalledWith('pv_1')
    expect(el.querySelector('.el-dialog').dataset.title).toBe('编辑服务提供系统')
    expect(inputOf(el, '系统名称').value).toBe('财务服务系统')
    expect(inputOf(el, '系统描述').value).toBe('聚合报销、付款与财务单据接口')
    setInput(inputOf(el, '系统描述'), '改过的描述')
    findBtn(el, '保存').click()
    await flush()
    expect(conn.updateProviderSystem).toHaveBeenCalledWith('pv_1', { name: '财务服务系统', description: '改过的描述' })
    expect(conn.createProviderSystem).not.toHaveBeenCalled()
    expect(msg.success).toHaveBeenCalledWith('已保存')
    expect(saved).toHaveBeenCalledWith({ id: 'pv_1' })
    expect(visible.value).toBe(false)
  })

  it('编辑详情拉取失败 → error 提示原因；【取消】关闭弹窗不保存', async () => {
    conn.getProviderSystem.mockRejectedValueOnce({ message: '服务提供系统不存在' })
    const el = await mountEditor('pv_404')
    expect(msg.error).toHaveBeenCalledWith('服务提供系统不存在')
    findBtn(el, '取消').click()
    await nextTick()
    expect(visible.value).toBe(false)
    expect(conn.updateProviderSystem).not.toHaveBeenCalled()
  })
})
