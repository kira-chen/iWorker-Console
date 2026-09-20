<script setup>
/**
 * 版本编辑抽屉（05 治理 / 版本管理，ADMIN 专属）。
 * 依据 docs/PRD/数字员工管理端PRD/05治理/版本管理/prd.版本管理.md §四。
 *
 * 【三态】新建（标题「新建版本」）/ 编辑（仅从未发布过的未发布版本，终端置灰）/ 查看（其余版本，只读，底部仅【关闭】）。
 * 查看态额外展示只读的状态、发布人、发布时间与 SHA-256 校验值；审核中另展示申请类型 / 申请人 / 申请时间（§四）。
 * 新建时选好终端会按终端自动生成版本号预填（可改，§4.1）。
 *
 * 【版本包上传（§4.2）】单文件，必须在本页上传（不支持外链）。状态机：
 *   idle（未上传）→ uploading（进度 + 取消）→ done（重新上传 / 移除）或 error（重试 / 移除）。
 *   - 选文件时**立即**校验格式 / 空文件 / 大小（utils/versionMeta.validatePackageFile），不通过不开始上传；
 *   - 上传中【保存】置灰；关闭抽屉需二次确认并中断上传；
 *   - 新建时改选终端，已传的包与新终端格式不符 → 提示并清空；
 *   - 上传的文件在点【保存】前只是临时文件：关闭抽屉即丢弃；编辑时重新上传的新包保存后才替换旧包。
 *   demo 里上传只是示意（api/versionMock.js 头注释）。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Document } from '@element-plus/icons-vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import { confirmDialog } from '@/composables/useConfirm'
import { createVersion, updateVersion, uploadVersionPackage, getNextVersion } from '@/api/version'
import { fmtTime } from '@/utils/docMeta'
import {
  TERMINAL_OPTIONS,
  PACKAGE_EXTS,
  RELEASE_NOTES_MAX,
  STATUS_META,
  terminalLabel,
  parseVersion,
  formatFileSize,
  validatePackageFile
} from '@/utils/versionMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 待编辑 / 查看的版本行（null = 新建）
  version: { type: Object, default: null },
  // 查看态：审核中 / 已发布 / 曾发布过的未发布版本只读
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved'])

const isEdit = computed(() => !!props.version?.id && !props.readonly)
const title = computed(() => (props.readonly ? '查看版本' : isEdit.value ? '编辑版本' : '新建版本'))

const formRef = ref()
const saving = ref(false)
const form = reactive({ terminal: '', version: '', releaseNotes: '' })
// 版本号的服务端校验结果（如「该终端下已存在版本 v1.2.0」），就地挂在版本号字段下，输入即消
const versionError = ref('')

/* ---------------- 版本包上传状态机 ---------------- */
const emptyPkg = () => ({ status: 'idle', fileName: '', fileSize: 0, sha256: '', progress: 0, error: '' })
const pkg = reactive(emptyPkg())
const pkgError = ref('') // 选择文件时的校验失败 / 保存时「请上传版本包」
const uploading = computed(() => pkg.status === 'uploading')
let uploadCtl = null // 当前上传的 AbortController
let retryFile = null // 上传失败后【重试】要重传的文件
let prevPkg = null // 「重新上传」开始前的旧包（取消上传时还原）

const fileInput = ref()
const uploadRef = ref()
const acceptAttr = computed(() => (PACKAGE_EXTS[form.terminal] || []).join(','))
const uploadTip = computed(() =>
  form.terminal
    ? `${terminalLabel(form.terminal)} 支持 ${PACKAGE_EXTS[form.terminal].join(' / ')}`
    : '请先选择终端，再上传版本包'
)

function resetPkg(source) {
  Object.assign(pkg, emptyPkg())
  if (source?.packageName) {
    Object.assign(pkg, { status: 'done', fileName: source.packageName, fileSize: source.packageSize, sha256: source.sha256 })
  }
  pkgError.value = ''
  uploadCtl = null
  retryFile = null
  prevPkg = null
}

// 版本号自动生成（PRD §4.1）：新建时选好终端 → 按终端预填下一个版本号，用户可改；手动输入过就不再覆盖
let versionTouched = false
const autoVersion = ref('') // 当前预填的自动版本号（用于提示「已自动生成」）

function reset() {
  form.terminal = props.version?.terminal || ''
  form.version = props.version?.version || ''
  form.releaseNotes = props.version?.releaseNotes || ''
  versionError.value = ''
  versionTouched = false
  autoVersion.value = ''
  resetPkg(props.version)
  formRef.value?.clearValidate?.()
}
watch(
  () => props.visible,
  (v) => {
    if (v) reset()
  }
)

/** 选择 / 拖入 / 重新上传 / 重试的统一入口：先校验，再上传。 */
async function startUpload(file) {
  if (!form.terminal) return
  pkgError.value = ''
  const problem = validatePackageFile(form.terminal, file)
  if (problem) {
    pkgError.value = problem
    return
  }
  prevPkg = pkg.status === 'done' ? { ...pkg } : null
  retryFile = file
  const ctl = new AbortController()
  uploadCtl = ctl
  Object.assign(pkg, { status: 'uploading', fileName: file.name, fileSize: file.size, sha256: '', progress: 0, error: '' })
  try {
    const res = await uploadVersionPackage(file, { signal: ctl.signal, onProgress: (p) => (pkg.progress = p) })
    if (ctl.signal.aborted) return
    Object.assign(pkg, { status: 'done', fileName: res.fileName, fileSize: res.fileSize, sha256: res.sha256, progress: 100 })
    prevPkg = null
  } catch (e) {
    if (e?.name === 'AbortError') return // 取消：状态由 cancelUpload 还原
    pkg.status = 'error'
    pkg.error = e?.message || '上传失败，请重试'
  } finally {
    if (uploadCtl === ctl) uploadCtl = null
  }
}

function onPick(uploadFile) {
  uploadRef.value?.clearFiles?.() // 不用 el-upload 自带的文件列表，选完即清
  if (uploadFile?.raw) startUpload(uploadFile.raw)
}
function onNativePick(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // 允许再次选同一个文件
  if (file) startUpload(file)
}
const reselect = () => fileInput.value?.click()
const retry = () => retryFile && startUpload(retryFile)

/** 取消上传：有旧包则还原（编辑时重新上传中途取消），否则回到未上传。 */
function cancelUpload() {
  uploadCtl?.abort()
  uploadCtl = null
  if (prevPkg) Object.assign(pkg, prevPkg)
  else Object.assign(pkg, emptyPkg())
  prevPkg = null
}
function removePkg() {
  Object.assign(pkg, emptyPkg())
  retryFile = null
  prevPkg = null
}

function onVersionInput(value) {
  versionError.value = ''
  // 输入框被清空视同没手填过，之后改选终端可重新自动生成
  versionTouched = String(value || '').trim() !== ''
  if (versionTouched) autoVersion.value = ''
}

watch(
  () => form.terminal,
  async (t) => {
    if (isEdit.value || props.readonly || !t || versionTouched) return
    try {
      const next = await getNextVersion(t)
      // 请求期间用户手填了版本号 / 又改了终端 → 放弃这次预填
      if (versionTouched || form.terminal !== t) return
      form.version = next
      autoVersion.value = next
      versionError.value = ''
      formRef.value?.clearValidate?.('version')
    } catch (e) {
      // 取不到就留空，让用户手填，不打断操作
    }
  }
)

const versionHint = computed(() => {
  const base = '格式为 X.Y.Z 三段数字，可带前缀 v；同一终端下不可重复'
  return autoVersion.value && form.version === autoVersion.value
    ? `已按该终端已有最高版本号自动生成，可直接修改。${base}`
    : base
})

// 新建时改选终端：已传的包与新终端格式不符 → 提示并清空（.zip 两端通用，不受影响）
watch(
  () => form.terminal,
  (t) => {
    if (isEdit.value || !t || pkg.status === 'idle') return
    const exts = PACKAGE_EXTS[t] || []
    if (exts.some((ext) => pkg.fileName.toLowerCase().endsWith(ext))) return
    if (uploading.value) {
      uploadCtl?.abort()
      uploadCtl = null
    }
    removePkg()
    ElMessage.warning('已上传的版本包与所选终端不匹配，需重新上传')
  }
)

/* ---------------- 校验与保存 ---------------- */
const rules = {
  terminal: [{ required: true, message: '请选择终端', trigger: 'change' }],
  version: [
    { required: true, whitespace: true, message: '请填写版本号', trigger: 'blur' },
    {
      validator: (_rule, value, callback) =>
        !String(value || '').trim() || parseVersion(value)
          ? callback()
          : callback(new Error('版本号格式应为 X.Y.Z，如 v1.2.0')),
      trigger: 'blur'
    }
  ],
  releaseNotes: [{ required: true, whitespace: true, message: '请填写更新说明', trigger: 'blur' }]
}

async function onSubmit() {
  if (!formRef.value || uploading.value) return
  let valid = true
  try {
    await formRef.value.validate()
  } catch {
    valid = false
  }
  // 版本包不在 el-form 的校验体系里（它是状态机），保存时补一道
  pkgError.value = pkg.status === 'done' ? '' : '请上传版本包'
  if (!valid || pkgError.value) return

  saving.value = true
  try {
    const payload = {
      terminal: form.terminal,
      version: form.version,
      releaseNotes: form.releaseNotes,
      package: { fileName: pkg.fileName, fileSize: pkg.fileSize, sha256: pkg.sha256 }
    }
    if (isEdit.value) await updateVersion(props.version.id, payload)
    else await createVersion(payload)
    ElMessage.success('版本已保存')
    emit('update:visible', false)
    emit('saved')
  } catch (e) {
    if (e?.field === 'version') versionError.value = e.message
    else if (e?.field === 'package') pkgError.value = e.message
    else ElMessage.error(e?.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}

/**
 * 关闭拦截：上传中需二次确认并中断上传（§九）。两条关闭路径：
 *  - 【取消】按钮：onCancel 先确认再回报 update:visible=false；
 *  - 抽屉 × / ESC / 遮罩：el-drawer 会先自行收起再回报，回报时已拦不住，故经 before-close 钩子拦
 *    （`:before-close` 不是 DrawerEditor 的 prop，按单根透传落到其根 el-drawer，同 RuntimeSpecEditor）。
 */
async function confirmAbortUpload() {
  if (!uploading.value) return true
  const ok = await confirmDialog('版本包正在上传，关闭将中断上传，确认关闭？', '关闭确认', { confirmText: '确认关闭' })
  if (ok) {
    uploadCtl?.abort()
    uploadCtl = null
  }
  return ok
}
async function onBeforeClose(done) {
  if (!(await confirmAbortUpload())) return done(true) // done(true) = 取消关闭，抽屉保持打开
  done()
}
async function onCancel() {
  if (await confirmAbortUpload()) emit('update:visible', false)
}
const dialogVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})
</script>

<template>
  <DrawerEditor
    v-model:visible="dialogVisible"
    :title="title"
    :saving="saving"
    :before-close="onBeforeClose"
    append-to-body
  >
    <!-- ================= 查看态：只读明细 ================= -->
    <template v-if="readonly && version">
      <section class="section-card">
        <h3 class="section-title">版本信息</h3>
        <dl class="ve-dl">
          <div class="ve-dl-item">
            <dt>终端</dt>
            <dd><StatusTag type="accent">{{ terminalLabel(version.terminal) }}</StatusTag></dd>
          </div>
          <div class="ve-dl-item">
            <dt>版本号</dt>
            <dd class="ve-mono">{{ version.version }}</dd>
          </div>
          <div class="ve-dl-item">
            <dt>状态</dt>
            <dd><StatusTag :type="STATUS_META[version.status]?.tagType">{{ STATUS_META[version.status]?.label }}</StatusTag></dd>
          </div>
          <!-- 审核中：展示申请类型（发布 / 停用）与提交申请的人、时间 -->
          <template v-if="version.status === 'PENDING_REVIEW'">
            <div class="ve-dl-item">
              <dt>申请类型</dt>
              <dd>{{ version.pendingAction === 'STOP' ? '停用' : '发布' }}</dd>
            </div>
            <div class="ve-dl-item">
              <dt>申请人</dt>
              <dd>{{ version.submittedBy || '—' }}</dd>
            </div>
            <div class="ve-dl-item">
              <dt>申请时间</dt>
              <dd>{{ version.submittedAt ? fmtTime(version.submittedAt) : '—' }}</dd>
            </div>
          </template>
          <div class="ve-dl-item">
            <dt>发布人</dt>
            <dd>{{ version.publishedBy || '—' }}</dd>
          </div>
          <div class="ve-dl-item">
            <dt>发布时间</dt>
            <dd>{{ version.publishedAt ? fmtTime(version.publishedAt) : '—' }}</dd>
          </div>
        </dl>
      </section>
      <section class="section-card">
        <h3 class="section-title">版本包</h3>
        <dl class="ve-dl">
          <div class="ve-dl-item">
            <dt>文件名</dt>
            <dd>{{ version.packageName }} · {{ formatFileSize(version.packageSize) }}</dd>
          </div>
          <div class="ve-dl-item ve-dl-item--full">
            <dt>校验值（SHA-256）</dt>
            <dd class="ve-mono ve-hash">{{ version.sha256 }}</dd>
          </div>
        </dl>
      </section>
      <section class="section-card">
        <h3 class="section-title">更新说明</h3>
        <div class="ve-notes-full">{{ version.releaseNotes }}</div>
      </section>
    </template>

    <!-- ================= 新建 / 编辑态：表单 ================= -->
    <el-form v-else ref="formRef" :model="form" :rules="rules" label-position="top" class="ve-form">
      <section class="section-card">
        <h3 class="section-title">版本信息</h3>
        <el-form-item label="终端" prop="terminal">
          <el-radio-group v-model="form.terminal" :disabled="isEdit">
            <el-radio v-for="o in TERMINAL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
          </el-radio-group>
          <div class="ve-hint">终端创建后不可修改（版本包与终端绑定）</div>
        </el-form-item>
        <el-form-item label="版本号" prop="version" :error="versionError">
          <el-input v-model="form.version" placeholder="如 v1.2.0" maxlength="32" @input="onVersionInput" />
          <div class="ve-hint">{{ versionHint }}</div>
        </el-form-item>

        <!-- 版本包：状态机控件，不走 el-form 校验（无 prop），必填星标由 required 给，错误就地显示（pkgError） -->
        <el-form-item label="版本包" required class="ve-pkg" :class="{ 'is-invalid': pkgError }">
          <div v-show="pkg.status === 'idle'" class="ve-block" :title="form.terminal ? '' : '请先选择终端'">
            <el-upload
              ref="uploadRef"
              class="ve-drop"
              drag
              :auto-upload="false"
              :show-file-list="false"
              :disabled="!form.terminal"
              :on-change="onPick"
            >
              <el-icon class="ve-up-icon"><UploadFilled /></el-icon>
              <div class="ve-up-text">点击选择或拖拽版本包到此处</div>
            </el-upload>
          </div>

          <div v-if="pkg.status !== 'idle'" class="ve-file ve-block" :class="`is-${pkg.status}`">
            <div class="ve-file-row">
              <el-icon class="ve-file-icon"><Document /></el-icon>
              <span class="ve-file-name" :title="pkg.fileName">{{ pkg.fileName }}</span>
              <span class="ve-file-size">{{ formatFileSize(pkg.fileSize) }}</span>
              <span class="ve-file-ops">
                <template v-if="pkg.status === 'uploading'">
                  <el-button link @click="cancelUpload">取消上传</el-button>
                </template>
                <template v-else-if="pkg.status === 'done'">
                  <el-button link type="primary" @click="reselect">重新上传</el-button>
                  <el-button link @click="removePkg">移除</el-button>
                </template>
                <template v-else>
                  <el-button link type="primary" @click="retry">重试</el-button>
                  <el-button link @click="removePkg">移除</el-button>
                </template>
              </span>
            </div>
            <el-progress v-if="pkg.status === 'uploading'" :percentage="pkg.progress" :stroke-width="6" />
            <div v-else-if="pkg.status === 'error'" class="ve-error">{{ pkg.error }}</div>
          </div>

          <div class="ve-hint">{{ uploadTip }}</div>
          <div v-if="pkgError" class="ve-error">{{ pkgError }}</div>
          <input ref="fileInput" type="file" hidden :accept="acceptAttr" @change="onNativePick" />
        </el-form-item>

        <el-form-item label="更新说明" prop="releaseNotes" class="ve-last-item">
          <el-input
            v-model="form.releaseNotes"
            type="textarea"
            :rows="8"
            :maxlength="RELEASE_NOTES_MAX"
            show-word-limit
            placeholder="简述本次更新了什么，将展示给用户端用户"
          />
        </el-form-item>
      </section>
    </el-form>

    <!-- 底部操作：上传中【保存】置灰并提示 -->
    <template #footer>
      <el-button @click="onCancel">{{ readonly ? '关闭' : '取消' }}</el-button>
      <el-tooltip v-if="!readonly" :disabled="!uploading" content="版本包上传中，请稍候" placement="top">
        <span>
          <el-button type="primary" :loading="saving" :disabled="uploading" @click="onSubmit">保存</el-button>
        </span>
      </el-tooltip>
    </template>
  </DrawerEditor>
</template>

<style scoped>
.ve-last-item {
  margin-bottom: 0;
}
.ve-hint {
  width: 100%;
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
}
.ve-error {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-danger);
  line-height: 1.5;
}
/* 版本包表单项内的块（上传区 / 文件条）占满一行；校验失败时上传区描边转红 */
.ve-block {
  width: 100%;
}
.ve-pkg.is-invalid :deep(.el-upload-dragger) {
  border-color: var(--c-danger);
}

/* 上传拖拽区（与技能包导入同一范式：EP 拖拽框拔高、居中） */
.ve-drop :deep(.el-upload-dragger) {
  min-height: 132px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.ve-up-icon {
  font-size: 40px;
  color: var(--c-text-faint);
  margin-bottom: var(--space-2);
}
.ve-up-text {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

/* 已选 / 上传中 / 失败的文件条 */
.ve-file {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
.ve-file.is-done {
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
.ve-file.is-error {
  border-color: var(--c-danger);
}
.ve-file-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.ve-file-icon {
  flex-shrink: 0;
  color: var(--c-text-muted);
}
.ve-file-name {
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
.ve-file-size {
  flex-shrink: 0;
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.ve-file-ops {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  gap: var(--space-3);
}
.ve-file .ve-error {
  margin-top: 0;
}

/* 查看态明细：label 在上、值在下，两列栅格 */
.ve-dl {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4) var(--space-5);
}
.ve-dl-item--full {
  grid-column: 1 / -1;
}
.ve-dl-item dt {
  margin-bottom: 4px;
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.ve-dl-item dd {
  margin: 0;
  color: var(--c-text);
  line-height: 1.65;
  word-break: break-all;
}
.ve-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.ve-hash {
  font-size: var(--fs-xs);
}
.ve-notes-full {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.65;
  color: var(--c-text);
  max-height: 50vh;
  overflow-y: auto;
}
</style>
