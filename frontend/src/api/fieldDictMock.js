/**
 * 字段字典开发期内存 mock（仅 DEV 生效，见 fieldDict.js 头注释）。
 *
 * 数据与结构对齐交互原型 v2 的 fields 数据 + prd.字段字典.md §2.2（2026-09-08 决议第 6 项：
 * 风险类型 / 风险等级两组从字段字典删除，以用户技能审核模块自身常量 `utils/userSkillAuditMeta.js` 为准）：
 * - 平台技能 › 技能分类（skillCategory）
 * - 专家 › 专家分类（expertCategory）
 *
 * 保存模型按 PRD §三：弹窗内为草稿编辑，【完成】时整字段一次性覆盖保存（不再单条 CRUD）。
 * 系统保留选项（产品优化需求-202611 修改点 15（R11））：两个分类字段末尾的「其他」固定排最后、不能删、不能改名，
 * 对外选项带 reserved: true，编辑弹窗据此置灰该行；保存时服务端兜底校验（见 saveFieldOptions）。
 * 其他模块的 mock 需要字典选项时（如专家分类下拉），从本文件 getFieldOptionNames 取，保持同源。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

let seq = 1
const mk = (names) => names.map((n) => ({ id: seq++, name: n }))

// 各字段选项（内部真值；对外只给拷贝）
const store = {
  skillCategory: mk(['AI Agent', 'IT 运维与安全', '办公效率', '行业专业', '教育学习', '开发编程', '内容创作', '商业运营', '设计多媒体', '数据分析', '知识管理', '其他']),
  expertCategory: mk(['通用', '法律', '财税', '政务', '供应链', '投资', '审计', '知识产权', '其他'])
}

// 各字段的系统保留选项（R11-1 暂按「保留项」）：字段 key → 选项名。不在表里的字段没有保留项。
// 删除别的分类后存量数据怎么显示不变（R11-2 暂按「不变」）：技能显示「未分类」、专家保留原文本，不自动归入「其他」。
const RESERVED_OPTION = { skillCategory: '其他', expertCategory: '其他' }

const copyList = (fieldKey, list) =>
  list.map((o) => (o.name === RESERVED_OPTION[fieldKey] ? { id: o.id, name: o.name, reserved: true } : { id: o.id, name: o.name }))

// 【持久化】（2026-09-02）写点仅 saveFieldOptions。store 为 const（其他模块经 getFieldOptionNames
// 同源取值），restore 按 key 就地覆写、不换对象；快照缺任一字段键即视为不合法 → 回种子。
// version 2（2026-09-08）：风险类型顺序 / 风险等级改 5 档，旧快照丢弃回种子。
// version 3（2026-09-08 决议第 6 项）：删 riskType / riskLevel 两键，旧快照（多出两键）丢弃回种子。
// version 4（2026-09-23 补 3318cbb 漏项）：skillCategory 8 类换 11 类，但当时未 bump——旧快照键名齐全、
// 校验通过，存量浏览器继续吃老 8 类，新分类在下拉里根本选不出来。补 bump 丢弃旧快照回种子。
// v5（2026-11-10 产品优化需求-202611 R11）：技能分类、专家分类末尾加系统保留项「其他」，旧快照没有它，丢弃回种子。
const persist = attachPersist('fieldDict', {
  version: 5,
  snapshot: () => ({ seq, store }),
  restore: (d) => {
    const keys = Object.keys(store)
    if (!d || !Number.isFinite(d.seq) || !d.store || keys.some((k) => !Array.isArray(d.store[k]))) {
      throw new Error('fieldDict 快照形状不合法')
    }
    // 保留项必须在且排最后（保存时已兜底，这里防手改的存量数据）
    if (keys.some((k) => RESERVED_OPTION[k] && d.store[k].at(-1)?.name !== RESERVED_OPTION[k])) {
      throw new Error('fieldDict 快照缺系统保留选项')
    }
    seq = d.seq
    keys.forEach((k) => {
      store[k] = d.store[k]
    })
  }
})

// 全量字段选项：{ [fieldKey]: [{id,name,reserved?}] }（reserved: true 只出现在系统保留选项上）
export async function listFieldDict() {
  await delay()
  const out = {}
  for (const k of Object.keys(store)) out[k] = copyList(k, store[k])
  return out
}

/**
 * 整字段覆盖保存（【完成】统一提交）。names 为草稿的选项名数组（已 trim）。
 * 服务端兜底校验与弹窗一致：空值 / 重名拒绝。同名选项保留原 id（demo 语义：改名=新值）。
 * 有系统保留选项的字段（R11）：草稿里缺了它（被删或被改名）拒绝；位置不对时落回最后。
 */
export async function saveFieldOptions(fieldKey, names) {
  await delay()
  const old = store[fieldKey]
  if (!old) throw new ApiError({ code: 40400, message: '字段不存在' })
  const clean = (Array.isArray(names) ? names : []).map((n) => String(n ?? '').trim())
  if (clean.some((n) => !n)) throw new ApiError({ code: 40001, message: '选项值不能为空' })
  if (new Set(clean).size !== clean.length) throw new ApiError({ code: 40002, message: '选项值不能重复' })
  const reserved = RESERVED_OPTION[fieldKey]
  if (reserved && !clean.includes(reserved)) {
    throw new ApiError({ code: 40003, message: `「${reserved}」为系统保留选项，不可删除或改名` })
  }
  const ordered = reserved ? [...clean.filter((n) => n !== reserved), reserved] : clean
  const byName = new Map(old.map((o) => [o.name, o.id]))
  store[fieldKey] = ordered.map((n) => ({ id: byName.get(n) ?? seq++, name: n }))
  persist()
  return copyList(fieldKey, store[fieldKey])
}

// 同源取值（供其他模块 mock 引用字典选项，如专家分类）
export function getFieldOptionNames(fieldKey) {
  return (store[fieldKey] || []).map((o) => o.name)
}
