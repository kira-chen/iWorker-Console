/**
 * 治理页共享确认/提示弹窗（2026-09-01 PRD 对齐改造，文案逐字对齐交互原型 v2）。
 *
 * 审核中心（UnifiedReview）/ 我的申请（MyApplications）/ 技能整页只读吸底操作栏
 * （AdminSkillEditPage）三处共用，避免同一文案三处漂移。
 * 弹窗仅收「用户是否确认」，请求成败由调用方处理。
 */
import { h } from 'vue'
import { ElMessageBox } from 'element-plus'
import { requestActionLabel } from '@/utils/reviewMeta'

/**
 * 审核中心「通过」确认（原型 approveReview 弹窗）：
 * 标题「确认通过审核」/ 按钮「确认通过」/ 正文「确认通过 <名称> 的{申请类型}申请？」
 * / 提示行「通过后将立即{发布|停用}并更新审核状态。」
 * @returns {Promise<boolean>} 用户是否确认
 */
export async function confirmApproveReview(row) {
  const isDelist = row.requestAction === 'DELIST'
  const actionText = requestActionLabel(row.requestAction)
  try {
    await ElMessageBox.confirm(
      () =>
        h('div', null, [
          h('p', { style: 'margin:0 0 8px' }, [
            '确认通过 ',
            h('strong', null, row.name),
            ` 的${actionText}申请？`
          ]),
          h(
            'p',
            { style: 'margin:0;font-size:12px;color:var(--c-text-muted)' },
            `通过后将立即${isDelist ? '停用' : '发布'}并更新审核状态。`
          )
        ]),
      '确认通过审核',
      { confirmButtonText: '确认通过', cancelButtonText: '取消' }
    )
    return true
  } catch {
    return false
  }
}

/**
 * 我的申请「撤回」确认（原型 withdraw 弹窗）：
 * 标题「撤回申请」/ 按钮「确认撤回」/ 正文「确认撤回「X」的申请？撤回后可以修改并重新提交。」
 * @returns {Promise<boolean>} 用户是否确认
 */
export async function confirmWithdrawMyApp(objectName) {
  try {
    await ElMessageBox.confirm(
      `确认撤回「${objectName}」的申请？撤回后可以修改并重新提交。`,
      '撤回申请',
      { confirmButtonText: '确认撤回', cancelButtonText: '取消' }
    )
    return true
  } catch {
    return false
  }
}

/**
 * 我的申请「重新提交/提交审核」成功提示（原型 submitAudit 弹窗）：
 * 标题「提交成功」/ 正文「「X」已提交审核，进入待审核状态。」/ 底部「关闭」。
 */
export function alertResubmitSuccess(objectName) {
  return ElMessageBox.alert(`「${objectName}」已提交审核，进入待审核状态。`, '提交成功', {
    confirmButtonText: '关闭'
  }).catch(() => {})
}
