<script setup>
/**
 * 用户访问权限 · 处理申请弹窗（PRD 06组织/用户访问权限 §四）。
 *
 * 从授权名单某员工行的【处理申请】进来，列出该员工待处理的权限申请（本机、云端各最多一条），
 * 每条可【通过】（二次确认）或【驳回】（原因必填 ≤ 500 字）。申请不进审核中心，由管理员在这里直接处理；
 * 已处理的申请不在本页留列表，处理结果在访问审计里查（授权 / 收回 / 通过申请 / 驳回申请四类都记）。
 * 弹窗打开期间若申请已被别处处理，提交时提示「该申请已被处理」并刷新，不覆盖。
 */
import { reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import { listAccessRequests, approveAccessRequest, rejectAccessRequest } from '@/api/userAccess'
import { REJECT_REASON_MAX as REJECT_MAX, ENV_LABEL, OPERATION_ENV } from '@/utils/userAccess'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 授权名单里被点的员工行（要 userId / username / name / position） */
  member: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'changed'])

const requests = ref([])
const loading = ref(false)
const loadError = ref(false)

async function load() {
  if (!props.member) return
  loading.value = true
  loadError.value = false
  try {
    const res = await listAccessRequests({ status: 'PENDING', keyword: props.member.username, page: 1, size: 50 })
    requests.value = res.list.filter((r) => r.userId === props.member.userId)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
watch(() => props.visible, (v) => { if (v) load() })

/** 处理完刷新弹窗里的列表；没有待处理的了就自动关闭。 */
async function done() {
  emit('changed', props.member?.userId)
  await load()
  if (!requests.value.length) emit('update:visible', false)
}

/** 「已被处理」「申请不存在」（如申请人账号被删）都是并发冲突：提示并刷新 */
const isConflict = (e) => e?.code === 40900 || e?.code === 40400

/* ---------- 通过 ---------- */
async function onApprove(row) {
  try {
    await ElMessageBox.confirm(
      `确认通过 ${row.name} 的${ENV_LABEL[row.env]}完全访问权限申请？通过后 ${row.name} 即可在员工端的${ENV_LABEL[row.env]}运行方式下开启完全访问`,
      '确认通过',
      { type: 'warning', confirmButtonText: '通过', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await approveAccessRequest(row.id)
    ElMessage.success(`已通过 ${row.name} 的${ENV_LABEL[row.env]}完全访问权限申请`)
    await done()
  } catch (e) {
    ElMessage[isConflict(e) ? 'warning' : 'error'](e?.message || '操作失败，请稍后重试')
    if (isConflict(e)) await done()
  }
}

/* ---------- 驳回 ---------- */
const reject = reactive({ visible: false, request: null, reason: '', error: '', submitting: false })

function openReject(row) {
  reject.request = row
  reject.reason = ''
  reject.error = ''
  reject.visible = true
}

async function submitReject() {
  const text = reject.reason.trim()
  if (!text) { reject.error = '请输入驳回原因'; return }
  if (text.length > REJECT_MAX) { reject.error = `驳回原因最多 ${REJECT_MAX} 字`; return }
  reject.submitting = true
  try {
    await rejectAccessRequest(reject.request.id, text)
    ElMessage.success(`已驳回 ${reject.request.name} 的${ENV_LABEL[reject.request.env]}完全访问权限申请`)
    reject.visible = false
    await done()
  } catch (e) {
    if (isConflict(e)) {
      ElMessage.warning(e.message)
      reject.visible = false
      await done()
    } else {
      reject.error = e?.message || '提交失败，请稍后重试'
    }
  } finally {
    reject.submitting = false
  }
}
</script>

<template>
  <el-dialog :model-value="visible" title="处理权限申请" width="540px" append-to-body @update:model-value="emit('update:visible', $event)">
    <template v-if="member">
      <div class="ua-dlg-info">
        <b>{{ member.name }}</b>（{{ member.username }}）<template v-if="member.position">· {{ member.position }}</template>
      </div>
      <div v-if="loadError" class="ua-error">加载失败，请关闭后重试</div>
      <div v-else-if="loading && !requests.length" class="ua-muted">加载中…</div>
      <div v-for="req in requests" :key="req.id" class="ua-req">
        <div class="ua-req-head">
          <StatusTag :type="OPERATION_ENV[req.env].tag">{{ OPERATION_ENV[req.env].label }}</StatusTag>
          <span>申请完全访问</span>
          <span class="ua-muted ua-req-time">提交于 {{ req.submittedAt }}</span>
        </div>
        <div class="ua-quote">{{ req.reason || '（未填写申请理由）' }}</div>
        <div class="ua-req-ops">
          <el-button type="primary" size="small" @click="onApprove(req)">通过</el-button>
          <el-button type="danger" plain size="small" @click="openReject(req)">驳回</el-button>
        </div>
      </div>
    </template>
    <template #footer>
      <el-button @click="emit('update:visible', false)">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="reject.visible" title="驳回申请" width="500px" append-to-body>
    <template v-if="reject.request">
      <div class="ua-dlg-info"><b>{{ reject.request.name }}</b>（{{ reject.request.username }}）· 申请{{ ENV_LABEL[reject.request.env] }}完全访问</div>
      <div v-if="reject.request.reason" class="ua-quote">{{ reject.request.reason }}</div>
      <div class="ua-field-label"><b class="ua-required">*</b> 驳回原因</div>
      <el-input
        v-model="reject.reason"
        type="textarea"
        :rows="4"
        :maxlength="REJECT_MAX"
        show-word-limit
        placeholder="请输入驳回原因，将展示给申请人"
      />
      <div v-if="reject.error" class="ua-error">{{ reject.error }}</div>
    </template>
    <template #footer>
      <el-button @click="reject.visible = false">取消</el-button>
      <el-button type="danger" :loading="reject.submitting" @click="submitReject">确认驳回</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ua-dlg-info {
  margin-bottom: var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text-base);
}
.ua-muted {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ua-req {
  margin-bottom: var(--space-3);
  padding: var(--space-3);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}
.ua-req-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  font-size: var(--fs-sm);
}
.ua-req-time {
  margin-left: auto;
}
.ua-req-ops {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.ua-quote {
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--c-text-muted);
  background: var(--bg-surface);
  border-left: 3px solid var(--border-soft);
  border-radius: var(--radius-sm);
}
.ua-field-label {
  margin-bottom: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.ua-required {
  color: var(--c-danger);
}
.ua-error {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
