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

  size: { type: String, default: '720px' },
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
/* 段与段的统一间距（三级间距节奏的最外层，见 §抽屉规范） */
.de-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
</style>
