<script setup>
/**
 * 渠道 ·【群聊治理】页签（PRD 渠道 第五章）。
 *
 * 说明条 → 查询区（搜索群名称或拉入人 / 渠道 /【查询】，右侧主按钮【群聊规则】）→ 群列表 → 底部「N 个群」。
 * 第一版入群立即生效、不做外部成员识别，列表里的群都处于生效状态，所以没有状态列和状态筛选；
 * 管理员只能【查看】和【移出】，不提供单个群配置。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ChannelGroupDrawer from './ChannelGroupDrawer.vue'
import ChannelGroupRulesDrawer from './ChannelGroupRulesDrawer.vue'
import { useAdminList } from '@/composables/useAdminList'
import { confirmDialog } from '@/composables/useConfirm'
import { listGroups, removeGroup } from '@/api/channel'
import { COL } from '@/utils/tableLayout'
import { PLATFORMS, PLATFORM_KEYS, platformName } from '@/utils/channelMeta'

const props = defineProps({
  /** 访问审计【查看】移出群记录跳过来时注入的群名称 */
  initialKeyword: { type: String, default: '' }
})

const query = reactive({ keyword: props.initialKeyword, ch: '' })
const applied = reactive({ ...query })
const list = useAdminList(listGroups, { paged: false, params: () => ({ ...applied }) })
const { rows, loading, loadError, loadErrorMessage, isEmpty } = list

function apply() {
  Object.assign(applied, { keyword: query.keyword.trim(), ch: query.ch })
  list.search()
}
function onKeywordInput(v) {
  if (!v) apply()
}
function clearFilters() {
  Object.assign(query, { keyword: '', ch: '' })
  apply()
}
const hasFilter = computed(() => !!(applied.keyword || applied.ch))
/* 底部汇总「N 个群」：全部生效中的群，不随筛选变化（同机器人页签的汇总口径）；读失败显示「—」 */
const groupCount = ref(null)
async function loadSummary() {
  try {
    groupCount.value = (await listGroups({})).total
  } catch {
    groupCount.value = null
  }
}
function refresh() {
  list.reload()
  loadSummary()
}
onMounted(() => {
  apply()
  loadSummary()
})

const viewVisible = ref(false)
const viewId = ref('')
function openView(row) {
  viewId.value = row.id
  viewVisible.value = true
}
const rulesVisible = ref(false)

const busyId = ref('')
async function remove(row) {
  if (busyId.value) return
  const ok = await confirmDialog(
    `移出后机器人会退出「${row.name}」，群记录保留 30 天，期间重新拉入可恢复。确认移出？`,
    '移出群',
    { confirmText: '移出', danger: true }
  )
  if (!ok) return
  busyId.value = row.id
  try {
    await removeGroup(row.id)
    ElMessage.success('机器人已移出群')
  } catch (e) {
    ElMessage.error(e?.message || '移出失败，请稍后重试')
  } finally {
    busyId.value = ''
    refresh()
  }
}
</script>

<template>
  <div class="cgp">
    <div class="ch-note">
      群里的每条指令都以<b>发起人本人</b>的身份和权限执行；能力以<b>发起人自己的能力为上限</b>；所有群按「群聊规则」执行，不单独配置。
    </div>

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索群名称或拉入人"
        clearable
        class="lt-search"
        data-testid="group-search"
        @keyup.enter="apply"
        @input="onKeywordInput"
        @clear="apply"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.ch" placeholder="全部渠道" clearable class="lt-filter" data-testid="group-ch-filter" @change="apply">
        <el-option v-for="ch in PLATFORM_KEYS" :key="ch" :label="PLATFORMS[ch].name" :value="ch" />
      </el-select>
      <el-button @click="apply">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" data-testid="open-group-rules" @click="rulesVisible = true">群聊规则</el-button>
      </template>
    </ListToolbar>

    <div class="ch-card">
      <div class="ch-card-title">已接入的群</div>
      <ListStates
        :loading="loading"
        :error="loadError"
        :error-message="loadErrorMessage"
        :empty="isEmpty"
        :empty-text="hasFilter ? '没有符合条件的记录' : '还没有群 · 员工把机器人拉进群后会显示在这里'"
        @retry="list.reload"
      >
        <el-table v-loading="loading" :data="rows" row-key="id" data-testid="group-table">
          <el-table-column label="群" min-width="220">
            <template #default="{ row }">
              <div class="ch-name">{{ row.name }}</div>
              <div class="ch-sub">拉入人 {{ row.by }} · {{ row.joinedAt }}</div>
            </template>
          </el-table-column>
          <el-table-column label="渠道" width="100">
            <template #default="{ row }">{{ platformName(row.ch) }}</template>
          </el-table-column>
          <el-table-column label="成员" width="90">
            <template #default="{ row }">{{ row.members }}</template>
          </el-table-column>
          <el-table-column label="最近更新" :width="COL.TIME" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }"><span class="ch-muted">{{ row.updatedAt }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <div class="ch-actions">
                <el-button link type="primary" @click="openView(row)">查看</el-button>
                <el-button link type="danger" :disabled="busyId === row.id" @click="remove(row)">移出</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div class="ch-foot" data-testid="group-summary">{{ groupCount == null ? '—' : `${groupCount} 个群` }}</div>
      </ListStates>
      <div v-if="isEmpty && hasFilter" class="ch-empty-actions">
        <el-button @click="clearFilters">清空筛选</el-button>
      </div>
    </div>

    <ChannelGroupDrawer v-model:visible="viewVisible" :group-id="viewId" @gone="refresh" />
    <ChannelGroupRulesDrawer v-model:visible="rulesVisible" />
  </div>
</template>

<style scoped src="./channelPane.css"></style>
