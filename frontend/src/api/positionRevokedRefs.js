/**
 * 岗位引用里「已被强制回收的连接器」查询（岗位 PRD §8「连接器被强制回收」/ §9.1 发布阻断）。
 *
 * 单独成文件：详情页壳与 positionMock 都要用，而不少测试整模块 mock 掉 @/api/position，放进去会缺导出。
 * 同步读三个连接器 mock 现成的 xxxSync（单一真相，不另存一份回收状态）；
 * 引用是软引用，id 在连接器侧已不存在的悬空引用不算回收，跳过。
 * @param {{ connectorMcpIds?: string[], connectorApiIds?: string[], businessSystemIds?: string[] }} ids
 * @returns {string[]} 名称，顺序 MCP → API → 业务系统
 */
import { listMcpSync } from './mcpConnectorMock'
import { listApisSync } from './apiConnectorMock'
import { listBizSystemsSync } from './bizSystemMock'

export function revokedConnectorNames({ connectorMcpIds = [], connectorApiIds = [], businessSystemIds = [] } = {}) {
  const pick = (rows, ids) => rows.filter((r) => ids.includes(r.id) && r.revoked).map((r) => r.name)
  return [
    ...pick(listMcpSync(), connectorMcpIds),
    ...pick(listApisSync(), connectorApiIds),
    ...pick(listBizSystemsSync(), businessSystemIds)
  ]
}
