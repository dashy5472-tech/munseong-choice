/**
 * 위원이 받은 한글 파일(.hwpx)에서 선정 평가표를 도로 읽는다.
 *
 * PDF 를 거치지 않는 길이다. 한글로 내보낸 PDF 는 글자를 모두 선(벡터 그림)으로 바꿔 버려
 * 글자가 한 자도 들어 있지 않고, 그림 판독(OCR)으로는 숫자를 믿을 수 없다.
 * 반면 .hwpx 는 우리가 만든 XML 그대로라, 표의 칸 주소로 값을 꺼내면 어긋날 일이 없다.
 *
 * 위원이 한글에서 점수를 고쳐 저장한 파일도 읽힌다 — 칸 주소로 찾기 때문이다.
 */
import type { ParsedForm1 } from './form1Parse'
import { normalize } from './form1Parse'

/** zip 한 개를 푼다 (압축된 것은 브라우저의 DecompressionStream 으로 푼다) */
async function unzip(buf: ArrayBuffer): Promise<Record<string, string>> {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  // 끝에서 중앙 디렉터리 자리를 찾는다
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('한글 파일(zip)이 아닙니다.')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const dec = new TextDecoder('utf-8')
  const out: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const method = view.getUint16(p + 10, true)
    const csize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const lho = view.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (!/^(Contents\/section\d+\.xml)$/.test(name)) continue
    const start = lho + 30 + view.getUint16(lho + 26, true) + view.getUint16(lho + 28, true)
    const raw = bytes.subarray(start, start + csize)
    if (method === 0) out[name] = dec.decode(raw)
    else if (method === 8) {
      const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      out[name] = await new Response(stream).text()
    }
  }
  return out
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

interface Cell {
  row: number
  col: number
  colSpan: number
  text: string
}

/** 표 하나의 칸을 { 줄, 열, 글자 } 로 읽는다 */
function tableCells(tbl: string): Cell[] {
  return (tbl.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) || []).map((tc) => {
    const addr = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/.exec(tc)
    const span = /<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"\/>/.exec(tc)
    const lines = (tc.match(/<hp:p\b[\s\S]*?<\/hp:p>/g) || []).map((p) =>
      (p.match(/<hp:t>[\s\S]*?<\/hp:t>/g) || []).map((t) => unesc(t.replace(/<\/?hp:t>/g, ''))).join(''),
    )
    return {
      row: addr ? Number(addr[2]) : 0,
      col: addr ? Number(addr[1]) : 0,
      colSpan: span ? Number(span[1]) : 1,
      text: lines.join('\n').replace(/\n+$/, ''),
    }
  })
}

/** 표 바깥 문단들의 글자 */
function paragraphTexts(xml: string): string[] {
  return (xml.match(/<hp:p\b[^>]*>(?:(?!<hp:tbl|<\/hp:p>)[\s\S])*?<\/hp:p>/g) || [])
    .map((p) => (p.match(/<hp:t>[\s\S]*?<\/hp:t>/g) || []).map((t) => unesc(t.replace(/<\/?hp:t>/g, ''))).join(''))
    .filter((t) => t.trim())
}

export interface HwpxReadResult {
  parsed?: ParsedForm1
  error?: string
}

/**
 * .hwpx 에서 서식1 을 읽어 PDF 로 읽었을 때와 같은 꼴로 돌려준다.
 * 서식1 이 없으면(총괄용 파일 등) 무엇이 들어 있었는지 알려 준다.
 */
export async function readForm1Hwpx(file: File): Promise<HwpxReadResult> {
  if (typeof DecompressionStream === 'undefined') {
    return { error: '이 브라우저는 한글 파일을 풀지 못합니다. 크롬·엣지 최신판에서 열어 주세요.' }
  }
  let parts: Record<string, string>
  try {
    parts = await unzip(await file.arrayBuffer())
  } catch (e) {
    return { error: (e as Error).message }
  }

  const sections = Object.keys(parts).sort()
  const section = sections.find((n) => parts[n].includes('【서식1】') || parts[n].includes('선정 평가표'))
  if (!section) {
    const has = sections.some((n) => parts[n].includes('【서식2】')) ? '평가 총괄표' : sections.some((n) => parts[n].includes('【서식3】')) ? '추천 의견서' : ''
    return { error: `이 한글 파일에는 선정 평가표(서식1)가 없습니다${has ? ` — ${has}입니다` : ''}.` }
  }
  const xml = parts[section]
  const tbl = /<hp:tbl [\s\S]*?<\/hp:tbl>/.exec(xml)?.[0]
  if (!tbl) return { error: '한글 파일에서 평가표를 찾지 못했습니다.' }

  const cells = tableCells(tbl)
  const at = (row: number, col: number) => cells.find((c) => c.row === row && c.col === col)?.text ?? ''
  const rowCnt = Number(/<hp:tbl\b[^>]*rowCnt="(\d+)"/.exec(tbl)?.[1] || 0)
  const colCnt = Number(/<hp:tbl\b[^>]*colCnt="(\d+)"/.exec(tbl)?.[1] || 0)
  // 0·1·2열은 평가영역·평가기준·항목별 점수, 3열부터 출판사. 마지막 두 줄은 합계와 종합의견
  const nPub = colCnt - 3
  const sumRow = rowCnt - 2
  if (nPub < 1 || sumRow < 2) return { error: `평가표의 칸 수가 맞지 않습니다 (${rowCnt}줄 × ${colCnt}열).` }
  if (!at(sumRow, 0).replace(/\s/g, '').startsWith('합계')) {
    return { error: '평가표의 합계 줄을 찾지 못했습니다. 한글에서 줄을 더하거나 지우셨다면 PDF 로 올려 주세요.' }
  }

  const num = (s: string) => {
    const n = Number(s.replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  const publisherNames: string[] = []
  const publisherPrices: string[] = []
  const totals: number[] = []
  for (let i = 0; i < nPub; i++) {
    publisherNames.push(normalize(at(0, 3 + i)))
    publisherPrices.push(normalize(at(1, 3 + i)))
    totals.push(num(at(sumRow, 3 + i)))
  }

  const criteria = []
  const scores: number[][] = []
  let area = ''
  for (let r = 2; r < sumRow; r++) {
    // 평가영역은 여러 줄에 걸친 칸이라 첫 줄에만 글자가 있다 — 비어 있으면 위 줄 것을 잇는다
    const a = normalize(at(r, 0))
    if (a) area = a
    criteria.push({ area, text: normalize(at(r, 1)), points: num(at(r, 2)) })
    scores.push(Array.from({ length: nPub }, (_, i) => num(at(r, 3 + i))))
  }

  const paras = paragraphTexts(xml)
  const head = paras.find((t) => /과\s*목\s*[:：]/.test(t)) || ''
  const subjectName = normalize((head.match(/과\s*목\s*[:：]\s*(.+?)\s+과\s+위\s*원/) || head.match(/과\s*목\s*[:：]\s*(.+?)\s+위\s*원/) || [])[1] || '')
  const teacherName = normalize((head.match(/위\s*원\s*[:：]\s*(.+?)\s*\(\s*인\s*\)/) || [])[1] || '')

  // 종합의견 칸은 '<종합의견 및 추천의견>' 머리글 다음 줄부터다
  const opinionCell = at(rowCnt - 1, 0)
  const summaryOpinion = normalize(opinionCell.replace(/^[\s\S]*?종합의견 및 추천의견>?\s*/, ''))

  const warnings: string[] = []
  publisherNames.forEach((v, i) => {
    if (!v) {
      publisherNames[i] = `출판사${i + 1}`
      warnings.push(`${i + 1}번째 출판사 이름이 비어 있어 임시 이름을 넣었습니다.`)
    }
  })
  if (!teacherName) warnings.push('위원 이름을 읽지 못했습니다.')

  return {
    parsed: { subjectName, teacherName, publisherNames, publisherPrices, totals, criteria, scores, summaryOpinion, warnings },
  }
}
