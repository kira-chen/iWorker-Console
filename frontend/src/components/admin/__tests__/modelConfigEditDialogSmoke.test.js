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
 * 【校验用例断真 ElForm DOM 红字】2026-09-12 审计 J22 闭环：vitest.config `server.deps.inline` 已内联
 * element-plus + async-validator（async-validator 是 CJS，被 Node 外置加载后 ElFormItem 内 `new AsyncValidator()`
 * 抛错、ElForm.validate 吞成 resolve(true)），真 ElForm 在 jsdom 里的校验从此可信——
 * 下面四条校验用例一律：真输入 / 真点【接入】→ 断 `.el-form-item__error` 红字文案 + createModel 未被调。
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
/** 真 el-form 实例挂在 form.el-form 元素的 __vueParentComponent 上，props.model 即组件的 reactive form（供无法用键盘输入的 el-select allow-create 项直接落值） */
const formModel = () => drawer().querySelector('form.el-form').__vueParentComponent.props.model
/** 页内所有就地红字（真 ElFormItem 渲染的 .el-form-item__error） */
const errorTexts = () => [...drawer().querySelectorAll('.el-form-item__error')].map((e) => e.textContent.trim())
/** 某输入框所在表单项的红字（无则空串） */
const errorOf = (el) => el.closest('.el-form-item').querySelector('.el-form-item__error')?.textContent.trim() ?? ''
/** 真输入：改 value → input 事件（v-model）→ blur（触发 trigger:'blur' 校验） */
function typeInto(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}
const clickFoot = (label) => [...drawer().querySelectorAll('.el-drawer__footer .el-button')].find((b) => b.textContent.trim() === label).click()
/**
 * 等红字落到 DOM：ElFormItem 2.14 的 shouldShowError 读的是 refDebounced(validateState, 100) —— async-validator
 * 异步出结论后、红字还要再等 100ms 防抖才渲染/消失，故这里真等 250ms 再冲刷渲染队列（不是 flaky 补丁，是组件设计；
 * 实测 120ms 偶发赶不上「结论 + 防抖」两段）。
 */
/**
 * 等 ElFormItem 的红字稳定下来。
 * element-plus 2.14 的 ElFormItem.shouldShowError 读 refDebounced(validateState, 100)，
 * 校验结果要过 100ms 防抖才反映到 DOM。本用例既断「红字出现」也断「红字消失」，不能按条数轮询；
 * 固定 sleep 又在全量并发下偶发不够（2026-09-13 实测：单跑绿、全量偶红）。
 * 故改为「轮询到红字集合连续两轮不变即认为已稳定」，最长兜底 3s——与机器快慢解耦。
 */
async function settleErrors() {
  let prev = null
  let stable = 0
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 50))
    await flushAll(2)
    const cur = errorTexts().join('|')
    stable = cur === prev ? stable + 1 : 0
    prev = cur
    // 至少等过一次防抖窗（100ms）再认稳定，避免校验还没开始就"稳定"了
    if (stable >= 2 && i >= 3) return
  }
  await flushAll(4)
}

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

  it('A12 · 空表单点【接入】：必填项全部就地红字（提供商/名称/类别/Base URL/标识/上下文窗口/api_key）+ toast「请先修正标红项」+ createModel 未被调（md §三.5 L309-310）', async () => {
    mounted = mountReal(Dialog, { visible: true, model: null })
    await flushAll(10)
    clickFoot('接入')
    await settleErrors()
    expect(api.createModel).not.toHaveBeenCalled()
    expect(errorTexts()).toEqual(expect.arrayContaining([
      '请选择模型提供商', '请输入模型名称', '请选择模型类别', '请输入服务地址（Base URL）',
      '请输入模型标识（如 deepseek-chat）', '请选择或输入上下文窗口', '请输入 api_key'
    ]))
    expect(document.body.querySelector('.el-message')?.textContent).toContain('请先修正标红项')
  })

  it('A12 · base_url：输 ftp://x 失焦 → 红字「服务地址必须以 http:// 或 https:// 开头，且不能包含空格、? 或 #」；改成 https://api.deepseek.com/v1 → 红字消失（md §三.2 / §三.8）', async () => {
    mounted = mountReal(Dialog, { visible: true, model: null })
    await flushAll(10)
    const input = drawer().querySelector('input[placeholder="如 https://api.deepseek.com/v1"]')
    for (const bad of ['ftp://x', 'https://a b/v1', 'https://a/v1?x=1']) {
      typeInto(input, bad)
      await settleErrors()
      expect(errorOf(input), bad).toBe('服务地址必须以 http:// 或 https:// 开头，且不能包含空格、? 或 #')
    }
    typeInto(input, 'https://api.deepseek.com/v1')
    await settleErrors()
    expect(errorOf(input)).toBe('')
    // 其它必填仍空 → 点【接入】依旧被拦，且 Base URL 这一项不再报错
    clickFoot('接入')
    await settleErrors()
    expect(api.createModel).not.toHaveBeenCalled()
    expect(errorOf(input)).toBe('')
  })

  it('A12 · 上下文窗口：512 / "128K" → 红字「请输入 token 数字（≥1024），如 65536；不要带 K 等单位」；65536 → 该项无红字（md §三.2 / §三.8）', async () => {
    mounted = mountReal(Dialog, { visible: true, model: null })
    await flushAll(10)
    // el-select 2.14 的占位是 span 不是 input placeholder，按表单项 label 定位
    const item = [...drawer().querySelectorAll('.el-form-item')].find((i) => i.querySelector('.el-form-item__label')?.textContent.includes('上下文窗口'))
    const msg = '请输入 token 数字（≥1024），如 65536；不要带 K 等单位'
    for (const bad of [512, '128K']) {
      formModel().contextWindow = bad // allow-create 手输值落到 form.contextWindow，change 触发校验
      await settleErrors()
      expect(item.querySelector('.el-form-item__error')?.textContent ?? '', String(bad)).toBe(msg)
    }
    formModel().contextWindow = 65536
    await settleErrors()
    expect(item.querySelector('.el-form-item__error')).toBeNull()
    clickFoot('接入')
    await settleErrors()
    expect(api.createModel).not.toHaveBeenCalled() // 其它必填仍空
    expect(item.querySelector('.el-form-item__error')).toBeNull()
  })

  it('A12 · 额外参数："[1]" → 红字「必须是 JSON 对象，如 {"enable_thinking": false}」；坏 JSON → 「不是合法的 JSON，请检查格式」；清空 → 红字消失（md §三.4.1 / §三.8）', async () => {
    mounted = mountReal(Dialog, { visible: true, model: null })
    await flushAll(10)
    const ta = drawer().querySelector('textarea')
    typeInto(ta, '[1]')
    await settleErrors()
    expect(errorOf(ta)).toBe('必须是 JSON 对象，如 {"enable_thinking": false}')
    typeInto(ta, '{bad json')
    await settleErrors()
    expect(errorOf(ta)).toBe('不是合法的 JSON，请检查格式')
    typeInto(ta, '')
    await settleErrors()
    expect(errorOf(ta)).toBe('')
    clickFoot('接入')
    await settleErrors()
    expect(api.createModel).not.toHaveBeenCalled()
    expect(errorOf(ta)).toBe('')
  })

  it('A12 · 鉴权：接入态 API Key 缺 → 红字「请输入 api_key」；切 AppID / AppSecret 后点【接入】→ 「请输入 app_id」「请输入 app_secret」；编辑态密钥留空点【保存】不报错、直接 updateModel（md §三.3.1 / §三.3.2 L261-262 / §三.8）', async () => {
    mounted = mountReal(Dialog, { visible: true, model: null })
    await flushAll(10)
    clickFoot('接入')
    await settleErrors()
    expect(errorTexts()).toContain('请输入 api_key')
    expect(errorTexts()).not.toContain('请输入 app_id')
    // 真 el-radio 切换鉴权方式 → 三元组字段出现，再点【接入】三元组必填红字
    const radio = [...drawer().querySelectorAll('.el-radio')].find((r) => r.textContent.includes('AppID / AppSecret'))
    radio.querySelector('input[type="radio"]').click()
    await flushAll(4)
    expect(drawer().querySelector('input[placeholder="应用归属标识（不参与 HTTP 调用）"]')).toBeTruthy()
    clickFoot('接入')
    await settleErrors()
    expect(api.createModel).not.toHaveBeenCalled()
    expect(errorTexts()).toEqual(expect.arrayContaining(['请输入 app_id', '请输入 app_secret']))
    mounted.unmount()

    // 编辑态：api_key / app_secret 留空 = 保留原值，不再必填 → 全部必填齐备时点【保存】直接落 updateModel
    api.updateModel.mockResolvedValue({})
    mounted = mountReal(Dialog, {
      visible: true,
      model: {
        id: 'md_x', name: 'X', providerName: 'deepseek', category: 'TEXT', icon: '▦',
        baseUrl: 'https://a/v1', model: 'm', contextWindow: 65536,
        authType: 'APP_ID_SECRET', appId: 'iw', apiKeyMasked: 'a***b', hasAppSecret: true, status: 'DRAFT'
      }
    })
    await flushAll(10)
    clickFoot('保存')
    await settleErrors()
    expect(errorTexts()).toEqual([])
    expect(api.updateModel).toHaveBeenCalledTimes(1)
    expect(api.updateModel.mock.calls[0][1]).toMatchObject({ apiKey: null, appSecret: null, appId: 'iw' })
  })
})
