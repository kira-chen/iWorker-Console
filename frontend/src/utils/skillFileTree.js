/**
 * 技能包目录树 —— 纯逻辑工具（无 Vue / 无 DOM，便于单测）。交互稿 §2/§3 + 架构 §7.8。
 *
 * 覆盖：
 * - 扁平 files[] → el-tree 嵌套节点（目录节点前端合成、无后端行、不可保存，node-key=path）；
 * - SKILL.md 恒置顶 + 目录在同级文件之前 + 同级字典序（§2.1 排序）；
 * - 文件名/路径本地校验（扩展名白名单、path 合法、新建重名硬拦 P0-1、改名冲突/改为 SKILL.md 拒 P1）；
 * - Q3 平台重审判定（仅 source=platform 且 PUBLISHED；以后端真实回吐为准的 before/after 比对）；
 * - Q2 删 .md 工具白名单 diff。
 */

import { markRaw } from 'vue'

export const ENTRY_PATH = 'SKILL.md'
// 可在线编辑的文本扩展名白名单（小写，与后端 skill.package.editable-extensions 对齐，完整保真 2026-07-29）。
// 仅约束「在线新建/编辑」——只能建/改这些文本类型；其余（脚本/数据/二进制）经 zip 导入落库、只读可下载。
export const ALLOWED_EXTENSIONS = ['md', 'markdown', 'txt', 'json', 'yaml', 'yml']
// 路径最大层级默认值（含根 SKILL.md；与后端 skill.package.max-path-depth 默认一致，2026-08-04 放宽 6→15）。
export const DEFAULT_MAX_PATH_DEPTH = 15
// 生效上限（模块级状态）：进入编辑器后由「列文件树」响应 limits.maxPathDepth 刷新（setSkillPackageLimits）——
// 后端配置调大调小前端即时适配、无需发版；默认值仅作树响应未携带 limits 时的兜底。后端校验为最终权威。
let maxPathDepth = DEFAULT_MAX_PATH_DEPTH

// 当前生效的路径层级上限（即时预判/提示文案用）。
export function getMaxPathDepth() {
  return maxPathDepth
}

// 应用后端下发的技能包上限（列文件树响应 limits 字段：{ maxFiles, maxPathDepth }）。
// 仅取合法正整数，缺省/非法保持现值（老后端响应无 limits 时不破坏兜底）。文件数上限前端无本地预判，超限由后端 message 兜底。
export function setSkillPackageLimits(limits) {
  const d = Number(limits?.maxPathDepth)
  if (Number.isInteger(d) && d >= 1) maxPathDepth = d
}

/* ============================ 文件类型 / 图标 ============================ */

// 由 path 末段取扩展名（小写，无点）。
export function extOf(path) {
  const name = String(path || '').split('/').pop() || ''
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

// 文件类型 → EP 图标名（交互稿 §2.2 + 完整保真 2026-07-29 增二进制类型）：
// md→Document，json→DataLine，txt/yaml→Memo，图片→Picture，脚本/数据/二进制→Files；其余回落 Document。
export function fileIconName(fileType) {
  const t = String(fileType || '').toLowerCase()
  switch (t) {
    case 'json':
      return 'DataLine'
    case 'txt':
    case 'yaml':
    case 'yml':
      return 'Memo'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'bmp':
    case 'ico':
      return 'Picture'
    case 'md':
    case 'markdown':
      return 'Document'
    default:
      // 脚本/数据/压缩/文档等非文本二进制：统一用 Files（与可编辑文本的 Document 区分）。
      return isBinaryType(t) ? 'Files' : 'Document'
  }
}

// 是否为「非可编辑」类型（据 ALLOWED_EXTENSIONS 反推；供图标区分文本/二进制）。空扩展名按二进制处理。
export function isBinaryType(fileType) {
  const t = String(fileType || '').toLowerCase()
  return t !== 'dir' && !ALLOWED_EXTENSIONS.includes(t)
}

// json/txt 用等宽字体弱区分（交互稿 §2.2）；md / 目录用常规字体。
export function isMonoType(fileType) {
  const t = String(fileType || '').toLowerCase()
  return t === 'json' || t === 'txt'
}

/* ============================ 构树（扁平 files[] → 嵌套节点） ============================ */

/**
 * 把后端扁平 files[] 按 path 的 / 分段在内存合成目录中间节点。
 *
 * 后端两类行（架构 §3.4）：
 *  - 文件行（isDir=false）：叶子文件，按 path 分段；其经过的中间目录段按 path 合成目录节点；
 *  - 目录占位行（isDir=true）：持久化的空目录（含 SKILL.md 入口除外）。注入为目录节点。
 * 同 path 去重：占位目录若已因含文件被合成（livePrefix），忽略占位行（避免重复节点）。
 * 目录节点：isDir=true、path = 目录前缀（无尾斜杠）、仅展示/展开（不载编辑器）。
 *
 * 排序（§2.1）：
 *  - SKILL.md（isEntry / sortOrder=-1）恒置顶；
 *  - 同级内：目录排在文件之前（IDE 习惯）；
 *  - 其余按 name 字典序。
 *
 * @param {Array<{path,name,fileType,isEntry,isDir,size,sortOrder}>} files
 * @returns {Array} el-tree data（节点含 { path,name,fileType,isEntry,isDir,size,children? }）
 */
export function buildFileTree(files) {
  const list = Array.isArray(files) ? files : []
  const root = { children: [], _map: new Map() }

  // 取/补建一个目录节点（沿 segs 下钻到 dirPrefix 对应层级），返回该目录的容器 { node, parentLevel }。
  // 中间缺失目录段自动合成（无占位行的"有文件目录"走此）。
  function ensureDir(segs) {
    let cur = root
    let prefix = ''
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      prefix = prefix ? `${prefix}/${seg}` : seg
      let dir = cur._map.get(seg)
      if (!dir) {
        dir = { path: prefix, name: seg, isDir: true, children: [], _map: new Map() }
        cur._map.set(seg, dir)
        cur.children.push(dir)
      }
      cur = dir
    }
    return cur
  }

  // 先处理文件行（合成"有文件的目录"）；目录占位行后处理（同 path 已存在则去重）。
  const dirRows = []
  for (const f of list) {
    const path = String(f?.path || '')
    if (!path) continue
    if (f?.isDir) {
      dirRows.push(f)
      continue
    }
    const segs = path.split('/').filter(Boolean)
    const parent = segs.length > 1 ? ensureDir(segs.slice(0, -1)) : root
    parent.children.push({
      path,
      name: f.name || segs[segs.length - 1],
      fileType: (f.fileType || extOf(path) || 'md').toLowerCase(),
      isEntry: !!f.isEntry,
      isDir: false,
      size: f.size || 0,
      sortOrder: typeof f.sortOrder === 'number' ? f.sortOrder : 0
    })
  }
  // 注入持久化空目录占位行：ensureDir 幂等，若该 path 已因含文件合成则复用（自然去重）。
  for (const d of dirRows) {
    const segs = String(d.path).split('/').filter(Boolean)
    if (segs.length) ensureDir(segs)
  }

  return sortNodes(root.children)
}

function sortNodes(nodes) {
  const out = nodes.map((n) => {
    if (n.isDir) {
      const { _map, ...rest } = n
      // H2 性能（批次一）：树节点是只读展示数据，免 Vue 深度响应式代理开销（大包/多节点时显著）。
      // BUG-P0-001 修复：**用 markRaw 而非 Object.freeze**——Object.freeze 使对象不可扩展，
      // 但 el-tree 内部要给每个节点写私有属性 $treeNodeId → 抛 "object is not extensible" 整页崩。
      // markRaw 仅打「不做响应式代理」标记、对象仍可扩展，既保留免响应化收益、又让 el-tree 能写其私有属性。
      return markRaw({ ...rest, children: sortNodes(n.children) })
    }
    // 叶子文件节点同样 markRaw（免深响应化；可扩展，el-tree 可写 $treeNodeId）。
    return markRaw(n)
  })
  out.sort(compareNode)
  return out
}

function compareNode(a, b) {
  // SKILL.md / entry 恒置顶
  const aEntry = !a.isDir && (a.isEntry || a.path === ENTRY_PATH)
  const bEntry = !b.isDir && (b.isEntry || b.path === ENTRY_PATH)
  if (aEntry !== bEntry) return aEntry ? -1 : 1
  // 目录在同级文件之前
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  // 同级字典序（name）
  return String(a.name).localeCompare(String(b.name))
}

// 树内全部文件 path 集合（含 SKILL.md）—— 重名预判用。
export function collectFilePaths(files) {
  return (Array.isArray(files) ? files : []).map((f) => String(f?.path || '')).filter(Boolean)
}

/* ============================ 文件名 / 路径本地校验 ============================ */

/**
 * 校验「新建文件」的 path（交互稿 §3.2 inputValidator）。返回错误文案 or null（通过）。
 *
 * P0-1 安全红线：本地重名预判是硬拦截、不可降级——后端 PUT 是静默 upsert（覆盖、无 409），
 * 放任同名会静默覆盖丢数据，故重名命中必须阻止提交。
 *
 * @param {string} input 用户输入的相对 path（可含目录段，如 references/policy.md）
 * @param {string[]} existingPaths 树内现有 path（含 SKILL.md）
 */
export function validateNewFilePath(input, existingPaths = []) {
  const path = normalizeInputPath(input)
  // 1) 非空
  if (!path) return '请输入文件名'
  // 2) 扩展名白名单（小写）
  const extErr = validateExtension(input)
  if (extErr) return extErr
  // 3) path 合法
  const pathErr = validatePathShape(path)
  if (pathErr) return pathErr
  // 4) P0-1 硬拦截：本地重名预判（与现有 path 比对，含 SKILL.md）
  if (existingPaths.includes(path)) return '该文件已存在，换个名字'
  return null
}

/**
 * 校验「重命名/移动」的 toPath（交互稿 §3.3 inputValidator）。返回错误文案 or null。
 *
 * @param {string} input 目标 path
 * @param {string} fromPath 原 path（排除自身冲突）
 * @param {string[]} existingPaths 树内现有 path
 */
export function validateRenamePath(input, fromPath, existingPaths = []) {
  const toPath = normalizeInputPath(input)
  if (!toPath) return '请输入文件名'
  const extErr = validateExtension(input)
  if (extErr) return extErr
  const pathErr = validatePathShape(toPath)
  if (pathErr) return pathErr
  // 名称未改变 → 提示（调用方可据此静默关闭不发请求）
  if (toPath === fromPath) return '名称未改变'
  // P1：不可改为入口文件名 SKILL.md（后端也 400，本地早拦给即时红字）
  if (toPath === ENTRY_PATH) return `不能重命名为入口文件名 ${ENTRY_PATH}`
  // 与他人冲突（排除自身）→ 对应后端 409，本地早拦
  if (existingPaths.filter((p) => p !== fromPath).includes(toPath)) {
    return '目标名称已存在，换个名字'
  }
  return null
}

// 归一输入 path：trim + 反斜杠转正斜杠（不剔除其它，校验交给 validatePathShape）。
export function normalizeInputPath(input) {
  return String(input || '').trim().replace(/\\/g, '/')
}

/* ============================ #5 点击式层级管理：只输叶子名 + 文件夹操作 ============================ */

// 拼接目录前缀 + 叶子名（dirPrefix 为 '' → 根级，结果即叶子名）。
export function joinPath(dirPrefix, leaf) {
  const d = String(dirPrefix || '').replace(/\/+$/, '')
  const l = String(leaf || '')
  return d ? `${d}/${l}` : l
}

// 目录前缀的层级（段数）：'' → 0（根）；'references' → 1；'a/b' → 2。
export function dirDepth(dirPrefix) {
  const d = String(dirPrefix || '').replace(/^\/+|\/+$/g, '')
  return d ? d.split('/').filter(Boolean).length : 0
}

// 在 dirDepth 层目录下「新建子文件夹」后，该子目录里再放文件的最浅 path 段数 = dirDepth + 2（子目录段 + 文件段）。
// 深度 ≤ 生效上限（含根文件第 1 层）。故允许新建子文件夹的条件：dirDepth + 2 ≤ maxPathDepth。
export function canCreateSubfolder(dirPrefix) {
  return dirDepth(dirPrefix) + 2 <= maxPathDepth
}

/**
 * 校验「只输叶子名」新建文件（#5 §3 核心：不输路径，path 由 dirPrefix 在前端拼）。返回错误文案 or null。
 * - 不含 /（含 / → 提示用「新建子文件夹」建层级，杜绝手打路径回潮）；
 * - 扩展名白名单；非法字符；
 * - P0-1 本地重名硬拦（join(dirPrefix, name) 与现有 path 比对，防静默覆盖）；
 * - 深度（join 后段数 ≤ 生效层级上限 maxPathDepth）。
 *
 * @param {string} name 叶子文件名（不含 /）
 * @param {string} dirPrefix 目标目录前缀（'' = 根）
 * @param {string[]} existingPaths 现有 path 集合
 */
export function validateLeafFileName(name, dirPrefix, existingPaths = []) {
  const n = String(name || '').trim()
  if (!n) return '请输入文件名'
  if (n.includes('/')) return '文件名不能含 /，用「新建子文件夹」建层级'
  const extErr = validateExtension(n)
  if (extErr) return extErr
  if (n === '.' || n === '..') return '文件名不合法'
  // 非法字符：控制字符（\x00-\x1f）+ Windows 保留字符 < > : " | ? *（不含 . 等正常文件名字符）。
  if (/[\x00-\x1f<>:"|?*]/.test(n)) return '文件名含非法字符'
  const full = joinPath(dirPrefix, n)
  if (full.split('/').length > maxPathDepth) return `最多 ${maxPathDepth} 层（含根 SKILL.md）`
  if (existingPaths.includes(full)) return '该文件已存在，换个名字'
  return null
}

/**
 * 校验「只输叶子名」文件夹名（新建文件夹 / 在此新建子文件夹 / 重命名文件夹）。返回错误文案 or null。
 * - 单段（不含 /）、非空、无 . / ..、无非法字符；
 * - 同级无重名（siblingNames 须含同级目录名 + 同级文件末段名——后端目录/文件同命名空间会 409；
 *   重命名时排除自身 selfName）。
 *
 * @param {string} name 文件夹名（单段，不含 /）
 * @param {string[]} siblingNames 同级已占用名（目录名 + 文件末段名）
 * @param {string} [selfName] 重命名时的原名（排除自身）
 */
export function validateFolderName(name, siblingNames = [], selfName = null) {
  const n = String(name || '').trim()
  if (!n) return '请输入文件夹名'
  if (n.includes('/')) return '文件夹名不能含 /'
  if (n === '.' || n === '..') return '文件夹名不合法'
  if (/[\x00-\x1f<>:"|?*]/.test(n)) return '文件夹名含非法字符'
  if (selfName != null && n === selfName) return '名称未改变'
  if ((siblingNames || []).filter((s) => s !== selfName).includes(n)) return '同级已有同名文件或文件夹'
  return null
}

/**
 * 收集某目录前缀下的全部文件 path（含深层子目录），供文件夹重命名/删除级联。
 * @param {string[]} existingPaths 现有全部文件 path
 * @param {string} dirPrefix 目录前缀（如 'references' / 'a/b'）
 * @returns {string[]} 该目录下（含子孙）的文件 path
 */
export function collectDirFiles(existingPaths, dirPrefix) {
  const d = String(dirPrefix || '').replace(/^\/+|\/+$/g, '')
  if (!d) return []
  const pfx = d + '/'
  return (Array.isArray(existingPaths) ? existingPaths : []).filter((p) => String(p).startsWith(pfx))
}

/**
 * 文件夹重命名级联：把某文件 path 里的目录前缀段 fromDir 改为 toDir，得新 path。
 * 仅替换前缀（fromDir + '/'）一次。
 * @param {string} filePath 原文件 path
 * @param {string} fromDir 原目录前缀
 * @param {string} toDir 新目录前缀
 * @returns {string} 新 path
 */
export function renameDirInPath(filePath, fromDir, toDir) {
  const fp = String(filePath || '')
  const from = String(fromDir || '').replace(/^\/+|\/+$/g, '')
  const to = String(toDir || '').replace(/^\/+|\/+$/g, '')
  if (!from) return fp
  if (fp === from) return to // 理论不会（目录非文件），防御
  if (fp.startsWith(from + '/')) return to + fp.slice(from.length)
  return fp
}

// 取某文件 path 的所在目录前缀（'references/policy.md' → 'references'；根级文件 → ''）。
export function parentDirOf(filePath) {
  const fp = String(filePath || '')
  const i = fp.lastIndexOf('/')
  return i >= 0 ? fp.slice(0, i) : ''
}

/* ============================ 移动（拖拽 / 「移动到…」）落点本地预判（架构 §6，后端为权威） ============================ */

/**
 * 收集树内全部目录前缀（含子孙）：文件 path 经过的中间目录 + 持久化空目录占位行。
 * 供「移动到…」目录选择器、同级查重、循环移动判断。
 * @param {Array<{path,isDir}>} files 后端扁平 files[]（含占位行）
 * @returns {string[]} 去重后的目录前缀（无尾斜杠），不含根 ''
 */
export function collectAllDirs(files) {
  const dirs = new Set()
  for (const f of Array.isArray(files) ? files : []) {
    const path = String(f?.path || '')
    if (!path) continue
    if (f?.isDir) {
      dirs.add(path) // 占位空目录本身即一个目录
      continue
    }
    const segs = path.split('/')
    for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/'))
  }
  return [...dirs]
}

// 取某 path 的末段名（'a/b/c' → 'c'；'x.md' → 'x.md'）。
export function lastSegOf(path) {
  const p = String(path || '')
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

// path 的层级（段数，含根第 1 层）：'SKILL.md' → 1；'a/b.md' → 2。
export function pathDepth(path) {
  const p = String(path || '').replace(/^\/+|\/+$/g, '')
  return p ? p.split('/').filter(Boolean).length : 0
}

/**
 * 某目录子树内最深叶子（文件 path / 占位空目录）的层级。
 * 用于移动文件夹后的整子树深度预判（架构 §5：移动后整子树最深叶子段数 ≤ 生效层级上限 maxPathDepth）。
 * @param {string} dir 目录前缀
 * @param {Array<{path,isDir}>} files 后端扁平 files[]
 * @returns {number} 子树内最大 path 层级（含 dir 自身层级；空目录至少为 dir 自身层级）
 */
export function maxDepthInSubtree(dir, files) {
  const d = String(dir || '').replace(/^\/+|\/+$/g, '')
  if (!d) return 0
  const pfx = d + '/'
  let max = pathDepth(d)
  for (const f of Array.isArray(files) ? files : []) {
    const path = String(f?.path || '')
    if (path === d || path.startsWith(pfx)) {
      const dep = pathDepth(path)
      if (dep > max) max = dep
    }
  }
  return max
}

/**
 * 为「同一个被移动对象、对多个候选目标」批量校验预算一次共享上下文（H5 性能批次一）。
 * validateMoveTarget 原本每次调用都重扫 files 得 allPaths/allDirs + maxDepthInSubtree，
 * 在 moveTreeData 递归 disabled 计算里 O(目录数²)。把「只依赖 files 与被移动对象、不依赖目标」的量
 * 预算一次，注入 validateMoveTarget 复用（保持纯函数：不传则内部自算，行为等价）。
 *
 * @param {string} fromPath 被移动对象 path
 * @param {boolean} isDir 是否目录
 * @param {Array<{path,isDir}>} files 后端扁平 files[]
 * @returns {{ allPaths:Set<string>, allDirs:Set<string>, fromSubtreeMaxDepth:number }}
 */
export function buildMoveContext(fromPath, isDir, files) {
  const list = Array.isArray(files) ? files : []
  const allPaths = new Set(list.map((f) => String(f?.path || '')))
  const allDirs = new Set(collectAllDirs(list))
  const from = String(fromPath || '').replace(/^\/+|\/+$/g, '')
  // 仅目录需子树最深层级（文件用单 path 深度，无需）。
  const fromSubtreeMaxDepth = isDir ? maxDepthInSubtree(from, list) : 0
  return { allPaths, allDirs, fromSubtreeMaxDepth }
}

/**
 * 移动「文件或文件夹」到目标父目录的落点合法性本地预判（PRD §5.4 落点矩阵 / §5.2 深度 / §5.3 重名）。
 * 即时给红字/置灰用；后端为最终权威（后端拒绝按 warnings/错误码回滚）。
 *
 * @param {Object} opt
 * @param {string} opt.fromPath 被移动对象 path（文件 path 或目录前缀）
 * @param {boolean} opt.isDir 被移动对象是否目录
 * @param {string} opt.toParentDir 目标父目录前缀（'' = 根）
 * @param {Array<{path,isDir}>} opt.files 后端扁平 files[]（含占位行）
 * @param {{allPaths:Set,allDirs:Set,fromSubtreeMaxDepth:number}} [opt.ctx] 可选预算上下文（buildMoveContext 产出）。
 *        传入则复用（批量校验省 O(n) 重扫）；不传则内部自算（保持纯函数、行为等价）。
 * @returns {string|null} 非法原因文案；null = 合法落点
 */
export function validateMoveTarget({ fromPath, isDir, toParentDir, files, ctx }) {
  const from = String(fromPath || '').replace(/^\/+|\/+$/g, '')
  const toParent = String(toParentDir || '').replace(/^\/+|\/+$/g, '')
  if (!from) return '无效的移动对象'

  // 1) SKILL.md / entry 不可移动（PRD §5.1）。
  if (!isDir && (from === ENTRY_PATH)) return `入口文件 ${ENTRY_PATH} 不可移动`

  const leaf = lastSegOf(from)
  const fromParent = parentDirOf(from)

  // 2) 无意义移动（落点 == 当前所在目录）→ 视为无操作。
  if (toParent === fromParent) return '已在该目录中'

  // 3) 不可把文件移动/命名为入口名 SKILL.md（PRD §5.1 / §6）。
  if (!isDir && leaf === ENTRY_PATH) return `不能命名为入口文件名 ${ENTRY_PATH}`

  // 4) 循环移动（文件夹拖进自身或其子孙，PRD §5.4 / §6）。
  if (isDir) {
    if (toParent === from || toParent.startsWith(from + '/')) {
      return '不能把文件夹移动到它自己或它的子目录里'
    }
  }

  const toPath = toParent ? `${toParent}/${leaf}` : leaf

  // 5) 目标同级重名（同名文件 / 同名子夹，PRD §5.3）。复用预算上下文（无则自算，等价）。
  const allPaths = ctx?.allPaths || new Set((Array.isArray(files) ? files : []).map((f) => String(f?.path || '')))
  const allDirs = ctx?.allDirs || new Set(collectAllDirs(files))
  if (isDir) {
    if (allDirs.has(toPath)) return '目标位置已存在同名文件夹'
    if (allPaths.has(toPath)) return '目标位置已存在同名文件'
  } else {
    if (allPaths.has(toPath)) return '该位置已存在同名文件，移动取消'
    if (allDirs.has(toPath)) return '目标位置已存在同名文件夹'
  }

  // 6) 超深度（PRD §5.2 / 架构 §5）：移动后整子树最深叶子层级 ≤ 生效层级上限 maxPathDepth。
  //    文件：新 path 层级；文件夹：子树相对深度 + 目标父目录层级 + 1（目录自身）。
  let resultDepth
  if (isDir) {
    const subtreeMax = ctx?.fromSubtreeMaxDepth ?? maxDepthInSubtree(from, files)
    const subtreeRel = subtreeMax - pathDepth(from) // 子树相对深度（叶子 - 目录自身层）
    resultDepth = pathDepth(toParent) + 1 + subtreeRel
  } else {
    resultDepth = pathDepth(toPath)
  }
  if (resultDepth > maxPathDepth) return `已达最大目录深度（${maxPathDepth} 层）`

  return null
}

// 扩展名白名单校验（区分大写提示）。返回错误文案 or null。
function validateExtension(input) {
  const name = normalizeInputPath(input).split('/').pop() || ''
  const i = name.lastIndexOf('.')
  if (i < 0) return `仅支持 ${ALLOWED_EXTENSIONS.map((e) => '.' + e).join(' / ')} 文件`
  const rawExt = name.slice(i + 1)
  if (!rawExt) return `仅支持 ${ALLOWED_EXTENSIONS.map((e) => '.' + e).join(' / ')} 文件`
  // 大写扩展名（如 .MD）单独提示「扩展名需小写」，比笼统「不支持」更可操作。
  if (rawExt !== rawExt.toLowerCase()) return '扩展名需小写'
  if (!ALLOWED_EXTENSIONS.includes(rawExt.toLowerCase())) {
    return `仅支持 ${ALLOWED_EXTENSIONS.map((e) => '.' + e).join(' / ')} 文件`
  }
  return null
}

// path 形态校验：无前导 /、无 .. 段、无连续 //、无非法字符。返回错误文案 or null。
// 深度/长度数值上限不前端硬编码（P0-2），由后端 message 兜底。
function validatePathShape(path) {
  if (path.startsWith('/')) return '文件名不能以 / 开头'
  if (path.includes('//')) return '路径不能含连续的 /'
  const segs = path.split('/')
  for (const seg of segs) {
    if (!seg) return '文件名/路径不合法'
    if (seg === '.' || seg === '..') return '路径不能含 . 或 ..'
  }
  // 深度预判（§13.1.2）：段数 = count('/')+1，根文件=第 1 层；超生效上限即时红字（与后端口径一致）。
  if (segs.length > maxPathDepth) return `最多 ${maxPathDepth} 层（含根 SKILL.md）`
  // 非法字符：控制字符 / Windows 保留字符（除 / 已作分隔）
  if (/[\x00-\x1f<>:"|?*]/.test(path)) return '文件名/路径含非法字符'
  return null
}

/* ============================ Q2 删 .md 工具白名单 diff ============================ */

/**
 * 删 .md 后，比对后端回吐 referencedTools 与删前快照，得「被移出运行时白名单」的工具（交互稿 §3.4）。
 * 仅按 code 比对集合差，返回被移出的工具展示项（保留 bizName 供文案）。
 *
 * @param {Array<{code,bizName}>} before 删前 referencedTools
 * @param {Array<{code,bizName}>} after  删后回吐 referencedTools
 * @returns {Array<{code,bizName}>} 被移出的工具（after 中已不存在的 before 项）
 */
export function diffRemovedTools(before, after) {
  const afterCodes = new Set((Array.isArray(after) ? after : []).map((t) => t?.code))
  return (Array.isArray(before) ? before : []).filter((t) => t?.code && !afterCodes.has(t.code))
}

/* ============================ Q3 平台已发布技能重审可见性 ============================ */

/**
 * 某技能当前是否处于「已发布」态（Q3 硬前置条件之一）。
 * publications:[{target,status}]，任一 target status=PUBLISHED 即视为已发布（交互稿 §4.6）。
 */
export function isPublished(publications) {
  return (Array.isArray(publications) ? publications : []).some((p) => p?.status === 'PUBLISHED')
}

/**
 * Q3 重审判定（R1 语义升级）：操作成功后，比对操作前后的 publications，是否「确有发布行因本次内容
 * 改动被置脏 / 在途提交被作废」。R1 起编辑已发布技能<b>不再打回 PENDING_REVIEW</b>（线上继续供旧快照），
 * 后端改为置 reviewPending=true / 作废提交（submitted 变 false），提示条据此挂出。
 *
 * 触发硬条件（缺一不可，绝不靠前端猜，交互稿 §4.6）：
 *  - source=platform（调用方传入保证）；
 *  - 操作后后端真实回吐以下任一变化：
 *      a) 某 target 由干净变置脏（reviewPending false→true）；
 *      b) 某 target 在途提交被作废（submitted true→false，状态不变）；
 *      c) 兼容旧后端：PUBLISHED→PENDING_REVIEW 退回。
 *
 * 以后端真实回吐为准：before/after 均来自后端 publications，前端只做集合比对、不推断。
 *
 * @param {Array<{target,status,reviewPending,submitted}>} before 操作前 publications
 * @param {Array<{target,status,reviewPending,submitted}>} after  操作后（重新拉详情）publications
 * @returns {boolean} 是否确有置脏/提交作废/退回
 */
export function didRequeueForReview(before, after) {
  const beforeMap = mapByTarget(before)
  const afterMap = mapByTarget(after)
  for (const [target, b] of Object.entries(beforeMap)) {
    const a = afterMap[target]
    if (!a) continue
    // a) 干净 → 置脏（R1 主路径：编辑已发布/已下架技能）
    if (b.reviewPending !== true && a.reviewPending === true) return true
    // b) 在途提交被作废（submitted 缺省视为已提交，与后端存量遗留口径一致）
    if (b.submitted !== false && a.submitted === false) return true
    // c) 兼容旧后端行为：PUBLISHED → PENDING_REVIEW 退回
    if (b.status === 'PUBLISHED' && a.status === 'PENDING_REVIEW') return true
  }
  return false
}

function mapByTarget(publications) {
  const map = {}
  for (const p of Array.isArray(publications) ? publications : []) {
    if (p?.target) map[p.target] = p
  }
  return map
}

// 操作是否「可能触发重审」= 是否针对 .md（含 SKILL.md）。.json/.txt 不触发（架构 §5.2）。
// 用于决定是否需要在操作后重新拉详情比对（避免对 .json/.txt 做无谓往返）。
export function isMdPath(path) {
  return extOf(path) === 'md'
}

/* ============================ SKILL.md YAML frontmatter 拆分 / 拼回（P3） ============================ */

const FENCE = '---'

/**
 * 拆分 SKILL.md 的开头 YAML frontmatter（严格首块）为 { hasFrontmatter, frontmatter(raw,不含 --- 围栏), body }。
 *
 * 口径与后端 SkillFrontmatterSupport.parse 对齐（首个非空行须是 ---；找闭合 ---；无闭合→不视为 frontmatter）。
 * 仅对 entry SKILL.md 调用：把 frontmatter 从正文剥离，使其不再被 Milkdown 当正文渲染（P3 根因）。
 *
 * @param {string} skillMd
 * @returns {{ hasFrontmatter:boolean, frontmatter:string, body:string }}
 */
export function splitFrontmatter(skillMd) {
  const text = stripBom(String(skillMd ?? ''))
  const lines = text.split('\n')
  // §12.8 修复：容忍前导空行——「首个非空行是 ---」即识别为 frontmatter 首块（不再要求严格第 0 行）。
  // 与后端 normalize 口径一致。正文中间的 --- 分隔线不会误判：其前面必有非空内容，firstNonEmpty 不会指向它。
  let firstNonEmpty = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      firstNonEmpty = i
      break
    }
  }
  if (firstNonEmpty < 0 || lines[firstNonEmpty].trim() !== FENCE) {
    return { hasFrontmatter: false, frontmatter: '', body: String(skillMd ?? '') }
  }
  // 闭合 --- 从 frontmatter 起始行之后找起。
  let closeIdx = -1
  for (let i = firstNonEmpty + 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      closeIdx = i
      break
    }
  }
  if (closeIdx < 0) {
    // 【#6 修复 · 未闭合 frontmatter 兜底】内容以 --- 开头但无闭合 ---：作者显然意图写 frontmatter 却漏了闭合，
    // 若整文喂 Milkdown 则起始 --- 后的 `key: value` 行会被当正文渲染（用户实测「name: x 显示成正文」）。
    // 兜底：把开头 --- 之后「连续 YAML 风格行（key: value / 列表项 / 缩进续行）」当 frontmatter 剥离，
    // 直到首个空行或首个明显正文行（如 # 标题）为止；其余作 body。保存时 joinFrontmatter 会补回闭合 ---（顺带修复）。
    let fmEnd = firstNonEmpty
    for (let i = firstNonEmpty + 1; i < lines.length; i++) {
      const raw = lines[i]
      const t = raw.trim()
      if (t === '') break
      const isYamlish = /^[A-Za-z0-9_-]+\s*:/.test(t) || t.startsWith('- ') || t === '-' || /^\s/.test(raw)
      if (!isYamlish) break
      fmEnd = i
    }
    if (fmEnd > firstNonEmpty) {
      const frontmatter = lines.slice(firstNonEmpty + 1, fmEnd + 1).join('\n')
      const body = lines
        .slice(fmEnd + 1)
        .join('\n')
        .replace(/^\n+/, '')
      return { hasFrontmatter: true, frontmatter, body }
    }
    // 开头 --- 后紧跟正文（无 YAML 行）→ 不视为 frontmatter（lone --- 是 hr/正文），整文作 body。
    return { hasFrontmatter: false, frontmatter: '', body: String(skillMd ?? '') }
  }
  const frontmatter = lines.slice(firstNonEmpty + 1, closeIdx).join('\n')
  const body = lines.slice(closeIdx + 1).join('\n')
  return { hasFrontmatter: true, frontmatter, body }
}

/**
 * 检测 frontmatter 内疑似「裸 --- 行」导致的边界误判（backlog · 组④补强）。
 *
 * splitFrontmatter / 后端 SkillFrontmatterSupport.parse 都以「开头 --- 之后**首个** --- 行」作闭合。
 * 若作者在 frontmatter 内容里写了一行裸 `---`（如多文档分隔 / 误打），首个 --- 会被当闭合 → frontmatter 被
 * 提前截断、其后本属 frontmatter 的内容被当正文渲染并喂模型，污染 SOP。后端是最终真相，前端只软提示。
 *
 * 启发式（保守，宁可漏报不误报）：仅当——
 *  ① 确有 frontmatter（开头 --- + 找到闭合 ---）；
 *  ② 紧随该闭合 --- 之后、首个非空 body 行**仍像 YAML 键值**（`key: ...`）——
 * 才判为「疑似裸 --- 提前闭合」。正常情况下 body 第一行是正文（标题/段落/列表/空），不像 `key:`。
 *
 * @param {string} skillMd 完整 SKILL.md（含 frontmatter+body）
 * @returns {{ line:number, message:string } | null} 检出 → 提示（line=裸 --- 行号，1-based）；否则 null
 */
export function detectFrontmatterBareSeparator(skillMd) {
  const text = stripBom(String(skillMd ?? ''))
  const lines = text.split('\n')
  let firstNonEmpty = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      firstNonEmpty = i
      break
    }
  }
  if (firstNonEmpty < 0 || lines[firstNonEmpty].trim() !== FENCE) return null
  let closeIdx = -1
  for (let i = firstNonEmpty + 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      closeIdx = i
      break
    }
  }
  if (closeIdx < 0) return null // 无闭合 → 由 splitFrontmatter 的未闭合兜底处理，非本场景
  // 闭合之后首个非空 body 行。
  let bodyFirst = -1
  for (let i = closeIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      bodyFirst = i
      break
    }
  }
  if (bodyFirst < 0) return null // 闭合后无正文 → 边界无歧义
  const t = lines[bodyFirst].trim()
  // body 第一行仍像 YAML 键值（key: ...，键名为常见标识符）→ 疑似 frontmatter 被裸 --- 提前截断。
  // 排除正文里合法的 markdown（标题 #、列表 -、引用 > 等不会命中此正则）。
  if (/^[A-Za-z_][A-Za-z0-9_-]*\s*:(\s|$)/.test(t)) {
    return {
      line: closeIdx + 1,
      message:
        '基本信息里似乎有一行单独的「---」，它会被当成结束标记，导致后面的内容被当正文喂给 AI。' +
        '请删掉多余的「---」，或把它放进引号里（如 sep: "---"）。'
    }
  }
  return null
}

/**
 * 【#6 修复 · 未闭合代码围栏兜底】修复 markdown 里**未闭合的代码围栏**（``` / ~~~）导致的「下半段被吞进 code、
 * 标题显原始 ###」（用户实锤「上半渲染、下半源码」）。
 *
 * 根因：CommonMark 下，一个未闭合的 ``` 会把其后**直到文末**的全部内容（含 `###`/`##` 标题）当 code block，
 * 编辑器忠实显示为原始源码。这是合法解析、但对 SKILL.md 编辑是脚枪。「编辑后才渲染」=编辑改变了围栏配平。
 *
 * 修法（启发式、保守、非破坏只在渲染前对喂进编辑器的副本生效；保存时一并落库即修复畸形内容）：
 * - 行首围栏（缩进 0~3，≥3 个 ` 或 ~）逐个配对；遇到「开栏」后若在**首个后续 ≥2 级 ATX 标题行（^#{2,6}\\s）之前**
 *   一直没遇到「闭栏」→ 判定该围栏未闭合且作者大概率漏在章节标题前收尾 → **在该标题行前插入一条闭合围栏**，
 *   使标题及其后内容恢复富文本（代码块在标题前正常结束）。
 * - 【架构师 CR】只在 `##`/`###`… (≥2 级) 标题前补，**不在 `# …`(1 级) 前补**：未闭合围栏内的 `# shell/python 注释`
 *   是高频代码注释，1 级 `#` 误当标题会提前截断代码；真实章节标题几乎都是 `##`/`###`，收紧后保住修复力、大降误伤。
 * - 若开栏后到文末都无后续 ≥2 级标题（纯代码到底）→ 不动（尊重「整段是代码」的可能，避免误切）。
 * - 已正确配平的围栏不动；幂等（再跑一次不变）。
 *
 * @param {string} md
 * @returns {string} 修复后的 md（无未闭合围栏则原样返回）
 */
export function balanceCodeFences(md) {
  const text = String(md ?? '')
  if (!text) return text
  const lines = text.split('\n')
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/
  // ≥2 级 ATX 标题才触发补闭栏（架构师 CR：不在 `# 注释` 等 1 级 # 前补，避免误伤代码注释）。
  const atxHeadingRe = /^ {0,3}#{2,6}(\s|$)/
  const out = []
  let openChar = null // 当前未闭合围栏的字符（'`' 或 '~'）；null = 不在围栏内
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fm = line.match(fenceRe)
    if (openChar) {
      // 在围栏内：遇到同种闭栏 → 关闭；遇到后续 ATX 标题且围栏仍未闭 → 在标题前补闭栏（修复未闭合）。
      if (fm && fm[1][0] === openChar) {
        out.push(line)
        openChar = null
        continue
      }
      if (atxHeadingRe.test(line)) {
        out.push(openChar === '`' ? '```' : '~~~') // 在标题前补闭合围栏
        out.push(line)
        openChar = null
        continue
      }
      out.push(line)
      continue
    }
    // 不在围栏内：遇到开栏 → 进入围栏。
    if (fm) {
      openChar = fm[1][0]
      out.push(line)
      continue
    }
    out.push(line)
  }
  // 文末仍未闭合（开栏后到底无后续标题，纯代码到底）→ 尊重原意不补，保持原样。
  return out.join('\n')
}

/**
 * 把 frontmatter(raw YAML，不含围栏) + body 拼回完整 SKILL.md。
 * 首字节恒 `---\n`（与后端 B5 约定一致）。frontmatter 空串也输出空块（`---\n---\n`），
 * 保证首字节契约 + 后端可 upsert 回写受管键。
 *
 * @param {string} frontmatter 原始 YAML（不含 ---）
 * @param {string} body 正文
 * @returns {string}
 */
export function joinFrontmatter(frontmatter, body) {
  const fm = stripBom(String(frontmatter ?? '')).replace(/\n+$/, '')
  const b = String(body ?? '')
  let out = FENCE + '\n'
  if (fm !== '') out += fm + '\n'
  out += FENCE + '\n'
  out += b
  return out
}

// §12 解耦：撤销 §11 受管键双向同步——readFrontmatterName/writeFrontmatterName/readFrontmatterScalar/
// writeFrontmatterScalar 及 YAML 标量辅助（escapeKey/unquoteYamlScalar/serializeYamlScalar）已删除
// （frontmatter 折叠区改为纯 raw 编辑、不再解析/回写受管键）。split/joinFrontmatter 保留（纯文本拆/拼）。

function stripBom(s) {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/* ============================ 导出 zip · Content-Disposition 文件名解析（切片4） ============================ */

/**
 * 从 Content-Disposition 响应头解析下载文件名（切片4 导出）。
 * 优先 RFC5987 的 `filename*=UTF-8''<percent-encoded>`（解码中文），回落普通 `filename="..."`。
 * 解析失败回落给定默认名。
 *
 * @param {string} header Content-Disposition 头值（可空）
 * @param {string} fallback 解析失败时的默认文件名
 * @returns {string}
 */
export function parseContentDispositionFilename(header, fallback = 'skill.zip') {
  const h = String(header || '')
  if (!h) return fallback
  // 1) RFC5987 filename*=UTF-8''xxx（含中文，percent-encoded）；charset 大小写不敏感，可带引号。
  const star = h.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i)
  if (star && star[2]) {
    try {
      // 去掉可能的包裹引号后 percent-decode。
      const raw = star[2].trim().replace(/^"|"$/g, '')
      const decoded = decodeURIComponent(raw)
      if (decoded) return decoded
    } catch {
      /* 解码失败 → 回落 filename= */
    }
  }
  // 2) 普通 filename="xxx" 或 filename=xxx。
  const plain = h.match(/filename\s*=\s*("?)([^";]+)\1/i)
  if (plain && plain[2]) {
    const name = plain[2].trim()
    if (name) return name
  }
  return fallback
}
