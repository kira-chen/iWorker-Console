/**
 * 图标展示判断（2026-09-02 W-3 图标统一规则配套）。
 *
 * 全站图标字段三种取值：字符/emoji（直接文本渲染）、服务端图标库路径或 http(s) URL、
 * 以及裁剪上传产物 data:image/... dataURL（IconPickerPopover 输出 256×256 PNG）。
 * 此前各列表页/编辑器各写一套 startsWith 判断且均不识别 data:，集中收口于此。
 */
export function iconIsUrl(icon) {
  return typeof icon === 'string' && /^(https?:\/\/|\/|data:image\/)/.test(icon)
}
