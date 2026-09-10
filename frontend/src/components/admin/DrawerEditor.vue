<script setup>
/**
 * 抽屉编辑器外壳（管理后台统一范式，2026-08-23）。
 *
 * 【定位：收壳与四态，放内容】——对标列表页的 {@link ListStates}。抽屉之间真正不同的是
 * **表单字段**（每个实体都不一样，不该被组件框死），相同的是**外壳与状态编排**：
 * 抽屉尺寸/方向/禁点遮罩关闭、标题的「查看 / 编辑 / 新建」三态、加载骨架、失败重试、
 * 底部「取消·保存」动作条。故本组件只接管后者，字段照旧由各编辑器写在默认插槽里。
 *
 * 【为什么要抽】改造前 5 个编辑器（MCP / API / 业务系统 / 服务提供系统 / 专家）各写各的，
 * 实测重复：抽屉外壳参数 5 处完全一致、标题三元 5 处同构、「骨架 + 加载失败 + 重试」模板
 * 4 处逐字相同（仅 class 前缀 md-/ad-/ps-/ee- 不同）、footer 5 处同构。与
 * `docs/frontend/规范-管理后台列表页.md` §0 记录的列表页问题同源：**散落实现导致正确做法无法传播**
 * ——任一处修好的体验问题，其余几处仍然坏着。
 *
 * 【差异如何吸收】各编辑器的真实差异已全部收敛为入参/插槽，未做"就近统一"以免吃掉行为：
 *   - 提交按钮文案不同（登记 / 新建 / 创建 / 保存）→ submitText / createText
 *   - 服务提供系统无只读态 → readonly 默认 false，不传即无查看态
 *   - 专家在审核期锁定时隐藏保存、且取消按钮禁用 → submit-hidden / cancel-disabled
 *   - 骨架行数 8 与 4 → skeletonRows
 *   - 专家标题行带发布态标签 → #title-extra 插槽
 *
 * 【外壳尺寸 · 2026-09-08 原型复刻批次 1（A9 / S1 / G-2）】照原型 Taste 层 L42–48：
 *   `.drawer{width:min(780px,88vw);background:#f5f7f6}`（模型抽屉 L110 820px，由 ModelConfigEditDialog 传 size）
 *   `.drawer-head{height:66px;padding:0 28px}` `.drawer-body{padding:22px 28px 34px}` `.drawer-foot{height:66px;padding:0 28px}`
 * 正文灰底 + 各分区白卡：卡由各编辑器给 <section class="section-card"> 承担（样式在 assets/admin-shell.css），
 * 本组件只给壳。样式写在下方非 scoped 块（el-drawer teleport 到 body，scoped 命不中）；
 * 以 .de-drawer 类限定，VersionDrawer（720 白底）等不走本组件的抽屉不受影响。
 */
import { computed } from 'vue'

const props = defineProps({
  /** 抽屉可见性（v-model:visible）。 */
  visible: { type: Boolean, default: false },
  /** 实体名，用于拼默认标题：查看/编辑/新建 + entity（如「专家」→「编辑专家」）。 */
  entity: { type: String, default: '' },
  /** 编辑态：有 id 即编辑，否则新建。仅用于标题与提交按钮文案。 */
  isEdit: { type: Boolean, default: false },
  /** 只读查看（审核中等场景）：标题转「查看」，底部只留「关闭」。 */
  readonly: { type: Boolean, default: false },
  /** 完全自定义标题（传了则忽略 entity/isEdit/readonly 的拼装）。 */
  title: { type: String, default: '' },

  /* ---- 四态 ---- */
  loading: { type: Boolean, default: false },
  /** 失败信息：真值即渲染失败态（字符串则作为描述，true 则用兜底文案）。 */
  error: { type: [String, Boolean], default: '' },
  skeletonRows: { type: Number, default: 8 },

  /* ---- 底部动作条 ---- */
  saving: { type: Boolean, default: false },
  /** 编辑态提交文案（默认「保存」）。 */
  submitText: { type: String, default: '保存' },
  /** 新建态提交文案（默认「新建」；MCP/API/业务系统用「登记」，专家用「创建」）。 */
  createText: { type: String, default: '新建' },
  /** 隐藏提交按钮（如专家审核期锁定：可看不可改，但仍要能关）。 */
  submitHidden: { type: Boolean, default: false },
  submitDisabled: { type: Boolean, default: false },
  /** 取消按钮禁用（保存在途时防误关丢草稿）。 */
  cancelDisabled: { type: Boolean, default: false },

  /** 抽屉宽（默认 780px = 原型基座；模型抽屉传 820px；版本侧栏传 720px） */
  size: { type: String, default: '780px' },
  /** 白底平铺正文（不用灰底 + 白卡壳）：版本侧栏照原型 .skill-version-drawer 白底，传 true */
  plainBody: { type: Boolean, default: false },
  /** 挂到 body 下（抽屉嵌在 tab-pane / 局部容器里时必须开，否则被祖先的 overflow 裁切）。 */
  appendToBody: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'retry', 'save'])

const headerText = computed(() => {
  if (props.title) return props.title
  const verb = props.readonly ? '查看' : props.isEdit ? '编辑' : '新建'
  return `${verb}${props.entity}`
})

const submitLabel = computed(() => (props.isEdit ? props.submitText : props.createText))
const errorText = computed(() =>
  typeof props.error === 'string' && props.error ? props.error : '加载失败'
)

function close() {
  emit('update:visible', false)
}
</script>

<template>
  <el-drawer
    :model-value="visible"
    :size="size"
    direction="rtl"
    :class="['de-drawer', { 'de-drawer--plain': plainBody }]"
    :append-to-body="appendToBody"
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', $event)"
  >
    <template #header>
      <div class="de-head">
        <span class="de-head-title">{{ headerText }}</span>
        <!-- 标题行附加内容（如发布态标签）：与标题同行，不另起一段 -->
        <slot name="title-extra" />
      </div>
    </template>

    <div v-if="loading" class="de-state">
      <el-skeleton :rows="skeletonRows" animated />
    </div>
    <div v-else-if="error" class="de-state">
      <el-empty :description="errorText">
        <el-button type="primary" @click="emit('retry')">重试</el-button>
      </el-empty>
    </div>
    <div v-else class="de-body">
      <slot />
    </div>

    <template #footer>
      <!-- footer 整体可替换（少数抽屉底部另有形态）；默认即「取消 · 保存」两键 -->
      <slot name="footer">
        <el-button :disabled="cancelDisabled" @click="close">
          {{ readonly ? '关闭' : '取消' }}
        </el-button>
        <el-button
          v-if="!readonly && !submitHidden"
          type="primary"
          :loading="saving"
          :disabled="submitDisabled"
          @click="emit('save')"
        >{{ submitLabel }}</el-button>
      </slot>
    </template>

    <!-- 抽屉内附挂的弹窗等（选择器、二次确认），置于 drawer 子树内以便 append-to-body 压在其上 -->
    <slot name="extra" />
  </el-drawer>
</template>

<style scoped>
.de-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.de-head-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.de-state {
  padding: var(--space-5);
}
/* 段与段的统一间距（三级间距节奏的最外层，见 §抽屉规范）。
 * 分区改用 .section-card 后卡自带 margin-bottom 20，与 gap 叠加会变 40，非 scoped 块里把卡的 margin 清零。 */
.de-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
</style>

<!-- 抽屉外壳（非 scoped：el-drawer 面板 teleport 到 body）。原型 L42–48 数值，颜色走 --*-admin-* 令牌。 -->
<style>
.el-drawer.de-drawer {
  --el-drawer-padding-primary: 0;
  background: var(--bg-admin-drawer);
}
.el-drawer.de-drawer .el-drawer__header {
  height: 66px;
  flex: 0 0 66px;
  margin: 0;
  padding: 0 28px;
  background: var(--bg-surface);
  /* 2026-09-10 像素账本 G3 附带（描边铺开）：头/脚是白条压在抽屉灰底(--bg-admin-drawer)上，
     半透明 --border-base 会随「白条一侧 vs 灰底一侧」合成出两种深浅；原型是不透明
     rgb(223,229,225)。改走 --border-admin-card（浅色 #dde4e0，暗色映射 --border-base）。 */
  border-bottom: 1px solid var(--border-admin-card);
}
.el-drawer.de-drawer .el-drawer__title {
  line-height: 1.3;
}
.el-drawer.de-drawer .el-drawer__body {
  padding: 22px 28px 34px;
  background: var(--bg-admin-drawer);
}
.el-drawer.de-drawer .el-drawer__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  height: 66px;
  flex: 0 0 66px;
  padding: 0 28px;
  background: var(--bg-surface);
  /* 同上（G3 附带）：底栏白条压灰底，描边取不透明卡描边令牌 */
  border-top: 1px solid var(--border-admin-card);
}
.el-drawer.de-drawer .el-drawer__footer .el-button + .el-button {
  margin-left: 0;
}
.el-drawer.de-drawer .de-head-title {
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.015em;
}
/* 插槽内的分区卡（各编辑器的 <section class="section-card">）：间距由 .de-body 的 gap 给，卡自带 margin 清零 */
.el-drawer.de-drawer .de-body > .section-card {
  margin-bottom: 0;
}
/* 白底平铺变体（版本侧栏：原型 L399 `.skill-version-drawer{width:min(720px,82vw)}` 白底） */
.el-drawer.de-drawer.de-drawer--plain,
.el-drawer.de-drawer.de-drawer--plain .el-drawer__body {
  background: var(--bg-surface);
}
</style>
