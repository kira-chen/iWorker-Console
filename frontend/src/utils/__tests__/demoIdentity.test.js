// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { currentDemoUserName, currentDemoUsername, DEMO_ADMIN } from '../demoIdentity'

/**
 * demoIdentity 的「当前身份」读取。重点是两个函数口径不同、不可混用：
 * - currentDemoUserName：**姓名**口径（审核人等展示用，name → username → 内置管理员姓名）；
 * - currentDemoUsername：**登录用户名**口径（2026-09-20 新增：版本管理的发布人、访问审计的操作人，如 xiaomei）。
 */

const KEY = 'ai_assistant_user'
const store = (info) => localStorage.setItem(KEY, typeof info === 'string' ? info : JSON.stringify(info))

// 2026-09-23（待办 yuepu#15）：本仓 jsdom 下 globalThis.localStorage 为 undefined，须自建桩——
// jsdom 29 把 localStorage 交给 Node 原生实现，而 Node（本机 26）不带 --localstorage-file 时该能力关闭，
// 于是本机跑红、CI（Node 22，jsdom 自带实现）却绿。写法同 positionAssignmentMock.test.js:61-80。
const makeStorage = () => {
  const map = new Map()
  return {
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  }
}

// 注意两点（都踩过）：①**不在 afterEach 还原成 undefined**——同 worker 内其他文件共享 globalThis，
// 还原会把别人正在用的 storage 抹掉；②**已存在可用实现时不替换、只清空**——每次都换新桩同样会夺走
// 别的文件（adminUserMock / positionApplicationsMock / unifiedSkillMock 等持久化用例）已写入的数据，
// 表现为「单跑绿、全量跑随机红」。只有在环境确实没有 localStorage 时才补桩。
beforeEach(() => {
  if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
  }
  globalThis.localStorage.clear()
})

describe('currentDemoUsername（登录用户名）', () => {
  it('落盘身份有 username → 取它（不是姓名）', () => {
    store({ name: '小美', username: 'xiaomei' })
    expect(currentDemoUsername()).toBe('xiaomei')
    expect(currentDemoUserName()).toBe('小美') // 姓名口径不受影响
  })

  it('无落盘身份 → 内置演示管理员的 username', () => {
    expect(currentDemoUsername()).toBe(DEMO_ADMIN.username)
    expect(currentDemoUsername()).toBe('demo')
    expect(currentDemoUserName()).toBe('演示管理员')
  })

  it('落盘身份没有 username（只有 name）→ 回落到内置用户名，不把姓名当用户名', () => {
    store({ name: '小美' })
    expect(currentDemoUsername()).toBe('demo')
  })

  it('username 为空白 / 落盘内容损坏 → 回落到内置用户名，不抛错', () => {
    store({ username: '   ' })
    expect(currentDemoUsername()).toBe('demo')
    store('{not json')
    expect(currentDemoUsername()).toBe('demo')
  })
})
