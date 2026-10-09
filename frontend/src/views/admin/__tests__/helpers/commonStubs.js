/**
 * 跨模块单测共用的 Element Plus 通用桩（2026-10-08 /test-audit T18–T20 抽出）。
 *
 * 只收「逐字相同」的定义；同名但 props / emits / 模板 / class 有任何差异的桩仍留在各自文件里。
 */

/**
 * 透传桩：渲染 `<div class="{tag}">` 包默认插槽。
 * 原 `(tag) => …`（12 个文件）与 `(t) => …`（6 个文件）两种写法仅形参名不同，行为一致，合并于此。
 */
export const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })

/** el-empty 桩：渲染 description + 默认插槽。 */
export const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }

/**
 * el-drawer 桩（riskSettingsDrawer / userSkillAuditDrawer 两份逐字相同）：
 * modelValue 为真才渲染；header / 默认 / footer 三个插槽分别落在 .dr-header / .dr-body / .dr-footer。
 * 注：drawerEditor.test.js 的同名桩多声明了 closeOnClickModal，未合并。
 */
export const elDrawer = {
  name: 'el-drawer',
  props: ['modelValue', 'size'],
  emits: ['update:modelValue'],
  template:
    '<div class="el-drawer" v-if="modelValue" :data-size="size">' +
    '<div class="dr-header"><slot name="header" /></div>' +
    '<div class="dr-body"><slot /></div>' +
    '<div class="dr-footer"><slot name="footer" /></div></div>'
}

/**
 * 岗位详情页签桩（positionAgentTab4C / positionCompletenessG1 / positionDetailTabs 三份逐字相同）：
 * 全部 pane 同时渲染，激活项与各 pane 的 label / name 落在 data-* 上供断言。
 */
export const elTabs = { name: 'el-tabs', props: ['modelValue'], template: '<div class="el-tabs" :data-active="modelValue"><slot /></div>' }
export const elTabPane = { name: 'el-tab-pane', props: ['label', 'name'], template: '<div class="el-tab-pane" :data-label="label" :data-name="name"><slot /></div>' }
