import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { extractDocument, htmlToText, paginate, UnsupportedDocumentError } from '../src/main/agent/documents'
import { isInside, searchDocuments } from '../src/main/agent/docSearch'

let dir = ''
const at = (name: string): string => join(dir, name)

/** PDF minimal valide (une page, police standard), avec une table xref exacte. */
function makePdf(lines: string[]): Buffer {
  const content = lines.length ? `BT /F1 14 Tf 72 720 Td ${lines.map((l, i) => `${i ? '0 -20 Td ' : ''}(${l}) Tj`).join(' ')} ET` : ''
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

async function makeDocx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>Contrat de location</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Le loyer mensuel est de 850 euros.</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Charges</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>60</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:body></w:document>'
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function makePptx(): Promise<Buffer> {
  const zip = new JSZip()
  const slide = (text: string): string =>
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  zip.file('ppt/slides/slide1.xml', slide('Bilan du trimestre'))
  zip.file('ppt/slides/slide2.xml', slide('Objectifs &amp; prochaines étapes'))
  zip.file('ppt/slides/slide10.xml', slide('Annexe'))
  zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId2" Target="../notesSlides/notesSlide1.xml"/></Relationships>')
  zip.file('ppt/notesSlides/notesSlide1.xml', '<p:notes><a:p><a:r><a:t>Insister sur la marge</a:t></a:r></a:p></p:notes>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'compi-docs-'))
  writeFileSync(at('rapport.pdf'), makePdf(['Rapport annuel', 'Chiffre d affaires : 1,2 million']))
  writeFileSync(at('scan.pdf'), makePdf([]))
  writeFileSync(at('contrat.docx'), await makeDocx())
  writeFileSync(at('slides.pptx'), await makePptx())
  writeFileSync(at('notes.txt'), 'Penser à appeler le plombier jeudi.')
  writeFileSync(at('ancien.doc'), 'binaire')

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Ventes')
  ws.addRow(['Mois', 'Montant'])
  ws.addRow(['Janvier', 1200])
  ws.addRow(['Février', 1800])
  ws.addRow(['Total', { formula: 'B2+B3', result: 3000 }])
  await wb.xlsx.writeFile(at('ventes.xlsx'))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('extractDocument', () => {
  it('lit le texte d’un PDF, page par page', async () => {
    const doc = await extractDocument(at('rapport.pdf'))
    expect(doc.info).toBe('PDF · 1 page')
    expect(doc.text).toContain('--- Page 1 ---')
    expect(doc.text).toContain('Rapport annuel')
    expect(doc.scanned).toBe(false)
  })

  it('repère un PDF sans couche texte (scan)', async () => {
    expect((await extractDocument(at('scan.pdf'))).scanned).toBe(true)
  })

  it('lit un document Word, tableaux compris', async () => {
    const doc = await extractDocument(at('contrat.docx'))
    expect(doc.text).toContain('Contrat de location')
    expect(doc.text).toContain('850 euros')
    expect(doc.text).toMatch(/Charges \| 60/)
  })

  it('lit un classeur Excel et garde la valeur calculée des formules', async () => {
    const doc = await extractDocument(at('ventes.xlsx'))
    expect(doc.text).toContain('Feuille « Ventes »')
    expect(doc.text).toContain('Février | 1800')
    expect(doc.text).toContain('Total | 3000')
  })

  it('lit un PowerPoint dans l’ordre des diapositives, avec les notes', async () => {
    const doc = await extractDocument(at('slides.pptx'))
    expect(doc.pages).toBe(3)
    expect(doc.text.indexOf('Objectifs & prochaines étapes')).toBeLessThan(doc.text.indexOf('Annexe'))
    expect(doc.text).toContain('[Notes] Insister sur la marge')
  })

  it('refuse les anciens formats Office avec une consigne claire', async () => {
    await expect(extractDocument(at('ancien.doc'))).rejects.toBeInstanceOf(UnsupportedDocumentError)
    await expect(extractDocument(at('ancien.doc'))).rejects.toThrow(/\.docx/)
  })
})

describe('outils de texte', () => {
  it('convertit le HTML en texte lisible', () => {
    expect(htmlToText('<h2>Titre</h2><p>Un &amp; deux</p><ul><li>A</li><li>B</li></ul>')).toBe('## Titre\n\nUn & deux\n\n- A\n- B')
  })

  it('découpe les longs textes en parties', () => {
    expect(paginate('abcdef', 2, 4)).toEqual({ chunk: 'ef', part: 2, parts: 2 })
    expect(paginate('abc', 9, 4).part).toBe(1)
  })
})

describe('recherche dans les documents', () => {
  it('trouve un mot à l’intérieur d’un Word, sans tenir compte des accents', async () => {
    const { hits } = await searchDocuments([dir], 'LOYER mensuel')
    expect(hits[0].file).toContain('contrat.docx')
    expect(hits[0].snippets.join(' ')).toContain('850 euros')
  })

  it('cherche aussi dans les tableurs et les PDF', async () => {
    expect((await searchDocuments([dir], 'février')).hits.map((h) => h.file)).toContain(at('ventes.xlsx'))
    expect((await searchDocuments([dir], 'annuel')).hits.map((h) => h.file)).toContain(at('rapport.pdf'))
  })

  it('isInside ne laisse pas sortir d’un dossier', () => {
    expect(isInside(join(dir, 'a', 'b.txt'), dir)).toBe(true)
    expect(isInside(join(dir, '..', 'autre.txt'), dir)).toBe(false)
    expect(isInside(`${dir}-voisin`, dir)).toBe(false)
  })
})
