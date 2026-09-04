<script setup>
/**
 * 字段字典（治理，SYS_CONFIG/ADMIN）—— 统一字段字典管理中心。
 *
 * 2026-09-01 按 PRD（prd.字段字典.md）+ 交互原型 v2 对齐重构：
 * - 收纳 4 个字段：平台技能›技能分类、专家›专家分类、用户技能审核›风险类型/风险等级；
 * - 字段本身固定（不可增删字段，类别/字段名归属不可改）；
 * - 编辑弹窗改为「草稿编辑 +【完成】统一保存」：每行 序号+输入框+删除，删除仅移出草稿，
 *   完成时统一校验（选项值不能为空/不能重复，弹窗内联报错）并整字段覆盖保存；
 * - 数据走 fieldDict.js（demo 默认 fieldDictMock 内存 mock）。
 */
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Edit } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import '@/assets/connector.css'
import { listFieldDict, saveFieldOptions } from '@/api/fieldDict'

// 字段注册表（固定，展示顺序 = 原型分组顺序：平台技能 → 专家 → 用户技能审核）
const FIELDS = [
  {
    key: 'skillCategory',
    category: '平台技能',
    categoryDesc: '平台技能相关的可配置字段',
    name: '技能分类',
    desc: '客户端市场技能的展示分类'
  },
  {
    key: 'expertCategory',
    category: '专家',
    categoryDesc: '专家相关的可配置字段',
    name: '专家分类',
    desc: '专家列表与编辑页使用的业务分类'
  },
  {
    key: 'riskType',
    category: '用户技能审核',
    categoryDesc: '用户技能审核相关的可配置字段',
    name: '风险类型',
    desc: '客户端安全检测上报的问题类型'
  },
  {
    key: 'riskLevel',
    category: '用户技能审核',
    categoryDesc: '用户技能审核相关的可配置字段',
    name: '风险等级',
    desc: '客户端安全检测上报的风险等级'
  }
]

// 折叠态（默认全部展开）。
const collapsed = ref(new Set())
function toggleCollapse(cat) {
  const next = new Set(collapsed.value)
  next.has(cat) ? next.delete(cat) : next.add(cat)
  collapsed.value = next
}
function isCollapsed(cat) {
  return collapsed.value.has(cat)
}

const loading = ref(false)
const loadError = ref(false)
// 每个字段的选项列表：{ [key]: [{id,name}] }
const optionsByField = reactive({})

async function fetchAll() {
  loading.value = true
  loadError.value = false
  try {
    const dict = await listFieldDict()
    for (const f of FIELDS) optionsByField[f.key] = dict[f.key] || []
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// 按「类别」分组：每组一个类别头 + 组内若干字段卡片。
const groups = computed(() => {
  const byCat = new Map()
  for (const f of FIELDS) {
    if (!byCat.has(f.category)) {
      byCat.set(f.category, { category: f.category, desc: f.categoryDesc, fields: [] })
    }
    const opts = optionsByField[f.key] || []
    byCat.get(f.category).fields.push({
      key: f.key,
      name: f.name,
      desc: f.desc,
      count: opts.length,
      preview: opts.map((o) => o.name).join('、')
    })
  }
  return [...byCat.values()]
})

/* ============ 编辑弹窗（草稿编辑，【完成】统一保存 —— 原型 openFieldEditor） ============ */
const dialogVisible = ref(false)
const dialogField = ref(null) // 当前编辑的字段声明
const draft = ref([]) // 草稿行 [{ name }]
const dialogError = ref('') // 弹窗内联错误（完成时统一校验）
const saving = ref(false)
const optionInputs = ref([]) // 行输入框实例（「添加选项」后聚焦末行）

function openEdit(row) {
  dialogField.value = FIELDS.find((f) => f.key === row.key)
  draft.value = (optionsByField[row.key] || []).map((o) => ({ name: o.name }))
  dialogError.value = ''
  optionInputs.value = []
  dialogVisible.value = true
}

async function addOption() {
  draft.value.push({ name: '' })
  dialogError.value = ''
  await nextTick()
  optionInputs.value[draft.value.length - 1]?.focus?.()
}

// 删除仅移出草稿（保存在【完成】时统一发生）；确认文案按字段两分支（原型口径）
async function removeOption(idx) {
  const name = draft.value[idx]?.name?.trim() || '该选项'
  const impact =
    dialogField.value?.key === 'skillCategory'
      ? '删除后，已使用该分类的技能将显示为未分类。'
      : '删除后，已有记录中的该值不会被自动替换。'
  try {
    // 2026-09-04 PRD-20260903 对齐：确认文案引号照新原型直引号「确认删除"××"？」
    await ElMessageBox.confirm(`确认删除"${name}"？${impact}`, '删除选项', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  draft.value.splice(idx, 1)
  dialogError.value = ''
}

// 【完成】：统一校验（空值/重名）→ 整字段覆盖保存；失败弹窗保持打开并展示原因
async function confirmSave() {
  const clean = draft.value.map((r) => (r.name || '').trim())
  if (clean.some((n) => !n)) {
    dialogError.value = '选项值不能为空'
    return
  }
  if (new Set(clean).size !== clean.length) {
    dialogError.value = '选项值不能重复'
    return
  }
  saving.value = true
  try {
    const saved = await saveFieldOptions(dialogField.value.key, clean)
    optionsByField[dialogField.value.key] = saved
    dialogVisible.value = false
    ElMessage.success('字段选项已保存')
  } catch (e) {
    dialogError.value = e?.message || '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

// 【取消】/关闭：放弃本次未保存修改
function cancelEdit() {
  dialogVisible.value = false
}

onMounted(fetchAll)
</script>

<template>
  <div class="list-page">
    <PageHeader
      title="字段字典"
      subtitle="集中维护平台各类可配置字段字典。「编辑」进入后可增删改该字段下的选项值。"
    />

    <div v-loading="loading" class="conn-list">
      <el-empty v-if="!loading && loadError" :image-size="96" description="加载失败">
        <el-button @click="fetchAll">重试</el-button>
      </el-empty>

      <!-- 按「类别」分组（分层结构：类别头 + 组内字段卡片） -->
      <div v-for="g in groups" :key="g.category" class="aps-group">
        <!-- 类别头（无操作按钮：类别固定，不可新建/编辑/删除） -->
        <div class="aps-group-head">
          <el-button link class="aps-collapse-btn" @click="toggleCollapse(g.category)">
            <el-icon><component :is="isCollapsed(g.category) ? 'ArrowRight' : 'ArrowDown'" /></el-icon>
          </el-button>
          <span class="aps-group-name">{{ g.category }}</span>
          <span v-if="g.desc" class="aps-group-desc">{{ g.desc }}</span>
          <span class="aps-group-count">{{ g.fields.length }} 个字段</span>
          <span class="aps-group-sp"></span>
        </div>

        <!-- 组内字段卡片 -->
        <div v-if="!isCollapsed(g.category)" class="aps-group-body">
          <div v-for="fld in g.fields" :key="fld.key" class="np-row np-row--hover conn-row">
            <div class="conn-main">
              <div class="conn-line1">
                <span class="conn-name">{{ fld.name }}</span>
                <span class="fm-count">{{ fld.count }} 个选项</span>
              </div>
              <div class="conn-line2 fm-preview">
                <span v-if="fld.preview">{{ fld.preview }}</span>
                <span v-else class="fm-na">暂无选项</span>
              </div>
            </div>
            <div class="conn-ops">
              <el-button link type="primary" @click="openEdit(fld)">
                <el-icon><Edit /></el-icon> 编辑
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗：草稿编辑 +【完成】统一保存（原型 600px） -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogField ? `编辑${dialogField.name}` : '编辑字段'"
      width="600px"
      :close-on-click-modal="false"
    >
      <p class="fm-dlg-hint">{{ dialogField?.desc }}</p>

      <div class="fm-opt-list">
        <div v-for="(row, i) in draft" :key="i" class="fm-opt-row">
          <span class="fm-opt-idx">{{ i + 1 }}</span>
          <el-input
            :ref="(el) => (optionInputs[i] = el)"
            v-model="row.name"
            maxlength="30"
            class="fm-opt-input"
            @input="dialogError = ''"
          />
          <el-button link class="fm-opt-del" title="删除" @click="removeOption(i)">×</el-button>
        </div>
      </div>

      <el-button link type="primary" class="fm-opt-add" @click="addOption">＋ 添加选项</el-button>

      <div v-if="dialogError" class="fm-dlg-error">{{ dialogError }}</div>

      <template #footer>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmSave">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.fm-na {
  color: var(--el-text-color-placeholder);
}
.fm-count {
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
}
.fm-preview {
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
  margin-top: 2px;
}

/* 分层结构（复刻连接器 API 页 aps-group*） */
.aps-group {
  margin-bottom: var(--space-4);
}
.aps-group-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-1);
}
.aps-collapse-btn {
  padding: 0;
  color: var(--c-text-muted);
}
.aps-group-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.aps-group-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aps-group-count {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.aps-group-sp {
  flex: 1;
}
.aps-group-body {
  padding-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
/* 字段卡片：左内容 + 右操作 */
.conn-main {
  flex: 1;
  min-width: 0;
}
.conn-line1 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.conn-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.conn-ops {
  flex-shrink: 0;
}
.fm-dlg-hint {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  margin: 0 0 16px;
}
.fm-opt-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 320px;
  overflow-y: auto;
}
.fm-opt-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
}
.fm-opt-idx {
  width: 20px;
  text-align: center;
  flex-shrink: 0;
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}
.fm-opt-input {
  flex: 1;
}
.fm-opt-del {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--c-text-muted);
}
.fm-opt-del:hover {
  color: var(--el-color-danger);
}
.fm-opt-add {
  margin-top: var(--space-2);
  padding: 0;
}
.fm-dlg-error {
  margin-top: var(--space-2);
  color: var(--el-color-danger);
  font-size: var(--fs-xs);
}
</style>
