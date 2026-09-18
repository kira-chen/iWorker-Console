<script setup>
/**
 * 运行规格编辑抽屉（04运行 › 运行规格，2026-09-02 启动轮；基准=负责人交互截图，标准件 DrawerEditor 收壳）。
 *
 * 信息结构：
 *   首行元信息（编辑态：创建 / 最近更新时间，弱色提示展示，与 API/MCP 抽屉同款）
 *   → 基本信息（规格名称[必填≤64,平台内唯一]；能力边界说明[必填≤200]——
 *     D17：FDE 只见「规格名 + 能力边界说明」，此字段是 FDE 唯一可见内容）
 *   → 资源配置（k8s Pod：CPU 核 / 内存 Gi / 临时存储 Gi，映射 resources.requests=limits，
 *     demo 不真连集群，映射关系以弱色提示展示）
 *   → 适用范围（岗位批量继承 + 是否允许个人申请；申请固定进入审批）
 *   → 运行策略（Pod 就绪等待超时 / 空闲回收 / 最大存活时长）
 *   → 生效情况（岗位继承、个人覆盖、默认兜底）。
 * 护栏：重名走 mock ApiError 的 field 定位就地红框。
 *
 * 2026-09-12 对齐 md 运行规格（审计 K28 / K29）：
 *  - K28：validate() 文案逐字 §四.10 L384-394 + §四.4 L302 上限模板，与 runtimeSpecMock.validatePayload 同一套；
 *  - K29 §四.1 L266：新建 / 编辑态有未保存修改时点关闭或【取消】→ 放弃确认，无修改直接关；
 *  - K29 §四.3 L286 / §四.10 L397：选中已被其他规格占用的岗位 → 保存前展示原规格 → 目标规格并提示
 *    「保存后该岗位将从原规格切换到当前规格」，确认后整体切换；占用关系取自 listRuntimeSpecs（现有 API）；
 *  - K29 §四.8.2 L360-366：改重要运行配置（CPU / 内存 / 临时存储 / 就绪超时 / 空闲回收 / 最大存活）且有生效用户 →
 *    保存前「运行配置变更」确认，列变更前后与三条影响说明，取消不保存；
 *  - K29 §四.8.3 L372 / §四.10 L398：存在待审批申请时关闭「允许用户申请」→ 阻止保存，开关下方提示先处理或撤回。
 *  校验顺序照 §四.7 L344：必填 → 格式 → 数值范围 →（名称唯一由接口回 field）→ 配置影响。
 */
import { ref, reactive, computed, watch, h } from 'vue'
import { ElMessage } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import { confirmDialog } from '@/composables/useConfirm'
import { getRuntimeSpec, getRuntimeSpecLimits, createRuntimeSpec, updateRuntimeSpec, listRuntimeSpecs } from '@/api/runtimeSpec'
import { listPositions } from '@/api/position'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 编辑目标 id；null = 新建 */
  specId: { type: [Number, String], default: null },
  /** 查看态：复用同一抽屉，只读展示完整配置。 */
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved'])

const isEdit = computed(() => props.specId != null)

const form = reactive({
  name: '',
  boundaryDesc: '',
  cpu: 2,
  memoryGi: 4,
  diskGi: 20,
  readinessTimeoutMin: 10,
  idleRecycleMin: 20,
  maxLifetimeHours: 0,
  positionIds: [],
  allowUserApply: true
})
const meta = reactive({ createdAt: '', updatedAt: '', effectiveUsers: [], pendingUsers: [], isDefault: false })
const resourceLimits = reactive({ cpu: 32, memoryGi: 128, diskGi: 500 })
const positions = ref([])
/** 其他规格的岗位占用：positionId → { specId, specName }（md §四.3 L286 切换提示用；本规格自身不计） */
const positionOwners = ref(new Map())

/** 重要运行配置字段（md §四.8.2 L360）：改了且有生效用户 → 保存前「运行配置变更」确认 */
const RUNTIME_FIELDS = [
  ['cpu', 'CPU', '核'], ['memoryGi', '内存', 'Gi'], ['diskGi', '临时存储', 'Gi'],
  ['readinessTimeoutMin', '就绪等待超时', '分钟'], ['idleRecycleMin', '空闲回收', '分钟'], ['maxLifetimeHours', '最大存活时长', '小时']
]

/** 表单快照（脏检查 + 变更前后比对用）：加载完成后记一次基线 */
const snapshot = () => JSON.stringify({ ...form, positionIds: [...form.positionIds].map(Number).sort((a, b) => a - b) })
const baseline = ref('')
const isDirty = computed(() => baseline.value !== '' && snapshot() !== baseline.value)

const loading = ref(false)
const loadError = ref(false)
const saving = ref(false)
const fieldErrors = reactive({})

function clearErrors() {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k])
}
function clearError(key) {
  delete fieldErrors[key]
}

function resetForm() {
  Object.assign(form, {
    name: '', boundaryDesc: '', cpu: 2, memoryGi: 4, diskGi: 20,
    readinessTimeoutMin: 10, idleRecycleMin: 20, maxLifetimeHours: 0,
    positionIds: [], allowUserApply: true
  })
  Object.assign(meta, { createdAt: '', updatedAt: '', effectiveUsers: [], pendingUsers: [], isDefault: false })
  baseline.value = ''
  clearErrors()
}

async function load() {
  resetForm()
  discardConfirmed = false
  loading.value = true
  loadError.value = false
  try {
    const [positionData, limitData, specData] = await Promise.all([
      listPositions({ size: 200, status: 'published' }),
      getRuntimeSpecLimits(),
      listRuntimeSpecs()
    ])
    positions.value = positionData?.list || []
    Object.assign(resourceLimits, limitData)
    // 岗位占用表：排除本规格自身（编辑态回填的岗位不算「被其他规格占用」）
    const owners = new Map()
    for (const s of specData?.list || []) {
      if (isEdit.value && Number(s.id) === Number(props.specId)) continue
      for (const pid of s.positionIds || []) owners.set(Number(pid), { specId: s.id, specName: s.name })
    }
    positionOwners.value = owners
    if (!isEdit.value) {
      baseline.value = snapshot()
      return
    }
    const d = await getRuntimeSpec(props.specId)
    Object.assign(form, {
      name: d.name, boundaryDesc: d.boundaryDesc,
      cpu: d.cpu, memoryGi: d.memoryGi, diskGi: d.diskGi,
      readinessTimeoutMin: d.readinessTimeoutMin, idleRecycleMin: d.idleRecycleMin, maxLifetimeHours: d.maxLifetimeHours,
      positionIds: d.positionIds || [], allowUserApply: d.allowUserApply
    })
    Object.assign(meta, {
      createdAt: d.createdAt, updatedAt: d.updatedAt,
      effectiveUsers: d.effectiveUsers || [], pendingUsers: d.pendingUsers || [], isDefault: d.isDefault
    })
    baseline.value = snapshot()
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

watch(() => props.visible, (v) => { if (v) load() })

/**
 * 关闭 / 取消拦截（md §四.1 L266，审计 K29）：新建或编辑态存在未保存修改 → 放弃确认；无修改（或查看态）直接关闭。
 * 两条关闭路径：
 *  - 【取消】按钮：DrawerEditor.close() 直接回报 update:visible=false → onVisibleChange 拦；
 *  - 抽屉 X / ESC：el-drawer 会先自行收起再在动画结束后回报，等回报时已经关掉、拦不住，
 *    故经 before-close 钩子拦（`:before-close` 不是 DrawerEditor 的 prop，按 Vue 单根透传落到其根 el-drawer）。
 *    钩子放行后置 discardConfirmed，随后到达的回报不再二次询问。
 * 保存成功走 save() 内的 emit；父层把 visible 置 false 后 el-drawer 还会回报一次，此时 props.visible 已为 false，直接忽略。
 */
let discardConfirmed = false
async function askDiscard() {
  if (props.readonly || loading.value || loadError.value || !isDirty.value) return true
  return confirmDialog('有未保存的修改，关闭后将丢失。确认放弃本次修改？', '放弃修改', {
    confirmText: '放弃修改', cancelText: '继续编辑', warning: true
  })
}
async function onBeforeClose(done) {
  if (saving.value) return done(true) // md §四.7 L348：保存过程中关闭操作不可执行
  if (!(await askDiscard())) return done(true) // done(true) = 取消关闭，抽屉保持打开
  discardConfirmed = true
  done()
}
async function onVisibleChange(v) {
  if (v) {
    emit('update:visible', true)
    return
  }
  if (!props.visible) return // 父层已关（保存成功等）后的回报回声，忽略
  if (discardConfirmed) {
    discardConfirmed = false
    emit('update:visible', false)
    return
  }
  if (!(await askDiscard())) return
  emit('update:visible', false)
}

const isIntAtLeast1 = (v) => Number.isInteger(Number(v)) && Number(v) >= 1

/** 必填 → 格式 → 数值范围（文案逐字 md §四.10 / §四.4 L302；名称唯一由接口回 field 定位，K28） */
function validate() {
  clearErrors()
  const errors = {}
  const name = form.name.trim()
  const boundaryDesc = form.boundaryDesc.trim()
  if (!name) errors.name = '规格名称不能为空'
  else if (name.length > 64) errors.name = '规格名称最多 64 个字符'
  if (!boundaryDesc) errors.boundaryDesc = '请填写能力边界说明'
  else if (boundaryDesc.length > 200) errors.boundaryDesc = '能力边界说明最多 200 个字符'
  const cpu = Number(form.cpu)
  if (!(cpu >= 0.5) || !Number.isInteger(cpu * 2)) errors.cpu = 'CPU须不小于 0.5 核，并按照 0.5 递增'
  if (!isIntAtLeast1(form.memoryGi)) errors.memoryGi = '内存须为不小于 1 的整数'
  if (!isIntAtLeast1(form.diskGi)) errors.diskGi = '临时存储须为不小于 1 的整数'
  if (!isIntAtLeast1(form.readinessTimeoutMin)) errors.readinessTimeoutMin = '就绪等待超时须为不小于 1 的整数分钟'
  if (!isIntAtLeast1(form.idleRecycleMin)) errors.idleRecycleMin = '空闲回收须为不小于 1 的整数分钟'
  if (!(Number(form.maxLifetimeHours) >= 0) || !Number.isInteger(Number(form.maxLifetimeHours))) {
    errors.maxLifetimeHours = '最大存活时长须为非负整数小时，0 表示不限'
  }
  for (const [k, unit] of [['cpu', '核'], ['memoryGi', 'Gi'], ['diskGi', 'Gi']]) {
    if (!errors[k] && Number(form[k]) > resourceLimits[k]) errors[k] = `不能超过平台单实例上限 ${resourceLimits[k]}${unit}`
  }
  Object.assign(fieldErrors, errors)
  return Object.keys(errors).length === 0
}

/** 配置影响 ①（md §四.8.3 L372 / §四.10 L398）：关闭申请入口但仍有待审批申请 → 阻止保存 */
function checkPendingBeforeCloseApply() {
  if (!isEdit.value) return true
  const wasOpen = JSON.parse(baseline.value || '{}').allowUserApply
  const pendingCount = meta.pendingUsers.length
  if (wasOpen && !form.allowUserApply && pendingCount > 0) {
    fieldErrors.allowUserApply = `存在 ${pendingCount} 个待审批申请，请先处理或撤回相关申请后再关闭申请入口`
    return false
  }
  return true
}

/** 配置影响 ②（md §四.3 L286 / §四.10 L397）：选中被其他规格占用的岗位 → 展示原规格 → 目标规格并确认整体切换 */
async function confirmPositionSwitch() {
  const targetName = form.name.trim() || '当前规格'
  const taken = form.positionIds
    .map((pid) => ({ pid: Number(pid), owner: positionOwners.value.get(Number(pid)) }))
    .filter((x) => x.owner)
    .map((x) => ({ ...x, positionName: positions.value.find((p) => Number(p.positionId) === x.pid)?.name || `岗位 ${x.pid}` }))
  if (!taken.length) return true
  const body = h('div', { class: 'rs-confirm-body' }, [
    h('p', null, '以下岗位已被其他规格配置，保存后该岗位将从原规格切换到当前规格：'),
    h('ul', { class: 'rs-confirm-list' }, taken.map((x) =>
      h('li', { key: x.pid }, `${x.positionName}：${x.owner.specName} → ${targetName}`)
    ))
  ])
  return confirmDialog(body, '岗位规格切换', { confirmText: '确认切换' })
}

/** 配置影响 ③（md §四.8.2 L360-366）：重要运行配置变更且有生效用户 → 「运行配置变更」确认（取消不保存） */
async function confirmRuntimeChange() {
  if (!isEdit.value || !meta.effectiveUsers.length) return true
  const before = JSON.parse(baseline.value || '{}')
  const changed = RUNTIME_FIELDS.filter(([k]) => Number(before[k]) !== Number(form[k]))
  if (!changed.length) return true
  const fmt = (k, v, unit) => (k === 'maxLifetimeHours' && Number(v) === 0 ? '不限' : `${v} ${unit}`)
  const body = h('div', { class: 'rs-confirm-body' }, [
    h('p', null, `该规格当前有 ${meta.effectiveUsers.length} 个生效用户，本次修改了以下运行配置：`),
    h('ul', { class: 'rs-confirm-list' }, changed.map(([k, label, unit]) =>
      h('li', { key: k }, `${label}：${fmt(k, before[k], unit)} → ${fmt(k, form[k], unit)}`)
    )),
    h('ul', { class: 'rs-confirm-list' }, [
      h('li', null, '已运行 Pod 不会被立即修改或重启。'),
      h('li', null, '新配置在用户 Pod 下一次创建或管理员主动重建时生效。'),
      h('li', null, '「实例与会话」中使用旧配置的 Pod 将标记「规格待生效」。')
    ])
  ])
  return confirmDialog(body, '运行配置变更', { confirmText: '确认保存' })
}

async function save() {
  if (props.readonly || saving.value) return
  if (!validate()) return
  if (!checkPendingBeforeCloseApply()) return
  if (!(await confirmPositionSwitch())) return
  if (!(await confirmRuntimeChange())) return
  saving.value = true
  try {
    const payload = { ...form, name: form.name.trim(), boundaryDesc: form.boundaryDesc.trim() }
    if (isEdit.value) {
      await updateRuntimeSpec(props.specId, payload)
      ElMessage.success('规格已保存')
    } else {
      await createRuntimeSpec(payload)
      ElMessage.success('规格已创建')
    }
    emit('update:visible', false)
    emit('saved')
  } catch (e) {
    // 护栏错误（重名等）按 field 就地红框；无 field 的兜底 toast
    if (e?.field) fieldErrors[e.field] = e.message
    else ElMessage.error(e?.message || '保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <DrawerEditor
    :visible="visible"
    entity="规格"
    :is-edit="isEdit"
    :readonly="readonly"
    :loading="loading"
    :error="loadError"
    :saving="saving"
    :cancel-disabled="saving"
    :before-close="onBeforeClose"
    create-text="创建"
    append-to-body
    @update:visible="onVisibleChange"
    @retry="load"
    @save="save"
  >
    <!-- 首行元信息（编辑态，与 API/MCP 抽屉同款弱色时间行） -->
    <div v-if="isEdit" class="rs-times">
      <span>创建时间：{{ meta.createdAt || '—' }}</span>
      <span>最近更新：{{ meta.updatedAt || '—' }}</span>
    </div>

    <section class="rs-sec">
      <div class="rs-sec-title">基本信息</div>
      <el-alert
        v-if="meta.isDefault"
        title="这是平台默认运行规格：未绑定岗位或岗位未配置专属规格的用户自动使用；默认规格不可删除。"
        type="info"
        :closable="false"
        show-icon
        class="rs-default-alert"
      />
      <el-form label-position="top">
        <el-form-item label="规格名称" :error="fieldErrors.name" required>
          <el-input v-model="form.name" maxlength="64" show-word-limit placeholder="如：标准、高性能" :disabled="readonly" />
        </el-form-item>
        <el-form-item label="能力边界说明" :error="fieldErrors.boundaryDesc" required>
          <el-input
            v-model="form.boundaryDesc"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="如：适合常规文档处理，可处理 100MB 以内文件"
            :disabled="readonly"
          />
          <div class="rs-hint">FDE 只看到「规格名 + 能力边界说明」，看不到任何技术参数</div>
        </el-form-item>
      </el-form>
    </section>

    <section class="rs-sec">
      <div class="rs-sec-title">适用范围<span class="rs-sec-sub">岗位用于批量配置，个人配置作为例外覆盖</span></div>
      <el-form label-position="top">
        <el-form-item label="适用岗位">
          <el-select
            v-model="form.positionIds"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="不选择则不按岗位自动生效"
            :disabled="readonly"
            class="rs-select"
          >
            <el-option v-for="p in positions" :key="p.positionId" :label="p.name" :value="p.positionId" />
          </el-select>
          <div class="rs-hint">一个岗位最多对应一个运行规格；保存后，该岗位用户批量继承此规格</div>
        </el-form-item>
        <el-form-item label="允许用户申请" :error="fieldErrors.allowUserApply">
          <el-switch v-model="form.allowUserApply" :disabled="readonly || meta.isDefault" @change="clearError('allowUserApply')" />
          <div class="rs-hint">开启后，用户可按任务需要提交申请；所有个人申请均须审批，审批通过前继续使用原规格</div>
        </el-form-item>
      </el-form>
    </section>

    <section class="rs-sec">
      <div class="rs-sec-title">资源配置<span class="rs-sec-sub">k8s Pod 资源（demo：requests = limits）</span></div>
      <el-alert
        :title="`当前平台单实例上限：CPU ${resourceLimits.cpu} 核、内存 ${resourceLimits.memoryGi} Gi、临时存储 ${resourceLimits.diskGi} Gi。上限由平台根据集群可调度能力统一配置。`"
        type="info"
        :closable="false"
        show-icon
        class="rs-limit-alert"
      />
      <el-form label-position="top">
        <div class="rs-row3">
          <el-form-item label="CPU（核）" :error="fieldErrors.cpu" required>
            <el-input-number v-model="form.cpu" :min="0.5" :max="resourceLimits.cpu" :step="0.5" class="rs-num" :disabled="readonly" />
            <div class="rs-hint">最多 {{ resourceLimits.cpu }} 核 · resources.cpu</div>
          </el-form-item>
          <el-form-item label="内存（Gi）" :error="fieldErrors.memoryGi" required>
            <el-input-number v-model="form.memoryGi" :min="1" :max="resourceLimits.memoryGi" :step="1" class="rs-num" :disabled="readonly" />
            <div class="rs-hint">最多 {{ resourceLimits.memoryGi }} Gi · resources.memory</div>
          </el-form-item>
          <el-form-item label="临时存储（Gi）" :error="fieldErrors.diskGi" required>
            <el-input-number v-model="form.diskGi" :min="1" :max="resourceLimits.diskGi" :step="5" class="rs-num" :disabled="readonly" />
            <div class="rs-hint">最多 {{ resourceLimits.diskGi }} Gi · resources.ephemeral-storage</div>
          </el-form-item>
        </div>
      </el-form>
    </section>

    <section class="rs-sec">
      <div class="rs-sec-title">运行策略</div>
      <el-form label-position="top">
        <div class="rs-row3">
          <el-form-item label="Pod 就绪超时（分钟）" :error="fieldErrors.readinessTimeoutMin" required>
            <el-input-number v-model="form.readinessTimeoutMin" :min="1" class="rs-num" :disabled="readonly" />
            <div class="rs-hint">创建 Pod 后等待 warmed=true，写入时转为秒；不是任务超时</div>
          </el-form-item>
          <el-form-item label="空闲回收（分钟）" :error="fieldErrors.idleRecycleMin" required>
            <el-input-number v-model="form.idleRecycleMin" :min="1" class="rs-num" :disabled="readonly" />
            <div class="rs-hint">空闲达时长后回收 Pod</div>
          </el-form-item>
          <el-form-item label="最大存活时长（小时）" :error="fieldErrors.maxLifetimeHours" required>
            <el-input-number v-model="form.maxLifetimeHours" :min="0" :step="1" class="rs-num" :disabled="readonly" />
            <div class="rs-hint">0 表示不限；对已运行 Pod 也生效</div>
          </el-form-item>
        </div>
      </el-form>
    </section>

    <section v-if="isEdit" class="rs-sec">
      <div class="rs-sec-title">生效情况<span class="rs-sec-sub">只读 · 个人配置 &gt; 岗位继承 &gt; 平台默认</span></div>
      <div v-if="meta.effectiveUsers.length" class="rs-used">
        <span v-for="u in meta.effectiveUsers.slice(0, 10)" :key="u.username" class="rs-used-item">
          <StatusTag type="info">{{ u.name }}</StatusTag>
          <span class="rs-source">{{ u.source === 'USER' ? '个人配置' : u.source === 'POSITION' ? `岗位 · ${u.positionName}` : '平台默认' }}</span>
        </span>
      </div>
      <div v-else class="rs-used-empty">暂无用户生效</div>
      <div v-if="meta.pendingUsers.length" class="rs-pending">另有 {{ meta.pendingUsers.length }} 个个人申请待审批</div>
    </section>
  </DrawerEditor>
</template>

<style>
/* 保存前确认窗正文（ElMessageBox teleport 到 body，scoped 命不中；以 .rs-confirm-* 限定） */
.rs-confirm-body p { margin: 0 0 var(--space-2); }
.rs-confirm-list { margin: 0 0 var(--space-2); padding-left: 1.4em; line-height: 1.7; }
</style>

<style scoped>
.rs-times {
  display: flex;
  gap: var(--space-4);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  margin-bottom: var(--space-3);
}
.rs-sec {
  margin-bottom: var(--space-4);
}
.rs-sec-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-2);
}
.rs-sec-sub {
  margin-left: var(--space-2);
  font-size: var(--fs-xs);
  font-weight: normal;
  color: var(--c-text-faint);
}
.rs-row2,
.rs-row3 {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}
.rs-row2 > .el-form-item,
.rs-row3 > .el-form-item {
  flex: 1;
  min-width: 0;
}
.rs-grow {
  flex: 2;
}
.rs-num {
  width: 100%;
}
.rs-select { width: 100%; }
.rs-default-alert { margin-bottom: var(--space-3); }
.rs-limit-alert { margin-bottom: var(--space-3); }
.rs-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
  margin-top: 2px;
}
.rs-used {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}
.rs-used-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.rs-used-empty {
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
}
.rs-source,
.rs-pending {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.rs-pending { margin-top: var(--space-2); }
</style>
