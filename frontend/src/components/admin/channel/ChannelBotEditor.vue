<script setup>
/**
 * 机器人抽屉（PRD 渠道 第四章「机器人编辑页」，720px，新建 / 编辑 / 查看三态）。
 *
 * 外壳用 DrawerEditor（标题三态、骨架、加载失败重试、点抽屉外不关闭）；底部按钮自绘，
 * 因为保存中要显示「正在验证凭据…」/「保存中…」（第四章 6.1）。
 *
 * 分区：时间信息（编辑 / 查看）→ 连接中断提示（编辑）→ 基本信息 → 应用凭据（含权限清单、验证凭据、连接方式、
 * HTTP 回调字段）→ 员工能力（只读）→ 操作记录（仅查看，最近 5 条）。
 * 平台差异全部读 utils/channelMeta.js 的平台描述配置，组件里不写死平台规则。
 *
 * 保存：按「必填 → 格式 → 唯一性 → 平台权限 → 配置影响」校验，错误就地替换字段提示并定位到第一个；
 * 编辑态替换密钥或切换连接方式时先弹「连接配置变更」确认；唯一性、凭据有效性由 mock 判断后按 field 回填。
 * 关闭：新建 / 编辑有未保存修改时，Esc / 右上角关闭 /【取消】都先问「放弃未保存的修改？」。
 */
import { ref, reactive, computed, watch, nextTick, h } from 'vue'
import { ElMessage } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import ChannelPermList from './ChannelPermList.vue'
import ChannelSwapAppDialog from './ChannelSwapAppDialog.vue'
import { confirmDialog } from '@/composables/useConfirm'
import { copyText } from '@/utils/clipboard'
import { getBot, getPlatformSlots, verifyBotCredentials, checkCallback, createBot, updateBot } from '@/api/channel'
import {
  PLATFORMS,
  DEPLOY,
  LIMIT_TEXT,
  BOT_NAME_MAX,
  BOT_DESC_MAX,
  callbackUrl,
  connLabel,
  isSecretDown,
  isPermissionDown,
  botNameError,
  orgError,
  appKeyError,
  secretError
} from '@/utils/channelMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 编辑 / 查看的机器人 id；空即新建 */
  botId: { type: String, default: '' },
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved', 'changed'])

const isNew = computed(() => !props.botId)
const mode = computed(() => (props.readonly ? 'view' : isNew.value ? 'new' : 'edit'))

const loading = ref(false)
const loadError = ref('')
const bot = ref(null)
/** 各平台占用情况（新建态渠道卡片置灰用） */
const slots = ref([])

const form = reactive({ ch: '', name: '', desc: '', org: '', appKey: '', secret: '', conn: '', http: {} })
const errors = reactive({})
const verify = reactive({ state: 'idle', msg: '', org: '' })
const callbackState = ref('idle')
const showSecret = ref(false)
const showPerms = ref(false)
const savingText = ref('')
const conflict = ref(false)
const swapVisible = ref(false)
const bodyRef = ref(null)
const credRef = ref(null)
let orig = ''

const P = computed(() => PLATFORMS[form.ch] || null)
const slotOf = (ch) => slots.value.find((s) => s.ch === ch)
const autoDesc = (ch) => `${PLATFORMS[ch].name}上的统一入口`
const secretDown = computed(() => mode.value === 'edit' && isSecretDown(bot.value))
const permDown = computed(() => mode.value === 'edit' && isPermissionDown(bot.value))
/** 首次配置 HTTP：新建选了 HTTP，或原来不是 HTTP 的机器人切到 HTTP —— 额外字段必填、须检测校验 */
const firstHttp = computed(() => form.conn === 'http' && (isNew.value || bot.value?.conn !== 'http'))
const dirty = computed(() => !!orig && JSON.stringify(form) !== orig)

function clearErrors() {
  Object.keys(errors).forEach((k) => delete errors[k])
}
function resetVerify() {
  verify.state = 'idle'
  verify.msg = ''
  verify.org = ''
}

/** 选定渠道后的空白凭据与连接配置（切换渠道时清空凭据和连接配置，保留名称） */
function applyChannel(ch, { name = form.name, desc } = {}) {
  form.ch = ch
  form.name = name
  form.desc = desc ?? form.desc
  form.org = ''
  form.appKey = ''
  form.secret = ''
  form.conn = PLATFORMS[ch].conns[0].value
  form.http = Object.fromEntries(PLATFORMS[ch].httpFields.map((f) => [f.key, '']))
  callbackState.value = 'idle'
  resetVerify()
  clearErrors()
}

async function load() {
  loading.value = true
  loadError.value = ''
  conflict.value = false
  showSecret.value = false
  showPerms.value = false
  bot.value = null
  try {
    if (isNew.value) {
      slots.value = await getPlatformSlots()
      const free = slots.value.find((s) => !s.full)?.ch || slots.value[0]?.ch
      applyChannel(free, { name: '', desc: autoDesc(free) })
    } else {
      const d = await getBot(props.botId)
      bot.value = d
      Object.assign(form, { ch: d.ch, name: d.name, desc: d.desc, org: '', appKey: d.appKey, secret: '', conn: d.conn })
      form.http = Object.fromEntries(PLATFORMS[d.ch].httpFields.map((f) => [f.key, '']))
      callbackState.value = 'idle'
      resetVerify()
      clearErrors()
    }
    orig = JSON.stringify(form)
  } catch (e) {
    if (e?.code === 40400) {
      ElMessage.warning('机器人信息已变化')
      emit('update:visible', false)
      emit('saved')
      return
    }
    loadError.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
  // 凭据失效而中断：打开编辑时自动定位到「应用凭据」（第三章 3.3）
  if (secretDown.value) {
    await nextTick()
    credRef.value?.scrollIntoView?.({ block: 'start' })
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) load()
    else orig = ''
  },
  { immediate: true }
)

// 修改组织标识、应用标识或密钥后，验证结果清空（第四章 3）
watch(
  () => [form.org, form.appKey, form.secret],
  () => {
    if (verify.state !== 'checking') resetVerify()
  }
)

function onFieldInput(key) {
  delete errors[key]
}

function pickChannel(ch) {
  if (mode.value !== 'new' || ch === form.ch) return
  if (slotOf(ch)?.full) {
    ElMessage.warning(`${PLATFORMS[ch].name}已达到机器人上限，${LIMIT_TEXT}`)
    return
  }
  const wasAuto = !form.desc.trim() || form.desc === autoDesc(form.ch)
  applyChannel(ch, { desc: wasAuto ? autoDesc(ch) : form.desc })
}

function pickConn(value) {
  if (mode.value === 'view' || form.conn === value) return
  form.conn = value
  callbackState.value = 'idle'
  Object.keys(errors).forEach((k) => {
    if (k.startsWith('http.') || k === 'callback') delete errors[k]
  })
}

/* ---------------- 校验（第四章 8） ---------------- */

function validate() {
  const e = {}
  const ch = form.ch
  if (mode.value === 'new') {
    if (!ch) e.ch = '请选择渠道'
    else if (slotOf(ch)?.full) e.ch = `${PLATFORMS[ch].name}已达到机器人上限，${LIMIT_TEXT}`
  }
  if (!ch) return e
  e.name = botNameError(form.name)
  if (mode.value === 'new') {
    e.org = orgError(ch, form.org)
    e.appKey = appKeyError(ch, form.appKey)
    e.secret = secretError(ch, form.secret)
  } else if (secretDown.value && !form.secret.trim()) {
    e.secret = `连接已中断，请填写新的 ${P.value.secret.label}`
  } else {
    e.secret = secretError(ch, form.secret, { required: false })
  }
  if (firstHttp.value) {
    let httpMissing = false
    for (const f of P.value.httpFields) {
      if (!String(form.http[f.key] ?? '').trim()) {
        e[`http.${f.key}`] = `请填写 ${f.label}`
        httpMissing = true
      }
    }
    if (!httpMissing && callbackState.value !== 'ok') e.callback = '请先在平台保存回调地址并完成校验'
  }
  Object.keys(e).forEach((k) => !e[k] && delete e[k])
  return e
}

/** 定位并聚焦到第一个错误字段（按页面上的先后顺序） */
async function focusFirstError() {
  await nextTick()
  const el = bodyRef.value?.querySelector('.cb-field.is-error')
  if (!el) return
  el.scrollIntoView?.({ block: 'center' })
  el.querySelector('input:not([readonly]):not([disabled]), textarea, button')?.focus({ preventScroll: true })
}

/* ---------------- 验证凭据 / 检测校验 ---------------- */

async function doVerify() {
  const ch = form.ch
  const e = {}
  if (mode.value === 'new') {
    e.org = orgError(ch, form.org)
    e.appKey = appKeyError(ch, form.appKey)
  }
  e.secret = secretError(ch, form.secret)
  Object.keys(e).forEach((k) => !e[k] && delete e[k])
  if (Object.keys(e).length) {
    Object.assign(errors, e)
    focusFirstError()
    return
  }
  verify.state = 'checking'
  try {
    const res = await verifyBotCredentials(
      mode.value === 'new' ? { ch, org: form.org, appKey: form.appKey, secret: form.secret } : { botId: props.botId, secret: form.secret }
    )
    verify.state = 'ok'
    verify.org = res.org
    delete errors.secret
  } catch (err) {
    if (err?.field && err.field !== 'secret') {
      errors[err.field] = err.message
      resetVerify()
    } else {
      verify.state = 'fail'
      verify.msg = err?.message || '验证失败'
    }
  }
}

async function doCheckCallback() {
  callbackState.value = 'checking'
  delete errors.callback
  try {
    await checkCallback(form.ch)
    callbackState.value = 'ok'
  } catch (e) {
    callbackState.value = 'idle'
    errors.callback = e?.message || '校验失败，请稍后重试'
  }
}

async function copyCallback() {
  if (await copyText(callbackUrl(form.ch))) ElMessage.success('已复制到剪贴板')
  else ElMessage.error('复制失败，请手动复制')
}

/* ---------------- 保存（第四章 6） ---------------- */

/** 连接配置变更项（替换应用密钥、切换连接方式）；普通配置变更不弹确认 */
function connChanges() {
  if (mode.value !== 'edit') return []
  const out = []
  if (form.secret.trim()) out.push(`${P.value.secret.label} 替换为新值`)
  if (form.conn !== bot.value.conn) out.push(`连接方式：${connLabel(form.ch, bot.value.conn)} → ${connLabel(form.ch, form.conn)}`)
  return out
}

async function save() {
  if (savingText.value || loading.value || loadError.value) return
  clearErrors()
  const e = validate()
  if (Object.keys(e).length) {
    Object.assign(errors, e)
    focusFirstError()
    return
  }
  const changes = connChanges()
  if (changes.length) {
    const ok = await confirmDialog(
      () =>
        h('div', null, [
          h('p', { style: 'margin:0 0 6px' }, '保存后机器人会用新的连接配置重新连接：'),
          h('ul', { class: 'cb-confirm-list', style: 'margin:0;padding-left:18px' }, [
            ...changes.map((c) => h('li', null, c)),
            h('li', null, '重连期间约 10 秒收不到消息，平台会重试投递')
          ])
        ]),
      '连接配置变更',
      { confirmText: '确认保存', warning: true }
    )
    if (!ok) return
  }
  const needVerify = mode.value === 'new' || !!form.secret.trim()
  const verified = verify.state === 'ok'
  savingText.value = needVerify && !verified ? '正在验证凭据…' : '保存中…'
  const http = { ...form.http }
  try {
    if (mode.value === 'new') {
      await createBot({ ...form, http, callbackChecked: callbackState.value === 'ok', verified })
      ElMessage.success(`机器人已创建，请在${P.value.console}发布应用版本并设置可用范围`)
    } else {
      await updateBot(props.botId, {
        name: form.name,
        desc: form.desc,
        secret: form.secret,
        conn: form.conn,
        http,
        callbackChecked: callbackState.value === 'ok',
        verified,
        baseUpdatedAt: bot.value.updatedAt
      })
      ElMessage.success('机器人已保存')
    }
    orig = ''
    emit('update:visible', false)
    emit('saved')
  } catch (err) {
    if (err?.code === 40900) {
      conflict.value = true
    } else if (err?.code === 40400) {
      ElMessage.warning('机器人信息已变化')
      orig = ''
      emit('update:visible', false)
      emit('saved')
    } else if (err?.field) {
      errors[err.field] = err.message
      if (err.field === 'secret' && needVerify) {
        verify.state = 'fail'
        verify.msg = err.message
      }
      focusFirstError()
    } else {
      ElMessage.error(err?.message || '保存失败，请稍后重试')
    }
  } finally {
    savingText.value = ''
  }
}

function onSwapped(row) {
  bot.value = { ...bot.value, ...row }
  form.appKey = row.appKey
  if (orig) orig = JSON.stringify({ ...JSON.parse(orig), appKey: row.appKey })
  resetVerify()
  emit('changed')
}

/* ---------------- 关闭拦截（第四章 1） ---------------- */
// 同 RuntimeSpecEditor：【取消】走 update:visible；Esc / 右上角关闭走 before-close 钩子（el-drawer 自己先收起，回报时已拦不住）。
let discardConfirmed = false
async function askDiscard() {
  if (mode.value === 'view' || loading.value || loadError.value || !dirty.value) return true
  return confirmDialog('关闭后本次填写的内容不会保存。', '放弃未保存的修改？', {
    confirmText: '放弃修改',
    cancelText: '继续编辑',
    danger: true
  })
}
async function onBeforeClose(done) {
  if (savingText.value) return done(true)
  if (!(await askDiscard())) return done(true)
  discardConfirmed = true
  done()
}
async function onVisibleChange(v) {
  if (v) {
    emit('update:visible', true)
    return
  }
  if (!props.visible) return
  if (discardConfirmed) {
    discardConfirmed = false
    emit('update:visible', false)
    return
  }
  if (!(await askDiscard())) return
  emit('update:visible', false)
}

const verifyLabel = computed(() => {
  if (verify.state === 'ok') return `✓ 验证通过 · 所属组织 ${verify.org}`
  if (verify.state === 'fail') return `✕ ${verify.msg}`
  return ''
})
const secretPlaceholder = computed(() => {
  if (!P.value) return ''
  if (mode.value === 'new') return P.value.secret.placeholder
  if (secretDown.value) return `填写新的 ${P.value.secret.label}`
  return '已配置 · 留空不修改'
})
const swapBot = computed(() =>
  bot.value ? { id: bot.value.id, ch: bot.value.ch, name: bot.value.name, appKey: bot.value.appKey, groupCount: bot.value.groupCount } : null
)
const fmtCount = (n) => Number(n || 0).toLocaleString('en-US')
</script>

<template>
  <DrawerEditor
    :visible="visible"
    entity="机器人"
    :is-edit="!isNew"
    :readonly="readonly"
    :loading="loading"
    :error="loadError"
    size="720px"
    append-to-body
    :before-close="onBeforeClose"
    @update:visible="onVisibleChange"
    @retry="load"
  >
    <div v-if="P" ref="bodyRef" class="cb">
      <el-alert v-if="conflict" type="error" :closable="false" show-icon class="cb-conflict" data-testid="conflict">
        <template #title>
          机器人已被其他管理员更新
          <el-button link type="primary" @click="load">加载最新内容</el-button>
        </template>
      </el-alert>

      <!-- 时间信息（第四章 7）：仅编辑 / 查看 -->
      <div v-if="bot" class="page-time cb-times">
        <span>创建时间：{{ bot.createdAt }}</span>
        <span>最近更新：{{ bot.updatedAt }}</span>
      </div>

      <!-- 连接中断提示（第三章 3.3）：按原因区分 -->
      <div v-if="secretDown" class="cb-down" data-testid="down-banner">
        <b>连接中断：</b>{{ P.secret.label }} 已失效，待发消息已进入重发队列（保留 24 小时）。在下方「应用凭据」填写新的
        {{ P.secret.label }} 并保存即可恢复。
      </div>
      <div v-else-if="permDown" class="cb-down" data-testid="down-banner">
        <b>连接中断：</b>缺少必需权限 {{ bot.downReason.missing.join('、') }}，待发消息已进入重发队列（保留 24 小时）。在{{ P.console }}开通权限并发布应用版本后，系统会在 10 分钟内自动检测并恢复；可在下方「应用凭据」展开权限清单对照。
      </div>

      <!-- 基本信息（第四章 2） -->
      <section class="section-card">
        <div class="section-title">基本信息</div>
        <el-form label-position="top" @submit.prevent>
          <el-form-item label="渠道" required class="cb-field" :class="{ 'is-error': errors.ch }" data-field="ch">
            <template v-if="mode === 'new'">
              <div class="cb-cards cb-cards--3" role="radiogroup" aria-label="渠道">
                <button
                  v-for="s in slots"
                  :key="s.ch"
                  type="button"
                  role="radio"
                  class="cb-card"
                  :class="{ 'is-on': form.ch === s.ch, 'is-disabled': s.full }"
                  :aria-checked="form.ch === s.ch"
                  :aria-disabled="s.full"
                  :data-testid="`ch-card-${s.ch}`"
                  @click="pickChannel(s.ch)"
                >
                  <span class="cb-card-dot" />
                  <span class="cb-card-main">
                    <span class="cb-card-title">{{ PLATFORMS[s.ch].name }}</span>
                    <span class="cb-card-desc">{{
                      s.full ? `已接入「${s.botName}」` : PLATFORMS[s.ch].conns.map((c) => c.label).join(' / ')
                    }}</span>
                  </span>
                </button>
              </div>
              <div v-if="errors.ch" class="cb-err">{{ errors.ch }}</div>
              <div v-else class="cb-hint">{{ LIMIT_TEXT }}</div>
            </template>
            <el-input v-else :model-value="`${P.name} · ${bot.org}`" readonly disabled />
          </el-form-item>

          <el-form-item label="机器人名称" required class="cb-field" :class="{ 'is-error': errors.name }" data-field="name">
            <el-input
              v-model="form.name"
              :maxlength="BOT_NAME_MAX"
              show-word-limit
              placeholder="如：iWorker 助手"
              :disabled="readonly"
              data-testid="bot-name"
              @input="onFieldInput('name')"
            />
            <div v-if="errors.name" class="cb-err">{{ errors.name }}</div>
            <div v-else class="cb-hint">与{{ P.name }}平台上的应用名保持一致</div>
          </el-form-item>

          <el-form-item label="用途说明" class="cb-field" data-field="desc">
            <el-input
              v-model="form.desc"
              type="textarea"
              :rows="2"
              :maxlength="BOT_DESC_MAX"
              show-word-limit
              :placeholder="`给其他管理员看，如：${P.name}上的统一入口`"
              :disabled="readonly"
              data-testid="bot-desc"
            />
          </el-form-item>
        </el-form>
      </section>

      <!-- 应用凭据（第四章 3） -->
      <section ref="credRef" class="section-card">
        <div class="section-title">应用凭据<span class="section-sub">在{{ P.console }}创建应用后填写</span></div>
        <div class="cb-info">
          <template v-if="mode === 'new'">
            先在{{ P.console }}创建企业自建应用、添加机器人能力、开通权限并订阅事件；可用范围可以上线后再设置。
          </template>
          <template v-else>缺少必需权限时，系统自动检测并在列表状态显示「连接中断 · 缺少必需权限」。</template>
          <el-button link type="primary" class="cb-info-link" data-testid="toggle-perms" @click="showPerms = !showPerms">
            {{ showPerms ? '收起权限清单' : '查看权限清单' }}
          </el-button>
        </div>
        <ChannelPermList v-if="showPerms" :ch="form.ch" />

        <el-form label-position="top" @submit.prevent>
          <!-- 组织标识：只有企业微信新建时填写；编辑 / 查看显示在「渠道」字段中 -->
          <el-form-item
            v-if="mode === 'new' && P.org.needInput"
            :label="P.org.label"
            required
            class="cb-field"
            :class="{ 'is-error': errors.org }"
            data-field="org"
          >
            <el-input v-model="form.org" class="mono" :placeholder="P.org.placeholder" data-testid="bot-org" @input="onFieldInput('org')" />
            <div v-if="errors.org" class="cb-err">{{ errors.org }}</div>
            <div v-else class="cb-hint">用于获取访问凭证，并校验与本企业组织一致</div>
          </el-form-item>

          <div class="cb-row2">
            <el-form-item required class="cb-field" :class="{ 'is-error': errors.appKey }" data-field="appKey">
              <template #label>
                <span class="cb-label-row">
                  <span>{{ P.key.label }}</span>
                  <el-button v-if="mode === 'edit'" link type="primary" data-testid="swap-app" @click="swapVisible = true">更换应用</el-button>
                </span>
              </template>
              <el-input
                v-if="mode === 'new'"
                v-model="form.appKey"
                class="mono"
                :placeholder="P.key.placeholder"
                data-testid="bot-key"
                @input="onFieldInput('appKey')"
              />
              <el-input v-else :model-value="form.appKey" class="mono" readonly disabled />
              <div v-if="errors.appKey" class="cb-err">{{ errors.appKey }}</div>
            </el-form-item>

            <el-form-item
              :label="P.secret.label"
              :required="mode === 'new' || secretDown"
              class="cb-field"
              :class="{ 'is-error': errors.secret }"
              data-field="secret"
            >
              <el-input
                v-model="form.secret"
                class="mono"
                :type="showSecret ? 'text' : 'password'"
                :placeholder="readonly ? '已配置' : secretPlaceholder"
                :disabled="readonly"
                autocomplete="new-password"
                data-testid="bot-secret"
                @input="onFieldInput('secret')"
              >
                <template v-if="!readonly" #suffix>
                  <el-button link type="primary" class="cb-eye" data-testid="toggle-secret" @click="showSecret = !showSecret">
                    {{ showSecret ? '隐藏' : '显示' }}
                  </el-button>
                </template>
              </el-input>
              <div v-if="errors.secret" class="cb-err">{{ errors.secret }}</div>
              <div v-else class="cb-hint">{{ mode === 'new' ? '保存后不再回显' : '已配置的密钥不回显' }}</div>
            </el-form-item>
          </div>

          <div v-if="!readonly" class="cb-verify">
            <el-button size="small" :loading="verify.state === 'checking'" data-testid="verify" @click="doVerify">验证凭据</el-button>
            <span v-if="verify.state === 'checking'" class="cb-muted" data-testid="verify-result">验证中…</span>
            <span v-else-if="verifyLabel" :class="verify.state === 'ok' ? 'cb-ok' : 'cb-fail'" data-testid="verify-result">{{ verifyLabel }}</span>
          </div>

          <!-- 连接方式：多选一卡片；只有一种（企业微信）只读展示 -->
          <el-form-item label="连接方式" required class="cb-field" data-field="conn">
            <div v-if="P.conns.length > 1" class="cb-cards" role="radiogroup" aria-label="连接方式">
              <button
                v-for="c in P.conns"
                :key="c.value"
                type="button"
                role="radio"
                class="cb-card"
                :class="{ 'is-on': form.conn === c.value, 'is-ro': readonly }"
                :aria-checked="form.conn === c.value"
                :data-testid="`conn-${c.value}`"
                @click="pickConn(c.value)"
              >
                <span class="cb-card-dot" />
                <span class="cb-card-main">
                  <span class="cb-card-title">{{ c.label }}</span>
                  <span class="cb-card-desc">{{ c.desc }}</span>
                </span>
              </button>
            </div>
            <el-input v-else :model-value="`${P.conns[0].label} · ${P.conns[0].desc}`" readonly disabled />
            <div v-if="mode === 'edit' && bot && form.conn !== bot.conn" class="cb-warn-hint" data-testid="conn-switch-hint">
              切换连接方式会短暂中断收消息（约 10 秒），保存前会再次确认
            </div>
          </el-form-item>

          <!-- HTTP 回调字段（选择 HTTP 时） -->
          <template v-if="form.conn === 'http'">
            <div v-if="P.httpFields.length" class="cb-row2">
              <el-form-item
                v-for="f in P.httpFields"
                :key="f.key"
                :label="f.label"
                :required="firstHttp"
                class="cb-field"
                :class="{ 'is-error': errors[`http.${f.key}`] }"
                :data-field="`http.${f.key}`"
              >
                <el-input
                  v-model="form.http[f.key]"
                  class="mono"
                  type="password"
                  :placeholder="firstHttp ? '' : readonly ? '已配置' : '已配置 · 留空不修改'"
                  :disabled="readonly"
                  autocomplete="new-password"
                  :data-testid="`http-${f.key}`"
                  @input="onFieldInput(`http.${f.key}`)"
                />
                <div v-if="errors[`http.${f.key}`]" class="cb-err">{{ errors[`http.${f.key}`] }}</div>
              </el-form-item>
            </div>
            <el-form-item label="回调地址" class="cb-field" :class="{ 'is-error': errors.callback }" data-field="callback">
              <div class="cb-url">
                <el-input :model-value="callbackUrl(form.ch)" class="mono" readonly data-testid="callback-url" />
                <el-button @click="copyCallback">复制</el-button>
              </div>
              <div v-if="errors.callback" class="cb-err">{{ errors.callback }}</div>
              <div v-else class="cb-hint">
                <template v-if="form.ch === 'wecom'">同时把 iWorker 出口 IP {{ DEPLOY.egressIps.join('、') }} 加入企业可信 IP。</template>
                <template v-if="firstHttp && !readonly">
                  <span v-if="callbackState === 'ok'" class="cb-ok">✓ 平台校验通过</span>
                  <span v-else-if="callbackState === 'checking'" class="cb-muted">等待平台发起校验请求…</span>
                  <template v-else>
                    在平台保存回调地址后，<el-button link type="primary" class="cb-inline-btn" data-testid="callback-check" @click="doCheckCallback">检测校验</el-button>
                  </template>
                </template>
              </div>
            </el-form-item>
          </template>
        </el-form>
      </section>

      <!-- 员工能力（第四章 5.1）：只读，不提供开关 -->
      <section class="section-card">
        <div class="section-title">员工能力<span class="section-sub">只读 · 由岗位分配和员工自己的市场添加决定，机器人不裁剪能力</span></div>
        <ul class="cb-rows" data-testid="capability">
          <li>
            <div><div>岗位私有能力</div><small>岗位的技能、知识、工作档案、自动化任务</small></div>
            <span class="cb-muted">已分配岗位的 {{ fmtCount(bot?.capability?.positionUserCount ?? 28750) }} 人</span>
          </li>
          <li>
            <div>
              <div>内置能力</div>
              <small>内置技能 {{ bot?.capability?.builtinSkillCount ?? 18 }} 条 · 连接器 {{ bot?.capability?.builtinConnectorCount ?? 6 }} 个</small>
            </div>
            <span class="cb-muted">所有员工</span>
          </li>
          <li>
            <div><div>市场安装的能力</div><small>员工在用户端能力市场自己添加的，每人不同</small></div>
            <span class="cb-muted">自己添加了的员工</span>
          </li>
        </ul>
      </section>

      <!-- 操作记录（第四章 5.3）：仅查看，最近 5 条 -->
      <section v-if="mode === 'view' && bot" class="section-card">
        <div class="section-title">操作记录<span class="section-sub">最近 5 条 · 完整记录在「05治理 → 访问审计」</span></div>
        <ul v-if="bot.logs.length" class="cb-logs" data-testid="bot-logs">
          <li v-for="(l, i) in bot.logs" :key="i">
            <div class="cb-log-act">{{ l.action }}</div>
            <small class="cb-muted">{{ l.time }} · {{ l.operator }}<template v-if="l.detail"> · {{ l.detail }}</template></small>
          </li>
        </ul>
        <div v-else class="cb-muted">暂无操作记录</div>
      </section>

    </div>

    <template #footer>
      <el-button v-if="readonly" @click="onVisibleChange(false)">关闭</el-button>
      <template v-else>
        <el-button :disabled="!!savingText" @click="onVisibleChange(false)">取消</el-button>
        <el-button
          type="primary"
          :loading="!!savingText"
          :disabled="loading || !!loadError"
          data-testid="bot-submit"
          @click="save"
        >{{ savingText || (isNew ? '创建' : '保存') }}</el-button>
      </template>
    </template>

    <template #extra>
      <ChannelSwapAppDialog v-model="swapVisible" :bot="swapBot" @swapped="onSwapped" />
    </template>
  </DrawerEditor>
</template>

<style scoped>
.cb {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.cb > .section-card {
  margin-bottom: 0;
}
/* 压过 admin-shell.css 里 body.admin-scope .page-time 的上边线（抽屉顶部第一行不需要分隔线） */
.cb > .page-time.cb-times {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.cb-down {
  padding: var(--space-3) var(--space-4);
  font-size: var(--fs-sm);
  line-height: 1.7;
  color: var(--c-danger);
  background: var(--c-danger-soft);
  border: 1px solid var(--c-danger);
  border-radius: var(--radius-sm);
}
.cb-conflict :deep(.el-alert__title) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.cb-field {
  margin-bottom: var(--space-4);
}
.cb-field :deep(.el-form-item__content) {
  flex-direction: column;
  align-items: stretch;
}
.cb-hint {
  margin-top: 4px;
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--c-text-muted);
}
.cb-err {
  margin-top: 4px;
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--c-danger);
}
.cb-warn-hint {
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--c-warning);
}
.cb-row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 var(--space-4);
}
.cb-label-row {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.mono :deep(input) {
  font-family: var(--font-mono);
}
.cb-eye {
  font-size: var(--fs-xs);
}
.cb-info {
  margin-bottom: var(--space-4);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--c-text-muted);
  background: var(--bg-sunken);
  border-radius: var(--radius-sm);
}
.cb-info-link {
  margin-left: 6px;
  font-size: var(--fs-xs);
  vertical-align: baseline;
}
.cb-verify {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin: calc(-1 * var(--space-2)) 0 var(--space-4);
}
.cb-muted {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.cb-ok {
  font-size: var(--fs-xs);
  color: var(--c-success);
}
.cb-fail {
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.cb-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  width: 100%;
}
.cb-cards--3 {
  grid-template-columns: repeat(3, 1fr);
}
.cb-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  text-align: left;
  font: inherit;
  color: var(--c-text);
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--dur-fast);
}
.cb-card:hover {
  border-color: var(--c-accent);
}
.cb-card.is-on {
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
.cb-card.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.cb-card.is-disabled:hover {
  border-color: var(--border-base);
}
.cb-card.is-ro {
  cursor: default;
}
.cb-card-dot {
  flex: 0 0 14px;
  height: 14px;
  margin-top: 3px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
}
.cb-card.is-on .cb-card-dot {
  border: 4px solid var(--c-accent);
}
.cb-card-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cb-card-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.cb-card-desc {
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--c-text-muted);
}
.cb-url {
  display: flex;
  gap: var(--space-2);
  width: 100%;
}
.cb-inline-btn {
  font-size: var(--fs-xs);
  vertical-align: baseline;
}
.cb-rows,
.cb-logs {
  margin: 0;
  padding: 0;
  list-style: none;
}
.cb-rows {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
}
.cb-rows li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.cb-rows li + li {
  border-top: 1px solid var(--border-soft);
}
.cb-rows small {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.cb-logs li {
  position: relative;
  padding: 0 0 var(--space-3) var(--space-4);
  border-left: 1px solid var(--border-soft);
  margin-left: 4px;
}
.cb-logs li::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 6px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-success);
}
.cb-log-act {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
@media (max-width: 640px) {
  .cb-row2,
  .cb-cards,
  .cb-cards--3 {
    grid-template-columns: 1fr;
  }
}
</style>
