// @vitest-environment jsdom
// （各 mock → request.js → router 链路触达 window，故用 jsdom）
import { describe, it, expect, vi } from 'vitest'

/**
 * mock 种子指纹守卫（2026-10-08 /test-audit 共享层 T20，负责人批准新增）。
 *
 * 【守什么】「改了种子却没 bump 持久化版本号」——旧浏览器里的存量快照版本号对得上，就会继续沿用旧种子，
 * 演示时看到的是改之前的数据。本月已发生三次（待办 yuepu#16 / #30 / #53），mockPersist.js 头注的检查清单只能靠人记。
 *
 * 【怎么做】拦截 attachPersist，记下每个 mock 模块登记的 moduleKey / version / snapshot；模块刚加载、尚未写入时，
 * snapshot() 就是种子本身。对它做「键排序后 JSON + FNV-1a」得到指纹，与下表比对：
 *   - 版本号没变、指纹变了 → 红：改了种子，请把该模块 attachPersist 的 version +1；
 *   - 版本号变了 → 红：请把下表该行的 version 与 fp 一并更新为新值（这一步就是「我确认 bump 过了」）。
 * 改种子的正确姿势：bump version → 跑本用例 → 按报错把新 version / fp 抄进下表。
 *
 * 【确定性】种子里有按「当前时间」生成的值，故固定 Date（只假 Date，不假定时器）；TZ 由 vitest.config.js 固定为东八区。
 * 实测同一份代码独立运行 3 次指纹完全一致。下表不追溯历史：unifiedSkill 的 v6 已知漏 bump 一次（yuepu#53），由该待办处理。
 */
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date('2026-10-08T12:00:00+08:00'))

const registry = {}
vi.mock('@/api/mockPersist', async (importOriginal) => ({
  ...(await importOriginal()),
  attachPersist: (moduleKey, opts) => {
    registry[moduleKey] = opts
    return () => {}
  }
}))

/** 登记表：moduleKey → 当前持久化版本号 + 种子指纹。改种子时按本文件头注的步骤同步更新。 */
const FINGERPRINTS = {
  accessAuditOps: { version: 1, fp: 'ebadc885' },
  adminModel: { version: 2, fp: '2887e06b' },
  adminUser: { version: 4, fp: '6f9c19c5' },
  apiConnector: { version: 5, fp: '9ebe97ad' },
  bizSystem: { version: 3, fp: '83c5d8dc' },
  dataTable: { version: 2, fp: '592831be' },
  domainExpert: { version: 5, fp: 'd606c2bf' },
  fieldDict: { version: 4, fp: '40d8527d' },
  instanceManagement: { version: 1, fp: '60bc3e19' },
  knowledgeBase: { version: 9, fp: '04ba3a72' },
  mcpConnector: { version: 8, fp: '0f5252d5' },
  myApplications: { version: 7, fp: 'b8042447' },
  position: { version: 7, fp: '8e3bc6d6' },
  positionApplications: { version: 4, fp: 'bf5160f2' },
  positionAssignment: { version: 2, fp: 'a3b870be' },
  reviews: { version: 8, fp: 'ffc05ceb' },
  runtimeSpec: { version: 2, fp: '917f1f22' },
  sampleTask: { version: 6, fp: '01a9bf8e' },
  skillReview: { version: 3, fp: 'aa231c01' },
  unifiedSkill: { version: 6, fp: '8c59fbb1' },
  version: { version: 5, fp: '45a0afc5' }
}

const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))
      : v

/** FNV-1a 32 位：零依赖、足够区分「种子改没改」。 */
export function fingerprint(data) {
  const s = JSON.stringify(stable(data))
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 比对一个模块：返回问题描述（无问题返回 null）。导出给自检用例。 */
export function checkModule(key, { version, fp }, expected) {
  if (!expected) return `${key}：新接入持久化的模块，请在登记表补一行 { version: ${version}, fp: '${fp}' }`
  if (version !== expected.version) {
    return `${key}：version 已从 ${expected.version} 改为 ${version}，请把登记表该行更新为 { version: ${version}, fp: '${fp}' }`
  }
  if (fp !== expected.fp) return `${key}：种子变了（指纹 ${expected.fp} → ${fp}）但 version 仍是 ${version}——请 bump version 并更新登记表`
  return null
}

const MOCK_MODULES = import.meta.glob('../*Mock.js')

describe('mock 种子指纹守卫（防改种子漏 bump 持久化版本）', () => {
  it('每个接入持久化的 mock：种子指纹与版本号都与登记表一致', async () => {
    for (const load of Object.values(MOCK_MODULES)) await load()
    const keys = Object.keys(registry)
    expect(keys.length, '至少应登记到一个模块（拦截失败会让守卫空转）').toBeGreaterThan(10)
    const problems = keys
      .sort()
      .map((k) => checkModule(k, { version: registry[k].version, fp: fingerprint(registry[k].snapshot()) }, FINGERPRINTS[k]))
      .filter(Boolean)
    const gone = Object.keys(FINGERPRINTS).filter((k) => !keys.includes(k)).map((k) => `${k}：登记表里有、代码里已不再接入持久化，请删掉该行`)
    expect([...problems, ...gone]).toEqual([])
  })

  it('自检：改种子不 bump 会报、bump 了没更新表会报、未登记会报（防守卫写错永远通过）', () => {
    const fp = fingerprint({ rows: [{ id: 1, name: '种子' }] })
    expect(fingerprint({ rows: [{ name: '种子', id: 1 }] })).toBe(fp) // 键序不影响
    expect(checkModule('x', { version: 2, fp }, { version: 2, fp })).toBeNull()
    expect(checkModule('x', { version: 2, fp: fingerprint({ rows: [{ id: 1, name: '改了' }] }) }, { version: 2, fp })).toMatch(/请 bump version/)
    expect(checkModule('x', { version: 3, fp: 'ffffffff' }, { version: 2, fp })).toMatch(/version 已从 2 改为 3/)
    expect(checkModule('x', { version: 1, fp }, undefined)).toMatch(/新接入持久化/)
  })
})
