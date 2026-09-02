// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'

/**
 * §13.2 Markdown 即时渲染竞态修复单测：
 * 编辑器就绪后必用当前 modelValue 经 replaceAll 重灌一次；watch 在实例未就绪时挂起、待就绪补灌。
 * 隔离 Milkdown：mock @milkdown/* + skillToolRef，仅验证 replaceAll 被以正确 markdown 调用。
 */

// replaceAll spy：记录每次调用的 markdown（第 1 参）。返回一个「action」标记函数，editor.action 收到即视为执行。
const replaceAllSpy = vi.fn((md) => ({ __replaceAll: md }))

// 受控 editor 就绪：get() 初始 null，调用 readyNow() 后返回 fake editor。
let fakeEditor = null
const actionCalls = []
function makeFakeEditor() {
  return { action: (a) => actionCalls.push(a) }
}

// —— canUndo/canRedo 回吐用：可控 history 深度探针 ——
// computeFormatState 内 undoDepth(state)/redoDepth(state) >0 即回吐 canUndo/canRedo=true。
// 用模块级可变变量控制返回值，各用例按需切换（mock 工厂内闭包引用，见下方 vi.mock）。
let undoDepthVal = 0
let redoDepthVal = 0

// 最小可用 fakeState：满足 computeFormatState 对 schema/selection/storedMarks/doc 的访问。
// marks/nodes 用空对象（markType 取到 undefined → markActive 直接返回 false，安全）；
// selection 为空选区、$from.depth=0（循环只跑一圈，node() 返回无 heading/list 的占位节点）。
function makeFakeState() {
  return {
    schema: { marks: {}, nodes: {} },
    storedMarks: null,
    doc: { rangeHasMark: () => false },
    selection: {
      from: 0,
      to: 0,
      empty: true,
      $from: {
        depth: 0,
        node: () => ({ type: {}, attrs: {} }),
        marks: () => []
      }
    }
  }
}

// 能「执行读 state 型回调」的 fake editor：action(fn) 用带 fake ctx 的方式调用 fn，
// ctx.get(editorViewCtx) 返回 { state: fakeState, focus(){} }，使 emitFormatState → computeFormatState 真正跑完。
function makeStateAwareEditor() {
  const fakeState = makeFakeState()
  const ctx = { get: () => ({ state: fakeState, focus() {} }) }
  return {
    action: (a) => {
      actionCalls.push(a)
      if (typeof a === 'function') a(ctx) // 读 state 型回调（emitFormatState / focus）真正执行
    }
  }
}

vi.mock('@milkdown/vue', () => ({
  Milkdown: { template: '<div class="milkdown-stub" />' },
  useEditor: () => ({ get: () => fakeEditor })
}))
vi.mock('@milkdown/kit/core', () => ({
  Editor: { make: () => ({ config: () => ({ use: function () { return this } }) }) },
  rootCtx: {}, defaultValueCtx: {}, editorViewCtx: {}, editorStateCtx: {}
}))
vi.mock('@milkdown/kit/prose/state', () => ({ NodeSelection: { create: vi.fn() } }))
vi.mock('@milkdown/kit/preset/commonmark', () => ({ commonmark: {} }))
vi.mock('@milkdown/kit/preset/gfm', () => ({ gfm: {} }))
vi.mock('@milkdown/kit/plugin/listener', () => ({ listener: {}, listenerCtx: {} }))
vi.mock('@milkdown/kit/plugin/history', () => ({ history: {}, undoCommand: { key: 'undo' }, redoCommand: { key: 'redo' } }))
// undoDepth/redoDepth 读模块级可变变量（在用例里切换），驱动 canUndo/canRedo 回吐。
vi.mock('@milkdown/kit/prose/history', () => ({
  undoDepth: () => undoDepthVal,
  redoDepth: () => redoDepthVal
}))
vi.mock('@milkdown/kit/utils', () => ({
  $node: () => ({}), $remark: () => ({}), $view: () => ({}), $inputRule: () => ({}),
  replaceAll: (...a) => replaceAllSpy(...a),
  callCommand: vi.fn()
}))
vi.mock('@milkdown/kit/prose/inputrules', () => ({ InputRule: class {} }))
vi.mock('unist-util-visit', () => ({ visit: vi.fn() }))
vi.mock('@/utils/skillToolRef', () => ({
  splitTextToToolRefNodes: () => null,
  toolRefToMarkdown: (c) => `@tool[${c}]`,
  resolveBizName: (c) => c
}))

const SkillMilkdownCore = (await import('@/components/position/SkillMilkdownCore.vue')).default

let app, container
function mount(modelValueRef) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(SkillMilkdownCore, { modelValue: modelValueRef.value }) })
  app.mount(container)
  return container
}
// 带 format-state 监听 + 组件实例 ref 的挂载（供 canUndo/canRedo 用例：调 runCommand 触发回吐、断言 payload）。
function mountWithExpose(modelValueRef, onFormatState) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const cmpRef = ref(null)
  app = createApp({
    render: () =>
      h(SkillMilkdownCore, {
        modelValue: modelValueRef.value,
        ref: cmpRef,
        'onFormat-state': onFormatState
      })
  })
  app.mount(container)
  return cmpRef
}
beforeEach(() => {
  replaceAllSpy.mockClear()
  actionCalls.length = 0
  fakeEditor = null
  undoDepthVal = 0
  redoDepthVal = 0
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('SkillMilkdownCore · §13.2 就绪后重灌', () => {
  it('挂载时实例未就绪 → 不静默吞；就绪后用当前 modelValue 跑 replaceAll(md, true) 重灌', async () => {
    const mv = ref('## 标题\n正文')
    mount(mv)
    // 挂载瞬间 get()=null（fakeEditor 仍 null）→ onMounted flushWhenReady 轮询等待，未灌。
    await nextTick()
    expect(replaceAllSpy).not.toHaveBeenCalled()
    // 模拟实例就绪：get() 开始返回 editor → 轮询补灌。
    fakeEditor = makeFakeEditor()
    // flushWhenReady 用 setTimeout(30) 轮询，等它命中。
    await new Promise((r) => setTimeout(r, 60))
    expect(replaceAllSpy).toHaveBeenCalled()
    // 重灌内容 = 当前 modelValue，flush=true（走 parser 重解析为节点）。
    const [md, flush] = replaceAllSpy.mock.calls.at(-1)
    expect(md).toBe('## 标题\n正文')
    expect(flush).toBe(true)
  })

  it('就绪前外部改 modelValue → 挂起 pending；就绪后补灌最新值（不丢）', async () => {
    const mv = ref('初始')
    const wrapperState = ref('初始')
    container = document.createElement('div')
    document.body.appendChild(container)
    app = createApp({
      setup: () => ({ wrapperState }),
      render() {
        return h(SkillMilkdownCore, { modelValue: this.wrapperState })
      }
    })
    app.mount(container)
    await nextTick()
    // 就绪前外部改内容（watch 命中但 get()=null → 挂起 pending，不灌）。
    wrapperState.value = '## 晚到的内容'
    await nextTick()
    expect(replaceAllSpy).not.toHaveBeenCalled()
    // 就绪 → 补灌挂起值。
    fakeEditor = makeFakeEditor()
    await new Promise((r) => setTimeout(r, 60))
    expect(replaceAllSpy).toHaveBeenCalled()
    expect(replaceAllSpy.mock.calls.at(-1)[0]).toBe('## 晚到的内容')
  })
})

describe('SkillMilkdownCore · canUndo/canRedo 回吐', () => {
  // 用「能执行读 state 型回调」的 fake editor（makeStateAwareEditor）+ 可控 undoDepth/redoDepth，
  // 通过 defineExpose 的 runCommand 触发 emitFormatState → computeFormatState 真正跑完，
  // 断言 format-state payload 中 canUndo/canRedo 跟随被 mock 的 history 深度。
  async function fireAndGetPayload({ undo, redo }) {
    undoDepthVal = undo
    redoDepthVal = redo
    const mv = ref('正文')
    const onFormatState = vi.fn()
    const cmpRef = mountWithExpose(mv, onFormatState)
    // 就绪：换成 state-aware editor，使 editor.action(fn) 会用 fake ctx 执行读 state 回调。
    fakeEditor = makeStateAwareEditor()
    await nextTick()
    // 触发一次 emit 路径（runCommand 内部先跑命令，再 emitFormatState 回吐 format-state）。
    cmpRef.value.runCommand('undo')
    await nextTick()
    expect(onFormatState).toHaveBeenCalled()
    return onFormatState.mock.calls.at(-1)[0]
  }

  it('undoDepth/redoDepth 均 >0 → 回吐 canUndo=true、canRedo=true', async () => {
    const payload = await fireAndGetPayload({ undo: 3, redo: 2 })
    expect(payload.canUndo).toBe(true)
    expect(payload.canRedo).toBe(true)
  })

  it('undoDepth/redoDepth 均 =0 → 回吐 canUndo=false、canRedo=false', async () => {
    const payload = await fireAndGetPayload({ undo: 0, redo: 0 })
    expect(payload.canUndo).toBe(false)
    expect(payload.canRedo).toBe(false)
  })

  it('仅 undoDepth>0 → canUndo=true 而 canRedo=false（两者独立跟随各自深度）', async () => {
    const payload = await fireAndGetPayload({ undo: 1, redo: 0 })
    expect(payload.canUndo).toBe(true)
    expect(payload.canRedo).toBe(false)
  })
})
