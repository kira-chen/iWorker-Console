// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * PositionDataTableStage（工作档案子页面）挂载级契约。
 * 2026-09-09 原型复刻批次 4A 重写：骨架改为「左侧档案列表面板 + 右侧 基本信息 / 编目信息 / 档案详情 三卡」
 * （md §4 + 原型 pane() L2302 / alignWorkProfile L2706 / L4010），编目与详情改行内网格、不再走弹窗。
 *
 *  1. 已有档案：左栏档案卡 + 「＋ 新增」；右侧三卡标题与 N / 8 计数；基本信息卡头带 取消/保存；
 *  2. 保存 = 卡位 → 元信息 → dossier 三步（卡位在前：其二次确认取消时不留半提交，yuepu#13 P5），dossier payload 已归一化（含 confirmMode / desc），提示「配置已保存到页面草稿」；
 *  3. 无档案：中部空态提示，不渲染档案卡；
 *  4. 本地校验失败不发请求；
 *  5. 只读态：无 取消/保存、无「＋ 新增」、无删除按钮；
 *  6.（2026-09-12 审计 T53）编目信息「唯一 ID」单选互斥（md §4.2.2 L282，DossierCatalogGrid 真挂载）
 *     + 【取消】toast「已取消未保存修改」（md §4.2.1 L275）。
 * 注：「新建档案弹窗【取消】【下一步】+ 工作档案已创建…」口径 e705dfb（09-08）已从 md 删（现行 §4.1 右侧弹表单、
 *     §4.2 只有【保存】【取消】），记代码缺陷 K10，该用例钉现状不动，修后随改。
 *
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md §4.2.1 / §4.2.2 + 一览表第 11 行补：
 *  - 档案名称最多 64、档案说明最多 500（基本信息卡）；编目字段名最多 64、编目说明最多 200（DossierCatalogGrid 真挂载）；
 *  - 置信度阈值下拉「高 / 中（推荐）/ 低」；用户确认下拉「低置信需确认（推荐）/ 全部需要确认 / 不需要确认」——
 *    首项代码多一个「度」字（「低置信度需确认（推荐）」），以 it.fails 按 md 钉桩。
 */

const api = vi.hoisted(() => ({
  listDataTables: vi.fn(),
  getDataTable: vi.fn(),
  createDataTable: vi.fn(),
  updateDataTable: vi.fn(),
  saveDataTableFields: vi.fn(),
  deleteDataTable: vi.fn(),
  getTableDeleteImpact: vi.fn(),
  saveDossierConfig: vi.fn()
}))
const msg = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/api/dataTable', () => api)
vi.mock('element-plus', () => ({
  ElMessage: msg,
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) }
}))
vi.mock('@element-plus/icons-vue', () => ({ Delete: { template: '<i />' } }))

import { ElMessageBox } from 'element-plus'
import PositionDataTableStage from '@/components/position/PositionDataTableStage.vue'

const passthrough = (tag = 'div') => ({ template: `<${tag}><slot /><slot name="title" /><slot name="label" /></${tag}>` })
const stubs = {
  'el-button': { props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
  'el-input': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  'el-input-number': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input type="number" :value="modelValue" />' },
  'el-select': { props: ['modelValue'], emits: ['update:modelValue'], template: '<div class="sel"><slot /></div>' },
  'el-option': { props: ['label'], template: '<div class="opt">{{ label }}<slot /></div>' },
  'el-checkbox': { props: ['modelValue'], template: '<label class="cbx"><slot /></label>' },
  'el-switch': { props: ['modelValue'], template: '<span />' },
  'el-dialog': { props: ['modelValue', 'title'], template: '<div class="dlg" v-if="modelValue"><slot /><slot name="footer" /></div>' },
  'el-form': passthrough('form'),
  'el-form-item': passthrough(),
  'el-alert': { props: ['title'], template: '<div class="alert">{{ title }}</div>' },
  'el-skeleton': passthrough(),
  'el-empty': passthrough(),
  'el-icon': passthrough('i'),
  'el-tooltip': passthrough()
}

function mount(props) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp({ render: () => h(PositionDataTableStage, props) })
  app.directive('loading', {})
  Object.entries(stubs).forEach(([k, v]) => app.component(k, v))
  app.mount(el)
  return el
}

function btnByText(el, scope, text) {
  return Array.from(el.querySelectorAll(`${scope} button`)).find((b) => b.textContent.trim() === text)
}
function clickSave(el) {
  const btn = btnByText(el, '.wd-head-actions', '保存')
  expect(btn).toBeTruthy()
  btn.click()
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await nextTick()
  await new Promise((r) => setTimeout(r, 0))
}

const detail = {
  id: 'dt_1',
  tableCode: 'ke_hu',
  label: '客户',
  description: '',
  status: 'active',
  recordCount: 0,
  fields: [
    { id: 'df_uid', fieldCode: 'uid', label: '数据归属用户', fieldType: 'INTEGER', isSystem: true, sortOrder: -1 },
    { id: 'df_1', fieldCode: 'ke_hu_ming', label: '客户名', fieldType: 'TEXT', slotRole: 'IDENTITY', isPrimary: true, required: true, sortOrder: 0 },
    { id: 'df_2', fieldCode: 'jie_duan', label: '阶段标签', fieldType: 'ENUM', options: ['需求', '方案'], slotRole: 'LABEL', sortOrder: 1 }
  ],
  dossier: {
    policy: { writeTier: 'HIGH', confirmMode: 'ALL' },
    reduceRules: [{ key: '预算', strategy: 'CONFLICTS', params: { staleAfterDays: 30 }, desc: '客户口径' }, { key: '态势', strategy: 'SUMMARY', params: { n: 3 } }]
  }
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  Object.values(msg).forEach((f) => f.mockReset())
  api.listDataTables.mockResolvedValue({ list: [{ id: 'dt_1', label: '客户', status: 'active', fieldCount: 2, recordCount: 0 }] })
  api.getDataTable.mockResolvedValue(detail)
  api.updateDataTable.mockResolvedValue({})
  api.saveDataTableFields.mockResolvedValue({})
  api.saveDossierConfig.mockImplementation((_p, _t, payload) => Promise.resolve(payload))
  document.body.innerHTML = ''
})

describe('PositionDataTableStage · 工作档案配置台', () => {
  it('左侧档案列表面板 + 右侧三卡（基本信息 / 编目信息 / 档案详情），计数正确', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    // 左栏：一张档案卡（选中）+「＋ 新增」
    expect(el.querySelectorAll('.wd-side .wd-profile-card.on').length).toBe(1)
    expect(el.querySelector('.wd-side .wd-profile-card span').textContent).toContain('2 个字段')
    expect(el.querySelector('.wd-add-tab').textContent.trim()).toBe('＋ 新增')
    // 右栏：三张卡，标题照 md §4.2
    const heads = Array.from(el.querySelectorAll('.wd-sec .wd-sec-head strong')).map((h) => h.textContent.trim())
    expect(heads).toEqual(['基本信息', '编目信息', '档案详情'])
    // 基本信息卡头带 取消/保存
    expect(btnByText(el, '.wd-head-actions', '取消')).toBeTruthy()
    expect(btnByText(el, '.wd-head-actions', '保存')).toBeTruthy()
    // 计数 N / 8
    const counters = Array.from(el.querySelectorAll('.wd-sec-head span')).map((s) => s.textContent.trim()).filter((t) => t.includes('/'))
    expect(counters).toEqual(['2 / 8', '2 / 8'])
    // 编目信息行内网格：2 行业务字段（不含 uid 系统行），无「必填」列（md 未列 + 原型 L4010 已删）
    expect(el.querySelectorAll('.dcg-row').length).toBe(2)
    expect(Array.from(el.querySelectorAll('.dcg-head span')).map((s) => s.textContent.trim())).toEqual(['字段名', '字段类型', '字段用途', '唯一 ID', '说明', ''])
    // 档案详情行内网格：2 行规则
    expect(el.querySelectorAll('.drg-row').length).toBe(2)
    expect(Array.from(el.querySelectorAll('.drg-head span')).map((s) => s.textContent.trim())).toEqual(['规则名', '规则描述', '归纳方式', ''])
    // 不再有弹窗式「编辑」入口 / 应沉淀清单
    expect(el.textContent).not.toContain('应沉淀清单')
  })

  it('编目信息字段类型下拉只给 md §4.2.2 六项（不含「标签（枚举）」）', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    const firstRowTypeOpts = Array.from(el.querySelectorAll('.dcg-row')[0].querySelectorAll('.sel')[0].querySelectorAll('.opt')).map((o) => o.textContent.trim())
    expect(firstRowTypeOpts).toEqual(['日期', '长文本', '短文本', '整数', '小数', '是否'])
  })

  it('保存走 卡位 → 元信息 → dossier 三步，payload 已归一化，提示「配置已保存到页面草稿」', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    clickSave(el)
    await flush()
    expect(api.updateDataTable).toHaveBeenCalledWith('ps_1', 'dt_1', { label: '客户', description: null, status: 'active' })
    expect(api.saveDataTableFields).toHaveBeenCalledTimes(1)
    const fieldsPayload = api.saveDataTableFields.mock.calls[0][2]
    expect(fieldsPayload.map((f) => [f.label, f.slotRole, f.options, f.isPrimary])).toEqual([
      ['客户名', 'IDENTITY', null, true],
      ['阶段标签', 'LABEL', ['需求', '方案'], false]
    ])
    expect(api.saveDossierConfig).toHaveBeenCalledTimes(1)
    const dossierPayload = api.saveDossierConfig.mock.calls[0][2]
    expect(dossierPayload.policy.writeTier).toBe('HIGH')
    expect(dossierPayload.policy.confirmMode).toBe('ALL')
    // 2026-09-12 负责人决策 6（审计 J13）：md §4.2.1 无应沉淀清单，payload 不再带 checklist
    expect(dossierPayload.checklist).toBeUndefined()
    expect(dossierPayload.reduceRules).toEqual([
      { key: '预算', strategy: 'CONFLICTS', params: { normalize: true, staleAfterDays: 30 }, desc: '客户口径' },
      { key: '态势', strategy: 'SUMMARY', params: { n: 3 }, desc: null }
    ])
    expect(msg.success).toHaveBeenCalledWith('配置已保存到页面草稿')
  })

  it('删除字段的二次确认点「再想想」→ 整个保存中止，基本信息/抽取策略都不落库（2026-09-18 待办 yuepu#13·岗位 P5：此前先写基本信息，取消后半提交）', async () => {
    const needConfirm = Object.assign(new Error('需确认'), { data: { errorCode: 'FIELD_DELETE_NEED_CONFIRM', affectedRows: 3, deleteFieldCodes: ['f1'] } })
    api.saveDataTableFields.mockRejectedValueOnce(needConfirm)
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    clickSave(el)
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(api.saveDataTableFields).toHaveBeenCalledTimes(1) // 只有非强制的那次试探，没有 force=true 重试
    expect(api.updateDataTable).not.toHaveBeenCalled()
    expect(api.saveDossierConfig).not.toHaveBeenCalled()
    expect(msg.success).not.toHaveBeenCalled()
  })

  it('无档案：中部空态提示，不渲染档案卡', async () => {
    api.listDataTables.mockResolvedValue({ list: [] })
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    expect(el.querySelector('.wd-profile-card')).toBeNull()
    expect(el.querySelector('.wd-empty').textContent).toContain('还没有工作档案')
    expect(api.getDataTable).not.toHaveBeenCalled()
  })

  it('新建档案弹窗：底部【取消】【下一步】，确认后提示继续配置（钉现状，md §4.1/§4.2 无此弹窗，代码缺陷待登记）', async () => {
    api.listDataTables.mockResolvedValue({ list: [] })
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    btnByText(el, '.wd-empty', '＋ 新增').click()
    await flush()
    const dlg = el.querySelector('.dlg') || document.querySelector('.dlg')
    expect(dlg).toBeTruthy()
    expect(Array.from(dlg.querySelectorAll('button')).map((b) => b.textContent.trim())).toEqual(['取消', '下一步'])
    dlg.querySelector('input').dispatchEvent(new Event('input'))
    const nameInput = dlg.querySelector('input')
    nameInput.value = '经营分析报告'
    nameInput.dispatchEvent(new Event('input'))
    await flush()
    Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent.trim() === '下一步').click()
    await flush()
    expect(msg.success).toHaveBeenCalledWith('工作档案已创建，请继续配置编目信息和档案详情')
  })

  it('本地校验失败（档案详情超 8 条）→ 不发请求并标红', async () => {
    api.getDataTable.mockResolvedValue({ ...detail, dossier: { ...detail.dossier, reduceRules: Array.from({ length: 9 }, (_, i) => ({ key: 'k' + i, strategy: 'LATEST' })) } })
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    clickSave(el)
    await flush()
    expect(api.updateDataTable).not.toHaveBeenCalled()
    expect(api.saveDossierConfig).not.toHaveBeenCalled()
    expect(el.querySelector('.drg-err-text').textContent).toContain('最多 8 条')
  })

  it('编目信息「唯一 ID」单选互斥：勾第 2 行 → 第 1 行自动取消；再点第 2 行 → 全部取消（md §4.2.2 L282）', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    const uniques = () => Array.from(el.querySelectorAll('.dcg-row .dcg-unique')).map((b) => b.textContent.trim())
    // 种子：客户名 isPrimary=true、阶段标签 false
    expect(uniques()).toEqual(['✓', '✕'])
    el.querySelectorAll('.dcg-row .dcg-unique')[1].click()
    await flush()
    expect(uniques()).toEqual(['✕', '✓'])
    // 再点已勾选的那条 → 取消，允许 0 条（md「至多勾选 1 条」）
    el.querySelectorAll('.dcg-row .dcg-unique')[1].click()
    await flush()
    expect(uniques()).toEqual(['✕', '✕'])
    // 保存 payload 跟随：全取消后两行 isPrimary 均 false
    clickSave(el)
    await flush()
    expect(api.saveDataTableFields.mock.calls[0][2].map((f) => f.isPrimary)).toEqual([false, false])
  })

  it('编目信息达 8 条 → 「＋ 新增条目」不再加行并给上限提示（md §4.2.2 至多 8 条）', async () => {
    api.getDataTable.mockResolvedValue({
      ...detail,
      fields: [detail.fields[0], ...Array.from({ length: 8 }, (_, i) => ({ id: `df_${i}`, fieldCode: `f${i}`, label: `字段${i}`, fieldType: 'TEXT', slotRole: '', isPrimary: false, sortOrder: i }))]
    })
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    expect(el.querySelectorAll('.dcg-row').length).toBe(8)
    el.querySelector('.dcg-add').click()
    await flush()
    expect(el.querySelectorAll('.dcg-row').length).toBe(8)
    expect(msg.warning).toHaveBeenCalledTimes(1)
    expect(msg.warning).toHaveBeenCalledWith('编目信息最多 8 条')
  })

  it('基本信息卡头【取消】→ 放弃本次编辑、重拉详情并 toast「已取消未保存修改」（md §4.2.1 L275）', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    api.getDataTable.mockClear()
    btnByText(el, '.wd-head-actions', '取消').click()
    await flush()
    expect(api.getDataTable).toHaveBeenCalledWith('ps_1', 'dt_1')
    expect(msg.info).toHaveBeenCalledWith('已取消未保存修改')
    expect(api.updateDataTable).not.toHaveBeenCalled()
  })

  it('基本信息「档案名称」标必填红星（编辑态；与新建弹窗的必填一致，2026-09-21 统一标注红星）；只读态不显示星', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    const nameLabel = Array.from(el.querySelectorAll('.wd-field label')).find((l) => l.textContent.includes('档案名称'))
    expect(nameLabel.querySelector('.wd-req')?.textContent).toBe('*')
    const ro = mount({ positionId: 'ps_1', embedded: true, readonly: true })
    await flush()
    const roLabel = Array.from(ro.querySelectorAll('.wd-field label')).find((l) => l.textContent.includes('档案名称'))
    expect(roLabel.querySelector('.wd-req')).toBeNull()
  })

  it('只读态：无 取消/保存、无「＋ 新增」、无删除与行内删除', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true, readonly: true })
    await flush()
    expect(el.querySelector('.wd-head-actions')).toBeNull()
    expect(el.querySelector('.wd-add-tab')).toBeNull()
    expect(el.querySelector('.wd-danger-row')).toBeNull()
    expect(el.querySelector('.dcg-add')).toBeNull()
    expect(el.querySelector('.drg-add')).toBeNull()
    expect(el.querySelector('.dcg-del')).toBeNull()
  })
})

describe('PositionDataTableStage · 字段上限与下拉选项（2026-10-08 对齐 md §4.2.1 / §4.2.2）', () => {
  const fieldByLabel = (el, label) => Array.from(el.querySelectorAll('.wd-basic-fields .wd-field')).find((f) => f.querySelector('label')?.textContent.replace('*', '').trim() === label)
  const policyField = (el, label) => Array.from(el.querySelectorAll('.wd-policy .wd-field')).find((f) => f.querySelector('label')?.textContent.trim() === label)
  const optionLabels = (field) => Array.from(field.querySelectorAll('.opt')).map((o) => o.textContent.trim())

  it('基本信息「档案名称」输入框最多 64 个字符', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    expect(fieldByLabel(el, '档案名称').querySelector('input').getAttribute('maxlength')).toBe('64')
  })

  it('基本信息「档案说明」输入框最多 500 个字符（工作档案例外，不适用描述类 2000）', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    expect(fieldByLabel(el, '档案说明').querySelector('input').getAttribute('maxlength')).toBe('500')
  })

  it('编目信息每行「字段名」最多 64 个字符', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    const rows = Array.from(el.querySelectorAll('.dcg-row'))
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.querySelectorAll('input')[0].getAttribute('placeholder')).toBe('如 分析周期')
    expect(rows.map((r) => r.querySelectorAll('input')[0].getAttribute('maxlength'))).toEqual(['64', '64'])
  })

  it('编目信息每行「说明」最多 200 个字符', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    const rows = Array.from(el.querySelectorAll('.dcg-row'))
    for (const r of rows) expect(r.querySelectorAll('input')[1].getAttribute('placeholder')).toBe('填写字段业务释义')
    expect(rows.map((r) => r.querySelectorAll('input')[1].getAttribute('maxlength'))).toEqual(['200', '200'])
  })

  it('「置信度阈值」下拉三项：高 / 中（推荐）/ 低', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    expect(optionLabels(policyField(el, '置信度阈值'))).toEqual(['高', '中（推荐）', '低'])
  })

  it('「用户确认」下拉共三项，后两项为「全部需要确认」「不需要确认」，首项标「（推荐）」', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    const labels = optionLabels(policyField(el, '用户确认'))
    expect(labels).toHaveLength(3)
    expect(labels.slice(1)).toEqual(['全部需要确认', '不需要确认'])
    expect(labels[0].endsWith('（推荐）')).toBe(true)
  })

  it.fails('「用户确认」首项文案应为「低置信需确认（推荐）」（疑似缺陷：utils/dossierConfig.js CONFIRM_MODES 写成「低置信度需确认（推荐）」多一个「度」；md 岗位 §4.2.1「下拉：低置信需确认（推荐）/ 全部需要确认 / 不需要确认」）', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    expect(optionLabels(policyField(el, '用户确认'))[0]).toBe('低置信需确认（推荐）')
  })
})
