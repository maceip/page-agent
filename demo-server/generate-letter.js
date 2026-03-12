import { createWriteStream } from 'fs'
import { dirname, join } from 'path'
import PDFDocument from 'pdfkit'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputPath = join(__dirname, 'wohnungsbestaetigung.pdf')

const doc = new PDFDocument({
	size: 'A4',
	margins: { top: 50, bottom: 60, left: 70, right: 70 },
	bufferPages: true,
})

doc.pipe(createWriteStream(outputPath))

const pw = doc.page.width
const ph = doc.page.height
const cw = pw - 140
const lm = 70

// ===== Bone white background =====
doc.rect(0, 0, pw, ph).fill('#f5f0e8')

// ===== Subtle geometric accents =====
// Top-right corner: light overlapping rectangles
doc.save()
doc.opacity(0.06)
doc.rect(pw - 120, -10, 140, 80).fill('#1a3a5c')
doc.rect(pw - 80, 10, 100, 50).fill('#1a3a5c')
doc.restore()

// Left edge: thin vertical accent stripe
doc.save()
doc.opacity(0.08)
doc.rect(0, 0, 4, ph).fill('#1a3a5c')
doc.restore()

// Bottom-left: subtle diamond pattern
doc.save()
doc.opacity(0.04)
for (let i = 0; i < 3; i++) {
	const cx = 20 + i * 18
	const cy = ph - 40
	doc.save()
	doc.translate(cx, cy)
	doc.rotate(45)
	doc.rect(-6, -6, 12, 12).fill('#1a3a5c')
	doc.restore()
}
doc.restore()

// Top-left: fine horizontal lines
doc.save()
doc.opacity(0.05)
for (let i = 0; i < 5; i++) {
	doc
		.moveTo(lm, 38 + i * 3)
		.lineTo(lm + 60, 38 + i * 3)
		.lineWidth(0.5)
		.strokeColor('#1a3a5c')
		.stroke()
}
doc.restore()

// ===== Mini Bayern/Munich crest =====
const shieldX = lm
const shieldY = 52
const shieldW = 20
const shieldH = 24

doc.save()
doc
	.moveTo(shieldX, shieldY)
	.lineTo(shieldX + shieldW, shieldY)
	.lineTo(shieldX + shieldW, shieldY + shieldH * 0.65)
	.quadraticCurveTo(shieldX + shieldW / 2, shieldY + shieldH + 2, shieldX, shieldY + shieldH * 0.65)
	.closePath()
	.clip()

doc.rect(shieldX, shieldY, shieldW, shieldH).fill('#ffffff')

const dSize = 5
const cols = Math.ceil(shieldW / dSize) + 1
const rows = Math.ceil(shieldH / dSize) + 1
for (let r = 0; r < rows; r++) {
	for (let c = 0; c < cols; c++) {
		if ((r + c) % 2 === 0) {
			const dx = shieldX + c * dSize
			const dy = shieldY + r * dSize
			doc.rect(dx, dy, dSize, dSize).fill('#0a6ebd')
		}
	}
}

doc.restore()

doc
	.moveTo(shieldX, shieldY)
	.lineTo(shieldX + shieldW, shieldY)
	.lineTo(shieldX + shieldW, shieldY + shieldH * 0.65)
	.quadraticCurveTo(shieldX + shieldW / 2, shieldY + shieldH + 2, shieldX, shieldY + shieldH * 0.65)
	.closePath()
	.lineWidth(0.8)
	.strokeColor('#2c2c2c')
	.stroke()

// ===== Letterhead text =====
doc.fontSize(8).font('Helvetica').fillColor('#888888')
doc.text('Irmengard von Hagke', shieldX + shieldW + 8, shieldY + 4, { lineBreak: false })
doc.fontSize(7).fillColor('#aaaaaa')
doc.text('München', shieldX + shieldW + 8, shieldY + 15, { lineBreak: false })

// Thin separator
const sepY = shieldY + shieldH + 10
doc
	.moveTo(lm, sepY)
	.lineTo(pw - 70, sepY)
	.lineWidth(0.4)
	.strokeColor('#cccccc')
	.stroke()

// ===== Date =====
let y = sepY + 18

doc.fontSize(9).font('Helvetica').fillColor('#555555')
doc.text('München, den 10. März 2026', lm, y, { lineBreak: false })

// ===== Title =====
y += 36

doc.fontSize(14).font('Helvetica-Bold').fillColor('#2c2c2c')
doc.text('Bestätigungsschreiben', lm, y, { lineBreak: false })

y += 20
doc
	.moveTo(lm, y)
	.lineTo(lm + 130, y)
	.lineWidth(0.6)
	.strokeColor('#1a3a5c')
	.stroke()

// ===== Body =====
y += 24

const bodyOptions = { width: cw, align: 'left', lineGap: 4 }

doc.fontSize(10.5).font('Helvetica').fillColor('#2c2c2c')
doc.text(
	'Hiermit bestätige ich, Irmengard von Hagke, dass ich die Eigentümerin und Verfügungsberechtigte der 3-Zimmer-Wohnung in der Nordendstr. 59, Erdgeschoss, linker Gang hinten mittig bin.',
	lm,
	y,
	bodyOptions
)

y = doc.y + 14
doc.text('Des Weiteren bestätige ich, dass Herr ', lm, y, { ...bodyOptions, continued: true })
doc.font('Helvetica-Bold').text('Ryan MacArthur', { continued: true })
doc
	.font('Helvetica')
	.text(
		' mein rechtmäßiger Mieter ist und die oben genannte Wohnung mit meinem Einverständnis nutzt.'
	)

y = doc.y + 14
doc.text('Der Einzug erfolgte am 01. Dezember 2025.', lm, y, bodyOptions)

y = doc.y + 14
doc.text(
	'Diese Bestätigung wird auf Wunsch zur Vorlage bei entsprechenden Stellen ausgestellt.',
	lm,
	y,
	bodyOptions
)

// ===== Signature block =====
y = doc.y + 44

doc.fontSize(9).font('Helvetica-Bold').fillColor('#555555')
doc.text('Ort, Datum:', lm, y, { lineBreak: false })
y += 16
doc.fontSize(10.5).font('Helvetica').fillColor('#2c2c2c')
doc.text('München, 10.03.2026', lm, y, { lineBreak: false })

y += 34

doc.fontSize(9).font('Helvetica-Bold').fillColor('#555555')
doc.text('Unterschrift Eigentümerin:', lm, y, { lineBreak: false })
y += 18

doc.fontSize(12).font('Helvetica-Oblique').fillColor('#1a3a5c')
doc.text('gez. I. v. Hagke', lm, y, { lineBreak: false })
doc
	.moveTo(lm, y + 16)
	.lineTo(lm + 180, y + 16)
	.lineWidth(0.4)
	.strokeColor('#999999')
	.stroke()

y += 32

doc.fontSize(9).font('Helvetica-Bold').fillColor('#555555')
doc.text('Name der Eigentümerin (in Druckbuchstaben):', lm, y, { lineBreak: false })
y += 16
doc.fontSize(10.5).font('Helvetica').fillColor('#2c2c2c')
doc.text('IRMENGARD VON HAGKE', lm, y, { lineBreak: false })
doc
	.moveTo(lm, y + 14)
	.lineTo(lm + 240, y + 14)
	.lineWidth(0.4)
	.strokeColor('#999999')
	.stroke()

// ===== Footer =====
const footerY = ph - 40
doc
	.moveTo(lm, footerY)
	.lineTo(pw - 70, footerY)
	.lineWidth(0.3)
	.strokeColor('#cccccc')
	.stroke()

doc.fontSize(6.5).font('Helvetica').fillColor('#aaaaaa')
doc.text('Irmengard von Hagke  ·  München', lm, footerY + 6, { lineBreak: false })

doc.end()
console.log(`PDF generated: ${outputPath}`)
