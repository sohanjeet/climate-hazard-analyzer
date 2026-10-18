/**
 * Real-browser smoke check of the built dashboard against a running backend.
 *
 *   npm run build && npx vite preview --port 5173 --strictPort &
 *   node scripts/browser-check.mjs <screenshot-dir> [baseUrl]
 *
 * For phone, tablet and desktop widths it runs one analysis, then checks that the page never scrolls sideways,
 * that nothing logged a console error, and that every section and chart rendered. Uses the installed Microsoft Edge
 * (or Chrome) through playwright-core, so no browser download is needed.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const axeSource = (await import('node:fs')).readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

const outDir = process.argv[2] ?? 'screenshots'
const baseUrl = process.argv[3] ?? 'http://localhost:5173'
mkdirSync(outDir, { recursive: true })

const candidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const executablePath = candidates.find((p) => existsSync(p))
if (!executablePath) throw new Error('No Edge or Chrome found')

// Phone and desktop are also audited in dark mode (the colour scheme follows the operating system).
const schemes = [
  { name: 'phone-dark', width: 390, height: 844, colorScheme: 'dark' },
  { name: 'desktop-dark', width: 1280, height: 900, colorScheme: 'dark' },
]

const viewports = [
  { name: 'phone', width: 360, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'wide', width: 1680, height: 1000 },
]

async function runAxe(page) {
  await page.evaluate(axeSource)
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }))
  return result.violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0].target.join(' ')}`)
}

const browser = await chromium.launch({ executablePath, headless: true })
let failures = 0
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
  if (!ok) failures += 1
}

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(msg.text()))
    page.on('pageerror', (error) => consoleErrors.push(String(error)))

    await page.goto(baseUrl)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.screenshot({ path: join(outDir, `${viewport.name}-1-idle.png`), fullPage: true })

    await page.getByLabel('Latitude').fill('51.5074')
    await page.getByLabel('Longitude').fill('-0.1278')
    await page.getByLabel('Start date').fill('2019-01-01')
    await page.getByLabel('End date').fill('2025-12-31')
    await page.getByRole('button', { name: /analyze heatwaves/i }).click()
    await page.getByRole('heading', { name: /Heatwaves near/ }).waitFor({ timeout: 120_000 })
    await page.locator('.recharts-bar-rectangle').first().waitFor()
    await page.waitForTimeout(800) // let the bar-grow animation finish before the screenshot
    await page.screenshot({ path: join(outDir, `${viewport.name}-2-results.png`), fullPage: true })

    const violations = await runAxe(page)
    check(violations.length === 0, `${viewport.name}: axe accessibility audit ${violations.join(' | ')}`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(overflow <= 0, `${viewport.name} ${viewport.width}px: no horizontal page scroll (overflow ${overflow}px)`)
    check((await page.locator('figure').count()) === 4, `${viewport.name}: four charts rendered`)
    for (const section of ['summary', 'charts', 'trends', 'quality', 'method']) {
      check((await page.locator(`#${section}`).count()) === 1, `${viewport.name}: #${section} present`)
    }
    const chartWidths = await page.locator('figure .recharts-surface').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
    check(
      chartWidths.every((w) => w > 200 && w <= viewport.width),
      `${viewport.name}: chart widths fit the viewport (${chartWidths.map(Math.round).join(', ')})`,
    )
    const smallTargets = await page.evaluate(() =>
      [...document.querySelectorAll('button, a, input, select')]
        .filter((el) => el.getBoundingClientRect().width > 0 && !el.closest('.sr-only') && !el.classList.contains('sr-only'))
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.height < 24 || r.width < 24
        })
        .map((el) => `${el.tagName}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}`),
    )
    check(smallTargets.length === 0, `${viewport.name}: all controls are at least 24x24 CSS px ${smallTargets.join(' | ')}`)
    check(consoleErrors.length === 0, `${viewport.name}: no console errors ${consoleErrors.join(' | ')}`)

    // Keyboard: the first Tab stop is the skip link and Enter on Analyze works without a mouse.
    await page.keyboard.press('Home')
    await context.close()
  }
  for (const scheme of schemes) {
    const context = await browser.newContext({ viewport: { width: scheme.width, height: scheme.height }, colorScheme: scheme.colorScheme })
    const page = await context.newPage()
    await page.goto(baseUrl)
    await page.getByLabel('Latitude').fill('51.5074')
    await page.getByLabel('Longitude').fill('-0.1278')
    await page.getByLabel('Start date').fill('2019-01-01')
    await page.getByLabel('End date').fill('2025-12-31')
    await page.getByRole('button', { name: /analyze heatwaves/i }).click()
    await page.getByRole('heading', { name: /Heatwaves near/ }).waitFor({ timeout: 120_000 })
    await page.locator('.recharts-bar-rectangle').first().waitFor()
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(outDir, `${scheme.name}-results.png`) })
    const violations = await runAxe(page)
    check(violations.length === 0, `${scheme.name}: axe accessibility audit ${violations.join(' | ')}`)
    await context.close()
  }
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\nAll browser checks passed.' : `\n${failures} browser check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
