// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * N7：ApiEditor 读/写字段级错误绑定 —— 验证数据层返回 field='readWrite' 校验错误时，
 * 对应 el-form-item 的 :error 能承接并回显（此前该项无 :error 路径，后端加校验时无处显示红框）。
 *
 * 手法：mock api/apiConnector（getApi 回全量合法详情让前端校验放行；updateApi 抛 { field:'readWrite' }）
 * + element-plus + IconPickerPopover（避免拉起 request/axios 链）。
 * el-form-item 存根把 error prop 渲染为可断言文本节点。
 */

const conn = {
  createApi: vi.fn(),
  updateApi: vi.fn(),
  // 详情满足 PRD 校验（名称/图标/系统/描述/示例问题×3/URL），保证保存能走到 updateApi
  getApi: vi.fn(() =>
    Promise.resolve({
      code: 'api_1',
      name: '报销查询',
      icon: '📄',
      description: '按报销单号查询审批状态',
      providerSystemId: 'pv_1',
      url: 'https://api.x.com/q',
      method: 'GET',
      readWrite: 'read',
      exampleQuestions: ['问题一', '问题二', '问题三'],
      authType: 'NONE',
      authConfig: null,
      requestSchema: null,
      responseSchema: null,
      referencedBySkills: [],
      createdAt: '2026-08-20T09:30:00+08:00',
      updatedAt: '2026-08-24T16:10:00+08:00',
      publishedAt: null
    })
  ),
  listProviderSystems: vi.fn(() => Promise.resolve({ list: [{ id: 'pv_1', name: '财务系统' }] })),
  aiGenerateExampleQuestion: vi.fn()
}
vi.mock('@/api/apiConnector', () => conn)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg }))

// 图标选择器：避免引入 api/position → request → axios/router 链
vi.mock('@/components/position/IconPickerPopover.vue', () => ({
  default: { name: 'IconPickerPopover', template: '<button class="icon-picker" />' }
}))

const stubs = {
  'el-drawer': {
    props: ['modelValue'],
    template: '<div class="el-drawer" v-if="modelValue"><slot /><div class="footer"><slot name="footer" /></div></div>'
  },
  'el-form': { template: '<form><slot /></form>' },
  // error prop 渲染成 data-error 供断言字段级红框回显
  'el-form-item': {
    props: ['error', 'label'],
    template: '<div class="el-form-item" :data-error="error"><slot name="label" /><slot /></div>'
  },
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input class="el-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-radio-group': { props: ['modelValue'], template: '<div class="el-radio-group"><slot /></div>' },
  'el-radio': { props: ['value'], template: '<label :data-value="value"><slot /></label>' },
  'el-select': { props: ['modelValue'], template: '<div class="el-select"><slot /></div>' },
  'el-option': { props: ['label', 'value'], template: '<div class="el-option" />' },
  'el-button': {
    props: ['type', 'loading'],
    emits: ['click'],
    template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-skeleton': { template: '<div />' },
  'el-empty': { template: '<div><slot /></div>' },
  'el-tag': { template: '<span><slot /></span>' },
  SchemaFieldEditor: { template: '<div class="schema-field-editor" />' }
}

let app, container
async function mountEditor(apiId) {
  const { default: Editor } = await import('@/components/admin/ApiEditor.vue')
  container = document.createElement('div')
  document.body.appendChild(container)
  const visible = ref(false)
  app = createApp({ render: () => h(Editor, { visible: visible.value, apiId }) })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  await nextTick()
  visible.value = true
  await nextTick(); await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick()
  return container
}
function findBtn(el, text) {
  return [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
}
// 读/写 form-item：含「只是查看（读）」radio 的那个 el-form-item
function readWriteItem(el) {
  return [...el.querySelectorAll('.el-form-item')].find((it) => it.textContent.includes('只是查看'))
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('N7 · ApiEditor 读/写字段级错误绑定', () => {
  it('数据层返回 field=readWrite 校验错误 → 读/写 form-item 的 :error 回显该消息', async () => {
    conn.updateApi.mockRejectedValueOnce({ field: 'readWrite', message: '读/写属性不合法' })
    const el = await mountEditor('api_1')
    // 读/写项默认无错误
    expect(readWriteItem(el).getAttribute('data-error')).toBeFalsy()
    // 保存触发字段错误
    findBtn(el, '保存').click()
    await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick()
    expect(conn.updateApi).toHaveBeenCalled()
    expect(readWriteItem(el).getAttribute('data-error')).toBe('读/写属性不合法')
  })
})
