// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * MarkdownEditor.vue 不得触发外网 CDN（待办 yuepu#12②）。
 *
 * md-editor-v3 默认把 prettier / echarts / katex / mermaid / highlight / cropper 等扩展按需从 unpkg 拉取。
 * demo 常在无外网环境演示，每打开一次「自动化任务」编辑器就会有 3 条 `ERR_CONNECTION_CLOSED`
 * （echarts、prettier standalone、prettier markdown，2026-09-20 Playwright 实测）。
 * 本组只钉「所有会触发 CDN 的开关都关着」，不测编辑器本体——MdEditor 用桩接住 props。
 */

vi.mock('md-editor-v3/lib/style.css', () => ({}))
vi.mock('@/stores/theme', () => ({ useThemeStore: () => ({ theme: 'light' }) }))
vi.mock('md-editor-v3', () => ({
  config: vi.fn(),
  MdEditor: {
    name: 'MdEditor',
    props: ['noPrettier', 'noEcharts', 'noKatex', 'noMermaid', 'noHighlight', 'noUploadImg'],
    setup(props) {
      return () => h('div', { class: 'md-editor-stub', 'data-flags': JSON.stringify(props) })
    }
  }
}))

const MarkdownEditor = (await import('@/components/admin/MarkdownEditor.vue')).default

let app, container
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('MarkdownEditor · 无外网依赖（待办 yuepu#12②）', () => {
  it('传给 MdEditor 的六个扩展开关全部关闭（prettier / echarts / katex / mermaid / highlight / 图片上传），不触发 unpkg 拉取', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    app = createApp({ render: () => h(MarkdownEditor, { modelValue: '# 标题' }) })
    app.mount(container)

    const flags = JSON.parse(container.querySelector('.md-editor-stub').getAttribute('data-flags'))
    expect(flags).toEqual({
      noPrettier: true,
      noEcharts: true,
      noKatex: true,
      noMermaid: true,
      noHighlight: true,
      noUploadImg: true
    })
  })
})
