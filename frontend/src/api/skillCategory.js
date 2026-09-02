import request from './request'

/**
 * N3 技能展示分类 API 层（系统配置员，客户端会谈 R2）。落 /api/fde/skill-categories。
 *
 * 错误处理约定（沿用 admin.js / position.js 范式）：
 * - 读接口（列表 / 删除影响面）走全局拦截器，失败弹 toast。
 * - 写接口加 skipGlobalError（W）→ 失败抛 ApiError（带 code/message/field），
 *   由页面/弹窗自处理：重名等护栏错误按 message 就地提示。
 *
 * 与运行时「操作类/查询类」两套独立数据源，互不串扰——本层只读写展示分类与技能挂分类。
 */
const W = { skipGlobalError: true }
// 2026-09-01 PRD 对齐：技能分类选项统一同源 fieldDict（skillCategory 字段，固定 8 类）。
// demo mock 下本文件的读/挂分类走 fieldDictMock / unifiedSkillMock（VITE_SKILL_MOCK=0 关闭）。
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_SKILL_MOCK !== '0'

// 分类列表（存活，sort 升序）+ 每类已发布到用户端技能数 count。
// mock：从 fieldDict 同源取 8 类，demo 用分类名充当 id（与 unifiedSkillMock 口径一致）。
export function listSkillCategories() {
  if (USE_MOCK) {
    return import('./fieldDictMock').then((m) =>
      m.getFieldOptionNames('skillCategory').map((name) => ({ id: name, name }))
    )
  }
  return request.get('/fde/skill-categories')
}

// 新建分类（body: { name, icon?, sort? }）。新增默认排末尾。
export function createSkillCategory(payload) {
  return request.post('/fde/skill-categories', payload, W)
}

// 编辑分类（部分更新：{ name?, icon?, sort? }；仅传的字段改，可只传 sort 用于拖拽调序）。
export function updateSkillCategory(id, payload) {
  return request.put(`/fde/skill-categories/${id}`, payload, W)
}

// 删除前影响面：该分类当前被多少技能引用（供二次确认「将影响 N 个技能」）。
export function getCategoryDeleteImpact(id) {
  return request.get(`/fde/skill-categories/${id}/delete-impact`)
}

// 删除分类（逻辑删 + 先解引用同事务）。返回被解引用（落未分类）的技能数。
export function deleteSkillCategory(id) {
  return request.delete(`/fde/skill-categories/${id}`, W)
}

// 给技能挂展示分类（技能编辑「展示分类」控件）。categoryId 为 null/空 → 归未分类。
export function setSkillCategory(skillId, categoryId) {
  if (USE_MOCK) return import('./unifiedSkillMock').then((m) => m.setSkillCategory(skillId, categoryId))
  return request.put(`/fde/skill-categories/skills/${skillId}`, { categoryId }, W)
}
