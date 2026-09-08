// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * RiskSettingsDrawer.vue 单测（2026-09-08 PRD-20260908 对齐 · md §七「风险设置」抽屉）。
 *
 * 验：标题「风险设置」；卡 1「当前审查尺度」单选 通用 / 严格 / 宽松 默认通用、选择即时生效（setCurrentScale）；
 * 卡 2 说明文 + Tab 宽松 / 通用 / 严格 默认通用 + 表格三列、四检测项（展示名）各自可选等级集合与默认值；
 * 【恢复默认】当前 Tab 回默认值 + toast「已恢复默认设置」；【取消】不保存；【保存设置】只存当前 Tab → toast「「尺度」审核尺度设置已保存」并关闭。
 */

const getRiskConfig = vi.fn()
const setCurrentScale = vi.fn()
const saveRiskTemplate = vi.fn()
vi.mock('@/api/skillReview', () => ({
  getRiskConfig: (...a) => getRiskConfig(...a),
  setCurrentScale: (...a) => setCurrentScale(...a),
  saveRiskTemplate: (...a) => saveRiskTemplate(...a)
}))
const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage }))

const Drawer = (await import('@/components/admin/RiskSettingsDrawer.vue')).default
const { DEFAULT_RISK_TEMPLATES } = await import('@/utils/userSkillAuditMeta')

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
  props: { disabled: Boolean, loading: Boolean, type: String },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :data-type="type" @click="!disabled && $emit(\'click\')"><slot /></button>'
}
const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }
const elSkeleton = { props: ['rows'], template: '<div class="el-skeleton" />' }
// 单选组：渲染 radio input，change 时同时 emit update:modelValue 与 change（模拟 EP 行为）
const elRadioGroup = {
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  provide() {
    return { rg: this }
  },
  methods: {
    pick(v) {
      this.$emit('update:modelValue', v)
      this.$emit('change', v)
    }
  },
  template: '<div class="el-radio-group" :data-value="modelValue"><slot /></div>'
}
const elRadio = {
  props: ['value'],
  inject: ['rg'],
  template:
    '<label class="el-radio" :data-checked="rg.modelValue === value"><input type="radio" :value="value" :checked="rg.modelValue === value" @change="rg.pick(value)" /><slot /></label>'
}

let app, container
const onVisible = vi.fn()
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () => h(Drawer, { visible: true, 'onUpdate:visible': onVisible })
    }
  })
  app.component('el-drawer', elDrawer)
  app.component('el-button', elButton)
  app.component('el-empty', elEmpty)
  app.component('el-skeleton', elSkeleton)
  app.component('el-radio-group', elRadioGroup)
  app.component('el-radio', elRadio)
  app.mount(container)
  await flush()
  return container
}
async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()
  }
}
const footBtn = (t) => [...container.querySelectorAll('.dr-footer .el-button')].find((b) => b.textContent.trim() === t)
const tabs = () => [...container.querySelectorAll('.rsd-tab')]
const tab = (t) => tabs().find((b) => b.textContent.trim() === t)
const rowByItem = (item) => container.querySelector(`.rsd-table tr[data-item="${item}"]`)
const rowOptions = (item) => [...rowByItem(item).querySelectorAll('.el-radio')].map((l) => l.textContent.trim())
const rowValue = (item) => rowByItem(item).querySelector('.el-radio-group').dataset.value
function pickRow(item, value) {
  const input = [...rowByItem(item).querySelectorAll('input')].find((i) => i.value === value)
  input.dispatchEvent(new Event('change'))
}
const clone = (o) => JSON.parse(JSON.stringify(o))

beforeEach(() => {
  getRiskConfig.mockReset().mockResolvedValue({ currentScale: '通用', templates: clone(DEFAULT_RISK_TEMPLATES) })
  setCurrentScale.mockReset().mockResolvedValue({})
  saveRiskTemplate.mockReset().mockResolvedValue({})
  onVisible.mockReset()
  ElMessage.success.mockReset()
  ElMessage.error.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('RiskSettingsDrawer（2026-09-08 PRD-20260908 对齐）', () => {
  it('标题「风险设置」；两张卡：当前审查尺度（通用 / 严格 / 宽松，默认通用）+ 模板配置说明文', async () => {
    await mount()
    expect(container.querySelector('.de-head-title').textContent.trim()).toBe('风险设置')
    const titles = [...container.querySelectorAll('.section-title')].map((t) => t.textContent.trim())
    expect(titles).toEqual(['当前审查尺度', '审核尺度模板配置'])
    const current = container.querySelector('.rsd-current')
    expect([...current.querySelectorAll('.el-radio')].map((l) => l.textContent.trim())).toEqual(['通用', '严格', '宽松'])
    expect(current.dataset.value).toBe('通用')
    expect(container.querySelector('.rsd-desc').textContent).toBe('维护三套审核尺度模板，管控技能上传的安全检测策略。')
    // 原型 SCALE_DESC 旧模型文案不搬
    expect(container.textContent).not.toContain('阻断')
  })

  it('当前审查尺度：选择即时生效（调 setCurrentScale），失败回滚', async () => {
    await mount()
    ;[...container.querySelectorAll('.rsd-current input')].find((i) => i.value === '严格').dispatchEvent(new Event('change'))
    await flush()
    expect(setCurrentScale).toHaveBeenCalledWith('严格')
    expect(container.querySelector('.rsd-current').dataset.value).toBe('严格')
    setCurrentScale.mockRejectedValueOnce(new Error('设置失败'))
    ;[...container.querySelectorAll('.rsd-current input')].find((i) => i.value === '宽松').dispatchEvent(new Event('change'))
    await flush()
    expect(container.querySelector('.rsd-current').dataset.value).toBe('严格')
    expect(ElMessage.error).toHaveBeenCalledWith('设置失败')
  })

  it('Tab 宽松 / 通用 / 严格，默认打开通用；表格三列、四检测项展示名、各项可选等级集合与默认值（md §7.2）', async () => {
    await mount()
    expect(tabs().map((b) => b.textContent.trim())).toEqual(['宽松', '通用', '严格'])
    expect(tab('通用').className).toContain('active')
    expect([...container.querySelectorAll('.rsd-table th')].map((t) => t.textContent.trim())).toEqual(['检测项', '说明', '触发审核的最低风险等级'])
    expect([...container.querySelectorAll('.rsd-table .rsd-item')].map((t) => t.textContent.trim())).toEqual(['对外动作', '敏感信息', '权限范围', '危险操作'])
    expect(container.textContent).not.toContain('敏感信息明文凭证')
    expect(rowOptions('对外动作')).toEqual(['严重风险', '高风险', '中风险', '不进入审核'])
    expect(rowOptions('敏感信息明文凭证')).toEqual(['严重风险', '高风险', '不进入审核'])
    expect(rowOptions('权限范围')).toEqual(['高风险', '中风险', '低风险', '不进入审核'])
    expect(rowOptions('危险操作')).toEqual(['严重风险', '高风险', '中风险', '低风险', '不进入审核'])
    // 通用默认值
    expect(['对外动作', '敏感信息明文凭证', '权限范围', '危险操作'].map(rowValue)).toEqual(['高风险', '严重风险', '高风险', '高风险'])
    // 切到宽松：全部 不进入审核；严格：中 / 严重 / 中 / 中
    tab('宽松').click()
    await flush()
    expect(['对外动作', '敏感信息明文凭证', '权限范围', '危险操作'].map(rowValue)).toEqual(['不进入审核', '不进入审核', '不进入审核', '不进入审核'])
    tab('严格').click()
    await flush()
    expect(['对外动作', '敏感信息明文凭证', '权限范围', '危险操作'].map(rowValue)).toEqual(['中风险', '严重风险', '中风险', '中风险'])
  })

  it('【保存设置】只保存当前 Tab 草稿 → toast「「通用」审核尺度设置已保存」并关闭', async () => {
    await mount()
    pickRow('对外动作', '中风险')
    pickRow('危险操作', '不进入审核')
    await flush()
    footBtn('保存设置').click()
    await flush()
    expect(saveRiskTemplate).toHaveBeenCalledWith('通用', {
      对外动作: '中风险',
      敏感信息明文凭证: '严重风险',
      权限范围: '高风险',
      危险操作: '不进入审核'
    })
    expect(ElMessage.success).toHaveBeenCalledWith('「通用」审核尺度设置已保存')
    expect(onVisible).toHaveBeenCalledWith(false)
  })

  it('【恢复默认】当前 Tab 回默认值 + toast「已恢复默认设置」，不落库', async () => {
    await mount()
    tab('严格').click()
    await flush()
    pickRow('对外动作', '严重风险')
    await flush()
    expect(rowValue('对外动作')).toBe('严重风险')
    footBtn('恢复默认').click()
    await flush()
    expect(rowValue('对外动作')).toBe('中风险')
    expect(ElMessage.success).toHaveBeenCalledWith('已恢复默认设置')
    expect(saveRiskTemplate).not.toHaveBeenCalled()
  })

  it('【取消】不保存：关闭且不调保存接口', async () => {
    await mount()
    pickRow('对外动作', '中风险')
    await flush()
    footBtn('取消').click()
    await flush()
    expect(saveRiskTemplate).not.toHaveBeenCalled()
    expect(onVisible).toHaveBeenCalledWith(false)
  })

  it('保存失败 → toast 错误、抽屉不关', async () => {
    saveRiskTemplate.mockRejectedValueOnce(new Error('保存失败'))
    await mount()
    footBtn('保存设置').click()
    await flush()
    expect(ElMessage.error).toHaveBeenCalledWith('保存失败')
    expect(onVisible).not.toHaveBeenCalled()
  })
})
