<script setup>
/**
 * 角色编辑器（ADMIN 专属；2026-09-01 PRD 对齐重构，基准=prd md + 交互原型 v2 openRoleEditor L314）。
 *
 * 【表单只剩两项】角色名称 + 页面权限勾选。角色编码（code）不出现在界面上——
 * 它只是系统内标识，「系统标识自动生成」（hint 文案照原型）。
 *
 * 【权限区形态（本轮弃 el-tree，按原型 permission-tree 结构重构）】
 *  - 用户端：整组一个勾选（不展开子页面）——勾中即整支页面全开；
 *  - 管理端：范围卡片，组头显已选计数「N/M」；01–06 各分组带分组复选 + 页面复选（约三列排布）；
 *  - 权限区底部实时「已选择 N 个页面」；勾选为 0 提交时就地提示「请至少开通 1 个页面」不提交；
 *  - 编辑态底部提示「该角色当前绑定 N 个用户。权限调整保存后将对这些用户生效。」
 *
 * 【两种打开态】
 *  - 新建（标题「新建角色」）：填名称 + 勾权限 → createRole，toast「角色已创建」；
 *  - 编辑（标题「编辑角色与权限」）：改名 → updateRole；改权限 → setRolePermissions（全量替换），
 *    两者按需分别下发（只改哪个调哪个，都没改则不发写请求），toast「角色与权限已保存」。
 *
 * 【权限树形态】props.permissionTree = [{ scope, groups:[{ name, pages:[页面名] }] }]
 * （原型 permissionGroups 形态，来自 adminUserMock.getPermissionTree）；权限项=页面名。
 */
import { ref, reactive, computed, watch } from 'vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { ElMessage } from 'element-plus'
import { createRole, updateRole, setRolePermissions } from '@/api/adminUser'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 待编辑角色（null=新建）：{ id, name, modules:[页面名], userCount }
  role: { type: Object, default: null },
  // 页面权限树：[{ scope, groups:[{ name, pages[] }] }]
  permissionTree: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:visible', 'saved'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

const isEdit = computed(() => !!props.role?.id)
// 标题：编辑态「编辑角色与权限」（原型 openRoleEditor），新建「新建角色」
const title = computed(() => (isEdit.value ? '编辑角色与权限' : '新建角色'))

const formRef = ref()
const saving = ref(false)
const form = reactive({ name: '' })

// 已勾选页面名集合（响应式数组承载；顺序在提交比对时排序归一，与顺序无关）
const selected = ref([])
// 权限区必填校验的就地错误（提交时才亮，勾选后即消）
const permError = ref('')

const selectedSet = computed(() => new Set(selected.value))
const selectedCount = computed(() => selected.value.length)

/** 树中全部可勾选页面（用于提交过滤与全选） */
const allPages = computed(() => props.permissionTree.flatMap((s) => (s.groups || []).flatMap((g) => g.pages || [])))

function scopePages(scope) {
  return (scope.groups || []).flatMap((g) => g.pages || [])
}
function scopeSelectedCount(scope) {
  return scopePages(scope).filter((p) => selectedSet.value.has(p)).length
}
function scopeChecked(scope) {
  const pages = scopePages(scope)
  return pages.length > 0 && pages.every((p) => selectedSet.value.has(p))
}
function scopeIndeterminate(scope) {
  const n = scopeSelectedCount(scope)
  return n > 0 && n < scopePages(scope).length
}
function groupChecked(group) {
  const pages = group.pages || []
  return pages.length > 0 && pages.every((p) => selectedSet.value.has(p))
}
function groupIndeterminate(group) {
  const n = (group.pages || []).filter((p) => selectedSet.value.has(p)).length
  return n > 0 && n < (group.pages || []).length
}

function setPages(pages, on) {
  const set = new Set(selected.value)
  for (const p of pages) {
    if (on) set.add(p)
    else set.delete(p)
  }
  // 按树序稳定输出（展示与比对都不受勾选先后影响）
  selected.value = allPages.value.filter((p) => set.has(p))
  if (selected.value.length) permError.value = ''
}
const toggleScope = (scope, on) => setPages(scopePages(scope), on)
const toggleGroup = (group, on) => setPages(group.pages || [], on)
const togglePage = (page, on) => setPages([page], on)

// 角色 modules 恒为页面名数组，仅过滤空值
function normModules(modules) {
  return (modules || []).filter(Boolean)
}

function reset() {
  form.name = props.role?.name || ''
  selected.value = normModules(props.role?.modules).filter((p) => allPages.value.includes(p))
  permError.value = ''
  formRef.value?.clearValidate?.()
}

watch(
  () => props.visible,
  (v) => {
    if (v) reset()
  }
)

const rules = {
  name: [{ required: true, message: '请填写角色名称', trigger: 'blur' }]
}

async function onSubmit() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    // 页面权限必填：勾选为 0 → 就地提示，不提交（原型 saveRole 校验口径）
    if (!selected.value.length) {
      permError.value = '请至少开通 1 个页面'
      return
    }
    saving.value = true
    try {
      const modules = [...selected.value]
      if (!isEdit.value) {
        // 新建：只带 name + 权限（code 由系统派生，前端不填）
        await createRole({ name: form.name, modules })
        ElMessage.success('角色已创建')
      } else {
        // 编辑：名称变更 → updateRole；权限变更 → setRolePermissions（全量替换）。按需分别下发。
        const nameChanged = form.name !== props.role.name
        const before = normModules(props.role.modules).slice().sort()
        const after = modules.slice().sort()
        const modulesChanged = JSON.stringify(before) !== JSON.stringify(after)
        if (nameChanged) await updateRole(props.role.id, { name: form.name })
        if (modulesChanged) await setRolePermissions(props.role.id, modules)
        ElMessage.success('角色与权限已保存')
      }
      dialogVisible.value = false
      emit('saved')
    } catch (e) {
      ElMessage.error(e?.message || '保存失败，请重试')
    } finally {
      saving.value = false
    }
  })
}
</script>

<template>
  <!-- 右侧抽屉（管理后台统一范式）：权限勾选要停留反复操作、常需对照列表，弹窗放不下整块权限区 -->
  <DrawerEditor
    v-model:visible="dialogVisible"
    :title="title"
    :saving="saving"
    append-to-body
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="角色名称" prop="name">
        <el-input v-model="form.name" placeholder="如 内容运营" maxlength="64" />
        <div class="re-hint">角色名称用于用户分配，系统标识自动生成</div>
      </el-form-item>

      <el-form-item>
        <template #label>
          页面权限
          <span class="re-label-sub">勾中哪些页面，持该角色的用户就能进入哪些页面</span>
        </template>

        <div class="re-perm-area" :class="{ 'is-invalid': permError }">
          <!-- 范围卡片（原型 perm-scope）：用户端整组勾选不展开；管理端分组卡片式复选 -->
          <article v-for="scope in permissionTree" :key="scope.scope" class="re-scope">
            <label class="re-scope-head">
              <el-checkbox
                :model-value="scopeChecked(scope)"
                :indeterminate="scopeIndeterminate(scope)"
                @change="(v) => toggleScope(scope, v)"
              />
              <span class="re-scope-name">{{ scope.scope }}</span>
              <!-- 组头已选计数 N/M（用户端整组勾选，不出计数与明细） -->
              <span v-if="scope.scope !== '用户端'" class="re-scope-count">
                {{ scopeSelectedCount(scope) }}/{{ scopePages(scope).length }}
              </span>
            </label>
            <div v-if="scope.scope !== '用户端'" class="re-scope-body">
              <div v-for="group in scope.groups" :key="group.name" class="re-group">
                <label class="re-group-title">
                  <el-checkbox
                    :model-value="groupChecked(group)"
                    :indeterminate="groupIndeterminate(group)"
                    @change="(v) => toggleGroup(group, v)"
                  />
                  <span>{{ group.name }}</span>
                </label>
                <div class="re-pages">
                  <label v-for="page in group.pages" :key="page" class="re-page">
                    <el-checkbox
                      :model-value="selectedSet.has(page)"
                      @change="(v) => togglePage(page, v)"
                    />
                    <span>{{ page }}</span>
                  </label>
                </div>
              </div>
            </div>
          </article>

          <el-empty
            v-if="!permissionTree.length"
            :image-size="60"
            description="权限树加载失败 · 关闭重开重试"
          />
        </div>

        <div v-if="permError" class="re-perm-err">{{ permError }}</div>
        <!-- 权限区底部实时汇总（原型 permission-summary） -->
        <div class="re-perm-summary">已选择 {{ selectedCount }} 个页面</div>
      </el-form-item>
    </el-form>

    <!-- 编辑态底部提示（原型 danger-hint）：权限调整的影响面 -->
    <div v-if="isEdit" class="re-danger-hint">
      该角色当前绑定 {{ props.role?.userCount ?? 0 }} 个用户。权限调整保存后将对这些用户生效。
    </div>

    <!-- 底部操作：新建=【取消】【创建角色】；编辑=【取消】【保存】 -->
    <template #footer>
      <div class="re-foot">
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSubmit">
          {{ isEdit ? '保存' : '创建角色' }}
        </el-button>
      </div>
    </template>
  </DrawerEditor>
</template>

<style scoped>
.re-hint {
  width: 100%;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
  margin-top: var(--space-1);
}
.re-label-sub {
  margin-left: var(--space-2);
  font-weight: var(--fw-normal);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* 权限区：范围卡片纵排（原型 permission-tree） */
.re-perm-area {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.re-perm-area.is-invalid .re-scope {
  border-color: var(--c-danger);
}
.re-scope {
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  overflow: hidden;
}
.re-scope-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 44px;
  padding: 0 var(--space-3);
  background: var(--bg-sunken);
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
}
.re-scope:has(> .re-scope-head:only-child) .re-scope-head {
  border-bottom: none;
}
.re-scope-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.re-scope-count {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.re-scope-body {
  padding: var(--space-3);
}
.re-group + .re-group {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-soft);
}
.re-group-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  color: var(--c-text);
  font-weight: var(--fw-medium);
  cursor: pointer;
}
/* 页面复选：约三列排布（原型 perm-pages），窄屏回落单列 */
.re-pages {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-1) var(--space-3);
  padding-left: var(--space-5);
}
@media (max-width: 720px) {
  .re-pages {
    grid-template-columns: 1fr;
  }
}
.re-page {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.re-perm-err {
  width: 100%;
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.re-perm-summary {
  width: 100%;
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* 编辑态影响面提示（原型 danger-hint） */
.re-danger-hint {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--c-danger-soft, #fff5f4);
  color: var(--c-danger);
  font-size: var(--fs-xs);
  line-height: 1.55;
}

/* 抽屉底部操作条：统一右对齐与其余编辑器一致 */
.re-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
