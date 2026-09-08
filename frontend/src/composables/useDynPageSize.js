import { ref, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'

/**
 * 每页条数按窗口高度动态计算（2026-09-08 原型复刻批次 1 · A7 / G-1 / G#2）。
 *
 * 【来源】原型 L146 / L1546 `dynPageSize()`：
 *   n = floor((innerHeight - 330) / 62)，夹在 5–30 之间（330 ≈ 页头 + 工具栏 + 表头 + 分页条，62 ≈ 行高）。
 *   900 高窗口 ≈ 9 条，1080 ≈ 12 条。
 * 负责人拍板（工作清单第七节第 3 条）：全站所有列表页统一走这套，md 写「不分页 / 固定 10 条」的页面也分页。
 *
 * 【与原型的差别（处理逻辑由前端统筹）】原型只在 render 时读一次高度，窗口尺寸变化不重算；
 * 这里 mounted 读一次 + resize 防抖 200ms 重算（值真的变了才更新，避免无意义重拉）。
 * 由 useAdminList 消费：pageSize 变化即回第 1 页重拉（见该文件）。
 *
 * 非组件上下文（单测直接调用）也可用：无 onMounted 时立即算一次，不挂监听。
 *
 * @param {Object} [options]
 * @param {number} [options.min=5]
 * @param {number} [options.max=30]
 * @param {number} [options.reserved=330] 非表格区高度
 * @param {number} [options.rowHeight=62]
 * @returns {import('vue').Ref<number>} 每页条数（响应式）
 */
export const DYN_PAGE_MIN = 5
export const DYN_PAGE_MAX = 30
export const DYN_PAGE_RESERVED = 330
export const DYN_PAGE_ROW = 62
/** 无 window（SSR / node 单测）时的兜底高度：原型 L1546 `window.innerHeight||900` */
const FALLBACK_HEIGHT = 900

/** 纯函数：按高度算条数（原型同式），供单测与非响应式场景直接调用。 */
export function computeDynPageSize(innerHeight, options = {}) {
  const { min = DYN_PAGE_MIN, max = DYN_PAGE_MAX, reserved = DYN_PAGE_RESERVED, rowHeight = DYN_PAGE_ROW } = options
  const h = Number(innerHeight) > 0 ? Number(innerHeight) : FALLBACK_HEIGHT
  const n = Math.floor((h - reserved) / rowHeight)
  return Math.min(max, Math.max(min, n || 10))
}

function readHeight() {
  if (typeof window === 'undefined') return FALLBACK_HEIGHT
  return window.innerHeight || FALLBACK_HEIGHT
}

export function useDynPageSize(options = {}) {
  const size = ref(computeDynPageSize(readHeight(), options))

  function recompute() {
    const next = computeDynPageSize(readHeight(), options)
    if (next !== size.value) size.value = next
  }

  // 仅在组件 setup 内挂生命周期；纯函数式调用（单测 / 非组件）跳过，避免 Vue 警告
  if (getCurrentInstance() && typeof window !== 'undefined') {
    let timer = null
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(recompute, 200)
    }
    onMounted(() => {
      recompute()
      window.addEventListener('resize', onResize)
    })
    onBeforeUnmount(() => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    })
  }

  return size
}
