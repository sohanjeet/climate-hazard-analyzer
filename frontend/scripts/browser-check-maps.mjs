/**
 * Real-browser check of the Phase 10 pages against a running backend (no analysis is started, so no Open-Meteo
 * traffic and no data is written):
 *
 *   npm run build && npx vite preview --port 5173 --strictPort &
 *   node scripts/browser-check-maps.mjs <screenshot-dir> [baseUrl]
 *
 * For phone, tablet, desktop and wide widths (and phone/desktop in dark mode) it opens each new route and checks
 * that the page never scrolls sideways, nothing logs a console error, the maps draw every area with a sane outline
 * (a wrong ring winding would fill the whole sphere), hover and click work, and axe finds no violations (including
 * colour contrast, which jsdom cannot check). Uses the installed Edge or Chrome through playwright-core.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const outDir = process.argv[2] ?? 'screenshots'
const baseUrl = process.argv[3] ?? 'http://localhost:5173'
mkdirSync(outDir, { recursive: true })

const executablePath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))
if (!executablePath) throw new Error('No Edge or Chrome found')

const viewports = [
  { name: 'phone', width: 360, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'wide', width: 1680, height: 1000 },
  { name: 'phone-dark', width: 390, height: 844, colorScheme: 'dark' },
  { name: 'desktop-dark', width: 1280, height: 900, colorScheme: 'dark' },
]

const routes = [
  { path: '/explore/india', heading: 'India Climate Explorer', map: 'Map of Indian states and union territories', areas: 36, pick: 'Rajasthan', panel: 'State details' },
  { path: '/explore/global', heading: 'Global Climate Explorer', map: 'World map of countries', areas: 248, pick: 'India', panel: 'Country details' },
  { path: '/compare/states', heading: 'Compare states' },
  { path: '/anomalies', heading: 'Temperature anomalies' },
  { path: '/methodology', heading: 'Methodology' },
]

let failures = 0
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
  if (!ok) failures += 1
}

const browser = await chromium.launch({ executablePath, headless: true })
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: viewport.colorScheme ?? 'light' })
    for (const route of routes) {
      const page = await context.newPage()
      const errors = []
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      page.on('pageerror', (e) => errors.push(e.message))
      const tag = `${viewport.name} ${route.path}`
      await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { level: 1, name: route.heading }).waitFor()

      if (route.map) {
        const map = page.getByRole('listbox', { name: route.map })
        await map.waitFor()
        await page.waitForFunction(() => !document.body.textContent?.includes('Loading observation locations'))
        const areas = await map.getByRole('option').count()
        check(areas === route.areas, `${tag}: ${areas} of ${route.areas} areas drawn`)
        // Pick areas whose bounding-box centre lies on the area itself (France's includes French Guiana, so its centre is
        // in the Atlantic). A reversed ring would make one area cover (nearly) the whole map: no area may be wider than the frame.
        const widest = await map.evaluate((g) => {
          const frame = g.ownerSVGElement.getBBox()
          return Math.max(...[...g.querySelectorAll('path')].map((p) => p.getBBox().width / frame.width))
        })
        check(widest < 0.99, `${tag}: widest area spans ${(widest * 100).toFixed(0)}% of the map`)
        const markers = await page.getByTestId('map-marker').count()
        check(markers > 0, `${tag}: ${markers} observation markers`)
        const target = map.getByRole('option', { name: new RegExp(`^${route.pick}[:,]`) })
        await target.hover({ force: true })
        check(await page.getByRole('tooltip').isVisible(), `${tag}: hover tooltip`)
        await target.click({ force: true })
        check(await page.getByRole('complementary', { name: route.panel }).getByRole('heading', { level: 2, name: route.pick }).isVisible(), `${tag}: click selects ${route.pick}`)
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check(overflow <= 0, `${tag}: no horizontal scroll (${overflow}px)`)
      await page.evaluate(axeSource)
      const violations = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0].target.join(' ')}`)))
      check(violations.length === 0, `${tag}: axe ${violations.length ? violations.join('; ') : 'clean'}`)
      check(errors.length === 0, `${tag}: console ${errors.length ? errors.join(' | ') : 'clean'}`)
      await page.screenshot({ path: join(outDir, `${viewport.name}${route.path.replaceAll('/', '_')}.png`), fullPage: true })
      await page.close()
    }
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
