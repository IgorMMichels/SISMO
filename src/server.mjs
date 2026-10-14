import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { loadConfig } from './config.mjs'
import { PulseEngine } from './engine.mjs'

export async function createPulseService(config, { fetchImpl = fetch, autoCollect = true } = {}) {
  const clients = new Set()
  const engine = new PulseEngine(config, { fetchImpl, onUpdate: (snapshot) => {
    const event = `event: pulse\ndata: ${JSON.stringify(snapshot)}\n\n`
    for (const client of clients) {
      // Um snapshot grande pode exceder highWaterMark sem indicar cliente lento.
      // Aceita um evento em buffer; interrompe se o anterior ainda não escoou.
      if (client.writableNeedDrain) client.destroy()
      else client.write(event)
    }
  } })
  await engine.init()
  const server = createServer((request, response) => {
    const origin = request.headers.origin
    if (origin && !config.allowedOrigins.includes(origin)) { response.writeHead(403); response.end(); return }
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) }
    if (request.method === 'OPTIONS') { response.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' }); response.end(); return }
    if (request.method !== 'GET') { response.writeHead(405, { ...headers, Allow: 'GET, OPTIONS' }); response.end(JSON.stringify({ error: 'Somente leitura' })); return }
    const path = new URL(request.url, 'http://localhost').pathname
    if (path === '/health' || path === '/api/health') {
      const snapshot = engine.snapshot()
      const newsHealthy = snapshot.sources.some((source) => source.status === 'live' || source.status === 'demo')
      const fundingHealthy = snapshot.mode === 'demo' || snapshot.fundingSources.some((source) => source.status === 'live')
      response.writeHead(200, headers)
      response.end(JSON.stringify({ status: !snapshot.stale && newsHealthy && fundingHealthy && snapshot.persistenceHealthy ? 'ok' : 'degraded', mode: snapshot.mode, lastCycleAt: snapshot.lastCycleAt, nextCycleAt: snapshot.nextCycleAt, uptimeSeconds: Math.floor(process.uptime()), newsHealthy, fundingHealthy, persistenceHealthy: snapshot.persistenceHealthy }))
    } else if (path === '/api/pulse') {
      response.writeHead(200, headers)
      response.end(JSON.stringify(engine.snapshot()))
    } else if (path === '/api/stream') {
      if (clients.size >= 50) { response.writeHead(503, headers); response.end(JSON.stringify({ error: 'Limite de conexões atingido' })); return }
      response.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      response.write(`retry: 15000\nevent: pulse\ndata: ${JSON.stringify(engine.snapshot())}\n\n`)
      clients.add(response)
      const heartbeat = setInterval(() => { if (response.writableNeedDrain) response.destroy(); else response.write(': heartbeat\n\n') }, 15000)
      response.on('close', () => { clearInterval(heartbeat); clients.delete(response) })
    } else {
      response.writeHead(404, headers)
      response.end(JSON.stringify({ error: 'Endpoint não encontrado' }))
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  let timer
  let stopped = false
  const collect = async () => {
    try {
      await engine.cycle()
      console.log(`${new Date().toISOString()} · ${engine.state.news.length} notícias · ${engine.state.funding.length} taxas · ${engine.state.sources.filter((source) => source.status === 'error').length} fonte(s) com falha`)
    } catch { console.error('Ciclo interrompido. Será tentado novamente no próximo intervalo.') }
    if (!stopped) {
      engine.nextCycleAt = new Date(Date.now() + config.intervalSeconds * 1000).toISOString()
      timer = setTimeout(collect, config.intervalSeconds * 1000)
    }
  }
  if (autoCollect) void collect()
  return { server, engine, async stop() {
    stopped = true
    clearTimeout(timer)
    for (const client of clients) client.end()
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
  } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig()
  const service = await createPulseService(config)
  service.server.listen(config.port, config.host, () => console.log(`Market Pulse: http://${config.host}:${config.port} · ${config.demo ? 'DEMONSTRAÇÃO' : 'fontes reais'} · coleta ${config.intervalSeconds}s`))
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
    await service.stop()
    process.exit(0)
  })
  service.server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? 'A porta dos bots já está em uso.' : 'Falha ao iniciar o servidor dos bots.'); process.exit(1) })
}
