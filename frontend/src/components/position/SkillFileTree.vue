<script setup>
/**
 * 技能包目录树（技能包改造 §2/§3，F5b/F6 + 目录结构能力 F7/F8/F9，切片3）。
 *
 * 职责（单一职责：树渲染 + 树操作入口，不持有文件内容/保存逻辑——那在页面层）：
 * - el-tree 渲染：目录节点 = 后端「有文件目录」按 path 合成 + 持久化空目录占位行（is_dir）；
 *   node-key=path、SKILL.md 置顶 + 入口徽标；
 * - 文件类型图标（md/json/txt）、当前选中态、未保存脏点 ●、.json 语法错 △；
 * - hover ⋯ 上下文菜单（el-dropdown）：SKILL.md=根级新建文件/文件夹；普通文件=同级新建 + 移动到… + 重命名 + 删除；
 *   文件夹=在此新建文件/子文件夹 + 移动到… + 重命名文件夹 + 删除文件夹（深度上限 disabled）；
 * - 拖拽移动（F7 文件入夹/回根、F8 文件夹连带子项）：el-tree draggable + allow-drop 本地预判（后端为权威）；
 * - 「移动到…」（F9）：点击式目录选择器（只含目录的树 + 「根目录」），非法目标置灰；
 * - 底部仅「⬇ 导出压缩包」。
 *
 * 空目录持久化（架构 §1/§2，用户已拍板 is_dir 落库）：新建文件夹直接调后端端点9 落库，
 * 不再用客户端「待定空夹」；文件夹改名/删除/移动调后端原子端点（10/11/12），不再前端 for 循环级联。
 *
 * 写请求在本组件内调 api（树操作天然是「弹窗/拖拽 → 请求 → 回吐刷新」闭环），结果 emit 给页面：
 *   emit select(path) / file-created(path, saveVO) / file-renamed(fromPath, toPath, saveVO)
 *      / file-deleted(path, saveVO) / tree-changed(saveVO, meta) / retry。
 *   - tree-changed：文件夹新建/改名/删除、文件或文件夹移动等「批量/结构」操作统一回吐，
 *     meta = { kind, pathMap?, removedPrefix?, activeHint? } 供页面迁移缓存键与选中态。
 */
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  MoreFilled,
  Download,
  Document,
  DataLine,
  Memo,
  Picture,
  Files,
  Folder,
  FolderOpened,
  House,
  Search,
  Close as CloseIcon,
  Loading
} from '@element-plus/icons-vue'
import {
  saveSkillFile,
  deleteSkillFile,
  renameSkillFile,
  exportSkillZip,
  createSkillFolder,
  renameSkillFolder,
  deleteSkillFolder,
  moveSkillNode,
  searchSkillFiles
} from '@/api/skillFiles'
import { parseSkillMdTools } from '@/utils/positionModel'
import { TREE_HINT_ENTRY, TREE_HINT_SUBFILE } from '@/utils/skillTerms'
import {
  ENTRY_PATH,
  buildFileTree,
  collectFilePaths,
  collectAllDirs,
  fileIconName,
  isMonoType,
  validateRenamePath,
  validateLeafFileName,
  validateFolderName,
  canCreateSubfolder,
  joinPath,
  collectDirFiles,
  renameDirInPath,
  parentDirOf,
  lastSegOf,
  validateMoveTarget,
  buildMoveContext
} from '@/utils/skillFileTree'

const props = defineProps({
  skillId: { type: [Number, String], default: null },
  // 后端扁平 files[]（SkillFileTreeVO.files，含 is_dir 空目录占位行）。
  files: { type: Array, default: () => [] },
  // 数据源前缀分支：'fde' | 'platform'
  source: { type: String, default: 'fde' },
  // 当前选中文件 path（受控，highlight-current 用）
  activePath: { type: String, default: '' },
  // 各文件脏态 { [path]: true }（未保存改动），父级 dirtyMap 透传
  dirtyMap: { type: Object, default: () => ({}) },
  // .json 语法错文件 { [path]: true }，叠加红色 △
  jsonErrorMap: { type: Object, default: () => ({}) },
  // 各文件内容缓存 { [path]: content }，删 .md 时本地解析工具名用（Q2 删前列工具）
  contentCache: { type: Object, default: () => ({}) },
  // 树 loading 态
  loading: { type: Boolean, default: false },
  loadError: { type: Boolean, default: false },
  // 只读态（平台技能 Tab 只读详情）：写入口 v-if 不渲染、拖拽禁用，仅保留浏览/点击查看。
  readonly: { type: Boolean, default: false }
})

const emit = defineEmits([
  'select',
  'file-created',
  'file-renamed',
  'file-deleted',
  'tree-changed',
  'retry',
  'search-jump' // 组③：跨文件查找命中 → (path, lineNo, keyword) 切到该文件并定位
])

const ICONS = { Document, DataLine, Memo, Picture, Files, Folder, FolderOpened, House }

const existingPaths = computed(() => collectFilePaths(props.files))
const allDirs = computed(() => collectAllDirs(props.files))

const treeRef = ref(null)
// 展开态在本编辑会话内保持（F5 收口）；切技能重置。
const expandedKeys = ref([])

watch(
  () => props.skillId,
  () => {
    expandedKeys.value = []
  }
)

// 合成树：后端 files[]（含 is_dir 占位空目录）→ 嵌套节点（buildFileTree 已排序 + 同 path 去重）。
const fullTreeData = computed(() => buildFileTree(props.files))

/* ============================ 组③：目录树过滤（按名）+ 跨文件查找（按内容） ============================ */
// 「按内容」查找是否可用：只读浏览（平台候选 platform-candidate / 任意 readonly）下后端无 /files/search 端点，
// 调用会 404（越权）→ 只读态**隐藏「按内容」入口**，仅保留纯前端「按名过滤」（P1 收口，不触发后端查询）。
const contentSearchable = computed(() => !props.readonly && props.source !== 'platform-candidate')
// 查找态：query + 模式（name=纯前端名字过滤 / content=调后端搜内容）。
const searchQuery = ref('')
const searchMode = ref('name') // 'name' | 'content'
const searchDebounceTimer = ref(null)
const contentLoading = ref(false)
const contentError = ref(false)
const contentResults = ref([]) // SkillFileSearchVO.items（content 模式）

// 切技能：清查找态（隔离跨技能串扰）。
watch(
  () => props.skillId,
  () => {
    resetSearch()
  }
)
onBeforeUnmount(() => {
  clearTimeout(searchDebounceTimer.value)
})

function resetSearch() {
  searchQuery.value = ''
  searchMode.value = 'name'
  contentResults.value = []
  contentLoading.value = false
  contentError.value = false
  clearTimeout(searchDebounceTimer.value)
}

// 名字过滤是否激活（有非空 query 且 name 模式）。
const nameFilterActive = computed(
  () => searchMode.value === 'name' && searchQuery.value.trim().length > 0
)

// 过滤后的树（name 模式）：保留命中节点 + 其祖先链；目录命中则整子树保留。空 query → 全量。
const treeData = computed(() => {
  const full = fullTreeData.value
  if (!nameFilterActive.value) return full
  const kw = searchQuery.value.trim().toLowerCase()
  return filterTreeByName(full, kw)
})

// 递归过滤：节点名命中或任一子孙命中则保留；命中节点保留其完整子树。
function filterTreeByName(nodes, kw) {
  const out = []
  for (const n of nodes) {
    const selfHit = String(n.name || '').toLowerCase().includes(kw)
    if (n.isDir) {
      const kids = filterTreeByName(n.children || [], kw)
      if (selfHit || kids.length) {
        // 命中目录自身 → 保留完整子树；仅子孙命中 → 保留过滤后的子树。
        out.push({ ...n, children: selfHit ? n.children : kids })
      }
    } else if (selfHit) {
      out.push(n)
    }
  }
  return out
}

// 名字过滤时自动展开所有命中路径的祖先链（让命中可见）。
watch([nameFilterActive, () => searchQuery.value, fullTreeData], () => {
  if (!nameFilterActive.value) return
  const kw = searchQuery.value.trim().toLowerCase()
  const keys = new Set(expandedKeys.value)
  for (const p of existingPaths.value) {
    const name = p.split('/').pop() || ''
    if (name.toLowerCase().includes(kw)) {
      for (const a of ancestorsOf(p)) keys.add(a)
    }
  }
  // 目录名命中也展开其祖先。
  for (const d of allDirs.value) {
    if ((d.split('/').pop() || '').toLowerCase().includes(kw)) {
      for (const a of ancestorsOf(d)) keys.add(a)
      keys.add(d)
    }
  }
  expandedKeys.value = [...keys]
})

// 输入变化：name 模式即时（计算属性自然反应）；content 模式 debounce 350ms 调后端。
function onSearchInput() {
  clearTimeout(searchDebounceTimer.value)
  if (searchMode.value !== 'content') return
  const q = searchQuery.value.trim()
  if (!q) {
    contentResults.value = []
    contentError.value = false
    contentLoading.value = false
    return
  }
  contentLoading.value = true
  contentError.value = false
  searchDebounceTimer.value = setTimeout(() => runContentSearch(q), 350)
}

async function runContentSearch(q) {
  if (!props.skillId) return
  const reqSkill = props.skillId
  const reqQ = q
  try {
    const vo = await searchSkillFiles(props.skillId, q, 'all', props.source)
    // 竞态护栏：回填前校验仍是发起时的技能 + query。
    if (props.skillId !== reqSkill || searchQuery.value.trim() !== reqQ) return
    contentResults.value = Array.isArray(vo?.items) ? vo.items : []
  } catch (e) {
    if (props.skillId === reqSkill && searchQuery.value.trim() === reqQ) contentError.value = true
  } finally {
    if (props.skillId === reqSkill && searchQuery.value.trim() === reqQ) contentLoading.value = false
  }
}

// 切模式：清后端结果，content 模式下若已有 query 立即查。
// 只读态防御：content 不可用时强制回落 name（即便入口已隐藏，也不触发后端查询）。
function setSearchMode(mode) {
  if (mode === 'content' && !contentSearchable.value) return
  if (searchMode.value === mode) return
  searchMode.value = mode
  contentResults.value = []
  contentError.value = false
  contentLoading.value = false
  if (mode === 'content') onSearchInput()
}

function clearSearch() {
  resetSearch()
}

// 命中片段高亮：把 query 子串包成 <mark>（转义 HTML，防注入）。
function highlightSnippet(snippet, q) {
  const text = String(snippet ?? '')
  const kw = String(q ?? '').trim()
  if (!kw) return escapeHtml(text)
  const lower = text.toLowerCase()
  const klow = kw.toLowerCase()
  let out = ''
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(klow, i)
    if (idx < 0) {
      out += escapeHtml(text.slice(i))
      break
    }
    out += escapeHtml(text.slice(i, idx))
    out += `<mark class="sr-hit">${escapeHtml(text.slice(idx, idx + kw.length))}</mark>`
    i = idx + kw.length
  }
  return out
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 点击某条内容命中 → 上抛父级切文件 + 定位行 + 带查询词（.md 无法精确定位时提示用 Ctrl/⌘+F 查关键词）。
function onHitClick(item, line) {
  emit('search-jump', item.path, line?.lineNo ?? null, searchQuery.value.trim())
}
// 命中文件名命中（nameHit）但无具体行 → 仅切文件。
function onFileHitClick(item) {
  emit('search-jump', item.path, null, searchQuery.value.trim())
}

// 同级「占用名」集合（新建/重命名文件夹查重）。dirPrefix='' → 根级。
// 工程-CR：后端目录与文件同命名空间（撞同名会 409），故查重须同时纳入同级目录名 + 同级文件末段名，
// 与 validateMoveTarget 的双查（allPaths + allDirs）口径对齐，做到本地即时预判、不静默放过到后端。
function siblingDirNames(dirPrefix) {
  const names = new Set()
  const depth = dirPrefix ? dirPrefix.split('/').length : 0
  const pfx = dirPrefix ? dirPrefix + '/' : ''
  const atLevel = (p) => {
    const segs = p.split('/')
    return segs.length === depth + 1 && (depth === 0 || p.startsWith(pfx))
  }
  // 同级目录名（含合成目录 + is_dir 占位空目录）。
  for (const d of allDirs.value) {
    if (atLevel(d)) names.add(d.split('/').pop())
  }
  // 同级文件末段名（撞同级文件 → 后端 409，本地一并拦）。
  for (const f of existingPaths.value) {
    if (atLevel(f)) names.add(f.split('/').pop())
  }
  return [...names]
}

const treeProps = { label: 'name', children: 'children' }

/* ============================ 节点选中 ============================ */
function onNodeClick(node) {
  // 目录节点仅展开/折叠，不载编辑器（§2.4）。展开靠箭头，此处目录点击不 emit。
  if (node.isDir) return
  if (node.path !== props.activePath) emit('select', node.path)
}

// SKILL.md / entry 判定
function isEntryNode(node) {
  return !node.isDir && (node.isEntry || node.path === ENTRY_PATH)
}

// 组②：节点「是否进 prompt」说明（title 悬浮，说人话；目录不标）。文案复用 utils/skillTerms（单一真相），
// 措辞准确区分「不直接进 prompt」vs「运行时仍可被读取」+ 明示「需在主文件写明让 AI 去读」——别让 FDE 误解。
function promptHint(node) {
  if (node.isDir) return ''
  return isEntryNode(node) ? TREE_HINT_ENTRY : TREE_HINT_SUBFILE
}

/* ============================ 节点图标 ============================ */
function iconComp(node) {
  return ICONS[fileIconName(node.fileType)] || ICONS.Document
}
function nodeNameClass(node) {
  return {
    'fn-mono': !node.isDir && isMonoType(node.fileType),
    'fn-current': node.path === props.activePath
  }
}

/* ============================ 位置可视文案 ============================ */
function dirLabel(dirPrefix) {
  return dirPrefix ? `${dirPrefix}/` : '（根目录）'
}

/* ============================ 新建文件（只输叶子名，path 由 dirPrefix 在前端拼） ============================ */
async function openCreate(dirPrefix = '') {
  const title = dirPrefix ? `在「${dirPrefix}」中新建文件` : '在根目录中新建文件'
  let result
  try {
    result = await ElMessageBox.prompt(`位置：${dirLabel(dirPrefix)}`, title, {
      inputPlaceholder: '文件名，如 policy.md（不含 /）',
      confirmButtonText: '新建',
      cancelButtonText: '取消',
      inputValidator: (val) => validateLeafFileName(val, dirPrefix, existingPaths.value) ?? true
    })
  } catch {
    return
  }
  const name = String(result.value || '').trim()
  const path = joinPath(dirPrefix, name)
  if (!props.skillId) return
  try {
    const saveVO = await saveSkillFile(props.skillId, { path, content: '' }, props.source)
    ElMessage.success(`已新建 ${path}`)
    emit('file-created', path, saveVO)
  } catch (e) {
    ElMessage.error(e?.message || '新建失败')
  }
}

/* ============================ 新建文件夹（端点9，is_dir 占位行真持久化） ============================ */
// dirPrefix = 在哪个目录下新建子文件夹（'' = 根级）。只输单段夹名 → 调后端端点9 落库。
async function openCreateFolder(dirPrefix = '') {
  const title = dirPrefix ? `在「${dirPrefix}」中新建子文件夹` : '在根目录中新建文件夹'
  let result
  try {
    result = await ElMessageBox.prompt(`位置：${dirLabel(dirPrefix)}`, title, {
      inputPlaceholder: '文件夹名，如 references（不含 /）',
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputValidator: (val) => validateFolderName(val, siblingDirNames(dirPrefix)) ?? true
    })
  } catch {
    return
  }
  const name = String(result.value || '').trim()
  const dir = joinPath(dirPrefix, name)
  if (!props.skillId) return
  try {
    const saveVO = await createSkillFolder(props.skillId, dir, props.source)
    // 落库后自动展开新夹及其祖先链，引导在其内继续整理。
    expandedKeys.value = [...new Set([...expandedKeys.value, dir, ...ancestorsOf(dir)])]
    ElMessage.success(`已新建文件夹「${name}」`)
    emit('tree-changed', saveVO, { kind: 'folder-create', dir })
  } catch (e) {
    ElMessage.error(e?.message || '新建文件夹失败')
  }
}

function ancestorsOf(dir) {
  const segs = String(dir).split('/')
  const out = []
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join('/'))
  return out
}

/* ============================ 重命名文件（只输叶子名，所在目录不变） ============================ */
async function openRename(node) {
  const fromPath = node.path
  const dirPrefix = parentDirOf(fromPath)
  const oldName = node.name
  let result
  try {
    result = await ElMessageBox.prompt(`位置：${dirLabel(dirPrefix)}`, '重命名文件', {
      inputValue: oldName,
      inputPlaceholder: '新文件名（不含 /）',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValidator: (val) => {
        const name = String(val || '').trim()
        if (name === oldName) return '名称未改变'
        const toPath = joinPath(dirPrefix, name)
        return validateRenamePath(toPath, fromPath, existingPaths.value) ?? true
      }
    })
  } catch {
    return
  }
  const toPath = joinPath(dirPrefix, String(result.value || '').trim())
  if (toPath === fromPath || !props.skillId) return
  try {
    const saveVO = await renameSkillFile(props.skillId, { fromPath, toPath }, props.source)
    ElMessage.success('已重命名')
    emit('file-renamed', fromPath, toPath, saveVO)
  } catch (e) {
    ElMessage.error(e?.message || '重命名失败')
  }
}

/* ============================ 删除文件（ElMessageBox.confirm，Q2/Q3） ============================ */
async function openDelete(node) {
  const path = node.path
  const isMd = (node.fileType || '').toLowerCase() === 'md'
  let msg = `删除文件「${path}」？删除后不可恢复。`
  if (isMd) {
    const content = props.contentCache?.[path]
    const tools = content != null ? parseSkillMdTools(content) : []
    if (tools.length) {
      const names = tools.map((t) => t.code).join('、')
      msg += `\n\n该文件引用了工具：${names}。删除后若无其它 .md 仍引用，将移出本技能运行时白名单。`
    }
  }
  try {
    await ElMessageBox.confirm(msg, '删除文件', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  if (!props.skillId) return
  try {
    const saveVO = await deleteSkillFile(props.skillId, path, props.source)
    emit('file-deleted', path, saveVO)
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

/* ============================ 重命名文件夹（端点10，原子级联改前缀） ============================ */
async function openRenameFolder(node) {
  const fromDir = node.path
  const dirPrefix = parentDirOf(fromDir)
  const oldName = node.name
  const files = collectDirFiles(existingPaths.value, fromDir)
  let result
  try {
    const tip = files.length ? `\n将级联重命名其下 ${files.length} 个文件的路径。` : ''
    result = await ElMessageBox.prompt(`位置：${dirLabel(dirPrefix)}${tip}`, '重命名文件夹', {
      inputValue: oldName,
      inputPlaceholder: '新文件夹名（不含 /）',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValidator: (val) => validateFolderName(val, siblingDirNames(dirPrefix), oldName) ?? true
    })
  } catch {
    return
  }
  const newName = String(result.value || '').trim()
  const toDir = joinPath(dirPrefix, newName)
  if (toDir === fromDir || !props.skillId) return
  try {
    // 单事务原子改名（替代前端逐个 rename）。pathMap 供页面迁移当前打开文件的缓存键/选中态。
    const saveVO = await renameSkillFolder(props.skillId, { fromPath: fromDir, toPath: toDir }, props.source)
    const pathMap = {}
    for (const fp of files) pathMap[fp] = renameDirInPath(fp, fromDir, toDir)
    // 展开态前缀迁移（保持视图）。
    migrateExpanded(fromDir, toDir)
    ElMessage.success('已重命名文件夹')
    emit('tree-changed', saveVO, { kind: 'folder-rename', pathMap })
  } catch (e) {
    ElMessage.error(e?.message || '重命名文件夹失败')
  }
}

// 展开态里以 fromDir 为前缀的 key 迁移到 toDir（含 fromDir 自身），保持改名/移动后视图不塌。
function migrateExpanded(fromDir, toDir) {
  const mapped = expandedKeys.value.map((k) => {
    if (k === fromDir) return toDir
    if (k.startsWith(fromDir + '/')) return toDir + k.slice(fromDir.length)
    return k
  })
  expandedKeys.value = [...new Set([...mapped, toDir])]
}

/* ============================ 删除文件夹（端点11，级联软删整子树，二次确认列影响） ============================ */
async function openDeleteFolder(node) {
  const dir = node.path
  const files = collectDirFiles(existingPaths.value, dir)
  // 非空夹：二次确认 + 列影响范围（PRD §4.5 / AC-C1）。空夹也走后端删除（占位行落库），无需列清单确认。
  if (files.length) {
    let msg = `删除文件夹「${dir}」？将一并删除其下 ${files.length} 个文件：\n${files.map((f) => `  • ${f}`).join('\n')}\n删除后不可恢复。`
    const toolNames = new Set()
    for (const fp of files) {
      if ((fp.split('.').pop() || '').toLowerCase() === 'md') {
        const content = props.contentCache?.[fp]
        if (content != null) for (const t of parseSkillMdTools(content)) toolNames.add(t.code)
      }
    }
    if (toolNames.size) {
      msg += `\n\n这些 .md 引用了工具：${[...toolNames].join('、')}。删除后若无其它 .md 仍引用，将移出本技能运行时白名单。`
    }
    try {
      await ElMessageBox.confirm(msg, '删除文件夹', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      })
    } catch {
      return
    }
  }
  if (!props.skillId) return
  try {
    // 单事务原子软删整子树（占位行 + 全部子项）。Q2 工具白名单 diff 由页面层据 saveVO 处理。
    const saveVO = await deleteSkillFolder(props.skillId, dir, props.source)
    expandedKeys.value = expandedKeys.value.filter((k) => k !== dir && !k.startsWith(dir + '/'))
    if (files.length) ElMessage.success(`已删除文件夹（${files.length} 个文件）`)
    else ElMessage.success('已删除空文件夹')
    emit('tree-changed', saveVO, { kind: 'folder-delete', removedPrefix: dir })
  } catch (e) {
    ElMessage.error(e?.message || '删除文件夹失败')
  }
}

/* ============================ F9 「移动到…」目录选择器（点击式移动入口） ============================ */
const moveDialog = reactive({
  visible: false,
  node: null, // 被移动节点 { path, name, isDir, fileType }
  selected: '', // 选中的目标父目录（'' = 根）
  loading: false
})

// 目录选择树数据 + 「是否存在合法落点」一次算出（H5 性能）：
// ① buildMoveContext 预算一次共享上下文（allPaths/allDirs/子树深度），mapDir 递归复用，
//    避免 validateMoveTarget 每目标重扫 files（原 O(目录数²)）；
// ② mapDir 过程顺带记录 hasValid，省 moveHasValidTarget 的整树二次遍历。
// 单 computed 同时产出 { data, hasValid }，下方派生两个只读 computed（无 computed 内副作用、求值顺序无关）。
const moveTree = computed(() => {
  if (!moveDialog.node) return { data: [], hasValid: false }
  const node = moveDialog.node
  const ctx = buildMoveContext(node.path, !!node.isDir, props.files)
  let hasValid = false
  function mapDir(n) {
    const reason = validateMoveTarget({
      fromPath: node.path,
      isDir: !!node.isDir,
      toParentDir: n.path,
      files: props.files,
      ctx
    })
    if (!reason) hasValid = true
    return {
      path: n.path,
      name: n.name,
      disabled: !!reason,
      reason: reason || '',
      children: (n.children || []).filter((c) => c.isDir).map(mapDir)
    }
  }
  const rootReason = validateMoveTarget({
    fromPath: node.path,
    isDir: !!node.isDir,
    toParentDir: '',
    files: props.files,
    ctx
  })
  if (!rootReason) hasValid = true
  const root = {
    path: '',
    name: '根目录（顶层）', // UI-CR：与普通目录区分（House 图标 + 「（顶层）」后缀）
    isRoot: true,
    disabled: !!rootReason,
    reason: rootReason || '',
    children: buildFileTree(props.files)
      .filter((c) => c.isDir)
      .map(mapDir)
  }
  return { data: [root], hasValid }
})
const moveTreeData = computed(() => moveTree.value.data)
// UI-P2：是否存在任一合法落点（根 + 任意目录）。无合法目标 → 给空提示，避免只剩灰节点无解释。
const moveHasValidTarget = computed(() => moveTree.value.hasValid)

const moveTreeProps = {
  label: 'name',
  children: 'children',
  disabled: (data) => data.disabled
}

function openMoveTo(node) {
  moveDialog.node = { path: node.path, name: node.name, isDir: !!node.isDir, fileType: node.fileType }
  // AC-F1：默认选中并高亮「当前所在目录」（而非恒为根）。当前目录本身是非法落点（已在该目录），
  // 仅作高亮基准，不作可确认项——用户须改选别的合法目标才能确认。
  moveDialog.selected = parentDirOf(node.path)
  moveDialog.visible = true
}

function onMoveTreeClick(data) {
  if (data.disabled) return
  moveDialog.selected = data.path
}

const moveSelectedLabel = computed(() => {
  if (moveDialog.selected === '') return '根目录（顶层）'
  return `${moveDialog.selected}/`
})

// 被移动对象「当前所在目录」（AC-F1 默认高亮基准；'' = 根）。
const currentMoveDir = computed(() => (moveDialog.node ? parentDirOf(moveDialog.node.path) : null))

async function confirmMove() {
  const node = moveDialog.node
  if (!node || !props.skillId) return
  const toParentDir = moveDialog.selected
  // 末校验（即使选中也再判一次，防数据变化）。
  const reason = validateMoveTarget({
    fromPath: node.path,
    isDir: !!node.isDir,
    toParentDir,
    files: props.files
  })
  if (reason) {
    ElMessage.warning(reason)
    return
  }
  moveDialog.loading = true
  try {
    await doMove(node.path, !!node.isDir, toParentDir)
    moveDialog.visible = false
  } finally {
    moveDialog.loading = false
  }
}

/* ============================ F7/F8 拖拽移动（el-tree draggable + allow-drop） ============================ */
// 是否允许拖动该节点：SKILL.md / entry 不可拖（PRD §5.1）；只读不可拖。
function allowDrag(treeNode) {
  if (props.readonly) return false
  const data = treeNode.data
  if (!data) return false
  if (isEntryNode(data)) return false
  return true
}

// 非法落点原因提示节流：allowDrop 在 dragover 期间持续触发，被拦掉的落点不会进 onNodeDrop，
// 故原因须在 allowDrop 侧补（否则静默，违反 AC-D3/E2/E3/E4）。按 (落点 key + 原因) 去重 + 时间节流，避免刷屏。
let lastDropHintAt = 0
let lastDropHintKey = ''
function hintIllegalDrop(dropKey, reason) {
  const now = Date.now()
  const key = `${dropKey}|${reason}`
  if (key === lastDropHintKey && now - lastDropHintAt < 1500) return
  lastDropHintKey = key
  lastDropHintAt = now
  ElMessage({ type: 'warning', message: reason, duration: 1500, grouping: true })
}

// 落点合法性预判（el-tree allow-drop）。仅允许 type='inner'（拖入某节点内部）；
// 目标须是目录节点；用 validateMoveTarget 复用规则；entry 节点不接受落入。
// 非法时返回 false（el-tree 不高亮）+ 节流提示原因（UI-CR：非法落点不静默）。
function allowDrop(dragNode, dropNode, type) {
  if (props.readonly) return false
  // 仅允许「放入目标内部」（inner）；prev/next（同级排序）本期不做（PRD §7 F13），静默拒（横线已 CSS 隐藏）。
  if (type !== 'inner') return false
  const drag = dragNode.data
  const drop = dropNode.data
  if (!drag || !drop) return false
  // entry 不可被拖动（双保险，allowDrag 已挡）。
  if (isEntryNode(drag)) return false
  // 目标必须是目录（拖到文件节点上非法，PRD §5.4 / AC-D3）。
  if (!drop.isDir) {
    if (drop.path !== drag.path) hintIllegalDrop(drop.path, '请拖到文件夹上')
    return false
  }
  // 目标父目录 = 该目录 path（拖入其内部）。非法（循环/超深/重名/无意义）→ 提示对应原因。
  const reason = validateMoveTarget({
    fromPath: drag.path,
    isDir: !!drag.isDir,
    toParentDir: drop.path,
    files: props.files
  })
  if (reason) {
    // 「已在该目录中」是无意义移动（不算错误），不提示，仅不高亮。
    if (reason !== '已在该目录中') hintIllegalDrop(drop.path, reason)
    return false
  }
  return true
}

// 拖放落定 → 调端点12 移动。el-tree 已就地改了内存树，但我们以后端回吐为权威重建；
// 为防后端拒绝/失败时本地树错位，落定后立即用 props.files 重建（treeData 是 computed，回吐刷新即恢复）。
async function onNodeDrop(dragNode, dropNode, dropType) {
  const drag = dragNode.data
  const drop = dropNode.data
  if (!drag || !drop || dropType !== 'inner') {
    rebuildTree()
    return
  }
  const toParentDir = drop.path // inner → 放入该目录
  const reason = validateMoveTarget({
    fromPath: drag.path,
    isDir: !!drag.isDir,
    toParentDir,
    files: props.files
  })
  if (reason) {
    ElMessage.warning(reason)
    rebuildTree()
    return
  }
  await doMove(drag.path, !!drag.isDir, toParentDir)
}

// 强制按 props.files 重建树（拖拽被拒/失败时回滚 el-tree 的就地改动）。
// treeData 为 computed(props.files)；el-tree 内部维护了一份副本，需触发重渲染。
const treeKey = ref(0)
function rebuildTree() {
  treeKey.value += 1
}

// 统一移动执行（拖拽 / 「移动到…」共用）：调端点12，回吐刷新；处理当前打开文件 path 变化。
async function doMove(fromPath, isDir, toParentDir) {
  if (!props.skillId) return
  const leaf = lastSegOf(fromPath)
  const toPath = toParentDir ? `${toParentDir}/${leaf}` : leaf
  try {
    const saveVO = await moveSkillNode(props.skillId, { fromPath, toParentDir, isDir }, props.source)
    // 构造 pathMap：文件单条；文件夹则其下全部子项前缀替换。
    const pathMap = {}
    if (isDir) {
      for (const fp of collectDirFiles(existingPaths.value, fromPath)) {
        pathMap[fp] = renameDirInPath(fp, fromPath, toPath)
      }
      migrateExpanded(fromPath, toPath)
    } else {
      pathMap[fromPath] = toPath
    }
    ElMessage.success(isDir ? `已移动文件夹到 ${dirLabel(toParentDir)}` : `已移动到 ${dirLabel(toParentDir)}`)
    emit('tree-changed', saveVO, { kind: 'move', pathMap })
  } catch (e) {
    ElMessage.error(e?.message || '移动失败')
    rebuildTree() // 失败回滚本地拖拽改动
  }
}

/* ============================ ⋯ 菜单命令分发 ============================ */
function onMenuCommand(cmd, node) {
  switch (cmd) {
    case 'rename':
      openRename(node)
      break
    case 'delete':
      openDelete(node)
      break
    case 'move-to':
      openMoveTo(node)
      break
    case 'new-root-file':
      openCreate('')
      break
    case 'new-root-folder':
      openCreateFolder('')
      break
    case 'new-sibling-file':
      openCreate(parentDirOf(node.path))
      break
    case 'new-sibling-folder':
      openCreateFolder(parentDirOf(node.path))
      break
    case 'new-in-dir':
      openCreate(node.path)
      break
    case 'new-subfolder':
      openCreateFolder(node.path)
      break
    case 'rename-folder':
      openRenameFolder(node)
      break
    case 'delete-folder':
      openDeleteFolder(node)
      break
  }
}

/* ============================ 导出压缩包（端点8，切片4） ============================ */
const exporting = ref(false)
async function onExport() {
  if (exporting.value || !props.skillId) return
  exporting.value = true
  try {
    const filename = await exportSkillZip(props.skillId, props.source)
    ElMessage.success(`已导出 ${filename}`)
  } catch (e) {
    ElMessage.error(e?.message || '导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="file-tree">
    <!-- 头部工具条：标题 + 组③查找/过滤框（按名即时过滤 / 按内容跨文件查找）。 -->
    <div class="ft-head">
      <span class="ft-head-title">文件</span>
    </div>
    <div class="ft-search">
      <div class="ft-search-box">
        <el-icon class="ft-search-icon"><Search /></el-icon>
        <input
          v-model="searchQuery"
          class="ft-search-input"
          :placeholder="searchMode === 'name' ? '按文件名过滤…' : '查找文件内容…'"
          aria-label="查找/过滤文件"
          @input="onSearchInput"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="ft-search-clear"
          title="清空"
          aria-label="清空"
          @click="clearSearch"
        >
          <el-icon><CloseIcon /></el-icon>
        </button>
      </div>
      <!-- 模式切换：按名 / 按内容（二合一查找入口）。只读浏览（platform-candidate / readonly）下后端无
           /files/search 端点 → 隐藏「按内容」入口，只保留纯前端「按名过滤」（P1 收口，避免越权 404）。
           仅「按名」一项时整行不显（无意义的单按钮）。 -->
      <div v-if="contentSearchable" class="ft-search-modes">
        <button
          type="button"
          class="ft-mode"
          :class="{ on: searchMode === 'name' }"
          @click="setSearchMode('name')"
        >按名</button>
        <button
          type="button"
          class="ft-mode"
          :class="{ on: searchMode === 'content' }"
          @click="setSearchMode('content')"
        >按内容</button>
      </div>
    </div>

    <!-- loading -->
    <div v-if="loading" class="ft-loading">
      <el-skeleton :rows="4" animated />
    </div>
    <!-- 加载失败 -->
    <div v-else-if="loadError" class="ft-error">
      <span>目录加载失败</span>
      <el-button link type="primary" size="small" @click="emit('retry')">重试</el-button>
    </div>

    <!-- 按内容查找：结果面板（替代目录树）。loading/空/错误态齐全。 -->
    <div v-else-if="searchMode === 'content' && searchQuery.trim()" class="ft-search-results">
      <div v-if="contentLoading" class="sr-state"><el-icon class="is-spin"><Loading /></el-icon> 查找中…</div>
      <div v-else-if="contentError" class="sr-state sr-error">
        查找失败
        <el-button link type="primary" size="small" @click="onSearchInput">重试</el-button>
      </div>
      <div v-else-if="!contentResults.length" class="sr-state">没有找到包含「{{ searchQuery.trim() }}」的内容</div>
      <div v-else class="sr-list">
        <div v-for="item in contentResults" :key="item.path" class="sr-file">
          <div class="sr-file-head" :title="item.path" @click="onFileHitClick(item)">
            <el-icon class="sr-file-icon"><component :is="item.isDir ? ICONS.Folder : iconComp(item)" /></el-icon>
            <span class="sr-file-name">{{ item.name }}</span>
            <span class="sr-file-path">{{ item.path }}</span>
            <span v-if="item.nameHit" class="sr-namehit" title="这个文件的文件名也包含搜索词">文件名也命中</span>
          </div>
          <div
            v-for="(ln, i) in (item.lines || [])"
            :key="i"
            class="sr-line"
            :title="`跳到第 ${ln.lineNo} 行`"
            @click="onHitClick(item, ln)"
          >
            <span class="sr-lineno">{{ ln.lineNo }}</span>
            <span class="sr-snippet" v-html="highlightSnippet(ln.snippet, searchQuery.trim())"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- 名字过滤无命中：空态（content 模式走上方面板） -->
    <div v-else-if="nameFilterActive && !treeData.length" class="ft-empty-filter">
      没有名字含「{{ searchQuery.trim() }}」的文件
    </div>

    <!-- P-1 兜底：加载成功、非搜索/过滤态、但 treeData 为空（后端异常返回空数组且不报错的边界）。
         正常后端会虚拟一条 SKILL.md，此处堵住「空 el-tree 渲染成一片空白、观感像坏掉」的迷惑态，
         给一条轻量 muted 提示（复用 .ft-empty-filter muted 空态样式，仅语义令牌，双主题自适配）。 -->
    <div v-else-if="!treeData.length" class="ft-empty-filter">
      目录为空（SKILL.md 未返回）
    </div>

    <!-- 目录树（draggable：F7/F8 拖拽移动；allow-drag/allow-drop 本地预判，后端为权威）。
         过滤态禁用拖拽（避免对过滤后子集误判落点）。 -->
    <el-tree
      v-else
      ref="treeRef"
      :key="treeKey"
      class="ft-tree"
      :data="treeData"
      :props="treeProps"
      node-key="path"
      :default-expand-all="false"
      :default-expanded-keys="expandedKeys"
      :expand-on-click-node="false"
      :highlight-current="true"
      :current-node-key="activePath"
      :indent="0"
      :draggable="!readonly && !nameFilterActive"
      :allow-drag="allowDrag"
      :allow-drop="allowDrop"
      @node-drop="onNodeDrop"
    >
      <template #default="{ node, data }">
        <div
          class="ft-node"
          :class="{ 'is-current': !data.isDir && data.path === activePath, 'is-dir': data.isDir }"
          @click="onNodeClick(data)"
        >
          <el-icon class="ft-icon">
            <component :is="data.isDir ? (node.expanded ? ICONS.FolderOpened : ICONS.Folder) : iconComp(data)" />
          </el-icon>
          <span class="ft-name" :class="nodeNameClass(data)" :title="promptHint(data)">{{ data.name }}</span>

          <!-- 入口徽标（SKILL.md）+ 「直接喂 AI」说人话标注（组②）。 -->
          <span v-if="isEntryNode(data)" class="ft-entry-pill" :title="promptHint(data)">入口</span>

          <!-- .json 语法错 △ -->
          <span
            v-if="!data.isDir && jsonErrorMap[data.path]"
            class="ft-json-err"
            title="JSON 语法错误"
          >△</span>
          <!-- 未保存脏点 ● -->
          <span
            v-if="!data.isDir && dirtyMap[data.path]"
            class="ft-dirty"
            title="未保存"
          ></span>

          <!-- hover ⋯ 操作菜单（新建/移动/改名/删除）。只读态 v-if 不渲染。 -->
          <el-dropdown
            v-if="!readonly"
            class="ft-more"
            trigger="click"
            placement="bottom-end"
            @command="(cmd) => onMenuCommand(cmd, data)"
            @click.stop
          >
            <button
              type="button"
              class="ft-more-btn"
              title="更多操作"
              aria-label="更多操作"
              @click.stop
            >
              <el-icon><MoreFilled /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <!-- 目录节点：在此新建文件 / 子文件夹（深度上限 disabled）/ 移动到… / 重命名 / 删除 -->
                <template v-if="data.isDir">
                  <el-dropdown-item command="new-in-dir">在此新建文件</el-dropdown-item>
                  <el-tooltip
                    v-if="!canCreateSubfolder(data.path)"
                    content="已达最大目录深度（5 层）"
                    placement="left"
                    effect="dark"
                  >
                    <el-dropdown-item disabled command="new-subfolder">在此新建子文件夹</el-dropdown-item>
                  </el-tooltip>
                  <el-dropdown-item v-else command="new-subfolder">在此新建子文件夹</el-dropdown-item>
                  <el-dropdown-item command="move-to" divided>移动到…</el-dropdown-item>
                  <el-dropdown-item command="rename-folder">重命名文件夹</el-dropdown-item>
                  <el-dropdown-item command="delete-folder" class="more-del">删除文件夹</el-dropdown-item>
                </template>
                <!-- SKILL.md（入口·根锚点）：根级新建文件/文件夹；入口受保护——不含移动/重命名/删除。 -->
                <template v-else-if="isEntryNode(data)">
                  <el-dropdown-item command="new-root-file">新建文件</el-dropdown-item>
                  <el-dropdown-item command="new-root-folder">新建文件夹</el-dropdown-item>
                </template>
                <!-- 普通文件：同级新建 + 移动到… + 重命名 / 删除。 -->
                <template v-else>
                  <el-dropdown-item command="new-sibling-file">新建同级文件</el-dropdown-item>
                  <el-dropdown-item command="new-sibling-folder">新建同级文件夹</el-dropdown-item>
                  <el-dropdown-item command="move-to" divided>移动到…</el-dropdown-item>
                  <el-dropdown-item command="rename">重命名</el-dropdown-item>
                  <el-dropdown-item command="delete" class="more-del">删除</el-dropdown-item>
                </template>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </template>
    </el-tree>

    <!-- 底部仅「⬇ 导出压缩包」。只读态 v-if 不渲染。 -->
    <div v-if="!readonly" class="ft-foot">
      <button
        type="button"
        class="ft-foot-btn"
        :disabled="exporting || !skillId"
        @click="onExport"
      >
        <el-icon :class="{ 'is-spin': exporting }"><Download /></el-icon>
        {{ exporting ? '导出中…' : '导出压缩包' }}
      </button>
    </div>

    <!-- F9 「移动到…」目录选择器对话框 -->
    <el-dialog
      v-model="moveDialog.visible"
      title="移动到…"
      width="420px"
      append-to-body
      class="ft-move-dialog"
    >
      <div v-if="moveDialog.node" class="mv-head">
        移动「{{ moveDialog.node.name }}」到：<strong>{{ moveSelectedLabel }}</strong>
      </div>
      <!-- UI-P2 空态：无任何合法落点（如仅 SKILL.md / 当前已在根）→ 给空提示，不只剩灰节点。 -->
      <div v-if="!moveHasValidTarget" class="mv-empty">
        没有可移动到的其他目录，请先新建文件夹。
      </div>
      <div v-else class="mv-tree-wrap">
        <el-tree
          :data="moveTreeData"
          :props="moveTreeProps"
          node-key="path"
          default-expand-all
          :expand-on-click-node="false"
          :highlight-current="false"
        >
          <template #default="{ data }">
            <!-- 非法目标：整行 hover 即出原因 tooltip（可发现性，UI-CR）。合法目标无 tooltip。 -->
            <el-tooltip
              :disabled="!data.disabled || !data.reason"
              :content="data.reason"
              placement="right"
              effect="dark"
            >
              <div
                class="mv-node"
                :class="{
                  'is-disabled': data.disabled,
                  'is-picked': !data.disabled && data.path === moveDialog.selected,
                  'is-current': data.path === currentMoveDir
                }"
                @click="onMoveTreeClick(data)"
              >
                <el-icon class="mv-icon">
                  <component :is="data.isRoot ? ICONS.House : ICONS.Folder" />
                </el-icon>
                <span class="mv-name">{{ data.name }}</span>
                <span v-if="data.path === currentMoveDir" class="mv-tag">当前位置</span>
                <span v-else-if="data.disabled" class="mv-reason">不可选</span>
              </div>
            </el-tooltip>
          </template>
        </el-tree>
      </div>
      <template #footer>
        <el-button @click="moveDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="moveDialog.loading" @click="confirmMove">确认移动</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-soft);
  overflow: hidden;
}
.ft-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-soft);
}
.ft-head-title {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--c-text-muted);
}
/* 组③：查找/过滤框 */
.ft-search {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
}
.ft-search-box {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}
.ft-search-box:focus-within {
  border-color: var(--c-accent);
}
.ft-search-icon {
  flex-shrink: 0;
  color: var(--c-text-faint);
  font-size: 14px;
}
.ft-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--c-text);
  font-size: var(--fs-sm);
}
.ft-search-input::placeholder {
  color: var(--c-text-faint);
}
.ft-search-clear {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--c-text-faint);
  cursor: pointer;
  padding: 0;
}
.ft-search-clear:hover {
  color: var(--c-text);
}
.ft-search-modes {
  display: flex;
  gap: 4px;
}
.ft-mode {
  flex: 1;
  height: 24px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.ft-mode:hover {
  background: var(--bg-hover);
}
.ft-mode.on {
  border-color: var(--c-accent);
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
/* 内容查找结果面板 */
.ft-search-results {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-2);
}
.sr-state {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-4) var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.sr-state.sr-error {
  color: var(--c-danger);
}
.sr-state .is-spin {
  animation: ftSpin 0.9s linear infinite;
}
.sr-file {
  margin-bottom: var(--space-2);
}
.sr-file-head {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.sr-file-head:hover {
  background: var(--bg-hover);
}
.sr-file-icon {
  flex-shrink: 0;
  color: var(--c-text-faint);
  font-size: 14px;
}
.sr-file-name {
  font-size: var(--fs-sm);
  color: var(--c-text);
  font-weight: var(--fw-medium);
  flex-shrink: 0;
}
.sr-file-path {
  font-size: 10px;
  color: var(--c-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.sr-namehit {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  border-radius: var(--radius-pill);
  padding: 0 6px;
}
.sr-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 6px 3px 22px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.sr-line:hover {
  background: var(--bg-hover);
}
.sr-lineno {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--c-text-faint);
  min-width: 24px;
  text-align: right;
}
.sr-snippet {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sr-snippet :deep(.sr-hit) {
  background: var(--c-warning-soft);
  color: var(--c-text-strong);
  border-radius: 2px;
  padding: 0 1px;
}
.ft-empty-filter {
  padding: var(--space-4) var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.ft-loading {
  padding: var(--space-4);
}
.ft-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4);
  font-size: var(--fs-sm);
  color: var(--c-danger);
}
.ft-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-2);
  background: transparent;
}
/* 节点行（统一高 30px，圆角，hover/选中态） */
.ft-node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 30px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  overflow: hidden;
}
.ft-node.is-current {
  background: var(--bg-selected);
  box-shadow: inset 2px 0 0 var(--c-accent);
}
.ft-icon {
  flex-shrink: 0;
  color: var(--c-text-faint);
  font-size: 15px;
}
.ft-node.is-current .ft-icon {
  color: var(--c-accent);
}
.ft-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.ft-name.fn-mono {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}
.ft-name.fn-current {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
.ft-entry-pill {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 16px;
  font-size: 11px;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  border-radius: var(--radius-pill);
  padding: 0 6px;
}
.ft-dirty {
  flex-shrink: 0;
  align-self: center;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-warning);
}
.ft-json-err {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--c-danger);
  line-height: 1;
}
/* hover ⋯：默认隐藏，行 hover 才浮出（选中行常显） */
.ft-more {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.ft-node:hover .ft-more,
.ft-node.is-current .ft-more {
  opacity: 1;
}
.ft-more-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.ft-more-btn:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
/* 底部入口 */
.ft-foot {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2);
  border-top: 1px solid var(--border-soft);
}
.ft-foot-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px var(--space-2);
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  text-align: left;
}
.ft-foot-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--c-text);
}
.ft-foot-btn:disabled {
  color: var(--c-text-faint);
  cursor: not-allowed;
}
.ft-foot-btn .is-spin {
  animation: ftSpin 0.9s linear infinite;
}
@keyframes ftSpin {
  to {
    transform: rotate(360deg);
  }
}

/* el-tree 内置节点内容容器去默认 padding（缩进改由 .el-tree-node__children 承担，见下）。 */
.ft-tree :deep(.el-tree-node__content) {
  height: 32px;
  padding: 0 !important;
}
.ft-tree :deep(.el-tree-node__content > .ft-node) {
  flex: 1;
  min-width: 0;
}
/* ============================ 层级缩进 + Notion 风竖向引导线 ============================
   缩进模型改造（修复「层级太小/平铺」）：
   - EP 默认把缩进作内联 `padding-left:(level-1)*indent` 加在 .el-tree-node__content 上，
     但本组件自绘节点 + `padding:0 !important` 历史上把它盖掉了 → 各级几乎无台阶感。
   - 改为 `indent=0`（清掉内联 content 缩进），缩进与引导线统一由**子节点容器**
     `.el-tree-node__children` 的 padding-left 承担：因 __children 物理嵌套，padding 逐级累加，
     深层 3~5 级缩进自然可见；引导线用 border-left（语义令牌 --border-base ≈10%，作为「需被看见的
     结构引导线」比 --border-soft(6%) 在浅色多级时更清晰，仍远低于 --border-strong 不喧宾夺主；浅/暗双主题自适配）。
   - 每级缩进 21px（明显台阶感）；引导线贴该级左缘，与展开箭头同列。 */
.ft-tree :deep(.el-tree-node__children) {
  /* 整块右移 11px 使 border-left 落在「上层展开箭头」列（箭头 padding6+icon12，中心约 11~12px）；
     再 padding-left 9px 给内容台阶。子内容相对父级净右移 11+1+9 = 21px ≈ 一级缩进（明显台阶感）。
     因 __children 物理嵌套，逐级累加，深层缩进自然可见。 */
  margin-left: 11px;
  padding-left: 9px;
  border-left: 1px solid var(--border-base);
  box-sizing: border-box;
}
.ft-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: transparent;
}
.ft-tree :deep(.el-tree-node__content:hover) {
  background: transparent;
}
.ft-node:hover {
  background: var(--bg-hover);
}
.ft-node.is-current:hover {
  background: var(--bg-selected);
}
/* 拖拽落点高亮（el-tree 内置 .is-drop-inner 类，用语义令牌覆盖默认色，双主题适配） */
.ft-tree :deep(.el-tree-node.is-drop-inner > .el-tree-node__content) {
  background: var(--c-accent-soft);
  outline: 1px dashed var(--c-accent);
  outline-offset: -1px;
  border-radius: var(--radius-sm);
}
/* P3：隐藏同级排序横线（drop-indicator）——本期不支持同级手动排序（PRD §7 F13），
   留着会误导用户以为能排序；仅保留 inner 落点高亮。 */
.ft-tree :deep(.el-tree__drop-indicator) {
  display: none;
}
/* UI-CR：拖拽进行中（el-tree 会给 body 加 .is-dragging）非合法 inner 落点 → not-allowed 光标，
   合法落点（.is-drop-inner）恢复默认，给用户「这里能/不能放」的即时体感。 */
.ft-tree :deep(.is-dragging .el-tree-node__content) {
  cursor: not-allowed;
}
.ft-tree :deep(.is-dragging .el-tree-node.is-drop-inner > .el-tree-node__content) {
  cursor: default;
}

/* ============================ F9 「移动到…」目录选择器 ============================ */
.mv-head {
  margin-bottom: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.mv-head strong {
  color: var(--c-text-strong);
}
.mv-tree-wrap {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
}
.mv-node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.mv-node:hover:not(.is-disabled) {
  background: var(--bg-hover);
}
.mv-node.is-picked {
  background: var(--bg-selected);
  box-shadow: inset 2px 0 0 var(--c-accent);
}
/* 当前所在目录默认高亮（AC-F1）：弱底 + 「当前位置」标签；它本身是非法落点，须改选别处才能确认。 */
.mv-node.is-current:not(.is-picked) {
  background: var(--bg-hover);
}
.mv-node.is-disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.mv-icon {
  flex-shrink: 0;
  color: var(--c-text-faint);
  font-size: 15px;
}
.mv-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.mv-reason {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
/* 「当前位置」标签（区分默认高亮的当前目录） */
.mv-tag {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 6px;
  font-size: 11px;
  color: var(--c-text-muted);
  background: var(--bg-hover);
  border-radius: var(--radius-pill);
}
/* UI-P2 空态提示 */
.mv-empty {
  padding: var(--space-4) var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  text-align: center;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-sm);
}
.ft-move-dialog :deep(.el-dialog__body) {
  padding-top: var(--space-2);
}
</style>
