import { chromium } from '@playwright/test'
const BASE = 'http://localhost:5174'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 } })
const page = await ctx.newPage()
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 300)) })
page.on('pageerror', e => errs.push('[pageerror] ' + String(e).slice(0, 300)))
const log = (...a) => console.log(...a)

log('===== [1] 审核中心 逐行查看（每行重新导航，隔离）=====')
await page.goto(BASE + '/admin/review', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const total = await page.locator('.el-table__body-wrapper tbody tr').count()
log('行数:', total)

for (let i = 0; i < total; i++) {
  await page.goto(BASE + '/admin/review', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  errs.length = 0
  const tr = page.locator('.el-table__body-wrapper tbody tr').nth(i)
  const rowText = (await tr.innerText()).replace(/\s+/g, ' ').slice(0, 80)
  const hasReject = await tr.locator('button:has-text("驳回")').count()
  const hasPass = await tr.locator('button:has-text("通过")').count()
  const viewBtn = tr.locator('button:has-text("查看")').first()
  if (await viewBtn.count() === 0) { log(`行${i} [${rowText}] 无查看`); continue }
  await viewBtn.click().catch(e => log('  click err', String(e).slice(0, 100)))
  await page.waitForTimeout(1400)
  const d = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.el-drawer,.el-dialog')].filter(x => x.offsetParent !== null)
    return {
      url: location.pathname + location.search,
      n: els.length,
      len: els.reduce((s, x) => s + (x.innerText || '').replace(/\s+/g, '').length, 0),
      body: els.map(x => (x.innerText || '').slice(0, 200).replace(/\n+/g, ' | ')).join(' ~~ '),
      msgs: [...document.querySelectorAll('.el-message')].map(m => m.innerText.trim()),
      pageLen: (document.body.innerText || '').replace(/\s+/g, '').length,
      pageHead: (document.body.innerText || '').slice(0, 150).replace(/\n+/g, ' | ')
    }
  })
  log(`行${i} [${rowText}] 驳回=${hasReject} 通过=${hasPass}`)
  log(`   url=${d.url} 抽屉=${d.n} 字数=${d.len} toast=${JSON.stringify(d.msgs)}`)
  log(`   内容: ${d.body || '(空)'}`)
  if (d.n === 0) log(`   ⚠ 页面首屏: ${d.pageHead}`)
  if (errs.length) log(`   ERR: ${JSON.stringify(errs)}`)
}

log('\n===== [2] 我的申请 逐行查看 =====')
await page.goto(BASE + '/admin/my-applications', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const total2 = await page.locator('.el-table__body-wrapper tbody tr').count()
log('行数:', total2)
const heads2 = await page.evaluate(() => [...document.querySelectorAll('.el-table__header th')].map(t => t.innerText.trim()))
log('表头:', JSON.stringify(heads2))
for (let i = 0; i < total2; i++) {
  await page.goto(BASE + '/admin/my-applications', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  errs.length = 0
  const tr = page.locator('.el-table__body-wrapper tbody tr').nth(i)
  const rowText = (await tr.innerText()).replace(/\s+/g, ' ').slice(0, 80)
  const viewBtn = tr.locator('button:has-text("查看")').first()
  if (await viewBtn.count() === 0) { log(`行${i} [${rowText}] 无查看`); continue }
  await viewBtn.click().catch(() => { })
  await page.waitForTimeout(1400)
  const d = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.el-drawer,.el-dialog')].filter(x => x.offsetParent !== null)
    return {
      url: location.pathname + location.search, n: els.length,
      len: els.reduce((s, x) => s + (x.innerText || '').replace(/\s+/g, '').length, 0),
      body: els.map(x => (x.innerText || '').slice(0, 200).replace(/\n+/g, ' | ')).join(' ~~ '),
      msgs: [...document.querySelectorAll('.el-message')].map(m => m.innerText.trim()),
      pageHead: (document.body.innerText || '').slice(0, 150).replace(/\n+/g, ' | ')
    }
  })
  log(`行${i} [${rowText}]`)
  log(`   url=${d.url} 抽屉=${d.n} 字数=${d.len} toast=${JSON.stringify(d.msgs)}`)
  log(`   内容: ${d.body || '(空)'}`)
  if (d.n === 0) log(`   ⚠ 首屏: ${d.pageHead}`)
  if (errs.length) log(`   ERR: ${JSON.stringify(errs)}`)
}

await browser.close()
