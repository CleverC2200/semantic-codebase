#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildReaderAssetBundle } from './semantic-reader-assets.mjs';
import { renderReaderData } from './semantic-preview-explorer.mjs';
import { bindArchifyRepository, deliverReaderArchify, readArchifyReader } from './semantic-reader-archify-delivery.mjs';

export async function serveReaderArchify(input, sourceRoot, { port = 0, outputDirectory } = {}) {
  const data = bindArchifyRepository(JSON.parse(JSON.stringify(input)), sourceRoot);
  if (data.schema !== 'reader-snapshot-v1' || data.assetManifest) throw new Error('服务需要完整冻结 reader-data.json。');
  const output = outputDirectory ? resolve(outputDirectory) : mkdtempSync(join(tmpdir(), 'reader-archify-'));
  mkdirSync(output, { recursive: true });
  const token = randomBytes(24).toString('hex');
  const bundle = buildReaderAssetBundle(data), assets = new Map(bundle.assets.map(a => ['/' + a.path, a.content]));
  const model = { ...bundle.bootstrap, archifyService: { endpoint: '/archify/generate', token } };
  const page = renderReaderData(model, { source_head: data.revision, boundary: '固定本地阅读包；不执行被索引应用。' });
  const deliveries = new Map(), artifacts = new Map();
  let origin;
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self'; frame-src 'self' blob:; base-uri 'none'; form-action 'none'";
  const server = createServer(async (req, res) => {
    const send = (status, content, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(content); };
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return send(403, JSON.stringify({ error: '只接受当前本机阅读页。' }));
      const url = new URL(req.url, origin);
      if (req.method === 'GET') {
        if (url.pathname === '/') return send(200, page, 'text/html; charset=utf-8');
        if (assets.has(url.pathname)) return send(200, assets.get(url.pathname));
        if (artifacts.has(url.pathname)) return send(200, artifacts.get(url.pathname), 'text/html; charset=utf-8');
        return send(404, JSON.stringify({ error: '资源不存在。' }));
      }
      if (req.method !== 'POST' || url.pathname !== '/archify/generate' || req.headers['x-reader-token'] !== token || req.headers['content-type'] !== 'application/json') return send(403, JSON.stringify({ error: '生成请求身份不匹配。' }));
      let body = '';
      for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 4096) return send(413, JSON.stringify({ error: '请求过大。' })); }
      const request = JSON.parse(body);
      if (Object.keys(request).length !== 1 || typeof request.mainline !== 'string' || !data.mainlines.some(m => m.id === request.mainline && m.available)) return send(400, JSON.stringify({ error: '只接受固定阅读包内的可用主线 ID。' }));
      if (!deliveries.has(request.mainline)) {
        const directory = join(output, randomBytes(16).toString('hex'));
        const promise = deliverReaderArchify(data, request.mainline, directory, sourceRoot).then(result => {
          const artifactUrl = '/archify/artifact/' + result.receipt.artifact.sha256 + '.html';
          artifacts.set(artifactUrl, readFileSync(join(directory, 'diagram.html')));
          return { projection: result.projection, receipt: result.receipt, artifactUrl };
        }).catch(error => { deliveries.delete(request.mainline); throw error; });
        deliveries.set(request.mainline, promise);
      }
      return send(200, JSON.stringify(await deliveries.get(request.mainline)));
    } catch (error) { return send(400, JSON.stringify({ error: error.message })); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  origin = 'http://127.0.0.1:' + server.address().port;
  return { server, url: origin, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [readerPath, sourceRoot, portArg] = process.argv.slice(2);
  if (!readerPath || !sourceRoot) { console.error('用法：node scripts/serve-reader-archify.mjs <reader-data.json> <源码Git根目录> [端口]'); process.exitCode = 2; }
  else {
    try { const result = await serveReaderArchify(readArchifyReader(readerPath), sourceRoot, { port: portArg ? Number(portArg) : 0 }); console.log(JSON.stringify({ url: result.url, output: result.output, application_executed: false })); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
