import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { ElDialog } from 'element-plus'
import 'element-plus/dist/index.css'

/**
 * 对照基线 · EP 默认行为下 Esc 确实会关闭弹窗（真浏览器，2026-08-08 审视拆分）。
 *
 * 与 dialogEscBehavior.browser.test.js（加固后行为）**必须分文件**：
 * disableDialogEsc() 改的是 EP 组件 props 的模块级默认值且带 applied 幂等锁——一旦在某个
 * 测试文件里调用过，同进程内不可逆。原先两者同文件、靠「对照组写在最前」的书写顺序保证，
 * 但注释约束不了执行器：随机顺序执行（--sequence.shuffle）下即翻红（本次审视实测发现）。
 * 拆成独立文件后，各文件内部自足、互不依赖执行顺序。
 *
 * 本文件的价值：证明「按 Esc 能关弹窗」这条事件模拟链路真实有效——
 * 否则加固后那几条「按 Esc 不关闭」的断言可能只是因为按键根本没送达（假绿）。
 */

let app, host

afterEach(async () => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  await nextTick()
})

async function frame() {
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

describe('对照基线：EP 默认 Esc 行为（本文件绝不调用 disableDialogEsc）', () => {
  it('未加固时按 Esc 会关闭弹窗 —— 证明事件模拟链路有效', async () => {
    let closed = false
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({
      render: () =>
        h(ElDialog, { modelValue: true, onClose: () => { closed = true }, title: 'T', appendToBody: true },
          { default: () => h('span', 'body') })
    })
    app.mount(host)
    await frame()
    expect(document.querySelector('.el-dialog'), '弹窗应已渲染').toBeTruthy()
    // 焦点陷阱内派发（与真实用户按键路径一致）
    const target = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : document.querySelector('.el-overlay') || document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await frame()
    expect(closed, 'EP 默认应响应 Esc 关闭').toBe(true)
  })
})
