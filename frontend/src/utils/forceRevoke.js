/**
 * 强制回收（技能 / 专家 / MCP / API / 业务系统共用）——确认交互 + 回收信息构造。
 *
 * 对应 PRD 各模块「强制回收」小节：不走审核、原因必填（≤500 字）、两步确认、回收后对象回到「未发布」并带「已回收」标记。
 * 五个列表页共用同一段交互，避免文案五处漂移；请求成败由调用方处理。
 */
import { h } from 'vue'
import { ElMessageBox } from 'element-plus'
import { nowMinuteText } from '@/utils/datetime'
import { currentDemoUsername } from '@/utils/demoIdentity'

export const FORCE_REVOKE_REASON_MAX = 500

/**
 * 两步确认：①回收弹窗（影响范围 + 红色警示 + 必填原因）→ ②危险二次确认。
 *
 * @param {{ typeLabel: string, name: string, refCount?: number, refText?: string }} opts
 *   typeLabel 如「技能」「专家」「MCP 服务」；refText 如「岗位 / 专家」「岗位 / 技能」（引用方描述）。
 * @returns {Promise<string|null>} 回收原因；任一步取消返回 null
 */
export async function askForceRevoke({ typeLabel, name, refCount = 0, refText = '岗位 / 技能' }) {
  let reason
  try {
    const { value } = await ElMessageBox.prompt(
      () =>
        h('div', null, [
          h('p', { style: 'margin:0 0 8px' }, [
            '即将强制回收 ',
            h('strong', null, `「${name}」`),
            refCount > 0 ? `，当前已被 ${refCount} 个${refText}引用（引用关系保留，标记为「已回收」）。` : '。'
          ]),
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
