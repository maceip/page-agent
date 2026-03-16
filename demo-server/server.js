import { existsSync, readFileSync } from 'fs'
import { createServer } from 'http'
import { dirname, extname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = 3333

const MIME_TYPES = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.json': 'application/json',
	'.pdf': 'application/pdf',
}

const server = createServer((req, res) => {
	let filePath

	if (req.url === '/' || req.url === '/index.html') {
		filePath = join(__dirname, 'index.html')
	} else if (req.url === '/page-agent.demo.js') {
		filePath = join(__dirname, '..', 'packages', 'page-agent', 'dist', 'iife', 'page-agent.demo.js')
	} else {
		filePath = join(__dirname, req.url)
	}

	if (!existsSync(filePath)) {
		res.writeHead(404)
		res.end('Not Found')
		return
	}

	const ext = extname(filePath)
	const mime = MIME_TYPES[ext] || 'application/octet-stream'
	res.writeHead(200, { 'Content-Type': mime })
	res.end(readFileSync(filePath))
})

server.listen(PORT, '0.0.0.0', () => {
	console.log(`\n  🚀 Demo server running at http://0.0.0.0:${PORT}\n`)
	console.log(`  Accessible on LAN — other devices can connect via your local IP.\n`)
})
