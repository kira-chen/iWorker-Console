<script setup>
/**
 * 岗位详情 · 「采集字段」页签（md §3：标准列表 + 右侧抽屉编辑，最多 10 个）。
 *
 * 2026-09-10 病 A 拆分（docs/调研讨论/2026-09-09-代码冗余治理第二批方案.md 第 5 项）：
 * 自 PositionDetailTabs.vue 原样抽出，DOM 结构 / class / 交互零变更。
 * 数据直接走 usePositionStore（intakeSchema 挂在 store.basic 上，随顶部【保存】提交）；
 * 保存时的行级校验（validateIntakeRows）仍在父层 doSaveBasic，此处只管列表与抽屉草稿。
 */
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { LIMITS, INTAKE_TYPES, isSelectType, genKeyFromLabel } from '@/utils/positionModel'

defineProps({
  // 只读态（列表【查看】进入 / 审核中锁定），由父层统一推导
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()

/* ---------- 采集 Tab 内联绑定（搬自 IntakeEditDialog） ---------- */
function patchBasic(key, value) {
  store.basic = { ...store.basic, [key]: value }
}
const intakeRows = computed({
  get: () => store.basic?.intakeSchema || [],
  set: (v) => patchBasic('intakeSchema', v)
})

/* ---------- 采集字段:标准列表 + 右侧抽屉编辑（2026-08-22 列表化改造） ---------- */
const intakeTypeLabel = (t) => INTAKE_TYPES.find((x) => x.value === t)?.label || t
const intakeDrawerOpen = ref(false)
const intakeEditIndex = ref(-1) // -1=新增，>=0=编辑该行
const intakeDraft = ref({ label: '', key: '', type: 'text', required: false, options: [] })

function openIntakeCreate() {
  intakeEditIndex.value = -1
  intakeDraft.value = { label: '', key: '', type: 'text', required: false, options: [] }
  intakeDrawerOpen.value = true
}
function openIntakeEdit(row, index) {
  intakeEditIndex.value = index
  intakeDraft.value = { label: row.label || '', key: row.key || '', type: row.type || 'text', required: !!row.required, options: [...(row.options || [])] }
  intakeDrawerOpen.value = true
}
// 采集字段上限（md §3.1：最多 10 个，达上限【新增采集字段】置灰）
const intakeAtLimit = computed(() => intakeRows.value.length >= LIMITS.INTAKE_MAX)
function saveIntakeDraft() {
  const d = intakeDraft.value
  if (!String(d.label || '').trim()) { ElMessage.warning('请填写字段名'); return }
  const options = isSelectType(d.type) ? (d.options || []).filter((o) => String(o).trim()) : []
  // md §3.2：单选 / 多选保存时校验选项列表，全空则阻断保存并 toast（2026-09-08 PRD-20260908 对齐）
  if (isSelectType(d.type) && !options.length) { ElMessage.warning('请至少填写一个选项'); return }
  const row = { ...d, key: (d.key || '').trim() || genKeyFromLabel(d.label), options }
  const next = [...intakeRows.value]
  if (intakeEditIndex.value >= 0) next[intakeEditIndex.value] = row
  else {
    if (next.length >= LIMITS.INTAKE_MAX) { ElMessage.warning(`最多 ${LIMITS.INTAKE_MAX} 个采集字段`); return }
    next.push(row)
  }
  intakeRows.value = next
  intakeDrawerOpen.value = false
  // md 三.3.2：保存后提示「采集字段已保存」，列表刷新（本地即时）
  ElMessage.success('采集字段已保存')
}
async function deleteIntakeRow(index) {
  try {
    await ElMessageBox.confirm('删除该采集字段？删除后员工领用时不再采集该项。', '删除字段', { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' })
  } catch { return }
  intakeRows.value = intakeRows.value.filter((_, i) => i !== index)
  // md 三.3.3：删除后提示「采集字段已删除」
  ElMessage.success('采集字段已删除')
}
function addIntakeOption() { intakeDraft.value.options = [...(intakeDraft.value.options || []), ''] }
function removeIntakeOption(i) { intakeDraft.value.options = (intakeDraft.value.options || []).filter((_, idx) => idx !== i) }
</script>

<template>
  <div class="pd-pane">
    <div class="pd-list-head">
      <!-- 表头副题照原型 intakePane L1854；达 10 个【新增采集字段】置灰（md §3.1） -->
      <div class="pd-list-title">采集字段<span class="pd-list-sub">员工领用时填写，最多 {{ LIMITS.INTAKE_MAX }} 个</span></div>
      <el-button v-if="!isReadonly" type="primary" size="small" :disabled="intakeAtLimit" @click="openIntakeCreate">＋ 新增采集字段</el-button>
    </div>
    <el-table :data="intakeRows" class="pd-table" empty-text="暂无采集字段，点「新增采集字段」添加">
      <el-table-column type="index" label="#" width="52" />
      <el-table-column prop="label" label="字段名" min-width="160" />
      <el-table-column label="字段 key" min-width="140">
        <template #default="{ row }"><span class="pd-mono">{{ row.key || genKeyFromLabel(row.label) || '—' }}</span></template>
      </el-table-column>
      <el-table-column label="类型" width="120">
        <template #default="{ row }">{{ intakeTypeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column label="必填" width="80" align="center">
        <template #default="{ row }">{{ row.required ? '是' : '否' }}</template>
      </el-table-column>
      <el-table-column label="选项" min-width="180">
        <template #default="{ row }">
          <span v-if="isSelectType(row.type)">{{ (row.options || []).filter(Boolean).join(' / ') || '—' }}</span>
          <span v-else class="pd-faint">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row, $index }">
          <span v-if="isReadonly" class="pd-faint">只读</span>
          <template v-else>
            <el-button link type="primary" @click="openIntakeEdit(row, $index)">编辑</el-button>
            <el-button link type="danger" @click="deleteIntakeRow($index)">删除</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <!-- 采集字段编辑抽屉 -->
  <!-- 走统一抽屉外壳：随之获得「禁点遮罩关闭」——本抽屉是带输入的编辑态，
       原先点一下遮罩草稿即丢（见 docs/frontend/规范-管理后台列表页.md §6）。 -->
  <DrawerEditor
    v-model:visible="intakeDrawerOpen"
    :title="intakeEditIndex >= 0 ? '编辑采集字段' : '新增采集字段'"
    size="480px"
    append-to-body
  >
    <el-form label-position="top" class="pd-drawer-form">
      <el-form-item label="字段名" required>
        <el-input v-model="intakeDraft.label" maxlength="40" placeholder="如：客户公司名称" />
      </el-form-item>
      <el-form-item label="字段 key（英文，留空自动生成）">
        <el-input v-model="intakeDraft.key" :placeholder="genKeyFromLabel(intakeDraft.label) || 'auto'" />
      </el-form-item>
      <el-form-item label="类型">
        <el-select v-model="intakeDraft.type" style="width: 100%">
          <el-option v-for="t in INTAKE_TYPES" :key="t.value" :value="t.value" :label="t.label" />
        </el-select>
      </el-form-item>
      <el-form-item label="必填">
        <el-switch v-model="intakeDraft.required" />
      </el-form-item>
      <el-form-item v-if="isSelectType(intakeDraft.type)" label="选项">
        <div class="pd-opts">
          <div v-for="(opt, i) in intakeDraft.options" :key="i" class="pd-opt-row">
            <el-input :model-value="opt" placeholder="选项内容" @update:model-value="intakeDraft.options[i] = $event" />
            <el-button link type="danger" @click="removeIntakeOption(i)">✕</el-button>
          </div>
          <el-button link type="primary" @click="addIntakeOption">＋ 添加选项</el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="intakeDrawerOpen = false">取消</el-button>
      <el-button type="primary" @click="saveIntakeDraft">保存</el-button>
    </template>
  </DrawerEditor>
</template>

<style scoped>
/* 样式随模板自 PositionDetailTabs.vue 原样搬入（病 A 拆分）。
   列表头 / 表格 / 抽屉表单类（.pd-list-head / .pd-table / .pd-drawer-form / .pd-opts 等）
   本就是全局 assets/position-detail.css 提供，此处仅需页面容器。 */
/* 常规内容页：照原型 pd2-pane 居中限宽（max-width 1180px），卡片纵向排布 */
.pd-pane {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
</style>
