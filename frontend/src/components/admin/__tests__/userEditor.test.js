// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * UserEditor（用户新建 / 编辑窗）—— 2026-09-08 原型复刻批次 2A（G#5/#6/#7）行为契约：
 *  - 居中窗 520px + admin-dialog 壳；
 *  - 新建态：初始角色为 RoleCheckCards 卡片复选，默认勾中「普通用户」；确认键「新建」；
 *    未选角色 → 内联「请至少选择一个角色」不提交；成功 toast「用户已新建」；
 *  - 编辑态：状态下拉与最近登录时间只读框并排（.ue-half ×2），末行 .page-time「创建时间 / 最近更新时间」；
 *    确认键「保存」；成功 toast「用户信息已保存」，只送 displayName/email/status。
 */
const createUser = vi.fn(() => Promise.resolve({}))
const updateUser = vi.fn(() => Promise.resolve({}))
vi.mock('@/api/adminUser', () => ({
  createUser: (...a) => createUser(...a),
  updateUser: (...a) => updateUser(...a)
}))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
}))
const { ElMessage } = await import('element-plus')
const UserEditor = (await import('@/components/admin/UserEditor.vue')).default

const stubs = {
  'el-dialog': {
    props: ['modelValue', 'title', 'width'],
    template:
      '<div class="el-dialog" :data-width="width" :data-title="title"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>'
  },
  'el-form': {
    template: '<form><slot /></form>',
    methods: {
      validate(cb) {
        return cb ? cb(true) : Promise.resolve(true)
      },
      clearValidate() {}
    }
  },
  'el-form-item': { props: ['label'], template: '<div class="el-form-item"><label>{{ label }}</label><slot /></div>' },
  'el-input': {
    props: ['modelValue', 'disabled', 'placeholder'],
    emits: ['update:modelValue'],
    template: '<input :disabled="disabled" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-select': { props: ['modelValue'], template: '<select class="el-select"><slot /></select>' },
  'el-option': { props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' },
  'el-button': { props: ['loading'], emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' }
}
const ROLES = [
  { code: '系统管理员', name: '系统管理员' },
  { code: '普通用户', name: '普通用户' }
]

let app, container, setVisible, savedSpy
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  savedSpy = vi.fn()
  const Wrapper = {
    setup() {
      const visible = ref(false)
      setVisible = (v) => (visible.value = v)
      return () =>
        h(UserEditor, {
          visible: visible.value,
          roleOptions: ROLES,
          onSaved: savedSpy,
          'onUpdate:visible': (v) => (visible.value = v),
          ...props
        })
    }
  }
  app = createApp(Wrapper)
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.config.warnHandler = () => {}
  app.mount(container)
  return container
}
async function open() {
  setVisible(true)
  for (let i = 0; i < 3; i++) await nextTick()
}
const inst = () => app._instance.subTree.component
const footBtn = (text) => [...container.querySelectorAll('.dlg-footer button')].find((b) => b.textContent.trim() === text)
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

describe('UserEditor · 新建态', () => {
  it('520px admin-dialog 壳；初始角色为卡片复选且默认勾中「普通用户」；确认键「新建」；占位文案照 md', async () => {
    const el = mount({ user: null })
    await open()
    const dlg = el.querySelector('.el-dialog')
    expect(dlg.dataset.width).toBe('520px')
    expect(dlg.dataset.title).toBe('新建用户')
    const cards = [...el.querySelectorAll('.check-card')]
    expect(cards.map((c) => c.querySelector('strong').textContent)).toEqual(['系统管理员', '普通用户'])
    expect(cards[1].querySelector('input').checked).toBe(true)
    expect(cards[0].querySelector('input').checked).toBe(false)
    expect(footBtn('新建')).toBeTruthy()
    expect(footBtn('保存')).toBeUndefined()
    const placeholders = [...el.querySelectorAll('input[placeholder]')].map((i) => i.placeholder)
    expect(placeholders).toEqual(['3–32 个字符', '用于展示的姓名', 'name@example.com'])
    expect(el.textContent).toContain('初始密码为 wemate123，用户首次登录后可修改。')
  })

  it('取消全部角色后点【新建】→ 内联「请至少选择一个角色」，不打接口；勾回后错误消失', async () => {
    const el = mount({ user: null })
    await open()
    const box = el.querySelectorAll('.check-card input')[1]
    box.checked = false
    box.dispatchEvent(new Event('change'))
    await nextTick()
    footBtn('新建').click()
    await flush()
    expect(el.querySelector('.error-text').textContent).toBe('请至少选择一个角色')
    expect(createUser).not.toHaveBeenCalled()
    box.checked = true
    box.dispatchEvent(new Event('change'))
    await nextTick()
    expect(el.querySelector('.error-text')).toBeNull()
  })

  it('提交 → createUser 带 roleCodes，toast「用户已新建」并 emit saved', async () => {
    const el = mount({ user: null })
    await open()
    inst().setupState.form.username = 'zhangsan'
    inst().setupState.form.displayName = '张三'
    footBtn('新建').click()
    await flush()
    expect(createUser).toHaveBeenCalledWith({ username: 'zhangsan', displayName: '张三', email: '', roleCodes: ['普通用户'] })
    expect(ElMessage.success).toHaveBeenCalledWith('用户已新建')
    expect(savedSpy).toHaveBeenCalled()
  })
})

describe('UserEditor · 编辑态', () => {
  const USER = {
    id: 9,
    username: 'lisi',
    displayName: '李四',
    email: 'lisi@x.com',
    status: 'disabled',
    roleCodes: ['普通用户'],
    lastLogin: null,
    createdAt: '2026-08-01T10:00:00+08:00',
    updatedAt: '2026-08-20T12:30:00+08:00'
  }

  it('状态下拉与最近登录时间只读框并排（两个 .ue-half）；末行 page-time 横排创建 / 最近更新时间；确认键「保存」', async () => {
    const el = mount({ user: USER })
    await open()
    const halves = [...el.querySelectorAll('.ue-half')]
    expect(halves).toHaveLength(2)
    expect(halves[0].querySelector('label').textContent).toBe('状态')
    expect(halves[0].querySelector('.el-select')).toBeTruthy()
    expect(halves[1].querySelector('label').textContent).toBe('最近登录时间')
    expect(halves[1].querySelector('.ue-readonly').textContent.trim()).toBe('从未登录')
    const pt = el.querySelector('.page-time')
    expect(pt.textContent).toContain('创建时间：')
    expect(pt.textContent).toContain('最近更新时间：')
    expect(el.querySelector('.check-card')).toBeNull()
    expect(el.textContent).not.toContain('初始密码')
    expect(footBtn('保存')).toBeTruthy()
    expect(el.querySelectorAll('input')[0].disabled).toBe(true)
  })

  it('提交 → updateUser 只送 displayName/email/status，toast「用户信息已保存」', async () => {
    mount({ user: USER })
    await open()
    inst().setupState.form.displayName = '李四四'
    footBtn('保存').click()
    await flush()
    expect(updateUser).toHaveBeenCalledWith(9, { displayName: '李四四', email: 'lisi@x.com', status: 'disabled' })
    expect(ElMessage.success).toHaveBeenCalledWith('用户信息已保存')
    expect(savedSpy).toHaveBeenCalled()
  })
})
