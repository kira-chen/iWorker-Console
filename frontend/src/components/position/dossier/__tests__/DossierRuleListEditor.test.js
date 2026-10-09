// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, ref } from 'vue'
import ElementPlus from 'element-plus'
import { installJsdomPolyfills, flushAll } from '@/views/admin/__tests__/helpers/smokeMount.js'
import DossierRuleListEditor from '@/components/position/dossier/DossierRuleListEditor.vue'

/**
 * 工作档案 ·「档案详情」规则行内网格单测（2026-10-08 补测，零测试文件补齐）。
 *
 * 对齐口径：docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md §4.2.3「档案详情模块」——
 *   规则名（自由输入）/ 规则描述（提示词，最多 200 字符）/ 归纳方式（下拉四选一；选「摘要最近 N 条」后
 *   下方出现「最近 x 条」数字输入框，x 下限 1、上限 10、默认 5）/ × 删除当前规则 / ＋ 新增条目（最多 8 条）。
 * 《各模块必填选填字段一览表.md》#11：工作档案选填、不参与发布阻断；规则描述最多 200 字符（行内备注类）。
 *
 * 覆盖：表头四列；空列表只有「＋ 新增条目」；新增回吐（空行、默认 x=5）；8 条上限点新增回吐 limit 不加行；
 * 删除指定行；规则名 / 规则描述行内编辑回吐（其余行不动）；规则描述 maxlength=200；
 * 归纳方式切 SUMMARY 联动出现 / 切走消失「最近 x 条」；x 修改回吐且保留其它 params；
 * 父级行错误回显（红框 + 行下错误文案）与全局错误；只读态无增删入口、控件全禁用。
 * 疑似缺陷（it.fails）：x 上限代码为 50，md 为 10。
 *
 * 挂载方式：真装 Element Plus；宿主用 ref 实现 v-model:rows 回写，同时记录每次 update:rows 载荷。
 */

let app, container
function mount(initialRows = [], extra = {}) {
  installJsdomPolyfills()
  container = document.createElement('div')
  document.body.appendChild(container)
  const rows = ref(initialRows)
  const emitted = []
  const limits = []
  app = createApp({
    setup() {
      return () =>
        h(DossierRuleListEditor, {
          rows: rows.value,
          ...extra,
          'onUpdate:rows': (v) => {
            emitted.push(v)
            rows.value = v
          },
          onLimit: () => limits.push(true)
        })
    }
  })
  app.use(ElementPlus)
  app.mount(container)
  return { container, rows, emitted, limits }
}
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const rule = (key, strategy = 'LATEST', extra = {}) => ({
  key,
  desc: `${key}描述`,
  strategy,
  params: { n: 5, staleAfterDays: null, normalize: true },
  ...extra
})
const rowEls = (c) => [...c.querySelectorAll('.drg-row')]
const addBtn = (c) => c.querySelector('.drg-add')
const keyInput = (c, i) => rowEls(c)[i].querySelectorAll('.el-input__inner')[0]
const descInput = (c, i) => rowEls(c)[i].querySelectorAll('.el-input__inner')[1]
const nInput = (c, i) => rowEls(c)[i].querySelector('.drg-inline .el-input-number input')
async function typeInto(input, value) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushAll()
}
async function setNumber(input, value) {
  input.value = String(value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flushAll()
}
async function pickStrategy(c, rowIdx, optionIdx) {
  rowEls(c)[rowIdx].querySelector('.el-select__wrapper').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushAll()
  const poppers = [...document.body.querySelectorAll('.el-select__popper.ds-rich-popper')]
  const visible = poppers.find((p) => p.getAttribute('aria-hidden') === 'false') || poppers[poppers.length - 1]
  visible.querySelectorAll('.el-select-dropdown__item')[optionIdx].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushAll()
}

describe('DossierRuleListEditor · 档案详情规则网格（岗位 md §4.2.3）', () => {
  describe('结构与空态', () => {
    it('表头四列：规则名 / 规则描述 / 归纳方式 / 操作占位', async () => {
      const { container: c } = mount([])
      await flushAll()
      const heads = [...c.querySelectorAll('.drg-head > span')].map((s) => s.textContent.trim())
      expect(heads).toEqual(['规则名', '规则描述', '归纳方式', ''])
    })

    it('空列表（边界）→ 无规则行，仅显示「＋ 新增条目」入口，无错误文案', async () => {
      const { container: c } = mount([])
      await flushAll()
      expect(rowEls(c)).toHaveLength(0)
      expect(addBtn(c).textContent.trim()).toBe('＋ 新增条目')
      expect(c.querySelector('.drg-err-text')).toBeNull()
    })

    it('有规则时每行回显 规则名 / 规则描述 / 归纳方式，且每行带 × 删除按钮', async () => {
      const { container: c } = mount([rule('指标表现', 'LIST'), rule('异常原因', 'CONFLICTS')])
      await flushAll()
      expect(rowEls(c)).toHaveLength(2)
      expect(keyInput(c, 0).value).toBe('指标表现')
      expect(descInput(c, 1).value).toBe('异常原因描述')
      expect(rowEls(c)[0].querySelector('.ds-rich-trigger strong').textContent).toBe('累积成列表')
      expect(rowEls(c)[1].querySelector('.ds-rich-trigger strong').textContent).toBe('保留冲突并列')
      expect(c.querySelectorAll('.drg-del')).toHaveLength(2)
    })
  })

  describe('新增与上限（最多 8 条）', () => {
    it('空列表点「＋ 新增条目」→ 回吐 1 行空规则（规则名 / 描述为空，x 默认 5）', async () => {
      const { container: c, emitted, limits } = mount([])
      await flushAll()
      addBtn(c).click()
      await flushAll()
      expect(emitted).toHaveLength(1)
      expect(emitted[0]).toHaveLength(1)
      expect(emitted[0][0]).toMatchObject({ key: '', desc: '' })
      expect(emitted[0][0].params.n).toBe(5)
      expect(limits).toEqual([])
      expect(rowEls(c)).toHaveLength(1)
    })

    it('已有 7 条（上限前一条）点新增 → 回吐 8 条，原 7 条原样保留在前', async () => {
      const seven = Array.from({ length: 7 }, (_, i) => rule(`r${i}`))
      const { container: c, emitted, limits } = mount(seven)
      await flushAll()
      addBtn(c).click()
      await flushAll()
      expect(emitted).toHaveLength(1)
      expect(emitted[0]).toHaveLength(8)
      expect(emitted[0].slice(0, 7)).toEqual(seven)
      expect(limits).toEqual([])
    })

    it('已满 8 条（上限）点新增 → 不回吐 update:rows、改回吐 limit 事件，行数仍为 8', async () => {
      const eight = Array.from({ length: 8 }, (_, i) => rule(`r${i}`))
      const { container: c, emitted, limits } = mount(eight)
      await flushAll()
      addBtn(c).click()
      await flushAll()
      expect(emitted).toEqual([])
      expect(limits).toHaveLength(1)
      expect(rowEls(c)).toHaveLength(8)
    })
  })

  describe('删除', () => {
    it('点第 2 行 × → 回吐删掉该行后的数组（第 1、3 行保留且顺序不变）', async () => {
      const rows = [rule('a'), rule('b'), rule('c')]
      const { container: c, emitted } = mount(rows)
      await flushAll()
      c.querySelectorAll('.drg-del')[1].click()
      await flushAll()
      expect(emitted).toEqual([[rows[0], rows[2]]])
      expect(rowEls(c)).toHaveLength(2)
    })

    it('删除唯一一行 → 回吐空数组，回到空态', async () => {
      const { container: c, emitted } = mount([rule('only')])
      await flushAll()
      c.querySelector('.drg-del').click()
      await flushAll()
      expect(emitted).toEqual([[]])
      expect(rowEls(c)).toHaveLength(0)
    })
  })

  describe('行内编辑', () => {
    it('改第 1 行规则名 → 回吐该行 key 更新、其余字段与其它行不变', async () => {
      const rows = [rule('a'), rule('b')]
      const { container: c, emitted } = mount(rows)
      await flushAll()
      await typeInto(keyInput(c, 0), '指标表现')
      expect(emitted).toHaveLength(1)
      expect(emitted[0]).toEqual([{ ...rows[0], key: '指标表现' }, rows[1]])
    })

    it('改第 2 行规则描述 → 回吐该行 desc 更新', async () => {
      const rows = [rule('a'), rule('b')]
      const { container: c, emitted } = mount(rows)
      await flushAll()
      await typeInto(descInput(c, 1), '记录核心指标及环比、同比变化')
      expect(emitted.at(-1)).toEqual([rows[0], { ...rows[1], desc: '记录核心指标及环比、同比变化' }])
    })

    it('规则描述输入框限长 200 字符（md：最多 200 个字符）；规则名无此 200 限制', async () => {
      const { container: c } = mount([rule('a')])
      await flushAll()
      expect(descInput(c, 0).getAttribute('maxlength')).toBe('200')
      expect(keyInput(c, 0).getAttribute('maxlength')).not.toBe('200')
    })
  })

  describe('归纳方式与「最近 x 条」联动', () => {
    it('非 SUMMARY 行不显示「最近 x 条」输入框', async () => {
      const { container: c } = mount([rule('a', 'LATEST'), rule('b', 'LIST'), rule('c', 'CONFLICTS')])
      await flushAll()
      expect(c.querySelectorAll('.drg-inline')).toHaveLength(0)
    })

    it('切到「摘要最近 N 条」→ 回吐 strategy=SUMMARY（params 不丢），下方出现「最近 x 条」输入框且默认 5', async () => {
      const rows = [rule('a', 'LATEST')]
      const { container: c, emitted } = mount(rows)
      await flushAll()
      await pickStrategy(c, 0, 2)
      expect(emitted.at(-1)).toEqual([{ ...rows[0], strategy: 'SUMMARY' }])
      const inline = rowEls(c)[0].querySelector('.drg-inline')
      expect(inline).not.toBeNull()
      expect(inline.textContent.replace(/\s+/g, '')).toBe('最近条')
      expect(nInput(c, 0).value).toBe('5')
    })

    it('从 SUMMARY 切回「取最新」→ 回吐 strategy=LATEST，「最近 x 条」输入框消失', async () => {
      const rows = [rule('a', 'SUMMARY')]
      const { container: c, emitted } = mount(rows)
      await flushAll()
      expect(nInput(c, 0)).not.toBeNull()
      await pickStrategy(c, 0, 0)
      expect(emitted.at(-1)).toEqual([{ ...rows[0], strategy: 'LATEST' }])
      expect(rowEls(c)[0].querySelector('.drg-inline')).toBeNull()
    })

    it('x 下限为 1：输入框 min=1', async () => {
      const { container: c } = mount([rule('a', 'SUMMARY')])
      await flushAll()
      expect(nInput(c, 0).getAttribute('min')).toBe('1')
    })

    it('改 x 为 7 → 回吐该行 params.n=7，params 其余键保留', async () => {
      const rows = [rule('a', 'SUMMARY'), rule('b')]
      const { container: c, emitted } = mount(rows)
      await flushAll()
      await setNumber(nInput(c, 0), 7)
      expect(emitted.at(-1)).toEqual([{ ...rows[0], params: { ...rows[0].params, n: 7 } }, rows[1]])
    })

    it('行缺 params（异常数据）时改 x → 回吐 params 只含 n，不抛错', async () => {
      const { container: c, emitted } = mount([{ key: 'a', desc: '', strategy: 'SUMMARY' }])
      await flushAll()
      await setNumber(nInput(c, 0), 3)
      expect(emitted.at(-1)).toEqual([{ key: 'a', desc: '', strategy: 'SUMMARY', params: { n: 3 } }])
    })

    it.fails('x 上限应为 10：输入框 max=10（疑似缺陷：代码 SUMMARY_N_RANGE.max=50；md §4.2.3「x 下限 1，上限 10，默认 5」）', async () => {
      const { container: c } = mount([rule('a', 'SUMMARY')])
      await flushAll()
      // 前提：x 输入框已渲染、下限正确
      expect(nInput(c, 0).getAttribute('min')).toBe('1')
      expect(nInput(c, 0).getAttribute('max')).toBe('10')
    })

    it.fails('输入 x=20 超上限 → 应被钳到 10 再回吐（疑似缺陷：代码按 50 钳，原样回吐 20；md §4.2.3 上限 10）', async () => {
      const rows = [rule('a', 'SUMMARY')]
      const { container: c, emitted } = mount(rows)
      await flushAll()
      await setNumber(nInput(c, 0), 20)
      // 前提：修改确有回吐
      expect(emitted.length).toBeGreaterThan(0)
      expect(emitted.at(-1)[0].params.n).toBe(10)
    })
  })

  describe('错误回显', () => {
    it('父级 rowErrors：对应控件挂红框、行下合并显示错误文案（以 · 分隔）', async () => {
      const { container: c } = mount([rule('', 'LATEST'), rule('b')], {
        rowErrors: { 0: { key: '键名不能为空', strategy: '请选择归纳方式' } }
      })
      await flushAll()
      const row0 = rowEls(c)[0]
      const inputs = row0.querySelectorAll(':scope > .el-input')
      expect(inputs[0].classList.contains('is-err')).toBe(true)
      expect(inputs[1].classList.contains('is-err')).toBe(false)
      expect(row0.querySelector('.ds-rich').classList.contains('is-err')).toBe(true)
      const errs = [...c.querySelectorAll('.drg-row-err')].map((e) => e.textContent.trim())
      expect(errs).toEqual(['键名不能为空 · 请选择归纳方式'])
    })

    it('rowErrors 中空串错误不渲染错误行（边界）', async () => {
      const { container: c } = mount([rule('a')], { rowErrors: { 0: { key: '' } } })
      await flushAll()
      expect(c.querySelector('.drg-row-err')).toBeNull()
    })

    it('globalError → 底部显示全局错误文案，外层挂 drg-error', async () => {
      const { container: c } = mount([rule('a')], { globalError: '业务规则最多 8 条' })
      await flushAll()
      expect(c.querySelector('.drg-err-text').textContent.trim()).toBe('业务规则最多 8 条')
      expect(c.querySelector('.drg').classList.contains('drg-error')).toBe(true)
    })
  })

  describe('只读态', () => {
    it('readonly → 无「＋ 新增条目」与 × 删除，输入框 / 下拉 / x 输入框全部禁用', async () => {
      const { container: c } = mount([rule('a', 'SUMMARY')], { readonly: true })
      await flushAll()
      expect(addBtn(c)).toBeNull()
      expect(c.querySelector('.drg-del')).toBeNull()
      expect(keyInput(c, 0).disabled).toBe(true)
      expect(descInput(c, 0).disabled).toBe(true)
      expect(rowEls(c)[0].querySelector('.el-select__wrapper').classList.contains('is-disabled')).toBe(true)
      expect(nInput(c, 0).disabled).toBe(true)
    })
  })
})
