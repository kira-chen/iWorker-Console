import { ref, computed } from 'vue'

/**
 * 管理后台列表页「取数编排」单一真相源（2026-08-22 统一）。
 *
 * 【解决什么】改造前 16 个列表页各写各的 fetchList，骨架靠复制粘贴传播——实测：
 *   完全相同的 `catch (e) { loadError.value = true }` 出现 18 次、
 *   完全相同的「加载失败 + 重试」模板出现 15 次；
 *   而复制必然漂移，已漂出：分页状态两套命名（page/pageSize 与 currentPage/PAGE_SIZE）、
 *   每页条数四种（10/12/20/无分页）、响应解包两种口径（是否兼容裸数组）。
 *   同 tableLayout.js 当初收敛列宽的处境：新增页面只能靠"抄旁边那页"，偏差持续累积。
 *
 * 【为什么是 composable 而不是组件】列表页的差异在**列定义与行内操作**（每页都不同，
 * 不该被组件框死），共性在**取数编排**（四态 + 分页 + 筛选联动）。故收编排、放渲染：
 * 页面继续自己写 <el-table> 与列，只把"怎么取数"交出来。
 *
 * 【顺带修掉的两个只有一处做对的事】——抽象的真正收益不在消重复，在于把散落的正确做法变成默认：
 *   1. **防空页回退**：删掉末页最后一条后，原地会停在空页。改造前仅 AdminExperts 做了回退重拉，
 *      其余 12 个分页页面都有此问题；收进来后所有页面白捡。
 *   2. **竞态防护**：快速切筛选时，先发的慢响应会覆盖后发的快响应，列表显示与筛选条件对不上。
 *      改造前**一个页面都没做**。此处用请求序号（reqSeq）丢弃过期响应。
 *
 * 【默认每页 20】负责人 2026-08-22 定。1440×900 下一屏约容 15–18 行，20 条微滚即看完；
 * 后台多为"扫一遍找某行"，条数多一点优于频繁翻页。个别页面可传 pageSize 覆盖。
 *
 * 用法（分页页面）：
 *   const query = reactive({ keyword: '', status: '' })
 *   const list = useAdminList(listUsers, { params: () => ({ ...query }) })
 *   onMounted(list.reload)
 *   // 模板：list.rows / list.loading / list.loadError / list.page / list.total
 *   // 改筛选：list.search()（自动回第 1 页）；翻页：list.page = n 后 list.reload()
 *
 * 用法（不分页页面，如角色/模型）：
 *   const list = useAdminList(listRoles, { paged: false })
 *
 * @param {(params:Object)=>Promise<any>} fetcher 取数函数（api 层方法，返回 {list,total} 或裸数组）
 * @param {Object} [options]
 * @param {()=>Object} [options.params] 额外查询参数（筛选项），每次取数时求值
 * @param {number} [options.pageSize=20] 每页条数
 * @param {boolean} [options.paged=true] 是否分页；false 时不下发 page/size，也不做空页回退
 * @param {(rows:Array)=>Array} [options.mapRow] 行数据后处理（如字段归一化）
 */
export function useAdminList(fetcher, options = {}) {
  const { params, pageSize: initialPageSize = 20, paged = true, mapRow } = options

  const rows = ref([])
  const total = ref(0)
  const loading = ref(true)
  const loadError = ref(false)
  const page = ref(1)
  const pageSize = ref(initialPageSize)

  // 请求序号：只认最后一次发起的请求，丢弃过期响应（防快速切筛选时旧响应覆盖新响应）。
  let reqSeq = 0

  /**
   * 解包响应：统一兼容 `{list,total}` 与裸数组两种形态。
   * 改造前各页两种口径并存（多数只认 data.list，AdminModels 额外兼容裸数组），
   * 此处取并集——后端换形态时页面不必逐个跟改。
   */
  function unwrap(data) {
    const list = Array.isArray(data) ? data : data?.list || []
    const count = Array.isArray(data) ? data.length : data?.total ?? list.length
    return { list, count }
  }

  async function reload() {
    const seq = ++reqSeq
    loading.value = true
    loadError.value = false
    try {
      const extra = typeof params === 'function' ? params() : {}
      // 只下发有值的筛选项：空串/undefined 不入参，避免后端把空串当有效筛选条件
      const query = {}
      for (const [k, v] of Object.entries(extra || {})) {
        if (v !== '' && v !== undefined && v !== null) query[k] = v
      }
      if (paged) {
        query.page = page.value
        query.size = pageSize.value
      }

      const data = await fetcher(query)
      if (seq !== reqSeq) return // 过期响应：已有更新的请求在飞，丢弃

      const { list, count } = unwrap(data)
      rows.value = mapRow ? mapRow(list) : list
      total.value = count

      // 防空页：删到当前页无数据时回退一页重拉（末页删最后一条的常见场景）。
      if (paged && !rows.value.length && total.value > 0 && page.value > 1) {
        page.value -= 1
        await reload()
      }
    } catch (e) {
      if (seq !== reqSeq) return
      loadError.value = true
    } finally {
      // 仅最后一次请求负责关 loading，避免过期响应提前熄灯导致闪烁
      if (seq === reqSeq) loading.value = false
    }
  }

  /** 改筛选后重查：回第 1 页再取数（页面各自手写时最易漏这一步，漏了会停在空的第 N 页）。 */
  function search() {
    page.value = 1
    return reload()
  }

  /** 翻页：设页码并取数（供 el-pagination 的 @current-change 直接绑）。 */
  function goPage(n) {
    page.value = n
    return reload()
  }

  /** 列表为空且非加载中、非错误——用于区分「真的没数据」与「还没取到/取失败」。 */
  const isEmpty = computed(() => !loading.value && !loadError.value && !rows.value.length)

  return {
    rows,
    total,
    loading,
    loadError,
    page,
    pageSize,
    isEmpty,
    reload,
    search,
    goPage
  }
}
