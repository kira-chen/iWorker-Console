// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * AgentLane（岗位编辑区 Agent 泳道）行为契约（岗位编辑区加固批，2026-08-08）。
 *
 * 钉住四条口径：
 *  1. 「＋ 引用技能」→ emit pick-skill（岗位页只引用不创建）；达 SKILL_MAX=20 上限入口禁用不 emit；
 *  2. 删 Agent 二次确认（用户拍板文案）：N>0 时确认框必须展示技能数 N 与「未被引用」脱钩语义，
 *     确认→emit delete，取消→不 emit；
 *  3. 跨泳道拖拽：skillId/agentId 按字符串原样透传（方案B——曾因把 sk_ 与 ag_ 前缀 id 做 Number() 化出回归）；
 *  4. 同泳道拖拽 → reorder-skills 给出新顺序数组。
 */

const confirmMock = vi.fn()
const warnMock = vi.fn()
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: (...a) => warnMock(...a), info: vi.fn() }),
  ElMessageBox: { confirm: (...a) => confirmMock(...a) }
}))
vi.mock('@/components/position/SkillCard.vue', () => ({
  default: { name: 'SkillCard', props: ['skill'], setup: (p) => () => h('div', { class: 'stub-card' }, p.skill.name) }
}))

import AgentLane from '@/components/position/AgentLane.vue'

const stubs = {
  'el-icon': { template: '<i><slot /></i>' },
  'el-dropdown': {
    emits: ['command'],
    template: '<div class="stub-dropdown" @click="$emit(\'command\', \'delete\')"><slot /><slot name="dropdown" /></div>'
  },
  'el-dropdown-menu': { template: '<div><slot /></div>' },
  'el-dropdown-item': { template: '<div><slot /></div>' },
  MoreFilled: { template: '<i />' }
}

function skillsOf(n) {
  return Array.from({ length: n }, (_, i) => ({ skillId: `sk_${i}`, name: `S${i}` }))
}

let app, container, emitted

function mount(agent) {
  container = document.createElement('div')
  document.body.appendChild(container)
  emitted = { pick: [], del: [], move: [], reorder: [] }
  app = createApp({
    render: () =>
      h(AgentLane, {
        agent,
        onPickSkill: (id) => emitted.pick.push(id),
        onDelete: (id) => emitted.del.push(id),
        onMoveSkill: (p) => emitted.move.push(p),
        onReorderSkills: (id, next) => emitted.reorder.push([id, next])
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  return container
}

/** 构造带 dataTransfer 的拖放事件（jsdom 无原生 DataTransfer）。 */
function dropEvent(data) {
  const ev = new Event('drop', { bubbles: true, cancelable: true })
  ev.dataTransfer = {
    types: Object.keys(data),
    getData: (k) => data[k] ?? '',
    setData: () => {},
    effectAllowed: 'move'
  }
  return ev
}

beforeEach(() => {
  vi.clearAllMocks()
  confirmMock.mockResolvedValue()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AgentLane · 岗位编辑区泳道行为契约', () => {
  it('「＋ 引用技能」→ emit pick-skill(agentId)；只引用不创建', async () => {
    const el = mount({ agentId: 'ag_1', name: 'A', skills: skillsOf(2) })
    el.querySelector('.lane-add').click()
    expect(emitted.pick).toEqual(['ag_1'])
  })

  it('达 20 上限：入口置灰显示上限文案，点击不 emit', async () => {
    const el = mount({ agentId: 'ag_1', name: 'A', skills: skillsOf(20) })
    const add = el.querySelector('.lane-add')
    expect(add.classList.contains('disabled')).toBe(true)
    expect(add.textContent).toContain('已达 20 个技能上限')
    add.click()
    expect(emitted.pick).toEqual([])
  })

  it('删 Agent（N>0）：确认框展示技能数与「未被引用」脱钩语义，确认后 emit delete', async () => {
    const el = mount({ agentId: 'ag_1', name: 'A', skills: skillsOf(3) })
    el.querySelector('.stub-dropdown').click()
    await nextTick()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    const [html, title] = confirmMock.mock.calls[0]
    expect(html).toContain('<b>3</b> 个技能')
    expect(html).toContain('未被引用')
    expect(html).toContain('不会随本岗位发布生效')
    expect(title).toContain('删除 Agent「A」')
    await nextTick()
    expect(emitted.del).toEqual(['ag_1'])
  })

  it('删 Agent 取消：不 emit delete', async () => {
    confirmMock.mockRejectedValue(new Error('cancel'))
    const el = mount({ agentId: 'ag_1', name: 'A', skills: skillsOf(1) })
    el.querySelector('.stub-dropdown').click()
    await nextTick()
    await nextTick()
    expect(emitted.del).toEqual([])
  })

  it('跨泳道拖入达上限：轻提示且不 emit move-skill（拖拽路径的上限闸，与「＋引用」入口各守一条）', async () => {
    const el = mount({ agentId: 'ag_1', name: 'A', skills: skillsOf(20) })
    el.querySelector('.lane').dispatchEvent(
      dropEvent({ 'text/skill-id': 'sk_new', 'text/from-agent': 'ag_other' })
    )
    await nextTick()
    expect(emitted.move, '已达上限的泳道不应接收跨泳道迁移').toEqual([])
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('上限'))
  })

  it('跨泳道拖入：skillId/agentId 字符串原样透传（方案B：字符串 id 不得 Number 化）', async () => {
    const el = mount({ agentId: 'ag_1', name: 'A', skills: skillsOf(2) })
    el.querySelector('.lane').dispatchEvent(
      dropEvent({ 'text/skill-id': 'sk_x9', 'text/from-agent': 'ag_other' })
    )
    expect(emitted.move).toEqual([{ skillId: 'sk_x9', fromAgentId: 'ag_other', toAgentId: 'ag_1' }])
  })

  it('同泳道拖到末尾空白区：首卡应落到末位（off-by-one 回归钉，2026-08-08 修复）', async () => {
    const el = mount({ agentId: 'ag_1', name: 'A', skills: skillsOf(3) }) // sk_0, sk_1, sk_2
    el.querySelector('.lane').dispatchEvent(
      dropEvent({ 'text/skill-id': 'sk_0', 'text/from-agent': 'ag_1' })
    )
    expect(emitted.reorder.length).toBe(1)
    const [agentId, next] = emitted.reorder[0]
    expect(agentId).toBe('ag_1')
    expect(next.map((s) => s.skillId)).toEqual(['sk_1', 'sk_2', 'sk_0'])
  })

  it('同泳道落在某卡上（拖拽前坐标）：末卡拖到首位，-1 修正不误伤', async () => {
    const el = mount({ agentId: 'ag_1', name: 'A', skills: skillsOf(3) }) // sk_0, sk_1, sk_2
    el.querySelectorAll('.card-wrap')[0].dispatchEvent(
      dropEvent({ 'text/skill-id': 'sk_2', 'text/from-agent': 'ag_1' })
    )
    const [, next] = emitted.reorder[0]
    expect(next.map((s) => s.skillId)).toEqual(['sk_2', 'sk_0', 'sk_1'])
  })

  it('同泳道向后落卡（from<to）：sk_0 落在 sk_2 卡上 → 插到 sk_2 前', async () => {
    const el = mount({ agentId: 'ag_1', name: 'A', skills: skillsOf(3) }) // sk_0, sk_1, sk_2
    el.querySelectorAll('.card-wrap')[2].dispatchEvent(
      dropEvent({ 'text/skill-id': 'sk_0', 'text/from-agent': 'ag_1' })
    )
    const [, next] = emitted.reorder[0]
    expect(next.map((s) => s.skillId)).toEqual(['sk_1', 'sk_0', 'sk_2'])
  })
})
