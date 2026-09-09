import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5174'

const ROUTES = [
  '/admin/positions',
  '/admin/position-assignments',
  '/admin/connector',
  '/admin/my-applications',
  '/admin/review',
  '/admin/skills-all',
  '/admin/user-skill-reviews',
  '/admin/field-management',
  '/admin/experts',
  '/admin/reports/fde',
  '/admin/reports/sysconfig',
  '/admin/users',
  '/admin/roles',
  '/admin/login-logs',
  '/admin/models',
  '/admin/feedbacks',
  '/admin/cockpit',
  '/admin/knowledge-base',
  '/admin/instances',
  '/admin/runtime-specs',
  '/admin/quota-throttle',
  // redirects
  '/admin/market',
  '/admin/market?tab=review',
  '/admin/skills',
  '/admin/platform-skills',
  '/admin/system-skills',
  '/admin/skill-reviews',
  '/admin/reports',
  '/admin/mcp',
  '/admin/apis',
  '/admin/biz-systems',
  // front
  '/onboarding',
  '/bind-expert',
  '/other-experts',
  // 404
  '/some-nonexistent-path'
]

const results = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

let bucket = null
page.on('console', (m) => {
  if (m.type() === 'error' && bucket) bucket.consoleErrors.push(m.text().slice(0, 400))
})
page.on('pageerror', (e) => { if (bucket) bucket.pageErrors.push(String(e).slice(0, 400)) })
page.on('requestfailed', (r) => {
  if (bucket) bucket.netFail.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`)
})
page.on('response', (r) => {
  if (bucket && r.status() >= 400) bucket.netFail.push(`${r.status()} ${r.url()}`)
})

for (const route of ROUTES) {
  bucket = { route, consoleErrors: [], pageErrors: [], netFail: [] }
  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 })
  } catch (e) {
    bucket.gotoError = String(e).slice(0, 200)
  }
  await page.waitForTimeout(900)
  const info = await page.evaluate(() => ({
    url: location.pathname + location.search,
    bodyLen: (document.body.innerText || '').replace(/\s+/g, '').length,
    snippet: (document.body.innerText || '').slice(0, 120).replace(/\n+/g, ' | '),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth
  }))
  results.push({ ...bucket, ...info })
  console.log(JSON.stringify({ ...bucket, ...info }))
}

await browser.close()
console.log('---SUMMARY---')
for (const r of results) {
  const bad = r.consoleErrors.length || r.pageErrors.length || r.netFail.length || r.bodyLen < 60 || r.overflowX > 2
  if (bad) console.log('PROBLEM', JSON.stringify(r, null, 1))
}
