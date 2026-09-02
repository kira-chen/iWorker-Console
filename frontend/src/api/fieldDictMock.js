/**
 * 字段字典开发期内存 mock（仅 DEV 生效，见 fieldDict.js 头注释）。
 *
 * 数据与结构对齐交互原型 v2 的 fields 数据（4 个字段的权威默认选项）+ prd.字段字典.md §2.2：
 * - 平台技能 › 技能分类（skillCategory）
 * - 专家 › 专家分类（expertCategory）
 * - 用户技能审核 › 风险类型（riskType）/ 风险等级（riskLevel）
 *
 * 保存模型按 PRD §三：弹窗内为草稿编辑，【完成】时整字段一次性覆盖保存（不再单条 CRUD）。
 * 其他模块的 mock 需要字典选项时（如专家分类下拉），从本文件 getFieldOptionNames 取，保持同源。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

let seq = 1
const mk = (names) => names.map((n) => ({ id: seq++, name: n }))

// 各字段选项（内部真值；对外只给拷贝）
const store = {
  skillCategory: mk(['办公效率', '智能创作', '数据分析', '开发编程', 'IT运维与安全', '行业专业', '知识与学习', '其他']),
  expertCategory: mk(['通用', '法律', '财税', '政务', '供应链', '投资', '审计', '知识产权']),
  riskType: mk(['对外动作', '危险操作', '权限范围', '敏感信息']),
  riskLevel: mk(['高风险', '中风险', '建议修改', '检测通过'])
}

const copyList = (list) => list.map((o) => ({ id: o.id, name: o.name }))

// 【持久化】（2026-09-02）写点仅 saveFieldOptions。store 为 const（其他模块经 getFieldOptionNames
// 同源取值），restore 按 key 就地覆写、不换对象；快照缺任一字段键即视为不合法 → 回种子。
const persist = attachPersist('fieldDict', {
  version: 1,
  snapshot: () => ({ seq, store }),
  restore: (d) => {
    const keys = Object.keys(store)
    if (!d || !Number.isFinite(d.seq) || !d.store || keys.some((k) => !Array.isArray(d.store[k]))) {
      throw new Error('fieldDict 快照形状不合法')
    }
    seq = d.seq
    keys.forEach((k) => {
      store[k] = d.store[k]
    })
  }
})

// 全量字段选项：{ [fieldKey]: [{id,name}] }
export async function listFieldDict() {
  await delay()
  const out = {}
  for (const k of Object.keys(store)) out[k] = copyList(store[k])
  return out
}

/**
 * 整字段覆盖保存（【完成】统一提交）。names 为草稿的选项名数组（已 trim）。
 * 服务端兜底校验与弹窗一致：空值 / 重名拒绝。同名选项保留原 id（demo 语义：改名=新值）。
 */
export async function saveFieldOptions(fieldKey, names) {
  await delay()
  const old = store[fieldKey]
  if (!old) throw new ApiError({ code: 40400, message: '字段不存在' })
  const clean = (Array.isArray(names) ? names : []).map((n) => String(n ?? '').trim())
  if (clean.some((n) => !n)) throw new ApiError({ code: 40001, message: '选项值不能为空' })
  if (new Set(clean).size !== clean.length) throw new ApiError({ code: 40002, message: '选项值不能重复' })
  const byName = new Map(old.map((o) => [o.name, o.id]))
  store[fieldKey] = clean.map((n) => ({ id: byName.get(n) ?? seq++, name: n }))
  persist()
  return copyList(store[fieldKey])
}

// 同源取值（供其他模块 mock 引用字典选项，如专家分类）
export function getFieldOptionNames(fieldKey) {
  return (store[fieldKey] || []).map((o) => o.name)
}
