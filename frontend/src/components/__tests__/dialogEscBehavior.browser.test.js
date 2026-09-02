import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { ElDialog, ElDrawer, ElMessageBox } from 'element-plus'
import 'element-plus/dist/index.css'
import { disableDialogEsc } from '@/utils/disableDialogEsc'

/**
 * 视觉/交互效果守卫 · 全局弹窗禁用 Esc 关闭（真浏览器，2026-08-08 扩充批）。
 *
 * 背景：中文输入法候选态按 Esc（仅想取消本次输入）会连带关掉弹窗，故应用内弹窗一律不响应
 * Esc（a2f75c4，main.js 入口调 disableDialogEsc）。该行为依赖真实 document 键盘事件链 +
 * EP 内部 hook，jsdom 单测只能测 util 的属性改写，测不到「按下 Esc 弹窗到底关不关」。
 *
 * 本文件只测**加固后**行为，且每条用例在 beforeAll 里确保 disableDialogEsc() 已生效——
 * 不依赖用例书写顺序（随机顺序执行也必须稳定通过）。
 * 「未加固时 Esc 确实能关弹窗」的对照基线在 dialogEscBaseline.browser.test.js：
 * disableDialogEsc 改的是 EP 模块级 props 默认值且幂等不可逆，同进程内一旦调用就回不去，
 * 故对照必须独立文件。原先两者同文件、靠书写顺序保证，随机序下会翻红（2026-08-08 审视实测）。
 */

let app, host

function mountDialog(onClose) {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () =>
      h(
        ElDialog,
        {
          modelValue: true,
          // close 事件在 beforeLeave 同步发出（update:modelValue 要等过渡动画 afterLeave，测试内不可等）
          onClose,
          title: 'T',
          appendToBody: true
        },
        { default: () => h('span', 'body') }
      )
  })
  app.mount(host)
}

async function frame() {
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

function pressEsc() {
  // EP 的 Esc 处理挂在 overlay/焦点陷阱链路上（非 document 级监听），须从弹窗内焦点元素冒泡上去
  // ——与真实用户按键的事件路径一致（弹窗打开时焦点被陷阱锁在弹窗内）。
  const target =
    document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : document.querySelector('.el-overlay') || document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
}

afterEach(async () => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  await frame()
})

describe('全局弹窗 Esc 行为（加固后；每条用例自足，不依赖执行顺序）', () => {
  // 文件级一次性加固：任一用例单独跑、或随机顺序跑，前置条件都成立
  beforeAll(() => {
    disableDialogEsc()
  })

  it('Dialog 按 Esc 不关闭', async () => {
    let closed = false
    mountDialog(() => {
      closed = true
    })
    await frame()
    pressEsc()
    await frame()
    expect(closed).toBe(false)
    expect(document.querySelector('.el-dialog')).toBeTruthy()
  })

  it('Drawer 共享 prop 默认值同步翻 false（双写防解耦）', () => {
    expect(ElDialog.props.closeOnPressEscape.default).toBe(false)
    expect(ElDrawer.props.closeOnPressEscape.default).toBe(false)
  })

  it('MessageBox.confirm 按 Esc 不关闭（包装层注入生效）', async () => {
    const p = ElMessageBox.confirm('确认吗？', '标题')
    p.catch(() => {}) // 清理阶段 close 触发的 reject 不算失败
    await frame()
    expect(document.querySelector('.el-message-box')).toBeTruthy()
    pressEsc()
    // 必须等过关闭过渡动画时长再断言：动画期间元素仍在 DOM，立即断言会把「已被 Esc 关闭」误判为存活
    await new Promise((r) => setTimeout(r, 400))
    const box = document.querySelector('.el-message-box')
    expect(box).toBeTruthy()
    expect(box.offsetParent, 'MessageBox 应仍可见（未被 Esc 关闭）').not.toBeNull()
    ElMessageBox.close()
    await new Promise((r) => setTimeout(r, 400))
  })
})
