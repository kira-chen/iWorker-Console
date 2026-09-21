// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * RoleEditor（角色编辑器，ADMIN 专属）—— 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/06组织/角色/prd.角色.md §三（角色编辑页）
 * + 各模块必填选填字段一览表.md §八（历史出处：2026-09-01 PRD 对齐改造 + 2026-09-08 原型复刻批次 2A G#11/#12）。
 *
 * 覆盖：
 *  - §三.1 两态：新建「新建角色」+【取消】【创建角色】/ 编辑「编辑角色与权限」+【取消】【保存】；每次打开重新加载并清除上次校验提示；
 *  - §三.2 角色名称：占位「如 内容运营」、maxlength 64、hint「角色名称用于用户分配，系统标识自动生成」、为空「请填写角色名称」不保存；
 *  - §三.3 页面权限：用户端整组勾选（不展开子页面）、管理端分组 + 组头「N/M」、范围 / 分组联动勾选与部分选中态、
 *    底部实时「已选择 N 个页面」、为 0 →「请至少开通 1 个页面」；编辑态回填 + 底部「该角色当前绑定 N 个用户。…」；
 *  - §三.4 / §三.5 成功 toast「角色已创建」/「角色与权限已保存」；失败显具体原因或「保存失败，请重试」并保持打开；权限树加载失败态；
 *  - API 分发契约：新建只调 createRole（不传 code）；编辑改名 / 改权限按需分别下发、都没改不发写请求、集合比对与顺序无关。
 *
 * el-form 桩内置只认 required 的迷你校验器：读组件真实 rules 校验 model，错误文案渲染成 .form-err。
 * 审计 J9 已按 Q325 闭环（2026-09-12）：md §三.5 L133-134 只有就地提示，无 toast「请先补齐必填项」——
 * 末尾用例改断校验失败时 ElMessage.warning 不被调用。
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
    props: ['model', 'rules'],
    data: () => ({ errors: {} }),
    template: '<form><slot /><div v-for="(m, k) in errors" :key="k" class="form-err" :data-prop="k">{{ m }}</div></form>',
    methods: {
      // 迷你校验器：按组件传入的 rules 检查 model 的 required 项，不过即记该项文案
      validate(cb) {
        const errors = {}
        for (const [prop, list] of Object.entries(this.rules || {})) {
          const s = String(this.model?.[prop] ?? '')
          const hit = list.find((r) => r.required && !s.trim())
          if (hit) errors[prop] = hit.message
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
  'el-form-item': { props: ['label'], template: '<div class="el-form-item"><label><slot name="label">{{ label }}</slot></label><slot /></div>' },
  'el-input': {
    props: ['modelValue', 'disabled', 'placeholder', 'maxlength'],
    emits: ['update:modelValue'],
    template: '<input :disabled="disabled" :placeholder="placeholder" :maxlength="maxlength" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-checkbox': {
    props: { modelValue: Boolean, indeterminate: Boolean },
    emits: ['change'],
    template: '<input type="checkbox" class="el-checkbox" :checked="modelValue" :data-ind="indeterminate" @change="$emit(\'change\', $event.target.checked)" />'
  },
  'el-button': { props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled" :data-loading="loading ? \'1\' : null" @click="$emit(\'click\')"><slot /></button>' },
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
      { name: '02 岗位', pages: ['岗位', '岗位管理'] }
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

describe('RoleEditor · 权限区形态（md §三.3；历史出处：2026-09-01 原型对齐）', () => {
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
    expect(pageBox(el, '岗位管理')).toBeTruthy()
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

  it('名称 hint「角色名称用于用户分配，系统标识自动生成」（md §三.2 L109）', async () => {
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
    await toggle(pageBox(el, '岗位管理'))
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(setRolePermissions).toHaveBeenCalledWith(7, ['岗位', '岗位管理'])
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
    const el = mount({ role: { id: 7, name: '角色', modules: ['岗位管理', '岗位'], userCount: 0 } })
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

describe('RoleEditor · 角色名称（md §三.2 L108-110 / 一览表 §八）', () => {
  it('占位「如 内容运营」、maxlength 64（超长不能继续输入）', async () => {
    const el = mount({ role: null })
    await open()
    const input = el.querySelector('.re-name-item input')
    expect(input.placeholder).toBe('如 内容运营')
    expect(input.getAttribute('maxlength')).toBe('64')
  })

  it('角色名称为空提交 →「请填写角色名称」，不打接口、抽屉保持打开；勾了权限也不保存', async () => {
    const el = mount({ role: null })
    await open()
    await toggle(pageBox(el, '驾驶舱'))
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(el.querySelector('.form-err[data-prop="name"]').textContent).toBe('请填写角色名称')
    expect(el.querySelector('.re-perm-err')).toBeNull()
    expect(createRole).not.toHaveBeenCalled()
    expect(savedSpy).not.toHaveBeenCalled()
  })

  it('名称空 + 权限 0 同时提交 → 两处提示并行亮起（§三.5 L133-134）', async () => {
    const el = mount({ role: null })
    await open()
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(el.querySelector('.form-err[data-prop="name"]').textContent).toBe('请填写角色名称')
    expect(el.querySelector('.re-perm-err').textContent).toBe('请至少开通 1 个页面')
    expect(createRole).not.toHaveBeenCalled()
  })
})

describe('RoleEditor · 权限联动与部分选中（md §三.3 L116-119）', () => {
  it('勾管理端范围头 → 其下全部页面入选、组头计数 3/3；取消 → 全部取消', async () => {
    const el = mount({ role: null })
    await open()
    await toggle(scopeHeads(el)[1])
    expect(el.querySelector('.re-scope-count').textContent.trim()).toBe('3/3')
    expect(['驾驶舱', '岗位', '岗位管理'].map((p) => pageBox(el, p).checked)).toEqual([true, true, true])
    expect(el.querySelector('.re-perm-summary').textContent).toBe('已选择 3 个页面')
    await toggle(scopeHeads(el)[1], false)
    expect(['驾驶舱', '岗位', '岗位管理'].map((p) => pageBox(el, p).checked)).toEqual([false, false, false])
    expect(el.querySelector('.re-perm-summary').textContent).toBe('已选择 0 个页面')
  })

  it('勾分组「02 岗位」→ 组内两页入选、分组勾中；范围头显部分选中（data-ind）', async () => {
    const el = mount({ role: null })
    await open()
    const groupBoxes = [...el.querySelectorAll('.re-group-title input')]
    await toggle(groupBoxes[1])
    expect(pageBox(el, '岗位').checked).toBe(true)
    expect(pageBox(el, '岗位管理').checked).toBe(true)
    expect(pageBox(el, '驾驶舱').checked).toBe(false)
    expect(groupBoxes[1].checked).toBe(true)
    expect(groupBoxes[1].dataset.ind).toBe('false')
    // 范围头：3 页选了 2 → 未全选但部分选中
    expect(scopeHeads(el)[1].checked).toBe(false)
    expect(scopeHeads(el)[1].dataset.ind).toBe('true')
    expect(el.querySelector('.re-scope-count').textContent.trim()).toBe('2/3')
  })

  it('只勾分组内一页 → 分组与范围头都显部分选中；补齐组内页面 → 分组变勾中', async () => {
    const el = mount({ role: null })
    await open()
    const groupBoxes = [...el.querySelectorAll('.re-group-title input')]
    await toggle(pageBox(el, '岗位'))
    expect(groupBoxes[1].checked).toBe(false)
    expect(groupBoxes[1].dataset.ind).toBe('true')
    expect(scopeHeads(el)[1].dataset.ind).toBe('true')
    await toggle(pageBox(el, '岗位管理'))
    expect(groupBoxes[1].checked).toBe(true)
    expect(groupBoxes[1].dataset.ind).toBe('false')
    expect(scopeHeads(el)[1].dataset.ind).toBe('true')
    await toggle(pageBox(el, '驾驶舱'))
    expect(scopeHeads(el)[1].checked).toBe(true)
    expect(scopeHeads(el)[1].dataset.ind).toBe('false')
  })

  it('用户端整组：勾中即 4 页全开、不显部分选中；取消即全关', async () => {
    const el = mount({ role: null })
    await open()
    await toggle(scopeHeads(el)[0])
    expect(scopeHeads(el)[0].checked).toBe(true)
    expect(scopeHeads(el)[0].dataset.ind).toBe('false')
    await toggle(scopeHeads(el)[0], false)
    expect(scopeHeads(el)[0].checked).toBe(false)
    expect(el.querySelector('.re-perm-summary').textContent).toBe('已选择 0 个页面')
  })
})

describe('RoleEditor · 重开与保存失败（md §三.1 L104 / §三.4 L128-129 / §三.5 L136-137）', () => {
  async function close() {
    setVisible(false)
    await nextTick()
    await nextTick()
  }

  it('新建态关闭后重开 → 名称回空、勾选清空、上次校验提示（名称 / 权限）清除', async () => {
    const el = mount({ role: null })
    await open()
    const input = el.querySelector('.re-name-item input')
    input.value = '草稿'
    input.dispatchEvent(new Event('input'))
    await toggle(pageBox(el, '驾驶舱'))
    await toggle(pageBox(el, '驾驶舱'), false)
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(el.querySelector('.re-perm-err')).toBeTruthy()
    await toggle(pageBox(el, '岗位'))
    await close()
    await open()
    expect(el.querySelector('.re-name-item input').value).toBe('')
    expect(pageBox(el, '岗位').checked).toBe(false)
    expect(el.querySelector('.re-perm-summary').textContent).toBe('已选择 0 个页面')
    expect(el.querySelector('.re-perm-err')).toBeNull()
    expect(el.querySelector('.form-err')).toBeNull()
  })

  it('编辑态关闭后重开 → 重新回填该角色已保存的名称与权限，未保存改动不保留', async () => {
    const el = mount({ role: { id: 7, name: '系统配置员', modules: ['驾驶舱'], userCount: 3 } })
    await open()
    const input = el.querySelector('.re-name-item input')
    input.value = '改过的名'
    input.dispatchEvent(new Event('input'))
    await toggle(pageBox(el, '岗位'))
    await toggle(pageBox(el, '驾驶舱'), false)
    await close()
    await open()
    expect(el.querySelector('.re-name-item input').value).toBe('系统配置员')
    expect(pageBox(el, '驾驶舱').checked).toBe(true)
    expect(pageBox(el, '岗位').checked).toBe(false)
    expect(el.querySelector('.re-perm-summary').textContent).toBe('已选择 1 个页面')
  })

  it('保存失败：有具体原因显原因、无原因显「保存失败，请重试」；抽屉保持打开、内容保留、不 emit saved', async () => {
    const el = mount({ role: null })
    await open()
    const input = el.querySelector('.re-name-item input')
    input.value = '内容运营'
    input.dispatchEvent(new Event('input'))
    await toggle(pageBox(el, '驾驶舱'))
    createRole.mockRejectedValueOnce(new Error('角色名称已存在'))
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(ElMessage.error).toHaveBeenLastCalledWith('角色名称已存在')
    createRole.mockRejectedValueOnce({})
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(ElMessage.error).toHaveBeenLastCalledWith('保存失败，请重试')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(savedSpy).not.toHaveBeenCalled()
    expect(el.querySelector('.re-name-item input').value).toBe('内容运营')
    expect(pageBox(el, '驾驶舱').checked).toBe(true)
  })

  it('保存期间按钮显进行中（loading），完成后恢复（§三.4 L128）', async () => {
    let finish
    createRole.mockReturnValue(new Promise((r) => { finish = r }))
    const el = mount({ role: null })
    await open()
    inst().setupState.form.name = '内容运营'
    await toggle(pageBox(el, '驾驶舱'))
    submitBtn(el).click()
    await nextTick()
    await nextTick()
    expect(submitBtn(el).dataset.loading).toBe('1')
    finish({})
    await nextTick()
    await nextTick()
    await nextTick()
    expect(submitBtn(el).dataset.loading).toBeUndefined()
    expect(savedSpy).toHaveBeenCalled()
  })
})

describe('RoleEditor · 分区卡片与校验态（历史出处：2026-09-08 原型复刻批次 2A G#11 分区卡片；G#12 校验 toast 已按 Q325 撤）', () => {
  it('抽屉体为两张 section-card：「角色信息」（名称字段 + hint）与「页面权限」（section-sub + 权限树 + 汇总）；编辑态 danger-hint 在卡外', async () => {
    const el = mount({ role: { id: 7, name: '系统配置员', modules: ['驾驶舱'], userCount: 3 } })
    await open()
    const cards = [...el.querySelectorAll('section.section-card')]
    expect(cards).toHaveLength(2)
    expect(cards[0].querySelector('.section-title').textContent.trim()).toBe('角色信息')
    expect(cards[0].querySelector('input')).toBeTruthy()
    expect(cards[0].querySelector('.re-hint')).toBeTruthy()
    expect(cards[1].querySelector('.section-title').textContent).toContain('页面权限')
    // 页面权限必填（一览表 §八 #2）：卡标题带必填红星
    expect(cards[1].querySelector('.section-title .re-req')?.textContent).toBe('*')
    expect(cards[1].querySelector('.section-sub').textContent.trim()).toBe('勾中哪些页面，持该角色的用户就能进入哪些页面')
    expect(cards[1].querySelector('.re-perm-area')).toBeTruthy()
    expect(cards[1].querySelector('.re-perm-summary')).toBeTruthy()
    const hint = el.querySelector('.re-danger-hint')
    expect(hint).toBeTruthy()
    expect(hint.closest('section.section-card')).toBeNull()
  })

  it('校验失败（权限为 0）→ 只就地红字、不弹 toast「请先补齐必填项」（md §三.5 L134 / Q325，审计 J9），权限卡与范围卡加 is-invalid，不打接口', async () => {
    const el = mount({ role: null })
    await open()
    inst().setupState.form.name = '自定义'
    submitBtn(el).click()
    await nextTick()
    expect(ElMessage.warning).not.toHaveBeenCalled()
    expect(ElMessage).not.toHaveBeenCalled()
    expect(el.querySelector('.re-perm-err').textContent).toBe('请至少开通 1 个页面')
    expect([...el.querySelectorAll('section.section-card')][1].className).toContain('is-invalid')
    // K43：红框靠 .re-perm-area.is-invalid .re-scope 的 border-color 生效，class 必须挂在权限区上
    expect(el.querySelector('.re-perm-area').className).toContain('is-invalid')
    expect(createRole).not.toHaveBeenCalled()
  })
})
