// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { useAuditList } from '../useAuditList'

/**
 * useAuditList（工具调用审计各页签 / 用户访问权限操作记录共用的「取数 + 时间范围 + 排序 + 搜索」编排）。
 * - initialKeyword（待办 yuepu#96）：页面带入搜索词时首次取数前就生效，只取一次数；
 * - cardAll（待办 yuepu#92⑯）：统计卡片范围 = 时间范围 + 搜索词，不含页签自己的筛选（matches），statsAll 才含。
 */
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const RECORDS = [
  { id: 1, date: today(), time: '10:00:00', who: '张伟', ok: true },
  { id: 2, date: today(), time: '09:00:00', who: '张浩', ok: false },
  { id: 3, date: today(), time: '08:00:00', who: '李娜', ok: true }
]
const flush = async (n = 6) => { for (let i = 0; i < n; i++) { await Promise.resolve(); await nextTick() } }

function setup(options = {}) {
  const fetcher = vi.fn(async () => RECORDS)
  const filter = reactive({ onlyOk: false })
  let api
  const app = createApp({
    setup() {
      api = useAuditList({
        fetcher,
        records: RECORDS,
        matches: (r) => !filter.onlyOk || r.ok,
        keywordOf: (r) => [r.who],
        ...options
      })
      return () => h('div')
    }
  })
  const el = document.createElement('div')
  app.mount(el)
  return { api, fetcher, filter, unmount: () => app.unmount() }
}

describe('useAuditList · initialKeyword', () => {
  it('带初始搜索词：首次取数只发一次，列表一开始就是按词筛过的', async () => {
    const { api, fetcher, unmount } = setup({ initialKeyword: '张' })
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(api.keyword.value).toBe('张')
    expect(api.list.rows.value.map((r) => r.who)).toEqual(['张伟', '张浩'])
    unmount()
  })

  it('不带初始搜索词：行为不变，全量', async () => {
    const { api, fetcher, unmount } = setup()
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(api.list.rows.value).toHaveLength(3)
    unmount()
  })
})

describe('useAuditList · cardAll 与 statsAll', () => {
  it('页签筛选（matches）只影响 statsAll / 列表，不影响 cardAll；搜索词两者都影响', async () => {
    const { api, filter, unmount } = setup()
    await flush()
    filter.onlyOk = true
    expect(api.statsAll.value.map((r) => r.id)).toEqual([1, 3])
    expect(api.cardAll.value.map((r) => r.id)).toEqual([1, 2, 3])

    api.keyword.value = '张'
    api.applySearch()
    await flush()
    expect(api.cardAll.value.map((r) => r.id)).toEqual([1, 2])
    expect(api.statsAll.value.map((r) => r.id)).toEqual([1])
    unmount()
  })
})
