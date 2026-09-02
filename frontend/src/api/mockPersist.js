/**
 * mock 层 localStorage 持久化公共工具（2026-09-02 demo 数据持久化改造）。
 *
 * 背景：项目为纯前端 demo，各 xxxMock.js 的数据原先只存内存，刷新即回种子态。
 * 本工具把每个 mock 模块的内存状态镜像到 localStorage，刷新/重开浏览器后数据仍在；
 * 数据只落在使用者自己浏览器的站点存储里（按域名+端口隔离），不写磁盘文件、不发网络请求。
 *
 * 接入方式（各 mock 文件在模块尾部调用一次）：
 *   const persist = attachPersist('domainExpert', {
 *     version: 1,
 *     snapshot: () => ({ ... }),        // 把本模块全部可变状态收敛成可 JSON 序列化的普通对象
 *     restore: (data) => { ... },       // 从快照写回状态；Map/Set 在这里自行转换；
 *   })                                  // 派生索引（由主数据算出的 Map 等）应重建而非直接存
 *   // 之后每个写操作末尾调用 persist()
 *
 * 【不可用兜底铁律】任何一步失败都不能让页面挂掉：
 * - 环境没有 localStorage（node 单测 / 隐私模式禁用）→ 静默退化为纯内存模式；
 * - 存量数据版本不符（发新包改了种子结构后 version 需 +1）→ 丢弃旧数据、用种子重新播种；
 * - 存量 JSON 损坏 / restore 抛异常 → 清掉该 key、用种子兜底（console.warn 提示）；
 * - 写入失败（配额满等）→ 本次放弃并告警一次，不影响内存数据与页面交互。
 *
 * 重置：URL 带 ?resetMock=1 打开 → 本次加载先清空全部 mock 存储，回到出厂态
 * （去掉参数后再刷新即恢复正常持久化）。也可用浏览器「清除站点数据」。
 *
 * 【出厂数据】（2026-09-02 二期）mockSeedOverrides.json 可内置一份「出厂演示数据」随包分发：
 * 恢复优先级 = localStorage 存量 > 出厂数据 > 代码种子。制作流程：在演示浏览器里把数据摆好 →
 * URL 带 ?exportMock=1 打开一次（自动下载 iworker-demo-data-*.json）→ 把文件内容放入
 * mockSeedOverrides.json → 重新打包。出厂数据同样受各模块 version 戳约束（不符即忽略回种子），
 * 恢复失败一样兜底，不会让页面挂掉。默认 entries 为空对象 = 无出厂数据，行为同一期。
 */
import seedOverrides from './mockSeedOverrides.json'

const PREFIX = 'iworker-demo-mock:'

// 特性检测：拿不到可用的 localStorage 就返回 null（node 测试环境 / 浏览器禁用存储时走纯内存）。
function detectStorage() {
  try {
    const s = globalThis.localStorage
    if (!s) return null
    const probe = `${PREFIX}__probe__`
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

const storage = detectStorage()

// 清空本工具名下的全部存储 key（只动 iworker-demo-mock: 前缀，不碰站点其他数据）。
export function clearAllMockState() {
  if (!storage) return
  try {
    const keys = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.startsWith(PREFIX)) keys.push(k)
    }
    keys.forEach((k) => storage.removeItem(k))
  } catch {
    /* 清理失败不阻塞页面 */
  }
}

// ?exportMock=1 → 把当前浏览器里的全部 mock 数据打成 JSON 下载（用于制作出厂数据）。
function exportAllMockState() {
  if (!storage) return
  const entries = {}
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (!k || !k.startsWith(PREFIX)) continue
    try {
      entries[k.slice(PREFIX.length)] = JSON.parse(storage.getItem(k))
    } catch {
      /* 单条损坏跳过 */
    }
  }
  const pad = (n) => String(n).padStart(2, '0')
  const d = new Date()
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  const blob = new Blob([JSON.stringify({ exportedAt: d.toISOString(), entries }, null, 2)], {
    type: 'application/json'
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `iworker-demo-data-${stamp}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  console.info(`[mockPersist] exportMock=1：已导出 ${Object.keys(entries).length} 个模块的演示数据`)
}

// ?resetMock=1 清空回出厂态 / ?exportMock=1 导出（模块首次 import 时执行一次）。
try {
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const qs = new URLSearchParams(window.location.search)
    if (qs.get('exportMock') === '1') exportAllMockState()
    if (qs.get('resetMock') === '1') {
      clearAllMockState()
      console.info('[mockPersist] resetMock=1：已清空本机改动，本次以出厂数据/种子启动')
    }
  }
} catch {
  /* URL 解析失败视同未带参数 */
}

/**
 * 挂接一个 mock 模块的持久化。返回 persist()：把 snapshot() 结果写入 localStorage。
 * 调用本函数时若存在同版本的历史快照，会立即通过 restore(data) 写回模块状态。
 */
export function attachPersist(moduleKey, { version = 1, snapshot, restore }) {
  const key = PREFIX + moduleKey

  // 出厂数据兜底恢复（无存量/存量作废时用）。失败只告警，保持代码种子。
  function applyBundled() {
    try {
      const bundled = seedOverrides && seedOverrides.entries ? seedOverrides.entries[moduleKey] : null
      if (bundled && bundled.v === version) restore(bundled.data)
    } catch (e) {
      console.warn(`[mockPersist] ${moduleKey} 出厂数据不可用，已回退到种子数据`, e)
    }
  }

  if (!storage) {
    // 纯内存模式（node 单测 / 浏览器禁用存储）：仍应看到出厂数据，只是改动不落盘。
    applyBundled()
    return () => {}
  }

  // 启动恢复：localStorage 存量 > 出厂数据 > 代码种子。
  // 版本不符/解析失败/restore 抛错 → 丢弃存量，降级到出厂数据。
  let restoredFromStorage = false
  try {
    const raw = storage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.v === version) {
        restore(parsed.data)
        restoredFromStorage = true
      } else {
        storage.removeItem(key)
      }
    }
  } catch (e) {
    try {
      storage.removeItem(key)
    } catch {
      /* ignore */
    }
    console.warn(`[mockPersist] ${moduleKey} 存量数据不可用，已回退到出厂数据/种子`, e)
  }
  if (!restoredFromStorage) applyBundled()

  let writeWarned = false
  return function persist() {
    try {
      storage.setItem(key, JSON.stringify({ v: version, data: snapshot() }))
    } catch (e) {
      if (!writeWarned) {
        writeWarned = true
        console.warn(`[mockPersist] ${moduleKey} 写入本地存储失败（本次改动仅存内存）`, e)
      }
    }
  }
}
