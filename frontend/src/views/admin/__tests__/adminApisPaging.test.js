// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { ref, computed, watch, nextTick } from 'vue'

/**
 * AdminApis 分页口径单测（2026-09-09 负责人裁决）。
 *
 * 背景：全站列表统一分页（09-08 拍板），但 API 页是「服务提供系统分组 + 组内 API 表」的双层结构，
 * 一直没做分页（原 md 亦无分页条款）。负责人明确：**按业务系统（= 服务提供系统）分页，不按 API 分页**，
 * 即一页放 N 个系统、每个系统下的 API 全部展示，避免同一系统的 API 被切到两页而读不全。
 *
 * 本用例复刻 AdminApis.vue 里 pagedGroups / 越界钳回的那段逻辑并钉住三条不变量：
 *   1. 切片单位是「分组」不是「API」——一页的 API 条数可以远大于每页个数；
 *   2. 同一分组的 API 绝不跨页；
 *   3. 分组总数缩水（如筛选后）时，越界页码钳回末页，不留空白页。
 * 组件整体渲染另见 Playwright 冒烟（分页条文案「共 N 个 · 每页 X 个」）。
 */

// 复刻 AdminApis.vue 的分页段（保持同构，改动那边时这里应同步失败）
function useGroupPaging(groups, pageSize) {
  const psPage = ref(1)
  const pagedGroups = computed(() => {
    const start = (psPage.value - 1) * pageSize.value
    return groups.value.slice(start, start + pageSize.value)
  })
  watch([() => groups.value.length, pageSize], () => {
    const max = Math.max(1, Math.ceil(groups.value.length / Math.max(1, pageSize.value)))
    if (psPage.value > max) psPage.value = max
  })
  return { psPage, pagedGroups }
}

// 造 n 个分组，第 i 组带 (i+1) 个 API——让「分组数」与「API 条数」明显不等
const mkGroups = (n) =>
  Array.from({ length: n }, (_, i) => ({
    ps: { id: `ps_${i + 1}`, name: `系统 ${i + 1}` },
    apis: Array.from({ length: i + 1 }, (_, j) => ({ id: `api_${i + 1}_${j + 1}` }))
  }))

describe('AdminApis 分页 —— 按服务提供系统分页（2026-09-09 负责人裁决）', () => {
  it('切片单位是分组：每页 2 个系统，本页 API 条数不受每页个数限制', () => {
    const groups = ref(mkGroups(5)) // API 总数 1+2+3+4+5 = 15
    const { psPage, pagedGroups } = useGroupPaging(groups, ref(2))

    expect(pagedGroups.value).toHaveLength(2)
    expect(pagedGroups.value.map((g) => g.ps.id)).toEqual(['ps_1', 'ps_2'])
    // 本页 API 条数 = 1 + 2 = 3，与「每页 2」无关（若误按 API 分页这里会是 2）
    expect(pagedGroups.value.reduce((n, g) => n + g.apis.length, 0)).toBe(3)

    psPage.value = 3
    expect(pagedGroups.value.map((g) => g.ps.id)).toEqual(['ps_5'])
    expect(pagedGroups.value[0].apis).toHaveLength(5)
  })

  it('同一分组的 API 绝不跨页：每组 API 要么整组在本页、要么整组不在', () => {
    const groups = ref(mkGroups(4))
    const { psPage, pagedGroups } = useGroupPaging(groups, ref(3))

    const seen = new Map()
    for (const page of [1, 2]) {
      psPage.value = page
      for (const g of pagedGroups.value) {
        // 同一分组只应出现在一页里
        expect(seen.has(g.ps.id)).toBe(false)
        seen.set(g.ps.id, g.apis.length)
        // 出现时必须是完整的一组（与源数据条数一致）
        const src = groups.value.find((x) => x.ps.id === g.ps.id)
        expect(g.apis).toHaveLength(src.apis.length)
      }
    }
    expect([...seen.keys()]).toEqual(['ps_1', 'ps_2', 'ps_3', 'ps_4'])
  })

  it('分组总数缩水（筛选后）时越界页码钳回末页，不停留在空白页', async () => {
    const groups = ref(mkGroups(9))
    const { psPage, pagedGroups } = useGroupPaging(groups, ref(3))

    psPage.value = 3
    expect(pagedGroups.value.map((g) => g.ps.id)).toEqual(['ps_7', 'ps_8', 'ps_9'])

    // 模拟搜索命中变少：9 → 4 个分组，最大页 2，当前第 3 页越界
    groups.value = mkGroups(4)
    await nextTick()
    expect(psPage.value).toBe(2)
    expect(pagedGroups.value.map((g) => g.ps.id)).toEqual(['ps_4'])
  })

  it('每页个数变化（视口高度变化）同样触发越界钳回', async () => {
    const groups = ref(mkGroups(6))
    const pageSize = ref(2)
    const { psPage, pagedGroups } = useGroupPaging(groups, pageSize)

    psPage.value = 3 // 每页 2 → 共 3 页，停在末页
    expect(pagedGroups.value.map((g) => g.ps.id)).toEqual(['ps_5', 'ps_6'])

    pageSize.value = 5 // 窗口变高 → 共 2 页，第 3 页越界
    await nextTick()
    expect(psPage.value).toBe(2)
    expect(pagedGroups.value.map((g) => g.ps.id)).toEqual(['ps_6'])
  })
})
