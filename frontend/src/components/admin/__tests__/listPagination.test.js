// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, onMounted, ref } from 'vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import { useAdminList } from '@/composables/useAdminList'

/**
 * ListPagination（全站列表页分页条）契约——2026-09-12 审计 T57 新建（此前零单测；3 个页面测试把它桩掉，
 * 仅 adminPositionAssignments 真挂过一次）。
 *
 * 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位管理/prd.岗位管理.md L48「底部展示总条数、每页条数和分页器」、
 * 03能力/连接器/MCP/prd-连接器-MCP.md L167「与平台其余列表页采用同一套分页策略」；
 * 三段式「左总数 / 中页码 / 右 每页条数下拉 + 跳页框」与固定四档 10/20/30/50 为 2026-09-11 负责人拍板
 * （《列表页UI.png》，尚未回写 md，审计 A16 记录）。
 *
 * 【为什么第一条必须是真实挂载】2026-09-11 曾把 `watch(current, …, { immediate: true })` 写在
 * `const current` 声明之前——const 的 TDZ 让 watch 初始化时取值即 ReferenceError，15 个列表页整页白屏，
 * 而当时所有页面测试都把 ListPagination 桩掉，没有一条红。本文件不桩任何东西：组件只用原生
 * button/select/input，无需 ElementPlus。
 *
 * 覆盖：①真实挂载不抛 + 总数文案 + 跳页框初值；②total=0 不渲染；③动态条数「自动」档 + 四档 + 选档 emit；
 * ④固定档无「自动」项；⑤跳页夹取 / 非法回填；⑥props.page 变化跳页框跟随；⑦页码窗口省略号；
 * ⑧‹ › 边界 disabled + 点当前页不 emit；⑨内联宿主接 useAdminList：选 20 → fetcher {page:1,size:20}。
 */

let app, host

/** 挂载分页条：props 直接透传；emits 收进 emitted 便于断言。 */
function mount(props = {}) {
  const emitted = { 'update:page': [], 'update:pageSize': [], change: [] }
  const live = ref({ ...props })
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    setup() {
      return () =>
        h(ListPagination, {
          ...live.value,
          'onUpdate:page': (v) => emitted['update:page'].push(v),
          'onUpdate:pageSize': (v) => emitted['update:pageSize'].push(v),
          onChange: (v) => emitted.change.push(v)
        })
    }
  })
  app.mount(host)
  return { emitted, setProps: (patch) => { live.value = { ...live.value, ...patch } } }
}

afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
})

const info = () => host.querySelector('.list-pager-info')?.textContent.replace(/\s+/g, ' ').trim()
const jumpInput = () => host.querySelector('.page-jump-input')
const sizeSelect = () => host.querySelector('select.page-size')
const optionTexts = () => [...sizeSelect().querySelectorAll('option')].map((o) => o.textContent.trim())
const navItems = () =>
  [...host.querySelectorAll('.list-pager-nav > *')]
    .filter((n) => !n.getAttribute('aria-label')) // 去掉 ‹ ›
    .map((n) => (n.classList.contains('page-ellipsis') ? '…' : Number(n.textContent.trim())))
const numBtn = (n) => [...host.querySelectorAll('.list-pager-nav button.page-btn')].find((b) => b.textContent.trim() === String(n))
const prevBtn = () => host.querySelector('button[aria-label="上一页"]')
const nextBtn = () => host.querySelector('button[aria-label="下一页"]')

function selectSize(v) {
  const sel = sizeSelect()
  sel.value = String(v)
  sel.dispatchEvent(new Event('change'))
}
/** 在跳页框输入并回车；v-model 回填要等一个 tick 才落到 DOM。 */
async function typeJump(text) {
  const inp = jumpInput()
  inp.value = text
  inp.dispatchEvent(new Event('input'))
  inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
  await nextTick()
}

describe('ListPagination · 真实挂载与三段式骨架', () => {
  it('① 23 条/每页 10 真实挂载不抛、无 console.error →「共 23 条数据」+ 跳页框初值 "1"（09-11 TDZ 白屏回归闸）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => mount({ total: 23, pageSize: 10, page: 1 })).not.toThrow()
    await nextTick()

    expect(err).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(host.querySelector('.list-pager')).toBeTruthy()
    expect(info()).toBe('共 23 条数据')
    expect(jumpInput().value).toBe('1')
    // 三段式骨架：左总数 / 中页码 / 右工具（下拉 + 跳页）
    expect(host.querySelector('.list-pager-nav')).toBeTruthy()
    expect(host.querySelector('.list-pager-tools select.page-size')).toBeTruthy()
    expect(host.querySelector('.list-pager-tools .page-jump').textContent.replace(/\s+/g, '')).toBe('跳至页')
    // 23/10 → 3 页平铺
    expect(navItems()).toEqual([1, 2, 3])
    expect(numBtn(1).classList.contains('active')).toBe(true)
  })

  it('② total=0 → 整条不渲染（空态由 ListStates 出）', async () => {
    mount({ total: 0, pageSize: 10, page: 1 })
    await nextTick()
    expect(host.querySelector('.list-pager')).toBeNull()
  })

  it('unit 传「组」→ 文案随单位：「共 5 组数据」+ 下拉「10组/页」', async () => {
    mount({ total: 5, pageSize: 10, page: 1, unit: '组' })
    await nextTick()
    expect(info()).toBe('共 5 组数据')
    expect(optionTexts()).toContain('10组/页')
  })
})

describe('ListPagination · 每页条数下拉（固定四档 + 动态「自动」档）', () => {
  it('③ 动态 9 条（按窗口高度算出）→ 首项「9条/页（自动）」+ 固定四档；选 20 emit update:pageSize；再选当前值不 emit', async () => {
    const { emitted } = mount({ total: 23, pageSize: 9, page: 1 })
    await nextTick()

    expect(optionTexts()).toEqual(['9条/页（自动）', '10条/页', '20条/页', '30条/页', '50条/页'])
    expect(sizeSelect().value).toBe('9')

    selectSize(20)
    expect(emitted['update:pageSize']).toEqual([20])

    selectSize(9) // 与当前 props.pageSize 相同 → 不 emit
    expect(emitted['update:pageSize']).toEqual([20])
    // 选档不直接翻页：回第 1 页重拉由 useAdminList 侧 watch(pageSize) 负责
    expect(emitted['update:page']).toEqual([])
    expect(emitted.change).toEqual([])
  })

  it('④ pageSize 20 命中固定档 → 无「自动」项，仅四档且选中 20', async () => {
    mount({ total: 23, pageSize: 20, page: 1 })
    await nextTick()
    expect(optionTexts()).toEqual(['10条/页', '20条/页', '30条/页', '50条/页'])
    expect(optionTexts().some((t) => t.includes('自动'))).toBe(false)
    expect(sizeSelect().value).toBe('20')
  })
})

describe('ListPagination · 跳页框', () => {
  it('⑤ 共 3 页输入 5 回车 → 夹到 3：emit update:page 3 + change 3，框回填 "3"；输入 "abc" → 不 emit、回填当前页', async () => {
    const { emitted, setProps } = mount({ total: 30, pageSize: 10, page: 1 })
    await nextTick()

    await typeJump('5')
    expect(emitted['update:page']).toEqual([3])
    expect(emitted.change).toEqual([3])
    expect(jumpInput().value).toBe('3')

    setProps({ page: 3 }) // 宿主 v-model 回写
    await nextTick()
    await typeJump('abc')
    expect(emitted['update:page']).toEqual([3])
    expect(emitted.change).toEqual([3])
    expect(jumpInput().value).toBe('3')

    await typeJump('0') // <1 也按非法处理：回填当前页
    expect(emitted['update:page']).toEqual([3])
    expect(jumpInput().value).toBe('3')
  })

  it('跳页失焦（blur）同样提交：输入 2 后失焦 → emit 2', async () => {
    const { emitted } = mount({ total: 30, pageSize: 10, page: 1 })
    await nextTick()
    const inp = jumpInput()
    inp.value = '2'
    inp.dispatchEvent(new Event('input'))
    inp.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(emitted['update:page']).toEqual([2])
    expect(jumpInput().value).toBe('2')
    expect(emitted.change).toEqual([2])
  })

  it('⑥ props.page 由宿主 2→3 → 跳页框跟随显示 "3"', async () => {
    const { setProps } = mount({ total: 30, pageSize: 10, page: 2 })
    await nextTick()
    expect(jumpInput().value).toBe('2')
    setProps({ page: 3 })
    await nextTick()
    expect(jumpInput().value).toBe('3')
  })
})

describe('ListPagination · 页码窗口与边界', () => {
  it('⑦ 200 条/每页 10（20 页）：current 10 → [1,…,9,10,11,…,20]；current 2 → [1,2,3,4,…,20]；current 19 → [1,…,17,18,19,20]', async () => {
    const { setProps } = mount({ total: 200, pageSize: 10, page: 10 })
    await nextTick()
    expect(navItems()).toEqual([1, '…', 9, 10, 11, '…', 20])
    expect(numBtn(10).getAttribute('aria-current')).toBe('page')

    setProps({ page: 2 })
    await nextTick()
    expect(navItems()).toEqual([1, 2, 3, 4, '…', 20])

    setProps({ page: 19 })
    await nextTick()
    expect(navItems()).toEqual([1, '…', 17, 18, 19, 20])
  })

  it('≤ 7 页全铺：70 条/每页 10 → [1..7] 无省略号', async () => {
    mount({ total: 70, pageSize: 10, page: 4 })
    await nextTick()
    expect(navItems()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('⑧ 第 1 页 ‹ disabled、末页 › disabled；点当前页不 emit；点其它页 emit update:page + change', async () => {
    const { emitted, setProps } = mount({ total: 30, pageSize: 10, page: 1 })
    await nextTick()
    expect(prevBtn().disabled).toBe(true)
    expect(nextBtn().disabled).toBe(false)

    numBtn(1).click() // 当前页
    prevBtn().click() // disabled 的按钮 click 不触发处理器
    expect(emitted['update:page']).toEqual([])
    expect(emitted.change).toEqual([])

    nextBtn().click()
    expect(emitted['update:page']).toEqual([2])
    expect(emitted.change).toEqual([2])

    setProps({ page: 3 })
    await nextTick()
    expect(prevBtn().disabled).toBe(false)
    expect(nextBtn().disabled).toBe(true)
    numBtn(2).click()
    expect(emitted['update:page']).toEqual([2, 2])
  })

  it('props.page 越界（传 9 但只有 3 页）→ 当前页钳到末页高亮，跳页框显 "3"', async () => {
    mount({ total: 30, pageSize: 10, page: 9 })
    await nextTick()
    expect(numBtn(3).classList.contains('active')).toBe(true)
    expect(jumpInput().value).toBe('3')
    expect(nextBtn().disabled).toBe(true)
  })
})

describe('ListPagination · 接 useAdminList（页面实际接法）', () => {
  /**
   * 照 AdminPositions.vue L701-706 的接法：v-model:page / v-model:page-size / :total / @change="reload"。
   * 下拉选 20 → useAdminList 的 watch(pageSize) 回第 1 页重拉 → fetcher 收到 {page:1,size:20}。
   * 页面里 useDynPageSize 在组件 setup 内挂了 resize 监听（jsdom 有 window），这里一并走真流程。
   */
  it('⑨ 宿主 v-model:page-size 选 20 → fetcher 收到 {page:1,size:20}，分页条文案随 total 更新', async () => {
    const fetcher = vi.fn(({ size }) =>
      Promise.resolve({ list: Array.from({ length: size }, (_, i) => ({ id: i + 1 })), total: 45 })
    )
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({
      setup() {
        const l = useAdminList(fetcher)
        onMounted(l.reload)
        return () =>
          h(ListPagination, {
            total: l.total.value,
            page: l.page.value,
            'onUpdate:page': (v) => { l.page.value = v },
            pageSize: l.pageSize.value,
            'onUpdate:pageSize': (v) => { l.pageSize.value = v },
            onChange: l.reload
          })
      }
    })
    app.mount(host)
    await nextTick()
    await nextTick()

    expect(fetcher).toHaveBeenCalledTimes(1)
    const initialSize = fetcher.mock.calls[0][0].size
    expect(info()).toBe('共 45 条数据')
    expect(sizeSelect().value).toBe(String(initialSize))

    // 先翻到第 2 页，证明选档后确实回到第 1 页而不是停在第 2 页
    nextBtn().click()
    await nextTick()
    await nextTick()
    expect(fetcher).toHaveBeenLastCalledWith({ page: 2, size: initialSize })
    expect(jumpInput().value).toBe('2')

    selectSize(20)
    await nextTick()
    await nextTick()

    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 20 })
    expect(optionTexts()).toEqual(['10条/页', '20条/页', '30条/页', '50条/页'])
    expect(sizeSelect().value).toBe('20')
    expect(navItems()).toEqual([1, 2, 3]) // 45/20 → 3 页
    expect(jumpInput().value).toBe('1')
  })
})
