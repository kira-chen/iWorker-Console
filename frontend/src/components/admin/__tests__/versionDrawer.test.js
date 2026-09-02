// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * VersionDrawer.vue 单测 —— 技能 / 专家 / 岗位统一的版本管理抽屉。
 *
 * 本文件承接合并前三个弹窗各自测试的覆盖点，避免合并造成覆盖回退：
 *  · 来自 PlatformSkillVersionDialog.test：首发 v1.0.0 / 非首发 bump 进位 / 审核中撤回 /
 *    实体前置门（技能分类必填，系统技能豁免）/ 版本历史展示语义号 + 禁用按整数 key
 *  · 来自 expertVersionDialog.test：延迟骨架阀门四态（阈值内不亮 / 超阈值才亮 / 安全禁用不延迟 / 关开复位）
 *  · 新增：**适配器签名原样透传**——三者 delist/relist 签名各不相同（技能三参、专家 pub.id、岗位 version），
 *    抽屉必须只调 adapter 提供的闭包、绝不自行拼参，这是合并最容易出事故的地方。
 */

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
const ElMessageBox = { confirm: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox }))
vi.mock('@/components/StatusTag.vue', () => ({
  default: { name: 'StatusTag', props: ['type'], template: '<span class="status-tag"><slot /></span>' }
}))
vi.mock('@/components/admin/VersionHistoryList.vue', () => ({
  default: {
    name: 'VersionHistoryList',
    props: ['rows', 'loading', 'error', 'busyVersion', 'delistTerm', 'relistTerm', 'activeLabel'],
    emits: ['delist', 'relist', 'retry'],
    template:
      '<div class="vhl"><div v-if="loading" class="vhl-skeleton" /><template v-else>' +
      '<div v-for="r in rows" :key="r.version" class="vhl-row" :data-ver="r.verLabel" :data-extra="r.extra">' +
      '<button class="vhl-del" @click="$emit(\'delist\', r)">{{ delistTerm }}</button>' +
      '<button class="vhl-rel" @click="$emit(\'relist\', r)">{{ relistTerm }}</button>' +
      '</div></template></div>'
  }
}))
// DrawerEditor 用真实组件（外壳与 footer 插槽是本组件行为的一部分），只 stub 其内部的 el-drawer。
const VersionDrawer = (await import('@/components/admin/VersionDrawer.vue')).default

const elDrawer = {
  name: 'el-drawer',
  props: ['modelValue'],
  template:
    '<div class="el-drawer" v-if="modelValue"><div class="dr-title"><slot name="header" /></div>' +
    '<div class="dr-body"><slot /></div><div class="dr-footer"><slot name="footer" /></div></div>'
}
const elButton = {
  name: 'el-button',
  props: { disabled: Boolean, loading: Boolean, type: String },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" @click="!disabled && $emit(\'click\')"><slot /></button>'
}
const elInput = {
  name: 'el-input',
  props: { modelValue: { default: '' }, disabled: Boolean },
  emits: ['update:modelValue'],
  template: '<textarea class="el-input" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
}
const elRadioGroup = {
  name: 'el-radio-group',
  props: { modelValue: { default: '' }, disabled: Boolean },
  emits: ['update:modelValue'],
  template: '<div class="el-radio-group"><slot /></div>',
  provide() { return { pick: (v) => this.$emit('update:modelValue', v) } }
}
const elRadioButton = {
  name: 'el-radio-button',
  props: ['value'],
  inject: ['pick'],
  template: '<button class="el-radio-btn" :data-v="value" @click="pick(value)"><slot /></button>'
}
const passthrough = (t) => ({ name: t, template: `<div class="${t}"><slot /></div>` })

let app, container, visibleRef
function mount(adapter, opts = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  visibleRef = ref(opts.open !== false)
  app = createApp({
    setup() {
      return () => h(VersionDrawer, {
        modelValue: visibleRef.value,
        adapter,
        'onUpdate:modelValue': (v) => (visibleRef.value = v),
        onDone: opts.onDone
      })
    }
  })
  app.component('el-drawer', elDrawer)
  app.component('el-button', elButton)
  app.component('el-input', elInput)
  app.component('el-radio-group', elRadioGroup)
  app.component('el-radio-button', elRadioButton)
  app.component('el-skeleton', passthrough('el-skeleton'))
  app.component('el-empty', passthrough('el-empty'))
  app.mount(container)
  return container
}
const flush = async (n = 6) => { for (let i = 0; i < n; i++) { await Promise.resolve(); await nextTick() } }
const btn = (t) => [...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes(t))
const txt = () => container.textContent
function deferred() { let r; const promise = new Promise((res) => (r = res)); return { promise, resolve: r } }

/** 基线适配器：可提交态、有一条历史。各用例按需覆写。 */
function makeAdapter(over = {}) {
  return {
    entityLabel: '技能',
    entityKey: '技能名称',
    name: '报价生成',
    id: 'sk_1',
    deriveView: () => ({ state: 'PUBLISHED', label: '已发布', tagType: 'success', actions: ['submit'] }),
    nextVersionLabel: vi.fn().mockResolvedValue('v1.2.3'),
    publish: vi.fn().mockResolvedValue({}),
    withdraw: vi.fn().mockResolvedValue({}),
    listVersions: vi.fn().mockResolvedValue([{ version: 7, versionLabel: 'v1.2.2', status: 'ACTIVE' }]),
    mapRow: (sn) => ({ ...sn, verLabel: sn.versionLabel }),
    delist: vi.fn().mockResolvedValue({ status: 'DELISTED' }),
    relist: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
    ...over
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  ElMessage.success.mockReset(); ElMessage.error.mockReset(); ElMessage.warning.mockReset()
  ElMessageBox.confirm.mockReset().mockResolvedValue()
})
afterEach(() => { vi.useRealTimers(); app?.unmount(); container?.remove() })

describe('VersionDrawer · 发布语义', () => {
  it('顶部显示实体前缀与名称、标题行带发布态', async () => {
    mount(makeAdapter()); await flush()
    expect(txt()).toContain('技能名称：')
    expect(txt()).toContain('报价生成')
    expect(container.querySelector('.dr-title .status-tag').textContent).toContain('已发布')
  })

  it('首发：固定 v1.0.0、无更新类型单选；提交 bump=NONE', async () => {
    const a = makeAdapter({
      deriveView: () => ({ state: 'INITIAL', label: '未发布', tagType: 'info', actions: ['submit'] })
    })
    mount(a); await flush()
    expect(txt()).toContain('v1.0.0')
    expect(container.querySelector('.el-radio-group')).toBeNull()
    container.querySelector('.el-input').value = '首版'
    container.querySelector('.el-input').dispatchEvent(new Event('input'))
    await flush(2)
    btn('提交发布').click(); await flush()
    expect(a.publish).toHaveBeenCalledWith('sk_1', { bump: 'NONE', releaseNotes: '首版' })
  })

  it('非首发：默认取建议号；选「功能更新」→ minor 进位并按该 bump 提交', async () => {
    const a = makeAdapter()
    mount(a); await flush()
    expect(txt()).toContain('v1.2.3') // NONE = 后端建议号
    container.querySelector('.el-radio-btn[data-v="MINOR"]').click(); await flush(2)
    expect(txt()).toContain('v1.3.0')
    container.querySelector('.el-input').value = '加功能'
    container.querySelector('.el-input').dispatchEvent(new Event('input'))
    await flush(2)
    btn('提交发布').click(); await flush()
    expect(a.publish).toHaveBeenCalledWith('sk_1', { bump: 'MINOR', releaseNotes: '加功能' })
  })

  it('升级说明未填 → 提交禁用且不发请求', async () => {
    const a = makeAdapter()
    mount(a); await flush()
    expect(btn('提交发布').disabled).toBe(true)
    expect(txt()).toContain('升级说明必填')
    expect(a.publish).not.toHaveBeenCalled()
  })

  it('审核中：无发布编辑器，显撤回 → 调 adapter.withdraw', async () => {
    const a = makeAdapter({
      deriveView: () => ({ state: 'REVIEWING', label: '审核中', tagType: 'warning', actions: ['withdraw'] })
    })
    mount(a); await flush()
    expect(btn('提交发布')).toBeUndefined()
    expect(txt()).toContain('审核中')
    btn('撤回提交').click(); await flush()
    expect(a.withdraw).toHaveBeenCalledWith('sk_1')
  })
})

describe('VersionDrawer · 实体前置门（技能分类必填）', () => {
  it('缺分类 → 就地提示 + 提交禁用；强行提交只警告不发请求', async () => {
    const a = makeAdapter({ submitGate: () => '该技能还未选择「技能分类」，按规则不可提交发布。' })
    mount(a); await flush()
    expect(txt()).toContain('还未选择「技能分类」')
    expect(btn('提交发布').disabled).toBe(true)
    expect(a.publish).not.toHaveBeenCalled()
  })

  it('无前置门（如系统技能/专家/岗位）→ 不显提示、不因此禁用', async () => {
    const a = makeAdapter()
    mount(a); await flush()
    expect(txt()).not.toContain('技能分类')
    container.querySelector('.el-input').value = 'x'
    container.querySelector('.el-input').dispatchEvent(new Event('input'))
    await flush(2)
    expect(btn('提交发布').disabled).toBe(false)
  })
})

describe('VersionDrawer · 版本历史与适配器签名', () => {
  it('展示语义号 verLabel，并把整行原样交给 adapter.delist（不自行拼参）', async () => {
    const a = makeAdapter()
    mount(a); await flush()
    expect(container.querySelector('.vhl-row').dataset.ver).toBe('v1.2.2')
    container.querySelector('.vhl-del').click(); await flush()
    // 关键：传的是**整行**，由适配器自己决定用 version 还是 pub.id
    expect(a.delist).toHaveBeenCalledWith(expect.objectContaining({ version: 7, verLabel: 'v1.2.2' }))
  })

  it('专家口径：适配器可按 pub.id 定位（抽屉不介入）', async () => {
    const delist = vi.fn().mockResolvedValue({ status: 'DELISTED' })
    const a = makeAdapter({
      listVersions: vi.fn().mockResolvedValue([{ id: 'pub_9', version: 3, versionLabel: 'v1.0.2', status: 'ACTIVE' }]),
      mapRow: (p) => ({ ...p, verLabel: p.versionLabel }),
      delist: (r) => delist(r.id)
    })
    mount(a); await flush()
    container.querySelector('.vhl-del').click(); await flush()
    expect(delist).toHaveBeenCalledWith('pub_9')
  })

  it('岗位口径：mapRow 加工的 extra 在单行更新后不丢', async () => {
    const a = makeAdapter({
      listVersions: vi.fn().mockResolvedValue([{ version: 5, versionLabel: 'v1.0.4', status: 'ACTIVE', pinnedSkillsCount: 3 }]),
      mapRow: (p) => ({ ...p, verLabel: p.versionLabel, extra: `pin ${p.pinnedSkillsCount} 技能` })
    })
    mount(a); await flush()
    expect(container.querySelector('.vhl-row').dataset.extra).toBe('pin 3 技能')
    container.querySelector('.vhl-del').click(); await flush()
    expect(container.querySelector('.vhl-row').dataset.extra).toBe('pin 3 技能')
  })

  it('二次确认取消 → 不调接口', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce(new Error('cancel'))
    const a = makeAdapter()
    mount(a); await flush()
    container.querySelector('.vhl-del').click(); await flush()
    expect(a.delist).not.toHaveBeenCalled()
  })

  it('用词可配（技能/专家「禁用·启用」，岗位「下线·恢复」）', async () => {
    mount(makeAdapter({ delistTerm: '禁用', relistTerm: '启用' })); await flush()
    expect(container.querySelector('.vhl-del').textContent).toBe('禁用')
    expect(container.querySelector('.vhl-rel').textContent).toBe('启用')
    app.unmount(); container.remove()
    mount(makeAdapter({ delistTerm: '下线', relistTerm: '恢复' })); await flush()
    expect(container.querySelector('.vhl-del').textContent).toBe('下线')
    expect(container.querySelector('.vhl-rel').textContent).toBe('恢复')
  })

  // 合并时本组件默认「禁用/启用」，把岗位侧原有的「下线/恢复」悄悄改写（实机走查抓到的回归）。
  // 默认值须与 VersionHistoryList 一致，否则未显式传词的调用方会被静默改文案。
  it('未传用词 → 默认与 VersionHistoryList 一致（下线/恢复），不擅自换词', async () => {
    mount(makeAdapter()); await flush()
    expect(container.querySelector('.vhl-del').textContent).toBe('下线')
    expect(container.querySelector('.vhl-rel').textContent).toBe('恢复')
  })
})

describe('VersionDrawer · 实体参数化（2026-09-01 岗位 PRD 对齐新增；缺省=旧行为）', () => {
  it('缺省：标题「版本发布」、默认更新类型词、历史副标题「整包快照 + 下线口径」', async () => {
    mount(makeAdapter()); await flush()
    expect(container.querySelector('.dr-title').textContent).toContain('版本发布')
    expect(container.querySelector('.el-radio-btn[data-v="NONE"]').textContent).toContain('修订更新')
    expect(txt()).toContain('每次审核通过生成一版整包快照')
  })

  it('岗位口径覆写：标题/更新类型词与 hint/历史副标题', async () => {
    const a = makeAdapter({
      title: '版本管理',
      bumpOptions: [
        { value: 'NONE', label: '修订版本', hint: '修复问题或小幅配置调整' },
        { value: 'MINOR', label: '功能更新', hint: '新增岗位能力或岗位技能' },
        { value: 'MAJOR', label: '重大更新', hint: '岗位职责或流程发生不兼容变更' }
      ],
      historySubtitle: '每次审核通过生成一版岗位配置快照；同一时间只能启用一个版本'
    })
    mount(a); await flush()
    expect(container.querySelector('.dr-title').textContent).toContain('版本管理')
    expect(container.querySelector('.el-radio-btn[data-v="NONE"]').textContent).toContain('修订版本')
    expect(txt()).toContain('同一时间只能启用一个版本')
    container.querySelector('.el-radio-btn[data-v="MINOR"]').click(); await flush(2)
    expect(txt()).toContain('新增岗位能力或岗位技能') // 选中项 hint 跟随覆写词表
  })

  it('delistConfirmText 覆写确认文案（岗位「禁用「名」的 vX.Y.Z？」）', async () => {
    const a = makeAdapter({
      delistTerm: '禁用',
      relistTerm: '启用',
      delistConfirmText: (r, ver) => `禁用「报价生成」的 ${ver}？`
    })
    mount(a); await flush()
    container.querySelector('.vhl-del').click(); await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith('禁用「报价生成」的 v1.2.2？', '禁用版本', expect.anything())
  })

  it('exclusiveActive：启用成功后整表重拉（互斥翻转由数据层承担）', async () => {
    const listVersions = vi.fn().mockResolvedValue([
      { version: 2, versionLabel: 'v1.1.0', status: 'ACTIVE' },
      { version: 1, versionLabel: 'v1.0.0', status: 'DELISTED' }
    ])
    const a = makeAdapter({ listVersions, exclusiveActive: true })
    mount(a); await flush()
    expect(listVersions).toHaveBeenCalledTimes(1)
    container.querySelector('.vhl-rel').click(); await flush()
    expect(a.relist).toHaveBeenCalled()
    expect(listVersions).toHaveBeenCalledTimes(2) // 启用后重拉
  })
})

describe('VersionDrawer · 延迟骨架阀门（合并后三处一并获得）', () => {
  it('请求挂起但未满 250ms → 不亮骨架、不变暗', async () => {
    const d = deferred(); const n = deferred()
    mount(makeAdapter({ listVersions: () => d.promise, nextVersionLabel: () => n.promise }))
    await flush()
    expect(container.querySelector('.vhl-skeleton')).toBeNull()
    expect(container.querySelector('.vd-pub')?.className).not.toContain('loading')
    vi.advanceTimersByTime(200); d.resolve([]); n.resolve('v1.0.1'); await flush()
    vi.advanceTimersByTime(300); await flush()
    expect(container.querySelector('.vhl-skeleton')).toBeNull()
  })

  it('慢响应超 250ms → 骨架与变暗出现，回包后消失', async () => {
    const d = deferred(); const n = deferred()
    mount(makeAdapter({ listVersions: () => d.promise, nextVersionLabel: () => n.promise }))
    await flush()
    vi.advanceTimersByTime(300); await flush()
    expect(container.querySelector('.vhl-skeleton')).toBeTruthy()
    expect(container.querySelector('.vd-pub').className).toContain('loading')
    d.resolve([]); n.resolve('v1.0.1'); await flush()
    expect(container.querySelector('.vhl-skeleton')).toBeNull()
    expect(container.querySelector('.vd-pub').className).not.toContain('loading')
  })

  it('阈值内提交仍禁用——安全禁用不随阀门延迟', async () => {
    const n = deferred()
    mount(makeAdapter({ nextVersionLabel: () => n.promise })); await flush()
    expect(container.querySelector('.vd-pub').className).not.toContain('loading')
    expect(btn('提交发布').disabled).toBe(true)
    n.resolve('v1.0.1'); await flush()
  })

  it('关闭再打开 → 阀门复位，不残留上次骨架', async () => {
    const d = deferred()
    mount(makeAdapter({ listVersions: () => d.promise })); await flush()
    vi.advanceTimersByTime(300); await flush()
    expect(container.querySelector('.vhl-skeleton')).toBeTruthy()
    visibleRef.value = false; await flush()
    d.resolve([]); await flush()
    visibleRef.value = true; await flush()
    expect(container.querySelector('.vhl-skeleton')).toBeNull()
  })
})
