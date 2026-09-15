import { h, provide, inject } from 'vue'

/**
 * 页面级单测共用的 el-table / el-table-column 轻量桩（2026-09-12 测试审计抽出，
 * 原先 adminUsers / adminRoles / adminExperts / adminPositionsOps / adminPositionAssignments / userSkillReviews
 * 六个文件各自复制了一份近似的 25 行）。
 *
 * 行为：el-table 按 data 逐行渲染 default 插槽；el-table-column 在行内渲染 default 插槽（作用域 { row }），
 * 无行时（表头阶段）可选渲染 header 插槽；每个单元格带 data-label / data-prop / data-fixed，方便断言列序与右钉。
 *
 * 用法：
 *   const { tableStub, tableColStub } = makeElTableStubs({ renderHeader: true })
 *   app.component('el-table', tableStub); app.component('el-table-column', tableColStub)
 *
 * 注意：它只是桩——不渲染真实 Element Plus 表格，拦不住组件 setup 期错误（如 2026-09-11 分页条 TDZ 白屏）。
 * 每个页面级用例文件仍须另有一条「真实挂载冒烟」。
 */
export function makeElTableStubs({ renderHeader = false } = {}) {
  const ROW_KEY = Symbol('row')

  const RowCells = {
    props: { row: { type: Object, required: true }, colSlot: { type: Function, required: true } },
    setup(props) {
      provide(ROW_KEY, props.row)
      return () => h('div', { class: 'el-row' }, props.colSlot?.())
    }
  }

  const tableStub = {
    name: 'el-table',
    props: { data: { type: Array, default: () => [] } },
    setup(props, { slots }) {
      return () =>
        h('div', { class: 'el-table' }, [
          // 表头阶段：不注入行，让 el-table-column 走「无行」分支渲染 header 插槽
          renderHeader ? h('div', { class: 'el-head' }, slots.default?.()) : null,
          // key 优先取行 id：RowCells 在 setup 期 provide 一次，若按下标作 key，重排/过滤后同下标组件被复用，
          // 列桩 inject 到的仍是旧行，行序/筛选断言会假绿（2026-09-12 组织域改造时实测）
          ...props.data.map((row, i) => h(RowCells, { row, colSlot: slots.default, key: row?.id ?? row?.key ?? i }))
        ])
    }
  }

  const tableColStub = {
    name: 'el-table-column',
    props: {
      label: { type: String, default: '' },
      prop: { type: String, default: '' },
      fixed: { type: [String, Boolean], default: false },
      width: { type: [String, Number], default: '' },
      minWidth: { type: [String, Number], default: '' }
    },
    setup(props, { slots }) {
      const row = inject(ROW_KEY, null)
      return () => {
        const attrs = {
          class: 'el-table-column',
          'data-label': props.label,
          'data-prop': props.prop,
          'data-fixed': props.fixed || null,
          'data-width': String(props.width || props.minWidth || '')
        }
        if (!row) return h('div', { ...attrs, class: 'el-table-column t-head' }, renderHeader ? (slots.header?.() ?? props.label) : null)
        return h('div', attrs, [slots.default ? slots.default({ row }) : row[props.prop]])
      }
    }
  }

  return { ROW_KEY, RowCells, tableStub, tableColStub }
}
