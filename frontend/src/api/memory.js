import request from './request'

/**
 * 用户态记忆接口（终端用户对自己的记忆条目操作；JWT 由 axios 拦截器自动注入，
 * userId 一律后端从 JWT 取，前端不传）。
 *
 * 与 admin.js 中的 listMemory（FDE 后台）不同，这里是终端用户的「个人记忆管理」
 * 链路：查看 / 筛选 / 编辑 / 删除自己的记忆条目（不做归档）。
 *
 * 统一响应走 request 拦截器解包 ResultVO；越权/不存在归一 code=2001，
 * 编辑乐观锁冲突为 code=2006（调用方按需捕获）。
 */

/**
 * 记忆列表（分页 + 筛选）。
 * 契约：GET /api/memory/items -> ResultVO<PageVO<MemoryListItemVO>>
 * @param {object} params { keyword, memoryType, status, tag, page, size }
 *  - status 默认后端取 active；这里只透传调用方给定值
 * @returns {Promise<{list, total, page, size}>} PageVO
 */
export function listMemories(params = {}) {
  return request.get('/memory/items', { params })
}

/**
 * 记忆详情（完整正文 + 元信息，含乐观锁 version）。
 * 契约：GET /api/memory/items/{id} -> ResultVO<MemoryDetailVO>
 * @param {string|number} id
 * @returns {Promise<object>} MemoryDetailVO
 */
export function getMemoryDetail(id) {
  return request.get(`/memory/items/${id}`)
}

/**
 * 编辑一条记忆。version 为乐观锁，需传入从详情拿到的 version；
 * 若后端返回 code=2006 表示版本冲突（别人/系统改过），调用方需提示并重拉详情。
 * 契约：PUT /api/memory/items/{id} body MemoryUpdateRequest -> ResultVO<MemoryDetailVO>
 * @param {string|number} id
 * @param {object} body { content, title, tags, memoryType, version }
 * @returns {Promise<object>} 更新后的 MemoryDetailVO
 */
export function updateMemory(id, body) {
  // skipGlobalError：版本冲突等业务错误交由页面友好处理，不弹全局 toast
  return request.put(`/memory/items/${id}`, body, { skipGlobalError: true })
}

/**
 * 撤销（删除）一条用户记忆条目（逻辑删）。
 * 契约：DELETE /api/memory/items/{id} -> ResultVO<void>
 * @param {string|number} id memory_saved.items[].id
 */
export function deleteMemoryItem(id) {
  return request.delete(`/memory/items/${id}`)
}

/**
 * 记忆类型字典（七类）。类型中文 label 一律以此字典为准，前端不硬编码。
 * 契约：GET /api/memory/meta/types -> ResultVO<List<MemoryTypeMeta{code,label}>>
 * @returns {Promise<Array<{code, label}>>}
 */
export function getMemoryTypes() {
  return request.get('/memory/meta/types')
}
