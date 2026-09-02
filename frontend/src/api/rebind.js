import request from './request'

// 更换专家（rebind）API 层。
// 契约：docs/api/更换专家-接口契约.md
// 注意：本组接口仅用于「已有当前专家 → 更换」场景；首次绑定走 POST /positions/bind（见 api/userPosition.js）。
//
// 这两个接口均带 skipGlobalError：换绑是「强确认 + 自处理错误」流程，
// 不能由全局拦截器弹默认 toast（避免暴露技术 message / 与友好文案冲突），
// 由 store/页面按 code 映射友好中文（见 rebindErrorMessage）。

// 换绑影响预览（只读，不写）。
// GET /api/user/position/rebind-preview?positionId={目标专家ID}
export function getRebindPreview(positionId) {
  return request.get('/user/position/rebind-preview', {
    params: { positionId },
    skipGlobalError: true
  })
}

// 执行换绑（单事务：软删旧绑定+旧覆盖层 + 新建空覆盖层绑定）。
// POST /api/user/position/rebind  body: { newPositionId }
// 仅传 newPositionId；userId 由后端取 JWT，不信任请求体。
export function rebindPosition(newPositionId) {
  return request.post(
    '/user/position/rebind',
    { newPositionId },
    { skipGlobalError: true }
  )
}

// 解绑当前专家影响预览（只读，不写）。
// GET /api/user/position/unbind-preview
// 返回 RebindPreviewVO（targetExpert=null、currentExpert 为当前专家、willClear/willKeep/irreversibleNote）。
// 同 rebind-preview 带 skipGlobalError：解绑是「强确认 + 自处理错误」流程，由页面/store 友好处理。
export function getUnbindPreview() {
  return request.get('/user/position/unbind-preview', {
    skipGlobalError: true
  })
}

// 执行解绑（清当前专家个性化覆盖层 + 解绑到 0 active 绑定，保留会话/记忆/定时任务，不可恢复）。
// POST /api/user/position/unbind  （无请求体；userId 由后端取 JWT）
// 返回 UnbindResultVO{changed,unboundPositionId,clearedFieldOverride,clearedSkillOverrideCount,unboundAt}。
// changed=false 表示本就无绑定，按「已解绑」处理不报错。
export function unbindPosition() {
  return request.post('/user/position/unbind', undefined, {
    skipGlobalError: true
  })
}

// 解绑错误码 → 友好中文映射。错误码仅 401/5000（契约）。
// - 401：拦截器已统一登出跳登录，返回空让上层忽略。
// - 其余（5000/网络/超时/未知）：通用兜底，不暴露技术细节。
export function unbindErrorMessage(err) {
  const code = err?.code
  if (code === 401) return ''
  return '解绑未完成，当前专家与个性化保持不变，请重试。'
}

// 错误码 → 友好中文映射（PRD §6.2 / §8.6 + 契约 §5）。
// 铁律：不暴露技术堆栈 / 表名 / 工具名 / 原始 code。
// - 401：拦截器已统一登出跳登录，此处不应再被业务捕获（兜底给空让上层忽略）。
// - 404：目标专家不存在/已下架/不可见（确认期被下架亦走此分支）。
// - 1000：并发双换冲突，可重试。
// - 网络/超时（无 HTTP 响应、无 code，拦截器转 code=-1/undefined）：
//   对应 PRD §6.2「更换未完成，当前专家与个性化保持不变」。
// - 其余（400/5000/未知）：通用兜底。
export function rebindErrorMessage(err) {
  const code = err?.code
  // 无 code 或 -1：网络/超时，换绑是单事务，无响应即视为未提交成功，旧专家视图不变
  if (code == null || code === -1) {
    return '更换未完成，当前专家与个性化保持不变，请重试。'
  }
  switch (code) {
    case 401:
      // 已由拦截器统一登出跳登录，正常不会走到这里
      return ''
    case 404:
      return '该专家已不可用，请重新选择。'
    case 1000:
      return '操作过于频繁，请重试。'
    case 400:
      return '请求参数有误，请重新选择专家。'
    default:
      // 5000、HTTP 5xx 及其它未知 code 均经此 default 兜底文案，不暴露技术细节
      return '更换未完成，当前专家与个性化保持不变，请重试。'
  }
}
