import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { useAdminList } from '@/composables/useAdminList'

/**
 * useAdminList（管理后台列表取数编排）行为契约。
 *
 * 这层抽象要替 16 个列表页兜住四件事，逐一钉住：
 *  1. 四态编排（loading / loadError / rows / total）与响应解包（{list,total} 与裸数组同兼容）；
 *  2. 分页参数下发与 paged:false 时的不下发；
 *  3. **防空页回退**——改造前仅 1 个页面做对，抽象后须所有页面白捡；
 *  4. **竞态防护**——改造前 0 个页面做对：慢的旧响应不得覆盖快的新响应。
 * 3、4 是本抽象的主要收益，写错了比不抽象更糟（会以"已统一"的名义把 bug 铺到 16 个页面）。
 */

/** 造一个可控延迟的 fetcher，用于竞态场景。 */
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('useAdminList · 列表取数编排契约', () => {
  it('取数成功：解包 {list,total}，四态归位', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ list: [{ id: 1 }], total: 7 }))
    const l = useAdminList(fetcher)

    await l.reload()

    expect(l.rows.value).toEqual([{ id: 1 }])
    expect(l.total.value).toBe(7)
    expect(l.loading.value).toBe(false)
    expect(l.loadError.value).toBe(false)
  })

  it('解包兼容裸数组（后端返数组时 total 取长度）', async () => {
    const fetcher = vi.fn(() => Promise.resolve([{ id: 1 }, { id: 2 }]))
    const l = useAdminList(fetcher, { paged: false })

    await l.reload()

    expect(l.rows.value).toHaveLength(2)
    expect(l.total.value).toBe(2)
  })

  it('取数失败：置 loadError 且关 loading（不把异常抛给调用方）', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('boom')))
    const l = useAdminList(fetcher)

    await l.reload()

    expect(l.loadError.value).toBe(true)
    expect(l.loading.value).toBe(false)
    expect(l.rows.value).toEqual([])
  })

  it('分页页面下发 page/size；paged:false 不下发', async () => {
    const paged = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
    await useAdminList(paged, { pageSize: 20 }).reload()
    expect(paged).toHaveBeenCalledWith({ page: 1, size: 20 })

    const unpaged = vi.fn(() => Promise.resolve([]))
    await useAdminList(unpaged, { paged: false }).reload()
    expect(unpaged).toHaveBeenCalledWith({})
  })

  it('空筛选项不入参（空串/undefined/null 一律不下发）', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
    const l = useAdminList(fetcher, {
      params: () => ({ keyword: '', status: undefined, role: null, purpose: 'SELF' })
    })

    await l.reload()

    expect(fetcher).toHaveBeenCalledWith({ purpose: 'SELF', page: 1, size: 20 })
  })

  it('search() 回第 1 页再取数（改筛选后不停在空的第 N 页）', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ list: [{ id: 1 }], total: 1 }))
    const l = useAdminList(fetcher)
    l.page.value = 5

    await l.search()

    expect(l.page.value).toBe(1)
    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 20 })
  })

  // ---------------- 主要收益 1：防空页回退 ----------------

  /**
   * 末页删最后一条 → 当前页空但 total>0 → 自动回退一页重拉。
   * 改造前仅 AdminExperts 做了，其余 12 个分页页面都会停在空页。
   */
  it('防空页：当前页空而 total>0 时回退一页重拉', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ list: [], total: 10 }) // 第 2 页已空
      .mockResolvedValueOnce({ list: [{ id: 1 }], total: 10 }) // 回退到第 1 页有数据
    const l = useAdminList(fetcher, { pageSize: 10 })
    l.page.value = 2

    await l.reload()

    expect(l.page.value).toBe(1)
    expect(l.rows.value).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    // 回退重拉后 loading 必须关闭——递归调用曾让外层 finally 判定失效而漏关
    expect(l.loading.value).toBe(false)
  })

  it('防空页不误触发：第 1 页本来就空（total=0）时不回退、不重拉', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
    const l = useAdminList(fetcher)

    await l.reload()

    expect(l.page.value).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(l.isEmpty.value).toBe(true)
  })

  // ---------------- 主要收益 2：竞态防护 ----------------

  /**
   * 快速切筛选：先发的慢响应回来时，不得覆盖后发的快响应。
   * 改造前 0 个页面做防护——列表内容会与当前筛选条件对不上。
   */
  it('竞态：先发的慢响应不得覆盖后发的快响应', async () => {
    const slow = deferred()
    const fast = deferred()
    const fetcher = vi.fn()
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const l = useAdminList(fetcher)

    const p1 = l.reload() // 慢请求（先发）
    const p2 = l.reload() // 快请求（后发）

    fast.resolve({ list: [{ id: 'NEW' }], total: 1 })
    await p2
    expect(l.rows.value).toEqual([{ id: 'NEW' }])

    slow.resolve({ list: [{ id: 'OLD' }], total: 99 })
    await p1

    expect(l.rows.value, '旧响应不得覆盖新响应').toEqual([{ id: 'NEW' }])
    expect(l.total.value).toBe(1)
    expect(l.loading.value).toBe(false)
  })

  it('竞态：过期请求失败也不得把 loadError 打给当前请求', async () => {
    const slow = deferred()
    const fast = deferred()
    const fetcher = vi.fn()
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const l = useAdminList(fetcher)

    const p1 = l.reload()
    const p2 = l.reload()

    fast.resolve({ list: [{ id: 'NEW' }], total: 1 })
    await p2

    slow.resolve(Promise.reject(new Error('过期请求失败')))
    await p1.catch(() => {})
    await nextTick()

    expect(l.loadError.value, '过期请求的失败不该影响当前展示').toBe(false)
    expect(l.rows.value).toEqual([{ id: 'NEW' }])
  })

  it('mapRow 对行数据做后处理', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ list: [{ id: 1 }], total: 1 }))
    const l = useAdminList(fetcher, {
      paged: false,
      mapRow: (rows) => rows.map((r) => ({ ...r, tag: 'X' }))
    })

    await l.reload()

    expect(l.rows.value).toEqual([{ id: 1, tag: 'X' }])
  })
})
