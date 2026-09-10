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
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import { getRuntimeSpec, getRuntimeSpecLimits, createRuntimeSpec, updateRuntimeSpec } from '@/api/runtimeSpec'
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

const loading = ref(false)
const loadError = ref(false)
const saving = ref(false)
const fieldErrors = reactive({})

function clearErrors() {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k])
}

function resetForm() {
  Object.assign(form, {
    name: '', boundaryDesc: '', cpu: 2, memoryGi: 4, diskGi: 20,
    readinessTimeoutMin: 10, idleRecycleMin: 20, maxLifetimeHours: 0,
    positionIds: [], allowUserApply: true
  })
  Object.assign(meta, { createdAt: '', updatedAt: '', effectiveUsers: [], pendingUsers: [], isDefault: false })
  clearErrors()
}

async function load() {
  resetForm()
  loading.value = true
  loadError.value = false
  try {
    const [positionData, limitData] = await Promise.all([
      listPositions({ size: 200, status: 'published' }),
      getRuntimeSpecLimits()
    ])
    positions.value = positionData?.list || []
    Object.assign(resourceLimits, limitData)
    if (!isEdit.value) return
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
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

watch(() => props.visible, (v) => { if (v) load() })

function validate() {
  clearErrors()
  const errors = {}
  if (!form.name.trim()) errors.name = '规格名称不能为空'
  if (!form.boundaryDesc.trim()) errors.boundaryDesc = '能力边界说明必填（FDE 唯一可见的内容）'
  for (const [k, label] of [
    ['cpu', 'CPU'], ['memoryGi', '内存'], ['diskGi', '临时存储'],
    ['readinessTimeoutMin', '就绪等待超时'], ['idleRecycleMin', '空闲回收']
  ]) {
    if (!(Number(form[k]) > 0)) errors[k] = `${label}须大于 0`
  }
  if (!(Number(form.maxLifetimeHours) >= 0) || !Number.isInteger(Number(form.maxLifetimeHours))) {
    errors.maxLifetimeHours = '最大存活时长须为非负整数'
  }
  for (const [k, label, unit] of [
    ['cpu', 'CPU', '核'], ['memoryGi', '内存', 'Gi'], ['diskGi', '临时存储', 'Gi']
  ]) {
    if (Number(form[k]) > resourceLimits[k]) errors[k] = `${label}不能超过平台单实例上限 ${resourceLimits[k]} ${unit}`
  }
  Object.assign(fieldErrors, errors)
  return Object.keys(errors).length === 0
}

async function save() {
  if (props.readonly) return
  if (!validate()) return
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
    create-text="创建"
    append-to-body
    @update:visible="emit('update:visible', $event)"
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
          <el-input v-model="form.name" maxlength="64" show-word-limit placeholder="如 标准、高敏" :disabled="readonly" />
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
        <el-form-item label="允许用户申请">
          <el-switch v-model="form.allowUserApply" :disabled="readonly || meta.isDefault" />
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
