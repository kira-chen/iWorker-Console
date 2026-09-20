import { describe, it, expect } from 'vitest'
import {
  parseVersion,
  normalizeVersion,
  compareVersions,
  formatFileSize,
  validatePackageFile,
  terminalLabel,
  PACKAGE_MAX_BYTES
} from '../versionMeta'

/**
 * versionMeta（版本管理共享纯函数）单测。依据 prd.版本管理.md §二（比对规则）、§4.1（版本号 / 版本包）、§4.3（校验提示）。
 */

describe('版本号解析与规范化（PRD §4.1）', () => {
  it('接受 X.Y.Z 与 vX.Y.Z（v 不分大小写），统一规范为 vX.Y.Z', () => {
    expect(normalizeVersion('1.2.0')).toBe('v1.2.0')
    expect(normalizeVersion('v1.2.0')).toBe('v1.2.0')
    expect(normalizeVersion('V1.2.0')).toBe('v1.2.0')
    expect(normalizeVersion('  v10.0.3 ')).toBe('v10.0.3')
  })

  it('必须恰好三段数字：两段 / 四段 / 含字母 / 空值一律不合法', () => {
    for (const bad of ['1.2', '1.2.0.1', 'v1.2.x', '1.2.0-beta', 'abc', '', null, undefined, 'v', '1..2']) {
      expect(parseVersion(bad)).toBeNull()
      expect(normalizeVersion(bad)).toBe('')
    }
  })

  it('前导零规范掉，避免 1.02.0 与 1.2.0 被当成两个版本', () => {
    expect(normalizeVersion('1.02.0')).toBe('v1.2.0')
  })
})

describe('版本号比较（PRD §二：三段数值逐段比，不做字符串比较）', () => {
  it('v1.10.0 > v1.9.0（字符串比较会得出相反结论）', () => {
    expect(compareVersions('v1.10.0', 'v1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('v1.9.0', 'v1.10.0')).toBeLessThan(0)
  })

  it('逐段优先：主版本 > 次版本 > 修订', () => {
    expect(compareVersions('v2.0.0', 'v1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('v1.3.0', 'v1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.1', 'v1.2.0')).toBeGreaterThan(0)
  })

  it('相等为 0；带不带 v 前缀不影响', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0)
  })
})

describe('文件大小与版本包校验（PRD §4.1 / §4.3）', () => {
  it('formatFileSize：去掉多余的 .0', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(90596966)).toBe('86.4 MB')
    expect(formatFileSize(PACKAGE_MAX_BYTES)).toBe('1 GB')
    expect(formatFileSize(-1)).toBe('—')
  })

  it('格式按终端限制：Windows 收 exe/msi/zip，Mac 收 dmg/pkg/zip，zip 两端通用', () => {
    const f = (name) => ({ name, size: 1024 })
    expect(validatePackageFile('WINDOWS', f('a.exe'))).toBe('')
    expect(validatePackageFile('WINDOWS', f('a.MSI'))).toBe('') // 扩展名不分大小写
    expect(validatePackageFile('MAC', f('a.dmg'))).toBe('')
    expect(validatePackageFile('MAC', f('a.pkg'))).toBe('')
    expect(validatePackageFile('WINDOWS', f('a.zip'))).toBe('')
    expect(validatePackageFile('MAC', f('a.zip'))).toBe('')
    expect(validatePackageFile('WINDOWS', f('a.dmg'))).toBe('Windows 版本包仅支持 .exe / .msi / .zip')
    expect(validatePackageFile('MAC', f('a.exe'))).toBe('Mac 版本包仅支持 .dmg / .pkg / .zip')
  })

  it('空文件与超大文件被拦，格式错误优先于其余', () => {
    expect(validatePackageFile('WINDOWS', { name: 'a.exe', size: 0 })).toBe('版本包不能为空文件')
    expect(validatePackageFile('WINDOWS', { name: 'a.exe', size: PACKAGE_MAX_BYTES + 1 })).toBe('版本包不能超过 1 GB')
    expect(validatePackageFile('WINDOWS', { name: 'a.txt', size: 0 })).toContain('仅支持')
  })

  it('terminalLabel：未知终端原样回显，空值显示 —', () => {
    expect(terminalLabel('MAC')).toBe('Mac')
    expect(terminalLabel('WINDOWS')).toBe('Windows')
    expect(terminalLabel('')).toBe('—')
  })
})
