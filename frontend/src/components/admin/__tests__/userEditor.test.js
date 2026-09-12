// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * UserEditor（用户新建 / 编辑窗）—— 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/06组织/用户/prd-用户.md §三（用户编辑页）
 * + 各模块必填选填字段一览表.md §九（历史出处：2026-09-08 原型复刻批次 2A G#5/#6/#7）。
 *
 * 覆盖：
 *  - §三.1 两态标题「新建用户」/「编辑用户」；确认键「新建」/「保存」；每次打开重新展示内容并清除上次校验提示；
 *  - §三.2 新建字段占位「3–32 个字符」「用于展示的姓名」「name@example.com」、初始角色卡片默认勾中「普通用户」、初始密码提示；
 *  - §三.3 新建校验：用户名空 / <3 / >32 →「请输入 3–32 个字符」，显示名空 →「请输入显示名」，邮箱格式 →「请输入有效邮箱」，
 *    未选角色 →「请至少选择一个角色」；有问题不保存、窗口保持打开；
 *  - §三.4 / §三.5 编辑态：用户名只读、不校验长度；状态下拉与最近登录时间并排；创建 / 最近更新时间只读；
 *  - §三.6 / §三.7 成功 toast「用户已新建」/「用户信息已保存」+ 关窗；失败显具体原因或「保存失败，请重试」且窗口保持打开、内容保留。
 *
 * el-form 桩内置一个只认 required / min / max / type:'email' 的迷你校验器：读组件真实 rules 校验 model，
 * 把错误文案渲染成 .form-err——校验断言落在用户可见文案与「是否打接口」上，而不是断 rules 对象。
 * K14 已于 2026-09-12 闭环：新建态「初始角色」区渲染 md §三.2 L149 提示「选择一个或多个角色」，编辑态不出现（见对应用例）。
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const stubs = {
  'el-dialog': {
    props: ['modelValue', 'title', 'width'],
    template:
      '<div class="el-dialog" :data-width="width" :data-title="title" :data-open="modelValue"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>'
  },
  'el-form': {
    props: ['model', 'rules'],
    data: () => ({ errors: {} }),
    template:
      '<form><slot /><div v-for="(m, k) in errors" :key="k" class="form-err" :data-prop="k">{{ m }}</div></form>',
    methods: {
      // 迷你校验器：按组件传入的 rules 逐项检查 model（required / min / max / type:email），首条不过即记该项文案
      validate(cb) {
        const errors = {}
        for (const [prop, list] of Object.entries(this.rules || {})) {
          const s = String(this.model?.[prop] ?? '')
          for (const r of list) {
            let bad = false
            if (r.required) bad = !s.trim()
            else if (r.min != null || r.max != null) bad = !!s && ((r.min != null && s.length < r.min) || (r.max != null && s.length > r.max))
            else if (r.type === 'email') bad = !!s && !EMAIL_RE.test(s)
            if (bad) {
              errors[prop] = r.message
              break
            }
          }
        }
        this.errors = errors
        const ok = !Object.keys(errors).length
        return cb ? cb(ok) : Promise.resolve(ok)
      },
      clearValidate() {
        this.errors = {}
      }
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
  'el-button': { props: ['loading'], emits: ['click'], template: '<button :data-loading="loading ? \'1\' : null" @click="$emit(\'click\')"><slot /></button>' }
}
const ROLES = [
  { code: '系统管理员', name: '系统管理员' },
  { code: '普通用户', name: '普通用户' }
]

let app, container, setVisible, savedSpy, visibleRef
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  savedSpy = vi.fn()
  const Wrapper = {
    setup() {
      visibleRef = ref(false)
      setVisible = (v) => (visibleRef.value = v)
      return () =>
        h(UserEditor, {
          visible: visibleRef.value,
          roleOptions: ROLES,
          onSaved: savedSpy,
          'onUpdate:visible': (v) => (visibleRef.value = v),
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
async function close() {
  setVisible(false)
  for (let i = 0; i < 3; i++) await nextTick()
}
const inst = () => app._instance.subTree.component
const footBtn = (text) => [...container.querySelectorAll('.dlg-footer button')].find((b) => b.textContent.trim() === text)
const formErr = (prop) => container.querySelector(`.form-err[data-prop="${prop}"]`)?.textContent
const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const inputByPlaceholder = (p) => container.querySelector(`input[placeholder="${p}"]`)
function typeInto(input, value) {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('UserEditor · 新建态（md §三.1 / §三.2）', () => {
  it('标题「新建用户」+ 520px admin-dialog 壳；占位文案照 md；初始角色卡片默认勾中「普通用户」；确认键「新建」；初始密码提示', async () => {
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
    expect(footBtn('取消')).toBeTruthy()
    expect(footBtn('保存')).toBeUndefined()
    const placeholders = [...el.querySelectorAll('input[placeholder]')].map((i) => i.placeholder)
    expect(placeholders).toEqual(['3–32 个字符', '用于展示的姓名', 'name@example.com'])
    expect([...el.querySelectorAll('.el-form-item > label')].map((l) => l.textContent)).toEqual(['用户名', '显示名', '邮箱（选填）', '初始角色'])
    expect(el.textContent).toContain('初始密码为 wemate123，用户首次登录后可修改。')
  })

  it('新建态「初始角色」区带提示文字「选择一个或多个角色」，位于卡片之前；编辑态无此提示（md §三.2 L149；审计 K14）', async () => {
    let el = mount({ user: null })
    await open()
    const hint = el.querySelector('.ue-roles .ue-role-hint')
    expect(hint.textContent.trim()).toBe('选择一个或多个角色')
    // 提示在卡片之前（Node.DOCUMENT_POSITION_FOLLOWING = 4）
    expect(hint.compareDocumentPosition(el.querySelector('.check-card')) & 4).toBeTruthy()
    app.unmount(); container.remove()

    el = mount({ user: { id: 9, username: 'zhangsan', displayName: '张三', email: '', status: 'active', roleCodes: ['USER'] } })
    await open()
    expect(el.querySelector('.ue-role-hint')).toBeNull()
    expect(el.textContent).not.toContain('选择一个或多个角色')
  })

  it('取消全部角色后点【新建】→ 内联「请至少选择一个角色」，不打接口、窗口保持打开；勾回后错误消失（§三.3 L160）', async () => {
    const el = mount({ user: null })
    await open()
    typeInto(inputByPlaceholder('3–32 个字符'), 'zhangsan')
    typeInto(inputByPlaceholder('用于展示的姓名'), '张三')
    const box = el.querySelectorAll('.check-card input')[1]
    box.checked = false
    box.dispatchEvent(new Event('change'))
    await nextTick()
    footBtn('新建').click()
    await flush()
    expect(el.querySelector('.error-text').textContent).toBe('请至少选择一个角色')
    expect(createUser).not.toHaveBeenCalled()
    expect(visibleRef.value).toBe(true)
    box.checked = true
    box.dispatchEvent(new Event('change'))
    await nextTick()
    expect(el.querySelector('.error-text')).toBeNull()
  })

  it('提交 → createUser 带 roleCodes，toast「用户已新建」、关窗并 emit saved（§三.6 L191）', async () => {
    mount({ user: null })
    await open()
    typeInto(inputByPlaceholder('3–32 个字符'), 'zhangsan')
    typeInto(inputByPlaceholder('用于展示的姓名'), '张三')
    footBtn('新建').click()
    await flush()
    expect(createUser).toHaveBeenCalledWith({ username: 'zhangsan', displayName: '张三', email: '', roleCodes: ['普通用户'] })
    expect(ElMessage.success).toHaveBeenCalledWith('用户已新建')
    expect(savedSpy).toHaveBeenCalled()
    expect(visibleRef.value).toBe(false)
  })
})

describe('UserEditor · 新建校验（md §三.3 L156-161 / 一览表 §九）', () => {
  it('用户名为空 →「请输入 3–32 个字符」；显示名为空 →「请输入显示名」；不保存、窗口保持打开', async () => {
    mount({ user: null })
    await open()
    footBtn('新建').click()
    await flush()
    expect(formErr('username')).toBe('请输入 3–32 个字符')
    expect(formErr('displayName')).toBe('请输入显示名')
    expect(createUser).not.toHaveBeenCalled()
    expect(visibleRef.value).toBe(true)
  })

  it('用户名 2 位 / 33 位 →「请输入 3–32 个字符」；3 位与 32 位通过（不限制字符类型）', async () => {
    mount({ user: null })
    await open()
    typeInto(inputByPlaceholder('用于展示的姓名'), '张三')
    const username = inputByPlaceholder('3–32 个字符')
    typeInto(username, 'ab')
    footBtn('新建').click()
    await flush()
    expect(formErr('username')).toBe('请输入 3–32 个字符')
    typeInto(username, 'a'.repeat(33))
    footBtn('新建').click()
    await flush()
    expect(formErr('username')).toBe('请输入 3–32 个字符')
    expect(createUser).not.toHaveBeenCalled()
    typeInto(username, '张三!')
    footBtn('新建').click()
    await flush()
    expect(createUser).toHaveBeenCalledTimes(1)
    expect(createUser.mock.calls[0][0].username).toBe('张三!')
    typeInto(username, 'b'.repeat(32))
    footBtn('新建').click()
    await flush()
    expect(createUser).toHaveBeenCalledTimes(2)
  })

  it('邮箱格式不正确 →「请输入有效邮箱」；邮箱留空（选填）通过', async () => {
    mount({ user: null })
    await open()
    typeInto(inputByPlaceholder('3–32 个字符'), 'zhangsan')
    typeInto(inputByPlaceholder('用于展示的姓名'), '张三')
    typeInto(inputByPlaceholder('name@example.com'), 'not-an-email')
    footBtn('新建').click()
    await flush()
    expect(formErr('email')).toBe('请输入有效邮箱')
    expect(createUser).not.toHaveBeenCalled()
    typeInto(inputByPlaceholder('name@example.com'), '')
    footBtn('新建').click()
    await flush()
    expect(createUser).toHaveBeenCalledTimes(1)
  })
})

describe('UserEditor · 编辑态（md §三.4 / §三.5）', () => {
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

  it('标题「编辑用户」；用户名只读；状态下拉与最近登录时间只读框并排（两个 .ue-half）；末行 page-time 创建 / 最近更新时间；不展示角色与初始密码；确认键「保存」', async () => {
    const el = mount({ user: USER })
    await open()
    expect(el.querySelector('.el-dialog').dataset.title).toBe('编辑用户')
    const halves = [...el.querySelectorAll('.ue-half')]
    expect(halves).toHaveLength(2)
    expect(halves[0].querySelector('label').textContent).toBe('状态')
    expect(halves[0].querySelector('.el-select')).toBeTruthy()
    expect([...halves[0].querySelectorAll('option')].map((o) => o.textContent)).toEqual(['启用', '停用'])
    expect(halves[1].querySelector('label').textContent).toBe('最近登录时间')
    expect(halves[1].querySelector('.ue-readonly').textContent.trim()).toBe('从未登录')
    const pt = el.querySelector('.page-time')
    expect(pt.textContent).toContain('创建时间：')
    expect(pt.textContent).toContain('最近更新时间：')
    expect(el.querySelector('.check-card')).toBeNull()
    expect(el.textContent).not.toContain('初始密码')
    expect(footBtn('保存')).toBeTruthy()
    expect(footBtn('新建')).toBeUndefined()
    const usernameInput = el.querySelectorAll('input')[0]
    expect(usernameInput.disabled).toBe(true)
    expect(usernameInput.value).toBe('lisi')
    expect(inputByPlaceholder('用于展示的姓名').value).toBe('李四')
    expect(inputByPlaceholder('name@example.com').value).toBe('lisi@x.com')
  })

  it('提交 → updateUser 只送 displayName/email/status，toast「用户信息已保存」、关窗并 emit saved（§三.6 L191）', async () => {
    mount({ user: USER })
    await open()
    typeInto(inputByPlaceholder('用于展示的姓名'), '李四四')
    footBtn('保存').click()
    await flush()
    expect(updateUser).toHaveBeenCalledWith(9, { displayName: '李四四', email: 'lisi@x.com', status: 'disabled' })
    expect(ElMessage.success).toHaveBeenCalledWith('用户信息已保存')
    expect(savedSpy).toHaveBeenCalled()
    expect(visibleRef.value).toBe(false)
  })

  it('编辑校验：显示名空 →「请输入显示名」；邮箱格式 →「请输入有效邮箱」；用户名不重复校验长度（2 位用户名也可保存）（§三.5 L181-183）', async () => {
    mount({ user: { ...USER, username: 'ab' } })
    await open()
    typeInto(inputByPlaceholder('用于展示的姓名'), '')
    typeInto(inputByPlaceholder('name@example.com'), 'bad')
    footBtn('保存').click()
    await flush()
    expect(formErr('displayName')).toBe('请输入显示名')
    expect(formErr('email')).toBe('请输入有效邮箱')
    expect(formErr('username')).toBeUndefined()
    expect(updateUser).not.toHaveBeenCalled()
    typeInto(inputByPlaceholder('用于展示的姓名'), '李四')
    typeInto(inputByPlaceholder('name@example.com'), '')
    footBtn('保存').click()
    await flush()
    expect(updateUser).toHaveBeenCalledWith(9, { displayName: '李四', email: '', status: 'disabled' })
  })
})

describe('UserEditor · 重开与保存失败（md §三.1 L141-142 / §三.6 L192-193 / §三.7）', () => {
  it('关闭后重新打开 → 新建内容回空白、角色回默认「普通用户」、上次校验提示清除（L142 / L200）', async () => {
    const el = mount({ user: null })
    await open()
    typeInto(inputByPlaceholder('3–32 个字符'), 'draft')
    const box = el.querySelectorAll('.check-card input')[1]
    box.checked = false
    box.dispatchEvent(new Event('change'))
    await nextTick()
    footBtn('新建').click()
    await flush()
    expect(el.querySelector('.error-text')).toBeTruthy()
    expect(formErr('displayName')).toBe('请输入显示名')
    await close()
    await open()
    expect(inputByPlaceholder('3–32 个字符').value).toBe('')
    expect(el.querySelectorAll('.check-card input')[1].checked).toBe(true)
    expect(el.querySelector('.error-text')).toBeNull()
    expect(el.querySelector('.form-err')).toBeNull()
  })

  it('保存失败：有具体原因显原因、无原因显「保存失败，请重试」；窗口保持打开、填写内容保留、不 emit saved', async () => {
    mount({ user: null })
    await open()
    typeInto(inputByPlaceholder('3–32 个字符'), 'zhangwei')
    typeInto(inputByPlaceholder('用于展示的姓名'), '张伟')
    createUser.mockRejectedValueOnce(new Error('用户名已存在'))
    footBtn('新建').click()
    await flush()
    expect(ElMessage.error).toHaveBeenLastCalledWith('用户名已存在')
    createUser.mockRejectedValueOnce({})
    footBtn('新建').click()
    await flush()
    expect(ElMessage.error).toHaveBeenLastCalledWith('保存失败，请重试')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(savedSpy).not.toHaveBeenCalled()
    expect(visibleRef.value).toBe(true)
    expect(inputByPlaceholder('3–32 个字符').value).toBe('zhangwei')
    expect(inputByPlaceholder('用于展示的姓名').value).toBe('张伟')
  })

  it('保存期间确认按钮显进行中（loading）、完成后恢复（L141）', async () => {
    let finish
    createUser.mockReturnValue(new Promise((r) => { finish = r }))
    mount({ user: null })
    await open()
    typeInto(inputByPlaceholder('3–32 个字符'), 'zhangsan')
    typeInto(inputByPlaceholder('用于展示的姓名'), '张三')
    footBtn('新建').click()
    await flush()
    expect(footBtn('新建').dataset.loading).toBe('1')
    finish({})
    await flush()
    expect(footBtn('新建').dataset.loading).toBeUndefined()
  })
})
