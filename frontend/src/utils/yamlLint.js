/**
 * frontmatter YAML 校验（功能波次 2b · 组④；frontmatter 编辑改造升级为真解析）。
 *
 * 背景：frontmatter 折叠区写坏 YAML 会污染喂模型的 SOP（首块 frontmatter 被后端解析），
 * 且市场单技能导出会把坏 YAML 原样带给客户端。
 *
 * 两层：
 *  - lintYaml()：零依赖启发式（tab 缩进/顶层重复键/漏冒号/缩进不齐/引号不配对），中文文案友好。
 *    注意它在合法 YAML 上会误报（实锤存量：多行中文 plain scalar 里的引号被当「不配对」），
 *    故只作 analyzeFrontmatter 解析失败时的文案兜底，不单独用作报错依据。
 *  - analyzeFrontmatter()：`yaml`（eemeli/yaml）真解析（解析失败/超长/别名炸弹）+ 字段级校验
 *    （2026-07-15 需求定案）：name 独立规则（小写/数字/连字符、1-64、不以 - 开头结尾、无 --；
 *    「与父目录一致」在本系统无可比对父目录，经拍板不校验）、description 必填、顶层字段闭集
 *    （name/description/license/compatibility/metadata/allowed-tools，其余报错）。
 *    非阻断：调用方只做提示，不拦保存。
 */
import { parseDocument, isScalar, isMap } from 'yaml'

// frontmatter 原文大小上限（防前端自 DoS；后端另有 256KB codePointLimit 双保险）。
export const MAX_FRONTMATTER_BYTES = 32 * 1024
// 别名展开上限，与后端 S2 防护（setMaxAliasesForCollections=10）口径对齐。
const MAX_ALIAS_COUNT = 10
// 顶层字段闭集（需求定案：除 name/description 外，license、compatibility、metadata、allowed-tools 选填）。
export const ALLOWED_TOP_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']
// name 规则：仅小写字母/数字/连字符，长度 1-64，不以 - 开头/结尾，不含连续 --。
export const NAME_MAX_LEN = 64

/**
 * @param {string} text frontmatter 原始 YAML（不含 --- 围栏）
 * @returns {{ line:number, message:string } | null} 首个错误 or null
 */
export function lintYaml(text) {
  const src = String(text ?? '')
  if (!src.trim()) return null // 空 frontmatter 合法

  const lines = src.split('\n')
  const seenTopKeys = new Set()
  // 缩进栈：记录已出现过的缩进层级（块映射同级须缩进一致）。
  const indentStack = [0]

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1
    const trimmed = raw.trim()

    // 跳过空行 / 注释 / 文档分隔。
    if (trimmed === '' || trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') continue

    // 1) tab 缩进（YAML 规范禁止用 tab 做缩进）。
    const leading = raw.slice(0, raw.length - raw.trimStart().length)
    if (leading.includes('\t')) {
      return { line: lineNo, message: '不能用 Tab 缩进，请改用空格（每层缩进用 2 个空格）' }
    }
    const indent = leading.length

    // 块标量 / 多行字符串（| 或 >）后续内容不逐行结构校验——跳过其缩进块（保守，避免误报正文）。
    // 这里只做轻量识别：若本行以 `key: |` 或 `key: >` 结尾，则跳过其后更深缩进的所有行。
    const blockScalar = /:\s*[|>][+-]?\s*(#.*)?$/.test(trimmed)

    // 列表项 / 续行不参与「键」校验。
    const isListItem = trimmed.startsWith('- ') || trimmed === '-'

    if (!isListItem) {
      // 2) 键值结构：合法块映射行须含未被引号包裹的冒号（`key: value` / `key:`）。
      const colonIdx = topLevelColonIndex(trimmed)
      if (colonIdx < 0) {
        // 既不是列表项、又没有冒号 → 形如 `key value`（漏冒号）。
        // 例外：可能是上一行块标量/续行的延续——但块标量已在下方跳过其缩进块，故此处保守仅当「看起来像键」时报。
        if (/^[^\s"'#].*\s+\S/.test(trimmed)) {
          return {
            line: lineNo,
            message: '格式有误：应写成「键: 值」，冒号后留一个空格，如 name: 我的技能'
          }
        }
      } else {
        // 顶层重复键校验（indent===0）。
        if (indent === 0) {
          const key = trimmed.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '')
          if (key && seenKey(seenTopKeys, key)) {
            return {
              line: lineNo,
              message: `「${key}」这个名字出现了两次，同一层不能有两个同名的项，请删掉或改名其中一个`
            }
          }
        }
      }

      // 3) 缩进一致性（块映射）：缩进只能在进入子块时增大、回到上级时回到栈中已有层级。
      const top = indentStack[indentStack.length - 1]
      if (indent > top) {
        indentStack.push(indent)
      } else if (indent < top) {
        // 回退：必须落到栈中已存在的某一层级，否则缩进错位。
        while (indentStack.length && indentStack[indentStack.length - 1] > indent) indentStack.pop()
        if (indentStack[indentStack.length - 1] !== indent) {
          return {
            line: lineNo,
            message: '缩进对不齐：和上面同一层的内容要对齐（每层用 2 个空格，别多一格少一格）'
          }
        }
      }
    }

    // 4) 未闭合引号（同一行内单/双引号奇数个，排除注释后）。
    const codePart = stripInlineComment(trimmed)
    if (countUnescaped(codePart, '"') % 2 !== 0) {
      return { line: lineNo, message: '双引号 " 没有成对，请补上另一个 "，如 name: "我的技能"' }
    }
    if (countUnescaped(codePart, "'") % 2 !== 0) {
      return { line: lineNo, message: "单引号 ' 没有成对，请补上另一个 '，如 name: '我的技能'" }
    }

    // 块标量：跳过其后更深缩进块（不逐行结构校验其内容）。
    if (blockScalar) {
      const baseIndent = indent
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        if (next.trim() === '') {
          j++
          continue
        }
        const nextIndent = next.length - next.trimStart().length
        if (nextIndent <= baseIndent) break
        j++
      }
      i = j - 1
    }
  }

  return null
}

// 顶层（不在引号内）的第一个冒号位置，且冒号后须是空白或行尾（避免误把 `http://x` 当键值分隔）。
function topLevelColonIndex(s) {
  let inS = false
  let inD = false
  for (let k = 0; k < s.length; k++) {
    const c = s[k]
    if (c === "'" && !inD) inS = !inS
    else if (c === '"' && !inS) inD = !inD
    else if (c === ':' && !inS && !inD) {
      const next = s[k + 1]
      if (next === undefined || next === ' ' || next === '\t') return k
    }
  }
  return -1
}

// 去掉行内注释（# 前须有空白才算注释；引号内的 # 不算）。
function stripInlineComment(s) {
  let inS = false
  let inD = false
  for (let k = 0; k < s.length; k++) {
    const c = s[k]
    if (c === "'" && !inD) inS = !inS
    else if (c === '"' && !inS) inD = !inD
    else if (c === '#' && !inS && !inD && (k === 0 || s[k - 1] === ' ' || s[k - 1] === '\t')) {
      return s.slice(0, k)
    }
  }
  return s
}

// 统计未转义的某引号字符数量（\" 不计）。
function countUnescaped(s, quote) {
  let n = 0
  for (let k = 0; k < s.length; k++) {
    if (s[k] === quote && s[k - 1] !== '\\') n++
  }
  return n
}

// 顶层键去重（原样大小写比较，与 YAML 一致）。
function seenKey(set, key) {
  if (set.has(key)) return true
  set.add(key)
  return false
}

/* ============================ analyzeFrontmatter：真解析 + 字段级校验 ============================ */

/**
 * frontmatter 校验（真 YAML 解析 + 字段规则）。全部非阻断。
 *
 * 报错项：YAML 解析失败 / 超长 / 别名炸弹；name 规则违例；description 缺失；闭集外顶层字段。
 * 解析失败时跳过字段级校验（先修格式再看字段）。
 *
 * @param {string} raw frontmatter 原始 YAML（不含 --- 围栏）
 * @returns {{ errors: Array<{ line:number|null, message:string }> }}
 */
export function analyzeFrontmatter(raw) {
  const src = String(raw ?? '')
  const result = { errors: [] }
  if (!src.trim()) {
    // 空 frontmatter：必填字段直接缺失（有围栏块就按规范要求补全）。
    result.errors.push({ line: null, message: '缺少 name 字段（必填），如：name: customer-insight' })
    result.errors.push({ line: null, message: '缺少 description 字段（必填），如：description: 一句话说明这个技能做什么' })
    return result
  }

  // 超长护栏：报错并跳过解析（防超大粘贴卡死标签页）。
  if (byteLength(src) > MAX_FRONTMATTER_BYTES) {
    result.errors.push({
      line: null,
      message: '基本信息内容过长（超过 32KB），已跳过格式检查，请精简后再编辑'
    })
    return result
  }

  // 真解析：parseDocument 不抛异常、聚合全部错误带行号。格式错误一律以真解析为准——
  // lintYaml 的启发式在合法 YAML 上会误报（实锤存量：多行中文 plain scalar 里的引号被当「不配对」），
  // 仅当真解析也失败时才借用它的中文文案（比库的英文报错友好）。
  let doc
  try {
    doc = parseDocument(src, { prettyErrors: true })
    if (doc.errors && doc.errors.length > 0) {
      const lintErr = lintYaml(src)
      if (lintErr) {
        result.errors.push({ line: lintErr.line, message: lintErr.message })
      } else {
        const e = doc.errors[0]
        const line = e.linePos && e.linePos[0] ? e.linePos[0].line : null
        result.errors.push({
          line,
          message: 'YAML 格式有误：请检查缩进、冒号与引号是否配对'
        })
      }
      return result
    }
    // toJS 仅作别名炸弹护栏（parseDocument 不展开别名，展开发生在这里）。
    doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT })
  } catch {
    result.errors.push({ line: null, message: 'YAML 内容异常（引用展开过多或结构过深），请简化' })
    return result
  }

  // 字段级校验（解析成功后）。顶层须是「键: 值」映射。
  if (!isMap(doc.contents)) {
    result.errors.push({ line: null, message: '基本信息应是「键: 值」的结构（如 name: customer-insight）' })
    return result
  }

  // metadata 下已有子键集合（metadata 缺失/非映射 → 空集）：用于区分「一级与 metadata 同名冲突」与普通非官方字段。
  const metaItem = doc.contents.items.find(
    (it) => (isScalar(it.key) ? String(it.key.value) : String(it.key)) === 'metadata'
  )
  const metaKeys = new Set()
  if (metaItem && isMap(metaItem.value)) {
    for (const sub of metaItem.value.items) {
      metaKeys.add(isScalar(sub.key) ? String(sub.key.value) : String(sub.key))
    }
  }

  let nameItem = null
  let descItem = null
  for (const item of doc.contents.items) {
    const key = isScalar(item.key) ? String(item.key.value) : String(item.key)
    const line = lineOfOffset(src, isScalar(item.key) && item.key.range ? item.key.range[0] : null)
    if (key === 'name') {
      nameItem = item
    } else if (key === 'description') {
      descItem = item
    } else if (!ALLOWED_TOP_KEYS.includes(key)) {
      // 官方规范对未识别一级字段的语义是「忽略」而非禁止；导入时系统会自动把非官方字段归入 metadata，
      // 唯独「一级与 metadata 同名」按约定跳过等人工合并（2026-08-04）。两种情形分开提示，不说成「不支持」。
      result.errors.push({
        line,
        message: metaKeys.has(key)
          ? `字段「${key}」在一级与 metadata 中同时存在：系统未自动合并，请比对两处取值后手动保留一处`
          : `非官方字段「${key}」：建议移入 metadata 下（官方一级字段仅 name、description、license、compatibility、metadata、allowed-tools；技能包导入时会自动归入）`
      })
    }
  }

  // name 独立规则（缺失/非文本/字符集/长度/连字符边界，报首个违例）。
  if (!nameItem) {
    result.errors.push({ line: null, message: '缺少 name 字段（必填），如：name: customer-insight' })
  } else {
    const line = lineOfOffset(src, isScalar(nameItem.key) && nameItem.key.range ? nameItem.key.range[0] : null)
    const nameErr = validateName(nameItem.value)
    if (nameErr) result.errors.push({ line, message: nameErr })
  }

  // description 必填（须有非空文本值）。
  if (!descItem) {
    result.errors.push({ line: null, message: '缺少 description 字段（必填），如：description: 一句话说明这个技能做什么' })
  } else {
    const line = lineOfOffset(src, isScalar(descItem.key) && descItem.key.range ? descItem.key.range[0] : null)
    const v = descItem.value
    if (v == null || (isScalar(v) && String(v.value ?? '').trim() === '')) {
      result.errors.push({ line, message: 'description 不能为空（必填），如：description: 一句话说明这个技能做什么' })
    }
  }

  return result
}

// name 规则校验：返回首个违例的文案，合规返回 null。
function validateName(valueNode) {
  if (valueNode == null || !isScalar(valueNode) || valueNode.value == null) {
    return 'name 应是一行文本，如：name: customer-insight'
  }
  const v = String(valueNode.value)
  if (v.length < 1 || v.length > NAME_MAX_LEN) {
    return `name 长度须在 1-${NAME_MAX_LEN} 个字符之间（当前 ${v.length}）`
  }
  if (/[^a-z0-9-]/.test(v)) {
    return 'name 只能包含小写字母(a-z)、数字(0-9)和连字符(-)'
  }
  if (v.startsWith('-') || v.endsWith('-')) {
    return 'name 不能以连字符(-)开头或结尾'
  }
  if (v.includes('--')) {
    return 'name 不能包含连续的连字符(--)'
  }
  return null
}

// 由字符偏移量算 1-based 行号（yaml 节点 range 是偏移量）；无偏移返回 null。
function lineOfOffset(src, offset) {
  if (offset == null || offset < 0) return null
  let line = 1
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line++
  }
  return line
}

// UTF-8 字节长（与后端「按内容大小设限」口径一致，中文按 3 字节计）。
function byteLength(s) {
  return new TextEncoder().encode(s).length
}
