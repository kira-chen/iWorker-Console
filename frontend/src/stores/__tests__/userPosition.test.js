import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// position store rebind action：验证 preview→rebind→三 store 串联刷新。
// 切断真实 API 与兄弟 store，只验证本 store 编排逻辑。

const getRebindPreview = vi.fn()
const rebindPosition = vi.fn()
const getUnbindPreview = vi.fn()
const unbindPosition = vi.fn()
vi.mock('@/api/rebind', () => ({
  getRebindPreview: (...a) => getRebindPreview(...a),
  rebindPosition: (...a) => rebindPosition(...a),
  getUnbindPreview: (...a) => getUnbindPreview(...a),
  unbindPosition: (...a) => unbindPosition(...a),
  rebindErrorMessage: () => '',
  unbindErrorMessage: () => ''
}))

// 切断真实 router（createWebHistory 需 window，node 环境无）：捕获 unbind 跳转。
const routerReplace = vi.fn()
const currentRouteName = { value: 'Settings' }
vi.mock('@/router', () => ({
  default: {
    replace: (...a) => routerReplace(...a),
    get currentRoute() {
      return { value: { name: currentRouteName.value } }
    }
  }
}))

const listPositions = vi.fn()
const bindPositionApi = vi.fn()
vi.mock('@/api/userPosition', () => ({
  listPositions: (...a) => listPositions(...a),
  bindPosition: (...a) => bindPositionApi(...a)
}))

// 兄弟 store mock：捕获刷新调用
const markBoundPosition = vi.fn()
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ markBoundPosition })
}))
const chatReset = vi.fn()
const chatSetActivePosition = vi.fn()
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({ reset: chatReset, setActivePosition: chatSetActivePosition })
}))

const { useUserPositionStore } = await import('@/stores/userPosition')

describe('position store · rebind 三 store 串联刷新', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getRebindPreview.mockReset()
    rebindPosition.mockReset()
    getUnbindPreview.mockReset()
    unbindPosition.mockReset()
    markBoundPosition.mockReset()
    chatReset.mockReset()
    chatSetActivePosition.mockReset()
    routerReplace.mockReset()
    currentRouteName.value = 'Settings'
  })

  it('换绑成功：rebind→markBoundPosition(新id)→setCurrentPosition(新岗位)→chat.reset+setActivePosition', async () => {
    const s = useUserPositionStore()
    // 列表里有新专家展示信息（供 currentExpert / activeExpert 填充）
    s.positions = [
      { id: 1, name: '小赫', jobTag: 'HR', avatar: 'a1' },
      { id: 2, name: '小图', jobTag: 'IT', avatar: 'a2' }
    ]
    rebindPosition.mockResolvedValue({ changed: true, oldPositionId: 1, newPositionId: 2 })

    const result = await s.rebind(2)

    expect(rebindPosition).toHaveBeenCalledWith(2)
    // 1) 登录态绑定标记指向新专家
    expect(markBoundPosition).toHaveBeenCalledWith(2)
    // 2) 主绑定专家切到新专家
    expect(s.currentPosition).toEqual({ id: 2, name: '小图', jobTag: 'IT', avatar: 'a2' })
    // 3) 会话上下文：先 reset 清旧，再 setActivePosition 指向新岗位
    expect(chatReset).toHaveBeenCalledOnce()
    expect(chatSetActivePosition).toHaveBeenCalledWith({
      positionId: 2,
      name: '小图',
      avatar: 'a2',
      jobTag: 'IT'
    })
    expect(result.newPositionId).toBe(2)
  })

  it('列表缺新专家时用最小兜底信息，不抛错', async () => {
    const s = useUserPositionStore()
    s.positions = [{ id: 1, name: '小赫', jobTag: 'HR' }]
    rebindPosition.mockResolvedValue({ changed: true, oldPositionId: 1, newPositionId: 9 })

    await s.rebind(9)

    expect(markBoundPosition).toHaveBeenCalledWith(9)
    expect(s.currentPosition.id).toBe(9)
    expect(chatSetActivePosition).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: 9 })
    )
  })

  it('列表缺新专家但传入 preview.targetExpert：用真实 name/jobTag 兜底，不退化为占位名（CR 严重 1）', async () => {
    const s = useUserPositionStore()
    // 列表里没有新专家 9（用户没拉过列表 / 设置页入口列表未含该专家）
    s.positions = [{ id: 1, name: '小赫', jobTag: 'HR' }]
    rebindPosition.mockResolvedValue({ changed: true, oldPositionId: 1, newPositionId: 9 })

    // preview.targetExpert 形如契约 { positionId, name, jobTag }（无 avatar）
    await s.rebind(9, { positionId: 9, name: '财务小算', jobTag: '财务' })

    // 主绑定专家用真实名，而非「我的专家」占位
    expect(s.currentPosition).toEqual({ id: 9, name: '财务小算', jobTag: '财务', avatar: null })
    // Chat 头部数据源 activePosition 同样为真实名
    expect(chatSetActivePosition).toHaveBeenCalledWith({
      positionId: 9,
      name: '财务小算',
      avatar: null,
      jobTag: '财务'
    })
  })

  it('列表缺新专家且 targetExpert 也无 name：退化为占位名「我的搭子」', async () => {
    const s = useUserPositionStore()
    s.positions = [{ id: 1, name: '小赫' }]
    rebindPosition.mockResolvedValue({ changed: true, oldPositionId: 1, newPositionId: 9 })

    await s.rebind(9, { positionId: 9 })

    expect(s.currentPosition).toEqual({ id: 9, name: '我的搭子', jobTag: '', avatar: null })
  })

  it('列表已有新专家：优先用列表对象，targetExpert 不覆盖列表的 avatar', async () => {
    const s = useUserPositionStore()
    s.positions = [
      { id: 1, name: '小赫', jobTag: 'HR', avatar: 'a1' },
      { id: 2, name: '小图', jobTag: 'IT', avatar: 'a2' }
    ]
    rebindPosition.mockResolvedValue({ changed: true, oldPositionId: 1, newPositionId: 2 })

    // 即便传了 targetExpert，列表命中时仍以列表对象为准（含 avatar）
    await s.rebind(2, { positionId: 2, name: '小图', jobTag: 'IT' })

    expect(s.currentPosition).toEqual({ id: 2, name: '小图', jobTag: 'IT', avatar: 'a2' })
  })

  it('幂等空操作（changed=false，选回当前）：不刷新任何 store', async () => {
    const s = useUserPositionStore()
    s.positions = [{ id: 1, name: '小赫' }]
    rebindPosition.mockResolvedValue({ changed: false, oldPositionId: 1, newPositionId: 1 })

    const result = await s.rebind(1)

    expect(result.changed).toBe(false)
    expect(markBoundPosition).not.toHaveBeenCalled()
    expect(chatReset).not.toHaveBeenCalled()
    expect(chatSetActivePosition).not.toHaveBeenCalled()
  })

  it('rebind 失败：异常抛出，不改任何本地状态（旧专家完好）', async () => {
    const s = useUserPositionStore()
    s.positions = [{ id: 1, name: '小赫' }]
    s.setCurrentPosition(s.positions[0])
    rebindPosition.mockRejectedValue({ code: 1000 })

    await expect(s.rebind(2)).rejects.toBeTruthy()
    // 旧主专家保持不变，未触发任何刷新
    expect(s.currentPosition).toEqual({ id: 1, name: '小赫' })
    expect(markBoundPosition).not.toHaveBeenCalled()
    expect(chatReset).not.toHaveBeenCalled()
  })

  it('previewRebind 透传 getRebindPreview', async () => {
    const s = useUserPositionStore()
    getRebindPreview.mockResolvedValue({ targetExpert: { positionId: 2 } })
    const r = await s.previewRebind(2)
    expect(getRebindPreview).toHaveBeenCalledWith(2)
    expect(r.targetExpert.positionId).toBe(2)
  })

  it('previewUnbind 透传 getUnbindPreview（无入参）', async () => {
    const s = useUserPositionStore()
    getUnbindPreview.mockResolvedValue({ targetExpert: null, currentExpert: { positionId: 1 } })
    const r = await s.previewUnbind()
    expect(getUnbindPreview).toHaveBeenCalledOnce()
    expect(r.targetExpert).toBeNull()
  })
})

describe('position store · unbind 解绑动作', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    unbindPosition.mockReset()
    markBoundPosition.mockReset()
    chatReset.mockReset()
    routerReplace.mockReset()
    currentRouteName.value = 'Settings'
  })

  it('解绑成功（changed=true）：调 unbind API → 清绑定标记+主专家+会话 → 跳 BindPosition', async () => {
    const s = useUserPositionStore()
    s.setCurrentPosition({ id: 1, name: '小赫' })
    unbindPosition.mockResolvedValue({
      changed: true,
      unboundPositionId: 1,
      clearedFieldOverride: true,
      clearedSkillOverrideCount: 2
    })

    const result = await s.unbind()

    expect(unbindPosition).toHaveBeenCalledOnce()
    // 清登录态绑定标记到 null（使 guard「未绑定」判定生效）
    expect(markBoundPosition).toHaveBeenCalledWith(null)
    // 主绑定专家清空
    expect(s.currentPosition).toBeNull()
    // 会话上下文清空
    expect(chatReset).toHaveBeenCalledOnce()
    // 强制回选专家页
    expect(routerReplace).toHaveBeenCalledWith({ name: 'BindPosition' })
    expect(result.changed).toBe(true)
  })

  it('本就无绑定（changed=false）：按「已解绑」处理，同样清态 + 跳 BindPosition，不报错', async () => {
    const s = useUserPositionStore()
    unbindPosition.mockResolvedValue({ changed: false, unboundPositionId: null })

    const result = await s.unbind()

    expect(markBoundPosition).toHaveBeenCalledWith(null)
    expect(s.currentPosition).toBeNull()
    expect(chatReset).toHaveBeenCalledOnce()
    expect(routerReplace).toHaveBeenCalledWith({ name: 'BindPosition' })
    expect(result.changed).toBe(false)
  })

  it('已在 BindPosition 页时不重复 replace（防循环跳转）', async () => {
    const s = useUserPositionStore()
    currentRouteName.value = 'BindPosition'
    unbindPosition.mockResolvedValue({ changed: true, unboundPositionId: 1 })

    await s.unbind()

    // 仍清态，但不重复跳转
    expect(markBoundPosition).toHaveBeenCalledWith(null)
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('解绑失败：异常抛出，不改任何本地状态（当前专家完好）', async () => {
    const s = useUserPositionStore()
    s.setCurrentPosition({ id: 1, name: '小赫' })
    unbindPosition.mockRejectedValue({ code: 5000 })

    await expect(s.unbind()).rejects.toBeTruthy()
    // 失败不清态、不跳转
    expect(s.currentPosition).toEqual({ id: 1, name: '小赫' })
    expect(markBoundPosition).not.toHaveBeenCalled()
    expect(chatReset).not.toHaveBeenCalled()
    expect(routerReplace).not.toHaveBeenCalled()
  })
})

describe('position store · fetchPositions / bind 基础动作', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listPositions.mockReset()
    bindPositionApi.mockReset()
    markBoundPosition.mockReset()
  })

  it('fetchPositions 成功：写入 positions，loading 全程收口 false；返回 null 兜底 []', async () => {
    const s = useUserPositionStore()
    listPositions.mockResolvedValue([
      { id: 1, name: '小赫', jobTag: 'HR' },
      { id: 2, name: '小图', jobTag: 'IT' }
    ])
    const p = s.fetchPositions()
    expect(s.loading).toBe(true) // 拉取中 loading 置位
    await p
    expect(listPositions).toHaveBeenCalledOnce()
    expect(s.positions).toEqual([
      { id: 1, name: '小赫', jobTag: 'HR' },
      { id: 2, name: '小图', jobTag: 'IT' }
    ])
    expect(s.loading).toBe(false)
    // 返回 null → 兜底空数组，不外泄 null
    listPositions.mockResolvedValue(null)
    await s.fetchPositions()
    expect(s.positions).toEqual([])
    expect(s.loading).toBe(false)
  })

  it('bind 成功：调 bindPosition(id) → currentPosition 取列表命中项 + 登录态 markBoundPosition 同步', async () => {
    const s = useUserPositionStore()
    s.positions = [
      { id: 1, name: '小赫', jobTag: 'HR' },
      { id: 2, name: '小图', jobTag: 'IT' }
    ]
    bindPositionApi.mockResolvedValue({ boundPositionId: 2 })

    await s.bind(2)

    expect(bindPositionApi).toHaveBeenCalledWith(2)
    expect(s.currentPosition).toEqual({ id: 2, name: '小图', jobTag: 'IT' })
    expect(markBoundPosition).toHaveBeenCalledWith(2)
  })
})
