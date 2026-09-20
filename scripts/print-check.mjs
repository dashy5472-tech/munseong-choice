#!/usr/bin/env node
/**
 * [인쇄 · PDF 저장] 으로 나오는 PDF 를 실제로 뽑아 확인한다. 서식1·2·3 넷 다 본다.
 *
 *  · 쪽수 — 서식마다 한 쪽이어야 한다
 *  · 머리말·꼬리말 — 브라우저가 찍는 날짜·주소·쪽번호가 없어야 한다
 *    (쪽 여백을 0 으로 두고 종이 여백을 서식 안쪽 여백으로 옮겨 막았다. src/styles.css @media print)
 *
 * 인쇄 대화상자(window.print)만 막고 나머지는 앱이 하던 대로 하게 둔다 — 그래야 앱이 실제로
 * 거는 @page 여백을 검사할 수 있다. 예전에 이 스크립트가 제 @page 를 따로 넣는 바람에
 * 여백을 0 으로 덮어써, 머리말이 찍히는 것을 못 잡았다.
 *
 * 총괄 화면(서식2·서식3) 은 위원 평가표 PDF 가 있어야 하므로, 위원 셋을 돌려 PDF 를 만든 뒤
 * 그것을 도로 올린다. 덕분에 '위원 인쇄 → 총괄 취합 → 총괄 인쇄' 한 바퀴를 함께 확인한다.
 *
 *   npm run dev                  # 다른 창에서 먼저 띄운다
 *   npm run check:print
 *   node scripts/print-check.mjs https://…   # 배포된 것에 돌려 볼 수도 있다
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
const MEMBERS = [
  { name: '김주영', ranks: [0, 1, 2] },
  { name: '이해람', ranks: [1, 0, 2] },
  { name: '박누리', ranks: [0, 2, 1] },
]

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 840 }, locale: 'ko-KR' })).newPage()
// 인쇄 대화상자만 막는다. 나머지는 앱이 하던 대로 하게 둔다
await page.addInitScript(() => {
  window.__printCalls = 0
  window.print = () => {
    window.__printCalls++
  }
})

const goStart = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  printed = 0 // 새로 고치면 앱의 인쇄 횟수도 0 부터다
}

/**
 * 다음 인쇄가 시작되기를 기다린다.
 *
 * page.pdf() 는 그 자체로 afterprint 를 일으킨다. 그래서 앱(printSheetsInTurn)은 알아서
 * 다음 서식으로 넘어간다 — 여기서 afterprint 를 또 보내면 갓 시작한 다음 인쇄를 끊어 버린다.
 * 그래서 보내지 않고, 인쇄 횟수가 하나 더 늘기를 기다리기만 한다.
 */
let printed = 0
const waitPrinting = async (what = '') => {
  printed++
  try {
    await page.waitForFunction(
      (n) => window.__printCalls >= n && document.documentElement.classList.contains('printing'),
      printed,
      { timeout: 20000 },
    )
  } catch (e) {
    const info = await page.evaluate(() => ({
      printCalls: window.__printCalls,
      printing: document.documentElement.classList.contains('printing'),
      sheets: [...document.querySelectorAll('.form-sheet')].map((el) => el.className),
      modal: document.querySelector('.modal')?.innerText?.slice(0, 200) || null,
    }))
    console.log(`
  [막힘 ${what}] 기다린 횟수 ${printed} ·`, JSON.stringify(info))
    await page.screenshot({ path: join(OUT, `stuck-${what || 'x'}.png`) })
    throw e
  }
  await page.waitForTimeout(250)
}

/** 인쇄될 모습 그대로 그림으로도 남겨 둔다 — 눈으로 확인할 때 쓴다 */
const snapSheet = async (name) => {
  const el = page.locator('.form-sheet:not(.print-skip)').first()
  await el.screenshot({ path: join(OUT, `${name}.png`) })
}

const pageStyle = () => page.evaluate(() => document.getElementById('print-page-size')?.textContent || '(없음)')

/** 위원 화면 한 벌 채우기 */
async function fillEvaluation({ name, ranks }) {
  await page.getByText('서류 초안').first().click()
  await page.waitForTimeout(400)
  await page.getByPlaceholder('홍길동').fill(name)
  await page.getByRole('button', { name: '고등학교', exact: true }).click()
  await page.getByPlaceholder(/과목명을 입력하세요/).fill('확률')
  await page.getByText('확률과 통계', { exact: true }).first().click()
  await page.waitForTimeout(500)
  const names = page.locator('input[placeholder^="출판사 "]')
  const prices = page.locator('input[placeholder="가격"]')
  for (let i = 0; i < PUBS.length; i++) {
    if ((await names.count()) <= i) await page.getByRole('button', { name: '+ 출판사 추가' }).click()
    await names.nth(i).fill(PUBS[i])
  }
  for (let i = await names.count(); i > PUBS.length; i--) await page.locator('.pub-item .icon-x').nth(i - 1).click()
  await page.waitForTimeout(300)
  for (let i = 0; i < PUBS.length; i++) await prices.nth(i).fill(String(13000 + i * 200))
  const sel = page.locator('select')
  for (let r = 0; r < 3; r++) await sel.nth(r).selectOption({ label: PUBS[ranks[r]] })
  await page.locator('.form-sheet.form1').waitFor({ timeout: 10000 })
  await page.waitForTimeout(600)
}

const made = []
const memberPdfs = []

// ───────── 위원 화면: 평가표(가로) + 추천 의견서(세로) 가 차례로 인쇄된다 ─────────
for (const [i, m] of MEMBERS.entries()) {
  await goStart()
  await fillEvaluation(m)
  await page.getByRole('button', { name: /다음: 추천 의견서/ }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /다음: 인쇄·저장/ }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /인쇄 · PDF 저장/ }).click()
  await page.waitForTimeout(500)
  await page.locator('.modal .btn.primary').first().click()

  await waitPrinting(`서식1-${m.name}`)
  if (i === 0) console.log(`  위원 평가표 쪽 모양: ${await pageStyle()}`)
  const f1 = join(OUT, `서식1_${m.name}.pdf`)
  await page.pdf({ path: f1, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true })
  memberPdfs.push(f1)
  if (i === 0) made.push(['서식1 선정 평가표', f1, 1])
  await page.waitForTimeout(900) // 앱이 다음 서식으로 넘어갈 틈

  await waitPrinting(`서식3-${m.name}`)
  const f3 = join(OUT, `서식3_개인_${m.name}.pdf`)
  await page.pdf({ path: f3, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true })
  if (i === 0) made.push(['서식3 추천 의견서(위원 참고본)', f3, 1])
  await page.waitForTimeout(900) // 앱이 다음 서식으로 넘어갈 틈
}

// ───────── 총괄 화면: 위원 PDF 를 올려 총괄표를 만든 뒤 인쇄 ─────────
await goStart()
await page.getByRole('button', { name: /평가총괄표 작성/ }).click()
await page.waitForTimeout(600)
await page.locator('input[type="file"]').first().setInputFiles(memberPdfs)
await page.waitForTimeout(8000)
await page.getByRole('button', { name: /총괄표 생성하기/ }).click()
await page.waitForTimeout(3000)
await page.locator('.form-sheet.form2').waitFor({ timeout: 15000 })
// 인쇄 단추는 마지막 단계에 있다
await page.getByRole('button', { name: /다음: 인쇄·저장/ }).click()
await page.waitForTimeout(800)

for (const [label, btn, file] of [
  ['서식2 평가 총괄표', /총괄표 인쇄/, '서식2_총괄표.pdf'],
  ['서식3 추천 의견서(공식본)', /추천 의견서 인쇄/, '서식3_공식.pdf'],
]) {
  await page.getByRole('button', { name: btn }).click()
  await page.waitForTimeout(500)
  await page.locator('.modal .btn.primary').first().click()
  await waitPrinting()
  if (file.includes('서식2')) console.log(`  총괄표 쪽 모양: ${await pageStyle()}`)
  const p = join(OUT, file)
  await snapSheet(file.replace('.pdf', ''))
  await page.pdf({ path: p, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true })
  made.push([label, p, 1])
  await page.waitForTimeout(900) // 앱이 다음 서식으로 넘어갈 틈
}

await browser.close()

// ───────── 나온 PDF 읽어 보기 ─────────
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
let failed = 0
console.log('')
for (const [label, path, want] of made) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise
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
    console.log(`  ✗ ${label} — ${doc.numPages}쪽 (${want}쪽이어야 합니다)`)
  } else if (junk.length) {
    failed++
    console.log(`  ✗ ${label} — 머리말·꼬리말에 ${junk.join('·')}가 찍힙니다`)
  } else {
    console.log(`  ✓ ${label} — ${doc.numPages}쪽 · 머리말·꼬리말 없음`)
  }
}
console.log(failed ? `\n✗ ${failed}건 어긋남` : '\n✓ 모두 통과')
process.exit(failed ? 1 : 0)
