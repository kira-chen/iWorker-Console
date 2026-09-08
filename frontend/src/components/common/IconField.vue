<script setup>
/**
 * 图标行（2026-09-08 原型复刻批次 1 · S3/S4）：预览块 + 并排【从图标库选择】【上传图标】两个 plain 按钮。
 *
 * 照原型 `.icon-row.compact-icon-row` = `span.icon-preview`（36px、圆角 8、灰底、22px 字）+
 * `button.plain`【从图标库选择】+ `button.plain`【上传图标】（MCP L174 原生；API / 业务系统 L875；
 * 模型 L1328；岗位人格页 position-icon-section；统一由 L1331–1342 decorateEditor 改写）。
 * 只读态两按钮 disabled（原型 L1326 / L1336）。
 *
 * 图标库弹窗 / 上传校验 / 方形裁剪 / 单次回吐 {icon, iconSource} 全部复用 IconPickerPopover 的
 * headless 模式——本组件不重做任何链路，只换「显式形态」。「AI 生成」为 popover 独有入口，
 * 原型图标行没有，这里不放（宿主若需要可另加按钮调自己的逻辑）。
 *
 * 本批先接入岗位人格页「岗位图标」卡一处作样板；专家 / 技能 / MCP / API / 业务系统 / 模型抽屉
 * 换用归后续批次。
 *
 * 用法：
 *   <IconField :icon="form.icon" :name="form.name" :readonly="readonly" @pick="({ icon, iconSource }) => …" />
 */
import { ref, computed } from 'vue'
import IconPickerPopover from '@/components/position/IconPickerPopover.vue'
import { iconIsUrl } from '@/utils/iconDisplay'

const props = defineProps({
  /** 当前图标值：字符 / emoji / URL / dataURL */
  icon: { type: String, default: '' },
  /** 对象名（AI 生成提示词用；headless 下仅透传） */
  name: { type: String, default: '' },
  /** 只读：两按钮置灰 */
  readonly: { type: Boolean, default: false },
  /** 无图标时的占位字形（原型模型抽屉 L1415 默认 ▦；岗位 popover 默认 🧑‍💼） */
  placeholder: { type: String, default: '🧑‍💼' },
  /** 预览块边长（原型 .icon-preview 36px；宿主可按场景调 42/48） */
  size: { type: Number, default: 36 }
})
const emit = defineEmits(['pick'])

const picker = ref(null)
const isUrl = computed(() => iconIsUrl(props.icon))
const previewStyle = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))

function openLibrary() {
  if (props.readonly) return
  picker.value?.openLibrary()
}
function triggerUpload() {
  if (props.readonly) return
  picker.value?.triggerUpload()
}

defineExpose({ openLibrary, triggerUpload })
</script>

<template>
  <div class="icon-row" :class="{ 'is-readonly': readonly }">
    <span class="icon-preview" :style="previewStyle" data-testid="icon-preview">
      <img v-if="isUrl" :src="icon" alt="icon" class="icon-preview-img" />
      <span v-else>{{ icon || placeholder }}</span>
    </span>
    <el-button plain :disabled="readonly" @click="openLibrary">从图标库选择</el-button>
    <el-button plain :disabled="readonly" @click="triggerUpload">上传图标</el-button>

    <!-- 无头：只提供图标库弹窗 + 上传裁剪链路，不渲染头像触发块 -->
    <IconPickerPopover
      ref="picker"
      headless
      :icon="icon"
      :position-name="name"
      :readonly="readonly"
      @pick="emit('pick', $event)"
    />
  </div>
</template>

<style scoped>
/* 原型 L14 .icon-row{display:flex;align-items:center;gap:10px} */
.icon-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.icon-row .el-button + .el-button {
  margin-left: 0;
}
/* 原型 L14 .icon-preview{width:36px;height:36px;display:grid;place-items:center;border:1px solid #ddd;border-radius:5px→8px;background:#fafafa;font-size:22px} */
.icon-preview {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  font-size: 22px;
  line-height: 1;
  overflow: hidden;
}
.icon-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.icon-row.is-readonly .icon-preview {
  opacity: 0.8;
}
</style>
