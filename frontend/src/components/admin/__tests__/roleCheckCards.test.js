// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * RoleCheckCards（角色卡片复选）—— 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/06组织/用户/prd-用户.md
 * §二.2.3（设置角色：可选择一个或多个角色）/ §三.2（新建：初始角色多选）（历史出处：2026-09-08 原型复刻批次 2A G#6/#8）：
 *  - 两列 .check-list 内每个角色一张 .check-card（原生 checkbox + 角色名 + 「授予对应平台权限」副文案）；
 *  - 勾选 / 取消 emit update:modelValue，输出按选项顺序稳定；
 *  - error 非空 → 区块加 is-invalid 并在下方内联 .error-text。
 */
const RoleCheckCards = (await import('@/components/admin/RoleCheckCards.vue')).default

const OPTIONS = [
  { code: 'admin', name: '系统管理员' },
  { code: 'fde', name: 'FDE 工程师' },
  { code: 'user', name: '普通用户' }
]

let app, container
function mount(initial = [], error = '') {
  container = document.createElement('div')
  document.body.appendChild(container)
  const model = ref(initial)
  const errRef = ref(error)
  app = createApp({
    setup() {
      return () =>
        h(RoleCheckCards, {
          modelValue: model.value,
          options: OPTIONS,
          error: errRef.value,
          'onUpdate:modelValue': (v) => (model.value = v)
        })
    }
  })
  app.mount(container)
  return { model, errRef }
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})

const boxes = () => [...container.querySelectorAll('.check-card input')]
async function toggle(i, on) {
  boxes()[i].checked = on
  boxes()[i].dispatchEvent(new Event('change'))
  await nextTick()
}

describe('RoleCheckCards', () => {
  it('渲染每个角色一张卡：角色名 + 副文案「授予对应平台权限」；已选卡带 is-checked', () => {
    mount(['fde'])
    const cards = [...container.querySelectorAll('.check-card')]
    expect(cards).toHaveLength(3)
    expect(cards[1].querySelector('strong').textContent).toBe('FDE 工程师')
    expect(cards[1].querySelector('small').textContent).toBe('授予对应平台权限')
    expect(cards[1].className).toContain('is-checked')
    expect(cards[0].className).not.toContain('is-checked')
    expect(boxes()[1].checked).toBe(true)
  })

  it('勾选 / 取消 → emit 新数组，按选项顺序稳定输出', async () => {
    const { model } = mount(['user'])
    await toggle(0, true)
    expect(model.value).toEqual(['admin', 'user'])
    await toggle(2, false)
    expect(model.value).toEqual(['admin'])
  })

  it('error 非空 → 区块 is-invalid + 内联 error-text；清空后消失', async () => {
    const { errRef } = mount([], '请至少选择一个角色')
    expect(container.querySelector('.rcc').className).toContain('is-invalid')
    expect(container.querySelector('.error-text').textContent).toBe('请至少选择一个角色')
    errRef.value = ''
    await nextTick()
    expect(container.querySelector('.error-text')).toBeNull()
  })
})
