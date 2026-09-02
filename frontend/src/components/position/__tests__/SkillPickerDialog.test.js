// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * SkillPickerDialog（V84 引用模型）行为契约（岗位编辑区加固批，2026-08-08）。
 *
 * 岗位页只引用已发布 FDE 技能、不创建（fde-skill-agent-reference-model）。钉住四条：
 *  1. 打开即拉取且**固定 status=published**（草稿技能绝不可进引用列表——权限口径 2026-07-25）；
 *  2. 搜索走服务端（keyword 透传后端，300ms 去抖）——本地过滤曾致「超过分页上限的技能搜不到」回归；
 *  3. 已引用技能（existingIds）置灰：无「引用」入口、展示「本岗位已引用」，onPick 兜底不 emit；
 *  4. 点「引用」→ emit pick(id) 并关闭弹窗。
 */

const listSkillsMock = vi.fn()
vi.mock('@/api/position', () => ({ listSkills: (...a) => listSkillsMock(...a) }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}))

import SkillPickerDialog from '@/components/position/SkillPickerDialog.vue'

const ROWS = [
  { id: 'sk_a', name: '技能A', code: 'skill_a', status: 'published', description: 'da' },
  { id: 'sk_b', name: '技能B', code: 'skill_b', status: 'published', description: 'db' }
]

const stubs = {
  'el-dialog': { template: '<div class="el-dialog"><slot /><slot name="footer" /></div>' },
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input class="stub-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-icon': { template: '<i><slot /></i>' },
  'el-empty': { template: '<div class="el-empty" />' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-button': { template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>' },
  Search: { template: '<i />' }
}

let app, container, pickSpy, closeSpy, setVisible

// load() 由 watch(modelValue) 触发（非 immediate）——须模拟真实「从关到开」动作，不能挂载即 true。
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  pickSpy = vi.fn()
  closeSpy = vi.fn()
  app = createApp({
    setup() {
      const visible = ref(false)
      setVisible = (v) => {
        visible.value = v
      }
      return () =>
        h(SkillPickerDialog, {
          modelValue: visible.value,
          existingIds: [],
          'onUpdate:modelValue': closeSpy,
          onPick: pickSpy,
          ...props
        })
    }
  })
  app.directive('loading', {})
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return container
}

async function open() {
  setVisible(true)
  await nextTick()
  await nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  listSkillsMock.mockResolvedValue({ list: ROWS })
})
afterEach(() => {
  vi.useRealTimers()
  app?.unmount()
  container?.remove()
})

describe('SkillPickerDialog · V84 引用模型行为契约', () => {
  it('打开即拉取，固定 status=published（草稿绝不可入引用列表）', async () => {
    mount()
    await open()
    expect(listSkillsMock).toHaveBeenCalledTimes(1)
    const params = listSkillsMock.mock.calls[0][0]
    expect(params.status).toBe('published')
    expect(params).not.toHaveProperty('keyword')
  })

  it('搜索走服务端：keyword 300ms 去抖后透传后端（不做本地过滤）', async () => {
    const el = mount()
    await open()
    listSkillsMock.mockClear()

    const input = el.querySelector('.stub-input')
    input.value = '回访'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    // 去抖窗口内不发请求
    vi.advanceTimersByTime(200)
    expect(listSkillsMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150)
    await nextTick()
    expect(listSkillsMock).toHaveBeenCalledTimes(1)
    expect(listSkillsMock.mock.calls[0][0]).toMatchObject({ status: 'published', keyword: '回访' })
  })

  it('已引用技能置灰：无「引用」按钮、显示「本岗位已引用」', async () => {
    const el = mount({ existingIds: ['sk_a'] })
    await open()
    await vi.runAllTimersAsync()
    await nextTick()
    const rows = [...el.querySelectorAll('.sp-row')]
    expect(rows.length).toBe(2)
    const rowA = rows.find((r) => r.textContent.includes('技能A'))
    const rowB = rows.find((r) => r.textContent.includes('技能B'))
    expect(rowA.textContent).toContain('本岗位已引用')
    expect(rowA.querySelector('.el-button')).toBeNull()
    expect(rowB.querySelector('.el-button')).toBeTruthy()
  })

  // 测试边界（2026-08-08 审视记录）：onPick 内的 `existingSet.has → return` 是防御性兜底，
  // 但「引用」按钮在已引用行由模板 v-if 隐藏，组件级测试无法从 DOM 触达该分支——
  // 实测掏空该 return 后本文件仍全绿。故不为其编造断言（会成为假守卫）：
  // 真实保护 = 上面的模板置灰用例（第一道闸）+ 后端 (position_id, skill_id) 唯一键（最终闸）。

  it('点「引用」→ emit pick(skillId) 并关闭弹窗', async () => {
    const el = mount()
    await open()
    await vi.runAllTimersAsync()
    await nextTick()
    const rowB = [...el.querySelectorAll('.sp-row')].find((r) => r.textContent.includes('技能B'))
    rowB.querySelector('.el-button').click()
    expect(pickSpy).toHaveBeenCalledWith('sk_b')
    expect(closeSpy).toHaveBeenCalledWith(false)
  })
})
