<script setup>
/**
 * N3 技能展示分类管理页（系统配置员 SYS_CONFIG，客户端会谈 R2）。
 *
 * 分类列表（sort 升序）+ 新增/重命名/改图标 + 拖拽排序（对接 sort，PUT 宽松 DTO 只传 sort）+
 * 删除前弹「影响 N 个技能」二次确认（调 {id}/delete-impact）。每行显示该分类下「已发布到用户端」技能数。
 *
 * 与运行时「操作类/查询类」两套独立数据源，互不串扰——本页只读写展示分类。
 * 「未分类」是系统内置兜底态、不在此列表出现（后端 list 不返未分类项）；终端用户端亦不出现该字眼。
 *
 * 骨架照抄连接器/用户管理范式（conn.css 共享类 + PageHeader + 单行 toolbar）。
 */
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Rank, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import {
  listSkillCategories,
  createSkillCategory,
  updateSkillCategory,
  getCategoryDeleteImpact,
  deleteSkillCategory
} from '@/api/skillCategory'
import '@/assets/connector.css'

const loading = ref(true)
const loadError = ref(false)
const rows = ref([])

async function fetchList() {
  loading.value = true
  loadError.value = false
  try {
    const data = await listSkillCategories()
    rows.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
onMounted(fetchList)

/* ---------- 新增 / 重命名 ---------- */
const busyId = ref(null)

// 本地重名预校验（减少「关弹窗→后端报错→重开重填」往返）：
// 与现有存活分类名逐一比对（去空白、忽略大小写）；excludeId 用于重命名时排除自身。
// 仅前端预拦，后端仍是权威（并发新增等仍以后端护栏为准）。
function isDuplicateName(name, excludeId = null) {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return false
  return rows.value.some(
    (r) => r.id !== excludeId && String(r.name || '').trim().toLowerCase() === n
  )
}

async function openCreate() {
  try {
    const { value } = await ElMessageBox.prompt('给新分类起个名字（客户端市场按此展示筛选）', '新增分类', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPlaceholder: '如：客户管理 / 数据查询',
      inputValidator: (v) => {
        const t = String(v || '').trim()
        if (!t) return '分类名不能为空'
        if (isDuplicateName(t)) return '已有同名分类，请换个名字'
        return true
      }
    })
    await createSkillCategory({ name: String(value).trim() })
    ElMessage.success('已新增分类')
    fetchList()
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    // 重名等护栏错误按后端 message 就地提示
    ElMessage.error(e?.message || '新增失败')
  }
}

async function rename(row) {
  try {
    const { value } = await ElMessageBox.prompt('修改分类名', '重命名分类', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: row.name,
      inputValidator: (v) => {
        const t = String(v || '').trim()
        if (!t) return '分类名不能为空'
        // 排除自身：未改名（仅大小写/空白差异）不算重名，交由下方 name === row.name 短路返回。
        if (isDuplicateName(t, row.id)) return '已有同名分类，请换个名字'
        return true
      }
    })
    const name = String(value).trim()
    if (name === row.name) return
    await updateSkillCategory(row.id, { name })
    ElMessage.success('已重命名')
    fetchList()
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(e?.message || '重命名失败')
  }
}

/* ---------- 删除（先查影响面，再二次确认）---------- */
async function remove(row) {
  let impact = 0
  try {
    impact = (await getCategoryDeleteImpact(row.id)) ?? 0
  } catch (e) {
    // 影响面拉取失败：仍允许删，但提示未知影响数
    impact = null
  }
  const impactText =
    impact == null
      ? '删除后其下技能将变为「未分类」（不会删除技能）。'
      : impact > 0
        ? `删除后其下 ${impact} 个技能将变为「未分类」（不会删除技能）。`
        : '该分类下暂无技能。'
  try {
    await ElMessageBox.confirm(`删除分类「${row.name}」？${impactText}`, '删除分类', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  busyId.value = row.id
  try {
    const affected = await deleteSkillCategory(row.id)
    ElMessage.success(affected > 0 ? `已删除 · ${affected} 个技能已落「未分类」` : '已删除')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    busyId.value = null
  }
}

/* ---------- 拖拽排序 ---------- */
// 简易 HTML5 拖拽：拖起某行 → 落到目标行位置 → 本地重排后按新序逐行提交 sort（PUT 只传 sort，宽松 DTO）。
const dragIndex = ref(-1)
const dragOverIndex = ref(-1)
const savingSort = ref(false)

function onDragStart(idx) {
  dragIndex.value = idx
}
function onDragOver(idx, e) {
  e.preventDefault()
  dragOverIndex.value = idx
}
// 离开某行时清 is-over 高亮：仅当离开的正是当前高亮行才清（避免行内子元素间移动误清），
// 防止拖出行/拖出列表后 is-over 虚线残留。
function onDragLeave(idx) {
  if (dragOverIndex.value === idx) dragOverIndex.value = -1
}
function onDragEnd() {
  dragIndex.value = -1
  dragOverIndex.value = -1
}
async function onDrop(idx) {
  const from = dragIndex.value
  const to = idx
  dragIndex.value = -1
  dragOverIndex.value = -1
  if (from < 0 || from === to) return
  await reorderTo(from, to)
}

// 把 from 行移到 to 位置：本地乐观重排后逐行提交 sort。拖拽与「上移/下移」按钮共用此编排。
async function reorderTo(from, to) {
  if (from < 0 || to < 0 || from === to || from >= rows.value.length || to >= rows.value.length) {
    return
  }
  const next = [...rows.value]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  const prev = rows.value
  rows.value = next // 乐观本地重排
  await persistSort(next, prev)
}

// 无障碍/触摸替代：上移/下移一格（键盘/无鼠标也能调序）。达顶/达底时按钮禁用，不会越界。
async function moveUp(idx) {
  if (savingSort.value || idx <= 0) return
  await reorderTo(idx, idx - 1)
}
async function moveDown(idx) {
  if (savingSort.value || idx >= rows.value.length - 1) return
  await reorderTo(idx, idx + 1)
}

// 按新顺序逐行把 sort 更新为其索引（只传 sort）。
// 部分失败语义修正：逐行提交，记已落库行数；若中途失败 → 提示「部分已保存」而非笼统「失败」
// （现状整体回滚+重拉，但部分已落库，用户看到「失败」语义含糊）。全成功「排序已保存」，
// 首行即失败（零落库）才算纯失败。无论哪种都重拉对齐后端真实顺序。
async function persistSort(ordered, prevOrder) {
  savingSort.value = true
  let savedCount = 0
  let failed = false
  let failErr = null
  try {
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].sort !== i) {
        try {
          await updateSkillCategory(ordered[i].id, { sort: i })
          ordered[i].sort = i
          savedCount++
        } catch (e) {
          failed = true
          failErr = e
          break
        }
      }
    }
  } finally {
    if (!failed) {
      ElMessage.success('排序已保存')
    } else if (savedCount > 0) {
      // 部分已落库：不回滚本地（避免与已落库的后端态背离），提示部分成功并重拉对齐真实顺序。
      ElMessage.warning('部分已保存，剩余未保存已重新加载')
      fetchList()
    } else {
      // 零落库（首个提交即失败）：回滚本地顺序 + 重拉，语义即「排序未保存」。
      rows.value = prevOrder
      ElMessage.error(failErr?.message || '排序保存失败')
      fetchList()
    }
    savingSort.value = false
  }
}
</script>

<template>
  <div class="conn-page">
    <PageHeader
      title="技能分类"
      subtitle="维护客户端市场的技能分类 · 拖拽调整展示先后 · 删除后其下技能自动落「未分类」"
    />

    <div class="conn-toolbar">
      <div class="sc-hint">共 {{ rows.length }} 个分类 · 每行数字为该分类下「已发布到用户端」的技能数</div>
      <div class="conn-tb-right">
        <el-button type="primary" class="conn-create-btn" @click="openCreate">
          <el-icon><Plus /></el-icon> 新增分类
        </el-button>
      </div>
    </div>

    <div v-loading="loading || savingSort" class="conn-list">
      <el-empty v-if="!loading && loadError" :image-size="96" description="加载失败">
        <el-button @click="fetchList">重试</el-button>
      </el-empty>
      <el-empty
        v-else-if="!loading && !rows.length"
        :image-size="96"
        description="还没有分类 · 点「新增分类」创建第一个"
      />
      <div v-else class="sc-list">
        <!-- 拖拽只落在把手上（draggable 收到 .sc-drag）：整行不再可拖，选中行内文字不会误触拖拽。
             行仍是拖放目标（dragover/drop/dragleave 留在行上），拖起来源由把手发起。 -->
        <div
          v-for="(row, idx) in rows"
          :key="row.id"
          class="sc-row"
          :class="{ 'is-over': dragOverIndex === idx, 'is-dragging': dragIndex === idx }"
          @dragover="onDragOver(idx, $event)"
          @dragleave="onDragLeave(idx)"
          @drop="onDrop(idx)"
          @dragend="onDragEnd"
        >
          <span
            class="sc-drag"
            title="拖拽调整顺序"
            draggable="true"
            @dragstart="onDragStart(idx)"
            @dragend="onDragEnd"
          ><el-icon><Rank /></el-icon></span>
          <span v-if="row.icon" class="sc-icon">{{ row.icon }}</span>
          <span class="sc-name">{{ row.name }}</span>
          <span class="sc-count" :title="`该分类下已发布到用户端的技能数`">{{ row.count ?? 0 }} 技能</span>
          <span class="sc-sp"></span>
          <!-- 无障碍/触摸排序替代：上移/下移一格（键盘/无鼠标可用）；达顶/达底禁用。拖拽仍保留。 -->
          <el-button
            link
            class="sc-move"
            title="上移一格"
            aria-label="上移一格"
            :disabled="idx === 0 || savingSort"
            @click="moveUp(idx)"
          >
            <el-icon><ArrowUp /></el-icon>
          </el-button>
          <el-button
            link
            class="sc-move"
            title="下移一格"
            aria-label="下移一格"
            :disabled="idx === rows.length - 1 || savingSort"
            @click="moveDown(idx)"
          >
            <el-icon><ArrowDown /></el-icon>
          </el-button>
          <el-button link type="primary" @click="rename(row)">重命名</el-button>
          <el-button link type="danger" :loading="busyId === row.id" @click="remove(row)">
            删除
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sc-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.sc-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.sc-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  transition: border-color var(--dur-fast), opacity var(--dur-fast);
}
.sc-row.is-over {
  border-color: var(--c-accent);
  border-style: dashed;
}
.sc-row.is-dragging {
  opacity: 0.5;
}
.sc-drag {
  cursor: grab;
  color: var(--c-text-faint);
  display: inline-flex;
}
.sc-icon {
  font-size: var(--fs-lg);
}
.sc-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  font-size: var(--fs-sm);
}
.sc-count {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-surface);
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
}
.sc-sp {
  flex: 1;
}
/* 上移/下移按钮：弱色，与拖拽把手同源；禁用态由 el-button 自处理 */
.sc-move {
  color: var(--c-text-faint);
  padding: 0 var(--space-1);
}
</style>
