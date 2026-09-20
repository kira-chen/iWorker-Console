// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { currentDemoUserName, currentDemoUsername, DEMO_ADMIN } from '../demoIdentity'

/**
 * demoIdentity 的「当前身份」读取。重点是两个函数口径不同、不可混用：
 * - currentDemoUserName：**姓名**口径（审核人等展示用，name → username → 内置管理员姓名）；
 * - currentDemoUsername：**登录用户名**口径（2026-09-20 新增：版本管理的发布人、访问审计的操作人，如 xiaomei）。
 */

const KEY = 'ai_assistant_user'
const store = (info) => localStorage.setItem(KEY, typeof info === 'string' ? info : JSON.stringify(info))

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

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
