import { computed, onMounted, ref } from 'vue'
import { useAdminList } from './useAdminList'

/**
 * 工具调用审计各页签的「取数 + 时间范围 + 排序 + 搜索」编排（2026-09-28 拆页签时从单页抽出）。
 *
 * 【解决什么】工具调用审计有三个页签（技能调用 / 岗位自动化任务 / 知识库检索），
 * 三页的列、统计卡片、详情都不同，但「时间范围规则 + 按请求时间排序 + 关键词搜索 +
 * 本地筛选后分页」完全一样。这里收编排、留差异：页签自己只需要说清两件事——
 *   matches(record)   除时间和关键词之外，本页签的筛选条件（结果 / 性质 / 数据源类型…）
 *   keywordOf(record) 关键词要在哪些字段里搜
 *
 * 【时间范围口径】与访问审计一致（PRD 访问审计 §三）：默认展示今天向前 90 天（含当天），
 * 用户单次最多可选 30 天跨度——点选起始日期后，距它超过 30 天的日期置灰，两端选定后解除。
 *
 * 【统计卡片的数据源】统计卡片要同步计算，而 fetcher 是异步的，所以卡片直接对常量数组
 * records 复用同一套 filterRecords；列表则走 useAdminList 的 paged:'client' 本地分页。
 * 两者口径一致（都是「当前时间范围 + 当前筛选」）。
 *
 * @param {Object} options
 * @param {()=>Promise<Array>} options.fetcher 取数函数（api 层 mock，返回全量）
 * @param {Array} options.records 同一份全量数据的同步引用，供统计卡片与导出使用
 * @param {(record:Object)=>boolean} options.matches 页签自己的筛选条件
 * @param {(record:Object)=>Array<string>} options.keywordOf 关键词搜索的字段
 */
export function useAuditList({ fetcher, records, matches, keywordOf }) {
  /* ── 时间范围 ── */
  const dateRange = ref(defaultRange())
  const pickFirst = ref(null)
  const disabledDate = computed(() => {
    const first = pickFirst.value
    return (d) => (first ? Math.abs(d - first) / 86400000 > 30 : false)
  })
  function onCalendarChange(val) {
    pickFirst.value = val?.[1] ? null : (val?.[0] ?? null)
  }

  /* ── 排序与搜索 ── */
  const sortDir = ref('desc')
  const sortArrow = computed(() => (sortDir.value === 'desc' ? '↓' : '↑'))
  const keyword = ref('')
  const appliedKeyword = ref('')

  function filterRecords(all) {
    const kw = appliedKeyword.value
    const filtered = all.filter((r) =>
      inDateRange(r.date, dateRange.value) &&
      matches(r) &&
      (!kw || keywordOf(r).join(' ').toLowerCase().includes(kw))
    )
    const key = (r) => `${r.date} ${r.time}`
    return [...filtered].sort((a, b) =>
      sortDir.value === 'desc' ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))
    )
  }

  const list = useAdminList(fetcher, { paged: 'client', clientPipeline: filterRecords })
  onMounted(list.reload)

  function toggleSort() {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
    list.search()
  }
  function applySearch() {
    appliedKeyword.value = keyword.value.trim().toLowerCase()
    list.search()
  }
  function onClearSearch() {
    keyword.value = ''
    applySearch()
  }

  /** 当前时间范围 + 筛选后的全量结果（不分页）：统计卡片与导出都用它。 */
  const statsAll = computed(() => filterRecords(records))

  return {
    dateRange, disabledDate, onCalendarChange,
    sortArrow, toggleSort,
    keyword, applySearch, onClearSearch,
    list, statsAll
  }
}

function defaultRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 89)
  return [start, end]
}

function inDateRange(dateStr, range) {
  if (!range?.[0] || !range?.[1]) return true
  const t = new Date(dateStr)
  const s = new Date(range[0]); s.setHours(0, 0, 0, 0)
  const e = new Date(range[1]); e.setHours(23, 59, 59, 999)
  return t >= s && t <= e
}
