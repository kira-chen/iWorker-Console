// @vitest-environment jsdom
/**
 * ToolPicker 工具勾选器（岗位自动化任务「＋ 添加工具」弹窗内复用，md 岗位 §7.5）
 *
 * 2026-10-20 走查：自动化任务引用工具只有 MCP 和 API 两类——
 * - 不再出现「Mock 工具」分组；
 * - MCP / API 已是真实连接器，不再挂「未接入 · 下轮上线」/「未接入」占位标记，也不再有「本轮为占位」脚注。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import ToolPicker from '../ToolPicker.vue'

const AVAILABLE = {
  mcp: [{ type: 'MCP', code: 'mcp__kb__search', bizName: '知识库检索', description: '' }],
  api: [{ type: 'API', code: 'api__crm', bizName: 'CRM 查询', description: '' }]
}

let app, container
async function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(ToolPicker, { selected: [], showConfirm: false, ...props }) })
  app.use(ElementPlus)
  app.mount(container)
  await nextTick()
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('ToolPicker 分组与占位标记', () => {
  it('只有「MCP 工具」「API 工具」两个分组，没有 Mock 分组', async () => {
    await mount({ available: AVAILABLE })
    const titles = [...container.querySelectorAll('.tp-group-title')].map((e) => e.textContent.trim())
    expect(titles).toEqual(['MCP 工具', 'API 工具'])
    expect(container.textContent).not.toContain('Mock')
  })

  it('MCP / API 工具不再标「未接入」，也没有「本轮为占位」脚注', async () => {
    await mount({ available: AVAILABLE })
    expect(container.textContent).toContain('知识库检索') // 前提：工具已渲染
    expect(container.textContent).not.toContain('未接入')
    expect(container.textContent).not.toContain('下轮上线')
    expect(container.textContent).not.toContain('占位')
  })

  it('汇总文案写「跨 MCP / API 两来源」', async () => {
    await mount({ available: AVAILABLE })
    expect(container.querySelector('.tp-summary').textContent).toContain('跨 MCP / API 两来源')
  })
})
