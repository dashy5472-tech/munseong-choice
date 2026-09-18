#!/usr/bin/env node
/**
 * 만들어진 한글 파일(.hwpx)이 제대로 나오는지 확인한다.
 *
 * 브라우저 없이 src/lib/hwpxDoc.ts 를 그대로 돌려 보고(fetch·download 만 흉내 낸다),
 * 나온 zip 을 풀어 ① 파일 구성 ② XML 문법 ③ 표에 값이 제대로 들어갔는지 본다.
 * 한글에서 열리는지까지는 확인할 수 없으므로, 서식을 고친 뒤에는 한 번 열어 보는 것이 좋다.
 *
 *   node scripts/hwpx-check.mjs [내보낼폴더]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const OUT = process.argv[2] || '.hwpx-check'
mkdirSync(OUT, { recursive: true })

// ───────── 1) 브라우저 코드를 node 에서 돌릴 수 있게 옮긴다 ─────────
const bundle = join(OUT, 'hwpxDoc.mjs')
await esbuild.build({
  entryPoints: ['src/lib/hwpxDoc.ts'],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  define: { 'import.meta.env.BASE_URL': '"/"' },
  logLevel: 'warning',
})

// 서식 조각은 public/forms 에서 읽어 준다
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop()
  return { ok: true, text: async () => readFileSync(`public/forms/${name}`, 'utf-8') }
}
// 내려받기 대신 blob 을 붙잡아 둔다
let caught = null
globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }
const realCreate = URL.createObjectURL
URL.createObjectURL = (blob) => {
  caught = blob
  return 'blob:test'
}
URL.revokeObjectURL = () => {}

const { savePersonalHwpx, saveCompileHwpx } = await import(pathToFileURL(resolve(bundle)).href)

// ───────── 2) 넣어 볼 값 ─────────
const publishers = [
  { id: 'p1', name: '㈜비상교육', price: '13800' },
  { id: 'p2', name: '㈜미래엔', price: '14,200' },
  { id: 'p3', name: '동아출판㈜', price: '13500' },
]
const criteria = [
  { id: 'c1', subjectId: null, area: '교육과정', text: '교육과정 부합성 · 학습 분량의 적절성', points: 20, locked: false, order: 1 },
  { id: 'c2', subjectId: null, area: '학습내용 선정', text: '내용 수준의 적정성 · 정확성 · 중립성 · 학습동기 유발', points: 20, locked: false, order: 2 },
  { id: 'c3', subjectId: null, area: '학습내용 조직', text: '효과성 · 단원, 학년간 연계 및 계열성 · 자기 주도적 학습내용', points: 20, locked: false, order: 3 },
  { id: 'c4', subjectId: null, area: '교수학습 활동', text: '다양한 교수·학습 활동 · 교수·학습 활동의 유용성', points: 20, locked: false, order: 4 },
  { id: 'c5', subjectId: null, area: '재정적 부분', text: '교과용 도서의 가격', points: 10, locked: true, order: 5 },
  { id: 'c6', subjectId: null, area: '학습 평가', text: '다양한 평가 활동 · 종합적 사고력 평가', points: 10, locked: false, order: 6 },
]
const scores = {
  p1: { c1: 18, c2: 19, c3: 17, c4: 18, c5: 9, c6: 9 }, // 90
  p2: { c1: 17, c2: 16, c3: 18, c4: 17, c5: 8, c6: 8 }, // 84
  p3: { c1: 15, c2: 16, c3: 15, c4: 16, c5: 9, c6: 7 }, // 78
}

const cases = []

await savePersonalHwpx({
  id: 'e1',
  subjectId: 's1',
  subjectName: '화법과 언어',
  teacherName: '홍길동',
  publishers,
  criteria,
  ranks: ['p1', 'p2', 'p3'],
  scores,
  summaryKeys: [],
  summaryOpinion: '성취기준을 충실히 반영하였고 탐구 활동이 다양함.\n가격도 동일 교과 도서와 견주어 적정함.',
  recommend: [],
  updatedAt: new Date().toISOString(),
})
cases.push(['위원용 (서식1)', caught, 1])

const members = [
  { id: 'm1', teacherName: '홍길동' },
  { id: 'm2', teacherName: '김영희' },
  { id: 'm3', teacherName: '이철수' },
]
await saveCompileHwpx({
  subjectName: '화법과 언어',
  publishers,
  members,
  matrix: { p1: { m1: 90, m2: 88, m3: 91 }, p2: { m1: 84, m2: 86, m3: 83 }, p3: { m1: 78, m2: 80, m3: 77 } },
  decimals: 1,
  writer: { position: '교사', name: '홍길동' },
  checker: { position: '부장교사', name: '김영희' },
  recommendDoc: [
    { rank: 1, pubId: 'p1', text: '성취기준 반영이 충실하고 탐구 활동이 다양함.' },
    { rank: 2, pubId: 'p2', text: '편집이 깔끔하고 가독성이 좋음.' },
    { rank: 3, pubId: 'p3', text: '자료는 풍부하나 분량이 다소 많음.' },
  ],
  recommendWriter: { position: '교과협의회 대표교사', name: '김영희' },
  recommendChecker: { position: '교감', name: '박민수' },
})
cases.push(['총괄용 (서식2+3)', caught, 2])

// ───────── 3) 나온 파일 뜯어 보기 ─────────
function unzip(buf) {
  const files = {}
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('zip 이 아닙니다')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf-8')
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28)
    const raw = buf.subarray(start, start + csize)
    files[name] = method === 8 ? inflateRawSync(raw) : Buffer.from(raw)
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

/** 아주 단순한 XML 문법 검사 — 여는 태그와 닫는 태그가 맞는지 */
function xmlWellFormed(xml) {
  const stack = []
  const re = /<(\/?)([A-Za-z_][\w.:-]*)(?:"[^"]*"|'[^']*'|[^>"'])*>/g
  let m
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('<?') || m[0].startsWith('<!')) continue
    if (m[1]) {
      if (stack.pop() !== m[2]) return `닫는 태그가 맞지 않습니다: </${m[2]}>`
    } else if (!m[0].endsWith('/>')) stack.push(m[2])
  }
  return stack.length ? `닫히지 않은 태그: <${stack[stack.length - 1]}>` : null
}

const cells = (tbl) =>
  (tbl.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) || []).map((tc) => {
    const a = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/.exec(tc)
    const s = /<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"\/>/.exec(tc)
    const w = /<hp:cellSz width="(\d+)"/.exec(tc)
    const unesc = (x) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    const t = (tc.match(/<hp:t>([\s\S]*?)<\/hp:t>/g) || []).map((x) => unesc(x.replace(/<hp:t>|<\/hp:t>/g, ''))).join('\n')
    return { col: +a[1], row: +a[2], colSpan: +s[1], rowSpan: +s[2], width: +w[1], text: t }
  })

let failed = 0
const fail = (msg) => {
  failed++
  console.log(`  ✗ ${msg}`)
}
const pass = (msg) => console.log(`  ✓ ${msg}`)

for (const [label, blob, sectionCount] of cases) {
  console.log(`\n── ${label} ──`)
  const buf = Buffer.from(await blob.arrayBuffer())
  const path = join(OUT, `${label.replace(/[^\w가-힣]+/g, '_')}.hwpx`)
  writeFileSync(path, buf)
  console.log(`  ${path} · ${(buf.length / 1024).toFixed(0)}KB`)

  const files = unzip(buf)
  const names = Object.keys(files)
  if (names[0] !== 'mimetype') fail(`mimetype 이 맨 앞에 없습니다 (${names[0]})`)
  else pass('mimetype 이 맨 앞')
  if (files['mimetype'].toString() !== 'application/hwp+zip') fail('mimetype 내용이 다릅니다')

  const need = ['Contents/header.xml', 'Contents/content.hpf', 'settings.xml', 'version.xml', 'META-INF/container.xml', 'META-INF/manifest.xml']
  const missing = need.filter((n) => !files[n])
  if (missing.length) fail(`빠진 파일: ${missing.join(', ')}`)
  else pass('뼈대 파일 모두 있음')

  for (let i = 0; i < sectionCount; i++) if (!files[`Contents/section${i}.xml`]) fail(`Contents/section${i}.xml 이 없습니다`)
  if (files[`Contents/section${sectionCount}.xml`]) fail(`구역이 ${sectionCount}개여야 하는데 더 있습니다`)

  for (const [n, b] of Object.entries(files)) {
    if (!n.endsWith('.xml') && !n.endsWith('.hpf')) continue
    const err = xmlWellFormed(b.toString('utf-8'))
    if (err) fail(`${n}: ${err}`)
  }
  pass('XML 문법 이상 없음')

  // 구역마다 쪽 모양(secPr)은 첫 문단에 딱 하나여야 한다.
  // 둘이면 한글이 문서를 열지 못하고 '빈 문서' 를 띄운다 — 눈으로는 알 수 없고 XML 문법도 멀쩡하다.
  for (let i = 0; i < sectionCount; i++) {
    const xml = files[`Contents/section${i}.xml`]?.toString('utf-8') || ''
    const cnt = (xml.match(/<hp:secPr[ >]/g) || []).length
    if (cnt !== 1) fail(`section${i} 의 secPr 이 ${cnt}개입니다 (1개여야 합니다)`)
  }
  if (!failed) pass('구역마다 secPr 하나씩')

  const head = files['Contents/header.xml'].toString('utf-8')
  const secCnt = /<hh:head\b[^>]*secCnt="(\d+)"/.exec(head)?.[1]
  if (Number(secCnt) !== sectionCount) fail(`header.xml secCnt=${secCnt}, 실제 구역 ${sectionCount}개`)
  else pass(`secCnt=${secCnt} 가 구역 수와 맞음`)

  const hpf = files['Contents/content.hpf'].toString('utf-8')
  const listed = (hpf.match(/href="Contents\/section\d+\.xml"/g) || []).length
  if (listed !== sectionCount) fail(`content.hpf 에 구역이 ${listed}개 적혀 있습니다`)
  else pass('content.hpf 의 구역 목록이 맞음')

  // 표 내용 확인
  for (let i = 0; i < sectionCount; i++) {
    const xml = files[`Contents/section${i}.xml`].toString('utf-8')
    const tbl = (xml.match(/<hp:tbl [\s\S]*?<\/hp:tbl>/g) || [])[0]
    if (!tbl) {
      fail(`section${i} 에 표가 없습니다`)
      continue
    }
    const m = /<hp:tbl [^>]*rowCnt="(\d+)" colCnt="(\d+)"/.exec(tbl)
    const cs = cells(tbl)
    const at = (row, col) => cs.find((c) => c.row === row && c.col === col)?.text ?? null
    const rowCnt = +m[1]
    const colCnt = +m[2]
    // 칸 주소가 빠짐없이 이어지는지 (한글이 '손상된 파일' 이라고 하는 가장 흔한 원인)
    for (let r = 0; r < rowCnt; r++) {
      let covered = 0
      for (const c of cs) if (c.row <= r && r < c.row + c.rowSpan) covered += c.col === undefined ? 0 : 0
      const inRow = cs.filter((c) => c.row === r)
      const spanIn = cs.filter((c) => c.row < r && c.row + c.rowSpan > r)
      covered = inRow.reduce((a, c) => a + c.colSpan, 0) + spanIn.reduce((a, c) => a + c.colSpan, 0)
      if (covered !== colCnt) fail(`section${i} ${r}행: 칸이 ${covered}칸, colCnt 는 ${colCnt}`)
    }
    // 표 너비 = 열 너비 합
    const total = +/<hp:sz width="(\d+)"/.exec(tbl)[1]
    const widths = []
    for (const c of cs) if (c.colSpan === 1 && !widths[c.col]) widths[c.col] = c.width
    const sum = widths.reduce((a, w) => a + (w || 0), 0)
    if (Math.abs(sum - total) > 2) fail(`section${i} 표 너비 ${total} ≠ 열 너비 합 ${sum}`)

    const title = (xml.match(/<hp:t>【서식\d】<\/hp:t>/) || ['?'])[0].replace(/<[^>]+>/g, '')
    console.log(`  section${i} ${title} ${rowCnt}행 × ${colCnt}열`)
    if (title === '【서식1】') {
      const sumRow = 2 + criteria.length // 합계 줄
      const opinionRow = sumRow + 1
      const checks = [
        [0, 3, '㈜비상교육'], [1, 3, '13,800원'],
        [0, 5, '동아출판㈜'], [1, 5, '13,500원'],
        [2, 0, '교육과정'], [2, 2, '20'], [2, 3, '18'],
        [sumRow, 2, '100'], [sumRow, 3, '90'], [sumRow, 4, '84'], [sumRow, 5, '78'],
      ]
      for (const [r, c, want] of checks) {
        const got = at(r, c)
        if (got !== want) fail(`서식1 (${r}행,${c}열) = ${JSON.stringify(got)} · 기대 ${JSON.stringify(want)}`)
      }
      if (colCnt !== 6) fail(`서식1 은 출판사 3곳이면 6열이어야 하는데 ${colCnt}열`)
      if (rowCnt !== opinionRow + 1) fail(`서식1 은 평가기준 ${criteria.length}줄이면 ${opinionRow + 1}행이어야 하는데 ${rowCnt}행`)
      if (!at(opinionRow, 0)?.startsWith('<종합의견 및 추천의견>')) fail('서식1 종합의견 칸이 비었습니다')
      if (!xml.includes('과  목 : 화법과 언어 과')) fail('서식1 과목·위원 줄이 채워지지 않았습니다')
      pass('서식1 값 확인')
    }
    if (title === '【서식2】') {
      const checks = [
        [1, 2, '홍길동'], [1, 4, '이철수'],
        [2, 0, '㈜비상교육'], [2, 1, '13,800원'], [2, 2, '90'], [2, 5, '269'], [2, 6, '89.7'], [2, 7, '1순위'],
        [4, 0, '동아출판㈜'], [4, 1, '13,500원'], [4, 7, '3순위'],
      ]
      for (const [r, c, want] of checks) {
        const got = at(r, c)
        if (got !== want) fail(`서식2 (${r}행,${c}열) = ${JSON.stringify(got)} · 기대 ${JSON.stringify(want)}`)
      }
      if (rowCnt !== 5) fail(`서식2 는 출판사 3곳이면 5행이어야 하는데 ${rowCnt}행`)
      if (colCnt !== 8) fail(`서식2 는 위원 3명이면 8열이어야 하는데 ${colCnt}열`)
      if (!xml.includes('성명 홍길동')) fail('서식2 작성자가 채워지지 않았습니다')
      pass('서식2 값 확인')
    }
    if (title === '【서식3】') {
      const checks = [[1, 0, '1'], [1, 1, '㈜비상교육'], [1, 2, '13,800원'], [3, 1, '동아출판㈜'], [3, 2, '13,500원']]
      for (const [r, c, want] of checks) {
        const got = at(r, c)
        if (got !== want) fail(`서식3 (${r}행,${c}열) = ${JSON.stringify(got)} · 기대 ${JSON.stringify(want)}`)
      }
      if (!at(1, 3)?.includes('성취기준')) fail('서식3 추천의견이 비었습니다')
      if (!xml.includes('성명 박민수')) fail('서식3 확인자가 채워지지 않았습니다')
      pass('서식3 값 확인')
    }
  }
}

URL.createObjectURL = realCreate
rmSync(bundle, { force: true })
console.log(failed ? `\n✗ ${failed}건 어긋남` : '\n✓ 모두 통과')
process.exit(failed ? 1 : 0)
