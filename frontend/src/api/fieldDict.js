import request from './request'
import * as mock from './fieldDictMock'

/**
 * 字段字典 API 层（治理 › 字段字典，2026-09-01 按 PRD 草稿整存模型重构）。
 *
 * 纯前端 demo：默认走 fieldDictMock 内存 mock（`VITE_GOV_MOCK=0` 可关闭，
 * 走真实接口路径，仅供未来接回后端时切换；届时端点按此文件签名补齐契约）。
 *
 * 与原单条 CRUD（skillCategory.js / skillReview.js 的风险字典接口）的关系：
 * 字段字典页不再单条增删改，改为「草稿编辑 +【完成】整字段覆盖保存」（PRD §三）。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_GOV_MOCK !== '0'

// 全量字段选项：{ [fieldKey]: [{id,name}] }
export function listFieldDict() {
  if (USE_MOCK) return mock.listFieldDict()
  return request.get('/fde/field-dict')
}

// 整字段覆盖保存（names：草稿选项名数组）
export function saveFieldOptions(fieldKey, names) {
  if (USE_MOCK) return mock.saveFieldOptions(fieldKey, names)
  return request.put(`/fde/field-dict/${fieldKey}`, { names }, { skipGlobalError: true })
}
