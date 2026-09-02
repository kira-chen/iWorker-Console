// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * UserPositionEditDialog.vue 单测（岗位分配，提案 20260721-2）：
 * 换绑（选新岗位）/ 解绑（未绑定，传 null）/ 无变化不调 api。
 */

const api = { setUserPosition: vi.fn() }
vi.mock('@/api/positionAssignment', () => api)

const msg = { success: vi.fn(), error: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg }))

const stubs = {
  'el-dialog': {
    props: ['modelValue'],
    template:
      '<div class="el-dialog" v-if="modelValue"><slot /><div class="ft"><slot name="footer" /></div></div>'
  },
  'el-select': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<div class="el-select"><button class="__new" @click="$emit(\'update:modelValue\', \'ps_new\')" /><button class="__clear" @click="$emit(\'update:modelValue\', \'\')" /><slot /></div>'
  },
  'el-option': { props: ['value', 'label'], template: '<div />' },
  'el-button': {
    props: ['loading'],
    emits: ['click'],
    template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>'
  }
}

const Dialog = (await import('@/components/admin/UserPositionEditDialog.vue')).default

let app, container
async function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(Dialog, props) })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  await nextTick()
  return container
}
function saveBtn() {
  return [...container.querySelectorAll('.ft .el-button')].find((b) => b.textContent.trim() === '保存')
}
async function flush() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
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

describe('UserPositionEditDialog', () => {
  it('换绑：选新岗位保存 → setUserPosition(userId, 新岗位)', async () => {
    await mount({ visible: true, row: ROW, positionOptions: OPTS })
    container.querySelector('.__new').click()
    await nextTick()
    saveBtn().click()
    await flush()
    expect(api.setUserPosition).toHaveBeenCalledWith('usr_x', 'ps_new')
    expect(msg.success).toHaveBeenCalled()
  })

  it('解绑：选未绑定保存 → setUserPosition(userId, null)', async () => {
    await mount({ visible: true, row: ROW, positionOptions: OPTS })
    container.querySelector('.__clear').click()
    await nextTick()
    saveBtn().click()
    await flush()
    expect(api.setUserPosition).toHaveBeenCalledWith('usr_x', null)
  })

  it('无变化：直接保存不调 api', async () => {
    await mount({ visible: true, row: ROW, positionOptions: OPTS })
    saveBtn().click()
    await flush()
    expect(api.setUserPosition).not.toHaveBeenCalled()
  })
})
