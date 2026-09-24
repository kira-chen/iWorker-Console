<script setup>
/**
 * 岗位详情 · 「采集字段」页签（md §3：标准列表 + 右侧抽屉编辑，最多 10 个）。
 *
 * 2026-09-10 病 A 拆分（docs/调研讨论/2026-09-09-代码冗余治理第二批方案.md 第 5 项）：
 * 自 PositionDetailTabs.vue 原样抽出，DOM 结构 / class / 交互零变更。
 * 数据直接走 usePositionStore（intakeSchema 挂在 store.basic 上，随顶部【保存】提交）；
 * 保存时的行级校验（validateIntakeRows）仍在父层 doSaveBasic，此处只管列表与抽屉草稿。
 */
import { ref, computed, inject } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { LIMITS, INTAKE_TYPES, isSelectType, genKeyFromLabel } from '@/utils/positionModel'

defineProps({
  // 只读态（列表【查看】进入 / 审核中锁定），由父层统一推导
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()

// 父层 doSaveBasic 跑 validateIntakeRows 的结果（下标 → { label/key/options: 提示 }），逐行标在列表里；
// 此前父层只写入不消费，key 重复等错误保存被拦后页面上看不出是哪一行（2026-09-18 待办 yuepu#13·岗位 P3）。
const intakeErrors = inject('pdIntakeErrors', ref({}))
const rowErr = (idx, field) => intakeErrors.value?.[idx]?.[field] || ''

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
  // 字段 key 须唯一（同 validateIntakeRows 口径：显式填的或由字段名自动生成的 key 都算）。抽屉里就拦下，
  // 不放进列表等保存时才被整体拒绝
  const dupKey = intakeRows.value.some((r, i) => i !== intakeEditIndex.value && ((r.key || '').trim() || genKeyFromLabel(r.label)) === row.key)
  if (row.key && dupKey) { ElMessage.warning(`字段 key 重复：${row.key}`); return }
  const next = [...intakeRows.value]
  if (intakeEditIndex.value >= 0) next[intakeEditIndex.value] = row
  else {
    if (next.length >= LIMITS.INTAKE_MAX) { ElMessage.warning(`最多 ${LIMITS.INTAKE_MAX} 个采集字段`); return }
    next.push(row)
  }
  intakeRows.value = next
  intakeErrors.value = {} // 行有变动，旧的下标错误作废，下次保存/发布重新校验
  intakeDrawerOpen.value = false
  // md 三.3.2：保存后提示「采集字段已保存」，列表刷新（本地即时）
  ElMessage.success('采集字段已保存')
}
async function deleteIntakeRow(index) {
  try {
    await ElMessageBox.confirm('删除该采集字段？删除后员工领用时不再采集该项。', '删除字段', { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' })
  } catch { return }
  intakeRows.value = intakeRows.value.filter((_, i) => i !== index)
  intakeErrors.value = {} // 下标已错位，旧错误作废
  // md 三.3.3：删除后提示「采集字段已删除」
  ElMessage.success('采集字段已删除')
}
function addIntakeOption() { intakeDraft.value.options = [...(intakeDraft.value.options || []), ''] }
function removeIntakeOption(i) { intakeDraft.value.options = (intakeDraft.value.options || []).filter((_, idx) => idx !== i) }
</script>

<template>
  <div class="pd-pane">
    <!-- 2026-09-10 S3（岗位详情原型对齐排查·负责人裁决）：区块头 + 表格整体并入一张白卡
         （照原型 pd2-section 形态，用站内 .pd-card 家族实现，与 Agent 页签同款包卡） -->
    <section class="pd-card">
      <div class="pd-card-head">
        <!-- 表头副题照原型 intakePane L1854；达 10 个【新增采集字段】置灰（md §3.1） -->
        <!-- 2026-09-21 负责人拍板：采集字段必填至少 1 个（发布阻断、保存不阻断），卡头挂必填红星 -->
        <span class="pd-card-title">采集字段<i class="pd-req">*</i></span>
        <span class="pd-card-sub">员工领用时填写，至少 1 个，最多 {{ LIMITS.INTAKE_MAX }} 个</span>
        <span class="pd-card-spacer"></span>
        <el-button v-if="!isReadonly" type="primary" size="small" :disabled="intakeAtLimit" @click="openIntakeCreate">＋ 新增采集字段</el-button>
      </div>
      <div class="pd-card-body pd-card-body--flush">
        <!-- 2026-09-10 D2：锁定态（isReadonly）无【新增采集字段】按钮，空态文案不再引导点按钮 -->
        <el-table :data="intakeRows" class="pd-table" :empty-text="isReadonly ? '暂无采集字段' : '暂无采集字段，点「新增采集字段」添加'">
          <el-table-column type="index" label="#" width="52" />
          <el-table-column label="字段名" min-width="160">
            <template #default="{ row, $index }">
              {{ row.label }}
              <div v-if="rowErr($index, 'label')" class="pd-row-err">{{ rowErr($index, 'label') }}</div>
            </template>
          </el-table-column>
          <el-table-column label="字段 key" min-width="140">
            <template #default="{ row, $index }">
              <span class="pd-mono">{{ row.key || genKeyFromLabel(row.label) || '—' }}</span>
              <div v-if="rowErr($index, 'key')" class="pd-row-err">{{ rowErr($index, 'key') }}</div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="120">
            <template #default="{ row }">{{ intakeTypeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column label="必填" width="80" align="center">
            <template #default="{ row }">{{ row.required ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column label="选项" min-width="180">
            <template #default="{ row, $index }">
              <span v-if="isSelectType(row.type)">{{ (row.options || []).filter(Boolean).join(' / ') || '—' }}</span>
              <span v-else class="pd-faint">—</span>
              <div v-if="rowErr($index, 'options')" class="pd-row-err">{{ rowErr($index, 'options') }}</div>
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
    </section>
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
/* ---- 白卡包裹（2026-09-10 S3）：.pd-card 家族按页签就近持有（同 Agent 页签的 scope 复制口径，
   照原型 pd2-section：白底/描边/圆角卡，头行 + 分隔线 + 体；表格贴卡体边走 --flush） ---- */
.pd-card {
  background: var(--bg-surface);
  /* 2026-09-10 A 组盒模型对表：卡描边走 --border-admin-card（浅色 #dde4e0 ≈ 原型
     pd2-section 的 #dfe5e1，暗色自动落 --border-base），此前 --border-base 在浅色下
     是 10% 黑的半透明灰、比原型描边淡一档 */
  border: 1px solid var(--border-admin-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.pd-card-head {
  min-height: 50px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* 对表：原型 pd2-list-head 定高 50px、纵向 padding 为 0（靠 min-height + 居中撑），
     现状多加了上下 8px，实测卡头比原型高一档 */
  padding: 0 var(--space-4);
  /* 2026-09-10 像素账本 G3 附带：卡头分隔线与卡描边同浓度（原不透明 vs 半透明差一档） */
  border-bottom: 1px solid var(--border-admin-card);
  /* 对表：卡头灰条走站内 --bg-admin-card-head（浅色 #f8faf9 = 原型同值，暗色有映射） */
  background: var(--bg-admin-card-head);
}
/* 行级校验提示（key 重复 / 字段名空 / 选项空），列表单元格内红字 */
.pd-row-err {
  color: var(--c-danger);
  font-size: var(--fs-xs);
  line-height: 1.4;
}
/* 必填红星（与人格页签卡头 .pd-req 同款） */
.pd-req {
  color: var(--c-danger);
  font-style: normal;
  margin: 0 0 0 2px;
}
.pd-card-title {
  display: inline-flex;
  align-items: center;
  font-size: var(--fs-md);
  /* 对表：原型 pd2-list-head strong 为 <strong> 默认 700，现状 600 偏轻 */
  font-weight: var(--fw-bold);
  color: var(--c-text-strong);
  white-space: nowrap;
}
.pd-card-sub {
  font-size: var(--fs-xs);
  font-weight: var(--fw-regular);
  color: var(--c-text-muted);
}
.pd-card-spacer {
  margin-left: auto;
}
.pd-card-body--flush {
  padding: 0;
}
</style>
