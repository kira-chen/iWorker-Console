<script setup>
/**
 * 从技能库引用已有 FDE 技能到 Agent（V84 引用模型）。
 *
 * 列出「已发布」FDE 技能（origin=POSITION + status=published，GET /fde/skills），选中「引用」→
 * emit('pick', skillId)，由父级调 assignSkillToAgent 写入引用行。岗位内已引用的技能置灰（existingIds），
 * 防岗位内重复引用（后端亦有 (position_id, skill_id) 唯一键兜底）。
 * 权限（2026-07-25）：草稿技能不可配置进岗位，故列表只显已发布（后端 assign 亦守卫拉入须已发布）。
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { listSkills } from '@/api/position'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 本岗位已引用的技能 id 集合（跨全部 Agent）：命中则置灰不可再引用。 */
  existingIds: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'pick'])

const loading = ref(false)
const rows = ref([])
const keyword = ref('')

const existingSet = computed(() => new Set(props.existingIds))

/**
 * 服务端搜索（集成端反馈）：旧实现一次拉 200 条后纯前端本地过滤，已发布 FDE 技能超过后端上限时，
 * 靠后的技能弹窗里既看不到也搜不到。改为把 keyword 传给后端（匹配 name/code/description，跨全库过滤），
 * 本地不再二次过滤——任一已发布技能均可搜到。keyword 输入去抖，避免逐字符打接口。
 */
async function load() {
  loading.value = true
  try {
    const kw = keyword.value.trim()
    const data = await listSkills({
      page: 1,
      size: 200,
      status: 'published',
      ...(kw ? { keyword: kw } : {})
    })
    rows.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    ElMessage.error(e?.message || '加载技能库失败')
    rows.value = []
  } finally {
    loading.value = false
  }
}

let searchTimer = null
function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
}
watch(keyword, () => {
  if (props.modelValue) scheduleSearch()
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      keyword.value = ''
      load()
    }
  }
)

function close() {
  emit('update:modelValue', false)
}
function onPick(row) {
  if (existingSet.value.has(row.id)) return
  emit('pick', row.id)
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="从技能库选择已有技能"
    width="560px"
    @update:model-value="close"
  >
    <el-input
      v-model="keyword"
      placeholder="搜索技能名称 / 标识"
      clearable
      class="sp-search"
    >
      <template #prefix><el-icon><Search /></el-icon></template>
    </el-input>

    <div v-loading="loading" class="sp-list">
      <el-empty v-if="!loading && !rows.length" :image-size="72" description="没有可引用的 FDE 技能" />
      <div v-for="row in rows" :key="row.id" class="sp-row">
        <div class="sp-main">
          <div class="sp-line1">
            <span class="sp-name">{{ row.name }}</span>
            <el-tag size="small" effect="plain">{{ row.code }}</el-tag>
            <el-tag size="small" :type="row.status === 'published' ? 'success' : 'info'" effect="plain">
              {{ row.status === 'published' ? '已发布' : '草稿' }}
            </el-tag>
          </div>
          <div v-if="row.description" class="sp-desc">{{ row.description }}</div>
        </div>
        <el-tag v-if="existingSet.has(row.id)" size="small" type="info" effect="plain">本岗位已引用</el-tag>
        <el-button v-else link type="primary" @click="onPick(row)">引用</el-button>
      </div>
    </div>

    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.sp-search {
  margin-bottom: var(--space-3);
}
.sp-list {
  max-height: 52vh;
  overflow-y: auto;
  min-height: 120px;
}
.sp-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--border-soft);
}
.sp-main {
  flex: 1;
  min-width: 0;
}
.sp-line1 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.sp-name {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-desc {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
