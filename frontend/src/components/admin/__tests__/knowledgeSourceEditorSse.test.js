// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ElMessage } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * KnowledgeSourceEditor.vue · MCP 数据源新增 sse（旧版 HTTP+SSE）传输方式（2026-09-21）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md §七.2：传输方式 streamable-http / stdio / sse；
 * sse 的字段与鉴权同 streamable-http（§七.2.3）。
 *
 * 真挂载 Element Plus（同 knowledgeBaseEditorScope.test.js）。重点盯一个回归：编辑器里凡「非 http 即 stdio」
 * 的 else 分支，sse 不能掉进去——否则选 sse 保存会被要求「请选择 Command」。
 */

const api = {
  getKnowledgeSource: vi.fn(),
  createKnowledgeSource: vi.fn(),
  updateKnowledgeSource: vi.fn(),
  testKnowledgeSource: vi.fn(),
  listEmbeddingModelOptions: vi.fn()
}
vi.mock('@/api/knowledgeBase', () => api)

const Editor = (await import('@/components/admin/KnowledgeSourceEditor.vue')).default

let mounted
afterEach(() => {
  ElMessage.closeAll()
  mounted?.unmount()
  mounted = null
  vi.clearAllMocks()
})

const drawer = () => mounted.container.querySelector('.el-drawer')
const formModel = () => drawer().querySelector('form.el-form').__vueParentComponent.props.model
/** 按标签文字定位表单项，不依赖顺序 */
const itemByLabel = (label) =>
  [...drawer().querySelectorAll('.el-form-item')].find((i) => i.querySelector('.el-form-item__label')?.textContent.trim() === label)
const errorTexts = () => [...drawer().querySelectorAll('.el-form-item__error')].map((e) => e.textContent.trim())
const clickBtn = (label) => [...drawer().querySelectorAll('.el-button')].find((b) => b.textContent.trim() === label).click()

async function mountMcpCreate() {
  api.listEmbeddingModelOptions.mockResolvedValue([])
  mounted = mountReal(Editor, { visible: true, sourceId: null })
  await flushAll(10)
  formModel().sourceType = 'MCP'
  await flushAll(6)
}
async function pickTransport(t) {
  formModel().mcp.transport = t
  await flushAll(6)
}

describe('KnowledgeSourceEditor · MCP 传输方式 sse（md §七.2）', () => {
  it('选 sse：展示服务地址（占位示例为 /sse）与鉴权方式，不展示 Command；「旧版」提示只在选 sse 时出现', async () => {
    await mountMcpCreate()
    expect(formModel().mcp.transport).toBe('streamable-http')
    expect(drawer().textContent).not.toContain('旧版 HTTP+SSE')

    await pickTransport('sse')
    expect(itemByLabel('MCP 服务地址')).toBeTruthy()
    expect(itemByLabel('MCP 服务地址').querySelector('input').placeholder).toBe('Endpoint，如 https://example.com/sse')
    expect(itemByLabel('鉴权方式')).toBeTruthy()
    expect(itemByLabel('Command')).toBeUndefined()
    expect(drawer().textContent).toContain('旧版 HTTP+SSE')

    await pickTransport('streamable-http')
    expect(itemByLabel('MCP 服务地址').querySelector('input').placeholder).toBe('Endpoint，如 https://example.com/mcp')
    expect(drawer().textContent).not.toContain('旧版 HTTP+SSE')

    await pickTransport('stdio')
    expect(itemByLabel('MCP 服务地址')).toBeUndefined()
    expect(itemByLabel('Command')).toBeTruthy()
  })

  it('选 sse 点【保存】：与 streamable-http 同样必填服务地址，选 Bearer 缺 Token 也会被拦（不会掉进 stdio 分支跳过鉴权校验）', async () => {
    await mountMcpCreate()
    await pickTransport('sse')
    formModel().name = 'SSE 检索源'
    await flushAll(4)
    const save = async () => {
      clickBtn('保存')
      await flushAll(10)
      await new Promise((r) => setTimeout(r, 250)) // ElFormItem 红字过 100ms 防抖才渲染
      await flushAll(4)
    }

    // 第一段：表单规则——sse 与 streamable-http 一样必填服务地址
    await save()
    expect(errorTexts().join('|')).toContain('请填写 MCP 服务地址')
    expect(errorTexts().join('|')).not.toContain('请选择 Command')

    // 第二段：类型化校验里「凭证必填」只在 http 类分支里——sse 若掉进 else（stdio）分支，这条会被悄悄跳过
    formModel().mcp.endpoint = 'https://mcp.example.com/sse'
    formModel().mcp.authType = 'bearer'
    await flushAll(4)
    await save()
    expect(errorTexts().join('|')).toContain('Bearer Token 必填')
    expect(api.createKnowledgeSource).not.toHaveBeenCalled()
  })
})
