import { ref, computed } from 'vue'
import { validateVersionLabel, versionIncrementHint } from '@/utils/positionModel'

/**
 * N5/N6 发布版本号编排 composable（收敛三处重复：岗位工作台发布 / 岗位快捷发布弹窗 / 发布前检查弹窗）。
 *
 * 三处此前各自重复了同一套「打开拉建议号 + 推 prevMaxLabel + 组合可提交态」的编排：
 *  - 打开发布：调 fetchNextLabel(id) 拉后端建议的下一个版本号；
 *  - 后端返 null/空串 = 无法自动建议 → atMax=true、versionLabel 留空；
 *  - 否则回填建议号（语义化 vX.Y.Z），并按「建议号 patch-1」推出历史最大号（prevMaxLabel，供「建议递增」软提示）；建议为 vX.Y.0 则留空；
 *  - 拉取失败：不阻断发布——versionLabel/prevMaxLabel 留空让用户手填，格式仍由校验兜底，不给假上限态；
 *  - 派生态：版本号格式硬校验(versionErr)、建议递增软提示(incrementHint)、升级说明必填(notesErr)、
 *    可提交态(canSubmit = 非到顶 + 版本号合法 + 升级说明非空)。
 *
 * 【升级类型自动算号】（2026-09-08 PRD-20260908 对齐，md §3.7 / §9.2「不支持手动输入版本号」；
 * 算法与 VersionDrawer.labelForBump 同口径）：
 *  - load() 后把建议号解析为 suggestedSegs（= 上版 patch+1，即「修订版本」号）；
 *  - setBump('NONE'|'MINOR'|'MAJOR') 改升级类型 → versionLabel 由 labelForBump 自动重算：
 *      NONE  → vX.Y.Z（建议号原值）  MINOR → vX.(Y+1).0  MAJOR → v(X+1).0.0
 *  - firstPublish：建议号为 v1.0.0（mock 无历史版本时的返回）→ 首个版本，无升级类型可选；
 *  - 手填路径（PositionPublishVersionDialog）不受影响：不调 setBump 即维持原行为。
 *
 * 用法：
 *   const vp = useVersionPublish({ fetchNextLabel: (id) => getNextVersionLabel(id) })
 *   // 打开发布时： await vp.load(positionId)   // 内部清空 releaseNotes、拉建议号、推 prevMaxLabel
 *   // 模板绑定： v-model=vp.versionLabel / vp.releaseNotes；读 vp.atMax / vp.versionErr / vp.canSubmit ...
 *   // 自动算号： v-model:bump → vp.setBump(b)；只读展示 vp.versionLabel；vp.firstPublish 时隐藏类型选择
 *
 * @param {Object} options
 * @param {(id:any)=>Promise<string|null>} options.fetchNextLabel 拉后端建议下一版本号（返回 vXXX 或 null/'' 表已到顶）
 * @returns 版本录入状态 + 派生态 + load()
 */
export function useVersionPublish(options = {}) {
  const { fetchNextLabel } = options

  const versionLabel = ref('')
  const releaseNotes = ref('')
  const prevMaxLabel = ref('') // 历史最大版本号（供「建议递增」软提示）
  const atMax = ref(false) // 无法自动建议版本号（禁用版本框 + 人话提示）
  const nextLoading = ref(false)
  // 升级类型自动算号态
  const bump = ref('NONE')
  const suggestedSegs = ref(null) // [X, Y, Z]：建议号（修订版本）三段；null = 建议号不可解析（走手填）
  const firstPublish = ref(false)

  function parseVersion(label) {
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(label || '').trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }

  // 拉取建议的下一个版本号（2026-09-02 起统一语义化 vX.Y.Z）：无历史→v1.0.0；上版 patch+1；
  // 后端/mock 返回 null/'' 视为不可自动建议 → atMax（禁用输入 + 人话提示）。
  // 每次打开发布都清空升级说明（必填、每次重填）。id 传后端建议号接口（岗位 id / 技能 id 皆可）。
  async function load(id) {
    nextLoading.value = true
    atMax.value = false
    versionLabel.value = ''
    releaseNotes.value = ''
    prevMaxLabel.value = ''
    bump.value = 'NONE'
    suggestedSegs.value = null
    firstPublish.value = false
    try {
      const next = await fetchNextLabel(id)
      if (next == null || next === '') {
        atMax.value = true
      } else {
        versionLabel.value = next
        const m = parseVersion(next)
        suggestedSegs.value = m
        // 首个版本：建议号 v1.0.0（无历史版本），无升级类型可选，照原型「首个版本」
        firstPublish.value = !!m && m[0] === 1 && m[1] === 0 && m[2] === 0
        // 历史最大 = 建议号 patch-1（供「建议递增」提示）；建议为 vX.Y.0（首发或次/主版本跳档）
        // 时无法可靠反推历史最大，留空不提示。
        prevMaxLabel.value = m && m[2] > 0 ? `v${m[0]}.${m[1]}.${m[2] - 1}` : ''
      }
    } catch (e) {
      // 建议号拉取失败不阻断发布：留空版本框让用户手填（格式校验仍在），不给假上限态。
      // 记一行 warn（与项目其它降级 catch 口径一致），静默留空会让排障看不到原因。
      console.warn('[useVersionPublish] 拉取建议版本号失败，已降级为手填', e)
      versionLabel.value = ''
      prevMaxLabel.value = ''
    } finally {
      nextLoading.value = false
    }
  }

  /** 按升级类型算号（与 VersionDrawer.labelForBump 同口径）；建议号不可解析时返回当前 versionLabel 原值。 */
  function labelForBump(b) {
    const segs = suggestedSegs.value
    if (!segs) return versionLabel.value
    const [x, y, z] = segs
    if (b === 'MAJOR') return `v${x + 1}.0.0`
    if (b === 'MINOR') return `v${x}.${y + 1}.0`
    return `v${x}.${y}.${z}`
  }

  /** 切换升级类型：版本号自动重算写回 versionLabel（不支持手动输入版本号，md §3.7）。 */
  function setBump(b) {
    bump.value = b === 'MAJOR' || b === 'MINOR' ? b : 'NONE'
    if (firstPublish.value) return
    versionLabel.value = labelForBump(bump.value)
  }

  // 版本号格式硬校验（报错给样例）。
  const versionErr = computed(() => validateVersionLabel(versionLabel.value))
  // 建议递增软提示（不阻断）。
  const incrementHint = computed(() => versionIncrementHint(versionLabel.value, prevMaxLabel.value))
  // 升级说明必填。
  const notesErr = computed(() =>
    String(releaseNotes.value || '').trim() ? '' : '升级说明必填，简述本次更新项'
  )
  // 可提交发布：非到顶 + 版本号格式对 + 升级说明已填。
  const canSubmit = computed(() => !atMax.value && !versionErr.value && !notesErr.value)

  return {
    versionLabel,
    releaseNotes,
    prevMaxLabel,
    atMax,
    nextLoading,
    bump,
    firstPublish,
    versionErr,
    incrementHint,
    notesErr,
    canSubmit,
    load,
    setBump,
    labelForBump
  }
}
