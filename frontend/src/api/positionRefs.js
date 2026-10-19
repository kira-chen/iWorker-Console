/**
 * 连接器「被岗位引用」清单（referencedByPositions）回写的公共实现（待办 yuepu#98：原先在 MCP / API / 业务系统三个 mock 里逐字重复）。
 * referencedByPositions 存的是含 positionName 的冻结副本，岗位侧删除 / 改名 / 绑定变化都要回写，否则连接器页会留下已删岗位或旧名。
 *
 * 三个函数只改传入的行数组、返回「有没有改动」，由各连接器 mock 决定要不要落盘（persist）。
 */

/** 岗位被删：从所有行的引用清单里摘掉该岗位。 */
export function removeRefs(rows, positionId) {
  let changed = false
  rows.forEach((r) => {
    const list = r.referencedByPositions || []
    const next = list.filter((p) => String(p.positionId) !== String(positionId))
    if (next.length !== list.length) {
      r.referencedByPositions = next
      changed = true
    }
  })
  return changed
}

/** 岗位改名：把清单里该岗位的冻结名称同步成新名。 */
export function renameRefs(rows, positionId, positionName) {
  let changed = false
  rows.forEach((r) => {
    ;(r.referencedByPositions || []).forEach((p) => {
      if (String(p.positionId) === String(positionId) && p.positionName !== positionName) {
        p.positionName = positionName
        changed = true
      }
    })
  })
  return changed
}

/**
 * 岗位绑定 / 解绑后回写：只动 type=POSITION（岗位私有）的行；boundIds 之内的行补上本岗位，之外的行摘掉本岗位。
 * @param {Array} rows 连接器行
 * @param {string|number} positionId
 * @param {string} positionName
 * @param {Array<string|number>} boundIds 本岗位当前绑定的该类连接器 id
 */
export function syncRefs(rows, positionId, positionName, boundIds) {
  const bound = new Set((boundIds || []).map(String))
  let changed = false
  rows.forEach((r) => {
    if (r.type !== 'POSITION') return
    const list = r.referencedByPositions || []
    const has = list.some((p) => String(p.positionId) === String(positionId))
    if (bound.has(String(r.id)) && !has) {
      r.referencedByPositions = [...list, { positionId, positionName }]
      changed = true
    } else if (!bound.has(String(r.id)) && has) {
      r.referencedByPositions = list.filter((p) => String(p.positionId) !== String(positionId))
      changed = true
    }
  })
  return changed
}
