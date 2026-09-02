import request from './request'
import * as mock from './dataTableMock'

/**
 * 数据表管理（schema CRUD）API 层 —— 管理后台。
 *
 * 【demo mock（2026-09-02 岗位工作台补 mock）】纯前端 demo 下默认走内存 mock（dataTableMock.js），
 * 开关与岗位 mock 同一枚：`VITE_POS_MOCK=0` 关闭走真实接口路径（工作档案是岗位工作台的子资源，
 * 与岗位详情树同开同关，避免半真半假）。
 *
 * 接口前缀：/fde/positions/{positionId}/data-tables（及字段子资源），需 ADMIN/FDE token
 * （admin 鉴权由 request 拦截器统一注入，401 统一登出）。
 *
 * 错误处理约定（沿用 admin.js / request.js）：
 * - 读接口走全局拦截器（失败弹 toast 即可）。
 * - 写接口加 `skipGlobalError: true`——绕过全局 toast，失败抛 ApiError。
 *   ApiError 携带：code（res.code，数值/HTTP）、message、field（res.data.field，字段级属性名）、
 *   data（完整 res.data）。其中：
 *     · data.errorCode —— 业务错误码（如 TABLE_CODE_DUPLICATED / FIELD_DELETE_NEED_CONFIRM）；
 *     · data.fieldIndex —— 字段级错误所在的提交 fields 数组下标（0-based），用于红框精确定位；
 *     · data.field —— 出错的字段属性名（如 fieldCode / label / fieldType / defaultValue）。
 * - 删表：先调 delete-impact 拿影响面 → 二次确认 → 带 ?confirm=true 调 DELETE。
 *   未带 confirm 时后端返回 data.errorCode=TABLE_DELETE_NEED_CONFIRM。
 * - 整表字段保存：用原子批量端点 saveDataTableFields（单事务 diff 增/改/删）；删有数据字段
 *   缺 confirm 时返回 data.errorCode=FIELD_DELETE_NEED_CONFIRM（带 affectedRows/willSoftDelete/
 *   deleteFieldCodes）→ 二次确认 → 带 confirm=true 重试。
 *
 * 状态枚举：数据表 status = active（启用）/ disabled（停用）。
 *   注意：岗位（expert）的 status 是 active/inactive，与此无关，勿混。
 */

// 写接口统一配置：绕过全局错误提示，交编辑器/调用方自处理
const W = { skipGlobalError: true }

// demo mock 开关（与 position.js 同枚：岗位工作台整体 mock）
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_POS_MOCK !== '0'

const base = (positionId) => `/fde/positions/${positionId}/data-tables`

/* ============================ 表（table）============================ */

// 1.1 表列表（不含软删表，无分页）
// data: { list:[{ id, tableCode, label, description, status, fieldCount, recordCount, refSkillCount, updatedAt }], total }
export function listDataTables(positionId) {
  if (USE_MOCK) return mock.listDataTables(positionId)
  return request.get(base(positionId))
}

// 1.3 表详情
// data: { id, positionId, tableCode, label, description, status, fields:[...], refSkills:[...], recordCount }
export function getDataTable(positionId, tableId) {
  if (USE_MOCK) return mock.getDataTable(positionId, tableId)
  return request.get(`${base(positionId)}/${tableId}`)
}

// 1.2 建表（请求体不含 uid，系统自动追加 uid 系统字段）
// 出参：{ id, tableCode, fields:[{id, fieldCode, ...}] }（含后端自动生成的 code）
export function createDataTable(positionId, payload) {
  if (USE_MOCK) return mock.createDataTable(positionId, payload)
  return request.post(base(positionId), payload, W)
}

// 1.4 改表元信息（仅 label/description/status，tableCode 不可改）
export function updateDataTable(positionId, tableId, payload) {
  if (USE_MOCK) return mock.updateDataTable(positionId, tableId, payload)
  return request.put(`${base(positionId)}/${tableId}`, payload, W)
}

// 1.5 删表（须带 confirm=true；缺 confirm 返回 TABLE_DELETE_NEED_CONFIRM）
export function deleteDataTable(positionId, tableId) {
  if (USE_MOCK) return mock.deleteDataTable(positionId, tableId)
  return request.delete(`${base(positionId)}/${tableId}`, { ...W, params: { confirm: true } })
}

// 1.9 删表影响预检：{ affectedRows, refSkills:[...], willSoftDelete }
export function getTableDeleteImpact(positionId, tableId) {
  if (USE_MOCK) return mock.getTableDeleteImpact(positionId, tableId)
  return request.get(`${base(positionId)}/${tableId}/delete-impact`)
}

/* ============================ 字段（field）============================ */

// 1.6 整表字段原子批量保存（单事务内 diff 新增/改/删）。
//   fields: 全量业务字段（不含 uid 系统字段），形如
//     [{ fieldCode, label, fieldType, required, defaultValue, fieldDesc }, ...]
//   confirm: 是否确认删除有数据的字段。首次传 false；后端若需确认会返回
//     data.errorCode=FIELD_DELETE_NEED_CONFIRM（带 affectedRows/willSoftDelete/deleteFieldCodes），
//     前端二次确认后带 confirm=true 重试。
//   字段级校验错误：data.fieldIndex（提交数组下标）+ data.field（属性名）用于红框定位。
export function saveDataTableFields(positionId, tableId, fields, confirm = false) {
  if (USE_MOCK) return mock.saveDataTableFields(positionId, tableId, fields, confirm)
  return request.put(`${base(positionId)}/${tableId}/fields`, { fields }, { ...W, params: { confirm } })
}

/* ============================ 工作档案配置（dossier）============================ */

// 1.12 读工作档案配置：{ policy, checklist, reduceRules }；无行回默认
export function getDossierConfig(positionId, tableId) {
  if (USE_MOCK) return mock.getDossierConfig(positionId, tableId)
  return request.get(`${base(positionId)}/${tableId}/dossier`)
}

// 1.12 全量保存工作档案配置；响应回带归一化后的配置。
//   校验错误：data.errorCode=DOSSIER_CONFIG_ILLEGAL，data.field 为点路径（如 checklist[2].when.value）
export function saveDossierConfig(positionId, tableId, payload) {
  if (USE_MOCK) return mock.saveDossierConfig(positionId, tableId, payload)
  return request.put(`${base(positionId)}/${tableId}/dossier`, payload, W)
}
