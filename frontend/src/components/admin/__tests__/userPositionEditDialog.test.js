// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * UserPositionEditDialog.vue（分配岗位弹窗）—— 2026-09-12 对齐
 * docs/PRD/数字员工管理端PRD/02岗位/岗位管理/prd.岗位管理.md §四.1 单个分配（修改绑定）/ §五 待分配申请处理（重新绑定）
 * （历史出处：提案 20260721-2 岗位分配）。
 *
 * 覆盖：
 *  - §四.1 弹窗规则（弹窗标题「分配岗位」，yuepu#60③ 已对齐 md）：顶部「为 显示名 选择绑定岗位，保存后即时生效」、首项「未绑定」、换绑提示；
 *  - §四.1「点击【保存】后更新绑定关系、关闭弹窗…提示岗位绑定已更新」：换绑 / 解绑 → setUserPosition(userId, 新岗位 | null) + 提示「岗位绑定已更新」+ 关窗（update:visible false）+ emit saved；
 *  - 无变化：默认直接关窗，不打接口、不提示；forceSave=true（§五 待分配申请处理「保存后系统自动标记该申请为已处理」）未变化仍保存并 emit saved；
 *  - 保存失败（§七「保存失败：弹窗保持打开并展示失败原因」）：显具体原因或「保存失败，请重试」，窗口保持打开。
 *
 * 2026-10-09 头注订正：弹窗标题「分配岗位」已随待办 yuepu#60③ 对齐 md；
 * 「选未绑定保存不标记申请为已分配」（待办 yuepu#57⑦）的页面编排归 adminPositionAssignments.test.js，本文件只管弹窗自身。
 */

const api = { setUserPosition: vi.fn() }
vi.mock('@/api/positionAssignment', () => api)

const msg = { success: vi.fn(), error: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg }))

const stubs = {
  'el-dialog': {
    props: ['modelValue', 'title'],
    template:
      '<div class="el-dialog" v-if="modelValue" :data-title="title"><slot /><div class="ft"><slot name="footer" /></div></div>'
  },
  'el-select': {
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
    template:
      '<div class="el-select" :data-placeholder="placeholder" :data-value="modelValue"><button class="__new" @click="$emit(\'update:modelValue\', \'ps_new\')" /><button class="__clear" @click="$emit(\'update:modelValue\', \'\')" /><slot /></div>'
  },
  'el-option': { props: ['value', 'label'], template: '<div class="el-option" :data-value="value">{{ label }}</div>' },
  'el-button': {
    props: ['loading'],
    emits: ['click'],
    template: '<button class="el-button" :data-loading="loading ? \'1\' : null" @click="$emit(\'click\')"><slot /></button>'
  }
}

const Dialog = (await import('@/components/admin/UserPositionEditDialog.vue')).default

let app, container, visibleSpy, savedSpy
async function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  visibleSpy = vi.fn()
  savedSpy = vi.fn()
  app = createApp({ render: () => h(Dialog, { 'onUpdate:visible': visibleSpy, onSaved: savedSpy, ...props }) })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  await nextTick()
  return container
}
function saveBtn() {
  return [...container.querySelectorAll('.ft .el-button')].find((b) => b.textContent.trim() === '保存')
}
async function flush() {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

const ROW = { userId: 'usr_x', username: 'x', displayName: 'X', positionId: 'ps_old', positionName: '旧岗位' }
const OPTS = [{ positionId: 'ps_new', name: '新岗位' }]

beforeEach(() => {
  vi.clearAllMocks()
  api.setUserPosition.mockResolvedValue({})
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('UserPositionEditDialog · 弹窗文案（md §四.1 单个分配·弹窗规则）', () => {
  it('标题「分配岗位」；顶部「为 X 选择绑定岗位，保存后即时生效」；默认选中当前岗位、首项「未绑定」；换绑提示照 md', async () => {
    await mount({ visible: true, row: ROW, positionOptions: OPTS })
    expect(container.querySelector('.el-dialog').dataset.title).toBe('分配岗位')
    expect(container.querySelector('.upe-target').textContent.replace(/\s+/g, '')).toBe('为X选择绑定岗位，保存后即时生效。')
    expect(container.querySelector('.upe-target b').textContent).toBe('X')
    expect(container.querySelector('.upe-label').textContent).toBe('绑定岗位')
    expect(container.querySelector('.el-select').dataset.value).toBe('ps_old')
    const opts = [...container.querySelectorAll('.el-option')]
    expect(opts[0].textContent).toBe('未绑定')
    // 当前绑定岗位（ps_old）不在可选列表（OPTS 只有 ps_new）里也要显示真实岗位名，不能显裸 id
    // （2026-09-18 待办 yuepu#13·岗位 P7：此前 Element Plus 找不到匹配 el-option 会回退显示 value 本身）
    expect(opts.map((o) => o.textContent)).toEqual(['未绑定', '新岗位', '旧岗位'])
    expect(container.querySelector('.upe-hint').textContent.trim()).toBe(
      '换绑会清除该用户在原岗位上的个性化（岗位人格 / 搭子名称）；会话、记忆、定时任务保留不变。'
    )
  })

  it('当前绑定岗位已在可选列表中 → 不重复追加（2026-09-18 待办 yuepu#13·岗位 P7）', async () => {
    await mount({ visible: true, row: ROW, positionOptions: [...OPTS, { positionId: 'ps_old', name: '旧岗位（仍在选项内）' }] })
    const opts = [...container.querySelectorAll('.el-option')]
    expect(opts.map((o) => o.textContent)).toEqual(['未绑定', '新岗位', '旧岗位（仍在选项内）'])
  })

  it('当前未绑定（positionId 为空）→ 不追加多余选项', async () => {
    await mount({ visible: true, row: { ...ROW, positionId: null, positionName: null }, positionOptions: OPTS })
    const opts = [...container.querySelectorAll('.el-option')]
    expect(opts.map((o) => o.textContent)).toEqual(['未绑定', '新岗位'])
  })

  it('显示名为空 → 顶部用用户名', async () => {
    await mount({ visible: true, row: { ...ROW, displayName: '' }, positionOptions: OPTS })
    expect(container.querySelector('.upe-target b').textContent).toBe('x')
  })
})

describe('UserPositionEditDialog · 保存（md §四.1「点击【保存】后更新绑定关系、关闭弹窗…提示岗位绑定已更新」/ §七「保存失败」）', () => {
  it('换绑：选新岗位保存 → setUserPosition(userId, 新岗位) + 提示「岗位绑定已更新」+ 关窗 + emit saved', async () => {
    await mount({ visible: true, row: ROW, positionOptions: OPTS })
    container.querySelector('.__new').click()
    await nextTick()
    saveBtn().click()
    await flush()
    expect(api.setUserPosition).toHaveBeenCalledWith('usr_x', 'ps_new')
    expect(msg.success).toHaveBeenCalledWith('岗位绑定已更新')
    expect(visibleSpy).toHaveBeenCalledWith(false)
    expect(savedSpy).toHaveBeenCalledTimes(1)
    expect(savedSpy).toHaveBeenCalledWith({ positionId: 'ps_new' }) // 页面据此决定是否标记待分配申请已分配（yuepu#57⑦）
  })

  it('解绑：选「未绑定」保存 → setUserPosition(userId, null) + 提示「岗位绑定已更新」+ 关窗 + emit saved', async () => {
    await mount({ visible: true, row: ROW, positionOptions: OPTS })
    container.querySelector('.__clear').click()
    await nextTick()
    saveBtn().click()
    await flush()
    expect(api.setUserPosition).toHaveBeenCalledWith('usr_x', null)
    expect(msg.success).toHaveBeenCalledWith('岗位绑定已更新')
    expect(visibleSpy).toHaveBeenCalledWith(false)
    expect(savedSpy).toHaveBeenCalledTimes(1)
    expect(savedSpy).toHaveBeenCalledWith({ positionId: null })
  })

  it('无变化（默认 forceSave=false）：直接关窗，不调 api、不提示、不 emit saved', async () => {
    await mount({ visible: true, row: ROW, positionOptions: OPTS })
    saveBtn().click()
    await flush()
    expect(api.setUserPosition).not.toHaveBeenCalled()
    expect(msg.success).not.toHaveBeenCalled()
    expect(visibleSpy).toHaveBeenCalledWith(false)
    expect(savedSpy).not.toHaveBeenCalled()
  })

  it('forceSave=true（§五 待分配申请处理·重新绑定）：未变化也照常保存当前岗位并 emit saved + 提示', async () => {
    await mount({ visible: true, row: ROW, positionOptions: OPTS, forceSave: true })
    saveBtn().click()
    await flush()
    expect(api.setUserPosition).toHaveBeenCalledWith('usr_x', 'ps_old')
    expect(msg.success).toHaveBeenCalledWith('岗位绑定已更新')
    expect(visibleSpy).toHaveBeenCalledWith(false)
    expect(savedSpy).toHaveBeenCalledTimes(1)
  })

  it('保存失败：有具体原因显原因、无原因显「保存失败，请重试」；窗口保持打开、不 emit saved', async () => {
    await mount({ visible: true, row: ROW, positionOptions: OPTS })
    container.querySelector('.__new').click()
    await nextTick()
    api.setUserPosition.mockRejectedValueOnce(new Error('岗位已下线'))
    saveBtn().click()
    await flush()
    expect(msg.error).toHaveBeenLastCalledWith('岗位已下线')
    api.setUserPosition.mockRejectedValueOnce({})
    saveBtn().click()
    await flush()
    expect(msg.error).toHaveBeenLastCalledWith('保存失败，请重试')
    expect(msg.success).not.toHaveBeenCalled()
    expect(visibleSpy).not.toHaveBeenCalled()
    expect(savedSpy).not.toHaveBeenCalled()
    expect(container.querySelector('.el-dialog')).toBeTruthy()
  })

  it('保存进行中：【保存】显进行中（loading）；完成后恢复', async () => {
    let finish
    api.setUserPosition.mockReturnValue(new Promise((r) => { finish = r }))
    await mount({ visible: true, row: ROW, positionOptions: OPTS })
    container.querySelector('.__new').click()
    await nextTick()
    saveBtn().click()
    await flush()
    expect(saveBtn().dataset.loading).toBe('1')
    finish({})
    await flush()
    expect(saveBtn().dataset.loading).toBeUndefined()
  })
})
