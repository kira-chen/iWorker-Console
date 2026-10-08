// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import { installJsdomPolyfills, flushAll } from '@/views/admin/__tests__/helpers/smokeMount.js'
import DossierStrategySelect from '@/components/position/dossier/DossierStrategySelect.vue'

/**
 * 工作档案 ·「归纳方式」富下拉单测（2026-10-08 补测，零测试文件补齐）。
 *
 * 对齐口径：docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md §4.2.3「档案详情模块」——
 *   归纳方式：下拉，四选一——取最新（会被替换的状态）/ 累积成列表（只增不减的清单）/
 *   摘要最近 N 条（看趋势的叙述性字段）/ 保留冲突并列（变化即信号的数值）。
 * 《各模块必填选填字段一览表.md》#11：工作档案整体选填，不参与发布阻断（本组件无必填星标，红框由父级错误驱动）。
 *
 * 覆盖：四个选项的顺序 / 标题 / md 说明文字；触发器显示当前项「标题 + 说明」；
 * 选中某项回吐 update:modelValue 具体值；v-model 双向切换后触发器跟随；
 * 禁用态点不开浮层；invalid → 红框类；未知值兜底显示首项（防御性边界）。
 *
 * 挂载方式：真装 Element Plus（同 views/admin/__tests__/helpers/smokeMount.js 口径），
 * 下拉浮层 teleport 到 body，故每条用例后清空 body。
 */

let app, container
function mount(props = {}, { vModel = false } = {}) {
  installJsdomPolyfills()
  container = document.createElement('div')
  document.body.appendChild(container)
  const emitted = []
  const model = ref(props.modelValue)
  app = createApp({
    setup() {
      return () =>
        h(DossierStrategySelect, {
          ...props,
          ...(vModel ? { modelValue: model.value } : {}),
          'onUpdate:modelValue': (v) => {
            emitted.push(v)
            if (vModel) model.value = v
          }
        })
    }
  })
  app.use(ElementPlus)
  app.mount(container)
  return { container, emitted, model }
}
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const triggerTitle = (c) => c.querySelector('.ds-rich-trigger strong')?.textContent.trim()
const triggerHint = (c) => c.querySelector('.ds-rich-trigger > span')?.textContent.trim()
async function openDropdown(c) {
  c.querySelector('.el-select__wrapper').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushAll()
}
const optionItems = () => [...document.body.querySelectorAll('.ds-rich-popper .el-select-dropdown__item')]
const optionTitles = () => optionItems().map((li) => li.querySelector('.ds-rich-option strong').textContent.trim())

describe('DossierStrategySelect · 归纳方式四选一（岗位 md §4.2.3）', () => {
  it('展开下拉 → 恰好四个选项，顺序与标题照 md：取最新 / 累积成列表 / 摘要最近 N 条 / 保留冲突并列', async () => {
    // Arrange
    const { container: c } = mount({ modelValue: 'LATEST' })
    await flushAll()
    // Act
    await openDropdown(c)
    // Assert
    expect(optionTitles()).toEqual(['取最新', '累积成列表', '摘要最近 N 条', '保留冲突并列'])
  })

  it('每个选项右侧说明含 md 原文释义（会被替换的状态 / 只增不减的清单 / 看趋势的叙述性字段 / 变化即信号的数值）', async () => {
    const { container: c } = mount({ modelValue: 'LATEST' })
    await flushAll()
    await openDropdown(c)
    const hints = optionItems().map((li) => li.querySelector('.ds-rich-option > span').textContent)
    expect(hints).toHaveLength(4)
    expect(hints[0]).toContain('会被替换的状态')
    expect(hints[1]).toContain('只增不减的清单')
    expect(hints[2]).toContain('看趋势的叙述性字段')
    expect(hints[3]).toContain('变化即信号的数值')
  })

  it('触发器一行显示当前选中项「标题 + 说明」（SUMMARY → 摘要最近 N 条）', async () => {
    const { container: c } = mount({ modelValue: 'SUMMARY' })
    await flushAll()
    expect(triggerTitle(c)).toBe('摘要最近 N 条')
    expect(triggerHint(c)).toContain('看趋势的叙述性字段')
  })

  it('当前选中项在浮层中标记为已选（aria-selected=true），其余为 false', async () => {
    const { container: c } = mount({ modelValue: 'CONFLICTS' })
    await flushAll()
    await openDropdown(c)
    expect(optionItems().map((li) => li.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true'])
  })

  it('点选「累积成列表」→ 回吐 update:modelValue 载荷为 LIST（单次）', async () => {
    const { container: c, emitted } = mount({ modelValue: 'LATEST' })
    await flushAll()
    await openDropdown(c)
    // Act
    optionItems()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushAll()
    // Assert
    expect(emitted).toEqual(['LIST'])
  })

  it('v-model 双向：从取最新切到保留冲突并列 → 父值变为 CONFLICTS，触发器随之显示「保留冲突并列」', async () => {
    const { container: c, model } = mount({ modelValue: 'LATEST' }, { vModel: true })
    await flushAll()
    expect(triggerTitle(c)).toBe('取最新')
    await openDropdown(c)
    optionItems()[3].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushAll()
    expect(model.value).toBe('CONFLICTS')
    expect(triggerTitle(c)).toBe('保留冲突并列')
    expect(triggerHint(c)).toContain('变化即信号的数值')
  })

  it('未传 modelValue → 默认显示「取最新」', async () => {
    const { container: c } = mount({})
    await flushAll()
    expect(triggerTitle(c)).toBe('取最新')
  })

  it('异常值（不在四选一内）→ 触发器兜底显示首项「取最新」而不白屏', async () => {
    const { container: c } = mount({ modelValue: 'UNKNOWN' })
    await flushAll()
    expect(triggerTitle(c)).toBe('取最新')
    expect(triggerHint(c)).toContain('会被替换的状态')
  })

  it('disabled → 选择框禁用态，点击不展开浮层、不回吐任何值', async () => {
    const { container: c, emitted } = mount({ modelValue: 'LATEST', disabled: true })
    await flushAll()
    expect(c.querySelector('.el-select__wrapper').classList.contains('is-disabled')).toBe(true)
    await openDropdown(c)
    const popper = document.body.querySelector('.el-select__popper.ds-rich-popper')
    // 浮层要么未渲染，要么未显示
    expect(!popper || popper.style.display === 'none').toBe(true)
    expect(emitted).toEqual([])
  })

  it('invalid=true → 外层挂 is-err 红框类；invalid=false 不挂', async () => {
    const bad = mount({ modelValue: 'LATEST', invalid: true })
    await nextTick()
    expect(bad.container.querySelector('.ds-rich').classList.contains('is-err')).toBe(true)
    app.unmount()
    document.body.innerHTML = ''
    const ok = mount({ modelValue: 'LATEST', invalid: false })
    await nextTick()
    expect(ok.container.querySelector('.ds-rich').classList.contains('is-err')).toBe(false)
  })
})
