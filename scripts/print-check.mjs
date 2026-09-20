#!/usr/bin/env node
/**
 * [인쇄 · PDF 저장] 으로 나오는 PDF 를 실제로 뽑아 확인한다.
 *
 *  · 쪽수 — 평가표는 한 쪽이어야 한다
 *  · 머리말·꼬리말 — 브라우저가 찍는 날짜·주소·쪽번호가 없어야 한다
 *    (쪽 여백을 0 으로 두고 종이 여백을 서식 안쪽 여백으로 옮겨 막았다. src/styles.css @media print)
 *
 * 브라우저에 '머리글 및 바닥글' 을 켠 채로 뽑아 보므로, 그래도 안 나오면 제대로 막힌 것이다.
 *
 *   npm run dev                  # 다른 창에서 먼저 띄운다
 *   node scripts/print-check.mjs
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const BASE = (process.argv[2] || 'http://localhost:5173/munseong-choice/').replace(/\/?$/, '/')
const OUT = '.hwpx-check/print'
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const exe = BROWSERS.find((p) => existsSync(p))
if (!exe) throw new Error('크롬이나 엣지를 찾지 못했습니다')

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const PUBS = ['㈜천재교과서', '동아출판㈜', '㈜와이비엠', '㈜미래엔', '㈜비상교육', '㈜지학사']
const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 840 }, locale: 'ko-KR' })).newPage()
// 인쇄 대화상자만 막는다. 나머지는 앱이 하던 대로 하게 둔다
await page.addInitScript(() => {
  window.__printCalls = 0
  window.print = () => {
    window.__printCalls++
  }
})

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.getByText('서류 초안').first().click()
await page.waitForTimeout(400)
await page.getByPlaceholder('홍길동').fill('김주영')
await page.getByRole('button', { name: '고등학교', exact: true }).click()
await page.getByPlaceholder(/과목명을 입력하세요/).fill('확률')
await page.getByText('확률과 통계', { exact: true }).first().click()
await page.waitForTimeout(500)

const names = page.locator('input[placeholder^="출판사 "]')
for (let i = 0; i < PUBS.length; i++) {
  if ((await names.count()) <= i) await page.getByRole('button', { name: '+ 출판사 추가' }).click()
  await names.nth(i).fill(PUBS[i])
}
for (let i = await names.count(); i > PUBS.length; i--) await page.locator('.pub-item .icon-x').nth(i - 1).click()
await page.waitForTimeout(300)
const sel = page.locator('select')
for (let r = 0; r < 3; r++) await sel.nth(r).selectOption({ label: PUBS[r] })
await page.locator('.form-sheet.form1').waitFor({ timeout: 10000 })
await page.waitForTimeout(600)

/**
 * 앱의 인쇄 단추를 실제로 눌러 PDF 로 뽑는다.
 * window.print 만 막아 두면 나머지(쪽 모양 주입·서식 고르기)는 src/lib/print.ts 가 그대로 한다 —
 * 그래야 앱이 실제로 거는 @page 여백을 검사할 수 있다. 예전에 이 스크립트가 제 @page 를
 * 따로 넣는 바람에 여백을 0 으로 덮어써, 머리말이 찍히는 것을 못 잡았다.
 */
const waitPrinting = async () => {
  await page.waitForFunction(() => window.__printCalls > 0 && document.documentElement.classList.contains('printing'), null, { timeout: 15000 })
  await page.waitForTimeout(200)
}
const pageMargin = () => page.evaluate(() => document.getElementById('print-page-size')?.textContent || '(없음)')
const finishPrint = async () => {
  await page.evaluate(() => {
    window.__printCalls = 0
    window.dispatchEvent(new Event('afterprint'))
  })
  await page.waitForTimeout(600)
}

await page.getByRole('button', { name: /다음: 추천 의견서/ }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: /다음: 인쇄·저장/ }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: /인쇄 · PDF 저장/ }).click()
await page.waitForTimeout(500)
// 인쇄 전 확인 창의 [확인]
await page.locator('.modal .btn.primary').first().click()

await waitPrinting()
console.log(`  앱이 건 쪽 모양: ${await pageMargin()}`)
await page.pdf({ path: join(OUT, '서식1.pdf'), printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true })
await finishPrint()

await waitPrinting()
await page.pdf({ path: join(OUT, '서식3.pdf'), printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true })
await finishPrint()

await browser.close()

// ───── 나온 PDF 읽어 보기 ─────
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
let failed = 0
for (const [file, want] of [['서식1.pdf', 1], ['서식3.pdf', 1]]) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(OUT, file))), useSystemFonts: true }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    text += c.items.map((t) => t.str).join(' ')
  }
  const junk = []
  if (/https?:\/\//.test(text)) junk.push('주소')
  if (/\d{2,4}\.\s?\d{1,2}\.\s?\d{1,2}\./.test(text)) junk.push('날짜')
  if (/\b\d+\s*\/\s*\d+\b/.test(text)) junk.push('쪽번호')

  if (doc.numPages !== want) {
    failed++
    console.log(`  ✗ ${file} — ${doc.numPages}쪽 (${want}쪽이어야 합니다)`)
  } else console.log(`  ✓ ${file} ${doc.numPages}쪽`)

  if (junk.length) {
    failed++
    console.log(`  ✗ ${file} — 머리말·꼬리말에 ${junk.join('·')}가 찍힙니다`)
  } else console.log(`  ✓ ${file} 머리말·꼬리말 없음`)
}
console.log(failed ? `\n✗ ${failed}건 어긋남` : '\n✓ 모두 통과')
process.exit(failed ? 1 : 0)
