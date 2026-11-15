<script setup>
/**
 * 04运行 › 配额与限流（PRD：docs/PRD/数字员工管理端PRD/04运行/配额与限流/prd.配额与限流.md）。
 *
 * 平台统一的运行参数，对全部员工生效、不按岗位或员工单独设置。本期只有一项：
 * 「IM 消息处理 · 消息合并等待时长」——员工在飞书 / 钉钉 / 微信里连着发的几条消息，
 * 从最后一条算起等这么久，期间发来的合成一件事处理（员工端《PRD-IM对接》§4.2 第 5 条）。
 *
 * 交互要点：
 *  - 校验只在点【保存】时触发，不自动取整、不自动拉回范围（PRD §三.1）；
 *  - 输入值与已保存值数值相同时【保存】置灰；
 *  - 读取失败时不出输入框，只给重试——不知道当前值就不让覆盖（PRD §三.4）；
 *  - 保存后值有变化时由 mock 写访问审计「修改配置」（PRD 访问审计 §6.2.1 第 21 条）。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { getQuotaThrottleSettings, saveMergeWait } from '@/api/quotaThrottle'
import { MERGE_WAIT_LABEL, mergeWaitInputError } from '@/utils/quotaThrottle'

const loading = ref(true)
const loadError = ref('')
const saving = ref(false)

/** 当前已保存的值（秒） */
const savedSec = ref(null)
/** 输入框里的原始文本：保留管理员填的样子，校验时再判断 */
const input = ref('')
const fieldError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await getQuotaThrottleSettings()
    savedSec.value = data.mergeWaitSec
    input.value = String(data.mergeWaitSec)
    fieldError.value = ''
  } catch (e) {
    loadError.value = e?.message || '配置读取失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 与已保存值数值相同（含「05」这类写法）时视为没改，【保存】置灰 */
const unchanged = computed(() => {
  const text = String(input.value ?? '').trim()
  return text !== '' && /^\d+$/.test(text) && Number(text) === savedSec.value
})

function onInput() {
  // 改了就先收起旧的错误提示，等下次点保存再校验
  fieldError.value = ''
}

async function save() {
  const message = mergeWaitInputError(input.value)
  if (message) {
    fieldError.value = message
    return
  }
  saving.value = true
  try {
    const data = await saveMergeWait(Number(String(input.value).trim()))
    savedSec.value = data.mergeWaitSec
    input.value = String(data.mergeWaitSec)
    ElMessage.success('已保存，对全部员工的 IM 机器人生效')
  } catch (e) {
    // 校验类错误就地提示在输入框下方；其余失败用 toast，输入值保留，可再次保存
    if (e?.field === 'mergeWaitSec') fieldError.value = e.message
    else ElMessage.error(e?.message || '保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="qt-page">
    <PageHeader title="配额与限流" subtitle="平台统一的运行参数，保存后对全部员工生效" />

    <section class="qt-card" v-loading="loading">
      <header class="qt-card-head">IM 消息处理</header>

      <el-empty v-if="loadError" :image-size="96" description="配置读取失败">
        <p class="qt-error-reason">{{ loadError }}</p>
        <el-button @click="load">重试</el-button>
      </el-empty>

      <div v-else-if="!loading" class="qt-card-body">
        <div class="qt-field">
          <label class="qt-label" for="qt-merge-wait"><span class="qt-required">*</span>{{ MERGE_WAIT_LABEL }}</label>
          <div class="qt-control">
            <el-input
              id="qt-merge-wait"
              v-model="input"
              class="qt-input"
              :class="{ 'is-error': fieldError }"
              data-testid="merge-wait-input"
              @input="onInput"
              @keyup.enter="!unchanged && save()"
            >
              <template #suffix>秒</template>
            </el-input>
            <p v-if="fieldError" class="qt-error" data-testid="merge-wait-error">{{ fieldError }}</p>
            <p class="qt-hint">
              员工在 IM 里连着发的几条消息，从最后一条算起等这么久，期间发来的合成一件事处理。时长越长，员工收到「收到」越晚。
            </p>
          </div>
        </div>

        <footer class="qt-card-foot">
          <el-button type="primary" :loading="saving" :disabled="unchanged" data-testid="merge-wait-save" @click="save">
            保存
          </el-button>
        </footer>
      </div>
    </section>
  </div>
</template>

<style scoped>
.qt-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.qt-card {
  max-width: 720px;
  min-height: 120px;
  background: var(--bg-surface);
  border: 1px solid var(--border-admin-card);
  border-radius: var(--radius-md);
}
.qt-card-head {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-admin-card-head);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.qt-card-body {
  padding: var(--space-4);
}
.qt-field {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}
.qt-label {
  flex: 0 0 140px;
  line-height: 32px;
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.qt-required {
  margin-right: 2px;
  color: var(--c-danger);
}
.qt-control {
  flex: 1;
  min-width: 0;
}
.qt-input {
  width: 160px;
}
.qt-input.is-error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.qt-error {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.qt-hint {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  line-height: 1.6;
  color: var(--c-text-muted);
}
.qt-card-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-4);
}
.qt-error-reason {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
@media (max-width: 640px) {
  .qt-field {
    flex-direction: column;
    gap: var(--space-1);
  }
  .qt-label {
    flex: none;
    line-height: 1.5;
  }
}
</style>
