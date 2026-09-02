import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  listMemories,
  getMemoryDetail,
  updateMemory as apiUpdateMemory,
  deleteMemoryItem,
  getMemoryTypes
} from '@/api/memory'

// 乐观锁版本冲突错误码（契约）：编辑提交时若返回此码 → 提示并重拉详情
export const CODE_VERSION_CONFLICT = 2006

// 列表只查 active（契约：不做归档，status 恒为 active，不暴露为可变筛选项）
const STATUS_ACTIVE = 'active'

// 来源类型友好化（sourceType → 中文）。未命中回退原值，保证不向用户暴露生硬枚举。
export const SOURCE_TYPE_LABEL = {
  chat_extract: '对话抽取',
  chat: '对话抽取',
  extract: '对话抽取',
  manual: '手动',
  user: '手动',
  system: '系统'
}

export function sourceTypeLabel(src) {
  if (!src) return '-'
  return SOURCE_TYPE_LABEL[String(src).toLowerCase()] || src
}

/**
 * 个人记忆状态管理：列表 / 筛选 / 分页 / 类型字典 / 详情 / 编辑 / 删除。
 *
 * 范式参照 stores/space.js：筛选变更时 page 复位为 1 再 loadList。
 * 状态默认 active（不做归档，status 不暴露为可变筛选项）。
 */
export const useMemoryStore = defineStore('memory', () => {
  /* ---------------- 列表态 ---------------- */
  const list = ref([])
  const total = ref(0)
  const page = ref(1)
  const size = ref(20)
  const keyword = ref('')
  const memoryType = ref('') // '' = 全部
  const loading = ref(false)
  const error = ref(false)

  /* ---------------- 类型字典 ---------------- */
  const types = ref([]) // [{ code, label }]
  const typeLabelMap = ref({}) // code -> label，列表/详情取中文 label 用

  function rebuildTypeMap() {
    const m = {}
    for (const t of types.value) m[t.code] = t.label
    typeLabelMap.value = m
  }

  // 取某记忆类型 code 的中文 label（一律来自字典，无字典命中回退原 code）
  function typeLabel(code) {
    if (!code) return ''
    return typeLabelMap.value[code] || code
  }

  /* ============================ 类型字典 ============================ */

  async function loadTypes() {
    // 已加载过则不重复请求（字典基本不变）
    if (types.value.length > 0) return types.value
    try {
      const data = await getMemoryTypes()
      types.value = Array.isArray(data) ? data : []
      rebuildTypeMap()
    } catch (e) {
      /* 字典读失败：拦截器已提示，列表类型列回退展示原 code */
    }
    return types.value
  }

  /* ============================ 列表 ============================ */

  async function loadList() {
    loading.value = true
    error.value = false
    try {
      const data = await listMemories({
        keyword: keyword.value || undefined,
        memoryType: memoryType.value || undefined,
        status: STATUS_ACTIVE,
        page: page.value,
        size: size.value
      })
      list.value = data?.list || []
      total.value = data?.total || 0
    } catch (e) {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  // 设置筛选（类型 / 关键词）→ page 复位为 1 再重拉
  function setFilters({ keyword: kw, memoryType: mt } = {}) {
    if (kw !== undefined) keyword.value = kw
    if (mt !== undefined) memoryType.value = mt
    page.value = 1
    return loadList()
  }

  function setPage(p) {
    page.value = p
    return loadList()
  }

  /* ============================ 详情 ============================ */

  async function fetchDetail(id) {
    return getMemoryDetail(id)
  }

  /* ============================ 编辑 ============================ */

  /**
   * 提交编辑。成功后重拉当前页列表。
   * 抛出的 ApiError.code === CODE_VERSION_CONFLICT(2006) 表示乐观锁冲突，
   * 调用方需提示「记忆已变更，请刷新后重试」并重拉详情。
   * @returns {Promise<object>} 更新后的 MemoryDetailVO
   */
  async function updateMemory(id, body) {
    const updated = await apiUpdateMemory(id, body)
    await loadList()
    return updated
  }

  /* ============================ 删除 ============================ */

  // 删除一条（逻辑删）。页面负责二次确认。删到当前页最后一条且非首页时回退一页。
  async function removeMemory(id) {
    await deleteMemoryItem(id)
    if (list.value.length === 1 && String(list.value[0]?.id) === String(id) && page.value > 1) {
      page.value -= 1
    }
    await loadList()
    return true
  }

  return {
    // 列表态
    list,
    total,
    page,
    size,
    keyword,
    memoryType,
    loading,
    error,
    // 类型字典
    types,
    typeLabelMap,
    typeLabel,
    loadTypes,
    // 操作
    loadList,
    setFilters,
    setPage,
    fetchDetail,
    updateMemory,
    removeMemory
  }
})
