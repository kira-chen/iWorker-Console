<script setup>
/**
 * 列表页分页条统一封装（2026-08-22 统一；2026-09-08 原型复刻批次 1 · A7 改为原型形态）。
 *
 * 【形态】照原型 L1549 `pagerHtml`：一行右对齐
 *   「共 N 条 · 每页 X 条」 ‹ 1 2 3 ›
 * page-btn 28px 圆角 4、当前页绿软底绿字（样式在 assets/admin-shell.css `.list-pager`，
 * 与原型 DOM 同名便于截图比对）。不再用 el-pagination（其 layout 无法摆出「总数在前 + 每页条数」）。
 *
 * 【单页也显示】负责人拍板（工作清单第七节第 3 条）：分页条恒显——哪怕只有 1 页也渲染
 * 「共 4 条 · 每页 10 条 ‹ 1 ›」；total 为 0（空态）时不渲染（空态由 ListStates 出）。
 * 改造前「total > pageSize 才出」的规则废止。
 *
 * 【页码窗口】原型把全部页码平铺；页数多时（动态条数最小 5 条 → 上百条数据会有二十多页）
 * 平铺会撑爆一行，这里按前端统筹：≤ 7 页全铺，> 7 页保留首尾 + 当前页前后各 1，其余用 …。
 *
 * 【每页条数】由 useAdminList 按窗口高度动态给（useDynPageSize），本组件只展示。
 *
 * 用法（配 useAdminList）：
 *   <ListPagination :total="l.total" v-model:page="l.page" :page-size="l.pageSize"
 *                   @change="l.reload" />
 */
import { computed, ref } from 'vue'

const props = defineProps({
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 },
  /** 条数单位（默认「条」；原型按组分页的场景可传「组」） */
  unit: { type: String, default: '条' }
})
const emit = defineEmits(['update:page', 'update:pageSize', 'change'])

/** 每页条数下拉选项（设计稿「10条/页」）。含当前值以免动态值不在表内时下拉显示空白。 */
const SIZE_OPTIONS = [10, 20, 30, 50]
const sizeOptions = computed(() => {
  const s = new Set([...SIZE_OPTIONS, props.pageSize])
  return [...s].sort((a, b) => a - b)
})
function onSizeChange(v) {
  const n = Number(v)
  if (!n || n === props.pageSize) return
  emit('update:pageSize', n) // useAdminList 侧 watch(pageSize) 会自动回第 1 页重拉
}

/** 跳至第 N 页：回车或失焦提交，越界夹到合法范围（不报错，按设计稿只是个输入框）。 */
const jumpText = ref('')
function onJump() {
  const n = Number(String(jumpText.value).trim())
  jumpText.value = ''
  if (!Number.isFinite(n) || n < 1) return
  go(Math.min(Math.round(n), pages.value))
}

const visible = computed(() => props.total > 0)
const pages = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, props.pageSize))))
const current = computed(() => Math.min(Math.max(1, props.page), pages.value))

/** 页码序列：数字或 '…'（省略占位，key 用前缀区分首尾两处） */
const items = computed(() => {
  const n = pages.value
  const p = current.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => ({ key: i + 1, num: i + 1 }))
  const set = new Set([1, n, p - 1, p, p + 1])
  // 靠边时把窗口补满到 5 个数字，保证按钮数稳定（1 2 3 4 … 20 / 1 … 17 18 19 20）
  if (p <= 3) [2, 3, 4].forEach((x) => set.add(x))
  if (p >= n - 2) [n - 1, n - 2, n - 3].forEach((x) => set.add(x))
  const nums = [...set].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b)
  const out = []
  nums.forEach((x, i) => {
    if (i > 0 && x - nums[i - 1] > 1) out.push({ key: `gap-${x}`, num: null })
    out.push({ key: x, num: x })
  })
  return out
})

function go(n) {
  if (n < 1 || n > pages.value || n === props.page) return
  emit('update:page', n)
  emit('change', n)
}
</script>

<template>
  <div v-if="visible" class="list-pager" role="navigation" aria-label="分页">
    <!-- 总数左对齐（设计稿「共 600 条数据」）；页码居中；每页条数与跳页在右 -->
    <span class="list-pager-info">共 {{ total }} {{ unit }}数据</span>
    <div class="list-pager-nav">
      <button type="button" class="page-btn" :disabled="current === 1" aria-label="上一页" @click="go(current - 1)">‹</button>
      <template v-for="it in items" :key="it.key">
        <span v-if="it.num === null" class="page-ellipsis">…</span>
        <button
          v-else
          type="button"
          class="page-btn"
          :class="{ active: it.num === current }"
          :aria-current="it.num === current ? 'page' : undefined"
          @click="go(it.num)"
        >{{ it.num }}</button>
      </template>
      <button type="button" class="page-btn" :disabled="current === pages" aria-label="下一页" @click="go(current + 1)">›</button>
    </div>
    <div class="list-pager-tools">
      <select class="page-size" :value="pageSize" aria-label="每页条数" @change="onSizeChange($event.target.value)">
        <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}{{ unit }}/页</option>
      </select>
      <span class="page-jump">
        跳至
        <input
          v-model="jumpText"
          class="page-jump-input"
          type="text"
          inputmode="numeric"
          aria-label="跳至页码"
          @keyup.enter="onJump"
          @blur="onJump"
        />
        页
      </span>
    </div>
  </div>
</template>
