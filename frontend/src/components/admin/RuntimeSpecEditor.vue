<script setup>
/**
 * 运行规格编辑抽屉（04运行 › 运行规格，2026-09-02 启动轮；基准=负责人交互截图，标准件 DrawerEditor 收壳）。
 *
 * 信息结构：
 *   首行元信息（编辑态：创建 / 最近更新时间，弱色提示展示，与 API/MCP 抽屉同款）
 *   → 基本信息（规格名称[必填≤64,平台内唯一]；能力边界说明[必填≤200]——
 *     D17：FDE 只见「规格名 + 能力边界说明」，此字段是 FDE 唯一可见内容）
 *   → 资源配置（k8s Pod：CPU 核 / 内存 Gi / 临时磁盘 Gi，映射 resources.requests=limits，
 *     demo 不真连集群，映射关系以弱色提示展示）
 *   → 运行策略（任务超时 / 空闲回收 / 并发上限 / 出网 允许|禁止 / 使用需审批）
 *   → 在用用户（编辑态只读：用户名 tag + 审批态；短期版本按用户分配 Pod，
 *     用户侧分配字段落地后双向联动）。
 *
 * 2026-09-02 修正：绑定对象为用户而非岗位；不设「默认规格」。
 * 护栏：重名走 mock ApiError 的 field 定位就地红框。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import { getRuntimeSpec, createRuntimeSpec, updateRuntimeSpec } from '@/api/runtimeSpec'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 编辑目标 id；null = 新建 */
  specId: { type: [Number, String], default: null }
})
const emit = defineEmits(['update:visible', 'saved'])

const isEdit = computed(() => props.specId != null)

const form = reactive({
  name: '',
  boundaryDesc: '',
  cpu: 2,
  memoryGi: 4,
  diskGi: 20,
  timeoutMin: 10,
  idleRecycleMin: 20,
  concurrency: 80,
  egress: 'ALLOW',
  requireApproval: false
})
const meta = reactive({ createdAt: '', updatedAt: '', usedUsers: [], requireApprovalStored: false })

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
    timeoutMin: 10, idleRecycleMin: 20, concurrency: 80,
    egress: 'ALLOW', requireApproval: false
  })
  Object.assign(meta, { createdAt: '', updatedAt: '', usedUsers: [], requireApprovalStored: false })
  clearErrors()
}

async function load() {
  resetForm()
  if (!isEdit.value) return
  loading.value = true
  loadError.value = false
  try {
    const d = await getRuntimeSpec(props.specId)
    Object.assign(form, {
      name: d.name, boundaryDesc: d.boundaryDesc,
      cpu: d.cpu, memoryGi: d.memoryGi, diskGi: d.diskGi,
      timeoutMin: d.timeoutMin, idleRecycleMin: d.idleRecycleMin, concurrency: d.concurrency,
      egress: d.egress, requireApproval: d.requireApproval
    })
    Object.assign(meta, {
      createdAt: d.createdAt, updatedAt: d.updatedAt,
      usedUsers: d.usedUsers, requireApprovalStored: d.requireApproval
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
    ['cpu', 'CPU'], ['memoryGi', '内存'], ['diskGi', '临时磁盘'],
    ['timeoutMin', '任务超时'], ['idleRecycleMin', '空闲回收'], ['concurrency', '并发上限']
  ]) {
    if (!(Number(form[k]) > 0)) errors[k] = `${label}须大于 0`
  }
  Object.assign(fieldErrors, errors)
  return Object.keys(errors).length === 0
}

async function save() {
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
      <el-form label-position="top">
        <el-form-item label="规格名称" :error="fieldErrors.name" required>
          <el-input v-model="form.name" maxlength="64" show-word-limit placeholder="如 标准、高敏离网" />
        </el-form-item>
        <el-form-item label="能力边界说明" :error="fieldErrors.boundaryDesc" required>
          <el-input
            v-model="form.boundaryDesc"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="如：可处理 100MB 以内文件，单次任务最长 10 分钟"
          />
          <div class="rs-hint">FDE 只看到「规格名 + 能力边界说明」，看不到任何技术参数</div>
        </el-form-item>
      </el-form>
    </section>

    <section class="rs-sec">
      <div class="rs-sec-title">资源配置<span class="rs-sec-sub">k8s Pod 资源（demo：requests = limits）</span></div>
      <el-form label-position="top">
        <div class="rs-row3">
          <el-form-item label="CPU（核）" :error="fieldErrors.cpu" required>
            <el-input-number v-model="form.cpu" :min="0.5" :step="0.5" class="rs-num" />
            <div class="rs-hint">resources.cpu</div>
          </el-form-item>
          <el-form-item label="内存（Gi）" :error="fieldErrors.memoryGi" required>
            <el-input-number v-model="form.memoryGi" :min="1" :step="1" class="rs-num" />
            <div class="rs-hint">resources.memory</div>
          </el-form-item>
          <el-form-item label="临时磁盘（Gi）" :error="fieldErrors.diskGi" required>
            <el-input-number v-model="form.diskGi" :min="1" :step="5" class="rs-num" />
            <div class="rs-hint">resources.ephemeral-storage</div>
          </el-form-item>
        </div>
      </el-form>
    </section>

    <section class="rs-sec">
      <div class="rs-sec-title">运行策略</div>
      <el-form label-position="top">
        <div class="rs-row3">
          <el-form-item label="任务超时（分钟）" :error="fieldErrors.timeoutMin" required>
            <el-input-number v-model="form.timeoutMin" :min="1" class="rs-num" />
            <div class="rs-hint">单次任务超时即终止</div>
          </el-form-item>
          <el-form-item label="空闲回收（分钟）" :error="fieldErrors.idleRecycleMin" required>
            <el-input-number v-model="form.idleRecycleMin" :min="1" class="rs-num" />
            <div class="rs-hint">空闲达时长后回收 Pod</div>
          </el-form-item>
          <el-form-item label="并发上限" :error="fieldErrors.concurrency" required>
            <el-input-number v-model="form.concurrency" :min="1" class="rs-num" />
            <div class="rs-hint">该规格同时运行的实例数</div>
          </el-form-item>
        </div>
        <div class="rs-row2">
          <el-form-item label="出网">
            <el-radio-group v-model="form.egress">
              <el-radio value="ALLOW">允许</el-radio>
              <el-radio value="DENY">禁止</el-radio>
            </el-radio-group>
            <div class="rs-hint">禁止 = NetworkPolicy 断外网，仅可访问内部系统</div>
          </el-form-item>
          <el-form-item label="使用需审批">
            <el-switch v-model="form.requireApproval" />
            <div class="rs-hint">开启后，为用户分配该规格需管理员审批通过</div>
          </el-form-item>
        </div>
      </el-form>
    </section>

    <!-- 在用用户（编辑态只读；短期版本为每个用户分配 Pod，用户侧分配字段落地后双向联动） -->
    <section v-if="isEdit" class="rs-sec">
      <div class="rs-sec-title">在用用户<span class="rs-sec-sub">只读 · 短期版本按用户分配 Pod</span></div>
      <div v-if="meta.usedUsers.length" class="rs-used">
        <span v-for="u in meta.usedUsers" :key="u.username" class="rs-used-item">
          <StatusTag type="info">{{ u.name }}</StatusTag>
          <StatusTag v-if="meta.requireApprovalStored && u.approval" :type="u.approval === 'APPROVED' ? 'success' : 'warning'">
            {{ u.approval === 'APPROVED' ? '已审批' : '待审批' }}
          </StatusTag>
        </span>
      </div>
      <div v-else class="rs-used-empty">暂无用户使用</div>
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
</style>
