import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCompanionStore, DEFAULT_NICKNAME } from '@/stores/companion'

// 搭子名称（buddyName）前端持久化 store。US-6 个性化页「搭子名称」编辑依赖它做就近缓存，
// 保证对话头部即时刷新；键含 userId + positionId，做到各岗位搭子独立命名。

describe('companion store（搭子名称持久化）', () => {
  let mem

  beforeEach(() => {
    setActivePinia(createPinia())
    // 用内存对象模拟 localStorage（jsdom 下未启用 --localstorage-file）
    mem = {}
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => {
        mem[k] = String(v)
      },
      removeItem: (k) => {
        delete mem[k]
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('未设置时返回默认昵称「小助」', () => {
    const store = useCompanionStore()
    expect(store.getNickname(1, 10)).toBe(DEFAULT_NICKNAME)
  })

  it('setNickname 写入后 getNickname 读回同一值', () => {
    const store = useCompanionStore()
    const saved = store.setNickname(1, 10, '小蓝')
    expect(saved).toBe('小蓝')
    expect(store.getNickname(1, 10)).toBe('小蓝')
  })

  it('同一用户不同搭子各自独立命名', () => {
    const store = useCompanionStore()
    store.setNickname(1, 10, '小蓝')
    store.setNickname(1, 20, '小绿')
    expect(store.getNickname(1, 10)).toBe('小蓝')
    expect(store.getNickname(1, 20)).toBe('小绿')
  })

  it('空白名字回退默认', () => {
    const store = useCompanionStore()
    expect(store.setNickname(1, 10, '   ')).toBe(DEFAULT_NICKNAME)
    expect(store.getNickname(1, 10)).toBe(DEFAULT_NICKNAME)
  })

  it('userId/positionId 缺省时用稳定兜底键，不抛错', () => {
    const store = useCompanionStore()
    expect(() => store.setNickname(undefined, undefined, '小白')).not.toThrow()
    expect(store.getNickname(undefined, undefined)).toBe('小白')
  })
})
