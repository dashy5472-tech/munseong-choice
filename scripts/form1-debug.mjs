#!/usr/bin/env node
/**
 * 위원 평가표 PDF 를 앱과 같은 방식으로 읽어 보고, 줄·칸이 어떻게 잡혔는지 보여 준다.
 * 총괄표가 출판사 이름이나 점수를 잘못 읽을 때 원인을 찾는 데 쓴다.
 *
 *   node scripts/form1-debug.mjs 어떤평가표.pdf
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const file = process.argv[2]
if (!file) throw new Error('PDF 경로를 주세요')

const OUT = '.hwpx-check'
mkdirSync(OUT, { recursive: true })
const bundle = join(OUT, 'form1Parse.mjs')
await esbuild.build({ entryPoints: ['src/lib/form1Parse.ts'], bundle: true, format: 'esm', outfile: bundle, logLevel: 'warning' })
const { buildRows, parseForm1 } = await import(pathToFileURL(resolve(bundle)).href)

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise
const page = await doc.getPage(1)
const content = await page.getTextContent()
const items = []
for (const it of content.items) {
  if (typeof it.str !== 'string' || !it.transform) continue
  items.push({ x: it.transform[4], y: it.transform[5], w: it.width || 0, str: it.str })
}

const rows = buildRows(items)
console.log(`글자 조각 ${items.length}개 → 줄 ${rows.length}개\n`)
rows.forEach((r, i) => {
  console.log(`r${String(i).padStart(2)} y=${r.y.toFixed(0).padStart(4)}  ` + r.cells.map((c) => `[${c.center.toFixed(0)}]${c.text}`).join(' '))
})

const p = parseForm1(rows)
console.log('\n── 해석 결과 ──')
if (!p) console.log('서식1로 읽지 못했습니다')
else {
  console.log('과목:', JSON.stringify(p.subjectName), '위원:', JSON.stringify(p.teacherName))
  console.log('출판사:', p.publisherNames)
  console.log('가격:', p.publisherPrices)
  console.log('총점:', p.totals)
  console.log('평가기준:', p.criteria.map((c) => `${c.area}/${c.points}`).join(', '))
  console.log('경고:', p.warnings)
}
