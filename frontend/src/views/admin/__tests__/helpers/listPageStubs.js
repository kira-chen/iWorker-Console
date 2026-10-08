/**
 * 列表页单测共用的 Element Plus 原生控件桩 + 探针（2026-10-08 /test-audit T17 抽出）。
 *
 * 原先 adminFeedback / adminLoginLogs / myApplications / unifiedReview / userSkillReviews
 * 五个文件各自逐字复制了同一份 elInput / elSelect / elOption / pick / rowEls / toolbarBtn
 * （rowEls 另含 adminExperts）。只收「逐字相同」的定义——同名但有差异的桩仍留在各自文件里。
 *
 * 配套：el-table / el-table-column 用 ./elTableStub.js 的 makeElTableStubs({ renderHeader: true })。
 */

/** el-input 桩：v-model + keyup 透出（页面的 @keyup.enter 查询靠它）。 */
export const elInput = {
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue', 'keyup', 'clear'],
  template: '<input class="el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keyup="$emit(\'keyup\', $event)" />'
}

/** el-select 桩：不渲染下拉，选值经自定义事件 `pick` 注入（见下方 pick()），同时发 update:modelValue 与 change。 */
export const elSelect = {
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue', 'change'],
  template:
    '<div class="el-select" :data-placeholder="placeholder" @pick="$emit(\'update:modelValue\', $event.detail); $emit(\'change\', $event.detail)"><slot /></div>'
}

/** 在 elSelect 桩上模拟「选中 value」。 */
export const pick = (selectEl, value) => selectEl.dispatchEvent(new CustomEvent('pick', { detail: value }))

/** el-option 桩：只渲染文案 + data-value，供断言选项集。 */
export const elOption = { props: ['label', 'value'], template: '<div class="el-option" :data-value="value">{{ label }}</div>' }

/**
 * el-button 桩（带 data-type / data-link；myApplications / unifiedReview / userSkillReviews 三份逐字相同）。
 * 注：adminFeedback / adminLoginLogs 的同名桩没有 data-link，未合并，仍各自本地定义。
 */
export const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String, link: Boolean },
  emits: ['click'],
  template:
    '<button class="el-button" :disabled="disabled" :data-type="type" :data-link="link" @click="!disabled && $emit(\'click\')"><slot /></button>'
}

/**
 * 列表页探针：rowEls() 取 el-table 桩渲染的数据行，toolbarBtn(text) 按文字取工具栏按钮。
 * 各文件的挂载容器是模块级 `let container`（每条用例重建），故传取值函数而非容器本身：
 *   const { rowEls, toolbarBtn } = makeListProbes(() => container)
 */
export function makeListProbes(getContainer) {
  const rowEls = () => [...getContainer().querySelectorAll('.el-row')]
  const toolbarBtn = (text) => [...getContainer().querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.trim() === text)
  return { rowEls, toolbarBtn }
}
