/**
 * 强制回收（技能 / 专家 / MCP / API / 业务系统共用）——确认交互 + 回收信息构造。
 *
 * 对应 PRD 各模块「强制回收」小节：不走审核、原因必填（≤500 字）、两步确认、回收后对象回到「未发布」并带「已回收」标记。
 * 五个列表页共用同一段交互，避免文案五处漂移；请求成败由调用方处理。
 */
import { h, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { nowMinuteText } from '@/utils/datetime'
import { currentDemoUsername } from '@/utils/demoIdentity'

export const FORCE_REVOKE_REASON_MAX = 500

/** 连接器行的引用清单名（岗位名 + 技能名；与列表「引用情况」同源——岗位私有行只有岗位、市场行只有技能）。 */
export function connectorRefNames(row) {
  return [
    ...(row.referencedByPositions || []).map((p) => p.positionName),
    ...(row.referencedBySkills || []).map((s) => s.skillName)
  ].filter(Boolean)
}

/**
 * 两步确认：①回收弹窗（影响范围 + 红色警示 + 必填原因）→ ②危险二次确认。
 *
 * 影响范围（md 技能 §3.5.1 / MCP §3.6.1 / API / 业务系统）：「已被 N 个{引用方}引用」，**引用数为 0 也显示**；
 * 传了 refNames 时这句可点击展开引用清单（口径同列表「引用情况」）。refCount 不传（专家：md 回收弹窗没有这一项）则整句不出。
 *
 * @param {{ typeLabel: string, name: string, refCount?: number, refText?: string, refNames?: string[] }} opts
 *   typeLabel 如「技能」「专家」「MCP 服务」；refText 如「岗位 / 专家」「岗位 / 技能」（引用方描述）；
 *   refNames 引用方名称清单（展开后逐条列出）。
 * @returns {Promise<string|null>} 回收原因；任一步取消返回 null
 */
export async function askForceRevoke({ typeLabel, name, refCount, refText = '岗位 / 技能', refNames = [] }) {
  let reason
  const expanded = ref(false) // 影响范围的引用清单是否展开
  const scope = () => {
    if (refCount == null) return null
    const summary = `已被 ${refCount} 个${refText}引用`
    return h('div', { class: 'force-revoke-scope', style: 'margin:0 0 8px' }, [
      '影响范围：',
      refNames.length
        ? h(
            'a',
            {
              class: 'force-revoke-scope-toggle',
              style: 'cursor:pointer;color:var(--c-accent)',
              onClick: () => (expanded.value = !expanded.value)
            },
            `${summary} ${expanded.value ? '▾' : '▸'}`
          )
        : summary,
      '（引用关系保留，标记为「已回收」）',
      expanded.value
        ? h(
            'ul',
            { class: 'force-revoke-scope-list', style: 'margin:6px 0 0;padding-left:20px;max-height:140px;overflow:auto' },
            refNames.map((n, i) => h('li', { key: i }, n))
          )
        : null
    ])
  }
  try {
    const { value } = await ElMessageBox.prompt(
      () =>
        h('div', null, [
          h('p', { style: 'margin:0 0 8px' }, ['即将强制回收 ', h('strong', null, `「${name}」`), '。']),
          scope(),
          h(
            'p',
            { style: 'margin:0 0 12px;font-size:12px;color:var(--c-danger)' },
            '强制回收立即生效且不可撤销：已获得它的员工将立即失去它，引用它的自动化将被挂起。正常退役请使用【停用】。'
          )
        ]),
      `强制回收${typeLabel}`,
      {
        confirmButtonText: '确认强制回收',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        inputType: 'textarea',
        inputPlaceholder: '请输入回收原因，将展示给受影响的员工',
        inputValidator: (v) => {
          const t = (v || '').trim()
          if (!t) return '请输入回收原因'
          if (t.length > FORCE_REVOKE_REASON_MAX) return `回收原因最多 ${FORCE_REVOKE_REASON_MAX} 字`
          return true
        }
      }
    )
    reason = value.trim()
  } catch {
    return null
  }
  try {
    await ElMessageBox.confirm(`将立即强制回收「${name}」，确认继续？`, '二次确认', {
      type: 'warning',
      confirmButtonText: '立即回收',
      cancelButtonText: '再想想',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return null
  }
  return reason
}

/** 回收信息（mock 侧写进对象的 `revoked` 字段）：原因 + 时间 + 操作人。 */
export function makeRevokedInfo(reason) {
  return { reason, at: nowMinuteText(), operator: currentDemoUsername() }
}

/** 「已回收」悬停说明文案：原因 · 操作人 · 时间。 */
export function revokedTip(info) {
  if (!info) return ''
  return `回收原因：${info.reason}（${info.operator || '管理员'} · ${info.at}）`
}
