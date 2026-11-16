<script setup>
/**
 * 渠道 ·【机器人】页签（PRD 渠道 第三章）。
 *
 * 业务说明条 → 查询区（搜索 / 渠道 / 状态 /【查询】，右侧【消息设置】【+ 新建机器人】）→ 列表（不分页）→ 底部汇总。
 * 查询口径（第二章 2）：搜索框回车或点【查询】才生效，清空搜索内容自动刷新；切换下拉自动刷新；
 * 查询中保留当前列表并展示加载态。停用二次确认、启用直接生效；机器人不提供删除。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import StatusTag from '@/components/StatusTag.vue'
import ChannelBotEditor from './ChannelBotEditor.vue'
import ChannelMessageSettingsDialog from './ChannelMessageSettingsDialog.vue'
import { useAdminList } from '@/composables/useAdminList'
import { confirmDialog } from '@/composables/useConfirm'
import { listBots, getBotSummary, getPlatformSlots, stopBot, enableBot } from '@/api/channel'
import { COL } from '@/utils/tableLayout'
import { DEPLOY, PLATFORMS, PLATFORM_KEYS, BOT_STATUS, BOT_STATUS_OPTIONS, platformName, connLabel, statusSubText } from '@/utils/channelMeta'

const props = defineProps({
  /** 访问审计【查看】跳过来时注入的机器人名称 */
  initialKeyword: { type: String, default: '' }
})

/** 查询区草稿与已生效条件分开：搜索框要回车 / 点【查询】才生效 */
const query = reactive({ keyword: props.initialKeyword, ch: '', status: '' })
const applied = reactive({ ...query })
const list = useAdminList(listBots, { paged: false, params: () => ({ ...applied }) })
const { rows, loading, loadError, loadErrorMessage, isEmpty } = list

function apply() {
  Object.assign(applied, { keyword: query.keyword.trim(), ch: query.ch, status: query.status })
  list.search()
}
function onKeywordInput(v) {
  if (!v) apply() // 清空搜索内容后自动刷新
}
function clearFilters() {
  Object.assign(query, { keyword: '', ch: '', status: '' })
  apply()
}
const hasFilter = computed(() => !!(applied.keyword || applied.ch || applied.status))

/* 底部汇总：读失败显示「—」，不阻塞操作 */
const summary = ref(null)
async function loadSummary() {
  try {
    summary.value = await getBotSummary()
  } catch {
    summary.value = null
  }
}

/* 所有已启用平台都达到上限 →【+ 新建机器人】置灰 */
const slots = ref([])
async function loadSlots() {
  try {
    slots.value = await getPlatformSlots()
  } catch {
    slots.value = []
  }
}
const allFull = computed(() => slots.value.length > 0 && slots.value.every((s) => s.full))
const CREATE_FULL_TIP = `各 IM 平台均已达到机器人上限（每个 IM 平台最多接入 ${DEPLOY.botsPerPlatform} 个机器人）`

function refresh() {
  list.reload()
  loadSummary()
  loadSlots()
}
onMounted(() => {
  apply()
  loadSummary()
  loadSlots()
})

/* ---------- 抽屉 ---------- */
const editorVisible = ref(false)
const editorBotId = ref('')
const editorReadonly = ref(false)
function openEditor(id, readonly) {
  editorBotId.value = id
  editorReadonly.value = readonly
  editorVisible.value = true
}
const openCreate = () => !allFull.value && openEditor('', false)

const settingsVisible = ref(false)

/* ---------- 停用 / 启用（第三章 3.5） ---------- */
const busyId = ref('')

async function stop(row) {
  if (busyId.value) return
  const ok = await confirmDialog(
    `停用后，员工在${platformName(row.ch)}里给「${row.name}」发消息只会收到「机器人已停用」提示，机器人在 ${row.groupCount} 个群里不再响应，推送暂停（改发站内通知）。不影响网页端和客户端。确认停用？`,
    '停用机器人',
    { confirmText: '停用', danger: true }
  )
  if (!ok) return
  busyId.value = row.id
  try {
    await stopBot(row.id)
    ElMessage.success('机器人已停用')
    refresh()
  } catch (e) {
    ElMessage.error(e?.code === 40400 ? '机器人信息已变化' : e?.message || '停用失败，请稍后重试')
    if (e?.code === 40400) refresh()
  } finally {
    busyId.value = ''
  }
}

async function enable(row) {
  if (busyId.value) return
  busyId.value = row.id
  try {
    await enableBot(row.id)
    ElMessage.success('机器人已启用')
    refresh()
  } catch (e) {
    ElMessage.error(e?.code === 40400 ? '机器人信息已变化' : e?.message || '启用失败，请稍后重试')
    if (e?.code === 40400) refresh()
  } finally {
    busyId.value = ''
  }
}
</script>

<template>
  <div class="cbp">
    <div class="ch-note">
      每个 IM 平台最多接入 <b>{{ DEPLOY.botsPerPlatform }} 个机器人</b>；员工在机器人里使用自己的全部能力（<b>岗位私有 + 内置 + 市场安装</b>），机器人不裁剪、也不额外授予能力。
    </div>

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索机器人名称或用途说明"
        clearable
        class="lt-search"
        data-testid="bot-search"
        @keyup.enter="apply"
        @input="onKeywordInput"
        @clear="apply"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.ch" placeholder="全部渠道" clearable class="lt-filter" data-testid="bot-ch-filter" @change="apply">
        <el-option v-for="ch in PLATFORM_KEYS" :key="ch" :label="PLATFORMS[ch].name" :value="ch" />
      </el-select>
      <el-select v-model="query.status" placeholder="全部状态" clearable class="lt-filter" data-testid="bot-status-filter" @change="apply">
        <el-option v-for="o in BOT_STATUS_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="apply">查询</el-button>
      <template #right>
        <el-button data-testid="open-msg-settings" @click="settingsVisible = true">消息设置</el-button>
        <span class="cbp-create-wrap" :title="allFull ? CREATE_FULL_TIP : undefined">
          <el-button type="primary" class="lt-create" :disabled="allFull" data-testid="bot-create" @click="openCreate">＋ 新建机器人</el-button>
        </span>
      </template>
    </ListToolbar>

    <div class="ch-card">
      <div class="ch-card-title">机器人</div>
      <ListStates
        :loading="loading"
        :error="loadError"
        :error-message="loadErrorMessage"
        :empty="isEmpty"
        :empty-text="hasFilter ? '没有符合条件的记录' : '还没有机器人 · 点「新建机器人」接入第一个 IM 平台'"
        @retry="list.reload"
      >
        <el-table v-loading="loading" :data="rows" row-key="id" data-testid="bot-table">
          <el-table-column label="机器人名称" min-width="140">
            <template #default="{ row }"><span class="ch-name">{{ row.name }}</span></template>
          </el-table-column>
          <el-table-column label="用途说明" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.desc || '—' }}</template>
          </el-table-column>
          <el-table-column label="渠道" width="90">
            <template #default="{ row }">{{ platformName(row.ch) }}</template>
          </el-table-column>
          <el-table-column label="连接方式" width="120">
            <template #default="{ row }">{{ connLabel(row.ch, row.conn) }}</template>
          </el-table-column>
          <el-table-column label="状态" min-width="210">
            <template #default="{ row }">
              <StatusTag :type="BOT_STATUS[row.status].tag">{{ BOT_STATUS[row.status].label }}</StatusTag>
              <div v-if="statusSubText(row)" class="ch-sub" :class="{ 'is-danger': row.status === 'DOWN' }" data-testid="status-sub">
                {{ statusSubText(row) }}
              </div>
            </template>
          </el-table-column>
          <el-table-column label="最近更新" :width="COL.TIME" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }"><span class="ch-muted">{{ row.updatedAt }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <div class="ch-actions">
                <el-button link type="primary" @click="openEditor(row.id, true)">查看</el-button>
                <el-button link type="primary" @click="openEditor(row.id, false)">编辑</el-button>
                <el-button v-if="row.status === 'STOPPED'" link type="primary" :disabled="busyId === row.id" @click="enable(row)">启用</el-button>
                <el-button v-else link type="danger" :disabled="busyId === row.id" @click="stop(row)">停用</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div class="ch-foot" data-testid="bot-summary">
          <template v-if="summary">{{ summary.botCount }} 个机器人 · 已接入 {{ summary.platformCount }} / {{ summary.platformTotal }} 个 IM 平台</template>
          <template v-else>—</template>
        </div>
      </ListStates>
      <div v-if="isEmpty && hasFilter" class="ch-empty-actions">
        <el-button @click="clearFilters">清空筛选</el-button>
      </div>
    </div>

    <ChannelBotEditor v-model:visible="editorVisible" :bot-id="editorBotId" :readonly="editorReadonly" @saved="refresh" @changed="refresh" />
    <ChannelMessageSettingsDialog v-model="settingsVisible" />
  </div>
</template>

<style scoped src="./channelPane.css"></style>
<style scoped>
.cbp-create-wrap {
  display: inline-flex;
  margin-left: var(--space-3);
}
</style>
