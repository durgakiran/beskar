// Synthetic local fixtures only. Never proxy real sessions or credentials.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');
const root = resolve(process.argv[2] || fileURLToPath(new URL('../../../output/security-smoke', import.meta.url)));
const headers = await readFile(resolve(root, '_headers'), 'utf8');
const policy = headers.split('\n').find(line => line.includes('Content-Security-Policy:')).split('Content-Security-Policy: ')[1];
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', policy);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/v1/security-fixture/image') {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="royalblue"/></svg>'); return;
    }
    if (path === '/api/v1/security-fixture/attachment') {
        res.setHeader('Content-Type', 'text/plain'); res.end('Synthetic attachment fixture.'); return;
    }
    if (path === '/fixture-worker.js') {
        res.setHeader('Content-Type', 'application/javascript'); res.end("postMessage('ready')"); return;
    }
    const file = resolve(root, '.' + (path === '/' ? '/tests/security-smoke/index.html' : path));
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    try { const bytes = await readFile(file); res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); res.end(bytes); }
    catch { res.writeHead(404).end(); }
});
const sockets = new WebSocketServer({ server, path: '/ws' });
sockets.on('connection', socket => {
    socket.topics = [];
    socket.on('message', bytes => {
        const text = bytes.toString();
        const message = JSON.parse(text);
        if (message.type === 'subscribe') socket.topics = message.topics;
        if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
        if (message.type === 'publish') for (const peer of sockets.clients)
            if (peer !== socket && peer.readyState === 1 && peer.topics.includes(message.topic)) peer.send(text);
    });
});
server.listen(4179, '127.0.0.1', () => console.log('Synthetic SEC-09 fixture: http://localhost:4179/'));
