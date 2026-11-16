import request from './request'
import * as mock from './channelMock'

/**
 * 渠道 API 层（04运行 › 渠道：机器人、群聊治理、消息设置）。
 * 纯前端 demo 默认走 channelMock；保留真实接口分支作为研发接入示例。
 * 写接口 skipGlobalError：字段级错误（ApiError.field）由抽屉 / 弹窗就地提示在对应字段下方。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_RUN_MOCK !== '0'
const quiet = { skipGlobalError: true }

/* ---------- 机器人 ---------- */
export function listBots(params) {
  if (USE_MOCK) return mock.listBots(params)
  return request.get('/fde/channel/bots', { params })
}
export function getBotSummary() {
  if (USE_MOCK) return mock.getBotSummary()
  return request.get('/fde/channel/bots/summary')
}
export function getPlatformSlots() {
  if (USE_MOCK) return mock.getPlatformSlots()
  return request.get('/fde/channel/platform-slots')
}
export function getBot(id) {
  if (USE_MOCK) return mock.getBot(id)
  return request.get(`/fde/channel/bots/${id}`, quiet)
}
export function verifyBotCredentials(payload) {
  if (USE_MOCK) return mock.verifyBotCredentials(payload)
  return request.post('/fde/channel/bots/verify', payload, quiet)
}
export function checkCallback(ch) {
  if (USE_MOCK) return mock.checkCallback(ch)
  return request.post('/fde/channel/callback-check', { ch }, quiet)
}
export function createBot(payload) {
  if (USE_MOCK) return mock.createBot(payload)
  return request.post('/fde/channel/bots', payload, quiet)
}
export function updateBot(id, payload) {
  if (USE_MOCK) return mock.updateBot(id, payload)
  return request.put(`/fde/channel/bots/${id}`, payload, quiet)
}
export function stopBot(id) {
  if (USE_MOCK) return mock.stopBot(id)
  return request.post(`/fde/channel/bots/${id}/stop`, null, quiet)
}
export function enableBot(id) {
  if (USE_MOCK) return mock.enableBot(id)
  return request.post(`/fde/channel/bots/${id}/enable`, null, quiet)
}
export function verifySwapApp(id, payload) {
  if (USE_MOCK) return mock.verifySwapApp(id, payload)
  return request.post(`/fde/channel/bots/${id}/swap-app/verify`, payload, quiet)
}
export function swapApp(id, payload) {
  if (USE_MOCK) return mock.swapApp(id, payload)
  return request.post(`/fde/channel/bots/${id}/swap-app`, payload, quiet)
}

/* ---------- 群聊治理 ---------- */
export function listGroups(params) {
  if (USE_MOCK) return mock.listGroups(params)
  return request.get('/fde/channel/groups', { params })
}
export function getGroup(id) {
  if (USE_MOCK) return mock.getGroup(id)
  return request.get(`/fde/channel/groups/${id}`, quiet)
}
export function removeGroup(id) {
  if (USE_MOCK) return mock.removeGroup(id)
  return request.post(`/fde/channel/groups/${id}/remove`, null, quiet)
}

/* ---------- 消息设置（消息合并等待时长，对全部机器人生效） ---------- */
export function getMessageSettings() {
  if (USE_MOCK) return mock.getMessageSettings()
  return request.get('/fde/channel/message-settings')
}
export function saveMessageSettings(mergeWaitSec) {
  if (USE_MOCK) return mock.saveMessageSettings(mergeWaitSec)
  return request.put('/fde/channel/message-settings', { mergeWaitSec }, quiet)
}
