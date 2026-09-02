<script setup>
/**
 * 模型接入 / 编辑 / 查看 —— 右侧抽屉（ADMIN 专属，V76/V77；2026-08-20 由弹窗改抽屉）。
 *
 * 2026-09-01 PRD 对齐改造（交互原型 v2 openModelDrawer L235）：抽屉重排为分区卡片，
 * 与 McpEditor / ApiEditor 同构 —— 厂商预设（仅新建，卡片网格单选）/ 基本信息 /
 * 连接与鉴权（含「服务地址（Base URL）」，MQ4 指示按原型放本区）/ 能力信息
 * （已识别能力之后放「额外参数」）/ 底部弱化时间行（仅编辑/查看态）。
 *
 * - 厂商预设卡片（M9）：DeepSeek/Qwen/Kimi/GLM/讯飞/自定义 六张，副文案
 *   「OpenAI 兼容协议」/「手动配置」，选中高亮；预填行为保持现状（modelPresets.js 不动）。
 * - 每个参数带 ? 悬浮说明（FieldHelpLabel，小白版文案见 modelPresets.FIELD_TIPS）。
 * - authType 切换字段组：API_KEY（api_key）| APP_ID_SECRET（app_id + api_key + app_secret 三元组）。
 * - 凭据字段 password 型；编辑态占位「留空不修改」，留空提交即保留既有密钥。
 * - 保存即返回（1 秒内关闭），连通性验证交列表行内跑——用户点「保存」要的是保存，不是等 40 秒。
 * - 编辑已发布模型的连接字段（baseUrl/model/authType/appId/密钥/extra_body）时先弹确认：
 *   会强制回未发布 + 清空验证态，线上即下线。
 * - 写接口 ApiError 带 field 时红框定位到对应表单项。
 */
import { ref, reactive, computed, watch } from 'vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import FieldHelpLabel from '@/components/admin/FieldHelpLabel.vue'
import ModelCapabilityTags from '@/components/admin/ModelCapabilityTags.vue'
import { createModel, updateModel, verifyModel } from '@/api/adminModel'
import { fmtTime } from '@/utils/docMeta'
import {
  MODEL_PRESETS,
  MODEL_PROVIDER_OPTIONS,
  CONTEXT_WINDOW_OPTIONS,
  MODEL_CATEGORY_OPTIONS,
  MODEL_CATEGORY_LABELS,
  FIELD_TIPS
} from '@/utils/modelPresets'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 只读查看（V95「查看」入口）：表单整体禁用、隐藏保存，仅供复核与审核锁定期查看
  readonly: { type: Boolean, default: false },
  /** 编辑目标（null=新建）。取自列表行 VO：凭据仅 apiKeyMasked/hasAppSecret 信号，无明文。 */
  model: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'saved'])

const formRef = ref(null)
const saving = ref(false)
const verifying = ref(false)
// 保存后就地回显的验证结果（null=尚未验证）
const verifyResult = ref(null)
// 当前选中的厂商预设 key（仅新建态使用）
const presetKey = ref('')
// 新建态首次保存成功后的行 id（CR-正确性项）：验证失败弹窗不关，用户改完再点保存必须走 update
// 而非二次 create（否则同名 409 / 改名产生重复行）
const createdId = ref(null)

const isEdit = computed(() => !!(props.model?.id || createdId.value))
// 当前保存目标行 id（编辑态=props，新建态=首次 create 返回的 id）
const targetId = computed(() => props.model?.id || createdId.value)
const TIPS = FIELD_TIPS

/**
 * 厂商预设卡片（2026-09-01 PRD 对齐，M9/原型 preset-grid）：六张卡按原型命名，
 * 映射到既有 MODEL_PRESETS 预填数据（modelPresets.js 不动，仅换选择交互形态）。
 */
const PRESET_CARDS = [
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'dashscope', label: 'Qwen' },
  { key: 'moonshot', label: 'Kimi' },
  { key: 'zhipu', label: 'GLM' },
  { key: 'iflytek', label: '讯飞' },
  { key: 'custom', label: '自定义' }
]

const form = reactive({
  providerName: '',
  name: '',
  category: '',
  baseUrl: '',
  model: '',
  description: '',
  authType: 'API_KEY',
  apiKey: '',
  appId: '',
  appSecret: '',
  contextWindow: null,
  // 最大输出（V84 起隐藏）：本仓库无实际调用消费，表单不再展示、无默认值；仅隐式回传保留存量值。
  maxOutputTokens: null,
  defaultTemperature: null,
  extraBody: ''
})

const rules = computed(() => ({
  providerName: [{ required: true, message: '请选择模型提供商', trigger: 'change' }],
  name: [{ required: true, message: '请输入模型名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择模型类别', trigger: 'change' }],
  baseUrl: [
    { required: true, message: '请输入服务地址（Base URL）', trigger: 'blur' },
    // 禁 ?/#/空白（与后端同规则）：拼 /chat/completions 时 query 会被路径污染成非法 URL
    {
      pattern: /^https?:\/\/[^?#\s]+$/,
      message: '服务地址必须以 http:// 或 https:// 开头，且不能包含空格、? 或 #',
      trigger: 'blur'
    }
  ],
  model: [{ required: true, message: '请输入模型标识（如 deepseek-chat）', trigger: 'blur' }],
  contextWindow: [
    { required: true, message: '请选择或输入上下文窗口', trigger: 'change' },
    // allow-create 手输校验（CR-正确性项）：输入「128K」这类非数字会被 Number() 变 null，
    // 后端报「不能为空」与表单所见矛盾——就地拦截并给出正确示例
    {
      validator: (rule, value, cb) => {
        if (value === null || value === '') return cb()
        const n = Number(value)
        if (!Number.isInteger(n) || n < 1024) {
          return cb(new Error('请输入 token 数字（≥1024），如 65536；不要带 K 等单位'))
        }
        cb()
      },
      trigger: 'change'
    }
  ],
  extraBody: [
    {
      validator: (rule, value, cb) => {
        if (!value || !value.trim()) return cb()
        try {
          const parsed = JSON.parse(value)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return cb(new Error('必须是 JSON 对象，如 {"enable_thinking": false}'))
          }
          cb()
        } catch (e) {
          cb(new Error('不是合法的 JSON，请检查格式'))
        }
      },
      trigger: 'blur'
    }
  ],
  apiKey: !isEdit.value ? [{ required: true, message: '请输入 api_key', trigger: 'blur' }] : [],
  appId:
    form.authType === 'APP_ID_SECRET'
      ? [{ required: true, message: '请输入 app_id', trigger: 'blur' }]
      : [],
  appSecret:
    form.authType === 'APP_ID_SECRET' && !isEdit.value
      ? [{ required: true, message: '请输入 app_secret', trigger: 'blur' }]
      : []
}))

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    verifyResult.value = null
    presetKey.value = ''
    createdId.value = null
    const m = props.model
    form.providerName = m?.providerName || ''
    form.name = m?.name || ''
    form.category = m?.category || ''
    form.baseUrl = m?.baseUrl || ''
    form.model = m?.model || ''
    // description 无输入位但必须回填+透传：后端 update 为整体替换语义（setDescription(req.getDescription())），
    // payload 漏传会把存量描述抹成 null——删除本行前先看 ModelConfigAdminService.update
    form.description = m?.description || ''
    form.authType = m?.authType || 'API_KEY'
    form.apiKey = ''
    form.appId = m?.appId || ''
    form.appSecret = ''
    form.contextWindow = m?.contextWindow ?? null
    // 隐式回传存量值（字段已隐藏、无默认）：新建=null，编辑=原值原样带回，避免保存时把存量抹成 null
    form.maxOutputTokens = m?.maxOutputTokens ?? null
    form.defaultTemperature = m?.defaultTemperature ?? null
    form.extraBody = m?.extraBody || ''
    formRef.value?.clearValidate()
  }
)

/**
 * 已配置凭据的展示掩码（2026-08-22 负责人口径）：后端回首尾明文掩码
 * （长度 > 8 露前 3 后 3，≤ 8 露前 2 后 2，中间铺 *），供管理员核对「配的是不是这把密钥」。
 *
 * 为何不塞进 el-input 的 value：输入框是 type="password"，把掩码填进去会被再打一层圆点、
 * 且用户一旦聚焦就会误以为要在原值上编辑（实际留空才是不修改）。故掩码只作为输入框下方的
 * 只读提示文本呈现，输入框本身仍保持「留空不修改」语义。
 */
const apiKeyMask = computed(() => (isEdit.value ? props.model?.apiKeyMasked || '' : ''))
const appSecretMask = computed(() => (isEdit.value ? props.model?.appSecretMasked || '' : ''))

// 底部弱化时间行（仅编辑/查看态；未发布显「—」）
const timeRow = computed(() => ({
  created: props.model?.createdAt ? fmtTime(props.model.createdAt) : '—',
  updated: props.model?.updatedAt ? fmtTime(props.model.updatedAt) : '—',
  published: props.model?.publishedAt ? fmtTime(props.model.publishedAt) : '—'
}))

// 选厂商预设卡片 → 预填（可改不锁死）；不覆盖已填的名称/描述/凭据
function selectPreset(key) {
  if (props.readonly) return
  presetKey.value = key
  const p = MODEL_PRESETS.find((x) => x.key === key)
  if (!p) return
  form.baseUrl = p.baseUrl
  form.authType = p.authType
  form.model = ''
  form.contextWindow = p.contextWindow
  // 最大输出已隐藏、无默认：不再随预设写入（避免重新引入 4096 默认）
  form.defaultTemperature = p.defaultTemperature
  formRef.value?.clearValidate()
}

function close() {
  emit('update:visible', false)
}

// 连接字段是否有变更（编辑态判断是否需要「回未发布重审」确认）。
// 字段清单须与 mock（adminModelMock.connChanged）保持同步——两边同改，漏改会导致弹窗提示偏松/偏紧。
function connectionChanged() {
  const m = props.model
  if (!m) return false
  return (
    form.baseUrl.trim() !== (m.baseUrl || '') ||
    form.model.trim() !== (m.model || '') ||
    form.authType !== (m.authType || 'API_KEY') ||
    (form.appId.trim() || '') !== (m.appId || '') ||
    (form.extraBody.trim() || '') !== (m.extraBody || '') ||
    !!form.apiKey ||
    !!form.appSecret
  )
}

async function save() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  if (
    isEdit.value &&
    ['PUBLISHED', 'PENDING_REVIEW', 'DELISTED'].includes(props.model?.status) &&
    connectionChanged()
  ) {
    // 改连接字段会把状态打回未发布 + 清空验证态。对「已发布」行这意味着**立即下线**——
    // 必须讲清楚，否则改个地址就把线上模型改没了还不自知。
    const online = props.model?.status === 'PUBLISHED'
    try {
      await ElMessageBox.confirm(
        online
          ? '修改连接信息（地址/模型/鉴权/额外参数）会让该模型回到未发布状态，客户端将无法再获取它的调用配置。'
            + '保存后需重新验证连通性，并重新发布才能恢复。确认修改？'
          : '修改连接信息（地址/模型/鉴权/额外参数）后需重新验证连通性，验证通过后才可发布。确认修改？',
        '连接信息变更',
        { type: 'warning', confirmButtonText: '确认修改' }
      )
    } catch (e) {
      return
    }
  }

  // 改「当前是默认」模型的类别：后端会取消其默认标记（每类默认独立），先告知——避免管理员误以为默认还在
  if (isEdit.value && props.model?.isDefault && form.category !== (props.model?.category || '')) {
    const oldLabel = MODEL_CATEGORY_LABELS[props.model?.category] || props.model?.category || '原类别'
    try {
      await ElMessageBox.confirm(
        `该模型当前是「${oldLabel}」类别的默认模型。修改类别后它将不再是默认模型（如需默认，请到新类别重新设置）。确认修改？`,
        '类别变更',
        { type: 'warning', confirmButtonText: '确认修改' }
      )
    } catch (e) {
      return
    }
  }

  saving.value = true
  verifyResult.value = null
  try {
    const payload = {
      providerName: form.providerName || null,
      name: form.name.trim(),
      category: form.category,
      baseUrl: form.baseUrl.trim(),
      model: String(form.model).trim(),
      description: form.description || null,
      authType: form.authType,
      apiKey: form.apiKey || null,
      appId: form.appId.trim() || null,
      appSecret: form.appSecret || null,
      contextWindow: Number(form.contextWindow) || null,
      maxOutputTokens: Number(form.maxOutputTokens) || null,
      defaultTemperature: form.defaultTemperature === null || form.defaultTemperature === '' ? null : Number(form.defaultTemperature),
      extraBody: form.extraBody.trim() || null
    }
    if (targetId.value) {
      await updateModel(targetId.value, payload)
    } else {
      const saved = await createModel(payload)
      createdId.value = saved?.id || null // 记住新行：后续保存走 update，防二次 create
    }
    // 保存即返回（1 秒内关闭弹窗），验证交给列表行内跑（约 40 秒）。
    // 旧实现在这里 await 验证，用户点「保存」却被扣住 40 秒——他要的是保存，不是等验证。
    ElMessage.success('已保存，正在验证连通性…')
    emit('saved', { verifyId: targetId.value })
    close()
  } catch (e) {
    if (e?.field) {
      // 字段级错误红框定位（ApiError.field 对应表单 prop）
      formRef.value?.validateField?.(e.field)
    }
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

/**
 * 就地重测连通性（编辑态）。
 *
 * 保留本入口是因为：改完配置想立刻确认「这次对了没」，回列表再点一次是多余的往返。
 * 与列表行内验证的区别仅在触发位置，结论同样落库、列表随后刷新。
 */
async function verifyOnly() {
  const id = targetId.value
  if (!id) return
  verifying.value = true
  try {
    const r = await verifyModel(id)
    verifyResult.value = r
    // 检活提示统一口径（2026-09-01 PRD 对齐，与列表行内同文案）
    if (r?.verifyStatus === 'SUCCESS') {
      ElMessage.success('检活完成 · 连接正常')
    } else if (r?.verifyStatus === 'FAILED') {
      ElMessage.warning('检活完成 · 连接异常')
    } else {
      ElMessage.info('检活完成')
    }
    emit('saved')
  } catch (e) {
    ElMessage.error(e?.message || '检活失败，请稍后重试')
  } finally {
    verifying.value = false
  }
}
</script>

<template>
  <!--
    形态：右侧抽屉 720px，与三个连接器编辑器（McpEditor / ApiEditor / BizSystemEditor）一致。
    2026-09-01 PRD 对齐：正文重排为分区卡片（厂商预设 / 基本信息 / 连接与鉴权 / 能力信息 /
    底部时间行），与原型 openModelDrawer 的 section 结构同构。
  -->
  <DrawerEditor
    :visible="visible"
    :title="props.readonly ? '查看模型' : isEdit ? '编辑模型' : '接入模型'"
    :readonly="props.readonly"
    :saving="saving"
    @update:visible="close"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      :disabled="props.readonly"
      class="mc-form"
    >
      <!-- 厂商预设（仅新建态，M9 卡片网格单选）：预填可改不锁死 -->
      <section v-if="!isEdit" class="mc-sec">
        <div class="mc-sec-title">
          厂商预设
          <span class="mc-sec-sub">自动填充推荐地址，模型标识仍需填写</span>
        </div>
        <div class="mc-preset-grid">
          <button
            v-for="p in PRESET_CARDS"
            :key="p.key"
            type="button"
            class="mc-preset-card"
            :class="{ active: presetKey === p.key }"
            :disabled="props.readonly"
            @click="selectPreset(p.key)"
          >
            <span class="mc-preset-name">{{ p.label }}</span>
            <span class="mc-preset-sub">{{ p.key === 'custom' ? '手动配置' : 'OpenAI 兼容协议' }}</span>
          </button>
        </div>
      </section>

      <!-- 基本信息 -->
      <section class="mc-sec">
        <div class="mc-sec-title">基本信息</div>
        <div class="mc-grid">
          <el-form-item prop="providerName">
            <template #label>
              <FieldHelpLabel label="模型提供商" :tip="TIPS.provider" />
            </template>
            <el-select v-model="form.providerName" placeholder="请选择模型提供商" class="mc-full">
              <el-option
                v-for="o in MODEL_PROVIDER_OPTIONS"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item prop="name">
            <template #label>
              <FieldHelpLabel label="模型名称" :tip="TIPS.name" />
            </template>
            <!-- 2026-09-01 PRD 对齐：名称上限 100 → 64（与连接器名称同口径） -->
            <el-input v-model="form.name" maxlength="64" placeholder="如 DeepSeek R1" />
          </el-form-item>

          <el-form-item prop="category">
            <template #label>
              <FieldHelpLabel label="模型类别" :tip="TIPS.category" />
            </template>
            <el-select v-model="form.category" placeholder="请选择模型类别" class="mc-full">
              <el-option
                v-for="o in MODEL_CATEGORY_OPTIONS"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item prop="model">
            <template #label>
              <FieldHelpLabel label="模型标识" :tip="TIPS.model" />
            </template>
            <!-- 开放文本填写（2026-07-13 需求）：不用下拉——平台模型上新快、私有部署标识随意，
                 预设清单永远追不上；填错由「验证连通性」环节兜底暴露 -->
            <el-input
              v-model="form.model"
              maxlength="200"
              placeholder="填写平台文档里的模型调用标识，如 deepseek-chat"
              class="mc-full"
            />
          </el-form-item>

          <el-form-item prop="contextWindow">
            <template #label>
              <FieldHelpLabel label="上下文窗口" :tip="TIPS.contextWindow" />
            </template>
            <el-select
              v-model="form.contextWindow"
              filterable
              allow-create
              default-first-option
              placeholder="选择档位或输入具体 token 数"
              class="mc-full"
            >
              <el-option v-for="o in CONTEXT_WINDOW_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>

          <el-form-item prop="defaultTemperature">
            <template #label>
              <FieldHelpLabel label="默认温度（选填）" :tip="TIPS.defaultTemperature" />
            </template>
            <el-input-number
              v-model="form.defaultTemperature"
              :min="0"
              :max="2"
              :step="0.1"
              :precision="2"
              class="mc-num"
              placeholder="留空用厂商默认"
            />
            <span class="mc-hint">0 ~ 2 · 留空用厂商默认</span>
          </el-form-item>
        </div>
      </section>

      <!-- 连接与鉴权（MQ4 指示：服务地址（Base URL）按原型放本区） -->
      <section class="mc-sec">
        <div class="mc-sec-title">
          连接与鉴权
          <span class="mc-sec-sub">验证结果决定模型是否可发布</span>
        </div>
        <el-form-item prop="baseUrl">
          <template #label>
            <FieldHelpLabel label="服务地址（Base URL）" :tip="TIPS.baseUrl" />
          </template>
          <el-input v-model="form.baseUrl" maxlength="500" placeholder="如 https://api.deepseek.com/v1" />
        </el-form-item>

        <el-form-item prop="authType">
          <template #label>
            <FieldHelpLabel label="鉴权方式" :tip="TIPS.authType" />
          </template>
          <el-radio-group v-model="form.authType">
            <el-radio value="API_KEY">API Key</el-radio>
            <el-radio value="APP_ID_SECRET">AppID / AppSecret</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="form.authType === 'API_KEY'">
          <el-form-item prop="apiKey">
            <template #label>
              <FieldHelpLabel label="api_key" :tip="TIPS.apiKey" />
            </template>
            <el-input
              v-model="form.apiKey"
              type="password"
              show-password
              autocomplete="new-password"
              :placeholder="apiKeyMask ? '留空不修改' : '如 sk-...'"
            />
            <div v-if="apiKeyMask" class="cred-mask">当前：<code>{{ apiKeyMask }}</code></div>
          </el-form-item>
        </template>
        <template v-else>
          <!-- 讯飞 MaaS 等三元组平台：HTTP 侧鉴权 = Bearer APIKey:APISecret（AppID 不参与调用，仅归属标识） -->
          <el-form-item prop="appId">
            <template #label>
              <FieldHelpLabel label="app_id" :tip="TIPS.appId" />
            </template>
            <el-input v-model="form.appId" maxlength="200" placeholder="应用归属标识（不参与 HTTP 调用）" />
          </el-form-item>
          <el-form-item prop="apiKey">
            <template #label>
              <FieldHelpLabel label="api_key" :tip="TIPS.appIdApiKey" />
            </template>
            <el-input
              v-model="form.apiKey"
              type="password"
              show-password
              autocomplete="new-password"
              :placeholder="apiKeyMask ? '留空不修改' : '平台分配的 APIKey'"
            />
            <div v-if="apiKeyMask" class="cred-mask">当前：<code>{{ apiKeyMask }}</code></div>
          </el-form-item>
          <el-form-item prop="appSecret">
            <template #label>
              <FieldHelpLabel label="app_secret" :tip="TIPS.appSecret" />
            </template>
            <el-input
              v-model="form.appSecret"
              type="password"
              show-password
              autocomplete="new-password"
              :placeholder="appSecretMask ? '留空不修改' : '平台分配的 APISecret'"
            />
            <div v-if="appSecretMask" class="cred-mask">当前：<code>{{ appSecretMask }}</code></div>
          </el-form-item>
        </template>
      </section>

      <!-- 能力信息：已识别能力（验证自动探测，只读）→ 额外参数（M7 顺序按原型） -->
      <section class="mc-sec">
        <div class="mc-sec-title">能力信息</div>
        <el-form-item>
          <template #label>
            <FieldHelpLabel label="已识别能力" :tip="TIPS.capabilities" />
          </template>
          <!-- 新建态（M8）：还没有可探测的对象，给接入引导说明 -->
          <div v-if="!isEdit" class="mc-cap-notice">接入并验证后自动识别流式、工具、JSON 和推理能力。</div>
          <ModelCapabilityTags
            v-else
            :source="model"
            empty-text="尚未识别能力，请重新验证"
            unprobed-text="验证连通性后自动检测"
          />
        </el-form-item>
        <el-form-item prop="extraBody">
          <template #label>
            <FieldHelpLabel label="额外参数（JSON，选填）" :tip="TIPS.extraBody" />
          </template>
          <el-input
            v-model="form.extraBody"
            type="textarea"
            :rows="2"
            maxlength="2000"
            placeholder='JSON 对象，如 {"enable_thinking": false}'
          />
          <div class="mc-extra-hint">直接填写模型调用所需的附加参数；不清楚时可以留空</div>
        </el-form-item>
      </section>
    </el-form>

    <!-- 底部弱化时间行（仅编辑/查看态；未发布显「—」） -->
    <div v-if="isEdit" class="mc-times">
      <span>创建时间：{{ timeRow.created }}</span>
      <span>最近更新时间：{{ timeRow.updated }}</span>
      <span>最近发布时间：{{ timeRow.published }}</span>
    </div>

    <!-- 保存后自动验证的就地回显 -->
    <el-alert
      v-if="verifying"
      type="info"
      :closable="false"
      show-icon
      title="正在验证连通性并检测模型能力…（最长约 40 秒）"
      class="model-verify-alert"
    />
    <el-alert
      v-else-if="verifyResult"
      :type="verifyResult.verifyStatus === 'SUCCESS' ? 'success' : 'error'"
      :closable="false"
      show-icon
      :title="
        verifyResult.verifyStatus === 'SUCCESS'
          ? `连通性验证成功（${verifyResult.verifyLatencyMs ?? '-'} ms）`
          : `连通性验证失败：${verifyResult.verifyError || '未知原因'}`
      "
      :description="
        verifyResult.verifyStatus === 'SUCCESS' && verifyResult.responseText
          ? `测试提问：${verifyResult.requestText} → 模型返回：${verifyResult.responseText}`
          : undefined
      "
      class="model-verify-alert"
    />

    <!-- 底部操作：统一「取消 / 保存」右对齐（范式 §1.5）。
         只读态只留「关闭」——查看模式不提供任何写操作。 -->
    <template #footer>
      <div class="mc-foot">
        <el-button @click="close">{{ props.readonly ? '关闭' : '取消' }}</el-button>
        <template v-if="!props.readonly">
          <!-- 就地重测连通性：改完配置想立刻确认「这次对了没」，回列表再点一次是多余往返 -->
          <el-button v-if="isEdit" :loading="verifying" @click="verifyOnly">重新验证</el-button>
          <el-button type="primary" :loading="saving || verifying" @click="save">
            {{ isEdit ? '保存' : '接入' }}
          </el-button>
        </template>
      </div>
    </template>
  </DrawerEditor>
</template>

<style scoped>
/* ===== 分区卡片（与 McpEditor / ApiEditor 同构的 section 节奏） ===== */
.mc-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.mc-sec-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-2);
}
.mc-sec-sub {
  font-weight: var(--fw-regular);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-left: var(--space-2);
}
/* 基本信息两列栅格：字段短、单列排会拉得过长 */
.mc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: var(--space-4);
}

/* ===== 厂商预设卡片网格（M9，原型 preset-grid 形态） ===== */
.mc-preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
}
.mc-preset-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.mc-preset-card:hover {
  border-color: var(--c-accent);
}
.mc-preset-card.active {
  border-color: var(--c-accent);
  background: var(--c-accent-soft, var(--bg-sunken));
  box-shadow: 0 0 0 1px var(--c-accent) inset;
}
.mc-preset-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.mc-preset-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

/* 新建态能力信息引导（M8） */
.mc-cap-notice {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1.6;
}
.mc-extra-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-tight);
  margin-top: var(--space-1);
}

/* 底部弱化时间行（仅编辑/查看态） */
.mc-times {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin-top: var(--space-4);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* 已配置凭据的首尾明文掩码提示（只读，供核对配的是哪把密钥；输入框仍是「留空不修改」） */
.cred-mask {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-tight);
}
.cred-mask code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--c-text);
  letter-spacing: 0.02em;
}
/* 抽屉底部操作条：Element 的 drawer footer 默认左对齐，统一右对齐与三个连接器编辑器一致 */
.mc-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.model-verify-alert {
  margin-top: var(--space-2);
}
.mc-full {
  width: 100%;
}
.mc-num {
  width: 200px;
}
.mc-hint {
  margin-left: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
</style>
