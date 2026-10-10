// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

/**
 * ChatMarkdown 体积控制守卫：对话回答只读渲染，必须关闭公式 / 流程图 / 图表 / 代码高亮四类重型扩展
 * （否则运行时会按需拉 CDN 脚本）。桩掉 md-editor-v3 的 MdPreview 取其收到的 props，
 * 不依赖真实渲染，故与 ChatMarkdown.test.js 的渲染回归互不干扰。
 */
const received = vi.hoisted(() => ({ props: null }))

vi.mock('md-editor-v3', () => ({
  MdPreview: {
    name: 'MdPreviewStub',
    inheritAttrs: false,
    setup(_, { attrs }) {
      received.props = attrs
      return () => null
    }
  },
  config: () => {},
  XSSPlugin: {}
}))
vi.mock('md-editor-v3/lib/preview.css', () => ({}))

import ChatMarkdown from '@/components/ChatMarkdown.vue'

describe('ChatMarkdown 关闭重型扩展', () => {
  beforeEach(() => {
    received.props = null
    const mem = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k),
        clear: () => mem.clear()
      },
      configurable: true
    })
    setActivePinia(createPinia())
  })

  function mountIt() {
    const el = document.createElement('div')
    createApp({ render: () => h(ChatMarkdown, { content: '# hi' }) }).mount(el)
  }

  it.each(['noEcharts', 'noKatex', 'noMermaid', 'noHighlight'])('MdPreview 收到 %s=true', (key) => {
    mountIt()
    expect(received.props).toBeTruthy()
    // 模板写 :no-echarts，attrs 中可能以 kebab 或 camel 形式出现
    const kebab = key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    expect(received.props[key] ?? received.props[kebab]).toBe(true)
  })
})
