import { describe, it, expect, beforeEach, vi } from 'vitest'

// request.js 顶层 import：element-plus(ElMessage) / @/stores/user。
// 单测只验证纯逻辑（ApiError 字段、响应拦截器分流），故全部 mock 掉副作用依赖，
// 并捕获 axios.create 注册的拦截器回调，直接对回调做断言。
// 2026-09-12 负责人决策 3（审计 J2）：401/1001 两条会话级收口随登录与员工端退役删除后，
// request.js 已不再 import @/router，故原 @/router mock 与 logout/setUserInfo/
// elMessageWarning/currentRoute 四个仅服务那两条分支的探针一并移除。

const elMessageError = vi.fn()
vi.mock('element-plus', () => ({
  ElMessage: { error: elMessageError }
}))

// userStore 模拟：仅需 token（请求拦截器注入 Authorization 用）
const userStore = { token: 'tk' }
vi.mock('@/stores/user', () => ({
  useUserStore: () => userStore
}))

// 捕获 interceptors.response.use(onFulfilled, onRejected) 的两个回调
let responseFulfilled
let responseRejected
let requestFulfilled
// isCancel 可控 mock：默认 false，主动取消用例 mockReturnValueOnce(true)
const isCancelMock = vi.fn(() => false)
vi.mock('axios', () => {
  const instance = {
    interceptors: {
      request: { use: (f) => (requestFulfilled = f) },
      response: {
        use: (ok, err) => {
          responseFulfilled = ok
          responseRejected = err
        }
      }
    }
  }
  return { default: { create: () => instance, isCancel: (e) => isCancelMock(e) } }
})

const { ApiError } = await import('@/api/request')

describe('ApiError', () => {
  it('完整字段构造', () => {
    const e = new ApiError({ code: 1001, message: '失败', field: 'name', data: { x: 1 } })
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe(1001)
    expect(e.message).toBe('失败')
    expect(e.field).toBe('name')
    expect(e.data).toEqual({ x: 1 })
  })

  it('缺省：message 兜底 Error，field/data 兜底 null', () => {
    const e = new ApiError({ code: 500 })
    expect(e.message).toBe('Error')
    expect(e.field).toBeNull()
    expect(e.data).toBeNull()
  })
})

describe('请求拦截器：注入 JWT', () => {
  it('有 token 时写入 Authorization: Bearer', () => {
    const cfg = { headers: {} }
    const out = requestFulfilled(cfg)
    expect(out.headers.Authorization).toBe('Bearer tk')
  })
})

describe('响应拦截器（成功分支 onFulfilled）', () => {
  beforeEach(() => {
    elMessageError.mockClear()
  })

  it('code===0 → 解包返回 data', async () => {
    const out = await responseFulfilled({ data: { code: 0, data: { ok: true } }, config: {} })
    expect(out).toEqual({ ok: true })
  })

  it('非标准结构（二进制/无 code）→ 原样返回', async () => {
    const blob = new Uint8Array([1, 2, 3])
    const out = await responseFulfilled({ data: blob, config: {} })
    expect(out).toBe(blob)
    const nul = await responseFulfilled({ data: null, config: {} })
    expect(nul).toBeNull()
  })

  // 2026-09-12 负责人决策 3（审计 J2）：员工端与登录整体退役后，拦截器已无 401 登出收口、
  // 也无 1001「未绑定专家 → 跳 BindPosition」收口（Login / BindPosition 路由与
  // utils/positionNotBound.js 均已删除），原先这两组共 4 条用例随之删除。
  // 401 / 1001 现按普通业务码走下方 skip / toast 通用分支。

  it('code===1005（岗位内唯一冲突）+ skipGlobalError → 不弹 toast、带 field 抛 ApiError', async () => {
    // R-EC1：唯一冲突已从 1001 让位到 1005，走 skip 分支携带 field
    //（Agent 名 / 采集字段 code / 技能 code 重复）供组件红框回显。
    let caught
    await responseFulfilled({
      data: { code: 1005, message: '岗位内已存在同名 Agent', data: { field: 'name' } },
      config: { skipGlobalError: true }
    }).catch((e) => (caught = e))
    expect(caught).toBeInstanceOf(ApiError)
    expect(caught.code).toBe(1005)
    expect(caught.field).toBe('name')
    expect(elMessageError).not.toHaveBeenCalled()
  })

  it('skipGlobalError + 业务错误 → 不弹 toast，reject 带 field 的 ApiError', async () => {
    let caught
    await responseFulfilled({
      data: { code: 1002, message: '字段错', data: { field: 'inputSchema' } },
      config: { skipGlobalError: true }
    }).catch((e) => (caught = e))
    expect(caught).toBeInstanceOf(ApiError)
    expect(caught.code).toBe(1002)
    expect(caught.field).toBe('inputSchema')
    expect(elMessageError).not.toHaveBeenCalled()
  })

  it('非 skip 的业务错误 → 弹全局 toast，reject 普通 Error', async () => {
    let caught
    await responseFulfilled({
      data: { code: 1003, message: '普通错' },
      config: {}
    }).catch((e) => (caught = e))
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(ApiError)
    expect(elMessageError).toHaveBeenCalledWith('普通错')
  })
})

describe('响应拦截器（HTTP 错误分支 onRejected）', () => {
  beforeEach(() => {
    elMessageError.mockClear()
  })

  // 2026-09-12 负责人决策 3（审计 J2）：登录随员工端退役，原「HTTP 401 → 登出跳 Login」
  // 兜底分支已删（含 skipGlobalError 仍强收口那条），对应 2 条用例随之删除。

  it('skipGlobalError 的 HTTP 错误 → 转 ApiError，不弹 toast', async () => {
    let caught
    await responseRejected({
      response: { status: 400, data: { code: 2001, message: '校验失败', data: { field: 'code' } } },
      config: { skipGlobalError: true },
      message: 'Request failed'
    }).catch((e) => (caught = e))
    expect(caught).toBeInstanceOf(ApiError)
    expect(caught.code).toBe(2001)
    expect(caught.field).toBe('code')
    expect(elMessageError).not.toHaveBeenCalled()
  })

  it('skip 但无响应体（网络异常）→ ApiError 用 status/默认文案兜底', async () => {
    let caught
    await responseRejected({
      config: { skipGlobalError: true },
      message: 'Network Error'
    }).catch((e) => (caught = e))
    expect(caught).toBeInstanceOf(ApiError)
    expect(caught.code).toBe(-1)
    expect(caught.message).toBe('Network Error')
  })

  it('普通 HTTP 错误 → 弹 toast（取后端 message）', async () => {
    await responseRejected({
      response: { status: 500, data: { message: '服务异常' } },
      config: {}
    }).catch(() => {})
    expect(elMessageError).toHaveBeenCalledWith('服务异常')
  })

  it('axios.isCancel 主动取消 → 原样 reject 该 error，不弹错、不转 ApiError', async () => {
    isCancelMock.mockReturnValueOnce(true)
    const cancelErr = { message: 'canceled', config: {} }
    let caught
    await responseRejected(cancelErr).catch((e) => (caught = e))
    expect(caught).toBe(cancelErr) // 原样透传，供调用方按 isCancel 忽略
    expect(caught).not.toBeInstanceOf(ApiError)
    expect(elMessageError).not.toHaveBeenCalled()
  })

  it('非 skip 无 response 的网络异常 → toast 兜底文案「网络异常，请稍后重试」+ reject 原 error', async () => {
    const err = { config: {} } // 无 response 且无 message → 命中最终兜底文案
    let caught
    await responseRejected(err).catch((e) => (caught = e))
    expect(elMessageError).toHaveBeenCalledWith('网络异常，请稍后重试')
    expect(caught).toBe(err)
    expect(caught).not.toBeInstanceOf(ApiError)
  })
})
