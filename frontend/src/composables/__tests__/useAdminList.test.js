import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { useAdminList } from '@/composables/useAdminList'
import { computeDynPageSize, DYN_PAGE_MIN, DYN_PAGE_MAX } from '@/composables/useDynPageSize'

/**
 * useAdminList（管理后台列表取数编排）行为契约。
 *
 * 这层抽象要替 16 个列表页兜住四件事，逐一钉住：
 *  1. 四态编排（loading / loadError / rows / total）与响应解包（{list,total} 与裸数组同兼容）；
 *  2. 分页参数下发与 paged:false 时的不下发；
 *  3. **防空页回退**——改造前仅 1 个页面做对，抽象后须所有页面白捡；
 *  4. **竞态防护**——改造前 0 个页面做对：慢的旧响应不得覆盖快的新响应。
 * 3、4 是本抽象的主要收益，写错了比不抽象更糟（会以"已统一"的名义把 bug 铺到 16 个页面）。
 *
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位管理/prd.岗位管理.md L48「根据页面可用高度动态计算
 * 每页条数，最少 5 条、最多 30 条，窗口尺寸变化后按新高度重新计算」与 03能力/连接器/MCP/prd-连接器-MCP.md L167
 * 「每页条数按窗口高度动态计算，与平台其余列表页采用同一套分页策略」：默认每页条数走 useDynPageSize
 * `min(30,max(5,floor((h-330)/62)))`，node 环境无 window → 兜底 900 高 → 9 条；
 * paged:'client' 本地切片模式（mock 返全量的角色 / 模型 / 业务系统页）。
 * （原头注「原型 L1546」——原型已退场，出处改记 md。）
 *
 * 2026-09-12 审计 T57 补：watch(pageSize) 回第 1 页重拉、首拉前改 pageSize 不取数、服务端分页越界一步钳到末页。
 */

/** node 环境下的动态默认条数（无 window → 900 高兜底） */
const DYN_DEFAULT = computeDynPageSize(undefined)

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

    expect(fetcher).toHaveBeenCalledWith({ purpose: 'SELF', page: 1, size: DYN_DEFAULT })
  })

  it('search() 回第 1 页再取数（改筛选后不停在空的第 N 页）', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ list: [{ id: 1 }], total: 1 }))
    const l = useAdminList(fetcher)
    l.page.value = 5

    await l.search()

    expect(l.page.value).toBe(1)
    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: DYN_DEFAULT })
  })

  // ---------------- 2026-09-08 原型复刻批次 1：动态条数 + 本地切片 ----------------

  it('默认每页条数按窗口高度动态计算（原型 dynPageSize 同式，夹在 5–30）', () => {
    expect(computeDynPageSize(900)).toBe(9) // floor((900-330)/62)=9
    expect(computeDynPageSize(1080)).toBe(12)
    expect(computeDynPageSize(400)).toBe(DYN_PAGE_MIN) // 太矮 → 下限 5
    expect(computeDynPageSize(5000)).toBe(DYN_PAGE_MAX) // 太高 → 上限 30
    expect(computeDynPageSize(undefined)).toBe(9) // 无 window → 900 兜底
    expect(useAdminList(vi.fn()).pageSize.value).toBe(DYN_DEFAULT)
  })

  it("paged:'client'：不下发 page/size，取回全量后本地切片，total 取全量长度", async () => {
    const all = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }))
    const fetcher = vi.fn(() => Promise.resolve({ list: all, total: 7 }))
    const l = useAdminList(fetcher, { paged: 'client', pageSize: 3 })

    await l.reload()
    expect(fetcher).toHaveBeenCalledWith({})
    expect(l.rows.value.map((r) => r.id)).toEqual([1, 2, 3])
    expect(l.total.value).toBe(7)

    await l.goPage(3)
    expect(l.rows.value.map((r) => r.id)).toEqual([7])

    // 页码越界（删到只剩 1 页）→ 回落到末页而不是空页
    l.page.value = 9
    await l.reload()
    expect(l.page.value).toBe(3)
    expect(l.rows.value).toHaveLength(1)
  })

  it("paged:'client'：clientPipeline 在切片前作用于全量（本地筛选/排序不能只作用于当页）", async () => {
    const all = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: i % 2 ? 'odd' : 'even' }))
    const fetcher = vi.fn(() => Promise.resolve(all))
    const l = useAdminList(fetcher, {
      paged: 'client',
      pageSize: 2,
      clientPipeline: (rows) => rows.filter((r) => r.name === 'odd').reverse()
    })

    await l.reload()
    expect(l.total.value).toBe(3)
    expect(l.rows.value.map((r) => r.id)).toEqual([6, 4])
    await l.goPage(2)
    expect(l.rows.value.map((r) => r.id)).toEqual([2])
  })

  // ---------------- 每页条数变化（窗口 resize / 分页条下拉）→ 回第 1 页重拉 ----------------

  /**
   * 岗位管理 md L48「窗口尺寸变化后按新高度重新计算」+ 分页条下拉选档（ListPagination v-model:page-size）
   * 都落到同一个 pageSize ref；条数一变即回第 1 页重拉（useAdminList.js:150-153），停在第 3 页会错位。
   */
  it('已取过数后改 pageSize（如 resize 后 9→20）→ 自动回第 1 页并按新条数重拉', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ list: [{ id: 1 }], total: 40 }))
    const l = useAdminList(fetcher) // 不传 pageSize：走动态 ref，watch 才挂
    await l.reload()
    await l.goPage(3)
    expect(fetcher).toHaveBeenLastCalledWith({ page: 3, size: DYN_DEFAULT })

    l.pageSize.value = 20
    await nextTick()
    await nextTick() // watch 回调触发的 search() 内部 await fetcher

    expect(l.page.value).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 20 })
  })

  it('首拉前改 pageSize（mounted 时按窗口重算）→ 不取数（页面 onMounted 的 reload 才是首拉）', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
    const l = useAdminList(fetcher)

    l.pageSize.value = 20
    await nextTick()
    await nextTick()

    expect(fetcher).not.toHaveBeenCalled()
    expect(l.loading.value, '首拉前保持初始 loading 态（骨架屏）').toBe(true)
  })

  it('固定 pageSize（单测钉值）不挂 watch：改它不触发重拉', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ list: [{ id: 1 }], total: 1 }))
    const l = useAdminList(fetcher, { pageSize: 10 })
    await l.reload()

    l.pageSize.value = 20
    await nextTick()
    await nextTick()

    expect(fetcher).toHaveBeenCalledTimes(1)
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

  /**
   * 岗位管理 md §3.1「改筛选不重置分页」：保留页码时可能越界（第 5 页但只剩 3 页）。
   * 一步钳到末页（useAdminList.js:120-124），不是逐页回退——fetcher 恰好 2 次，且落在末页而非第 4 页。
   */
  it('服务端分页越界（第 5 页但 total 只够 3 页）→ 一步钳到末页重拉，fetcher 恰 2 次', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ list: [], total: 25 }) // 第 5 页：已越界，空
      .mockResolvedValueOnce({ list: [{ id: 21 }], total: 25 }) // 钳到第 3 页有数据
    const l = useAdminList(fetcher, { pageSize: 10 })
    l.page.value = 5

    await l.reload()

    expect(l.page.value).toBe(3)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenLastCalledWith({ page: 3, size: 10 })
    expect(l.rows.value).toEqual([{ id: 21 }])
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
