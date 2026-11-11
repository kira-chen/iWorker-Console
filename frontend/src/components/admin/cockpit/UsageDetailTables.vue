<script setup>
/**
 * UsageDetailTables —— 驾驶舱「使用情况」页签的使用明细（PRD 第七节）：
 * 按用户 / 按岗位 / 按模型 / 按能力四个维度切换的明细表，共用页签顶部的筛选条（数据由父组件按筛选聚合好传入）。
 *
 * 2026-11-02：「按岗位」取代原驾驶舱「岗位领用 Top 5」（只列已发布岗位，默认按领用人数倒序）；
 * 按用户 / 按岗位 / 按模型末尾带点赞 / 点踩 / 点踩率，按能力不带（点赞点踩挂在对话轮次上，归不到某个技能）。
 *
 * 2026-11-10：四个维度的工具栏都有名称搜索（原只有按用户有）。
 *
 * @prop {object} data 使用情况汇总，用到 { claimedUsers, users, positions, models, abilities }（字段见 usageMock.js）
 * 每个维度各自保留排序、翻页与搜索词；切换维度不重置。
 */
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusTag from '@/components/StatusTag.vue'
import { terminalLabel } from '@/utils/versionMeta'
import { fmtCount, fmtLatency, fmtPct, fmtTokens } from '@/utils/usageFormat'

const props = defineProps({
  data: { type: Object, required: true }
})

const router = useRouter()

const DIMS = [
  { value: 'user', label: '按用户' },
  { value: 'position', label: '按岗位' },
  { value: 'model', label: '按模型' },
  { value: 'ability', label: '按能力' }
]
const dim = ref('user')

// 列定义：sort = 可点列头排序；w = 列宽（表格有最小宽度，窄屏横向滚动）
const FEEDBACK_COLS = [
  { key: 'likes', label: '点赞', num: true, sort: true, w: 64 },
  { key: 'dislikes', label: '点踩', num: true, sort: true, w: 64 },
  { key: 'dislikeRate', label: '点踩率', num: true, sort: true, w: 72 }
]
const COLS = {
  user: [
    { key: 'name', label: '用户', w: 170 },
    { key: 'terminal', label: '终端', w: 84 },
    { key: 'activeDays', label: '活跃天数', num: true, sort: true, w: 96 },
    { key: 'sessions', label: '会话数', num: true, sort: true, w: 84 },
    { key: 'inputTokens', label: '输入 Token', num: true, sort: true, w: 108 },
    { key: 'outputTokens', label: '输出 Token', num: true, sort: true, w: 108 },
    { key: 'lastUsedAt', label: '最近使用时间', sort: true, w: 150 },
    ...FEEDBACK_COLS
  ],
  position: [
    { key: 'name', label: '岗位', w: 170 },
    { key: 'claimed', label: '领用人数', sort: true, w: 200 },
    { key: 'active', label: '活跃人数', num: true, sort: true, w: 96 },
    { key: 'activeRate', label: '活跃率', num: true, sort: true, w: 84 },
    { key: 'sessions', label: '会话数', num: true, sort: true, w: 84 },
    { key: 'avgTokens', label: '人均 Token', num: true, sort: true, w: 108 },
    ...FEEDBACK_COLS
  ],
  model: [
    { key: 'name', label: '模型', w: 150 },
    { key: 'calls', label: '调用次数', num: true, sort: true, w: 84 },
    { key: 'inputTokens', label: '输入 Token', num: true, sort: true, w: 96 },
    { key: 'outputTokens', label: '输出 Token', num: true, sort: true, w: 96 },
    { key: 'activeUsers', label: '活跃用户', num: true, sort: true, w: 84 },
    { key: 'failRate', label: '失败率', num: true, sort: true, w: 72 },
    { key: 'topReason', label: '失败原因 Top', w: 112 },
    { key: 'p50', label: '首响 P50 / P95', num: true, sort: true, w: 124 },
    ...FEEDBACK_COLS,
    { key: 'op', label: '操作', w: 64 }
  ],
  ability: [
    { key: 'name', label: '能力', w: 220 },
    { key: 'calls', label: '调用次数', num: true, sort: true, w: 110 },
    { key: 'users', label: '使用人数', num: true, sort: true, w: 110 },
    { key: 'successRate', label: '成功率', num: true, sort: true, w: 100 },
    { key: 'lastCalledAt', label: '最近调用时间', sort: true, w: 170 }
  ]
}
const DEFAULT_SORT = {
  user: { key: 'tokens', dir: 'desc' }, // Token 合计（输入 + 输出），没有独立列
  position: { key: 'claimed', dir: 'desc' },
  model: { key: 'calls', dir: 'desc' },
  ability: { key: 'calls', dir: 'desc' }
}
const sorts = reactive(Object.fromEntries(Object.entries(DEFAULT_SORT).map(([k, v]) => [k, { ...v }])))
const pages = reactive({ user: 1, position: 1, model: 1, ability: 1 })
const PAGE_SIZE = 10

// 工具栏：四个维度都有名称搜索（回车或【查询】生效，不区分大小写）；按用户另有仅看沉默用户，按能力另有仅看零使用
const SEARCH_PLACEHOLDER = { user: '搜索用户名', position: '搜索岗位名称', model: '搜索模型名称', ability: '搜索能力名称' }
const keywords = reactive({ user: '', position: '', model: '', ability: '' }) // 输入框里的
const applied = reactive({ user: '', position: '', model: '', ability: '' }) // 已生效的
const onlySilent = ref(false)
const onlyZero = ref(false)

function applyKeyword() {
  applied[dim.value] = keywords[dim.value].trim()
  pages[dim.value] = 1
}

const silentCount = computed(() => props.data.users.filter((u) => u.sessions === 0).length)
const zeroCount = computed(() => props.data.abilities.filter((a) => a.calls === 0).length)

function sortRows(rows, { key, dir }) {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    // 没有值的（"—"）永远排在最后，不随升降序翻转
    if (av == null && bv != null) return 1
    if (bv == null && av != null) return -1
    if (av != null && av !== bv) return (av > bv ? 1 : -1) * sign
    return a.name.localeCompare(b.name, 'zh')
  })
}

const rows = computed(() => {
  const d = props.data
  let list
  if (dim.value === 'user') {
    list = d.users.map((u) => ({ ...u, tokens: u.inputTokens + u.outputTokens }))
    if (onlySilent.value) list = list.filter((u) => u.sessions === 0)
  } else if (dim.value === 'position') {
    list = d.positions
  } else if (dim.value === 'model') {
    list = d.models
  } else {
    list = onlyZero.value ? d.abilities.filter((a) => a.calls === 0) : d.abilities
  }
  const kw = applied[dim.value].toLowerCase()
  if (kw) list = list.filter((r) => r.name.toLowerCase().includes(kw))
  return sortRows(list, sorts[dim.value])
})

const totalPages = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)))
const pageNo = computed(() => Math.min(pages[dim.value], totalPages.value))
const pageRows = computed(() => rows.value.slice((pageNo.value - 1) * PAGE_SIZE, pageNo.value * PAGE_SIZE))

function toggleSort(col) {
  if (!col.sort) return
  const s = sorts[dim.value]
  if (s.key === col.key) s.dir = s.dir === 'desc' ? 'asc' : 'desc'
  else { s.key = col.key; s.dir = 'desc' }
  pages[dim.value] = 1
}
const sortMark = (col) => (sorts[dim.value].key === col.key ? (sorts[dim.value].dir === 'desc' ? ' ↓' : ' ↑') : '')

const maxClaimed = computed(() => Math.max(1, ...props.data.positions.map((p) => p.claimed)))
const failClass = (v) => (v == null ? '' : v > 10 ? 'is-danger' : v > 5 ? 'is-warn' : '')

// 【查看】跳转模型页并在搜索框注入模型名称（同访问审计"查看"的跳转方式）
function viewModel(row) {
  router.push({ name: 'AdminModels', query: { keyword: row.name } })
}
</script>

<template>
  <section class="dash-panel" aria-label="使用明细">
    <div class="dash-panel-head">
      <h2 class="dash-panel-title">使用明细</h2>
      <span class="spacer"></span>
      <el-radio-group v-model="dim" size="small">
        <el-radio-button v-for="d in DIMS" :key="d.value" :value="d.value">{{ d.label }}</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 工具栏：左侧名称搜索四个维度都有，右侧随维度变化 -->
    <div class="ux-toolbar">
      <el-input
        v-model="keywords[dim]"
        class="ux-search"
        :placeholder="SEARCH_PLACEHOLDER[dim]"
        clearable
        @keyup.enter="applyKeyword"
        @clear="applyKeyword"
      />
      <button class="mini-btn" @click="applyKeyword">查询</button>
      <span class="spacer"></span>
      <template v-if="dim === 'user'">
        <el-switch v-model="onlySilent" size="small" @change="pages.user = 1" />
        <span class="ux-switch-label">仅看沉默用户</span>
        <span class="ux-hint">沉默用户 {{ silentCount }} 人</span>
      </template>
      <span v-else-if="dim === 'position'" class="ux-hint">领用岗位员工数量 {{ data.claimedUsers }} 人</span>
      <template v-else-if="dim === 'ability'">
        <el-switch v-model="onlyZero" size="small" @change="pages.ability = 1" />
        <span class="ux-switch-label">仅看零使用</span>
        <span class="ux-hint">零使用 {{ zeroCount }} 个</span>
      </template>
    </div>

    <div class="ux-table-wrap">
      <table class="dash-table ux-table" :data-dim="dim">
        <thead>
          <tr>
            <th
              v-for="col in COLS[dim]"
              :key="col.key"
              :class="{ 'dash-num': col.num, sortable: col.sort }"
              :style="{ width: col.w + 'px' }"
              @click="toggleSort(col)"
            >{{ col.label }}{{ sortMark(col) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!pageRows.length">
            <td :colspan="COLS[dim].length" class="ux-empty">暂无数据</td>
          </tr>

          <!-- 按用户 -->
          <template v-if="dim === 'user'">
            <tr v-for="r in pageRows" :key="r.id">
              <td>
                <span class="dash-name-main">{{ r.name }}</span>
                <span class="dash-name-sub">{{ r.position }}</span>
              </td>
              <td><StatusTag type="accent">{{ terminalLabel(r.terminal) }}</StatusTag></td>
              <td class="dash-num">{{ r.activeDays }}</td>
              <td class="dash-num">{{ fmtCount(r.sessions) }}</td>
              <td class="dash-num">{{ fmtTokens(r.inputTokens) }}</td>
              <td class="dash-num">{{ fmtTokens(r.outputTokens) }}</td>
              <td class="ux-time" :class="{ 'is-muted': !r.lastUsedAt }">{{ r.lastUsedAt || '从未使用' }}</td>
              <td class="dash-num">{{ r.likes }}</td>
              <td class="dash-num">{{ r.dislikes }}</td>
              <td class="dash-num">{{ fmtPct(r.dislikeRate) }}</td>
            </tr>
          </template>

          <!-- 按岗位 -->
          <template v-else-if="dim === 'position'">
            <tr v-for="r in pageRows" :key="r.name">
              <td>
                <span class="dash-name-main">{{ r.name }}</span>
                <span class="dash-name-sub">{{ r.version }}</span>
              </td>
              <td>
                <span class="dash-bar-value">
                  <span class="dash-bar-track"><i :style="`width:${(r.claimed / maxClaimed * 100).toFixed(1)}%`"></i></span>
                  <span class="dash-bar-number">{{ r.claimed }}</span>
                </span>
              </td>
              <td class="dash-num">{{ r.active }}</td>
              <td class="dash-num">{{ fmtPct(r.activeRate) }}</td>
              <td class="dash-num">{{ fmtCount(r.sessions) }}</td>
              <td class="dash-num">{{ fmtTokens(r.avgTokens) }}</td>
              <td class="dash-num">{{ r.likes }}</td>
              <td class="dash-num">{{ r.dislikes }}</td>
              <td class="dash-num">{{ fmtPct(r.dislikeRate) }}</td>
            </tr>
          </template>

          <!-- 按模型 -->
          <template v-else-if="dim === 'model'">
            <tr v-for="r in pageRows" :key="r.name">
              <td>
                <span class="ux-name-row">
                  <span class="dash-name-main">{{ r.name }}</span>
                  <StatusTag v-if="r.isDefault" type="accent" class="ux-default">默认</StatusTag>
                </span>
                <span class="dash-name-sub">{{ r.category }}</span>
              </td>
              <td class="dash-num">{{ fmtCount(r.calls) }}</td>
              <td class="dash-num">{{ fmtTokens(r.inputTokens) }}</td>
              <td class="dash-num">{{ fmtTokens(r.outputTokens) }}</td>
              <td class="dash-num">{{ r.activeUsers }}</td>
              <td class="dash-num" :class="failClass(r.failRate)">{{ fmtPct(r.failRate) }}</td>
              <td>{{ r.topReason ? `${r.topReason.label} ${r.topReason.pct}%` : '—' }}</td>
              <td class="dash-num">{{ fmtLatency(r.p50, r.p95) }}</td>
              <td class="dash-num">{{ r.likes }}</td>
              <td class="dash-num">{{ r.dislikes }}</td>
              <td class="dash-num">{{ fmtPct(r.dislikeRate) }}</td>
              <td><button class="mini-btn" @click="viewModel(r)">查看</button></td>
            </tr>
          </template>

          <!-- 按能力 -->
          <template v-else>
            <tr v-for="r in pageRows" :key="r.name" :class="{ 'is-zero': r.calls === 0 }">
              <td>
                <span class="dash-name-main">{{ r.name }}</span>
                <span class="dash-name-sub">{{ r.type }}</span>
              </td>
              <td class="dash-num">{{ fmtCount(r.calls) }}</td>
              <td class="dash-num">{{ r.users }}</td>
              <td class="dash-num">{{ fmtPct(r.successRate) }}</td>
              <td class="ux-time" :class="{ 'is-muted': !r.lastCalledAt }">{{ r.lastCalledAt || '从未使用' }}</td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div class="ux-foot">
      <span>第 {{ pageNo }} / {{ totalPages }} 页，共 {{ rows.length }} 条</span>
      <span class="spacer"></span>
      <button class="mini-btn" :disabled="pageNo <= 1" @click="pages[dim] = pageNo - 1">上一页</button>
      <button class="mini-btn" :disabled="pageNo >= totalPages" @click="pages[dim] = pageNo + 1">下一页</button>
    </div>
  </section>
</template>

<style scoped>
.ux-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 8px 18px;
  border-bottom: 1px solid var(--border-soft);
}
.ux-search { width: 220px; }
.ux-switch-label { color: #4a5650; font-size: 12px; }
.ux-hint { color: #7f8984; font-size: 12px; }
.ux-table-wrap { overflow-x: auto; }
.ux-table { min-width: 1000px; }
.ux-table th.sortable { cursor: pointer; user-select: none; }
.ux-table th.sortable:hover { color: var(--c-accent); }
.ux-table th.dash-num { text-align: right; }
.ux-empty { text-align: center; color: #94a09a; height: 96px; }
.ux-time { color: #4a5650; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; }
.is-muted { color: #94a09a; }
.ux-name-row { display: flex; align-items: center; gap: 6px; }
.ux-default { flex: none; }
.is-warn { color: var(--c-warning, #e6921e); font-weight: 650; }
.is-danger { color: var(--c-danger); font-weight: 650; }
.is-zero .dash-name-main,
.is-zero .dash-num { color: #94a09a; }
.ux-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-top: 1px solid var(--border-soft);
  color: #7a8580;
  font-size: 12px;
}
</style>
