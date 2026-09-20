/**
 * 客户端版本管理（05 治理 / 版本管理）的共享元数据与纯函数。
 * 依据 docs/PRD/数字员工管理端PRD/05治理/版本管理/prd.版本管理.md。
 *
 * 页面（AdminVersions.vue）、抽屉（VersionEditor.vue）与 mock 层（versionMock.js）三处共用，
 * 保证「版本号怎么比、版本包怎么校验」只有一份实现。
 */

/* ---------------- 终端 ---------------- */

/** 终端枚举，仅 Windows / Mac（与访问审计、用户反馈同口径）。 */
export const TERMINAL_OPTIONS = [
  { value: 'WINDOWS', label: 'Windows' },
  { value: 'MAC', label: 'Mac' }
]

export function terminalLabel(terminal) {
  return TERMINAL_OPTIONS.find((o) => o.value === terminal)?.label || terminal || '—'
}

/* ---------------- 状态 ---------------- */

/** 版本状态：未发布 → 已发布 → 已停用（→ 可重新发布），见 PRD §八「状态流转」。 */
export const VERSION_STATUS = {
  UNPUBLISHED: 'UNPUBLISHED',
  PUBLISHED: 'PUBLISHED',
  STOPPED: 'STOPPED'
}

/** 状态 → 文案与 StatusTag 类型（未发布灰 / 已发布绿 / 已停用橙）。 */
export const STATUS_META = {
  UNPUBLISHED: { label: '未发布', tagType: 'info' },
  PUBLISHED: { label: '已发布', tagType: 'success' },
  STOPPED: { label: '已停用', tagType: 'warning' }
}

/* ---------------- 版本号 ---------------- */

/**
 * 解析版本号：接受 `1.2.0` / `v1.2.0`（v 不分大小写），必须恰好三段非负整数。
 * @returns {number[]|null} [X, Y, Z]；不合法返回 null
 */
export function parseVersion(input) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/i.exec(String(input ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** 规范化为 `vX.Y.Z`（保存与展示口径）；不合法返回 ''。 */
export function normalizeVersion(input) {
  const parts = parseVersion(input)
  return parts ? `v${parts.join('.')}` : ''
}

/**
 * 版本号比较：三段**数值**逐段比（v1.10.0 > v1.9.0），不做字符串比较。
 * 用户端「有无更新」与发布前「须高于当前已发布版本」两处都靠它。
 * @returns {number} a>b 为正，a<b 为负，相等为 0
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a) || [0, 0, 0]
  const pb = parseVersion(b) || [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

/* ---------------- 版本包 ---------------- */

/** 各终端允许的版本包格式（PRD §4.1）。 */
export const PACKAGE_EXTS = {
  WINDOWS: ['.exe', '.msi', '.zip'],
  MAC: ['.dmg', '.pkg', '.zip']
}

/** 版本包大小上限。1 GB 为占位值，尚未与研发对齐（PRD §十 第 3 项）。 */
export const PACKAGE_MAX_BYTES = 1024 ** 3

/** 更新说明字数上限（描述类统一 2000，见《各模块必填选填字段一览表》）。 */
export const RELEASE_NOTES_MAX = 2000

/** 字节数 → 可读大小（86.4 MB / 1 GB），去掉多余的 .0。 */
export function formatFileSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const text = i === 0 ? String(v) : v.toFixed(1).replace(/\.0$/, '')
  return `${text} ${units[i]}`
}

/**
 * 选择文件时的即时校验（PRD §4.3）：格式 → 空文件 → 大小。
 * @param {string} terminal WINDOWS / MAC
 * @param {{name:string,size:number}} file
 * @returns {string} 错误提示；通过返回 ''
 */
export function validatePackageFile(terminal, file) {
  const exts = PACKAGE_EXTS[terminal] || []
  const name = String(file?.name || '').toLowerCase()
  if (!exts.some((ext) => name.endsWith(ext))) {
    return `${terminalLabel(terminal)} 版本包仅支持 ${exts.join(' / ')}`
  }
  if (!file.size) return '版本包不能为空文件'
  if (file.size > PACKAGE_MAX_BYTES) return `版本包不能超过 ${formatFileSize(PACKAGE_MAX_BYTES)}`
  return ''
}
