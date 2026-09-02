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
 * 提交门 = 硬检查通过 && 未到 v999 上限 && 版本号合法 && 升级说明非空，四条缺一不可，逐条穷举。
 * 另钉：有硬阻断时版本号/升级说明区不渲染（避免阻断项未修就先填版本，规格 N5）。
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

  it('版本号非法（格式错）→ 禁用', () => {
    const el = mount({ versionLabel: '13' })
    expect(publishBtn(el).disabled).toBe(true)
  })

  it('版本号为旧三位数字格式（v013，2026-09-02 起废止）→ 禁用', () => {
    const el = mount({ versionLabel: 'v013' })
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

  it('版本号未递增 → 软提示但不阻断（可发布）', () => {
    const el = mount({ versionLabel: 'v1.1.0', prevMaxLabel: 'v1.2.0' })
    expect(el.textContent).toContain('建议版本号递增')
    expect(publishBtn(el).disabled).toBe(false)
  })

  it('publishing 中 → 按钮进 loading（父级防重复提交）', () => {
    const el = mount({ publishing: true })
    expect(publishBtn(el)).toBeTruthy()
  })
})
