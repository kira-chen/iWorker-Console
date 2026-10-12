import { beforeEach, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountReal, flushAll } from './smokeMount'

/**
 * AdminLoginLogs.vue（访问审计）真实挂载用例的共用件（2026-10-10 测试审计 J45：adminLoginLogsOps.test.js 按主题拆成
 * 「管理端操作」与「用户端文件下载 + 30 天跨度 + 页签条件独立」两个文件后抽出，两边共用同一套夹具与挂载流程）。
 *
 * 用法（两个测试文件相同）：
 *   vi.mock('@/api/loginLog', ...)  // 登录访问页签给空列表
 *   vi.mock('@/api/accessAuditMock', async () => (await import('./helpers/loginLogsHarness')).makeAccessAuditFixture())
 *   const AdminLoginLogs = (await import('@/views/admin/AdminLoginLogs.vue')).default
 *   const h = createLoginLogsHarness(AdminLoginLogs)   // 注册 beforeEach / afterEach，随后用 h.mounted / h.router / h.switchTab ...
 * （vi.mock 必须写在各测试文件里——它会被提升到 import 之前；夹具工厂放这里，经动态 import 取用。）
 */

/** 「访问审计」数据层夹具：记录时间取「今天」，避免被页面默认的「近 90 天」时间范围滤掉。 */
export function makeAccessAuditFixture() {
  const today = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  return {
    // 2026-10-08：「用户端文件下载」页签用例的夹具（时间同取今天；三条时间互不相同，便于断排序）
    dlRecords: [
      { id: 11, time: `${day} 08:30`, user: '刘敏', filename: '岗位说明.docx', channel: 'Windows', source: '会话产物', result: 'SUCCESS' },
      { id: 12, time: `${day} 10:30`, user: '吴强', filename: '财税手册.pdf', channel: 'Mac', source: '知识库·我的资料', result: 'FAILED', failReason: '磁盘空间不足（CS端）' },
      { id: 13, time: `${day} 09:30`, user: '张浩', filename: '竞品资料.pdf', channel: 'Mac', source: '知识库·本地产物', result: 'SUCCESS' }
    ],
    opsRecords: [
      { id: 1, time: `${day} 09:00`, operator: 'zhang.wei', module: '岗位', action: '发布', target: '销售顾问', version: 'v1.4.2', detail: 'v1.4.2 正式发布上线' },
      { id: 2, time: `${day} 10:00`, operator: 'xiaomei', module: '版本管理', action: '发布', target: 'Windows v1.2.0', detail: '1. 新增记忆管理\n2. 修复若干问题' },
      { id: 3, time: `${day} 11:00`, operator: 'xiaomei', module: '版本管理', action: '停用', target: 'Windows v1.2.0', detail: '' },
      { id: 4, time: `${day} 12:00`, operator: 'demo', module: '运行规格', action: '个人配置', target: '标准', detail: '为 2 个用户配置规格「标准」' },
      { id: 5, time: `${day} 13:00`, operator: 'admin', module: '岗位分配', action: '分配', target: 'chenyu', detail: '未绑定 → 经营分析岗' },
      { id: 6, time: `${day} 14:00`, operator: 'admin', module: '岗位分配', action: '变更', target: 'li.na', detail: '客户成功岗 → 财务审核岗' },
      { id: 7, time: `${day} 15:00`, operator: 'admin', module: '技能', action: '强制回收', target: '财税合规助手', version: 'v1.0.0', detail: '存在数据泄露风险' },
      { id: 8, time: `${day} 16:00`, operator: 'admin', module: '用户技能审核', action: '审核驳回', target: 'sun.hao / 合同管理助手', detail: '岗位与技能权限范围不匹配' },
      { id: 9, time: `${day} 17:00`, operator: 'admin', module: '用户技能审核', action: '审核通过', target: 'wang.fang / 报销助手', detail: '' },
      // 存储空间：调整容量、同意扩容、拒绝扩容三类都展示
      { id: 10, time: `${day} 18:00`, operator: 'demo', module: '存储空间', action: '调整容量', target: 'zhangwei', detail: '5 GB → 8 GB' },
      { id: 11, time: `${day} 18:10`, operator: 'demo', module: '存储空间', action: '同意扩容', target: 'chenyu', detail: '5 GB → 10 GB' },
      { id: 12, time: `${day} 18:20`, operator: 'demo', module: '存储空间', action: '拒绝扩容', target: 'wangfang', detail: '先清理历史产物' }
    ]
  }
}

/**
 * 挂载整页（路由 + 真 Element Plus）并注册生命周期钩子。每页条数由 window.innerHeight 动态算（useDynPageSize），
 * 默认把窗口调到 2000（每页 26 条，夹具一页放得下，行数类用例不受分页影响）；分页用例自行 remountAtHeight(768)。
 * 返回对象的 mounted / router 是 getter，随每次（重新）挂载更新。
 */
export function createLoginLogsHarness(AdminLoginLogs) {
  let mounted = null
  let router = null
  const ORIGIN_HEIGHT = window.innerHeight

  async function mountPage() {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/admin/login-logs', name: 'AdminLoginLogs', component: { template: '<div />' } },
        { path: '/admin/versions', name: 'AdminVersions', component: { template: '<div />' } },
        { path: '/admin/positions', name: 'AdminPositions', component: { template: '<div />' } },
        { path: '/admin/position-assignments', name: 'AdminPositionAssignments', component: { template: '<div />' } },
        { path: '/admin/runtime-specs', name: 'AdminRuntimeSpecs', component: { template: '<div />' } },
        { path: '/admin/storage-space', name: 'AdminStorageSpace', component: { template: '<div />' } }
      ]
    })
    await router.push('/admin/login-logs')
    await router.isReady()
    mounted = mountReal(AdminLoginLogs, {}, { plugins: [router] })
    await flushAll(12)
  }

  beforeEach(async () => {
    window.innerHeight = 2000
    await mountPage()
  })
  afterEach(() => {
    mounted?.unmount()
    mounted = null
    document.body.innerHTML = ''
    window.innerHeight = ORIGIN_HEIGHT
  })

  return {
    get mounted() {
      return mounted
    },
    get router() {
      return router
    },
    /** 卸载后以指定窗口高度重新挂载（分页用例用：768 高 → 每页 7 条）。 */
    async remountAtHeight(height) {
      mounted.unmount()
      document.body.innerHTML = ''
      window.innerHeight = height
      await mountPage()
    },
    /** 切页签（按页签文字）。 */
    async switchTab(label) {
      const tab = [...mounted.container.querySelectorAll('.el-tabs__item')].find((t) => t.textContent.trim() === label)
      tab.click()
      await flushAll(6)
    }
  }
}
