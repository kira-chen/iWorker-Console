// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * UserRoleDialog（设置角色窗）—— 2026-09-08 原型复刻批次 2A（G#8）行为契约：
 *  - 520px admin-dialog 壳；首段「为 <strong>显示名</strong>（用户名）设置角色。保存后将全量替换当前角色。」，显示名空时用用户名；
 *  - 角色为 RoleCheckCards 卡片复选，打开时按当前角色预勾；
 *  - 未选 → 内联「请至少选择一个角色」、窗口保持打开、不打接口；
 *  - 保存 → setUserRoles(id, codes)，toast「角色已更新」，emit saved。
 */
const setUserRoles = vi.fn(() => Promise.resolve({}))
vi.mock('@/api/adminUser', () => ({ setUserRoles: (...a) => setUserRoles(...a) }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
}))
const { ElMessage } = await import('element-plus')
const UserRoleDialog = (await import('@/components/admin/UserRoleDialog.vue')).default

const stubs = {
  'el-dialog': {
    props: ['modelValue', 'title', 'width'],
    template: '<div class="el-dialog" :data-width="width" :data-open="modelValue"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>'
  },
  'el-button': { props: ['loading'], emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' }
}
const ROLES = [
  { code: 'admin', name: '系统管理员' },
  { code: 'user', name: '普通用户' }
]

let app, container, setVisible, savedSpy, visibleRef
function mount(user) {
  container = document.createElement('div')
  document.body.appendChild(container)
  savedSpy = vi.fn()
  app = createApp({
    setup() {
      visibleRef = ref(false)
      setVisible = (v) => (visibleRef.value = v)
      return () =>
        h(UserRoleDialog, {
          visible: visibleRef.value,
          user,
          roleOptions: ROLES,
          onSaved: savedSpy,
          'onUpdate:visible': (v) => (visibleRef.value = v)
        })
    }
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  return container
}
async function open() {
  setVisible(true)
  for (let i = 0; i < 3; i++) await nextTick()
}
const saveBtn = () => [...container.querySelectorAll('.dlg-footer button')].find((b) => b.textContent.trim() === '保存')
const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('UserRoleDialog', () => {
  it('520px 壳；首段显示名加粗 +（用户名）；按当前角色预勾卡片', async () => {
    const el = mount({ id: 3, username: 'wangwu', displayName: '王五', roleCodes: ['user'] })
    await open()
    expect(el.querySelector('.el-dialog').dataset.width).toBe('520px')
    const p = el.querySelector('.urd-target')
    expect(p.querySelector('strong').textContent).toBe('王五')
    expect(p.textContent.replace(/\s+/g, '')).toBe('为王五（wangwu）设置角色。保存后将全量替换当前角色。')
    const boxes = [...el.querySelectorAll('.check-card input')]
    expect(boxes.map((b) => b.checked)).toEqual([false, true])
  })

  it('显示名为空 → 首段用用户名', async () => {
    const el = mount({ id: 3, username: 'wangwu', displayName: '', roleCodes: [] })
    await open()
    expect(el.querySelector('.urd-target strong').textContent).toBe('wangwu')
  })

  it('未选任何角色点【保存】→ 内联错误、窗口保持打开、不打接口；勾选后错误消失并可保存', async () => {
    const el = mount({ id: 3, username: 'wangwu', displayName: '王五', roleCodes: [] })
    await open()
    saveBtn().click()
    await flush()
    expect(el.querySelector('.error-text').textContent).toBe('请至少选择一个角色')
    expect(setUserRoles).not.toHaveBeenCalled()
    expect(visibleRef.value).toBe(true)
    const box = el.querySelectorAll('.check-card input')[0]
    box.checked = true
    box.dispatchEvent(new Event('change'))
    await nextTick()
    expect(el.querySelector('.error-text')).toBeNull()
    saveBtn().click()
    await flush()
    expect(setUserRoles).toHaveBeenCalledWith(3, ['admin'])
    expect(ElMessage.success).toHaveBeenCalledWith('角色已更新')
    expect(savedSpy).toHaveBeenCalled()
    expect(visibleRef.value).toBe(false)
  })
})
