// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * FieldHelpLabel（表单字段标签 + ? 悬浮说明）—— 2026-10-08 补测（此前零测试）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/模型/prd-模型.md：
 *   「每项主要配置均提供问号说明，鼠标悬停可查看用途和填写建议」；「能力标签旁提供问号说明，鼠标悬停可查看各能力含义」。
 * 基本是纯展示组件，覆盖点仅：标签文字 + 问号图标渲染；悬停问号后浮层展示 tip 文案（挂 body、带 fhl-popper 限宽类）。
 * 真实挂载 Element Plus（el-tooltip 真浮层），无外部依赖需打桩。
 */
import FieldHelpLabel from '@/components/admin/FieldHelpLabel.vue'

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('FieldHelpLabel', () => {
  it('渲染标签文字与问号图标；未悬停时不展示说明', async () => {
    mounted = mountReal(FieldHelpLabel, { label: 'base_url', tip: '模型服务的接口地址' })
    await flushAll(2)
    const root = mounted.container.querySelector('.fhl')
    expect(root.textContent.trim()).toBe('base_url')
    expect(root.querySelector('.fhl-icon svg')).toBeTruthy()
    // el-tooltip 懒渲染：未悬停时浮层不进 DOM
    expect(document.body.querySelector('.fhl-popper')).toBeNull()
    expect(document.body.textContent).not.toContain('模型服务的接口地址')
  })

  it('鼠标悬停问号 → 浮层展示 tip 说明文案（md：鼠标悬停可查看用途和填写建议）', async () => {
    mounted = mountReal(FieldHelpLabel, { label: '温度', tip: '数值越高回答越发散' })
    await flushAll(2)
    const icon = mounted.container.querySelector('.fhl-icon')
    icon.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    await flushAll(4)
    const popper = document.body.querySelector('.fhl-popper')
    expect(popper).toBeTruthy()
    expect(popper.textContent).toContain('数值越高回答越发散')
  })
})
