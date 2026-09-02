import { defineStore } from 'pinia'

/**
 * 伙伴昵称（纯前端持久化工具 store）。
 *
 * 现状：后端暂无「伙伴昵称」字段，故本阶段用 localStorage 持久化。
 * 键含 userId + positionId，做到「同一用户在不同岗位伙伴」各自独立命名。
 * 默认昵称「小助」。对话头部 / onboarding 统一读它（消费方按需 getNickname 取值，
 * 无须内存响应式态：onboarding 写完即跳 Chat，Chat 头部 computed 依赖 userInfo+positionId
 * 重新读 localStorage，不存在脏态）。
 *
 * TODO: 待后端补昵称字段后改为服务端持久化（届时本 store 改为读写接口，键策略可保留做缓存兜底）。
 */
export const DEFAULT_NICKNAME = '小助'

const STORAGE_PREFIX = 'ai_assistant_companion_name'

// 组装存储键：缺省占位 0，保证键稳定可读（无 user/position 时仍有兜底键，不抛错）
function buildKey(userId, positionId) {
  return `${STORAGE_PREFIX}:${userId ?? '0'}:${positionId ?? '0'}`
}

export const useCompanionStore = defineStore('companion', () => {
  // 读取某用户某岗位伙伴的昵称（无则返回默认「小助」）
  function getNickname(userId, positionId) {
    try {
      const v = localStorage.getItem(buildKey(userId, positionId))
      return v && v.trim() ? v : DEFAULT_NICKNAME
    } catch (e) {
      return DEFAULT_NICKNAME
    }
  }

  // 写入昵称（空值回退默认）
  function setNickname(userId, positionId, name) {
    const safe = (name || '').trim() || DEFAULT_NICKNAME
    try {
      localStorage.setItem(buildKey(userId, positionId), safe)
    } catch (e) {
      /* localStorage 不可用时不阻断流程（昵称仅作展示） */
    }
    return safe
  }

  return {
    getNickname,
    setNickname
  }
})
