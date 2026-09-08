// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * PublishCheckDialog（岗位发布门最后一道闸）行为契约（岗位编辑区加固批 #2，2026-08-08）。
 *
 * computePublishCheck 的计算口径已在 positionModel.test.js 覆盖；本文件守的是**弹窗这一层**——
 * 计算结果如何转成「发布按钮能不能点」。这是发布门真正的最后一道闸：判定写错则脏岗位可被发出去
 * （硬阻断项形同虚设），或干净岗位发不出去（误伤）。
 *
 * 提交门 = 硬检查通过 && 非到顶(atMax) && 版本号已算出且合法 && 升级说明非空，四条缺一不可，逐条穷举。
 * 另钉：有硬阻断时发布表单区不渲染（避免阻断项未修就先填版本，规格 N5）。
 *
 * 2026-09-08 PRD-20260908 对齐（md §3.7 / §9.2、原型 L1224）：版本号不再手填——「更新类型」三选一
 * （修订版本 / 功能更新 / 重大更新，v-model:bump 回吐由父级 useVersionPublish 算号）+ 只读版本号 + 类型 hint；
 * 首个版本无类型可选、hint「首个版本」。原「版本号未递增软提示」用例随手填路径废止。
 */

vi.mock('@element-plus/icons-vue', () => ({
  Check: { template: '<i />' },
  Close: { template: '<i />' },
  Warning: { template: '<i />' }
}))

import PublishCheckDialog from '@/components/position/PublishCheckDialog.vue'

const stubs = {
  'el-dialog': { template: '<div class="el-dialog"><slot /><slot name="footer" /></div>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-input': {
    props: ['modelValue'],
    template: '<div class="el-input-stub"><input :value="modelValue" /></div>'
  },
  'el-radio-group': {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: '<div class="el-radio-group" :data-value="modelValue"><slot /></div>'
  },
  'el-radio-button': {
    props: ['value'],
    template: '<button class="el-radio-btn" :data-v="value" @click="$parent.$emit(\'update:modelValue\', value)"><slot /></button>'
  },
  // 声明 emits:['click']，否则 Vue 会把 click 同时当原生监听器透传 → 一次点击触发两次 emit（假失败）
  'el-button': {
    props: ['disabled', 'type'],
    emits: ['click'],
    template:
      '<button class="el-button" :class="type" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  }
}

/** 硬检查全过 / 有硬阻断 两种 check 夹具（形状与 computePublishCheck 返回一致）。 */
const PASSED = { items: [{ key: 'name', label: '岗位名称已填写', ok: true, blocking: true }], blockingPassed: true, warnings: [] }
const BLOCKED = { items: [{ key: 'name', label: '岗位名称已填写', ok: false, blocking: true }], blockingPassed: false, warnings: [] }
const PASSED_WITH_WARN = {
  items: [
    { key: 'name', label: '岗位名称已填写', ok: true, blocking: true },
    { key: 'unhealthy', label: '1 个被引用工具当前异常', ok: false, blocking: false, warning: true }
  ],
  blockingPassed: true,
  warnings: [{ key: 'unhealthy' }]
}

let app, container, publishSpy

function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  publishSpy = vi.fn()
  app = createApp({
    render: () =>
      h(PublishCheckDialog, {
        visible: true,
        check: PASSED,
        versionLabel: 'v1.2.0',
        releaseNotes: '本次更新了 X',
        onPublish: publishSpy,
        ...props
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  return container
}

/** 底部「发布」主按钮（footer 第二个按钮）。 */
const publishBtn = (el) => [...el.querySelectorAll('.el-button')].find((b) => b.textContent.includes('发布'))

afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('PublishCheckDialog · 发布提交门穷举（四条缺一不可）', () => {
  it('全部满足 → 发布按钮可点，点击 emit publish', () => {
    const el = mount()
    const btn = publishBtn(el)
    expect(btn.disabled).toBe(false)
    btn.click()
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })

  it('有硬阻断项 → 发布按钮禁用，且版本号/升级说明区不渲染（N5：先修阻断再填版本）', () => {
    const el = mount({ check: BLOCKED })
    expect(publishBtn(el).disabled).toBe(true)
    expect(el.querySelector('.pub-ver')).toBeNull()
    expect(el.textContent).toContain('存在硬阻断项')
  })

  it('版本号未算出（上游降级留空）/ 非法 → 禁用并提示，不发空号', () => {
    let el = mount({ versionLabel: '' })
    expect(publishBtn(el).disabled).toBe(true)
    expect(el.textContent).toContain('版本号必填')
    app.unmount(); container.remove()
    el = mount({ versionLabel: 'v013' }) // 旧三位数字格式（2026-09-02 起废止）
    expect(publishBtn(el).disabled).toBe(true)
  })

  it('升级说明为空/纯空白 → 禁用（必填）', () => {
    const el = mount({ releaseNotes: '   ' })
    expect(publishBtn(el).disabled).toBe(true)
    expect(el.textContent).toContain('升级说明必填')
  })

  it('无法自动建议版本号（atMax）→ 禁用，并以 warning 语义告知（非错误）', () => {
    const el = mount({ atMax: true })
    expect(publishBtn(el).disabled).toBe(true)
    const maxHint = [...el.querySelectorAll('.check-hint.warn')].find((n) =>
      n.textContent.includes('无法自动生成建议版本号')
    )
    expect(maxHint, '无法自动建议应走 warning 语义提示').toBeTruthy()
  })

  it('仅 warning 项（无硬阻断）→ 仍可发布（warning 不阻断）', () => {
    const el = mount({ check: PASSED_WITH_WARN })
    expect(publishBtn(el).disabled).toBe(false)
    expect(el.textContent).toContain('存在告警项')
  })

  it('版本号只读展示（无输入框）+ 更新类型三选一文案与顺序照原型 L1224；点类型 emit update:bump', () => {
    const bumpSpy = vi.fn()
    const el = mount({ versionLabel: 'v1.2.1', bump: 'NONE', 'onUpdate:bump': bumpSpy })
    expect(el.querySelector('.pub-ver-num').textContent).toBe('v1.2.1')
    expect(el.querySelectorAll('.pub-ver .el-input-stub').length).toBe(1) // 仅升级说明一个输入框，版本号不可手输
    expect([...el.querySelectorAll('.el-radio-btn')].map((b) => b.textContent.trim())).toEqual(['修订版本', '功能更新', '重大更新'])
    expect(el.textContent).toContain('修复问题或小幅配置调整') // 选中类型 hint
    el.querySelector('.el-radio-btn[data-v="MAJOR"]').click()
    expect(bumpSpy).toHaveBeenCalledWith('MAJOR')
  })

  it('首个版本（firstPublish）→ 无更新类型可选，版本号 v1.0.0 + hint「首个版本」', () => {
    const el = mount({ versionLabel: 'v1.0.0', firstPublish: true })
    expect(el.querySelector('.el-radio-group')).toBeNull()
    expect(el.querySelector('.pub-ver-num').textContent).toBe('v1.0.0')
    expect(el.textContent).toContain('首个版本')
    expect(publishBtn(el).disabled).toBe(false)
  })

  it('publishing 中 → 按钮进 loading（父级防重复提交）', () => {
    const el = mount({ publishing: true })
    expect(publishBtn(el)).toBeTruthy()
  })
})
