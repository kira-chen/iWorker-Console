/**
 * 受限富文本前端净化（领用页 v-html 渲染 + ClaimDescEditor 回吐前必过）。
 *
 * 设计真相源：岗位编辑改造-设计.md §3.4 / §3.6 / §4.3。
 * 纵深防御（不信任后端返回 + 防御历史脏数据）：用浏览器原生 DOMParser 解析，
 * 仅保留白名单内联标签，剥离全部属性与非白名单标签（非白名单标签替换为其纯文本）。
 *
 * 白名单标签：b / strong / i / em / u / br（与后端 Jsoup Safelist 一致，零属性）。
 * 因白名单无任何属性（无 href/src），javascript:/data: 协议天然杜绝。
 */

// 受限内联白名单（小写）。<br> 为自闭合，无子节点。
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br'])

/**
 * 净化受限内联 HTML。
 * @param {string} html 原始 HTML 串（可能含恶意/脏标签）
 * @returns {string} 仅含白名单标签、零属性的安全 HTML
 */
export function sanitizeInline(html) {
  const raw = String(html == null ? '' : html)
  if (!raw) return ''
  // 浏览器原生解析（比正则安全）：放进 body，递归白名单遍历。
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  const out = sanitizeNode(doc.body, doc)
  return out.innerHTML
}

/**
 * 递归净化：克隆出仅含白名单标签 + 文本的新片段。
 * - 文本节点：原样保留（DOMParser 已对实体解码；写回 innerHTML 时浏览器自动转义，安全）。
 * - 元素节点：白名单内 → 新建同名零属性元素并递归子节点；非白名单 → 仅保留其子节点（文本化）。
 */
function sanitizeNode(node, doc) {
  const frag = doc.createElement('div')
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      frag.appendChild(doc.createTextNode(child.textContent))
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return // 注释等丢弃
    const tag = child.tagName.toLowerCase()
    if (ALLOWED_TAGS.has(tag)) {
      const clean = doc.createElement(tag) // 零属性新元素（丢弃 class/style/on*/href 等全部属性）
      if (tag !== 'br') {
        const inner = sanitizeNode(child, doc)
        while (inner.firstChild) clean.appendChild(inner.firstChild)
      }
      frag.appendChild(clean)
    } else {
      // 非白名单标签（a/script/img/div/span…）：剥标签，仅保留其纯文本内容（递归）。
      const inner = sanitizeNode(child, doc)
      while (inner.firstChild) frag.appendChild(inner.firstChild)
    }
  })
  return frag
}

/**
 * 取净化后去标签的纯文本（判空 / 软字数统计用）。
 * 修复 contenteditable 清空后残留 <br>/&nbsp; 被误判为非空：以可见文本为准。
 * @param {string} html
 * @returns {string} trim 后的纯文本
 */
export function plainText(html) {
  const raw = String(html == null ? '' : html)
  if (!raw) return ''
  const doc = new DOMParser().parseFromString(sanitizeInline(raw), 'text/html')
  // 不间断空格（\u00A0，即 &nbsp;）归一为普通空格再 trim，避免残留空白被当作非空。
  return (doc.body.textContent || '').replace(/\u00A0/g, " ").trim()
}
