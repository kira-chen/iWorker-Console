<script setup>
/**
 * 版本管理抽屉（技能 / 专家 / 岗位统一，2026-08-23）。
 *
 * 【为什么合三为一】改造前技能(504行) / 专家(489行) / 岗位(461行) 三个版本弹窗**逐行同构**——
 * BUMP_OPTIONS、previewLabel、submitPublish、withdraw、onDelist/onRelist、VersionHistoryList
 * 各写了一遍，只有 API 与实体字段名不同。后果与 `docs/frontend/规范-管理后台列表页.md` §0 记录的
 * 列表页问题同源：**正确做法无法传播**——「打开先闪一块灰骨架」的延迟阀门此前只在专家侧修了，
 * 技能与岗位仍坏着。合并后这类修复一次到位。
 *
 * 【定位】外壳复用 {@link DrawerEditor}（与全站 9 个抽屉同范式），本组件只负责版本域的两区：
 *   ① 发布新版本：按发布态自适应——可提交（首发固定 v1.0.0 / 非首发选更新类型即定 vX.Y.Z + 升级说明必填）
 *      / 审核中（提示 + 撤回，二次确认）。
 *   ② 版本历史：已发布版本列表，每行禁用/启用（复用 VersionHistoryList）。
 *
 * 【差异如何吸收】三者的真实差异全部收敛为 `adapter` 入参，**未做「就近统一」以免吃掉行为**：
 *   - 发布态来源不同：技能取 publications[]，专家/岗位取本体 status+pendingAction → adapter.deriveView()
 *   - **下线/启用签名三者都不同**：技能 (id, version, 'USER_END')、专家 (id, pub.id)、岗位 (id, version)
 *     → adapter.delist(row) / relist(row) 由各自原样封装，本组件只管调用，绝不自行拼参
 *   - 技能有通道切换（system/market 两套 API）与「技能分类必填」前置门 → adapter.api / adapter.submitGate
 *   - 岗位版本行带 `pin N 技能` 附加信息 → adapter.mapRow() 自行加工，applyUpdated 保留 extra
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import VersionHistoryList from '@/components/admin/VersionHistoryList.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /**
   * 实体适配器（三处各自提供，见文件头「差异如何吸收」）：
   * {
   *   entityLabel: '技能'|'专家'|'岗位',      // 用于标题与二次确认文案
   *   entityKey:   '技能名称'|'专家'|'岗位',  // 顶部信息行的前缀
   *   name, id,                              // 当前实体名与 id（id 为 null 时不发请求）
   *   deriveView(): { label, tagType, actions },   // 发布态展示视图
   *   nextVersionLabel(id): Promise<string>,
   *   publish(id, { bump, releaseNotes }): Promise<any>,
   *   withdraw(id): Promise<any>,
   *   listVersions(id): Promise<any[]>,
   *   mapRow(raw): row,                       // → VersionHistoryList 行（须含 version/verLabel/status）
   *   delist(row): Promise<any>, relist(row): Promise<any>,
   *   submitGate?: () => string,              // 返回非空串=拦下提交并提示（技能分类必填）
   *   withdrawText?: (state) => string,       // 撤回二次确认文案
   *   delistTerm/relistTerm/activeLabel?      // 版本历史动作用词
   *
   *   // —— 2026-09-01 岗位 PRD 对齐新增可配置项（全部可缺省，缺省=原有行为，技能/专家不受影响）——
   *   title?: string,                          // 抽屉标题（岗位传「版本管理」；默认「版本发布」）
   *   bumpOptions?: [{value,label,hint}],      // 更新类型词与 hint（岗位传 修订版本/功能更新/重大更新）
   *   historySubtitle?: string,                // 版本历史区副标题（缺省用「整包快照 + 下线口径」旧文案）
   *   delistConfirmText?: (row, ver) => string,// 停用/禁用某版本的确认文案模板（岗位传「禁用「名」的 vX.Y.Z？」）
   *   relistConfirmText?: (row, ver) => string,// 启用/恢复某版本的确认文案模板
   *   guardLastActive?: boolean,               // 最后一个启用版本禁用置灰开关（透传 VersionHistoryList）
   *   lastActiveTip?: string,                  // 置灰按钮 title 提示文案
   *   exclusiveActive?: boolean                // 启用某版本自动禁用其他（互斥）→ 启用成功后整表重拉
   * }
   */
  adapter: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'done'])

const a = computed(() => props.adapter || {})
const entityId = computed(() => a.value.id ?? null)
const entityLabel = computed(() => a.value.entityLabel || '对象')

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

/* ==================== 发布态 ==================== */
const view = computed(() => a.value.deriveView?.() || { label: '', tagType: 'info', actions: [] })
const canSubmit = computed(() => (view.value.actions || []).includes('submit'))
const canWithdraw = computed(() => (view.value.actions || []).includes('withdraw'))

const busy = ref(false)

/* ==================== ① 发布新版本 ==================== */
// 更新类型默认词表（技能/专家现状）；实体可经 adapter.bumpOptions 覆写（岗位：修订版本/功能更新/重大更新）
const DEFAULT_BUMP_OPTIONS = [
  { value: 'NONE', label: '修订更新', hint: '修复问题或小幅调整' },
  { value: 'MINOR', label: '功能更新', hint: '新增功能或能力' },
  { value: 'MAJOR', label: '重大更新', hint: '重大改动或不兼容变更' }
]
const bumpOptions = computed(() =>
  Array.isArray(a.value.bumpOptions) && a.value.bumpOptions.length ? a.value.bumpOptions : DEFAULT_BUMP_OPTIONS
)
const suggestedSegs = ref([1, 0, 0])
// 首发判定 = 发布态 INITIAL（真·首发信号）。不靠 next-label 字符串比 v1.0.0——
// 该法在 next-label 请求失败时会把已发布对象误判成首发、锁死 v1.0.0。
const isFirstPublish = computed(() => view.value.state === 'INITIAL')
const bump = ref('NONE')
const releaseNotes = ref('')
const nextLoading = ref(false)

function parseVersion(label) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(label || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

async function loadNextVersion() {
  if (entityId.value == null || !canSubmit.value) return
  nextLoading.value = true
  bump.value = 'NONE'
  releaseNotes.value = ''
  try {
    suggestedSegs.value = parseVersion(await a.value.nextVersionLabel(entityId.value)) || [1, 0, 0]
  } catch {
    // 拉取失败不伪装首发（isFirstPublish 由发布态决定）：回落到「最新历史版本 patch+1」作 NONE 建议。
    // 注：合并前技能侧此处回落到最新版本**原值**（未 +1），会建议一个与现存版本号相同的号；
    // 专家/岗位为 patch+1。此处统一取 patch+1（后者正确——建议的是「下一个」版本号）。
    const latest = parseVersion(rows.value?.[0]?.verLabel || rows.value?.[0]?.versionLabel)
    suggestedSegs.value = latest ? [latest[0], latest[1], latest[2] + 1] : [1, 0, 0]
  } finally {
    nextLoading.value = false
  }
}

function labelForBump(b) {
  const [x, y, z] = suggestedSegs.value
  if (b === 'MAJOR') return `v${x + 1}.0.0`
  if (b === 'MINOR') return `v${x}.${y + 1}.0`
  return `v${x}.${y}.${z}`
}
const previewLabel = computed(() => (isFirstPublish.value ? 'v1.0.0' : labelForBump(bump.value)))
const selectedHint = computed(() => bumpOptions.value.find((o) => o.value === bump.value)?.hint || '')
const notesErr = computed(() =>
  String(releaseNotes.value || '').trim() ? '' : '升级说明必填，简述本次更新项'
)
// 实体自定义前置门（技能：分类必填）。返回非空串即拦下并展示。
const gateErr = computed(() => a.value.submitGate?.() || '')
const submitDisabled = computed(
  () => nextLoading.value || busy.value || !!notesErr.value || !!gateErr.value
)

async function submitPublish() {
  if (gateErr.value) {
    ElMessage.warning(gateErr.value)
    return
  }
  if (notesErr.value) {
    ElMessage.warning(notesErr.value)
    return
  }
  busy.value = true
  try {
    await a.value.publish(entityId.value, {
      bump: isFirstPublish.value ? 'NONE' : bump.value,
      releaseNotes: releaseNotes.value.trim()
    })
    ElMessage.success(`已提交发布 ${previewLabel.value}，进入审核`)
    emit('done')
  } catch (e) {
    ElMessage.error(e?.message || '提交发布失败')
  } finally {
    busy.value = false
  }
}

async function withdraw() {
  const text =
    a.value.withdrawText?.(view.value.state) ||
    '撤回本次提交后将回到未发布态。确认撤回？'
  try {
    await ElMessageBox.confirm(text, '确认操作', { type: 'warning' })
  } catch {
    return
  }
  busy.value = true
  try {
    await a.value.withdraw(entityId.value)
    ElMessage.success('已撤回提交')
    emit('done')
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  } finally {
    busy.value = false
  }
}

/* ==================== ② 版本历史 ==================== */
const rows = ref([])
const loading = ref(false)
const error = ref('')
const busyVersion = ref(null)

/**
 * 延迟骨架阀门（与岗位工作台同款）：加载超 250ms 才亮骨架。
 * 修「首次点开先闪一块灰、随即消失」——打开即并发拉两个接口，首次还要拉懒加载 chunk + 冷连接，
 * 窗口足够长而肉眼可见；而草稿态对象版本历史必为空，骨架闪完只变「暂无版本」，纯噪音。
 * 此前仅专家侧修过，技能/岗位仍坏着——合并后三处一并获得。
 */
const showSkeleton = ref(false)
let skeletonTimer = null
watch(loading, (v) => {
  clearTimeout(skeletonTimer)
  if (v) skeletonTimer = setTimeout(() => (showSkeleton.value = true), 250)
  else showSkeleton.value = false
})
// 发布区变暗同理走阀门；但按钮禁用仍用裸 nextLoading，免得阈值内手快点到提交时版本号还没到位。
const showDimming = ref(false)
let dimTimer = null
watch(nextLoading, (v) => {
  clearTimeout(dimTimer)
  if (v) dimTimer = setTimeout(() => (showDimming.value = true), 250)
  else showDimming.value = false
})
onBeforeUnmount(() => {
  clearTimeout(skeletonTimer)
  clearTimeout(dimTimer)
})

async function fetchVersions() {
  if (entityId.value == null) return
  loading.value = true
  error.value = ''
  try {
    const data = await a.value.listVersions(entityId.value)
    const map = a.value.mapRow || ((r) => r)
    rows.value = (Array.isArray(data) ? data : []).map(map)
  } catch (e) {
    error.value = e?.message || '加载版本历史失败'
    rows.value = []
  } finally {
    loading.value = false
  }
}

/** 就地合并单行更新，保留 mapRow 加工出的附加字段（如岗位的 extra=pin N 技能）。 */
function applyUpdated(version, vo, fallbackStatus) {
  rows.value = rows.value.map((r) =>
    r.version === version
      ? { ...r, ...(vo && typeof vo === 'object' ? vo : {}), status: vo?.status || fallbackStatus, extra: r.extra }
      : r
  )
}

// 默认值与 VersionHistoryList 保持一致（下线/恢复/可下载），不擅自换词：
// 合并时本组件曾默认「禁用/启用」，把岗位侧的「下线/恢复」悄悄改写（实机走查发现的回归）。
// 各调用方一律显式声明用词，此处默认仅作兜底。
const delistTerm = computed(() => a.value.delistTerm || '下线')
const relistTerm = computed(() => a.value.relistTerm || '恢复')

async function onDelist(row) {
  if (busyVersion.value != null) return
  const ver = row.verLabel || row.versionLabel || 'v' + row.version
  // 确认文案可由实体覆写（岗位传「禁用「名」的 vX.Y.Z？」）；缺省沿用「无法再下载」旧口径
  const text =
    a.value.delistConfirmText?.(row, ver) ||
    `${delistTerm.value}「${a.value.name || entityLabel.value}」的 ${ver}？${delistTerm.value}后客户端将无法再下载此版本，已下载不受影响。`
  try {
    await ElMessageBox.confirm(text, `${delistTerm.value}版本`, {
      type: 'warning',
      confirmButtonText: `确认${delistTerm.value}`,
      confirmButtonClass: 'el-button--warning'
    })
  } catch {
    return
  }
  busyVersion.value = row.version
  try {
    applyUpdated(row.version, await a.value.delist(row), 'DELISTED')
    ElMessage.success(`已${delistTerm.value}`)
  } catch (e) {
    ElMessage.error(e?.message || `${delistTerm.value}失败`)
    fetchVersions()
  } finally {
    busyVersion.value = null
  }
}

async function onRelist(row) {
  if (busyVersion.value != null) return
  const ver = row.verLabel || row.versionLabel || 'v' + row.version
  const text =
    a.value.relistConfirmText?.(row, ver) ||
    `${relistTerm.value}「${a.value.name || entityLabel.value}」的 ${ver}？${relistTerm.value}后客户端可再次下载此版本。`
  try {
    await ElMessageBox.confirm(text, `${relistTerm.value}版本`, {
      type: 'warning',
      confirmButtonText: `确认${relistTerm.value}`
    })
  } catch {
    return
  }
  busyVersion.value = row.version
  try {
    const vo = await a.value.relist(row)
    if (a.value.exclusiveActive) {
      // 互斥启用（岗位：同一时间只能启用一个版本）——其余行状态由服务端/mock 翻转，整表重拉保一致
      await fetchVersions()
    } else {
      applyUpdated(row.version, vo, 'ACTIVE')
    }
    ElMessage.success(`已${relistTerm.value}`)
  } catch (e) {
    ElMessage.error(e?.message || `${relistTerm.value}失败`)
    fetchVersions()
  } finally {
    busyVersion.value = null
  }
}

/* ==================== 打开 / 关闭 ==================== */
watch(
  () => [visible.value, entityId.value],
  ([open]) => {
    if (open) {
      loadNextVersion()
      fetchVersions()
    } else {
      rows.value = []
      error.value = ''
      busyVersion.value = null
      clearTimeout(skeletonTimer)
      clearTimeout(dimTimer)
      showSkeleton.value = false
      showDimming.value = false
    }
  },
  { immediate: true }
)
</script>

<template>
  <DrawerEditor
    :visible="visible"
    :title="a.title || '版本发布'"
    @update:visible="visible = $event"
  >
    <template #title-extra>
      <StatusTag v-if="adapter" :type="view.tagType">{{ view.label }}</StatusTag>
    </template>

    <template v-if="adapter">
      <!-- 顶部：当前对象 -->
      <div class="vd-obj">
        <span class="vd-obj-key">{{ a.entityKey || entityLabel }}：</span>
        <span class="vd-obj-name">{{ a.name }}</span>
      </div>

      <!-- ① 发布新版本 -->
      <section class="vd-sec">
        <h3 class="vd-sec-head">发布新版本</h3>

        <div v-if="canSubmit" class="vd-pub" :class="{ loading: showDimming }">
          <!-- 实体前置门（技能：分类必填）：就地讲清缘由与补法，提交按钮同步禁用 -->
          <div v-if="gateErr" class="vd-gate">{{ gateErr }}</div>

          <div v-if="isFirstPublish" class="vd-row">
            <span class="vd-lbl">版本号</span>
            <span class="vd-ver">v1.0.0</span>
            <span class="vd-hint">首个版本</span>
          </div>
          <template v-else>
            <div class="vd-row">
              <span class="vd-lbl">更新类型</span>
              <el-radio-group v-model="bump" :disabled="busy || nextLoading">
                <el-radio-button v-for="o in bumpOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </el-radio-button>
              </el-radio-group>
            </div>
            <div class="vd-row">
              <span class="vd-lbl">版本号</span>
              <span class="vd-ver">{{ previewLabel }}</span>
              <span class="vd-hint">{{ selectedHint }}</span>
            </div>
          </template>

          <div class="vd-notes">
            <label class="vd-lbl">升级说明 <em>*</em></label>
            <el-input
              v-model="releaseNotes"
              type="textarea"
              :rows="3"
              maxlength="2000"
              show-word-limit
              :disabled="busy"
              placeholder="简述本次更新了什么，方便记录与追溯"
            />
            <div class="vd-tip">
              <span v-if="notesErr" class="vd-err">{{ notesErr }}</span>
            </div>
          </div>
        </div>

        <div v-else-if="canWithdraw" class="vd-pub">
          <p class="vd-hint">审核中，已锁定不可修改。可撤回本次提交后继续编辑。</p>
          <div class="vd-act">
            <el-button type="warning" plain :loading="busy" @click="withdraw">撤回提交</el-button>
          </div>
        </div>
      </section>

      <!-- ② 版本历史 -->
      <section class="vd-sec">
        <h3 class="vd-sec-head">
          版本历史
          <span class="vd-sec-sub">
            {{ a.historySubtitle || `每次审核通过生成一版整包快照；${delistTerm}仅使客户端无法再下载该版本，已下载不受影响` }}
          </span>
        </h3>
        <VersionHistoryList
          :rows="rows"
          :loading="showSkeleton"
          :error="error"
          :busy-version="busyVersion"
          :delist-term="delistTerm"
          :relist-term="relistTerm"
          :active-label="a.activeLabel || '可下载'"
          :guard-last-active="!!a.guardLastActive"
          :last-active-tip="a.lastActiveTip || ''"
          @delist="onDelist"
          @relist="onRelist"
          @retry="fetchVersions"
        />
      </section>
    </template>

    <!-- 底部：提交发布（撤回在①区内，与原弹窗一致） -->
    <template #footer>
      <el-button
        v-if="canSubmit"
        type="primary"
        :loading="busy"
        :disabled="submitDisabled"
        @click="submitPublish"
      >提交发布 {{ previewLabel }}</el-button>
      <el-button :disabled="busy || busyVersion != null" @click="visible = false">关闭</el-button>
    </template>
  </DrawerEditor>
</template>

<style scoped>
.vd-obj {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-base);
}
.vd-obj-key {
  color: var(--c-text-muted);
}
.vd-obj-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.vd-sec {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.vd-sec-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  line-height: 1.4;
}
.vd-sec-sub {
  font-weight: var(--fw-normal);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.vd-pub {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-left: var(--space-4);
}
.vd-pub.loading {
  opacity: 0.6;
}
.vd-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.vd-lbl {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  min-width: 64px;
}
.vd-lbl em {
  color: var(--c-danger);
  font-style: normal;
}
.vd-ver {
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-accent);
}
.vd-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
  margin: 0;
}
.vd-notes {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.vd-tip {
  min-height: 16px;
}
.vd-err {
  color: var(--c-danger);
  font-size: var(--fs-xs);
}
.vd-gate {
  font-size: var(--fs-sm);
  color: var(--c-warning);
  background: var(--c-warning-soft, transparent);
  border-radius: var(--radius-sm);
  line-height: 1.6;
}
.vd-act {
  display: flex;
  justify-content: flex-end;
}
</style>
