// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ElMessage } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * ModelConfigEditDialog.vue 真实挂载冒烟 + 表单校验规则（2026-09-12 测试审计 T50 / T55·A12）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/模型/prd-模型.md
 *   §三.1 三态标题（接入模型 / 编辑模型 / 查看模型）/ §三.2 基本信息 / §三.3 鉴权 / §三.5 底部按钮 / §三.8 编辑页异常场景。
 *
 * 与 modelConfigEditDialog.test.js（el-form 桩、validate 恒 true）互补：这里真装 Element Plus、真 el-drawer / el-form。
 *
 * 【为什么校验用例断言 rules 对象而不是 DOM 红字】当前 vitest 配置下 element-plus 走 Node 外置加载，
 * 其依赖 async-validator 是 CJS（exports.default），Node ESM 互操作拿到的 default 是整个 exports 对象，
 * ElFormItem 内 `new AsyncValidator()` 直接抛错 → 真 ElForm 在 jsdom 里永远校验不出红字
 * （实测把 vitest.config `server.deps.inline` 加上 element-plus + async-validator 即可跑通，属配置改动、非本轮范围）。
 * 同一原因下 ElForm.validate 会把「字段校验抛错」吞成 resolve(true)，所以「空表单点【接入】被拦」这类 DOM 用例
 * 在 jsdom 里也不可信（会假绿或假红），一律不写；该行为由 modelConfigEditDialog.test.js 的 D6 用例（validate 桩 reject）守。
 * 故按审计任务书退化方案：从真 el-form 实例的 props.rules 取到组件传入的规则，逐条调 pattern / validator 断言。
 */

const api = { createModel: vi.fn(), updateModel: vi.fn(), verifyModel: vi.fn() }
vi.mock('@/api/adminModel', () => api)

const Dialog = (await import('@/components/admin/ModelConfigEditDialog.vue')).default

let mounted
afterEach(() => {
  ElMessage.closeAll()
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

const drawer = () => mounted.container.querySelector('.el-drawer')
const footBtns = () => [...drawer().querySelectorAll('.el-drawer__footer .el-button')].map((b) => b.textContent.trim())
/** 真 el-form 实例挂在 form.el-form 元素的 __vueParentComponent 上，props.rules 即组件传入的 :rules（computed 已解包） */
const formRules = () => drawer().querySelector('form.el-form').__vueParentComponent.props.rules
/** 跑一条自定义 validator，回吐错误文案或 null */
const runValidator = (rule, value) => new Promise((resolve) => rule.validator({}, value, (e) => resolve(e ? e.message : null)))

describe('ModelConfigEditDialog · 真实挂载冒烟（真 el-drawer / el-form）', () => {
  it('接入态挂载不抛：标题「接入模型」+ 三分区卡 + footer【取消】【接入】；编辑态【取消】【重新验证】【保存】；查看态仅【关闭】（md §三.1 / §三.5）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => { mounted = mountReal(Dialog, { visible: true, model: null }) }).not.toThrow()
    await flushAll(10)
    expect(drawer()).toBeTruthy()
    expect(drawer().querySelector('.de-head-title').textContent).toBe('接入模型')
    const titles = [...drawer().querySelectorAll('.section-title')].map((t) => t.textContent.trim().split(/\s+/)[0])
    expect(titles).toEqual(['基本信息', '连接与鉴权', '能力信息'])
    expect(footBtns()).toEqual(['取消', '接入'])
    // md §三.2 占位：模型标识 / 鉴权方式两选项 / 能力信息接入引导
    expect(drawer().querySelector('input[placeholder="填写平台文档里的模型调用标识，如 deepseek-chat"]')).toBeTruthy()
    expect([...drawer().querySelectorAll('.el-radio')].map((r) => r.textContent.trim())).toEqual(['API Key', 'AppID / AppSecret'])
    expect(drawer().textContent).toContain('接入并验证后自动识别流式、工具、JSON 和推理能力。')
    expect(errSpy).not.toHaveBeenCalled()
    mounted.unmount()

    mounted = mountReal(Dialog, { visible: true, model: { id: 'md_1', name: '老模型', baseUrl: 'https://a/v1', model: 'm', authType: 'API_KEY', apiKeyMasked: 'sk-****0ab', status: 'PUBLISHED' } })
    await flushAll(10)
    expect(drawer().querySelector('.de-head-title').textContent).toBe('编辑模型')
    expect(footBtns()).toEqual(['取消', '重新验证', '保存'])
    expect(drawer().textContent).toContain('当前：sk-****0ab')
    expect(drawer().querySelector('input[placeholder="留空不修改"]')).toBeTruthy() // md §三.3.1「已配置 · 留空不修改」
    mounted.unmount()

    mounted = mountReal(Dialog, { visible: true, readonly: true, model: { id: 'md_1', name: '老模型', status: 'PUBLISHED' } })
    await flushAll(10)
    expect(drawer().querySelector('.de-head-title').textContent).toBe('查看模型')
    expect(footBtns()).toEqual(['关闭'])
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('校验规则 · base_url：必填「请输入服务地址（Base URL）」；ftp://x / 带空格 / 带 ? # 均不过 pattern，文案「服务地址必须以 http:// 或 https:// 开头，且不能包含空格、? 或 #」（md §三.2 / §三.8）', async () => {
    mounted = mountReal(Dialog, { visible: true, model: null })
    await flushAll(10)
    const [required, pattern] = formRules().baseUrl
    expect(required).toEqual(expect.objectContaining({ required: true, message: '请输入服务地址（Base URL）' }))
    expect(pattern.message).toBe('服务地址必须以 http:// 或 https:// 开头，且不能包含空格、? 或 #')
    for (const bad of ['ftp://x', 'api.deepseek.com/v1', 'https://a b/v1', 'https://a/v1?x=1', 'https://a/v1#frag']) {
      expect(pattern.pattern.test(bad), bad).toBe(false)
    }
    expect(pattern.pattern.test('https://api.deepseek.com/v1')).toBe(true)
    expect(pattern.pattern.test('http://model-gateway.intra/v1')).toBe(true)
  })

  it('校验规则 · 上下文窗口：必填「请选择或输入上下文窗口」；512 / 1023 / "128K" 报「请输入 token 数字（≥1024），如 65536；不要带 K 等单位」，65536 / "1024" 放行（md §三.2 / §三.8）', async () => {
    mounted = mountReal(Dialog, { visible: true, model: null })
    await flushAll(10)
    const [required, custom] = formRules().contextWindow
    expect(required).toEqual(expect.objectContaining({ required: true, message: '请选择或输入上下文窗口' }))
    const msg = '请输入 token 数字（≥1024），如 65536；不要带 K 等单位'
    await expect(runValidator(custom, 512)).resolves.toBe(msg)
    await expect(runValidator(custom, 1023)).resolves.toBe(msg)
    await expect(runValidator(custom, '128K')).resolves.toBe(msg)
    await expect(runValidator(custom, 65536)).resolves.toBeNull()
    await expect(runValidator(custom, '1024')).resolves.toBeNull()
  })

  it('校验规则 · 额外参数："[1]"（数组）报「必须是 JSON 对象，如 {"enable_thinking": false}」；坏 JSON 报「不是合法的 JSON，请检查格式」；空 / 合法对象放行（md §三.4.1 / §三.8）', async () => {
    mounted = mountReal(Dialog, { visible: true, model: null })
    await flushAll(10)
    const [custom] = formRules().extraBody
    await expect(runValidator(custom, '[1]')).resolves.toBe('必须是 JSON 对象，如 {"enable_thinking": false}')
    await expect(runValidator(custom, 'null')).resolves.toBe('必须是 JSON 对象，如 {"enable_thinking": false}')
    await expect(runValidator(custom, '{bad json')).resolves.toBe('不是合法的 JSON，请检查格式')
    await expect(runValidator(custom, '')).resolves.toBeNull()
    await expect(runValidator(custom, '{"enable_thinking": false}')).resolves.toBeNull()
  })

  it('校验规则 · 鉴权：API Key 态只要 api_key；切到 AppID / AppSecret 后 app_id / app_secret 必填「请输入 app_id」「请输入 app_secret」；编辑态密钥留空不校验（md §三.3.1 / §三.3.2 / §三.8「鉴权信息不完整」）', async () => {
    mounted = mountReal(Dialog, { visible: true, model: null })
    await flushAll(10)
    expect(formRules().apiKey).toEqual([expect.objectContaining({ required: true, message: '请输入 api_key' })])
    expect(formRules().appId).toEqual([])
    expect(formRules().appSecret).toEqual([])
    // 真 el-radio 切换鉴权方式 → 三元组字段出现 + 规则跟着变
    const radio = [...drawer().querySelectorAll('.el-radio')].find((r) => r.textContent.includes('AppID / AppSecret'))
    radio.querySelector('input[type="radio"]').click()
    await flushAll(4)
    expect(drawer().querySelector('input[placeholder="应用归属标识（不参与 HTTP 调用）"]')).toBeTruthy()
    expect(drawer().querySelector('input[placeholder="平台分配的 APISecret"]')).toBeTruthy()
    expect(formRules().appId).toEqual([expect.objectContaining({ required: true, message: '请输入 app_id' })])
    expect(formRules().appSecret).toEqual([expect.objectContaining({ required: true, message: '请输入 app_secret' })])
    mounted.unmount()

    // 编辑态：api_key / app_secret 留空 = 保留原值，不再必填（md §三.3.2 L261-262）
    mounted = mountReal(Dialog, { visible: true, model: { id: 'md_x', name: 'X', authType: 'APP_ID_SECRET', appId: 'iw', apiKeyMasked: 'a***b', hasAppSecret: true, status: 'DRAFT' } })
    await flushAll(10)
    expect(formRules().apiKey).toEqual([])
    expect(formRules().appSecret).toEqual([])
    expect(formRules().appId).toEqual([expect.objectContaining({ required: true })])
  })
})
