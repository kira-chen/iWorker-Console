// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * PositionDataTableStage（工作档案子页面）挂载级契约（2026-08-28 负责人定稿）：
 *  1. 已有档案：顶部卡片 + 自动打开第一份；三区 = 沉淀策略（3 选项）/ 卡片字段 / 业务规则，计数正确；无应沉淀清单 UI；
 *  2. 保存 = 元信息 → 卡位 → dossier 三步，dossier payload 已归一化（含 confirmMode / desc）；
 *  3. 无档案：中部「新建工作档案」提示，不渲染顶部卡片条。
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
vi.mock('@/api/dataTable', () => api)
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) }
}))
vi.mock('@element-plus/icons-vue', () => ({ Delete: { template: '<i />' } }))
vi.mock('@/components/admin/DataTableFieldEditor.vue', () => ({ default: { props: ['rows'], template: '<div class="field-editor-stub" />' } }))
vi.mock('@/components/position/dossier/DossierRuleListEditor.vue', () => ({ default: { props: ['rows'], template: '<div class="rule-editor-stub" />' } }))

import PositionDataTableStage from '@/components/position/PositionDataTableStage.vue'

const passthrough = (tag = 'div') => ({ template: `<${tag}><slot /><slot name="title" /><slot name="label" /></${tag}>` })
const stubs = {
  'el-button': { props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
  'el-input': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  'el-input-number': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input type="number" :value="modelValue" />' },
  // el-select 桩：点击即选中 dt_1（对象类型切换用；抽屉内的 select 默认隐藏不参与）
  'el-select': { props: ['modelValue'], emits: ['update:modelValue'], template: '<div class="sel" @click="$emit(\'update:modelValue\', \'dt_1\')"><slot /></div>' },
  // el-table 桩：每行用 RowProvider 注入 row / index，列桩经 inject 取到后再把作用域插槽交给页面模板
  'el-table': {
    components: {
      RowProvider: {
        props: ['row', 'index'],
        provide() {
          return { tblRow: this.row, tblIndex: this.index }
        },
        template: '<tr class="tbl-row"><slot /></tr>'
      }
    },
    props: ['data'],
    template: '<table class="tbl"><tbody><RowProvider v-for="(row, i) in data" :key="i" :row="row" :index="i"><slot /></RowProvider></tbody></table>'
  },
  'el-table-column': {
    props: ['label', 'prop'],
    inject: ['tblRow', 'tblIndex'],
    template: '<td><slot :row="tblRow" :$index="tblIndex">{{ prop ? tblRow[prop] : "" }}</slot></td>'
  },
  'el-option': { template: '<div />' },
  'el-checkbox': { props: ['modelValue'], template: '<input type="checkbox" />' },
  'el-switch': { props: ['modelValue'], template: '<span />' },
  'el-dialog': { props: ['modelValue', 'title'], template: '<div class="dlg" v-if="modelValue"><slot /><slot name="footer" /></div>' },
  'el-radio-group': passthrough(),
  'el-radio-button': passthrough('span'),
  'el-form': passthrough('form'),
  'el-form-item': passthrough(),
  'el-collapse': passthrough(),
  'el-collapse-item': passthrough(),
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

async function select(el) {
  // 已有档案时组件挂载后自动打开第一份，无需再点
  await flush()
}

function clickSave(el) {
  const btn = Array.from(el.querySelectorAll('.wd-actions button')).find((b) => b.textContent.trim() === '保存')
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
    checklist: [{ key: '决策人', when: { type: 'ALWAYS' } }],
    reduceRules: [{ key: '预算', strategy: 'CONFLICTS', params: { staleAfterDays: 30 }, desc: '客户口径' }, { key: '态势', strategy: 'SUMMARY', params: { n: 3 } }]
  }
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  api.listDataTables.mockResolvedValue({ list: [{ id: 'dt_1', label: '客户', status: 'active', fieldCount: 2, recordCount: 0 }] })
  api.getDataTable.mockResolvedValue(detail)
  api.updateDataTable.mockResolvedValue({})
  api.saveDataTableFields.mockResolvedValue({})
  api.saveDossierConfig.mockImplementation((_p, _t, payload) => Promise.resolve(payload))
  document.body.innerHTML = ''
})

describe('PositionDataTableStage · 工作档案配置台', () => {
  it('已有档案：卡片 + 三区（策略 / 卡片字段 / 业务规则），无应沉淀清单 UI', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await select(el)
    expect(el.querySelectorAll('.wd-card.on').length).toBe(1)
    const heads = Array.from(el.querySelectorAll('.pd-list-head .pd-list-title')).map((h) => h.childNodes[0].textContent.trim())
    expect(heads).toEqual(['卡片字段', '业务规则'])
    expect(el.textContent).not.toContain('应沉淀清单')
    // 策略三选项都在
    expect(el.querySelectorAll('.wd-policy .sel').length).toBe(3)
    const secs = el.querySelectorAll('.wd-two section.pd-sec')
    expect(secs[0].querySelector('.pd-list-sub').textContent).toContain('2 / 8')
    expect(secs[0].querySelectorAll('.tbl-row').length).toBe(2) // 不含 uid 系统行
    expect(secs[1].querySelector('.pd-list-sub').textContent).toContain('2 / 8')
    expect(secs[1].textContent).toContain('客户口径')
    expect(secs[1].textContent).toContain('摘要最近 N 条（最近 3 条）')
  })

  it('无档案：中部「新建工作档案」提示，不渲染顶部卡片条', async () => {
    api.listDataTables.mockResolvedValue({ list: [] })
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    expect(el.querySelector('.wd-top')).toBeNull()
    expect(el.querySelector('.wd-empty').textContent).toContain('新建工作档案')
    expect(api.getDataTable).not.toHaveBeenCalled()
  })

  it('保存走 元信息 → 卡位 → dossier 三步，dossier payload 已归一化', async () => {
    const el = mount({ positionId: 'ps_1', embedded: true })
    await flush()
    await select(el)
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
    expect(dossierPayload.checklist).toEqual([{ key: '决策人', when: { type: 'ALWAYS' }, hint: null }])
    expect(dossierPayload.reduceRules).toEqual([
      { key: '预算', strategy: 'CONFLICTS', params: { normalize: true, staleAfterDays: 30 }, desc: '客户口径' },
      { key: '态势', strategy: 'SUMMARY', params: { n: 3 }, desc: null }
    ])
  })

  it('本地校验失败（业务规则超 8 条）→ 不发请求并提示', async () => {
    api.getDataTable.mockResolvedValue({ ...detail, dossier: { ...detail.dossier, reduceRules: Array.from({ length: 9 }, (_, i) => ({ key: 'k' + i, strategy: 'LATEST' })) } })
    const el = mount({ positionId: 'ps_1', embedded: true })
    await select(el)
    clickSave(el)
    await flush()
    expect(api.updateDataTable).not.toHaveBeenCalled()
    expect(api.saveDossierConfig).not.toHaveBeenCalled()
    expect(Array.from(el.querySelectorAll('.wd-err')).map((n) => n.textContent).join('|')).toContain('最多 8 条')
  })
})
