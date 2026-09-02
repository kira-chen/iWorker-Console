// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * RoleEditor（角色编辑器，ADMIN 专属）行为契约。
 * 2026-09-01 PRD 对齐改造取代旧口径（原断言基于 el-tree 命令式 API + Module code 权限项），
 * 本文件按新契约重写：
 * - 权限区弃 el-tree，按原型 permission-tree 结构：用户端整组勾选（不展开子页面）、
 *   管理端分组卡片式复选 + 组头「N/M」计数、底部实时「已选择 N 个页面」；权限项=页面名；
 * - 标题：新建「新建角色」/ 编辑「编辑角色与权限」；footer：新建【创建角色】/ 编辑【保存】；
 * - 勾选为 0 提交 → 就地「请至少开通 1 个页面」不提交；
 * - 编辑态底部提示「该角色当前绑定 N 个用户。…」；
 * - 保留既有 API 分发契约：新建只调 createRole（不传 code）；编辑改名/改权限按需分别下发、
 *   都没改不发写请求、集合比对与顺序无关。
 */

const createRole = vi.fn(() => Promise.resolve({}))
const updateRole = vi.fn(() => Promise.resolve({}))
const setRolePermissions = vi.fn(() => Promise.resolve({}))
vi.mock('@/api/adminUser', () => ({
  createRole: (...a) => createRole(...a),
  updateRole: (...a) => updateRole(...a),
  setRolePermissions: (...a) => setRolePermissions(...a)
}))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}))

const { ElMessage } = await import('element-plus')
const RoleEditor = (await import('@/components/admin/RoleEditor.vue')).default

const stubs = {
  'el-drawer': {
    props: ['modelValue', 'title'],
    template: '<div class="el-drawer"><div class="dr-title"><slot name="header">{{ title }}</slot></div><slot /><div class="dr-footer"><slot name="footer" /></div></div>'
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
  'el-form-item': { props: ['label'], template: '<div class="el-form-item"><label><slot name="label">{{ label }}</slot></label><slot /></div>' },
  'el-input': { props: ['modelValue', 'disabled'], template: '<input :disabled="disabled" :value="modelValue" />' },
  'el-checkbox': {
    props: { modelValue: Boolean, indeterminate: Boolean },
    emits: ['change'],
    template: '<input type="checkbox" class="el-checkbox" :checked="modelValue" :data-ind="indeterminate" @change="$emit(\'change\', $event.target.checked)" />'
  },
  'el-button': { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
  'el-empty': { props: ['description'], template: '<div class="el-empty">{{ description }}</div>' },
  'el-skeleton': { template: '<div class="el-skeleton" />' }
}

/** 权限树（原型 permissionGroups 形态）：用户端整组 + 管理端两个分组。 */
const TREE = [
  { scope: '用户端', groups: [{ name: '工作台', pages: ['对话', '定时任务', '个人空间', '设置'] }] },
  {
    scope: '管理端',
    groups: [
      { name: '01 总览', pages: ['驾驶舱'] },
      { name: '02 岗位', pages: ['岗位', '岗位分配'] }
    ]
  }
]

let app, container, savedSpy, setVisible

// reset() 由 watch(visible) 触发（非 immediate）——必须模拟真实「从关到开」
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  savedSpy = vi.fn()
  const Wrapper = {
    setup() {
      const visible = ref(false)
      setVisible = (v) => {
        visible.value = v
      }
      return () =>
        h(RoleEditor, {
          visible: visible.value,
          permissionTree: TREE,
          onSaved: savedSpy,
          'onUpdate:visible': () => {},
          ...props
        })
    }
  }
  app = createApp(Wrapper)
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.directive('loading', {})
  app.config.warnHandler = () => {}
  app.mount(container)
  return container
}

async function open() {
  setVisible(true)
  await nextTick()
  await nextTick()
  await nextTick()
}

/** 取 RoleEditor 组件实例的 setupState（改表单态用）。 */
function inst() {
  return app._instance.subTree.component
}

const scopeHeads = (el) => [...el.querySelectorAll('.re-scope-head input')]
const pageBox = (el, page) =>
  [...el.querySelectorAll('.re-page')].find((l) => l.textContent.trim() === page)?.querySelector('input')
const submitBtn = (el) => [...el.querySelectorAll('button')].find((b) => /创建角色|保存/.test(b.textContent))

async function toggle(box, on = true) {
  box.checked = on
  box.dispatchEvent(new Event('change'))
  await nextTick()
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('RoleEditor · 权限区形态（2026-09-01 原型对齐）', () => {
  it('用户端整组勾选不展开子页面；管理端出分组卡片 + 组头 N/M 计数', async () => {
    const el = mount({ role: null })
    await open()
    const scopes = [...el.querySelectorAll('.re-scope')]
    expect(scopes).toHaveLength(2)
    // 用户端：只有头部勾选，无页面明细
    expect(scopes[0].querySelector('.re-scope-body')).toBeNull()
    expect(scopes[0].querySelector('.re-scope-count')).toBeNull()
    // 管理端：组头计数 0/3 + 两个分组 + 页面复选
    expect(scopes[1].querySelector('.re-scope-count').textContent.trim()).toBe('0/3')
    expect([...scopes[1].querySelectorAll('.re-group-title')].map((g) => g.textContent.trim()))
      .toEqual(['01 总览', '02 岗位'])
    expect(pageBox(el, '岗位分配')).toBeTruthy()
  })

  it('勾用户端整组 → 4 个页面入选；底部实时「已选择 N 个页面」', async () => {
    const el = mount({ role: null })
    await open()
    expect(el.querySelector('.re-perm-summary').textContent).toBe('已选择 0 个页面')
    await toggle(scopeHeads(el)[0])
    expect(el.querySelector('.re-perm-summary').textContent).toBe('已选择 4 个页面')
    await toggle(pageBox(el, '驾驶舱'))
    expect(el.querySelector('.re-perm-summary').textContent).toBe('已选择 5 个页面')
    expect(el.querySelector('.re-scope-count').textContent.trim()).toBe('1/3')
  })

  it('标题与 footer：新建「新建角色」+【创建角色】；编辑「编辑角色与权限」+【保存】+ 绑定用户提示', async () => {
    let el = mount({ role: null })
    await open()
    expect(el.querySelector('.dr-title').textContent).toContain('新建角色')
    expect(submitBtn(el).textContent.trim()).toBe('创建角色')
    expect(el.querySelector('.re-danger-hint')).toBeNull()
    app.unmount(); container.remove()

    el = mount({ role: { id: 7, name: '系统配置员', modules: ['驾驶舱'], userCount: 3 } })
    await open()
    expect(el.querySelector('.dr-title').textContent).toContain('编辑角色与权限')
    expect(submitBtn(el).textContent.trim()).toBe('保存')
    expect(el.querySelector('.re-danger-hint').textContent.trim())
      .toBe('该角色当前绑定 3 个用户。权限调整保存后将对这些用户生效。')
  })

  it('名称 hint 照原型：「角色名称用于用户分配，系统标识自动生成」', async () => {
    const el = mount({ role: null })
    await open()
    expect(el.querySelector('.re-hint').textContent).toBe('角色名称用于用户分配，系统标识自动生成')
  })

  it('勾选为 0 提交 → 就地「请至少开通 1 个页面」，不打接口', async () => {
    const el = mount({ role: null })
    await open()
    inst().setupState.form.name = '自定义'
    submitBtn(el).click()
    await nextTick()
    expect(el.querySelector('.re-perm-err').textContent).toBe('请至少开通 1 个页面')
    expect(createRole).not.toHaveBeenCalled()
    // 勾上一个页面后错误消失
    await toggle(pageBox(el, '驾驶舱'))
    expect(el.querySelector('.re-perm-err')).toBeNull()
  })
})

describe('RoleEditor · API 分发契约（保留旧守卫语义）', () => {
  it('新建角色：只带 name/modules（页面名）调 createRole，不传 code；toast「角色已创建」', async () => {
    const el = mount({ role: null })
    await open()
    inst().setupState.form.name = '内容运营'
    await toggle(scopeHeads(el)[0]) // 用户端整组
    await toggle(pageBox(el, '岗位'))
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(createRole).toHaveBeenCalledWith({
      name: '内容运营',
      modules: ['对话', '定时任务', '个人空间', '设置', '岗位']
    })
    expect(createRole.mock.calls[0][0]).not.toHaveProperty('code')
    expect(setRolePermissions).not.toHaveBeenCalled()
    expect(ElMessage.success).toHaveBeenCalledWith('角色已创建')
    expect(savedSpy).toHaveBeenCalled()
  })

  it('编辑态只改名 → 只调 updateRole，不动权限；toast「角色与权限已保存」', async () => {
    const el = mount({ role: { id: 7, name: '旧名', modules: ['岗位'], userCount: 0 } })
    await open()
    inst().setupState.form.name = '新名'
    await nextTick()
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(updateRole).toHaveBeenCalledWith(7, { name: '新名' })
    expect(setRolePermissions).not.toHaveBeenCalled()
    expect(ElMessage.success).toHaveBeenCalledWith('角色与权限已保存')
  })

  it('编辑态只改权限 → 只调 setRolePermissions（全量替换），不改名', async () => {
    const el = mount({ role: { id: 7, name: '角色', modules: ['岗位'], userCount: 0 } })
    await open()
    await toggle(pageBox(el, '岗位分配'))
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(setRolePermissions).toHaveBeenCalledWith(7, ['岗位', '岗位分配'])
    expect(updateRole).not.toHaveBeenCalled()
  })

  it('编辑态两者都没改 → 一个写请求都不发（空提交不打接口）', async () => {
    const el = mount({ role: { id: 7, name: '角色', modules: ['岗位'], userCount: 0 } })
    await open()
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(updateRole).not.toHaveBeenCalled()
    expect(setRolePermissions).not.toHaveBeenCalled()
    expect(savedSpy).toHaveBeenCalled() // 仍视为保存成功并关闭
  })

  it('权限比对与顺序无关：集合相同仅存储顺序不同 → 不判为变更', async () => {
    // 回填时按树序归一：role.modules 顺序打乱也不构成变更
    const el = mount({ role: { id: 7, name: '角色', modules: ['岗位分配', '岗位'], userCount: 0 } })
    await open()
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(setRolePermissions).not.toHaveBeenCalled()
  })

  it('打开时按角色已有权限回填（回填丢失=管理员会误以为权限被清空）', async () => {
    const el = mount({ role: { id: 7, name: '角色', modules: ['对话', '定时任务', '个人空间', '设置', '驾驶舱'], userCount: 0 } })
    await open()
    // 用户端 4 页齐 → 整组勾中；管理端 1/3
    expect(scopeHeads(el)[0].checked).toBe(true)
    expect(el.querySelector('.re-scope-count').textContent.trim()).toBe('1/3')
    expect(pageBox(el, '驾驶舱').checked).toBe(true)
    expect(el.querySelector('.re-perm-summary').textContent).toBe('已选择 5 个页面')
  })

  it('权限树为空（加载失败）→ 抽屉内失败态文案保持现状', async () => {
    const el = mount({ role: null, permissionTree: [] })
    await open()
    expect(el.querySelector('.el-empty').textContent).toContain('权限树加载失败 · 关闭重开重试')
  })
})
