/**
 * 连接器类型定义（参照 unifiedSkill.js）
 *
 * 三分类：岗位私有 / 市场连接器 / 通用连接器
 * 适用于 MCP、API、业务系统三种连接器
 */

export const CONNECTOR_TYPE = {
  POSITION: 'POSITION',           // 岗位私有连接器
  PLATFORM: 'PLATFORM',           // 市场连接器
  SYSTEM_DEFAULT: 'SYSTEM_DEFAULT' // 通用连接器
}

export const CONNECTOR_TYPE_LABEL = {
  [CONNECTOR_TYPE.POSITION]: '岗位私有',
  [CONNECTOR_TYPE.PLATFORM]: '市场连接器',
  [CONNECTOR_TYPE.SYSTEM_DEFAULT]: '通用连接器'
}

export const CONNECTOR_TYPE_OPTIONS = [
  { value: CONNECTOR_TYPE.POSITION, label: CONNECTOR_TYPE_LABEL[CONNECTOR_TYPE.POSITION] },
  { value: CONNECTOR_TYPE.PLATFORM, label: CONNECTOR_TYPE_LABEL[CONNECTOR_TYPE.PLATFORM] },
  { value: CONNECTOR_TYPE.SYSTEM_DEFAULT, label: CONNECTOR_TYPE_LABEL[CONNECTOR_TYPE.SYSTEM_DEFAULT] }
]
