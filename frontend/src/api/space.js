import request from './request'

/**
 * 个人空间 API 层（PRD-03 契约 v1.1）。
 *
 * 错误处理约定（契约 §0.2）：
 * - 读接口（列表/详情/切片/容量/状态查询）走全局拦截器（失败弹 toast）。
 * - 写接口（上传/删除/重试）加 `skipGlobalError: true`——绕过全局 toast，失败抛 ApiError
 *   （带 code/message/data），由页面自处理：逐条/字段级精细提示（1101~1107 见 §11）。
 *
 * 枚举口径（契约 §0.1，前端不得做统一大小写转换）：
 * - source：UPLOAD / CHAT_GENERATED（全大写）
 * - parseStatus：pending / parsing / parsed / failed（全小写）
 * - status（列表入参）：all / pending / parsing / parsed / failed（全小写）
 */

// 写接口统一配置：绕过全局错误提示，交页面自处理逐条/字段级提示
const W = { skipGlobalError: true }

/* ============================ 上传 §1（逐文件请求） ============================ */

/**
 * 上传单个文件（multipart）。一次一个文件，支持进度回调与取消。
 * 契约：POST /api/personal-space/docs，出参 ResultVO<DocUploadResultVO>。
 *
 * @param {File} file 单个文件
 * @param {Object} opt
 * @param {(percent:number)=>void} [opt.onProgress] 上传进度（0~100）
 * @param {AbortSignal} [opt.signal] 取消信号（取消后不落库）
 * @returns {Promise<{docId, name, success, parseStatus, error}>}
 */
export function uploadDoc(file, { onProgress, signal } = {}) {
  const form = new FormData()
  form.append('file', file)
  return request.post('/personal-space/docs', form, {
    ...W,
    headers: { 'Content-Type': 'multipart/form-data' },
    signal,
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)))
      }
    }
  })
}

/* ============================ 状态轮询 §1.1 ============================ */

/**
 * 批量状态查询（轮询非终态文档）。
 * 契约：GET /api/personal-space/docs/status?ids=101,102，出参 ResultVO<List<DocStatusVO>>。
 * @param {Array<number|string>} ids docId 列表（建议 ≤50）
 * @returns {Promise<Array<{docId, parseStatus, chunkCount, errorReason}>>}
 */
export function getDocsStatus(ids = []) {
  return request.get('/personal-space/docs/status', {
    params: { ids: ids.join(',') }
  })
}

/* ============================ 列表 §2 ============================ */

/**
 * 文档列表（搜索 / 状态筛选 / 分页）。
 * 契约：GET /api/personal-space/docs，出参 ResultVO<PageVO<DocListItemVO>>。
 * @param {Object} params { keyword, status, page, size }
 */
export function listDocs(params = {}) {
  return request.get('/personal-space/docs', { params })
}

/* ============================ 详情 §3 ============================ */

// 契约：GET /api/personal-space/docs/{docId}，出参 ResultVO<DocDetailVO>。
export function getDocDetail(docId) {
  return request.get(`/personal-space/docs/${docId}`)
}

/* ============================ 切片 §4（分页 / 懒加载） ============================ */

/**
 * 切片列表。契约：GET /api/personal-space/docs/{docId}/chunks，出参 ResultVO<PageVO<ChunkItemVO>>。
 * page/title 一律取 metadata.page / metadata.title（外层只有 chunkIndex / content）。
 * @param {number} docId
 * @param {Object} params { page, size }
 * @param {AbortSignal} [signal] 取消信号（抽屉关闭/切换文档时中断在途切片请求）
 */
export function listChunks(docId, params = {}, signal) {
  return request.get(`/personal-space/docs/${docId}/chunks`, { params, signal })
}

/* ============================ 删除 §5（写接口） ============================ */

// 契约：DELETE /api/personal-space/docs/{docId}，出参 ResultVO<Void>。已删幂等成功。
export function deleteDoc(docId) {
  return request.delete(`/personal-space/docs/${docId}`, W)
}

/* ============================ 重试解析 §6（写接口） ============================ */

// 契约：POST /api/personal-space/docs/{docId}/reparse，出参 ResultVO<Void>。
// 1107=解析中无法重试。
export function reparseDoc(docId) {
  return request.post(`/personal-space/docs/${docId}/reparse`, null, W)
}

/* ============================ 容量 §7 ============================ */

// 契约：GET /api/personal-space/capacity，出参 ResultVO<CapacityVO>{ usedBytes, totalBytes, percent }。
export function getCapacity() {
  return request.get('/personal-space/capacity')
}
