import request from './request'
import { useUserStore } from '@/stores/user'
import { parseContentDispositionFilename } from '@/utils/skillFileTree'

/**
 * 技能包文件 API 层（技能包改造 §7.4 / F4 / F6，切片3）。
 *
 * 同一组方法同时服务 FDE 技能（/fde/skills）与平台技能（/fde/platform-skills）两侧：
 * source ∈ 'fde' | 'platform' 仅收敛「API 前缀分支」这一处（F4），组件只调
 * listSkillFiles(skillId, source) 等，不再为两侧各写一套文件 API。路由名/store 选择仍由
 * 页面编排层（AdminSkillEditPage）现有单开关保留——不承诺组件零分支。
 *
 * 错误处理约定（沿用 position.js / platformSkill.js 范式）：
 * - 读接口（列树/读文件）走全局拦截器（失败弹 toast）。
 * - 写接口（存/删/改名/导入 zip）加 skipGlobalError → 失败抛 ApiError（带 code/message/field），
 *   由组件做字段级回显（弹窗内红字 / 树操作弹窗内重试）。
 *
 * zip 上传（F6 铁律）：el-upload 仅做选择 UI（:auto-upload=false），提交时取 file.raw 塞
 * FormData 走封装 request（复用 axios 拦截器 + skipGlobalError），不用 el-upload 内置 action 通道。
 * 不引 jszip——后端解压（架构 §3）。与 position.js uploadIcon / space.js uploadDoc 范式一致。
 */

// 写接口统一配置：绕过全局错误提示，交组件自处理字段级回显。
const W = { skipGlobalError: true }

// 【demo mock（2026-09-01 PRD 对齐改造）】技能包文件层基础能力（zip 导入 / 列树 / 读写 / 删 / 改名）
// 默认走 unifiedSkillMock（VITE_SKILL_MOCK=0 可关闭）。文件夹/移动/跨文件查找/导出/下载等
// 高级能力本轮不 mock（demo 无后端时这些入口调用会失败，属已知限制，见 PRD-review 记录）。
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_SKILL_MOCK !== '0'
const skillMock = () => import('./unifiedSkillMock')

// 统一前缀解析：source ∈ 'fde' | 'platform' | 'platform-candidate'（F4：仅此一处收敛前缀分支）。
// - 'fde'                → /fde/skills（FDE_WORKBENCH 写端点）
// - 'platform'           → /fde/platform-skills（SYS_CONFIG 平台技能写端点）
// - 'platform-candidate' → /fde/platform-skill-candidates（FDE_WORKBENCH 平台技能只读端点，
//   仅供平台技能 Tab 只读详情读取文件树/内容；该 source 下绝不调写方法——只读态写入口根本不渲染）。
function base(source) {
  if (source === 'platform') return '/fde/platform-skills'
  if (source === 'system') return '/fde/system-skills'   // V89：系统默认技能（通道前缀分段隔离，端点与 platform 同构）
  if (source === 'platform-candidate') return '/fde/platform-skill-candidates'
  if (source === 'review') return '/fde/user-skill-reviews'  // V94：用户技能审核只读预览（即时解析留档 zip 出文件树/内容，不落库）
  return '/fde/skills'
}

// query 中的 path 必须 URL-encode（含 / 与中文，架构 §2.1）。
function withPath(path) {
  return { params: { path } }
}

/* ============================ zip 导入（端点 1/2，F6） ============================ */

/**
 * 端点1：zip 上传创建技能（multipart）。FDE 可选 agentId 归属（无则建游离技能）；平台/系统默认无 agentId
 * （V89：source='system' 走 /fde/system-skills，通道由前缀钉死，建后不可改）。
 * @param {File} file 原始 zip 文件（el-upload file.raw）
 * @param {{ agentId?:number|string, source?:'fde'|'platform'|'system', displayCategoryId?:string }} opt
 *        displayCategoryId：技能分类（2026-08-17，仅市场通道平台技能上传时可选；选填，不传按未分类落库）
 * @returns {Promise<SkillDetailVO>} 含回填 name/description/triggers + referencedTools + warnings
 */
export function importSkillZip(file, { agentId, source, displayCategoryId } = {}) {
  if (USE_MOCK) {
    // demo：不真正解包 zip——按文件名建技能；type 由 source 推导，分类为每包必选（新建弹窗已拦）。
    const type = source === 'platform' ? 'PLATFORM' : source === 'system' ? 'SYSTEM_DEFAULT' : 'POSITION'
    return skillMock().then((m) =>
      m.importSkillZip({ fileName: file?.name || '', type, categoryName: displayCategoryId })
    )
  }
  const fd = new FormData()
  fd.append('file', file)
  if (agentId != null && source !== 'platform' && source !== 'system') fd.append('agentId', agentId)
  if (displayCategoryId) fd.append('displayCategoryId', displayCategoryId)
  return request.post(`${base(source)}/import-zip`, fd, {
    ...W,
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

/**
 * 端点2：zip 上传到已有技能（整包替换/合并）。本切片创建流程不用，提供完整封装备用。
 */
export function importZipToSkill(skillId, file, { source } = {}) {
  const fd = new FormData()
  fd.append('file', file)
  return request.post(`${base(source)}/${skillId}/import-zip`, fd, {
    ...W,
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

/* ============================ 文件 CRUD（端点 3~7） ============================ */

/** 端点3：列目录树 → SkillFileTreeVO{ skillId, entryPath, files[] }。读接口走全局错误提示。 */
export function listSkillFiles(skillId, source) {
  if (USE_MOCK) return skillMock().then((m) => m.listSkillFiles(skillId))
  return request.get(`${base(source)}/${skillId}/files`)
}

/** 端点4：读单文件 → SkillFileContentVO{ path,name,fileType,isEntry,size,content }。读接口走全局错误提示。 */
export function getSkillFile(skillId, path, source) {
  if (USE_MOCK) return skillMock().then((m) => m.getSkillFile(skillId, path))
  return request.get(`${base(source)}/${skillId}/files/content`, withPath(path))
}

/**
 * 跨文件查找（组③，功能波次 2b）：GET /{skillId}/files/search?q=&scope=。
 *
 * 端点仅在写域控制器存在：FDE `/fde/skills` 与平台 `/fde/platform-skills`。
 * **`platform-candidate`（只读浏览，SkillReferenceController 只有 /files 与 /files/content）无此端点**，
 * 调用会 404（越权）→ 调用方（SkillFileTree）在只读态隐藏「按内容」入口、绝不调本函数（P1 收口）。
 *
 * @param {number|string} skillId
 * @param {string} q 查询词（空白则后端返回空 items）
 * @param {'name'|'content'|'all'} scope 匹配维度（默认 all）
 * @param {'fde'|'platform'} source 仅这两者有 search 端点（不含 platform-candidate）
 * @returns {Promise<SkillFileSearchVO>} { q, items:[{ path,name,fileType,isDir,nameHit, lines:[{lineNo,snippet}] }] }
 *   读接口走全局错误提示；调用方自行处理 loading/空态。
 */
export function searchSkillFiles(skillId, q, scope = 'all', source) {
  return request.get(`${base(source)}/${skillId}/files/search`, { params: { q, scope } })
}

/**
 * 端点5：存单文件（新建或覆盖，静默 upsert）→ SkillFileSaveVO{ tree, referencedTools, category, warnings }。
 * @param {{ path:string, content:string }} payload
 */
export function saveSkillFile(skillId, payload, source) {
  if (USE_MOCK) return skillMock().then((m) => m.saveSkillFile(skillId, payload))
  return request.put(`${base(source)}/${skillId}/files/content`, payload, W)
}

/** 端点6：删文件（SKILL.md 不可删 → 400）→ SkillFileSaveVO。 */
export function deleteSkillFile(skillId, path, source) {
  if (USE_MOCK) return skillMock().then((m) => m.deleteSkillFile(skillId, path))
  return request.delete(`${base(source)}/${skillId}/files`, { ...W, ...withPath(path) })
}

/**
 * 端点7：重命名/移动文件（SKILL.md 不可改名 / 不可改为 SKILL.md → 400；目标已存在 → 409）→ SkillFileSaveVO。
 * @param {{ fromPath:string, toPath:string }} payload
 */
export function renameSkillFile(skillId, payload, source) {
  if (USE_MOCK) return skillMock().then((m) => m.renameSkillFile(skillId, payload))
  return request.post(`${base(source)}/${skillId}/files/rename`, payload, W)
}

/* ============================ 文件夹 / 移动原子端点（端点 9~12，目录结构能力） ============================ */

/**
 * 端点9：新建（空）文件夹 → SkillFileSaveVO{ tree, referencedTools, category, warnings }。
 *
 * 空目录由后端持久化（is_dir 占位行，架构 §1/§2）：前端不再用客户端「待定空夹」，建夹即落库。
 * 后端逐级补建中间目录占位行；撞同名文件/目录 → 400/409。
 *
 * @param {number|string} skillId
 * @param {string} path 完整目录前缀（POSIX，无尾斜杠），如 references/sub
 * @param {'fde'|'platform'} source
 * @returns {Promise<SkillFileSaveVO>}
 */
export function createSkillFolder(skillId, path, source) {
  return request.post(`${base(source)}/${skillId}/folders`, { path }, W)
}

/**
 * 端点10：重命名文件夹（父目录不变，仅末段名变；级联改其下全部子项 path）→ SkillFileSaveVO。
 *
 * 单事务原子（架构 §4.2），替代前端「逐个 rename」级联循环。
 * fromPath/toPath 均为完整目录前缀（无尾斜杠），父目录段须一致（仅末段不同）。
 * 后端校验：fromPath 存在且为目录、非 entry；toPath 同级无重名 → 409。
 *
 * @param {number|string} skillId
 * @param {{ fromPath:string, toPath:string }} payload
 * @param {'fde'|'platform'} source
 * @returns {Promise<SkillFileSaveVO>}
 */
export function renameSkillFolder(skillId, payload, source) {
  return request.post(`${base(source)}/${skillId}/folders/rename`, payload, W)
}

/**
 * 端点11：删除文件夹（级联软删整子树：占位行 + 全部子项）→ SkillFileSaveVO。
 *
 * 单事务原子（架构 §4.4），替代前端「逐个 delete」级联循环。
 * 非空夹删除前由前端二次确认列影响范围（PRD §4.5）。
 *
 * @param {number|string} skillId
 * @param {string} path 目录前缀（无尾斜杠）
 * @param {'fde'|'platform'} source
 * @returns {Promise<SkillFileSaveVO>}
 */
export function deleteSkillFolder(skillId, path, source) {
  return request.delete(`${base(source)}/${skillId}/folders`, { ...W, ...withPath(path) })
}

/**
 * 端点12：移动文件或文件夹（拖拽 / 「移动到…」统一入口，末段名不变、仅换父目录）→ SkillFileSaveVO。
 *
 * 文件与文件夹共用此端点（isDir 区分，后端二次校验类型一致）。toParentDir='' → 移到根级。
 * 后端校验（架构 §4.3 / §5）：循环移动（夹移入自身/子孙）→ 400；目标重名 → 409；
 * 超深度 → 400；SKILL.md 不可移 → 400。前端 allow-drop 仅即时预判，后端为最终权威。
 *
 * @param {number|string} skillId
 * @param {{ fromPath:string, toParentDir:string, isDir:boolean }} payload
 * @param {'fde'|'platform'} source
 * @returns {Promise<SkillFileSaveVO>}
 */
export function moveSkillNode(skillId, payload, source) {
  return request.post(`${base(source)}/${skillId}/move`, payload, W)
}

/* ============================ 导出 zip（端点8，切片4） ============================ */

/**
 * 端点8：导出技能包为 zip 并触发浏览器下载（GET .../export-zip）。
 *
 * 不走统一 axios 实例的原因（同 chat.js downloadArtifact 范式）：
 *  - axios 响应拦截器会按 JSON 解包 ResultVO，破坏二进制流；
 *  - 且拿不到响应头（Content-Disposition）来取文件名。
 * 故用 fetch 带 JWT 取 blob：从 Content-Disposition 解析文件名（优先 RFC5987 filename* 解码中文），
 * 用浏览器原生 a[download] + URL.createObjectURL 触发下载（不引新依赖）。
 *
 * 失败处理：blob 错误体可能是后端 ResultVO JSON（如 404/无权限），尝试解析其 message 抛出，
 * 调用方据此给错误提示。
 *
 * @param {number|string} skillId
 * @param {'fde'|'platform'} source
 * @returns {Promise<string>} 实际下载的文件名（供 success 文案）
 * @throws {Error} 失败时抛（message 优先取后端 JSON 错误体）
 */
export async function exportSkillZip(skillId, source) {
  const userStore = useUserStore()
  const headers = {}
  if (userStore.token) headers.Authorization = `Bearer ${userStore.token}`

  const url = `/api${base(source)}/${skillId}/export-zip`
  const resp = await fetch(url, { method: 'GET', headers })

  if (resp.status === 401) {
    userStore.logout()
    throw new Error('登录已失效，请重新登录')
  }
  if (!resp.ok) {
    throw new Error(await readErrorMessage(resp))
  }

  const blob = await resp.blob()
  // 防御：后端异常时可能 200 但回 JSON（理论上 export 失败应非 200，但兼容兜底）。
  if (blob.type && blob.type.includes('application/json')) {
    const msg = await blobJsonMessage(blob)
    throw new Error(msg || '导出失败，请稍后重试')
  }

  const filename = parseContentDispositionFilename(
    resp.headers.get('Content-Disposition'),
    `skill-${skillId}.zip`
  )

  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
  return filename
}

/**
 * 单文件下载（完整保真，2026-07-29）：GET /{skillId}/files/download?path=。
 * 二进制文件（脚本/数据）从后端 StorageService 取原字节流回，浏览器另存。复用 exportSkillZip 的 blob/a[download] 范式。
 *
 * @param {number|string} skillId
 * @param {string} path 包内相对 path（URL-encode）
 * @param {'fde'|'platform'|'platform-candidate'} source
 * @returns {Promise<string>} 实际下载的文件名
 * @throws {Error} 失败时抛（message 优先取后端 JSON 错误体）
 */
export async function downloadSkillFile(skillId, path, source) {
  const userStore = useUserStore()
  const headers = {}
  if (userStore.token) headers.Authorization = `Bearer ${userStore.token}`

  const url = `/api${base(source)}/${skillId}/files/download?path=${encodeURIComponent(path)}`
  const resp = await fetch(url, { method: 'GET', headers })

  if (resp.status === 401) {
    userStore.logout()
    throw new Error('登录已失效，请重新登录')
  }
  if (!resp.ok) {
    throw new Error(await readErrorMessage(resp))
  }

  const blob = await resp.blob()
  if (blob.type && blob.type.includes('application/json')) {
    const msg = await blobJsonMessage(blob)
    throw new Error(msg || '下载失败，请稍后重试')
  }

  // 文件名优先取响应头，兜底取 path 末段。
  const fallback = String(path).split('/').pop() || `file-${skillId}`
  const filename = parseContentDispositionFilename(resp.headers.get('Content-Disposition'), fallback)

  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
  return filename
}

// 从非 2xx 响应体读错误信息：错误体常是 ResultVO JSON（{code,message,...}），兼容纯文本/空体。
async function readErrorMessage(resp) {
  try {
    const text = await resp.text()
    if (!text) return '导出失败，请稍后重试'
    try {
      const json = JSON.parse(text)
      return json?.message || '导出失败，请稍后重试'
    } catch {
      return text.length < 200 ? text : '导出失败，请稍后重试'
    }
  } catch {
    return '导出失败，请稍后重试'
  }
}

// 从 JSON blob 提取 message（200 但回 JSON 的兜底场景）。
async function blobJsonMessage(blob) {
  try {
    const json = JSON.parse(await blob.text())
    return json?.message || ''
  } catch {
    return ''
  }
}
