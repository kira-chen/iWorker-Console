<script setup>
/**
 * SkillCreateDialog —— 新建技能对话框（技能页 / 岗位白板共用一套）。
 *
 * 【2026-09-01 PRD 对齐改造（对齐交互原型 v2 最终覆写态 openSkillCreate/saveSkillCreate）】
 * 技能页语境（传 typeOptions 启用内置类型选择）下：
 * - zip 模式：上传区文案「拖拽技能包 .zip 到此 · 或点击选择」/「支持一次选择多个 .zip · 每个包上传后
 *   分别选择技能分类」；每个技能包**独立必选**技能分类（固定 8 类，fieldDict 同源，占位「请选择技能分类」，
 *   三类技能均显示）；确认按钮【导入技能包】（疑点2 处置）；未选拦截红字
 *   「请选择技能类型、上传技能包，并为每个技能包选择分类」（疑点3 处置）。
 *   导入完成统一返回列表（emit created-batch，不自动进编辑页；toast 由父级发）。
 * - 手动模式：必选「技能分类」+ 技能名（maxlength 64、占位「给技能起个名字」）；返回链接
 *   「← 改用上传技能包（zip）」；按钮【创建】；未填拦截红字「请选择技能类型、技能分类并填写技能名」。
 *   成功 emit('created') 由父级 toast「技能已创建，已进入编辑页」并同标签进编辑页。
 * - createFn 契约升级：typeOptions[].createFn({ name, categoryName })（技能页走 createSkillOfType）。
 *
 * 岗位白板等既有调用方（不传 typeOptions）行为保持改造前一致：无类型区/无分类列、单包成功仍走
 * created 直达编辑器、createFn(name) 旧签名。
 */
import { ref, watch, nextTick, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { importSkillZip } from '@/api/skillFiles'
// 技能分类选项统一同源 fieldDict（固定 8 类，2026-09-01 疑点8 处置）
import { listFieldDict } from '@/api/fieldDict'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '新建技能' },
  /**
   * 文件接口数据源：'fde' | 'platform' | 'system'（透传 importSkillZip 的 source）。
   * <b>仅在未启用内置类型选择（typeOptions 为空）时生效</b>——启用时由弹窗内所选类型推导。
   */
  source: { type: String, default: 'fde' },
  /** 可选：zip 导入直接挂到该 Agent 下（岗位白板场景）；不传则建游离/平台技能 */
  agentId: { type: [String, Number], default: null },
  /**
   * 手动创建空白技能。启用内置类型选择时签名为 async ({ name, categoryName }) => 含 skillId 的 VO；
   * 未启用时保持旧签名 async (name) => VO（岗位白板等既有调用方不受影响）。
   */
  createFn: { type: Function, default: null },
  /** 手动创建模式下的提示文案（未启用内置类型选择时使用） */
  hint: { type: String, default: '' },
  /**
   * 技能类型内置选择：传入非空数组即在本弹窗顶部渲染类型单选。
   * 每项 { value, label, source, createFn }。不传（默认空）时组件行为与改造前完全一致。
   */
  typeOptions: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'created', 'created-batch'])

/* ---------- 技能类型 ---------- */
const typeEnabled = computed(() => props.typeOptions.length > 0)
/** 不预选：类型建后不可更改，强制手动选一次。 */
const pickedType = ref(null)
const pickedTypeOption = computed(
  () => props.typeOptions.find((t) => t.value === pickedType.value) || null
)
const typeMissing = computed(() => typeEnabled.value && !pickedType.value)

const effectiveSource = computed(() =>
  typeEnabled.value ? pickedTypeOption.value?.source || '' : props.source
)
const effectiveCreateFn = computed(() =>
  typeEnabled.value ? pickedTypeOption.value?.createFn || null : props.createFn
)
const effectiveHint = computed(() => (typeEnabled.value ? '' : props.hint))

// 新建模式：'zip'（主，默认）/ 'manual'（次，就地切换）。
const createMode = ref('zip')
const createName = ref('')
const createCategory = ref('') // 手动模式必选技能分类（技能页语境）
const creating = ref(false)
const manualError = ref('') // 手动模式拦截红字（疑点3：分场景文案）
// zip 上传态（多包批量）：自管待导入列表，el-upload 只当选择/拖拽入口（show-file-list=false）。
// 列表项：{ key, name, raw, categoryId, status: 'pending'|'importing'|'done'|'error', error, skillId }
const zipItems = ref([])
let zipSeq = 0
const zipImporting = ref(false)
const zipError = ref('') // 批级回显（含疑点3 的 zip 场景拦截文案）；单包导入失败红字在各自行内
const zipUploadRef = ref(null)

/* ---------- 技能分类（2026-09-01：固定 8 类 fieldDict 同源；三类技能均显示、每包独立必选） ---------- */
const categoryOptions = ref([])
const showCategorySelect = computed(() => typeEnabled.value)
async function loadCategoryOptions() {
  if (!typeEnabled.value) return
  try {
    const dict = await listFieldDict()
    categoryOptions.value = (dict?.skillCategory || []).map((c) => ({ id: c.name, name: c.name }))
  } catch {
    categoryOptions.value = [] // 读失败降级：选择器空下拉，不阻断上传
  }
}

// 每次打开重置为初始态（zip 为主入口）。
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      createMode.value = 'zip'
      createName.value = ''
      createCategory.value = ''
      manualError.value = ''
      pickedType.value = null // 每次打开都强制重选类型（建后不可更改，误继承代价高）
      zipItems.value = []
      zipError.value = ''
      zipImporting.value = false
      creating.value = false
      loadCategoryOptions()
      // el-upload 自持文件列表：打开时清掉上次残留（nextTick 兜 ref 未挂上的时序，清空幂等）。
      zipUploadRef.value?.clearFiles?.()
      nextTick(() => zipUploadRef.value?.clearFiles?.())
    }
  }
)

function close() {
  emit('update:modelValue', false)
}

/* ---------- zip 上传创建（多包批量；每包独立分类） ---------- */
function onZipChange(uploadFile) {
  const raw = uploadFile?.raw || uploadFile
  const name = uploadFile?.name || raw?.name || ''
  if (zipItems.value.some((i) => i.name === name)) {
    zipError.value = `「${name}」已在待导入列表中（同一批 zip 包不能重名），已跳过`
  } else {
    zipItems.value.push({ key: ++zipSeq, name, raw, categoryId: null, status: 'pending', error: '', skillId: null })
    zipError.value = ''
  }
  nextTick(() => zipUploadRef.value?.clearFiles?.())
}
function removeZipItem(key) {
  if (zipImporting.value) return
  zipItems.value = zipItems.value.filter((i) => i.key !== key)
  zipError.value = ''
}

const ZIP_GUARD_TEXT = '请选择技能类型、上传技能包，并为每个技能包选择分类'
const MANUAL_GUARD_TEXT = '请选择技能类型、技能分类并填写技能名'

async function confirmImportZip() {
  // 拦截（疑点3 zip 场景文案）：类型未选 / 无包 / 任一包未选分类（分类校验仅技能页语境）
  const pendingItems = zipItems.value.filter((i) => i.status !== 'done')
  const missingCategory = typeEnabled.value && pendingItems.some((i) => !i.categoryId)
  if (typeMissing.value || !zipItems.value.length || missingCategory) {
    zipError.value = typeEnabled.value ? ZIP_GUARD_TEXT : '请先选择 .zip 技能包'
    return
  }
  const single = zipItems.value.length === 1
  zipImporting.value = true
  zipError.value = ''
  const created = []
  // 逐包串行导入（量级为个位数包，耗时可接受）。
  for (const item of zipItems.value) {
    if (item.status === 'done') continue
    item.status = 'importing'
    item.error = ''
    try {
      const data = await importSkillZip(item.raw, {
        agentId: props.agentId,
        source: effectiveSource.value,
        // 每包独立技能分类（2026-09-01 必选；demo 分类名即 id）
        displayCategoryId: item.categoryId || undefined
      })
      item.status = 'done'
      item.skillId = data.skillId
      created.push(data.skillId)
    } catch (e) {
      // 整包导入失败（缺 SKILL.md / 非 zip / 超限）行内红字回显，不弹全局 toast、不关弹窗、不清该包。
      item.status = 'error'
      item.error = e?.message || '导入失败，请检查压缩包'
    }
  }
  zipImporting.value = false
  const failed = zipItems.value.filter((i) => i.status === 'error')
  if (!failed.length) {
    close()
    if (typeEnabled.value) {
      // 技能页语境：zip 导入完成统一返回列表（单包也不自动进编辑页），父级 toast 引导从列表点编辑。
      emit('created-batch', { skillIds: created, mode: 'zip', skillType: pickedType.value })
    } else if (single) {
      emit('created', { skillId: created[0], mode: 'zip', skillType: pickedType.value }) // 岗位白板旧行为：单包直达编辑器
    } else {
      emit('created-batch', { skillIds: created, mode: 'zip', skillType: pickedType.value })
    }
  } else {
    // 部分失败：成功项移出列表（防重复导入）并即时通知父级刷列表；失败项留列表可修正后重试/删除。
    zipItems.value = failed
    zipError.value = created.length
      ? `已导入 ${created.length} 个，${failed.length} 个失败——失败原因见各行红字，可删除后重选或直接重试`
      : ''
    if (created.length)
      emit('created-batch', { skillIds: created, mode: 'zip', skillType: pickedType.value })
  }
}

// 确认新建：createFn 建空白技能拿 skillId 后交回父级继续（同标签进编辑页由父级决定）。
async function confirmCreate() {
  const name = createName.value.trim()
  if (typeEnabled.value) {
    // 拦截（疑点3 手动场景文案）：类型 / 分类 / 技能名任一缺失
    if (typeMissing.value || !createCategory.value || !name) {
      manualError.value = MANUAL_GUARD_TEXT
      return
    }
  } else if (!name) {
    ElMessage.warning('请输入技能名')
    return
  }
  manualError.value = ''
  creating.value = true
  try {
    const data = typeEnabled.value
      ? await effectiveCreateFn.value({ name, categoryName: createCategory.value })
      : await effectiveCreateFn.value(name)
    close()
    emit('created', { skillId: data.skillId, mode: 'manual', skillType: pickedType.value })
  } catch (e) {
    ElMessage.error(e?.message || '新建失败')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="480px"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 技能类型：不预选，选定前提交按钮禁用；类型决定分发通道，建后不可更改。 -->
    <div v-if="typeEnabled" class="type-pick-block">
      <div class="type-pick-label">技能类型<span class="type-pick-req">*</span></div>
      <el-radio-group v-model="pickedType" class="type-pick" :disabled="zipImporting || creating">
        <el-radio v-for="t in typeOptions" :key="t.value" :value="t.value" border>
          {{ t.label }}
        </el-radio>
      </el-radio-group>
      <div class="type-pick-warn">技能类型建成后不可更改，跨类型需导出后重新导入。</div>
    </div>

    <!-- 主交互：zip 大拖拽区（多包批量：multiple 可多选/多次追加；列表自管） -->
    <template v-if="createMode === 'zip'">
      <el-upload
        ref="zipUploadRef"
        class="zip-drop"
        drag
        multiple
        :auto-upload="false"
        :show-file-list="false"
        accept=".zip"
        :on-change="onZipChange"
        :disabled="zipImporting || typeMissing"
      >
        <el-icon class="zip-up-icon"><UploadFilled /></el-icon>
        <div class="zip-up-text">拖拽技能包 .zip 到此 · 或<em>点击选择</em></div>
        <template #tip>
          <div class="zip-up-tip">支持一次选择多个 .zip · 每个包上传后分别选择技能分类</div>
        </template>
      </el-upload>
      <!-- 待导入列表：每包一行——包名 + 独立必选「技能分类」下拉 + 独立删除；失败行内红字 -->
      <div v-if="zipItems.length" class="zip-list">
        <div
          v-for="item in zipItems"
          :key="item.key"
          class="zip-item"
          :class="{ 'is-error': item.status === 'error' }"
        >
          <div class="zip-item-main">
            <span class="zip-item-name" :title="item.name">{{ item.name }}</span>
            <el-select
              v-if="showCategorySelect"
              v-model="item.categoryId"
              class="zip-item-cat"
              size="small"
              placeholder="请选择技能分类"
              clearable
              :disabled="zipImporting"
            >
              <el-option v-for="c in categoryOptions" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <span v-if="item.status === 'importing'" class="zip-item-state">导入中…</span>
            <span v-else-if="item.status === 'done'" class="zip-item-state is-ok">已导入</span>
            <button
              type="button"
              class="zip-item-del"
              :disabled="zipImporting"
              aria-label="移除该包"
              @click="removeZipItem(item.key)"
            >✕</button>
          </div>
          <div v-if="item.error" class="zip-item-err">{{ item.error }}</div>
        </div>
      </div>
      <!-- 批级回显区：拦截文案（疑点3）/ 重名跳过 / 批量结果汇总（单包失败原因在行内红字） -->
      <div v-if="zipError" class="zip-error">{{ zipError }}</div>
      <!-- 弱分隔 + 手动创建次入口（就地切换，不跳窗） -->
      <div class="create-alt">
        <span class="create-alt-or">或</span>
        <button type="button" class="create-alt-link" @click="createMode = 'manual'">
          手动创建空白技能
        </button>
      </div>
    </template>

    <!-- 次入口：手动创建空白技能（同对话框就地切换）——必选分类 + 技能名 -->
    <template v-else>
      <el-form label-position="top" @submit.prevent>
        <el-form-item v-if="showCategorySelect" required>
          <template #label>技能分类</template>
          <el-select
            v-model="createCategory"
            placeholder="请选择技能分类"
            clearable
            class="create-cat"
            :disabled="creating"
          >
            <el-option v-for="c in categoryOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item :required="typeEnabled">
          <template #label>技能名</template>
          <el-input
            v-model="createName"
            placeholder="给技能起个名字"
            maxlength="64"
            show-word-limit
            @keyup.enter="confirmCreate"
          />
        </el-form-item>
        <p v-if="effectiveHint" class="create-hint">{{ effectiveHint }}</p>
        <div v-if="manualError" class="zip-error">{{ manualError }}</div>
        <button type="button" class="create-alt-link" @click="createMode = 'zip'">
          ← 改用上传技能包（zip）
        </button>
      </el-form>
    </template>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button
        v-if="createMode === 'manual'"
        type="primary"
        :loading="creating"
        :disabled="typeMissing"
        @click="confirmCreate"
      >
        {{ typeEnabled ? '创建' : '创建并编辑' }}
      </el-button>
      <el-button
        v-else
        type="primary"
        :loading="zipImporting"
        :disabled="typeMissing"
        @click="confirmImportZip"
      >
        <!-- 疑点2 处置：zip 导入确认按钮文案「导入技能包」（技能页语境）；旧调用方保持原文案 -->
        {{ zipImporting ? '导入中…' : (typeEnabled ? '导入技能包' : (zipItems.length > 1 ? `导入 ${zipItems.length} 个技能包` : '导入并编辑')) }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 技能类型区：置于弹窗顶部，与下方上传区弱分隔 */
.type-pick-block {
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-soft);
}
.type-pick-label {
  font-size: var(--fs-sm);
  color: var(--c-text);
  margin-bottom: var(--space-2);
}
.type-pick-req {
  color: var(--c-danger);
  margin-left: 2px;
}
.type-pick {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.type-pick :deep(.el-radio) {
  margin-right: 0;
}
/* 「建后不可更改」常驻警示 */
.type-pick-warn {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
  line-height: 1.5;
}
.create-hint {
  margin: var(--space-1) 0 var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
}
.create-cat {
  width: 100%;
}
/* zip 大拖拽区为主：拔高拖拽区 ~140px、大图标，居中 */
.zip-drop :deep(.el-upload-dragger) {
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.zip-up-icon {
  font-size: 48px;
  color: var(--c-text-faint);
  margin-bottom: var(--space-2);
}
/* 手动创建次入口：弱分隔 + 小链接 */
.create-alt {
  margin-top: var(--space-4);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border-top: 1px solid var(--border-soft);
  padding-top: var(--space-3);
}
.create-alt-or {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.create-alt-link {
  border: none;
  background: transparent;
  color: var(--c-accent);
  font-size: var(--fs-sm);
  cursor: pointer;
  padding: 0;
}
.create-alt-link:hover {
  text-decoration: underline;
}
.zip-up-text {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.zip-up-text em {
  color: var(--c-accent);
  font-style: normal;
}
.zip-up-tip {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
/* 待导入列表：包名弹性收缩省略，分类下拉/状态/删除靠右 */
.zip-list {
  margin-top: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 220px;
  overflow-y: auto;
}
.zip-item {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken, transparent);
}
.zip-item.is-error {
  border-color: var(--c-danger);
}
.zip-item-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.zip-item-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  color: var(--c-text);
}
/* 每包独立必选分类：占位「请选择技能分类」6 汉字 + 箭头 ≈ 132px */
.zip-item-cat {
  flex-shrink: 0;
  width: 132px;
}
.zip-item-state {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.zip-item-state.is-ok {
  color: var(--c-accent);
}
.zip-item-del {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
  line-height: 1;
  padding: var(--space-1);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.zip-item-del:hover:not(:disabled) {
  color: var(--c-danger);
  background: var(--bg-hover);
}
.zip-item-del:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.zip-item-err {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-danger);
  line-height: 1.5;
  word-break: break-word;
}
/* 失败/拦截回显区：红字 + 浅红底 */
.zip-error {
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--c-danger-soft);
  color: var(--c-danger);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  line-height: 1.5;
  word-break: break-word;
}
</style>
