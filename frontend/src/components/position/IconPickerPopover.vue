<script setup>
/**
 * 图标选择 popover（全站图标配置统一入口）—— 锚在头像/图标预览旁，点击展开入口菜单。
 *
 * 2026-09-02 按 PRD「图标统一规则」改造（docs/prd/PRD-20260828/02岗位/岗位/prd.岗位.md 图标一节，
 * 岗位/专家/技能/模型/MCP/API/业务系统一致）：
 * - 两个规则入口：【从图标库选择】（弹窗展示图标库网格）与【上传图标】；「AI 生成」为站内既有入口，保留；
 * - 上传支持 PNG/JPG/JPEG/WebP/GIF/SVG，单文件 ≤5MB；异常文案逐字「请选择图片文件」「图片不能超过 5 MB」；
 * - 上传后进入方形裁剪弹窗（拖动图片 + 缩放滑杆 + 【重新选择图片】/【取消】/【使用该区域】），
 *   输出 256×256 PNG dataURL（GIF/SVG 经 canvas 静态化为 PNG）——纯前端产物，不再调上传接口；
 * - 上传与图标库互斥替换：后选者整体覆盖前者（单值 commit 天然满足）；
 * - 只读态（readonly prop，新增、默认 false）：入口置灰不可点。
 *
 * 数据流（契约不变）：选中/裁剪/生成后**一次性**回吐 `{ icon, iconSource }`（emit('pick')），
 * 由父级单次落值，避免连续两次基于旧 props 展开导致 icon 被 iconSource 覆盖丢失的 bug。
 * 图标库走现有 getIconLibrary（条目 {id, url:emoji, name}，选中存 icon=url）。
 * 双主题语义令牌，不写死色值；loading/灰显态齐全。
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { getIconLibrary, aiGenerateIcon, probeAiIconAvailability } from '@/api/position'
import {
  ICON_ACCEPT,
  validateIconFile,
  coverScale,
  clampOffset,
  centerOffset,
  zoomAroundCenter,
  sourceRect,
  cropToPngDataUrl
} from '@/utils/iconCrop'

const props = defineProps({
  // 当前图标值（高亮选中项）
  icon: { type: String, default: '' },
  // 岗位/对象名（AI 生成图标的提示词）
  positionName: { type: String, default: '' },
  // 只读态：入口置灰不可点（PRD 图标统一规则·只读状态）
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['pick'])

const open = ref(false)
const aiAvailable = ref(true)
const aiBusy = ref(false)
const fileInput = ref(null)
let probed = false

/* ---------- 图标库弹窗 ---------- */
const libOpen = ref(false)
const iconLib = ref([])
const iconLibLoading = ref(false)

// popover 首次展开时探测生图能力（懒加载，不在首屏付代价）。
watch(open, async (v) => {
  if (!v || probed) return
  probed = true
  try {
    const res = await probeAiIconAvailability()
    if (res && typeof res.available === 'boolean') aiAvailable.value = res.available
  } catch {
    /* 探测失败：保持可用，点击时由 ai-generate 回 available=false 兜底灰显 */
  }
})

async function openLibrary() {
  open.value = false
  libOpen.value = true
  if (iconLib.value.length) return
  iconLibLoading.value = true
  try {
    iconLib.value = (await getIconLibrary()) || []
  } catch {
    /* 读接口全局已提示 */
  } finally {
    iconLibLoading.value = false
  }
}

// 单次回吐 {icon, iconSource}（修复连续两次 patch 覆盖 bug）。
// 上传与图标库互斥替换：单值覆盖，后选的天然清除前者。
function commit(icon, iconSource) {
  emit('pick', { icon, iconSource })
}

function pickLibIcon(ic) {
  commit(ic.url || ic.id, 'library')
  libOpen.value = false
}

/* ---------- 上传 → 方形裁剪 ---------- */
const VIEWPORT = 280 // 裁剪视口边长（px），输出恒为 256×256 PNG
const cropOpen = ref(false)
const cropImgUrl = ref('')
const natW = ref(0)
const natH = ref(0)
const zoom = ref(100) // 100%~300%，基于 cover 基准缩放
const offset = ref({ x: 0, y: 0 })
let cropImgEl = null // 已加载的 Image（drawImage 源）

const dispScale = computed(() => coverScale(natW.value, natH.value, VIEWPORT) * (zoom.value / 100))
const imgStyle = computed(() => ({
  width: `${natW.value * dispScale.value}px`,
  height: `${natH.value * dispScale.value}px`,
  transform: `translate(${offset.value.x}px, ${offset.value.y}px)`
}))

function triggerUpload() {
  fileInput.value?.click()
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  const err = validateIconFile(file)
  if (err) {
    ElMessage.error(err)
    return
  }
  const reader = new FileReader()
  reader.onload = () => loadCropImage(String(reader.result || ''))
  reader.onerror = () => ElMessage.error('图片读取失败，请重新选择')
  reader.readAsDataURL(file)
}

function loadCropImage(dataUrl) {
  const img = new Image()
  img.onload = () => {
    if (!img.naturalWidth || !img.naturalHeight) {
      ElMessage.error('图片读取失败，请重新选择')
      return
    }
    cropImgEl = img
    cropImgUrl.value = dataUrl
    natW.value = img.naturalWidth
    natH.value = img.naturalHeight
    zoom.value = 100
    offset.value = centerOffset(natW.value, natH.value, dispScale.value, VIEWPORT)
    open.value = false
    cropOpen.value = true
  }
  img.onerror = () => ElMessage.error('图片读取失败，请重新选择')
  img.src = dataUrl
}

// 缩放滑杆：保持视口中心不动，再夹取回盖满范围。
watch(zoom, (nv, ov) => {
  if (!natW.value) return
  const base = coverScale(natW.value, natH.value, VIEWPORT)
  const s1 = base * (ov / 100)
  const s2 = base * (nv / 100)
  const next = zoomAroundCenter(offset.value, s1, s2, VIEWPORT)
  offset.value = clampOffset(next.x, next.y, natW.value, natH.value, s2, VIEWPORT)
})

/* 选区拖动（pointer 事件，move/up 挂 window 以支持拖出视口） */
let dragFrom = null
function onDragStart(e) {
  if (!cropOpen.value) return
  dragFrom = { px: e.clientX, py: e.clientY, ox: offset.value.x, oy: offset.value.y }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}
function onDragMove(e) {
  if (!dragFrom) return
  const nx = dragFrom.ox + (e.clientX - dragFrom.px)
  const ny = dragFrom.oy + (e.clientY - dragFrom.py)
  offset.value = clampOffset(nx, ny, natW.value, natH.value, dispScale.value, VIEWPORT)
}
function onDragEnd() {
  dragFrom = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}
onBeforeUnmount(onDragEnd)

function confirmCrop() {
  if (!cropImgEl) return
  try {
    const rect = sourceRect(offset.value, dispScale.value, VIEWPORT)
    const dataUrl = cropToPngDataUrl(cropImgEl, rect)
    commit(dataUrl, 'upload')
    cropOpen.value = false
    ElMessage.success('已更新图标')
  } catch {
    // PRD：读取失败时保留原图标并提示重新选择
    ElMessage.error('图片读取失败，请重新选择')
  }
}
function cancelCrop() {
  cropOpen.value = false
}

/* ---------- AI 生成（站内既有入口，保留） ---------- */
async function genAiIcon() {
  if (!aiAvailable.value || aiBusy.value) return
  aiBusy.value = true
  try {
    const res = await aiGenerateIcon(props.positionName)
    if (res?.available === false) {
      aiAvailable.value = false
      ElMessage.info(res?.message || '当前环境未配置生图模型')
      return
    }
    commit(res?.url, 'ai')
    ElMessage.success('已生成图标')
  } catch (err) {
    ElMessage.error(err?.message || '生成失败')
  } finally {
    aiBusy.value = false
  }
}

const iconIsUrl = computed(() => /^(https?:\/\/|\/|data:)/.test(props.icon || ''))
function isUrl(v) {
  return /^(https?:\/\/|\/|data:)/.test(v || '')
}

/* 2026-09-04 岗位详情卡片化返工：暴露图标库 / 上传两条链路，
 * 供宿主（如岗位详情「岗位图标」卡）以显式按钮直调——照原型「从图标库选择」「上传图标」排版；
 * popover 头像入口保留不变，两者共用同一 commit 回吐契约。 */
defineExpose({ openLibrary, triggerUpload })
</script>

<template>
  <el-popover v-model:visible="open" :width="320" trigger="click" placement="bottom-start" :disabled="readonly">
    <template #reference>
      <div class="ip-avatar" :class="{ 'is-readonly': readonly }" :title="readonly ? '' : '换图标'">
        <img v-if="iconIsUrl" :src="icon" alt="icon" class="ip-avatar-img" />
        <span v-else>{{ icon || '🧑‍💼' }}</span>
        <span v-if="!readonly" class="ip-avatar-edit">换图标</span>
      </div>
    </template>

    <div class="ip-pop">
      <div class="ip-actions">
        <span class="ip-card" :class="{ disabled: readonly }" @click="!readonly && openLibrary()">
          🎨 从图标库选择
        </span>
        <span class="ip-card" :class="{ disabled: readonly }" @click="!readonly && triggerUpload()">
          ⬆️ 上传图标
        </span>
        <el-tooltip v-if="!aiAvailable" content="当前环境未配置生图模型" placement="top">
          <span class="ip-card disabled">✨ AI 生成（未配置）</span>
        </el-tooltip>
        <span v-else class="ip-card" :class="{ disabled: readonly }" @click="!readonly && genAiIcon()">
          ✨ AI 生成<span v-if="aiBusy"> 中…</span>
        </span>
      </div>
      <div class="ip-hint">上传支持 PNG / JPG / WebP / GIF / SVG，不超过 5 MB</div>
    </div>
  </el-popover>

  <input ref="fileInput" type="file" :accept="ICON_ACCEPT" hidden @change="onFileChange" />

  <!-- 图标库弹窗（PRD：点击【从图标库选择】打开图标库弹窗，选中即时更新预览） -->
  <el-dialog v-model="libOpen" title="从图标库选择" width="400px" append-to-body class="ip-lib-dialog">
    <div v-if="iconLibLoading" class="ip-hint">图标库加载中…</div>
    <div v-else-if="iconLib.length" class="ip-grid">
      <button
        v-for="ic in iconLib"
        :key="ic.id || ic.url"
        type="button"
        class="ip-cell"
        :class="{ on: (ic.url || ic.id) === icon }"
        :title="ic.name || ''"
        @click="pickLibIcon(ic)"
      >
        <img v-if="isUrl(ic.url)" :src="ic.url" alt="" />
        <span v-else>{{ ic.url || ic.id }}</span>
      </button>
    </div>
    <div v-else class="ip-hint">图标库暂无内容</div>
  </el-dialog>

  <!-- 方形裁剪弹窗（PRD：拖动图片调整保留区域 + 缩放滑杆，输出 256×256 PNG） -->
  <el-dialog
    v-model="cropOpen"
    title="裁剪图标"
    width="360px"
    append-to-body
    :close-on-click-modal="false"
    class="ip-crop-dialog"
  >
    <div class="ip-crop-viewport" :style="{ width: VIEWPORT + 'px', height: VIEWPORT + 'px' }" @pointerdown.prevent="onDragStart">
      <img v-if="cropImgUrl" :src="cropImgUrl" :style="imgStyle" class="ip-crop-img" alt="" draggable="false" />
      <div class="ip-crop-frame"></div>
    </div>
    <div class="ip-crop-zoom">
      <span class="ip-crop-zoom-label">缩放</span>
      <el-slider v-model="zoom" :min="100" :max="300" :show-tooltip="false" />
    </div>
    <div class="ip-hint">拖动图片调整保留区域，将生成 256×256 图标</div>
    <template #footer>
      <el-button size="small" @click="triggerUpload">重新选择图片</el-button>
      <el-button size="small" @click="cancelCrop">取消</el-button>
      <el-button size="small" type="primary" class="ip-crop-confirm" @click="confirmCrop">使用该区域</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ip-avatar {
  position: relative;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  cursor: pointer;
  overflow: hidden;
}
.ip-avatar.is-readonly {
  cursor: not-allowed;
  opacity: 0.6;
}
.ip-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ip-avatar:hover .ip-avatar-edit {
  opacity: 1;
}
.ip-avatar-edit {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-md);
  background: var(--mask);
  color: #ffffff; /* 近黑遮罩上的 hover 提示文字，固定白字保证两主题可见 */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  opacity: 0;
  transition: opacity var(--dur-fast);
}
.ip-pop {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ip-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.ip-card {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--fs-xs);
  color: var(--c-text);
}
.ip-card:hover {
  background: var(--bg-hover);
}
.ip-card.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ip-card.disabled:hover {
  background: transparent;
}
.ip-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  padding: var(--space-1) 0;
}
.ip-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--space-1);
  max-height: 260px;
  overflow: auto;
}
.ip-cell {
  height: 42px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  overflow: hidden;
  padding: 0;
}
.ip-cell:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.ip-cell.on {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}
.ip-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 裁剪弹窗 */
.ip-crop-viewport {
  position: relative;
  margin: 0 auto;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.ip-crop-viewport:active {
  cursor: grabbing;
}
.ip-crop-img {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  pointer-events: none;
}
.ip-crop-frame {
  position: absolute;
  inset: 0;
  border: 1px dashed var(--c-accent);
  border-radius: var(--radius-md);
  pointer-events: none;
}
.ip-crop-zoom {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding: 0 2px;
}
.ip-crop-zoom-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  flex-shrink: 0;
}
.ip-crop-zoom :deep(.el-slider) {
  flex: 1;
}
</style>
