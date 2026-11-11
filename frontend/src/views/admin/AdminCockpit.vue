<script setup>
/**
 * 驾驶舱（01 总览）—— 全局概览，分「概览」「使用情况」两个页签（2026-11-02）。
 * - 概览：用户端当前下发版本（含升级进度）、异常与待办、各模块发布状态。
 * - 使用情况（仅 ADMIN）：使用量、用户端点踩统计、按用户 / 岗位 / 模型 / 能力的使用明细，见 CockpitUsageTab。
 *
 * 数据静态 mock，对应原型 renderDashboard 内容（2026-09-17 负责人裁决：删去本月成本卡）。
 * 2026-10-09 负责人裁决：顶部核心指标卡区整块删除，「用户端当前下发版本」上移到页头下第一块。
 * 2026-11-02：原「岗位领用 Top 5」并入使用情况页签的「按岗位」明细；原「用户端点踩统计」迁入使用情况页签
 * （2026-11-10：仍是原来的两格点踩统计，不展示点赞，见 UsageFeedbackPanel）。
 * 唯一例外是「用户端当前下发版本」面板：取自版本管理（api/version 的 getVersionOverview，与版本管理页
 * 概览条同一数据源），版本管理里发布 / 停用经审核通过后，这里随之变化；其升级进度人数是静态示例。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import CockpitUsageTab from '@/components/admin/cockpit/CockpitUsageTab.vue'
import { getVersionOverview } from '@/api/version'
import { getVersionAdoption } from '@/api/usage'
import { useUserStore } from '@/stores/user'
import { fmtTime } from '@/utils/docMeta'
import { TERMINAL_OPTIONS } from '@/utils/versionMeta'
import '@/assets/admin-dialog.css'
import '@/assets/cockpit-dash.css'

const router = useRouter()
const userStore = useUserStore()

// 使用情况页签仅系统管理员可见（用户维度的使用量比发布状态敏感，PRD 第十一节待确认）；非管理员只有概览，不展示页签栏
const showUsageTab = computed(() => userStore.isAdmin)
const activeTab = ref('overview')

const refreshTime = ref('09:30')
const refreshing = ref(false)
// 每点一次【刷新】+1，使用情况页签据此重新取数
const usageRefreshToken = ref(0)

// 异常与待办：行动按钮真实跳转对应模块页面（原型是 toast 占位，这里改为路由跳转）
const alerts = [
  { count: 11, level: 'medium', label: '待审核', meta: '发布审核 7 / 版本发布 3 / 停用审核 1', source: '审核中心', action: '去审核', to: 'UnifiedReview' },
  { count: 3,  level: 'high',   label: '连接失败', meta: 'MCP 2 / API 1',                    source: '连接器',   action: '去处理', to: 'AdminConnector' },
  { count: 2,  level: 'high',   label: '高风险',   meta: '等待人工审核',                      source: '用户技能审核', action: '去审核', to: 'SysConfigUserSkillReviews', query: { status: 'PENDING' } },
  { count: 5,  level: 'medium', label: '待分配',   meta: '员工申请岗位，等待分配',            source: '岗位管理', action: '去分配', to: 'AdminPositionAssignments', query: { pending: '1' } },
  { count: 4,  level: 'medium', label: '待扩容',   meta: '员工产物容量不足，等待同意或拒绝',   source: '存储空间', action: '去处理', to: 'AdminStorageSpace', query: { tab: 'request', status: 'PENDING' } },
  { count: 2,  level: 'medium', label: '待授权',   meta: '员工申请开启完全访问，等待通过或驳回', source: '用户访问权限', action: '去处理', to: 'AdminUserAccess', query: { pending: '1' } },
]
const alertTotal = alerts.reduce((s, x) => s + x.count, 0)

// 各模块发布状态
const assets = [
  { name: '岗位',   published: 14, review: 2, draft: 2 },
  { name: '专家',   published: 18, review: 1, draft: 3 },
  { name: '专家团', published:  3, review: 0, draft: 1 },
  { name: '技能',   published: 68, review: 5, draft: 9 },
  { name: 'MCP',    published:  9, review: 1, draft: 2 },
  { name: 'API',    published: 11, review: 2, draft: 4 },
  { name: '业务系统', published: 7, review: 0, draft: 2 },
  { name: '模型',   published: 6, review: 1, draft: 1 },
  { name: '知识库', published: 12, review: 2, draft: 5 },
]

function assetPcts(item) {
  const total = item.published + item.review + item.draft
  const p = (item.published / total * 100).toFixed(1)
  const r = (item.review / total * 100).toFixed(1)
  const d = (100 - parseFloat(p) - parseFloat(r)).toFixed(1)
  return { p, r, d, total }
}

// 用户端当前下发版本：各终端「下发中版本」（含停用审核期间仍在下发的）+ 更新说明，只读展示。
// verOverview 为 null = 尚未取回（骨架屏）；{ WINDOWS: 版本行|null, MAC: 版本行|null }，null 表示该终端暂无下发版本。
const verOverview = ref(null)
const verError = ref(false)
// 升级进度（静态示例）：{ WINDOWS: { upgraded, behind }, MAC: ... }；取数失败只是不展示进度，不影响版本卡片本身
const adoption = ref(null)
const verLoading = computed(() => refreshing.value || !verOverview.value)
const verCards = computed(() =>
  TERMINAL_OPTIONS.map((t) => {
    const a = adoption.value?.[t.value]
    const total = a ? a.upgraded + a.behind : 0
    return {
      ...t,
      row: verOverview.value?.[t.value] ?? null,
      adoption: a && total ? { ...a, rate: (a.upgraded / total * 100).toFixed(1) } : null
    }
  })
)

async function loadVerOverview() {
  verError.value = false
  try {
    verOverview.value = await getVersionOverview()
  } catch {
    verError.value = true
  }
}
async function loadAdoption() {
  try {
    adoption.value = await getVersionAdoption()
  } catch {
    adoption.value = null
  }
}
onMounted(() => {
  loadVerOverview()
  loadAdoption()
})

function doRefresh() {
  refreshing.value = true
  loadVerOverview()
  loadAdoption()
  usageRefreshToken.value++
  setTimeout(() => {
    refreshing.value = false
    const now = new Date()
    refreshTime.value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    ElMessage({ message: '驾驶舱数据已刷新', type: 'success', plain: true })
  }, 650)
}

// 异常与待办卡片的行动按钮：真实跳转对应模块页面处理（2026-09-17 裁决：由 toast 占位改为路由跳转）
function openAlertAction(item) {
  router.push({ name: item.to, query: item.query })
}
</script>

<template>
  <div class="cockpit" :class="{ loading: refreshing }">
    <PageHeader title="驾驶舱" subtitle="查看数字员工资产、治理待办，以及用户端的使用情况与反馈。">
      <template #actions>
        <span class="ref-time">更新于 {{ refreshTime }}</span>
        <el-button @click="doRefresh">刷新</el-button>
      </template>
    </PageHeader>

    <el-tabs v-model="activeTab" class="cockpit-tabs" :class="{ 'single-tab': !showUsageTab }">
      <el-tab-pane label="概览" name="overview">
        <!-- 用户端当前下发版本：Windows / Mac 各一张只读卡片，版本号 + 发布时间 + 升级进度 + 更新说明（版本数据同版本管理概览条） -->
        <section class="dash-panel first-panel" aria-label="用户端当前下发版本">
          <div class="dash-panel-head">
            <h2 class="dash-panel-title">用户端当前下发版本</h2>
            <span class="dash-panel-count">用户端检测更新时将提示升级到该版本</span>
          </div>
          <div v-if="verError" class="ver-error">
            加载失败
            <el-button link type="primary" @click="loadVerOverview">重试</el-button>
          </div>
          <div v-else class="ver-grid">
            <div v-for="c in verCards" :key="c.value" class="ver-card" :data-terminal="c.value">
              <StatusTag type="accent">{{ c.label }}</StatusTag>
              <div v-if="verLoading" class="ver-skeleton"></div>
              <template v-else-if="c.row">
                <div class="ver-line">
                  <span class="ver-version">{{ c.row.version }}</span>
                  <span class="ver-time">发布于 {{ fmtTime(c.row.publishedAt) }}</span>
                </div>
                <!-- 升级进度：近 7 天有检测上报的用户里，已升到下发版本的占比（用户端每次检测更新都上报终端 + 当前版本号） -->
                <div v-if="c.adoption" class="ver-adopt" data-testid="ver-adopt">
                  <div class="ver-adopt-text">
                    <span>已升级 <b>{{ c.adoption.upgraded }}</b> 人 · 未升到该版本 <b>{{ c.adoption.behind }}</b> 人</span>
                    <span class="ver-adopt-rate">升级率 {{ c.adoption.rate }}%</span>
                  </div>
                  <div class="dash-bar-track"><i :style="`width:${c.adoption.rate}%`"></i></div>
                </div>
                <div class="ver-notes-label">更新说明</div>
                <div class="ver-notes">{{ c.row.releaseNotes }}</div>
              </template>
              <div v-else class="ver-empty">暂无下发版本</div>
            </div>
          </div>
        </section>

        <!-- 异常与待办 -->
        <section class="dash-panel">
          <div class="dash-panel-head">
            <h2 class="dash-panel-title">异常与待办</h2>
            <span class="dash-panel-count">共 {{ alertTotal }} 项</span>
          </div>
          <div class="dash-alert-list">
            <div class="dash-todo-grid">
              <div
                v-for="item in alerts"
                :key="item.source"
                class="dash-todo-card"
                :class="item.level"
              >
                <div class="dash-todo-top">
                  <span class="dash-todo-source">{{ item.source }}</span>
                  <span class="dash-severity" :class="item.level">
                    <span class="dash-severity-dot"></span>{{ item.label }}
                  </span>
                </div>
                <div class="dash-todo-number">{{ item.count }}<small>项</small></div>
                <div class="dash-todo-meta">{{ item.meta }}</div>
                <div class="dash-todo-actions">
                  <button class="mini-btn" @click="openAlertAction(item)">{{ item.action }}</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 各模块发布状态（通栏，宽屏两列排布） -->
        <section class="dash-panel">
          <div class="dash-panel-head">
            <h2 class="dash-panel-title">各模块发布状态</h2>
          </div>
          <div class="dash-asset-body">
            <div class="dash-asset-legend">
              <span class="dash-legend"><i class="pub"></i>已发布</span>
              <span class="dash-legend"><i class="rev"></i>审核中</span>
              <span class="dash-legend"><i class="dft"></i>未发布</span>
            </div>
            <div class="dash-asset-rows">
              <div v-for="item in assets" :key="item.name" class="dash-asset-row">
                <span class="dash-asset-name">{{ item.name }}</span>
                <span class="dash-asset-total">{{ assetPcts(item).total }}</span>
                <span class="dash-stack">
                  <span class="pub" :style="`width:${assetPcts(item).p}%`"></span>
                  <span class="rev" :style="`width:${assetPcts(item).r}%`"></span>
                  <span class="dft" :style="`width:${assetPcts(item).d}%`"></span>
                </span>
                <span class="dash-asset-detail"><b>{{ item.published }}</b> / {{ item.review }} / {{ item.draft }}</span>
              </div>
            </div>
          </div>
        </section>
      </el-tab-pane>

      <el-tab-pane v-if="showUsageTab" label="使用情况" name="usage" lazy>
        <CockpitUsageTab :refresh-token="usageRefreshToken" :refreshing="refreshing" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
/* ---- 顶部工具行 ---- */
.ref-time {
  font-size: 13px;
  color: var(--c-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: 6px;
}

/* ---- 页签（对齐工具调用审计 tca-tabs / 访问审计 aa-tabs）；非管理员只有概览，不展示页签栏 ---- */
.cockpit-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.cockpit-tabs :deep(.el-tabs__content) { overflow: visible; }
.cockpit-tabs.single-tab :deep(.el-tabs__header) { display: none; }
/* 概览第一块贴着页签栏时，去掉面板自带的上外边距 */
.first-panel { margin-top: 14px; }

/* 待办告警列表 */
.dash-alert-list {
  min-height: 170px;
  padding: 14px 16px;
}
.dash-todo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.dash-todo-card {
  min-height: 140px;
  padding: 15px 16px;
  border: 1px solid var(--border-base);
  border-left: 4px solid var(--c-warning, #e6921e);
  border-radius: 6px;
  background: #fff;
  display: flex;
  flex-direction: column;
}
.dash-todo-card.high { border-left-color: var(--c-danger); }
.dash-todo-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.dash-todo-source { color: #65716b; font-size: 12px; font-weight: 600; }
.dash-todo-number {
  margin-top: 11px;
  color: #26312b;
  font: 700 28px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.dash-todo-number small {
  margin-left: 4px;
  color: #77827c;
  font: 500 12px system-ui, sans-serif;
}
.dash-todo-meta { min-height: 35px; margin-top: 5px; color: #76817b; font-size: 12px; line-height: 1.5; flex: 1; }
.dash-todo-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
.dash-severity {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 650;
}
.dash-severity-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-warning, #e6921e);
  display: inline-block;
}
.dash-severity.high { color: var(--c-danger); }
.dash-severity.high .dash-severity-dot { background: var(--c-danger); }
.dash-severity.medium { color: var(--c-warning, #e6921e); }

/* 资产发布状态 */
.dash-asset-body { padding: 14px 18px 18px; }
.dash-asset-legend {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  margin-bottom: 10px;
  color: #727d77;
  font-size: 12px;
}
.dash-asset-rows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 40px;
}
.dash-legend { display: inline-flex; align-items: center; gap: 6px; }
.dash-legend i { width: 8px; height: 8px; border-radius: 2px; background: #c7cfcb; }
.dash-legend .pub { background: var(--c-accent); }
.dash-legend .rev { background: #df9a33; }
.dash-legend .dft { background: #c7cfcb; }
.dash-asset-row {
  display: grid;
  grid-template-columns: 78px 40px minmax(100px, 1fr) 140px;
  align-items: center;
  gap: 12px;
  min-height: 39px;
}
.dash-asset-name { font-weight: 600; color: #414a45; }
.dash-asset-total { color: #6f7a74; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; text-align: right; }
.dash-stack {
  height: 10px;
  display: flex;
  border-radius: 3px;
  overflow: hidden;
  background: #eef1ef;
}
.dash-stack span { height: 100%; }
.dash-stack .pub { background: var(--c-accent); }
.dash-stack .rev { background: #df9a33; }
.dash-stack .dft { background: #c7cfcb; }
.dash-asset-detail {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  color: #7a8580;
  font: 11px ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: nowrap;
}
.dash-asset-detail b { color: #3e4a44; font-weight: 600; }

/* 用户端当前下发版本 */
.ver-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px 16px;
}
.ver-card {
  min-height: 150px;
  padding: 15px 16px;
  border: 1px solid var(--border-base);
  border-left: 4px solid var(--c-accent);
  border-radius: 6px;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.ver-line { display: flex; align-items: baseline; gap: 10px; margin-top: 11px; }
.ver-version {
  color: #26312b;
  font: 700 24px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.ver-time { color: #7f8984; font-size: 12px; }
.ver-adopt { width: 100%; margin-top: 10px; }
.ver-adopt-text {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 5px;
  color: #5b6760;
  font-size: 12px;
}
.ver-adopt-text b { color: #26312b; font-weight: 650; font-variant-numeric: tabular-nums; }
.ver-adopt-rate { color: var(--c-accent); font-weight: 650; white-space: nowrap; }
.ver-notes-label { margin-top: 10px; color: #68736d; font-size: 12px; font-weight: 600; }
.ver-notes {
  width: 100%;
  max-height: 132px;
  margin-top: 4px;
  overflow: auto;
  color: #455049;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-line; /* 更新说明保留换行 */
}
.ver-empty { margin-top: 11px; color: #94a09a; font-size: 13px; line-height: 32px; }
.ver-skeleton {
  width: 100%;
  height: 88px;
  margin-top: 11px;
  border-radius: 4px;
  background: linear-gradient(90deg, #f0f3f1 25%, #f7f9f8 50%, #f0f3f1 75%);
  background-size: 200% 100%;
  animation: shimmer 1s linear infinite;
}
.ver-error { padding: 14px 18px; color: #68736d; font-size: 13px; }

/* shimmer loading */
.loading .dash-alert-list,
.loading .dash-asset-row {
  color: transparent !important;
  background: linear-gradient(90deg, #f0f3f1 25%, #f7f9f8 50%, #f0f3f1 75%);
  background-size: 200% 100%;
  animation: shimmer 1s linear infinite;
}
.loading .dash-severity-dot { opacity: 0; }
/* 刷新期间整页不可交互（PRD §一.3 / §十）：骨架屏只处理视觉，点击仍会穿透触发 toast，
   pointer-events:none 挂在根节点，靴子一次性罩住全部卡片/按钮/弹窗触发点。 */
.cockpit.loading { pointer-events: none; }

@media (max-width: 1260px) {
  .dash-todo-grid { grid-template-columns: 1fr; }
  .dash-asset-rows { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .ver-grid { grid-template-columns: 1fr; }
}
</style>
