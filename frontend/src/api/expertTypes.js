/**
 * 专家类型定义（参照 unifiedSkill.js）
 *
 * 三分类：岗位私有 / 市场专家 / 通用专家
 */

export const EXPERT_TYPE = {
  POSITION: 'POSITION',           // 岗位私有专家
  PLATFORM: 'PLATFORM',           // 市场专家
  SYSTEM_DEFAULT: 'SYSTEM_DEFAULT' // 通用专家
}

export const EXPERT_TYPE_LABEL = {
  [EXPERT_TYPE.POSITION]: '岗位私有',
  [EXPERT_TYPE.PLATFORM]: '市场专家',
  [EXPERT_TYPE.SYSTEM_DEFAULT]: '通用专家'
}

export const EXPERT_TYPE_OPTIONS = [
  { value: EXPERT_TYPE.POSITION, label: EXPERT_TYPE_LABEL[EXPERT_TYPE.POSITION] },
  { value: EXPERT_TYPE.PLATFORM, label: EXPERT_TYPE_LABEL[EXPERT_TYPE.PLATFORM] },
  { value: EXPERT_TYPE.SYSTEM_DEFAULT, label: EXPERT_TYPE_LABEL[EXPERT_TYPE.SYSTEM_DEFAULT] }
]
