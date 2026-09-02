// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import ChatMarkdown from '@/components/ChatMarkdown.vue'

/**
 * ChatMarkdown 渲染回归保护：
 * - 助手回答的 Markdown（加粗/列表/表格/行内代码/表情）必须渲染为对应 HTML，而非显示原文。
 * - md-editor-v3 默认 sanitize 为恒等，本组件全局注册 XSSPlugin 净化；XSS（script/iframe/javascript:）必须被挡。
 *
 * 不引 @vue/test-utils，直接用 createApp 挂到 jsdom 容器，等微/宏任务后取 innerHTML 断言。
 */

let container
let app

async function mountChat(content) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(ChatMarkdown, { content }) })
  app.mount(container)
  // md-editor 内部对编译做了异步处理，等几个 tick + 宏任务让渲染落地
  await nextTick()
  await new Promise((r) => setTimeout(r, 500))
  await nextTick()
  return container.innerHTML
}

describe('ChatMarkdown 渲染', () => {
  beforeEach(() => {
    // jsdom 未启用 localStorage（--localstorage-file 未提供），theme store 启动需读取，做最小内存 shim
    if (!('localStorage' in globalThis) || typeof globalThis.localStorage?.getItem !== 'function') {
      const mem = new Map()
      const ls = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k),
        clear: () => mem.clear()
      }
      Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
      if (globalThis.window) {
        Object.defineProperty(globalThis.window, 'localStorage', { value: ls, configurable: true })
      }
    }
    setActivePinia(createPinia())
  })
  afterEach(() => {
    if (app) app.unmount()
    if (container) container.remove()
    app = null
    container = null
  })

  it('把 Markdown 渲染成 HTML（不显示原文）', async () => {
    const md = '📋 **客户信息**\n\n- **国网** — x\n- 中石油\n\n`code`\n\n| a | b |\n| - | - |\n| 1 | 2 |'
    const html = await mountChat(md)
    // 渲染产物证据
    console.log('[RENDER OUTPUT]', html)
    // md-editor 会给块级元素加 data-line 属性，故用正则匹配开标签
    expect(html).toContain('<strong>')
    expect(/<li[ >]/.test(html)).toBe(true)
    expect(/<table[ >]/.test(html)).toBe(true)
    expect(/<th[ >]/.test(html)).toBe(true)
    expect(html).toContain('<code>')
    // 表情应原样保留
    expect(html).toContain('📋')
    // 不应残留 markdown 原始标记（加粗 ** 与表格 | 都不能以原文形式漏出）
    expect(html).not.toContain('**客户信息**')
    expect(html).not.toContain('| a | b |')
  })

  it('挡住 XSS：内联 HTML 的 script / iframe / onerror 被净化', async () => {
    // 注：markdown 链接里的 javascript: 由 markdown-it 自身拦截（不会生成 <a href>），
    // 这里聚焦 LLM 直出内联 HTML 的净化（XSSPlugin 职责），断言不产生可执行标签/属性。
    const md = [
      'hello',
      '<script>alert(1)</scr' + 'ipt>',
      '<iframe src="https://evil.com"></iframe>',
      '<a href="javascript:alert(2)">x</a>',
      '<img src=x onerror="alert(3)">'
    ].join('\n\n')
    const html = await mountChat(md)
    console.log('[XSS OUTPUT]', html)
    const lc = html.toLowerCase()
    // 不得出现可执行的标签（script/iframe 应被转义或剥离，不能是真实标签节点）
    expect(lc).not.toContain('<script')
    expect(lc).not.toContain('<iframe')
    // 事件处理属性必须被剥离
    expect(lc).not.toContain('onerror')
    // <a> 若保留，其 href 不得是 javascript: 协议
    expect(lc).not.toContain('href="javascript:')
  })
})
