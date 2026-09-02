import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  uploadDoc,
  getDocsStatus,
  listDocs,
  deleteDoc,
  reparseDoc,
  getCapacity
} from '@/api/space'
import { ApiError } from '@/api/request'

/* ---------------- 前端预校验常量（契约 §1） ---------------- */
export const MAX_FILE_BYTES = 50 * 1024 * 1024 // 单文件 50MB
export const MAX_BATCH = 10 // 单次最多选 10 个文件（UI 批量约束，PRD §1.5）
export const TOTAL_BYTES = 2 * 1024 * 1024 * 1024 // 个人空间总容量 2GB（账户唯一上限口径）
// 扩展名白名单（pdf/doc/docx/txt/md/markdown）
export const ALLOW_EXT = ['pdf', 'doc', 'docx', 'txt', 'md', 'markdown']

const NON_TERMINAL = ['pending', 'parsing'] // 非终态（需轮询）
const POLL_INTERVAL = 2500 // 轮询间隔 2.5s（契约 §1.1：2~3s）

function extOf(name) {
  const i = (name || '').lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

let taskSeq = 0

/**
 * 个人空间状态管理：文档列表、上传任务队列、容量、状态轮询。
 *
 * uploadTask 结构：
 *  { id, name, size, status:'uploading|success|failed|canceled', percent,
 *    error, code, aborter }
 */
export const useSpaceStore = defineStore('space', () => {
  /* ---------------- 列表态 ---------------- */
  const docs = ref([])
  const total = ref(0)
  const page = ref(1)
  const size = ref(20)
  const keyword = ref('')
  const status = ref('all')
  const listLoading = ref(false)
  const listError = ref(false)

  /* ---------------- 容量态 ---------------- */
  const capacity = ref({ usedBytes: 0, totalBytes: TOTAL_BYTES, percent: 0 })

  /* ---------------- 上传任务队列 ---------------- */
  const uploadTasks = ref([])
  const uploading = computed(() => uploadTasks.value.some((t) => t.status === 'uploading'))

  /**
   * 列表展示行 = 在途上传任务（uploading/failed/canceled）置顶 + 已落库文档。
   * 上传任务以「合成行」内联进列表：成功任务一旦 loadList 拉回真实文档即从队列移除，
   * 不与文档行重复（避免一份文件出现两行）。合成行带 _upload 引用以驱动进度/取消/重试。
   */
  const displayRows = computed(() => {
    const taskRows = uploadTasks.value
      .filter((t) => t.status !== 'success')
      .map((t) => ({
        docId: t.id, // 合成行用任务 id 作 row-key，避免与真实 docId 冲突
        name: t.name,
        size: t.size,
        mimeType: '',
        source: 'UPLOAD',
        parseStatus: t.status === 'failed' ? 'failed' : 'pending',
        errorReason: t.error,
        createdAt: null,
        _upload: t // 合成行标记：携带原始上传任务
      }))
    return [...taskRows, ...docs.value]
  })

  /* ---------------- 轮询 ---------------- */
  let pollTimer = null

  /* ============================ 列表 ============================ */

  async function loadList() {
    listLoading.value = true
    listError.value = false
    try {
      const data = await listDocs({
        keyword: keyword.value || undefined,
        status: status.value || 'all',
        page: page.value,
        size: size.value
      })
      docs.value = data?.list || []
      total.value = data?.total || 0
      schedulePoll()
    } catch (e) {
      listError.value = true
    } finally {
      listLoading.value = false
    }
  }

  function setFilters({ keyword: kw, status: st } = {}) {
    if (kw !== undefined) keyword.value = kw
    if (st !== undefined) status.value = st
    page.value = 1
    return loadList()
  }

  function setPage(p) {
    page.value = p
    return loadList()
  }

  /* ============================ 容量 ============================ */

  async function loadCapacity() {
    try {
      const data = await getCapacity()
      if (data) capacity.value = data
    } catch (e) {
      /* 读接口失败：拦截器已提示，容量条保持上次值 */
    }
  }

  /* ============================ 上传 ============================ */

  /**
   * 上传一批文件：逐文件请求、各自进度、可单独取消。
   * 调用前页面已做白名单/大小/数量/容量预校验，此处仅负责发起与状态跟踪。
   * @param {File[]} files
   */
  async function uploadFiles(files) {
    const tasks = files.map((f) => {
      const aborter = new AbortController()
      return {
        id: `up_${Date.now()}_${taskSeq++}`,
        name: f.name,
        size: f.size,
        status: 'uploading',
        percent: 0,
        error: null,
        code: null,
        aborter,
        file: f
      }
    })
    uploadTasks.value.push(...tasks)

    let anySuccess = false
    // 逐文件串行上传（保证进度/容量兜底口径清晰，量级 ≤10 可接受）
    for (const task of tasks) {
      if (task.status === 'canceled') continue
      try {
        await uploadDoc(task.file, {
          signal: task.aborter.signal,
          onProgress: (p) => {
            if (task.status === 'uploading') task.percent = p
          }
        })
        task.status = 'success'
        task.percent = 100
        anySuccess = true
      } catch (e) {
        if (task.aborter.signal.aborted) {
          task.status = 'canceled'
          continue
        }
        task.status = 'failed'
        if (e instanceof ApiError) {
          task.code = e.code
          task.error = e.message
        } else {
          task.error = '上传失败，请稍后重试'
        }
      }
    }

    if (anySuccess) {
      await Promise.all([loadList(), loadCapacity()])
      pruneSucceeded() // 成功任务已并入文档列表，从队列剔除避免堆积
    }
    return tasks
  }

  // 剔除已成功的上传任务（其真实文档行已由 loadList 拉回内联展示）
  function pruneSucceeded() {
    uploadTasks.value = uploadTasks.value.filter((t) => t.status !== 'success')
  }

  // 取消单个上传任务（取消后不落库）
  function cancelTask(taskId) {
    const t = uploadTasks.value.find((x) => x.id === taskId)
    if (t && t.status === 'uploading') {
      t.aborter.abort()
      t.status = 'canceled'
    }
  }

  // 单条重试（失败任务重新上传同一文件）
  async function retryTask(taskId) {
    const t = uploadTasks.value.find((x) => x.id === taskId)
    if (!t || t.status === 'uploading' || !t.file) return
    t.aborter = new AbortController()
    t.status = 'uploading'
    t.percent = 0
    t.error = null
    t.code = null
    try {
      await uploadDoc(t.file, {
        signal: t.aborter.signal,
        onProgress: (p) => {
          if (t.status === 'uploading') t.percent = p
        }
      })
      t.status = 'success'
      t.percent = 100
      await Promise.all([loadList(), loadCapacity()])
      pruneSucceeded()
    } catch (e) {
      if (t.aborter.signal.aborted) {
        t.status = 'canceled'
        return
      }
      t.status = 'failed'
      if (e instanceof ApiError) {
        t.code = e.code
        t.error = e.message
      } else {
        t.error = '上传失败，请稍后重试'
      }
    }
  }

  // 移除一个已结束的上传任务合成行（失败/取消后内联「移除」）
  function dismissTask(taskId) {
    uploadTasks.value = uploadTasks.value.filter((t) => t.id !== taskId)
  }

  /* ============================ 删除 ============================ */

  // 删除单个文档（页面负责二次确认）。返回 true/抛 ApiError。
  // 删除成功后统一以 loadList() 全量重拉为准，不做本地乐观突变（避免与重拉叠加双改）。
  async function removeDoc(docId) {
    await deleteDoc(docId)
    // 删的是当前页唯一一条且非首页 → 先回退一页，避免停留在空页
    if (docs.value.length === 1 && docs.value[0]?.docId === docId && page.value > 1) {
      page.value -= 1
    }
    await Promise.all([loadList(), loadCapacity()])
    return true
  }

  /* ============================ 重新处理（重试解析） ============================ */

  async function reparse(docId) {
    await reparseDoc(docId)
    // 重置该行状态为 pending，触发轮询接管
    const row = docs.value.find((d) => d.docId === docId)
    if (row) {
      row.parseStatus = 'pending'
      row.errorReason = null
      row.chunkCount = 0
    }
    schedulePoll()
  }

  /* ============================ 状态轮询 §1.1 ============================ */

  function nonTerminalIds() {
    return docs.value
      .filter((d) => NON_TERMINAL.includes(d.parseStatus))
      .map((d) => d.docId)
  }

  function schedulePoll() {
    stopPoll()
    if (nonTerminalIds().length === 0) return
    pollTimer = setInterval(pollOnce, POLL_INTERVAL)
  }

  async function pollOnce() {
    const ids = nonTerminalIds()
    if (ids.length === 0) {
      stopPoll()
      return
    }
    let list
    try {
      list = await getDocsStatus(ids)
    } catch (e) {
      return // 轮询失败静默，下次再试
    }
    for (const s of list || []) {
      const row = docs.value.find((d) => d.docId === s.docId)
      if (row) {
        row.parseStatus = s.parseStatus
        row.chunkCount = s.chunkCount
        row.errorReason = s.errorReason
      }
    }
    if (nonTerminalIds().length === 0) stopPoll()
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // 离开页面：清理轮询定时器 + 中断在途上传
  function dispose() {
    stopPoll()
    uploadTasks.value.forEach((t) => {
      if (t.status === 'uploading') t.aborter.abort()
    })
  }

  return {
    // 列表
    docs,
    total,
    page,
    size,
    keyword,
    status,
    listLoading,
    listError,
    loadList,
    setFilters,
    setPage,
    // 容量
    capacity,
    loadCapacity,
    // 上传
    uploadTasks,
    uploading,
    displayRows,
    uploadFiles,
    cancelTask,
    retryTask,
    dismissTask,
    // 删除 / 重试
    removeDoc,
    reparse,
    // 轮询 / 生命周期
    schedulePoll,
    stopPoll,
    dispose
  }
})

/* ---------------- 前端预校验（供页面在发请求前调用） ---------------- */

/**
 * 对一批选中文件做前端预校验。返回 { accepted, rejected }。
 * rejected 每项带 { name, code, error }，code 对齐契约错误码便于精确提示。
 *
 * 账户上限只由「总容量 2GB」管控（PRD §1.5），不存在「最多 10 份」这条；
 * 「单次最多选 10 个」属于另一条 UI 批量约束，由页面在调用本函数前用 slice 处理。
 *
 * @param {File[]} files 用户选中文件
 * @param {number} usedBytes 当前已用容量
 */
export function precheckFiles(files, usedBytes = 0) {
  const accepted = []
  const rejected = []
  let runningBytes = usedBytes

  for (const f of files) {
    // 空文件
    if (f.size === 0) {
      rejected.push({ name: f.name, code: 1105, error: '空文件无法上传' })
      continue
    }
    // 格式白名单
    if (!ALLOW_EXT.includes(extOf(f.name))) {
      rejected.push({
        name: f.name,
        code: 1101,
        error: '暂不支持该格式，目前支持 PDF / Word / txt / Markdown'
      })
      continue
    }
    // 单文件大小
    if (f.size > MAX_FILE_BYTES) {
      rejected.push({ name: f.name, code: 1102, error: '单文件不能超过 50MB' })
      continue
    }
    // 容量兜底（已用 + 累计本批 + 本文件 ≤ 2GB，账户唯一上限口径）
    if (runningBytes + f.size > TOTAL_BYTES) {
      rejected.push({ name: f.name, code: 1104, error: '个人空间容量不足（上限 2GB），请先清理后再试' })
      continue
    }
    accepted.push(f)
    runningBytes += f.size
  }
  return { accepted, rejected }
}
