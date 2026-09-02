<script setup>
/**
 * 用户端「完善信息」弹窗——领用采集表单 + 改采集值复用同一壳。
 *
 * 两种模式（mode）：
 *  - 'claim'：领用时填写采集表单 → 提交 = claimPosition(positionId, intakeValues)。
 *  - 'edit' ：领用后查看/修改已填采集值 → 提交 = updateIntakeValues(positionId, intakeValues)。
 *
 * 行为：
 *  - 打开即 GET intake-schema（loading/错误态/重试齐全）。
 *  - mode='edit' 时回填已填 intakeValues（initialValues）。
 *  - 6 类型动态渲染（IntakeFormFields）+ 必填/类型/选项前端校验。
 *  - 提交前前端校验拦截；后端二次校验失败（1004）按 {field} 字段级红框回显。
 *  - 无采集定义（schema 空）：claim 模式不应弹本弹窗（由调用方判空跳过）；edit 模式给空态提示。
 *
 * 话术（Q14）：标题/按钮用友好措辞「完善信息」，不暴露「采集/Agent/技能」术语。
 * 成功后 emit('done', data) 把后端回包（MyPositionVO）抛给调用方刷新绑定态。
 */
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import IntakeFormFields from './IntakeFormFields.vue'
import { getIntakeSchema, claimPosition, updateIntakeValues } from '@/api/myPosition'
import {
  buildIntakeModel,
  validateIntakeValues,
  normalizeIntakeValues,
  hasIntakeSchema
} from '@/utils/intakeForm'
import { sanitizeInline } from '@/utils/richText'

const props = defineProps({
  visible: { type: Boolean, default: false },
  mode: { type: String, default: 'claim' }, // 'claim' | 'edit'
  positionId: { type: [Number, String], default: null },
  // 展示用（claim 时弹窗头展示岗位名/图标/简介；可由调用方传，schema 内 name 兜底）
  positionName: { type: String, default: '' },
  positionIcon: { type: String, default: '' },
  // edit 模式回填已填值
  initialValues: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:visible', 'done'])

const schema = ref([])
const headName = ref('')
// claimDesc 由 String → 数组 [{emoji,content}]（设计 §3.6）；后端兜底恒为数组，仍防御非数组回退空。
const claimDesc = ref([])
const model = ref({})
const errors = ref({})

// 是否有领用页文案多条（claim 模式 + 非空数组）→ 渲染独立多条区
const hasClaimItems = computed(() => !isEdit.value && claimDesc.value.length > 0)

const loading = ref(false)
const loadError = ref(false)
const submitting = ref(false)

const isEdit = computed(() => props.mode === 'edit')
const title = computed(() =>
  isEdit.value ? '完善信息' : `领用「${headName.value || props.positionName || '搭子'}」`
)
// subtitle 仅作纯文本兜底（§3.6：多条 claimDesc 走独立渲染区，不再塞进 subtitle string）。
const subtitle = computed(() =>
  isEdit.value
    ? '更新下面几项，帮我更懂你的业务'
    : '先填写下面几项，帮我更懂你的业务'
)
const submitText = computed(() => (isEdit.value ? '保存' : '完成领用'))
const hasFields = computed(() => hasIntakeSchema(schema.value))

function close() {
  emit('update:visible', false)
}

async function load() {
  if (props.positionId == null) return
  loading.value = true
  loadError.value = false
  errors.value = {}
  try {
    const data = await getIntakeSchema(props.positionId)
    schema.value = Array.isArray(data?.intakeSchema) ? data.intakeSchema : []
    headName.value = data?.name || props.positionName || ''
    claimDesc.value = Array.isArray(data?.claimDesc) ? data.claimDesc : []
    // edit 模式回填已填值；claim 模式用字段 defaultValue 预填
    model.value = buildIntakeModel(schema.value, isEdit.value ? props.initialValues : null)
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// 打开弹窗即加载 schema（每次打开重拉，保证最新定义）
watch(
  () => props.visible,
  (v) => {
    if (v) load()
  }
)

// 后端字段级错误形如 intakeValues.region → 取末段 key 定位红框
function mapBackendField(field) {
  if (!field) return ''
  const i = String(field).lastIndexOf('.')
  return i >= 0 ? String(field).slice(i + 1) : String(field)
}

async function submit() {
  // 前端校验拦截
  const { ok, errors: errs } = validateIntakeValues(schema.value, model.value)
  errors.value = errs
  if (!ok) {
    ElMessage.warning('请检查标红的必填项')
    return
  }
  submitting.value = true
  const intakeValues = normalizeIntakeValues(schema.value, model.value)
  try {
    const api = isEdit.value ? updateIntakeValues : claimPosition
    const data = await api(props.positionId, intakeValues)
    ElMessage.success(isEdit.value ? '已保存' : '领用成功')
    emit('done', data)
    close()
  } catch (e) {
    // 后端二次校验失败（1004）：按 field 字段级红框回显；非字段错给 toast
    if (e?.code === 1004) {
      const key = mapBackendField(e.field)
      if (key) {
        errors.value = { ...errors.value, [key]: e.message || '该项校验未通过' }
      } else {
        ElMessage.error(e.message || '采集信息校验未通过')
      }
    } else if (e?.code === 1003) {
      ElMessage.error(e.message || '该搭子暂不可领用')
    } else {
      ElMessage.error(e?.message || (isEdit.value ? '保存失败' : '领用失败'))
    }
  } finally {
    submitting.value = false
  }
}

// model 更新时清掉对应字段的旧错误（即时反馈）
function onModelUpdate(next) {
  const changed = []
  for (const k of Object.keys(next)) {
    if (next[k] !== model.value[k]) changed.push(k)
  }
  model.value = next
  if (changed.length && Object.keys(errors.value).length) {
    const e = { ...errors.value }
    changed.forEach((k) => delete e[k])
    errors.value = e
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="520px"
    :close-on-click-modal="false"
    append-to-body
    class="intake-dialog"
    @update:model-value="emit('update:visible', $event)"
  >
    <template #header>
      <div class="idl-head">
        <div class="idl-ic">
          <el-avatar v-if="positionIcon" :size="38" :src="positionIcon" shape="square" />
          <span v-else class="idl-ic-fallback">{{ (headName || positionName || '岗')[0] }}</span>
        </div>
        <div class="idl-head-meta">
          <div class="idl-title">{{ title }}</div>
          <div class="idl-sub">{{ subtitle }}</div>
        </div>
      </div>
    </template>

    <div v-loading="loading" class="idl-body">
      <!-- 领用页文案多条区（§3.6）：emoji + 受限富文本（v-html 前必过 sanitizeInline 净化）；空数组不渲染 -->
      <div v-if="!loading && !loadError && hasClaimItems" class="idl-claims">
        <div v-for="(item, i) in claimDesc" :key="i" class="idl-claim">
          <span class="idl-claim-emoji">{{ item.emoji || '📌' }}</span>
          <span class="idl-claim-text" v-html="sanitizeInline(item.content)"></span>
        </div>
      </div>

      <el-alert
        v-if="loadError"
        type="error"
        title="信息加载失败"
        description="请检查网络或稍后重试。"
        show-icon
        :closable="false"
      >
        <template #default>
          <el-button @click="load">重试</el-button>
        </template>
      </el-alert>

      <el-empty
        v-else-if="!loading && !hasFields"
        description="这位搭子无需填写额外信息"
        :image-size="80"
      />

      <IntakeFormFields
        v-else-if="!loading"
        :schema="schema"
        :model="model"
        :errors="errors"
        @update:model="onModelUpdate"
      />
    </div>

    <template #footer>
      <div class="idl-foot">
        <span v-if="hasFields" class="idl-note">带 <span class="req">*</span> 为必填项</span>
        <span v-else />
        <div class="idl-act">
          <el-button @click="close">{{ hasFields ? '取消' : '关闭' }}</el-button>
          <el-button
            v-if="hasFields"
            type="primary"
            :loading="submitting"
            :disabled="loadError"
            @click="submit"
          >{{ submitText }}</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.idl-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.idl-ic {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-sunken);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}
.idl-ic-fallback {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.idl-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.idl-sub {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  margin-top: 2px;
}
.idl-body {
  min-height: 80px;
  max-height: 56vh;
  overflow: auto;
}
/* 领用页文案多条区（§3.6）：小图标 + 文案，双主题语义令牌不写死色值 */
.idl-claims {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-soft);
}
.idl-claim {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.idl-claim-emoji {
  flex-shrink: 0;
  font-size: var(--fs-md);
  line-height: 1.5;
}
.idl-claim-text {
  font-size: var(--fs-sm);
  color: var(--c-text);
  line-height: 1.5;
  word-break: break-word;
}
.idl-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.idl-note {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.idl-note .req {
  color: var(--c-danger);
}
.idl-act {
  display: flex;
  gap: var(--space-2);
}
</style>
