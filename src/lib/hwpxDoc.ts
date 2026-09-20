/**
 * 앱의 값을 강릉문성고등학교 원본 한글 서식(서식1·2·3)의 칸에 채워 넣는다.
 *
 * 원본 표의 생김새 (scripts/hwpx-parts.mjs 로 뽑아 둔 그대로)
 *  · 서식1  9행 × 12열 — 0행: 머리글 + 출판사명(최대 9곳) / 1행: 가격 /
 *                        2~6행: 평가기준 / 7행: 합계 / 8행: 종합의견
 *                        0·1·2열 = 평가영역 · 평가기준 · 항목별 점수, 3열부터 출판사
 *  · 서식2 18행 × 12열 — 0행: 머리글 / 1행: 위원 이름(최대 7명) / 2~17행: 출판사(최대 16곳)
 *                        0·1열 = 출판사명 · 가격, 2~8열 = 위원, 9·10·11열 = 총점 · 평균 · 비고
 *  · 서식3  4행 ×  4열 — 0행: 머리글 / 1~3행: 1~3순위
 *                        0·1·2·3열 = 순위 · 출판사명 · 가격 · 추천의견
 *
 * 본교 양식은 세 서식 모두 '가격' 칸을 두는 것이 특징이다.
 */
import type { Criterion, DocPublisher, Evaluation, Person, SummaryMember, SummaryRecommend } from '../types'
import { columnTotal, computeSummary, rankLabel } from './scoring'
import { buildHwpx, download, dropColumns, fillTable, layoutColumns, loadPart, replaceParagraph, scaleTable, setDataRows, setRowHeights, type CellFill } from './hwpx'

/** 원본 서식이 감당하는 크기 (서식1 의 출판사 열은 9칸, 서식2 의 위원 열은 7칸) */
export const LIMITS = { publishers: 9, members: 7 }

/** mm → HWPUNIT (1/7200 인치) */
const mm = (v: number) => Math.round(v * 283.46)
/**
 * 표 너비. 편집 용지 여백을 좌우 15mm 로 두었을 때의 본문 너비(scripts/hwpx-parts.mjs 와 맞춘다)에서
 * 표 바깥 여백(양쪽 0.5mm)과 안전분 0.5mm 를 뺀다 — 딱 맞추면 오른쪽이 본문을 살짝 넘어간다
 */
const TEXT_W = { landscape: mm(297 - 30 - 1.5), portrait: mm(210 - 30 - 1.5) }

const sign = (title: string, who: Person) => `  ${title}           직 ${who.position || ''}        성명 ${who.name || ''}          (인)`

/**
 * 오른쪽 정렬 문단 모양의 번호 (public/forms/header.xml 의 paraPr 16 — horizontal="RIGHT").
 * 원본 서식1 대각선 칸의 빈 줄이 이미 쓰고 있는 번호라 글꼴·줄 간격이 그 칸과 어울린다.
 */
const PARA_RIGHT = 16

/** 가격 칸 글자. 숫자만 들어오면 천 단위로 끊고 '원' 을 붙인다 (원본 보기글이 '0,000원') */
export function priceText(price?: string): string {
  const raw = String(price ?? '').trim()
  if (!raw) return ''
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits || /[^0-9,\s]/.test(raw)) return raw // '미정' 처럼 숫자가 아닌 것은 적은 그대로
  return `${Number(digits).toLocaleString('ko-KR')}원`
}

// ───────────── 서식1 ─────────────
interface Form1Data {
  subjectName: string
  teacherName: string
  publishers: DocPublisher[]
  criteria: Criterion[]
  scores: Record<string, Record<string, number>>
  summaryOpinion: string
}

async function form1(d: Form1Data): Promise<string> {
  let xml = await loadPart('form1.xml')
  const pubs = d.publishers.slice(0, LIMITS.publishers)
  const crits = d.criteria
  const COL0 = 3 // 출판사 첫 열
  const TOP = 2 // 평가기준 첫 행(원본)

  // 평가기준 줄 수를 우리 자료에 맞춘다 (원본은 5줄)
  xml = setDataRows(xml, 0, TOP, 6, crits.length)
  const sumRow = TOP + crits.length // 합계 줄
  const opinionRow = sumRow + 1 // 종합의견 줄

  const fills: CellFill[] = []
  // 대각선 칸(출판사명 ╲ 평가기준).
  // 원본은 이 글자들을 왼쪽 정렬(JUSTIFY)에 앞 공백으로 밀어 오른쪽에 세워 두었다.
  // 아래에서 평가기준 열을 95mm 로 넓히므로 공백만으로는 글자가 가운데쯤에 서 버린다.
  // 그래서 위 세 줄은 오른쪽 정렬(PARA_RIGHT)로 세우고 앞 공백을 뺀다. 평가기준은 원본대로 왼쪽.
  fills.push({
    row: 0,
    col: 1,
    text: '출 판 사 명\n-----------\n(가격)\n\n 평 가 기 준',
    paraPr: [PARA_RIGHT, PARA_RIGHT, PARA_RIGHT, PARA_RIGHT, undefined],
  })
  // 0행 출판사명 · 1행 가격 (쓰지 않는 칸은 비운다 — 열 자체는 아래에서 없앤다)
  for (let i = 0; i < LIMITS.publishers; i++) {
    fills.push({ row: 0, col: COL0 + i, text: i < pubs.length ? pubs[i].name : '' })
    fills.push({ row: 1, col: COL0 + i, text: i < pubs.length ? priceText(pubs[i].price) : '' })
  }
  // 평가기준과 점수
  crits.forEach((c, r) => {
    const row = TOP + r
    fills.push({ row, col: 0, text: c.area })
    fills.push({ row, col: 1, text: c.text })
    fills.push({ row, col: 2, text: String(c.points) })
    for (let i = 0; i < LIMITS.publishers; i++) {
      const v = i < pubs.length ? d.scores[pubs[i].id]?.[c.id] : undefined
      fills.push({ row, col: COL0 + i, text: v == null ? '' : String(v) })
    }
  })
  // 합계 (0열의 '합  계' 는 원본 그대로 둔다)
  fills.push({ row: sumRow, col: 2, text: String(crits.reduce((a, c) => a + (Number(c.points) || 0), 0)) })
  for (let i = 0; i < LIMITS.publishers; i++) {
    fills.push({ row: sumRow, col: COL0 + i, text: i < pubs.length ? String(columnTotal(d.scores[pubs[i].id], crits)) : '' })
  }
  // 종합의견 (머리글 <종합의견 및 추천의견> 아래 줄이 아니라 같은 칸에 이어 쓴다)
  fills.push({ row: opinionRow, col: 0, text: `<종합의견 및 추천의견>\n${d.summaryOpinion || ''}` })

  xml = fillTable(xml, 0, fills)
  // 쓰지 않는 출판사 열은 없앤다
  const spare = []
  for (let i = pubs.length; i < LIMITS.publishers; i++) spare.push(COL0 + i)
  xml = dropColumns(xml, 0, spare, [1])

  // 열 너비를 본문 너비에 맞춰 새로 놓는다.
  //
  // 평가기준 칸을 넉넉히(95mm) 두는 것이 핵심이다. 이 칸이 좁으면 기준 문장이 서너 줄로 접히고,
  // 그만큼 줄이 높아져 표가 두 쪽으로 넘어간다 (가로 A4 한 쪽에 쓸 수 있는 높이는 180mm뿐이다).
  // 점수 칸은 남는 너비를 고르게 나눠 갖되, 출판사가 많으면 13mm 까지 좁아지고
  // 적으면 30mm 에서 멈춘다 — 더 넓혀 봐야 숫자 한 자리라 빈 칸만 커진다.
  const N = Math.max(pubs.length, 1)
  const area = mm(22)
  const pts = mm(16.6)
  const rest = TEXT_W.landscape - area - pts
  const pubW = Math.max(mm(13), Math.min(mm(30), Math.floor((rest - mm(95)) / N)))
  xml = layoutColumns(xml, 0, [area, rest - pubW * N, pts, ...Array.from({ length: N }, () => pubW)])
  // 비어 있을 때 쓸데없이 높던 줄은 낮춘다 (글이 길어지면 한글이 알아서 늘린다)
  // 0행은 출판사명(길면 두 줄), 1행은 가격 한 줄, 맨 아래는 종합의견 칸
  xml = setRowHeights(xml, 0, { 0: 3200, 1: 2200, [sumRow]: 2600, [opinionRow]: 6200 })
  xml = replaceParagraph(xml, '과  목', `                                 과  목 : ${d.subjectName} 과    위  원 : ${d.teacherName}       (인)`)
  return xml
}

// ───────────── 서식3 ─────────────
interface Form3Data {
  subjectName: string
  publishers: DocPublisher[]
  rows: { rank: 1 | 2 | 3; pubId: string | null; text: string }[]
  writer: Person
  checker: Person
}

async function form3(d: Form3Data): Promise<string> {
  let xml = await loadPart('form3.xml')
  const pub = (id: string | null) => d.publishers.find((p) => p.id === id)
  const fills: CellFill[] = []
  // 원본은 3줄(1~3행). 순위를 늘리거나 줄이면 줄 수도 맞춘다
  xml = setDataRows(xml, 0, 1, 3, Math.max(d.rows.length, 1))
  d.rows.forEach((r, i) => {
    const row = i + 1
    const p = pub(r.pubId)
    fills.push({ row, col: 0, text: String(r.rank) })
    fills.push({ row, col: 1, text: p?.name || '' })
    fills.push({ row, col: 2, text: priceText(p?.price) })
    fills.push({ row, col: 3, text: r.text || '' })
  })
  xml = fillTable(xml, 0, fills)
  xml = scaleTable(xml, 0, TEXT_W.portrait)
  xml = replaceParagraph(xml, '과  목', ` 과  목 : ${d.subjectName}`)
  xml = replaceParagraph(xml, '교과협의회', `  교과협의회     작성자           직 ${d.writer.position || ''}        성명 ${d.writer.name || ''}          (인)`)
  xml = replaceParagraph(xml, '확인자', sign('확인자', d.checker))
  return xml
}

// ───────────── 서식2 ─────────────
interface Form2Data {
  subjectName: string
  publishers: DocPublisher[]
  members: Pick<SummaryMember, 'id' | 'teacherName'>[]
  matrix: Record<string, Record<string, number>>
  decimals: number
  writer: Person
  checker: Person
}

async function form2(d: Form2Data): Promise<string> {
  let xml = await loadPart('form2.xml')
  const pubs = d.publishers.slice(0, 16) // 원본 자료 줄은 16줄, 넘으면 줄을 더 넣는다
  const members = d.members.slice(0, LIMITS.members)
  const MCOL0 = 2 // 위원 첫 열
  const TOP = 2
  const computed = computeSummary(d.matrix, d.publishers.map((p) => p.id), d.members.map((m) => m.id), d.decimals)

  xml = setDataRows(xml, 0, TOP, 17, Math.max(pubs.length, 1))

  const fills: CellFill[] = []
  for (let i = 0; i < LIMITS.members; i++) fills.push({ row: 1, col: MCOL0 + i, text: i < members.length ? members[i].teacherName : '' })
  pubs.forEach((p, r) => {
    const row = TOP + r
    fills.push({ row, col: 0, text: p.name })
    fills.push({ row, col: 1, text: priceText(p.price) })
    for (let i = 0; i < LIMITS.members; i++) {
      const v = i < members.length ? d.matrix[p.id]?.[members[i].id] : undefined
      fills.push({ row, col: MCOL0 + i, text: v == null ? '' : String(v) })
    }
    fills.push({ row, col: 9, text: String(computed.totals[p.id] ?? '') })
    fills.push({ row, col: 10, text: members.length ? computed.averages[p.id].toFixed(d.decimals) : '' })
    fills.push({ row, col: 11, text: members.length ? rankLabel(computed.ranks[p.id], computed.tieCounts[computed.ranks[p.id]]) : '' })
  })
  xml = fillTable(xml, 0, fills)
  // 쓰지 않는 위원 열은 없애고, 그 너비는 남은 위원 열들이 나눠 가진다
  const spare = []
  for (let i = members.length; i < LIMITS.members; i++) spare.push(MCOL0 + i)
  xml = dropColumns(xml, 0, spare, members.map((_, i) => MCOL0 + i))
  xml = scaleTable(xml, 0, TEXT_W.portrait)
  xml = replaceParagraph(xml, '과  목', ` 과  목 : ${d.subjectName}`)
  xml = replaceParagraph(xml, '작성자', sign('작성자', d.writer))
  xml = replaceParagraph(xml, '확인자', sign('확인자', d.checker))
  return xml
}

// ───────────── 바깥에서 쓰는 것 ─────────────

/**
 * 위원 개인 서류: 서식1 한 장.
 * 서식3(추천 의견서)은 본교 양식에서 교과협의회 대표교사가 쓰고 교감이 확인하는 문서라 넣지 않는다.
 */
export async function savePersonalHwpx(ev: Evaluation): Promise<void> {
  const sections = [
    await form1({
      subjectName: ev.subjectName,
      teacherName: ev.teacherName,
      publishers: ev.publishers,
      criteria: ev.criteria,
      scores: ev.scores,
      summaryOpinion: ev.summaryOpinion,
    }),
  ]
  const title = `선정 평가표_${ev.subjectName}_${ev.teacherName}`
  download(await buildHwpx({ sections, title, preview: `${title}\n검·인정도서 선정 평가표` }), `${title}.hwpx`)
}

/** 총괄 서류: 서식2 + 서식3 을 한 파일로 */
export async function saveCompileHwpx(d: {
  subjectName: string
  publishers: DocPublisher[]
  members: Pick<SummaryMember, 'id' | 'teacherName'>[]
  matrix: Record<string, Record<string, number>>
  decimals: number
  writer: Person
  checker: Person
  recommendDoc: SummaryRecommend[]
  recommendWriter: Person
  recommendChecker: Person
}): Promise<void> {
  const sections = [
    await form2(d),
    await form3({
      subjectName: d.subjectName,
      publishers: d.publishers,
      rows: d.recommendDoc,
      writer: d.recommendWriter,
      checker: d.recommendChecker,
    }),
  ]
  const title = `평가 총괄표_${d.subjectName}`
  download(await buildHwpx({ sections, title, preview: `${title}\n검·인정도서 선정기준 평가 총괄표 · 추천 의견서` }), `${title}.hwpx`)
}

/** 원본 서식이 감당하지 못하는 크기면 알려 준다 (없으면 null) */
export function hwpxWarning(publishers: number, members = 0): string | null {
  if (publishers > LIMITS.publishers) return `본교 한글 서식(서식1)은 출판사 ${LIMITS.publishers}곳까지 담을 수 있습니다. ${publishers}곳 중 앞 ${LIMITS.publishers}곳만 들어갑니다.`
  if (members > LIMITS.members) return `본교 한글 서식(서식2)은 위원 ${LIMITS.members}명까지 담을 수 있습니다. ${members}명 중 앞 ${LIMITS.members}명만 들어갑니다.`
  return null
}
