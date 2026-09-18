#!/usr/bin/env node
/**
 * 사용법(/사용법) 화면에 들어가는 안내 그림을 실제 앱을 움직여 다시 찍는다.
 *
 * 화면이 바뀌면 안내 그림도 같이 바뀌어야 한다. 손으로 찍으면 열네 장을 매번 다시 찍어야 하므로
 * 여기서 앱을 처음부터 끝까지 한 번 돌려 보며 단계마다 저장한다.
 * 총괄 화면 그림은 위원 평가표를 PDF 로 뽑아 그 파일을 도로 올려서 찍는다 —
 * 덕분에 이 스크립트는 '위원 → PDF → 총괄' 한 바퀴가 실제로 도는지 확인해 주기도 한다.
 *
 * 브라우저는 이 컴퓨터에 깔린 크롬/엣지를 그대로 쓴다 (따로 내려받지 않는다).
 *
 *   npm run dev                       # 다른 창에서 먼저 띄운다
 *   node scripts/guide-shots.mjs      # 기본 http://localhost:5173/munseong-choice/
 *   node scripts/guide-shots.mjs http://localhost:4173/munseong-choice/
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const BASE = (process.argv[2] || 'http://localhost:5173/munseong-choice/').replace(/\/?$/, '/')
const OUT = 'public/guide'
const TMP = 'C:/Users/user/AppData/Local/Temp/guide-pdf'

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
const exe = BROWSERS.find((p) => existsSync(p))
if (!exe) throw new Error('크롬이나 엣지를 찾지 못했습니다. BROWSERS 에 경로를 넣어 주세요.')

mkdirSync(OUT, { recursive: true })
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

const VIEW = { width: 1280, height: 840 }
/** 위원 세 명 — 이름과 순위를 달리해 점수가 서로 다르게 나오게 한다 */
const MEMBERS = [
  { name: '김문성', ranks: [0, 1, 2] },
  { name: '이해람', ranks: [1, 0, 2] },
  { name: '박누리', ranks: [0, 2, 1] },
]
const PUBS = [
  { name: '㈜비상교육', price: '13800' },
  { name: '㈜미래엔', price: '14200' },
  { name: '동아출판㈜', price: '13500' },
]
const SUBJECT = '확률과 통계'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, locale: 'ko-KR' })
const page = await ctx.newPage()

let n = 0
const shot = async (name, target) => {
  n++
  const path = join(OUT, name)
  await page.waitForTimeout(250)
  if (target) await (await page.locator(target).first()).screenshot({ path, type: 'jpeg', quality: 78 })
  else await page.screenshot({ path, type: 'jpeg', quality: 78 })
  console.log(`  ${name}`)
}

/**
 * 서식 한 장만 찍는다.
 * 서식 상자는 인쇄에 맞춰 A4 높이로 고정되어 있어, 그대로 찍으면 아래쪽이 텅 비고
 * 그 자리에 뒤 내용이 비쳐 든다. 찍는 동안만 높이를 내용에 맞춘다.
 */
const sheetShot = async (name, target) => {
  const el = page.locator(target).first()
  await el.evaluate((node) => {
    node.dataset.shotH = node.style.height
    node.dataset.shotMin = node.style.minHeight
    node.style.height = 'auto'
    node.style.minHeight = '0'
  })
  await page.waitForTimeout(200)
  await shot(name, target)
  await el.evaluate((node) => {
    node.style.height = node.dataset.shotH || ''
    node.style.minHeight = node.dataset.shotMin || ''
    delete node.dataset.shotH
    delete node.dataset.shotMin
  })
}

/** 이름·과목·출판사·순위를 넣어 평가표가 그려질 때까지 */
async function fillEvaluation({ name, ranks }, { stopAfter } = {}) {
  await page.getByPlaceholder('홍길동').fill(name)
  await page.getByRole('button', { name: '고등학교', exact: true }).click()
  await page.getByPlaceholder(/과목명을 입력하세요/).fill('확률')
  if (stopAfter === 'search') return
  await page.getByText(SUBJECT, { exact: true }).first().click()
  await page.waitForTimeout(400)

  const names = page.locator('input[placeholder^="출판사 "]')
  const prices = page.locator('input[placeholder="가격"]')
  for (let i = 0; i < PUBS.length; i++) {
    if ((await names.count()) <= i) await page.getByRole('button', { name: '+ 출판사 추가' }).click()
    await names.nth(i).fill(PUBS[i].name)
  }
  // 목록에서 온 출판사는 이름이 이미 차 있으니 남는 빈 칸은 지운다
  for (let i = await names.count(); i > PUBS.length; i--) await page.locator('.pub-item .icon-x').nth(i - 1).click()
  await page.waitForTimeout(200)
  for (let i = 0; i < PUBS.length; i++) await prices.nth(i).fill(PUBS[i].price)
  if (stopAfter === 'publishers') return

  const picks = page.locator('.side select, aside select, select')
  for (let r = 0; r < 3; r++) {
    const opts = await picks.nth(r).locator('option').allTextContents()
    const want = PUBS[ranks[r]].name
    if (opts.includes(want)) await picks.nth(r).selectOption({ label: want })
  }
  await page.locator('.form-sheet.form1').waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
}

/** 화면의 서식 하나를 인쇄 모양 그대로 PDF 로 뽑는다 (src/lib/print.ts 와 같은 방식) */
async function sheetToPdf(selector, path, landscape) {
  await page.evaluate(
    ({ selector, landscape }) => {
      const all = Array.from(document.querySelectorAll('.form-sheet'))
      const targets = Array.from(document.querySelectorAll(selector))
      all.forEach((el) => el.classList.toggle('print-skip', !targets.includes(el)))
      const s = document.createElement('style')
      s.id = 'shot-page'
      s.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${landscape ? '10mm' : '12mm'}; }`
      document.head.appendChild(s)
      document.documentElement.classList.add('printing')
    },
    { selector, landscape },
  )
  await page.waitForTimeout(200)
  await page.pdf({
    path,
    format: 'A4',
    landscape,
    printBackground: true,
    margin: landscape ? { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } : { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
  })
  await page.evaluate(() => {
    document.querySelectorAll('.form-sheet').forEach((el) => el.classList.remove('print-skip'))
    document.getElementById('shot-page')?.remove()
    document.documentElement.classList.remove('printing')
  })
}

const goStart = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
}

// ───────── 위원 화면 ─────────
console.log('위원 화면')
await goStart()
await shot('01-start.jpg')

await page.getByText('서류 초안').first().click()
await page.waitForTimeout(400)
await fillEvaluation(MEMBERS[0], { stopAfter: 'search' })
await page.waitForTimeout(500)
await shot('02-search.jpg')

await goStart()
await page.getByText('서류 초안').first().click()
await page.waitForTimeout(400)
await fillEvaluation(MEMBERS[0], { stopAfter: 'publishers' })
await shot('03-publishers.jpg')

await goStart()
await page.getByText('서류 초안').first().click()
await page.waitForTimeout(400)
await fillEvaluation(MEMBERS[0])
await sheetShot('04-sheet.jpg', '.form-sheet.form1')

// 배점을 넘는 점수를 넣어 안내 창을 띄운다
const cell = page.locator('.form-sheet.form1 td.num.editable').first()
await cell.click()
await page.locator('input.cell-edit').fill('99')
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
await shot('05-guard.jpg')
await page.getByRole('button', { name: '닫기' }).or(page.locator('.modal .btn').first()).first().click()
await page.waitForTimeout(300)

// 종합의견 창
await page.locator('.form-sheet.form1 .opinion').first().click()
await page.waitForTimeout(600)
await shot('06-opinion.jpg')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await page.getByRole('button', { name: /다음: 추천 의견서/ }).click()
await page.waitForTimeout(700)
await sheetShot('07-form3.jpg', '.form-sheet.form3')

await page.getByRole('button', { name: /다음: 인쇄·저장/ }).click()
await page.waitForTimeout(700)
await shot('08-print.jpg')

await page.getByRole('button', { name: /인쇄 · PDF 저장/ }).click()
await page.waitForTimeout(500)
await shot('09-printnotice.jpg')
await page.locator('.modal .btn').first().click()
await page.waitForTimeout(300)

// ───────── 위원 평가표 PDF 만들기 (총괄 화면 그림에 쓴다) ─────────
console.log('위원 평가표 PDF')
const pdfs = []
for (const m of MEMBERS) {
  await goStart()
  await page.getByText('서류 초안').first().click()
  await page.waitForTimeout(400)
  await fillEvaluation(m)
  const path = join(TMP, `${m.name}.pdf`)
  await sheetToPdf('.form-sheet.form1', path, true)
  pdfs.push(path)
  console.log(`  ${m.name}.pdf`)
}

// ───────── 총괄 화면 ─────────
console.log('총괄 화면')
await goStart()
await page.getByRole('button', { name: /평가총괄표 작성/ }).click()
await page.waitForTimeout(600)
await shot('10-compile-upload.jpg')

await page.locator('input[type="file"]').first().setInputFiles(pdfs)
await page.waitForTimeout(6000)
await shot('11-compile-members.jpg')

await page.getByRole('button', { name: /총괄표 생성하기/ }).click()
await page.waitForTimeout(2500)
await page.locator('.price-edit summary').click()
await page.waitForTimeout(300)
await shot('12-compile-price.jpg')
await page.locator('.price-edit summary').click()
await page.waitForTimeout(300)
await sheetShot('13-compile-sheet.jpg', '.form-sheet.form2')

// ───────── 그 밖에 ─────────
console.log('그 밖에')
await goStart()
await page.getByRole('button', { name: '설정', exact: true }).click()
await page.waitForTimeout(800)
await shot('14-settings.jpg')

const mob = await ctx.newPage()
await mob.setViewportSize({ width: 390, height: 780 })
await mob.goto(BASE, { waitUntil: 'networkidle' })
await mob.waitForTimeout(800)
await mob.screenshot({ path: join(OUT, '15-mobile.jpg'), type: 'jpeg', quality: 78 })
console.log('  15-mobile.jpg')

await browser.close()
rmSync(TMP, { recursive: true, force: true })
console.log(`\n${n + 1}장 저장했습니다 → ${OUT}`)
