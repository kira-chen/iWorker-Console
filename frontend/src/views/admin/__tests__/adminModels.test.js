// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * AdminModels.vue 单测（V76 建；V95 改发布制 + 表格形态后重写）。
 *
 * 覆盖：三态状态列（未启用/审核中/已启用 + 版本号 + 新版在审）与操作区按状态显隐——
 * 「启用↔删除」并存于未启用态、「停用↔设为默认」并存于已启用态、「版本更新」仅已启用出现、
 * 审核期编辑锁定且只留「撤回提交」。
 *
 * 切断 api/adminModel 与 element-plus；EP 组件用轻量存根（el-table 存根按行渲染 default 插槽）。
 */

const api = {
  listModels: vi.fn(),
  deleteModel: vi.fn(),
  verifyModel: vi.fn(),
  publishModel: vi.fn(),
  delistModel: vi.fn(),
  setDefaultModel: vi.fn()
}
vi.mock('@/api/adminModel', () => api)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
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

const LIST = [
  // 从未发布、未验证：不能启用（验证未过），可删
  {
    id: 'md_new_unver',
    name: '新建未验证',
    category: 'TEXT',
    status: 'DRAFT',
    verifyStatus: 'UNVERIFIED',
    publishedVersion: null
  },
  // 从未发布、已验证：可启用、可删
  {
    id: 'md_new_ok',
    name: '新建已验证',
    category: 'TEXT',
    status: 'DRAFT',
    verifyStatus: 'SUCCESS',
    publishedVersion: null
  },
  // 首次发布在审：编辑锁定，仅可撤回
  {
    id: 'md_pending',
    name: '首发在审',
    category: 'TEXT',
    status: 'PENDING_REVIEW',
    verifyStatus: 'SUCCESS',
    publishedVersion: null
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
  // 已停用（发布过）：显启用（走 relist）、可删
  {
    id: 'md_offline',
    name: '已停用',
    category: 'TEXT',
    status: 'DELISTED',
    verifyStatus: 'SUCCESS',
    publishedVersion: 2
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
  // 被驳回：未启用 + 驳回原因
  {
    id: 'md_rejected',
    name: '被驳回',
    category: 'TEXT',
    status: 'REJECTED',
    verifyStatus: 'SUCCESS',
    reviewComment: '地址不在白名单'
  }
]

beforeEach(() => {
  vi.clearAllMocks()
  api.listModels.mockResolvedValue(LIST)
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminModels · 上架/下架（V96：模型不走审核流程）', () => {
  it('渲染全部行，状态列显示三态文案', async () => {
    await mount()
    expect(rowEls()).toHaveLength(LIST.length)
    const all = container.textContent
    expect(all).toContain('未发布')
    expect(all).toContain('已发布')
    // V98：发布/停用两条都要过审，故三态齐全
    expect(all).toContain('审核中')
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

  it('点「发布」：确认后调 publishModel 提交审核并刷新', async () => {
    msgBox.confirm.mockResolvedValue(true)
    api.publishModel.mockResolvedValue({})
    await mount()
    btn(rowByName('新建已验证'), '发布').click()
    await nextTick(); await Promise.resolve(); await nextTick()
    expect(api.publishModel).toHaveBeenCalledWith('md_new_ok')
  })

  it('点「发布」：弹窗取消则不提交', async () => {
    msgBox.confirm.mockRejectedValue(new Error('cancel'))
    await mount()
    btn(rowByName('新建已验证'), '发布').click()
    await nextTick(); await Promise.resolve()
    expect(api.publishModel).not.toHaveBeenCalled()
  })

  it('点「停用」：确认后调 delistModel 提交审核', async () => {
    msgBox.confirm.mockResolvedValue(true)
    api.delistModel.mockResolvedValue({})
    await mount()
    btn(rowByName('在线模型甲'), '停用').click()
    await nextTick(); await Promise.resolve(); await nextTick()
    expect(api.delistModel).toHaveBeenCalledWith('md_online')
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

  it('「编辑」任何状态下都可点（无审核锁定态）', async () => {
    await mount()
    for (const name of ['新建已验证', '在线模型甲', '已停用']) {
      expect(btn(rowByName(name), '编辑').disabled).toBeFalsy()
    }
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
