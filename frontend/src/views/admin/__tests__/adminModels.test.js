// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * AdminModels.vue 单测。
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/模型/prd-模型.md
 *   §二.3.1 三态按钮组合 / §二.3.3 审核中编辑置灰 / §二.3.4 验证列 / §二.3.5 发布 / §二.3.6 撤回 /
 *   §二.3.7 停用 / §二.3.8 设为默认 / §二.3.9 删除 / §二.4 状态规则。
 *
 * 覆盖：三态展示（未发布 / 审核中 / 已发布，待审停用按 pendingAction 优先判「审核中」）与操作区按状态显隐——
 * 「发布↔删除」并存于未发布态、「停用↔设为默认」并存于已发布态、审核中只留「撤回」且编辑置灰；
 * 六个动作的确认文案 / 成功 toast / 重拉；验证列就地验证与完成 toast。
 *
 * 切断 api/adminModel 与 element-plus；EP 组件用轻量存根（el-table 存根按行渲染 default 插槽）。
 * 真实挂载冒烟另见 adminModelsSmoke.test.js。
 * 2026-09-08 原型复刻批次 1 对齐：模型页改为 paged:'client' 本地切片分页、每页条数按窗口高度动态
 * （jsdom 默认 768 高 → 7 条 < 10 行种子），故把 innerHeight 拉高让全部种子行落在第 1 页。
 */

const api = {
  listModels: vi.fn(),
  deleteModel: vi.fn(),
  verifyModel: vi.fn(),
  publishModel: vi.fn(),
  delistModel: vi.fn(),
  withdrawModel: vi.fn(),
  setDefaultModel: vi.fn()
}
vi.mock('@/api/adminModel', () => api)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
const msgBox = { confirm: vi.fn(), prompt: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))

vi.mock('@/components/admin/ModelConfigEditDialog.vue', () => ({
  default: {
    name: 'ModelConfigEditDialog',
    props: ['visible', 'model', 'readonly'],
    template:
      '<div class="stub-edit-dialog" :data-visible="visible" :data-id="model?.id" :data-readonly="readonly ? 1 : 0" />'
  }
}))
vi.mock('@/components/admin/ModelCapabilityTags.vue', () => ({
  default: { name: 'ModelCapabilityTags', props: ['source'], template: '<span class="stub-caps" />' }
}))

/**
 * el-table / el-table-column 存根：真实页面的列模板是作用域插槽 #default="{ row }"，
 * 存根需把当前行透出去。做法——el-table 每行 provide 当前 row，el-table-column inject 后
 * 以 { row } 调用自己的 default 插槽，从而在 jsdom 下渲染出真实的单元格与操作按钮。
 */

const stubs = {
  PageHeader: { template: '<div class="page-header"><slot name="badge" /></div>' },
  StatusTag: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-empty': { template: '<div class="el-empty"><slot /></div>' },
  'el-card': { template: '<div class="el-card"><slot /></div>' },
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-select': { props: ['modelValue'], template: '<select><slot /></select>' },
  'el-option': { template: '<option />' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-tooltip': { props: ['content'], template: '<span class="el-tooltip" :data-tip="content"><slot /></span>' },
  'el-button': {
    props: ['disabled', 'loading', 'type', 'link'],
    emits: ['click'],
    template:
      '<button class="el-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  }
}
const vLoading = { mounted() {}, updated() {} }

const AdminModels = (await import('@/views/admin/AdminModels.vue')).default

let app, container
async function mount() {
  // 动态每页条数：拉高视口让 10 行种子全在第 1 页（(2000-330)/62=26 条）
  Object.defineProperty(window, 'innerHeight', { value: 2000, configurable: true, writable: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(AdminModels) })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  // 每行一个 provide 容器，把 row 传给其下所有 el-table-column
  const RowScope = {
    props: ['row'],
    provide() {
      return { tableRow: () => this.row }
    },
    template: '<div class="t-row"><slot /></div>'
  }
  app.component('RowScope', RowScope)
  app.component('el-table', {
    components: { RowScope },
    props: ['data'],
    template: `
      <div class="el-table">
        <RowScope v-for="(row, i) in (data || [])" :key="i" :row="row">
          <slot :row="row" />
        </RowScope>
      </div>`
  })
  app.component('el-table-column', {
    props: ['label'],
    inject: { tableRow: { default: null } },
    computed: {
      row() {
        return this.tableRow ? this.tableRow() : null
      }
    },
    template:
      '<div class="t-cell" :data-label="label"><slot v-if="row" :row="row" /></div>'
  })
  app.component('Search', { template: '<span/>' })
  app.component('Plus', { template: '<span/>' })
  app.component('QuestionFilled', { template: '<span/>' })
  app.directive('loading', vLoading)
  app.mount(container)
  await nextTick()
  await Promise.resolve()
  await nextTick()
  return container
}

function rowEls() {
  return [...container.querySelectorAll('.t-row')]
}
function btn(rowEl, text) {
  return [...rowEl.querySelectorAll('.el-button')].find((b) => b.textContent.trim().startsWith(text))
}
/** 按模型名取行——不依赖 fixture 顺序，后续新增 fixture 不会让既有用例连坐失败。 */
function rowByName(name) {
  return rowEls().find((el) => el.textContent.includes(name))
}
function texts(rowEl) {
  return [...rowEl.querySelectorAll('.el-button')].map((b) => b.textContent.trim())
}

// fixture 字段形状照 adminModelMock.mkModel（2026-09-12 T10：删幽灵字段 publishedVersion / reviewComment）
const LIST = [
  // 从未发布、未验证：不能发布（验证未过），可删
  {
    id: 'md_new_unver',
    name: '新建未验证',
    category: 'TEXT',
    status: 'DRAFT',
    verifyStatus: 'UNVERIFIED'
  },
  // 从未发布、已验证：可发布、可删
  {
    id: 'md_new_ok',
    name: '新建已验证',
    category: 'TEXT',
    status: 'DRAFT',
    verifyStatus: 'SUCCESS'
  },
  // 首次发布在审：编辑锁定，仅可撤回（页面按 pendingAction 判审核中，2026-09-12 T18 补齐）
  {
    id: 'md_pending',
    name: '首发在审',
    category: 'TEXT',
    status: 'PENDING_REVIEW',
    pendingAction: 'PUBLISH',
    verifyStatus: 'SUCCESS'
  },
  // 已启用（非默认）：可版本更新 / 停用 / 设为默认，不可删
  {
    id: 'md_online',
    name: '在线模型甲',
    defaultTemperature: 0.7,
    category: 'TEXT',
    status: 'PUBLISHED',
    verifyStatus: 'SUCCESS',
    verifyLatencyMs: 820,
    verifiedAt: '2026-08-20T14:32:00+08:00',
    contextWindow: 65536,
    isDefault: false
  },
  // 已启用 + 新版在审：编辑锁定、显撤回；停用与设为默认仍在（线上仍在服务）
  {
    id: 'md_online_rev',
    name: '在线模型乙新版在审',
    category: 'TEXT',
    status: 'PUBLISHED',
    verifyStatus: 'SUCCESS',
    isDefault: false
  },
  // 已启用 + 默认：不显「设为默认」
  {
    id: 'md_default',
    name: '在线模型丙默认',
    category: 'IMAGE_GEN',
    status: 'PUBLISHED',
    verifyStatus: 'SUCCESS',
    isDefault: true
  },
  // 待审停用：status 仍 PUBLISHED（客户端仍可用），pendingAction=DELIST
  {
    id: 'md_pending_delist',
    name: '待审停用',
    category: 'TEXT',
    status: 'PUBLISHED',
    pendingAction: 'DELIST',
    verifyStatus: 'SUCCESS',
    verifiedAt: '2026-08-20T10:00:00+08:00',
    isDefault: false
  },
  // 已停用（历史遗留态 DELISTED，页面归一为未发布）：显发布、可删
  {
    id: 'md_offline',
    name: '已停用',
    category: 'TEXT',
    status: 'DELISTED',
    verifyStatus: 'SUCCESS'
  },
  // 已启用但连通性验证失败：线上仍在服务（跑快照），但模型实际可能已连不上
  {
    id: 'md_online_unhealthy',
    name: '在线模型丁连不上',
    category: 'TEXT',
    status: 'PUBLISHED',
    verifyStatus: 'FAILED',
    verifyError: 'TIMEOUT: connect timeout',
    isDefault: false
  },
  // 被驳回（历史遗留态 REJECTED，页面归一为未发布；md §二.4「不单独展示已驳回」）
  {
    id: 'md_rejected',
    name: '被驳回',
    category: 'TEXT',
    status: 'REJECTED',
    verifyStatus: 'SUCCESS'
  }
]

async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listModels.mockResolvedValue(LIST)
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminModels · 三态 + 发布/停用双向过审（md §二.3.1 三态按钮 + §二.3.4 验证列）', () => {
  it('渲染全部行，状态列显示三态文案（md §二.4「仅展示未发布、审核中、已发布」）', async () => {
    await mount()
    expect(rowEls()).toHaveLength(LIST.length)
    const all = container.textContent
    expect(all).toContain('未发布')
    expect(all).toContain('已发布')
    // 发布/停用两条都要过审，故三态齐全
    expect(all).toContain('审核中')
    // 历史遗留态不裸露枚举，也不单独展示「已驳回 / 已下架」
    expect(all).not.toContain('REJECTED')
    expect(all).not.toContain('DELISTED')
    expect(rowByName('被驳回').querySelector('.status-tag').textContent).toBe('未发布')
  })

  // 2026-09-12 T18/T55：审核中行此前 fixture 无 pendingAction，从未真正触发过这条分支
  it('发布审核中行 → 【查看】【编辑】（禁用，tooltip「审核中不可编辑，如需修改请先撤回提交」）【撤回】共 3 个（md §二.3.1 / §二.3.3）', async () => {
    await mount()
    const r = rowByName('首发在审')
    expect(r.querySelector('.status-tag').textContent).toBe('审核中')
    expect(texts(r)).toEqual(['查看', '编辑', '撤回'])
    const edit = btn(r, '编辑')
    expect(edit.disabled).toBe(true)
    expect(edit.closest('.el-tooltip').dataset.tip).toBe('审核中不可编辑，如需修改请先撤回提交')
  })

  it('待审停用行：status 仍是 PUBLISHED，但展示为「审核中」并显「撤回」', async () => {
    // 停用审核期间模型对客户端仍可用（status 不变），管理端应显示「审核中」——
    // 故状态展示以 pendingAction 优先判定，不能只看 status。
    await mount()
    const r = rowByName('待审停用')
    expect(r.textContent).toContain('审核中')
    expect(btn(r, '撤回')).toBeTruthy()
    expect(texts(r)).not.toContain('停用')
    expect(texts(r)).not.toContain('删除')
  })

  it('未发布态：「发布」与「删除」并存；不显「停用」「设为默认」', async () => {
    await mount()
    const r = rowByName('新建已验证')
    expect(btn(r, '发布')).toBeTruthy()
    expect(btn(r, '删除')).toBeTruthy()
    expect(texts(r)).not.toContain('停用')
    expect(texts(r)).not.toContain('设为默认')
  })

  it('已发布态：「停用」与「设为默认」并存；不显「删除」「发布」', async () => {
    await mount()
    const r = rowByName('在线模型甲')
    expect(btn(r, '停用')).toBeTruthy()
    expect(btn(r, '设为默认')).toBeTruthy()
    expect(texts(r)).not.toContain('删除')
    expect(texts(r)).not.toContain('发布')
  })

  it('已发布且已是默认：不显「设为默认」，仍显「停用」', async () => {
    await mount()
    const r = rowByName('在线模型丙默认')
    expect(texts(r)).not.toContain('设为默认')
    expect(btn(r, '停用')).toBeTruthy()
  })

  it('未验证：「发布」禁用（验证通过才可提交发布）', async () => {
    await mount()
    expect(btn(rowByName('新建未验证'), '发布').disabled).toBe(true)
  })

  it('点「发布」→ 确认窗「发布模型」【提交审核】→ publishModel →「已提交发布审核」+ 重拉（md §二.3.5）', async () => {
    msgBox.confirm.mockResolvedValue(true)
    api.publishModel.mockResolvedValue({})
    await mount()
    btn(rowByName('新建已验证'), '发布').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      expect.stringContaining('提交后进入审核，审核通过后模型「新建已验证」才会对客户端开放调用'),
      '发布模型',
      expect.objectContaining({ confirmButtonText: '提交审核' })
    )
    expect(api.publishModel).toHaveBeenCalledWith('md_new_ok')
    expect(msg.success).toHaveBeenCalledWith('已提交发布审核')
    expect(api.listModels).toHaveBeenCalledTimes(2)
  })

  it('点「发布」：弹窗取消则不提交', async () => {
    msgBox.confirm.mockRejectedValue(new Error('cancel'))
    await mount()
    btn(rowByName('新建已验证'), '发布').click()
    await nextTick(); await Promise.resolve()
    expect(api.publishModel).not.toHaveBeenCalled()
  })

  it('点「停用」→ 确认窗「停用模型」【提交审核】说明审核通过前仍可用 → delistModel →「已提交停用审核」（md §二.3.7）', async () => {
    msgBox.confirm.mockResolvedValue(true)
    api.delistModel.mockResolvedValue({})
    await mount()
    btn(rowByName('在线模型甲'), '停用').click()
    await flush()
    const [text, title, opts] = msgBox.confirm.mock.calls[0]
    expect(text).toContain('审核通过前该模型对客户端仍然可用')
    expect(text).toContain('模型「在线模型甲」')
    expect(text).not.toContain('**') // aa7d251 防回归：纯文本弹窗里带 ** 只会原样显示星号
    expect(text).not.toContain('默认模型') // 非默认模型不带默认标记说明
    expect(title).toBe('停用模型')
    expect(opts).toEqual(expect.objectContaining({ confirmButtonText: '提交审核' }))
    expect(api.delistModel).toHaveBeenCalledWith('md_online')
    expect(msg.success).toHaveBeenCalledWith('已提交停用审核')
  })

  it('停用默认模型：确认文案额外说明「停用生效后将同时取消其默认标记」（md §二.3.7 L153）', async () => {
    msgBox.confirm.mockResolvedValue(true)
    api.delistModel.mockResolvedValue({})
    await mount()
    btn(rowByName('在线模型丙默认'), '停用').click()
    await flush()
    const [text] = msgBox.confirm.mock.calls[0]
    expect(text).toContain('停用生效后将同时取消其默认标记')
    expect(text).not.toContain('**')
    expect(api.delistModel).toHaveBeenCalledWith('md_default')
  })

  /* ===== 2026-09-12 T55：撤回 / 设为默认 / 删除 页面级用例（此前零覆盖） ===== */

  it('待审停用行点「撤回」→ 确认窗说明「保持已发布、继续对客户端提供服务」→ withdrawModel →「已撤回」+ 重拉（md §二.3.6）', async () => {
    msgBox.confirm.mockResolvedValue(true)
    api.withdrawModel.mockResolvedValue({})
    await mount()
    btn(rowByName('待审停用'), '撤回').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '撤回后模型「待审停用」保持已发布、继续对客户端提供服务。确认撤回？',
      '撤回',
      expect.objectContaining({ confirmButtonText: '撤回' })
    )
    expect(api.withdrawModel).toHaveBeenCalledWith('md_pending_delist')
    expect(msg.success).toHaveBeenCalledWith('已撤回')
    expect(api.listModels).toHaveBeenCalledTimes(2)
  })

  it('待审发布行点「撤回」→ 确认窗说明「回到未发布状态，可修改后重新提交」；取消则不打接口（md §二.3.6）', async () => {
    msgBox.confirm.mockRejectedValue('cancel')
    await mount()
    btn(rowByName('首发在审'), '撤回').click()
    await flush()
    expect(msgBox.confirm.mock.calls[0][0]).toBe('撤回后模型「首发在审」回到未发布状态，可修改后重新提交。确认撤回？')
    expect(api.withdrawModel).not.toHaveBeenCalled()
  })

  it('点「设为默认」→ 确认窗「设为默认模型」说明同类别原默认自动取消 → setDefaultModel →「已设为默认模型」（md §二.3.8）', async () => {
    msgBox.confirm.mockResolvedValue(true)
    api.setDefaultModel.mockResolvedValue({})
    await mount()
    btn(rowByName('在线模型甲'), '设为默认').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '设为默认后，「文本生成」类别将以「在线模型甲」为默认模型（该类别原默认模型自动取消，不影响其它类别）。确认设置？',
      '设为默认模型',
      expect.objectContaining({ confirmButtonText: '设为默认' })
    )
    expect(api.setDefaultModel).toHaveBeenCalledWith('md_online')
    expect(msg.success).toHaveBeenCalledWith('已设为默认模型')
    expect(api.listModels).toHaveBeenCalledTimes(2)
  })

  it('点「删除」→ 确认窗提示「配置与密钥将不可恢复」【删除】危险样式 → deleteModel →「已删除」+ 重拉（md §二.3.9）', async () => {
    msgBox.confirm.mockResolvedValue(true)
    api.deleteModel.mockResolvedValue({})
    await mount()
    btn(rowByName('新建已验证'), '删除').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '删除后模型「新建已验证」的配置与密钥将不可恢复。确认删除？',
      '删除模型',
      expect.objectContaining({ confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' })
    )
    expect(api.deleteModel).toHaveBeenCalledWith('md_new_ok')
    expect(msg.success).toHaveBeenCalledWith('已删除')
    expect(api.listModels).toHaveBeenCalledTimes(2)
  })

  it('点「删除」取消 → 不执行删除（md §二.3.9「用户取消确认时不执行删除」）', async () => {
    msgBox.confirm.mockRejectedValue('cancel')
    await mount()
    btn(rowByName('新建已验证'), '删除').click()
    await flush()
    expect(api.deleteModel).not.toHaveBeenCalled()
    expect(api.listModels).toHaveBeenCalledTimes(1)
  })

  it('动作失败 → toast 错误原因，不重拉（md §二.5「单项操作失败保留原状态」口径）', async () => {
    msgBox.confirm.mockResolvedValue(true)
    api.setDefaultModel.mockRejectedValue(new Error('仅已发布模型可设为默认'))
    await mount()
    btn(rowByName('在线模型甲'), '设为默认').click()
    await flush()
    expect(msg.error).toHaveBeenCalledWith('仅已发布模型可设为默认')
    expect(msg.success).not.toHaveBeenCalled()
    expect(api.listModels).toHaveBeenCalledTimes(1)
  })

  it('已停用行：显「发布」可再次提交', async () => {
    await mount()
    const r = rowByName('已停用')
    expect(btn(r, '发布')).toBeTruthy()
    expect(btn(r, '删除')).toBeTruthy()
  })

  it('点「查看」：以只读态打开编辑弹窗', async () => {
    await mount()
    btn(rowByName('在线模型甲'), '查看').click()
    await nextTick()
    const dlg = container.querySelector('.stub-edit-dialog')
    expect(dlg.getAttribute('data-readonly')).toBe('1')
    expect(dlg.getAttribute('data-id')).toBe('md_online')
  })

  it('非审核中行 → 「编辑」可点（md §二.3.3「未发布和已发布模型可以编辑」）', async () => {
    await mount()
    for (const name of ['新建已验证', '在线模型甲', '已停用']) {
      expect(btn(rowByName(name), '编辑').disabled).toBeFalsy()
    }
    btn(rowByName('在线模型甲'), '编辑').click()
    await nextTick()
    const dlg = container.querySelector('.stub-edit-dialog')
    expect(dlg.getAttribute('data-visible')).toBe('true')
    expect(dlg.getAttribute('data-readonly')).toBe('0')
    expect(dlg.getAttribute('data-id')).toBe('md_online')
  })

  it('验证列：点刷新图标即发起验证（全部就地，无弹窗/抽屉）', async () => {
    api.verifyModel.mockReturnValue(new Promise(() => {}))   // 挂住，停在验证中态
    await mount()
    rowByName('新建未验证').querySelector('.md-vc-refresh').click()
    await nextTick()
    expect(api.verifyModel).toHaveBeenCalledWith('md_new_unver', expect.any(Object))
  })

  it('验证列 · 验证中：图标转圈表达进行中，并显阶段文案', async () => {
    api.verifyModel.mockReturnValue(new Promise(() => {}))
    await mount()
    const r = rowByName('新建未验证')
    r.querySelector('.md-vc-refresh').click()
    await nextTick()
    expect(r.querySelector('.md-vc-refresh').className).toContain('is-spinning')
    expect(r.textContent).toContain('正在连接模型')
  })

  it('验证列 · 验证中再次点击图标：不重复发起', async () => {
    api.verifyModel.mockReturnValue(new Promise(() => {}))
    await mount()
    const icon = rowByName('新建未验证').querySelector('.md-vc-refresh')
    icon.click()
    await nextTick()
    icon.click()
    await nextTick()
    expect(api.verifyModel).toHaveBeenCalledTimes(1)
  })

  it('验证列 · 已验证行：就地显示结果与最近测试时间，并可点图标重验', async () => {
    api.verifyModel.mockReturnValue(new Promise(() => {}))
    await mount()
    const r = rowByName('在线模型甲')
    expect(r.textContent).toContain('正常')
    expect(r.querySelector('.md-vc-time')).toBeTruthy()   // 最近测试时间就地可见
    r.querySelector('.md-vc-refresh').click()
    await nextTick()
    expect(api.verifyModel).toHaveBeenCalledWith('md_online', expect.any(Object))
  })

  // 2026-09-12 T55 · md §二.3.4 L115「连接正常时提示"检活完成 · 连接正常"；连接异常时提示"检活完成 · 连接异常"」
  // + L114「验证完成后，当前行的状态和最近验证时间立即更新」（实现为重拉列表）
  it('验证完成 · 连接正常 → toast「检活完成 · 连接正常」+ 重拉列表，图标停转（md §二.3.4）', async () => {
    api.verifyModel.mockResolvedValue({ verifyStatus: 'SUCCESS', verifyLatencyMs: 90 })
    await mount()
    const r = rowByName('新建未验证')
    r.querySelector('.md-vc-refresh').click()
    await flush(6)
    expect(api.verifyModel).toHaveBeenCalledWith('md_new_unver', expect.any(Object))
    expect(msg.success).toHaveBeenCalledWith('检活完成 · 连接正常')
    expect(api.listModels).toHaveBeenCalledTimes(2)
    expect(rowByName('新建未验证').querySelector('.md-vc-refresh').className).not.toContain('is-spinning')
  })

  it('验证完成 · 连接异常 → toast「检活完成 · 连接异常」+ 重拉列表（md §二.3.4）', async () => {
    api.verifyModel.mockResolvedValue({ verifyStatus: 'FAILED', verifyError: 'AUTH_FAILED: 鉴权失败' })
    await mount()
    rowByName('新建未验证').querySelector('.md-vc-refresh').click()
    await flush(6)
    expect(msg.warning).toHaveBeenCalledWith('检活完成 · 连接异常')
    expect(msg.success).not.toHaveBeenCalled()
    expect(api.listModels).toHaveBeenCalledTimes(2)
  })

  it('验证请求层失败且无原因 → toast「检活失败，请稍后重试」，不重拉、验证态不改（md §二.3.4 L116 / §二.5）', async () => {
    api.verifyModel.mockRejectedValue({})
    await mount()
    rowByName('新建未验证').querySelector('.md-vc-refresh').click()
    await flush(6)
    expect(msg.error).toHaveBeenCalledWith('检活失败，请稍后重试')
    expect(api.listModels).toHaveBeenCalledTimes(1)
  })

  it('验证列：失败只显「异常」，错误分类名与错误码移入悬浮提示', async () => {
    // 列表不是排障的地方——原因与错误码收进 tips，列上只留结果与时间
    await mount()
    const r = rowByName('在线模型丁连不上')
    expect(r.textContent).toContain('异常')
    expect(r.textContent).not.toContain('响应超时')
    expect(r.textContent).not.toContain('TIMEOUT')
  })

  it('页头不再有「N 个已发布模型连通异常」角标；异常信息仍在行内可见', async () => {
    // 2026-08-22 负责人口径：顶部提示与每行「验证」列重复，去掉顶部、保留行内。
    await mount()
    expect(container.querySelector('.ph-reddot')).toBeNull()
    expect(container.textContent).not.toContain('个已发布模型连通异常')
    expect(rowByName('在线模型丁连不上').textContent).toContain('异常')
  })

  it('温度列：有值显数值，无值显占位', async () => {
    await mount()
    expect(rowByName('在线模型甲').textContent).toContain('0.7')
    expect(rowByName('新建未验证').textContent).toContain('—')
  })

  it('加载失败：显示重试', async () => {
    api.listModels.mockRejectedValue(new Error('boom'))
    await mount()
    expect(container.querySelector('.el-empty')).toBeTruthy()
  })
})
