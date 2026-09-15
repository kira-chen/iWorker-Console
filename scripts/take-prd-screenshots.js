/**
 * PRD 截图自动化脚本
 * 用 Playwright 对管理后台各页面截图，覆盖 docs/PRD/ 下的全部 PNG 引用。
 * 运行：node scripts/take-prd-screenshots.js
 */
const Module = require('module')
const NPX_CACHE = process.env.LOCALAPPDATA + '/npm-cache/_npx/e41f203b7505f1fb/node_modules'
const { chromium } = Module._resolveFilename
  ? require(require.resolve('playwright', { paths: [NPX_CACHE] }))
  : require('playwright')
const path = require('path')

const BASE = 'http://localhost:5175'
const PRD_ROOT = path.resolve(__dirname, '../docs/PRD/数字员工管理端PRD')

// 视口尺寸
const VIEWPORT = { width: 1440, height: 900 }
// 列表页等待网络静止的超时
const NETWORK_IDLE = 3000

// ─── 工具函数 ───────────────────────────────────────────────────────────────

async function goto(page, url) {
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(800)
}

async function shot(page, filepath) {
  await page.screenshot({ path: filepath, fullPage: false })
  console.log('  ✓', path.basename(filepath))
}

async function shotEl(page, selector, filepath, opts = {}) {
  const el = await page.waitForSelector(selector, { timeout: 6000 })
  await el.screenshot({ path: filepath, ...opts })
  console.log('  ✓', path.basename(filepath))
}

/** 点击按钮/链接，等弹窗/抽屉出现后截图，再关闭 */
async function withDialog(page, triggerFn, dialogSelector, filepath, closeFn) {
  // 确保没有残留弹窗遮挡
  const dlgVisible = dialogSelector && await page.locator(dialogSelector).first().isVisible().catch(() => false)
  if (dlgVisible) {
    try { await page.keyboard.press('Escape') } catch {}
    await page.waitForTimeout(400)
  }
  await triggerFn()
  if (dialogSelector) await page.waitForSelector(dialogSelector, { timeout: 8000 })
  await page.waitForTimeout(400)
  if (filepath) await shot(page, filepath)
  if (closeFn) await closeFn()
  else {
    // 尝试通用关闭：ESC 或点关闭按钮
    try { await page.keyboard.press('Escape') } catch {}
    await page.waitForTimeout(300)
  }
}

// ─── 截图任务定义 ───────────────────────────────────────────────────────────

async function run() {
  const CHROMIUM_PATH = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH })
  const ctx = await browser.newContext({ viewport: VIEWPORT })
  const page = await ctx.newPage()
  // 忽略控制台错误（mock 数据可能有非关键报错）
  page.on('console', () => {})

  // ══════════════════════════════════════════════════
  // 02 岗位 - 岗位列表页
  // ══════════════════════════════════════════════════
  console.log('\n── 02岗位 / 岗位 ──')
  const posDir = path.join(PRD_ROOT, '02岗位/岗位')
  await goto(page, '/admin/positions')
  await shot(page, path.join(posDir, '岗位列表页.png'))

  // ══════════════════════════════════════════════════
  // 02 岗位 - 岗位管理（岗位分配）
  // ══════════════════════════════════════════════════
  console.log('\n── 02岗位 / 岗位管理 ──')
  const posAssDir = path.join(PRD_ROOT, '02岗位/岗位管理')
  await goto(page, '/admin/position-assignments')
  await shot(page, path.join(posAssDir, '岗位分配-列表页.png'))

  // 停用用户筛选
  try {
    const statusSel = page.locator('.lt-filter').first()
    await statusSel.click()
    await page.waitForTimeout(400)
    await page.locator('.el-select-dropdown__item').filter({ hasText: '停用' }).first().click()
    await page.waitForTimeout(600)
    await shot(page, path.join(posAssDir, '岗位分配-停用用户筛选.png'))
    // 关闭下拉：点选框本身把它收起
    await statusSel.click()
    await page.waitForTimeout(300)
    // 重置：选「启用」（无"全部"选项），截图后再截原始列表
    await page.locator('.el-select-dropdown__item').first().click()
    await page.waitForTimeout(400)
  } catch (e) { console.warn('  ⚠ 岗位分配-停用用户筛选 截图失败:', e.message) }

  // 修改绑定弹窗（点第一行的编辑/绑定按钮）
  await withDialog(
    page,
    async () => {
      const btn = page.locator('button, .el-button').filter({ hasText: /修改|绑定|编辑/ }).first()
      await btn.click()
    },
    '.el-dialog',
    path.join(posAssDir, '岗位分配-修改绑定弹窗.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) }
  )

  // ══════════════════════════════════════════════════
  // 03 技能
  // ══════════════════════════════════════════════════
  console.log('\n── 03能力 / 技能 ──')
  const skillDir = path.join(PRD_ROOT, '03能力/技能')
  await goto(page, '/admin/skills-all')
  await shot(page, path.join(skillDir, '技能列表页.png'))

  // 新建弹窗（导入/新建入口）
  await withDialog(
    page,
    async () => {
      await page.locator('button, .el-button').filter({ hasText: /新建|创建|导入/ }).first().click()
    },
    '.el-dialog',
    path.join(skillDir, '技能-新建弹窗.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) }
  )

  // 新建弹窗-手动创建（如弹窗内有「手动创建」tab/选项，弹窗已打开则直接截图）
  // 跳过：「新建技能」弹窗打开后不需要再点一次，直接复用上一张截图
  // （两张截图内容一致，只保留一张即可）

  // 停用确认弹窗
  await goto(page, '/admin/skills-all')
  await withDialog(
    page,
    async () => {
      const btn = page.locator('.el-button').filter({ hasText: '停用' }).first()
      await btn.click({ timeout: 8000 })
    },
    '.el-message-box, .el-dialog',
    path.join(skillDir, '技能-停用确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) }
  )

  // 删除确认弹窗（删除按钮隐藏，需 goto 后 hover 未发布行）
  await goto(page, '/admin/skills-all')
  await withDialog(
    page,
    async () => {
      // 找有「未发布」状态的行（该行有删除按钮），hover 后点击
      const rows = await page.locator('.el-table__row').all()
      for (const row of rows) {
        const cnt = await row.locator('.el-button').filter({ hasText: '删除' }).count()
        if (cnt > 0) {
          await row.hover({ force: true })
          await page.waitForTimeout(300)
          await row.locator('.el-button').filter({ hasText: '删除' }).first().click({ timeout: 5000 })
          return
        }
      }
      throw new Error('未找到含删除按钮的行')
    },
    '.el-message-box, .el-dialog',
    path.join(skillDir, '技能-删除确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) }
  )

  // 版本发布弹窗（未发布状态的技能有「发布」按钮）
  await goto(page, '/admin/skills-all')
  try {
    await withDialog(
      page,
      async () => {
        const btn = page.locator('.el-button').filter({ hasText: /^发布$/ }).first()
        await btn.click({ timeout: 8000 })
      },
      '.el-dialog, .el-message-box',
      path.join(skillDir, '技能-版本发布弹窗.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) }
    )
  } catch (e) { console.warn('  ⚠ 技能-版本发布弹窗 截图失败:', e.message) }

  // 版本管理弹窗（已发布技能的版本管理按钮，打开的是 drawer）
  await goto(page, '/admin/skills-all')
  try {
    await withDialog(
      page,
      async () => {
        const btn = page.locator('.el-button').filter({ hasText: '版本管理' }).first()
        await btn.click({ timeout: 8000 })
      },
      '.el-drawer',
      path.join(skillDir, '技能-版本发布弹窗-审核中.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) }
    )
  } catch (e) { console.warn('  ⚠ 技能-版本管理弹窗 截图失败:', e.message) }

  // 导入返回提示（列表页本身即可，无需单独截）
  await goto(page, '/admin/skills-all')
  await shot(page, path.join(skillDir, '技能-导入返回提示.png'))

  // 技能编辑页（找第一个「已发布」的技能点编辑；禁用的跳过）
  try {
    await goto(page, '/admin/skills-all')
    const rows = await page.locator('.el-table__row').all()
    let clicked = false
    for (const row of rows) {
      const editBtn = row.locator('.el-button').filter({ hasText: '编辑' }).first()
      const disabled = await editBtn.getAttribute('disabled').catch(() => null)
      if (disabled === null) {
        await editBtn.click({ timeout: 5000 })
        clicked = true
        break
      }
    }
    if (clicked) {
      await page.waitForURL(/\/admin\/.*skills.*\/(edit|view)/, { timeout: 8000 })
      await page.waitForTimeout(800)
      await shot(page, path.join(skillDir, '技能编辑页.png'))
      await page.goBack()
      await page.waitForTimeout(500)
      // 只读态
      for (const row of await page.locator('.el-table__row').all()) {
        const viewBtn = row.locator('.el-button').filter({ hasText: '查看' }).first()
        const cnt = await viewBtn.count()
        if (cnt > 0) {
          await viewBtn.click({ timeout: 5000 })
          await page.waitForURL(/\/admin\/.*skills.*\/(edit|view)/, { timeout: 8000 })
          await page.waitForTimeout(800)
          await shot(page, path.join(skillDir, '技能编辑页-只读.png'))
          break
        }
      }
    }
  } catch (e) {
    console.warn('  ⚠ 技能编辑页截图失败:', e.message)
  }

  // ══════════════════════════════════════════════════
  // 03 专家
  // ══════════════════════════════════════════════════
  console.log('\n── 03能力 / 专家 ──')
  const expertDir = path.join(PRD_ROOT, '03能力/专家')
  await goto(page, '/admin/experts')
  await shot(page, path.join(expertDir, '专家导航栏.png'))
  await shot(page, path.join(expertDir, '专家列表页.png'))

  // 新建抽屉
  await withDialog(
    page,
    async () => { await page.locator('button, .el-button').filter({ hasText: /新建|创建/ }).first().click() },
    '.el-drawer',
    path.join(expertDir, '专家-新建抽屉.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) }
  )

  // 编辑抽屉（先goto确保抽屉关闭）
  await goto(page, '/admin/experts')
  await withDialog(
    page,
    async () => { await page.locator('.el-button').filter({ hasText: '编辑' }).first().click() },
    '.el-drawer',
    path.join(expertDir, '专家-编辑抽屉.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) }
  )

  // 查看抽屉
  await goto(page, '/admin/experts')
  await withDialog(
    page,
    async () => { await page.locator('.el-button').filter({ hasText: '查看' }).first().click() },
    '.el-drawer',
    path.join(expertDir, '专家-查看抽屉.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) }
  )

  // 停用确认（先goto确保没有残留抽屉）
  await goto(page, '/admin/experts')
  await withDialog(
    page,
    async () => { await page.locator('.el-button').filter({ hasText: '停用' }).first().click() },
    '.el-message-box, .el-dialog',
    path.join(expertDir, '专家-停用确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) }
  )

  // 删除确认
  await goto(page, '/admin/experts')
  await withDialog(
    page,
    async () => { await page.locator('.el-button').filter({ hasText: '删除' }).first().click() },
    '.el-message-box, .el-dialog',
    path.join(expertDir, '专家-删除确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) }
  )

  // 版本管理弹窗（版本管理打开的是第二个 drawer，等它 open 类出现）
  await goto(page, '/admin/experts')
  await withDialog(
    page,
    async () => { await page.locator('.el-button').filter({ hasText: '版本管理' }).first().click() },
    '.de-drawer--plain',
    path.join(expertDir, '专家-版本管理弹窗.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) }
  )

  // ══════════════════════════════════════════════════
  // 03 连接器 - MCP
  // ══════════════════════════════════════════════════
  console.log('\n── 03能力 / 连接器 / MCP ──')
  const mcpDir = path.join(PRD_ROOT, '03能力/连接器/MCP')
  await goto(page, '/admin/connector?tab=mcp')
  await shot(page, path.join(mcpDir, 'MCP列表页.png'))

  // 发布弹窗（点发布后弹「被技能引用」确认 dialog）
  await goto(page, '/admin/connector?tab=mcp')
  try {
    await withDialog(page,
      async () => {
        const btns = await page.locator('.el-button').filter({ hasText: '发布' }).all()
        for (const btn of btns) {
          const disabled = await btn.getAttribute('disabled').catch(() => null)
          if (disabled === null) { await btn.click({ timeout: 5000 }); return }
        }
        throw new Error('no enabled 发布 btn')
      },
      '[aria-label="被技能引用"], .el-overlay-dialog [role="dialog"]', path.join(mcpDir, 'MCP-发布确认.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch (e) { console.warn('  ⚠ MCP-发布确认 截图失败:', e.message) }

  await goto(page, '/admin/connector?tab=mcp')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '撤回' }).first().click() },
    '.el-overlay-message-box', path.join(mcpDir, 'MCP-撤回确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  await goto(page, '/admin/connector?tab=mcp')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '删除' }).first().click() },
    '.el-overlay-message-box', path.join(mcpDir, 'MCP-删除确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  // 删除被引用拦截（先尝试，失败则跳过）
  await goto(page, '/admin/connector?tab=mcp')
  try {
    await withDialog(page,
      async () => { await page.locator('.el-button').filter({ hasText: '删除' }).nth(1).click() },
      '.el-overlay-message-box, .el-overlay-dialog', path.join(mcpDir, 'MCP-删除被引用拦截.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch { console.warn('  ⚠ MCP-删除被引用拦截 截图失败，跳过') }

  // 新建页
  await goto(page, '/admin/connector?tab=mcp')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: /新建 MCP|新建|接入/ }).first().click() },
    '.el-drawer', path.join(mcpDir, 'MCP新建页.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  // 编辑页
  await goto(page, '/admin/connector?tab=mcp')
  await withDialog(page,
    async () => {
      const btns = await page.locator('.el-button').filter({ hasText: '编辑' }).all()
      for (const btn of btns) {
        const dis = await btn.getAttribute('disabled').catch(() => null)
        if (dis === null) { await btn.click({ timeout: 5000 }); return }
      }
    },
    '.el-drawer', path.join(mcpDir, 'MCP编辑页.png'),
    async () => {
      // 工具清单截图
      try {
        const toolSection = page.locator('[class*="tool"], [class*="Tool"]').first()
        await toolSection.waitFor({ timeout: 3000 })
        await shot(page, path.join(mcpDir, 'MCP-工具清单.png'))
      } catch {}
      // 引用情况截图
      try {
        const refSection = page.locator('[class*="ref"], [class*="引用"]').first()
        await refSection.waitFor({ timeout: 3000 })
        await shot(page, path.join(mcpDir, 'MCP-引用情况.png'))
      } catch {}
      try { await page.keyboard.press('Escape') } catch {}
      await page.waitForTimeout(400)
    })

  // 查看页
  await goto(page, '/admin/connector?tab=mcp')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '查看' }).first().click() },
    '.el-drawer', path.join(mcpDir, 'MCP-查看页.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  // 新建校验提示
  await goto(page, '/admin/connector?tab=mcp')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: /新建 MCP|新建|接入/ }).first().click() },
    '.el-drawer',
    null,
    async () => {
      try {
        await page.locator('.el-button--primary').filter({ hasText: /保存|接入/ }).first().click()
        await page.waitForTimeout(600)
        await shot(page, path.join(mcpDir, 'MCP-新建校验提示.png'))
      } catch {}
      try { await page.keyboard.press('Escape') } catch {}
      await page.waitForTimeout(400)
    })

  // ══════════════════════════════════════════════════
  // 03 连接器 - API
  // ══════════════════════════════════════════════════
  console.log('\n── 03能力 / 连接器 / API ──')
  const apiDir = path.join(PRD_ROOT, '03能力/连接器/API')
  await goto(page, '/admin/connector?tab=api')
  await shot(page, path.join(apiDir, 'API列表页.png'))

  await goto(page, '/admin/connector?tab=api')
  try {
    await withDialog(page,
      async () => {
        const btns = await page.locator('.el-button').filter({ hasText: '发布' }).all()
        for (const btn of btns) {
          const dis = await btn.getAttribute('disabled').catch(() => null)
          if (dis === null) { await btn.click({ timeout: 5000 }); return }
        }
        throw new Error('no enabled 发布 btn')
      },
      '.el-overlay-message-box, .el-overlay-dialog', path.join(apiDir, 'API-发布确认.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch (e) { console.warn('  ⚠ API-发布确认 截图失败:', e.message) }

  await goto(page, '/admin/connector?tab=api')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '撤回' }).first().click() },
    '.el-overlay-message-box', path.join(apiDir, 'API-撤回审核.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  await goto(page, '/admin/connector?tab=api')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '停用' }).first().click() },
    '.el-overlay-message-box', path.join(apiDir, 'API-停用确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  await goto(page, '/admin/connector?tab=api')
  try {
    await withDialog(page,
      async () => {
        const btns = await page.locator('.el-button').filter({ hasText: '删除' }).all()
        for (const btn of btns) {
          const dis = await btn.getAttribute('disabled').catch(() => null)
          if (dis === null) { await btn.click({ timeout: 5000 }); return }
        }
        throw new Error('no enabled 删除 btn')
      },
      '.el-overlay-message-box', path.join(apiDir, 'API-删除确认.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch (e) { console.warn('  ⚠ API-删除确认 截图失败:', e.message) }

  // 服务提供系统弹窗
  await goto(page, '/admin/connector?tab=api')
  try {
    await withDialog(page,
      async () => { await page.locator('.el-button').filter({ hasText: /编辑系统|新建服务/ }).first().click() },
      '.el-overlay-dialog', path.join(apiDir, 'API-服务提供系统弹窗.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch { console.warn('  ⚠ API-服务提供系统弹窗 截图失败，跳过') }

  await goto(page, '/admin/connector?tab=api')
  try {
    await withDialog(page,
      async () => { await page.locator('.el-button').filter({ hasText: /在本系统下新建 API|新建服务提供系统/ }).first().click() },
      '.el-overlay-dialog', path.join(apiDir, 'API-新建抽屉.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })
  } catch (e) { console.warn('  ⚠ API-新建抽屉 截图失败:', e.message) }

  await goto(page, '/admin/connector?tab=api')
  await withDialog(page,
    async () => {
      const btns = await page.locator('.el-button').filter({ hasText: '编辑' }).all()
      for (const btn of btns) {
        const dis = await btn.getAttribute('disabled').catch(() => null)
        if (dis === null) { await btn.click({ timeout: 5000 }); return }
      }
    },
    '.el-overlay-dialog',
    path.join(apiDir, 'API-编辑抽屉.png'),
    async () => {
      try { await page.keyboard.press('Escape') } catch {}
      await page.waitForTimeout(400)
    })

  await goto(page, '/admin/connector?tab=api')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '查看' }).first().click() },
    '.de-drawer--open, .el-drawer.open', path.join(apiDir, 'API-查看抽屉.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  // ══════════════════════════════════════════════════
  // 03 连接器 - 业务系统
  // ══════════════════════════════════════════════════
  console.log('\n── 03能力 / 连接器 / 业务系统 ──')
  const bizDir = path.join(PRD_ROOT, '03能力/连接器/业务系统')
  await goto(page, '/admin/connector?tab=bizsystem')
  await shot(page, path.join(bizDir, '业务系统列表页.png'))

  await goto(page, '/admin/connector?tab=bizsystem')
  await withDialog(page,
    async () => {
      const btns = await page.locator('.el-button').filter({ hasText: '发布' }).all()
      for (const btn of btns) {
        const dis = await btn.getAttribute('disabled').catch(() => null)
        if (dis === null) { await btn.click({ timeout: 5000 }); return }
      }
      throw new Error('no enabled 发布 btn')
    },
    '.el-overlay-message-box', path.join(bizDir, '业务系统-发布确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  await goto(page, '/admin/connector?tab=bizsystem')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '停用' }).first().click() },
    '.el-overlay-message-box', path.join(bizDir, '业务系统-停用确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  await goto(page, '/admin/connector?tab=bizsystem')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '删除' }).first().click() },
    '.el-overlay-message-box', path.join(bizDir, '业务系统-删除确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  await goto(page, '/admin/connector?tab=bizsystem')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: /新建业务系统|新建/ }).first().click() },
    '.de-drawer--open, .de-drawer.open, .el-drawer.open', path.join(bizDir, '业务系统-新建抽屉.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  await goto(page, '/admin/connector?tab=bizsystem')
  await withDialog(page,
    async () => {
      const btns = await page.locator('.el-button').filter({ hasText: '编辑' }).all()
      for (const btn of btns) {
        const dis = await btn.getAttribute('disabled').catch(() => null)
        if (dis === null) { await btn.click({ timeout: 5000 }); return }
      }
    },
    '.de-drawer--open, .el-drawer.open',
    path.join(bizDir, '业务系统-编辑抽屉.png'),
    async () => {
      try {
        const expandBtn = page.locator('[class*="expand"], [class*="biz-page"], .el-collapse-item').first()
        await expandBtn.click({ timeout: 3000 })
        await page.waitForTimeout(400)
        await shot(page, path.join(bizDir, '业务系统-编辑抽屉-业务页展开.png'))
      } catch {}
      try { await page.keyboard.press('Escape') } catch {}
      await page.waitForTimeout(400)
    })

  await goto(page, '/admin/connector?tab=bizsystem')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '查看' }).first().click() },
    '.de-drawer--open, .el-drawer.open', path.join(bizDir, '业务系统-查看抽屉.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  // ══════════════════════════════════════════════════
  // 03 模型
  // ══════════════════════════════════════════════════
  console.log('\n── 03能力 / 模型 ──')
  const modelDir = path.join(PRD_ROOT, '03能力/模型')
  await goto(page, '/admin/models')
  await shot(page, path.join(modelDir, '模型列表页.png'))

  await goto(page, '/admin/models')
  try {
    await withDialog(page,
      async () => {
        const btns = await page.locator('.el-button').filter({ hasText: '发布' }).all()
        for (const btn of btns) {
          const dis = await btn.getAttribute('disabled').catch(() => null)
          if (dis === null) { await btn.click({ timeout: 5000 }); return }
        }
        throw new Error('no enabled 发布 btn')
      },
      '.el-overlay-message-box', path.join(modelDir, '模型-发布确认.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch (e) { console.warn('  ⚠ 模型-发布确认 截图失败:', e.message) }

  await goto(page, '/admin/models')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '撤回' }).first().click() },
    '.el-overlay-message-box', path.join(modelDir, '模型-撤回确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  await goto(page, '/admin/models')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '停用' }).first().click() },
    '.el-overlay-message-box', path.join(modelDir, '模型-停用确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  await goto(page, '/admin/models')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '设为默认' }).first().click() },
    '.el-overlay-message-box', path.join(modelDir, '模型-设为默认确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  await goto(page, '/admin/models')
  await withDialog(page,
    async () => {
      const btns = await page.locator('.el-button').filter({ hasText: '删除' }).all()
      for (const btn of btns) {
        const dis = await btn.getAttribute('disabled').catch(() => null)
        if (dis === null) { await btn.click({ timeout: 5000 }); return }
      }
    },
    '.el-overlay-message-box', path.join(modelDir, '模型-删除确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  // 查看页
  await goto(page, '/admin/models')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '查看' }).first().click() },
    '.de-drawer--open, .el-drawer.open', path.join(modelDir, '模型-查看页.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  // 接入模型页
  await goto(page, '/admin/models')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '接入模型' }).first().click() },
    '.de-drawer--open, .el-drawer.open',
    null,
    async () => {
      await shot(page, path.join(modelDir, '模型-接入模型页.png'))
      try {
        await page.locator('.el-button--primary').filter({ hasText: '接入' }).first().click()
        await page.waitForTimeout(600)
        await shot(page, path.join(modelDir, '模型-新建校验提示.png'))
      } catch {}
      try { await page.keyboard.press('Escape') } catch {}
      await page.waitForTimeout(400)
    })

  // 编辑页
  await goto(page, '/admin/models')
  await withDialog(page,
    async () => {
      const btns = await page.locator('.el-button').filter({ hasText: '编辑' }).all()
      for (const btn of btns) {
        const dis = await btn.getAttribute('disabled').catch(() => null)
        if (dis === null) { await btn.click({ timeout: 5000 }); return }
      }
    },
    '.de-drawer--open, .el-drawer.open', path.join(modelDir, '模型编辑页.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  // ══════════════════════════════════════════════════
  // 05 治理 - 我的申请
  // ══════════════════════════════════════════════════
  console.log('\n── 05治理 / 我的申请 ──')
  const myAppDir = path.join(PRD_ROOT, '05治理/我的申请')
  await goto(page, '/admin/my-applications')
  await shot(page, path.join(myAppDir, '我的申请-列表页.png'))

  // 各种详情截图（通过查看按钮进入抽屉）
  const resultTypes = [
    { text: '待审核', file: '我的申请-待审核详情-API.png' },
    { text: '已通过', file: '我的申请-已通过详情-专家.png' },
    { text: '已驳回', file: '我的申请-已驳回详情-岗位.png' },
    { text: '已撤回', file: '我的申请-已撤回详情-技能.png' },
  ]
  for (const rt of resultTypes) {
    try {
      await goto(page, '/admin/my-applications')
      // 筛选对应审核结果
      const resultSel = page.locator('.lt-filter').last()
      await resultSel.click()
      await page.waitForTimeout(300)
      const opt = page.locator('.el-select-dropdown__item').filter({ hasText: rt.text }).first()
      await opt.click()
      await page.waitForTimeout(600)
      // 点查看
      const viewBtn = page.locator('.el-button').filter({ hasText: '查看' }).first()
      await viewBtn.click({ timeout: 5000 })
      await page.waitForTimeout(800)
      await shot(page, path.join(myAppDir, rt.file))
      try { await page.keyboard.press('Escape') } catch {}
      await page.waitForTimeout(400)
    } catch (e) {
      console.warn(`  ⚠ ${rt.file} 截图失败:`, e.message)
    }
  }

  // ══════════════════════════════════════════════════
  // 05 治理 - 审核中心
  // ══════════════════════════════════════════════════
  console.log('\n── 05治理 / 审核中心 ──')
  const reviewDir = path.join(PRD_ROOT, '05治理/审核中心')
  await goto(page, '/admin/review')
  await shot(page, path.join(reviewDir, '审核中心-列表页-待审核.png'))

  // 专家详情抽屉（找业务类型=专家的一行）
  try {
    const expertRow = page.locator('.el-table__row').filter({ hasText: '专家' }).first()
    const viewBtn = expertRow.locator('.el-button').filter({ hasText: '查看' })
    await withDialog(page,
      async () => { await viewBtn.click() },
      '.el-drawer', path.join(reviewDir, '审核中心-专家详情抽屉.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })
  } catch {
    await withDialog(page,
      async () => { await page.locator('.el-button').filter({ hasText: '查看' }).first().click() },
      '.el-drawer', path.join(reviewDir, '审核中心-专家详情抽屉.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })
  }

  // 技能详情整页（技能类型的查看）
  try {
    const skillRow = page.locator('.el-table__row').filter({ hasText: '技能' }).first()
    await skillRow.locator('.el-button').filter({ hasText: '查看' }).click()
    await page.waitForURL(/\/admin\/.*skills.*\/view/, { timeout: 8000 })
    await page.waitForTimeout(800)
    await shot(page, path.join(reviewDir, '审核中心-技能详情整页.png'))
    await page.goBack()
    await page.waitForTimeout(500)
  } catch (e) { console.warn('  ⚠ 技能详情整页截图失败:', e.message) }

  // 驳回弹窗
  await goto(page, '/admin/review')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '驳回' }).first().click() },
    '.el-overlay-message-box', path.join(reviewDir, '审核中心-驳回弹窗.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  // 通过确认弹窗
  await goto(page, '/admin/review')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '通过' }).first().click() },
    '.el-overlay-message-box', path.join(reviewDir, '审核中心-通过确认弹窗.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  // ══════════════════════════════════════════════════
  // 05 治理 - 用户反馈
  // ══════════════════════════════════════════════════
  console.log('\n── 05治理 / 用户反馈 ──')
  const fbDir = path.join(PRD_ROOT, '05治理/用户反馈')
  await goto(page, '/admin/feedback')
  await shot(page, path.join(fbDir, '用户反馈-列表页.png'))

  // 反馈详情弹窗
  try {
    await withDialog(page,
      async () => { await page.locator('.fb-content').first().click() },
      '.el-overlay-dialog', path.join(fbDir, '用户反馈-反馈详情弹窗.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch { console.warn('  ⚠ 用户反馈-反馈详情弹窗 截图失败') }

  // 附图查看弹窗
  try {
    await withDialog(page,
      async () => { await page.locator('.fb-thumb').first().click() },
      '.el-overlay-dialog', path.join(fbDir, '用户反馈-附图查看弹窗.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch { console.warn('  ⚠ 用户反馈-附图查看弹窗 截图失败') }

  // ══════════════════════════════════════════════════
  // 05 治理 - 字段字典
  // ══════════════════════════════════════════════════
  console.log('\n── 05治理 / 字段字典 ──')
  const fieldDir = path.join(PRD_ROOT, '05治理/字段字典')
  await goto(page, '/admin/field-management')
  await shot(page, path.join(fieldDir, '字段字典-展开状态.png'))

  // 折叠第一个分组
  try {
    await page.locator('.aps-collapse-btn').first().click()
    await page.waitForTimeout(400)
    await shot(page, path.join(fieldDir, '字段字典-分组折叠状态.png'))
    await page.locator('.aps-collapse-btn').first().click()
    await page.waitForTimeout(300)
  } catch { console.warn('  ⚠ 字段字典-分组折叠状态 截图失败') }

  // 编辑选项弹窗
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '编辑' }).first().click() },
    '.el-overlay-dialog', path.join(fieldDir, '字段字典-编辑选项弹窗.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  // ══════════════════════════════════════════════════
  // 05 治理 - 访问审计
  // ══════════════════════════════════════════════════
  console.log('\n── 05治理 / 访问审计 ──')
  const auditDir = path.join(PRD_ROOT, '05治理/访问审计')
  await goto(page, '/admin/login-logs')
  await shot(page, path.join(auditDir, '访问审计-全部记录.png'))

  // 在线状态筛选
  try {
    await page.locator('.lt-filter').first().click()
    await page.waitForTimeout(300)
    await page.locator('.el-select-dropdown__item').filter({ hasText: '在线' }).first().click()
    await page.waitForTimeout(600)
    await shot(page, path.join(auditDir, '访问审计-在线状态.png'))
    await page.locator('.lt-filter').first().click()
    await page.waitForTimeout(300)
    await page.locator('.el-select-dropdown__item').filter({ hasText: '离线' }).first().click()
    await page.waitForTimeout(600)
    await shot(page, path.join(auditDir, '访问审计-离线状态.png'))
    // 重置
    await page.locator('.el-input__clear').first().click({ timeout: 3000 }).catch(() => {})
  } catch { console.warn('  ⚠ 访问审计在线/离线截图失败') }

  // ══════════════════════════════════════════════════
  // 06 组织 - 角色
  // ══════════════════════════════════════════════════
  console.log('\n── 06组织 / 角色 ──')
  const roleDir = path.join(PRD_ROOT, '06组织/角色')
  await goto(page, '/admin/roles')
  await shot(page, path.join(roleDir, '角色导航栏.png'))
  await shot(page, path.join(roleDir, '角色列表页.png'))

  await goto(page, '/admin/roles')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: /新建角色|新建|创建/ }).first().click() },
    '.el-drawer', path.join(roleDir, '角色-新建抽屉.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  await goto(page, '/admin/roles')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '编辑' }).first().click() },
    '.el-drawer', path.join(roleDir, '角色-编辑抽屉.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  await goto(page, '/admin/roles')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '删除' }).first().click() },
    '.el-overlay-message-box', path.join(roleDir, '角色-删除确认.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  // 删除绑定用户拦截
  await goto(page, '/admin/roles')
  try {
    const boundRow = page.locator('.el-table__row').filter({ hasText: /\d+\s*用户/ }).first()
    await withDialog(page,
      async () => { await boundRow.locator('.el-button').filter({ hasText: '删除' }).click() },
      '.el-overlay-message-box', path.join(roleDir, '角色-删除绑定用户拦截.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch { console.warn('  ⚠ 角色-删除绑定用户拦截 截图失败，复用删除确认') }

  // ══════════════════════════════════════════════════
  // 06 组织 - 用户
  // ══════════════════════════════════════════════════
  console.log('\n── 06组织 / 用户 ──')
  const userDir = path.join(PRD_ROOT, '06组织/用户')
  await goto(page, '/admin/users')
  await shot(page, path.join(userDir, '用户列表页.png'))
  await shot(page, path.join(userDir, '用户-搜索筛选.png'))

  // 搜索无结果
  try {
    await page.locator('.lt-search input').fill('xxxxxxxxxnoexist')
    await page.locator('button').filter({ hasText: '查询' }).click()
    await page.waitForTimeout(800)
    await shot(page, path.join(userDir, '用户-搜索无结果.png'))
    await page.locator('.lt-search input').clear()
    await page.locator('button').filter({ hasText: '查询' }).click()
    await page.waitForTimeout(600)
  } catch { console.warn('  ⚠ 用户-搜索无结果 截图失败') }

  // 设置角色（用户页按钮是「设置角色」）
  await goto(page, '/admin/users')
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '设置角色' }).first().click() },
    '.el-overlay-dialog', path.join(userDir, '用户-设置角色窗口.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })

  // 重置密码确认（在「更多」下拉菜单里）
  try {
    await page.locator('.el-button').filter({ hasText: '更多' }).first().click()
    await page.waitForTimeout(300)
    await withDialog(page,
      async () => { await page.locator('.el-dropdown-menu__item').filter({ hasText: '重置密码' }).first().click() },
      '.el-message-box, .el-dialog', path.join(userDir, '用户-重置密码确认.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch (e) { console.warn('  ⚠ 用户-重置密码确认 截图失败:', e.message) }

  // 删除确认（在「更多」下拉菜单里）
  try {
    await page.locator('.el-button').filter({ hasText: '更多' }).first().click()
    await page.waitForTimeout(300)
    await withDialog(page,
      async () => { await page.locator('.el-dropdown-menu__item').filter({ hasText: '删除' }).first().click() },
      '.el-message-box, .el-dialog', path.join(userDir, '用户-删除确认.png'),
      async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(300) })
  } catch (e) { console.warn('  ⚠ 用户-删除确认 截图失败:', e.message) }

  // 新建用户页
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: /新建用户|新建|添加/ }).first().click() },
    '.el-drawer, .el-dialog',
    null,
    async () => {
      await shot(page, path.join(userDir, '用户新建页.png'))
      // 校验提示
      try {
        await page.locator('.el-button--primary').filter({ hasText: /保存|创建/ }).first().click()
        await page.waitForTimeout(600)
        await shot(page, path.join(userDir, '用户-新建校验提示.png'))
      } catch {}
      try { await page.keyboard.press('Escape') } catch {}
      await page.waitForTimeout(400)
    })

  // 编辑用户页
  await withDialog(page,
    async () => { await page.locator('.el-button').filter({ hasText: '编辑' }).first().click() },
    '.el-drawer, .el-dialog', path.join(userDir, '用户编辑页.png'),
    async () => { try { await page.keyboard.press('Escape') } catch {} await page.waitForTimeout(400) })

  await browser.close()
  console.log('\n✅ 全部截图完成')
}

run().catch((e) => { console.error('截图脚本失败:', e); process.exit(1) })
