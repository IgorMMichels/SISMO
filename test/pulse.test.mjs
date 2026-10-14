import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseFeed, sources } from '../src/news.mjs'
import { PulseEngine } from '../src/engine.mjs'
import { loadConfig } from '../src/config.mjs'
import { createPulseService } from '../src/server.mjs'
import { drainQueue } from '../src/delivery.mjs'

const xmlEscape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
const rss = (title, host = 'coindesk.com', date = new Date().toUTCString(), url = `https://${host}/news/example`) => `<?xml version="1.0"?><rss version="2.0"><channel><item><title>${xmlEscape(title)}</title><link>${url}</link><pubDate>${date}</pubDate><description><![CDATA[<p>Bitcoin &amp; Ethereum market context.</p>]]></description></item></channel></rss>`

async function fixture(t, overrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'omega-bots-test-'))
  t.after(async () => {
    const checked = resolve(dataDir)
    assert.ok(checked.startsWith(resolve(tmpdir(), 'omega-bots-test-')))
    await rm(checked, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const config = loadConfig({ DATA_DIR: dataDir, ...overrides })
  let title = 'SEC publishes new Bitcoin ETF regulation'
  let rate = 0.0001
  let offline = false
  let discordFail = false
  const calls = []
  const fetchImpl = async (url, options) => {
    const text = String(url)
    if (text.includes('discord.com/api/webhooks')) {
      calls.push({ platform: 'discord', body: JSON.parse(options.body) })
      return discordFail ? new Response('{}', { status: 429, headers: { 'retry-after': '120' } }) : Response.json({ id: 'discord-msg' })
    }
    if (text.includes('api.telegram.org')) { calls.push({ platform: 'telegram', body: JSON.parse(options.body) }); return Response.json({ ok: true, result: { message_id: 123 } }) }
    if (offline) throw new Error('network down')
    const source = sources.find((row) => row.url === text)
    if (source) return new Response(rss(title, source.host))
    const asset = new URL(text).searchParams.get('symbol')
    return Response.json({ symbol: asset, markPrice: '60000', lastFundingRate: String(rate), nextFundingTime: Date.now() + 3600_000, time: Date.now() })
  }
  const engine = new PulseEngine(config, { fetchImpl })
  await engine.init()
  return { config, engine, calls, fetchImpl, dataDir, setTitle: (value) => { title = value }, setRate: (value) => { rate = value }, setOffline: (value) => { offline = value }, setDiscordFail: (value) => { discordFail = value } }
}

test('RSS preserva texto, limpa HTML, classifica ativos e deduplica por título normalizado', () => {
  const first = parseFeed(rss('Bitcoin & Ethereum: SEC regulation'), sources[0])[0]
  const second = parseFeed(rss('Bitcoin & Ethereum: SEC regulation', sources[1].host), sources[1])[0]
  assert.equal(first.id, second.id)
  assert.equal(first.summary, 'Bitcoin & Ethereum market context.')
  assert.equal(first.category, 'Regulação')
  assert.deepEqual(first.assets, ['BTC', 'ETH'])
})
test('RSS rejeita URL externa, data futura, item antigo e DOCTYPE', () => {
  assert.throws(() => parseFeed(rss('Bitcoin', 'coindesk.com', new Date().toUTCString(), 'https://coindesk.com.evil.test/story'), sources[0]))
  assert.throws(() => parseFeed(rss('Bitcoin', 'coindesk.com', new Date(Date.now() + 86400_000).toUTCString()), sources[0]))
  assert.throws(() => parseFeed(rss('Bitcoin', 'coindesk.com', new Date(Date.now() - 8 * 86400_000).toUTCString()), sources[0]))
  assert.throws(() => parseFeed('<!DOCTYPE rss><rss/>', sources[0]))
})
test('Feed amplo do Decrypt exclui notícia de IA sem contexto de cripto', () => {
  const xml = rss('A new AI chatbot launches', 'decrypt.co').replace('Bitcoin &amp; Ethereum market context.', 'Artificial intelligence and software tools.')
  assert.throws(() => parseFeed(xml, sources[2]), /sem notícias recentes/)
})
test('Primeiro ciclo cria linha de base, agrega os feeds sem duplicar e não envia histórico', async (t) => {
  const f = await fixture(t, { DELIVERY_ENABLED: 'true', DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/fake-token', TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'test-chat' })
  await f.engine.cycle()
  assert.equal(f.engine.state.news.length, 1)
  assert.equal(f.engine.state.funding.length, 3)
  assert.equal(f.calls.length, 0)
  assert.equal(f.engine.state.sources.filter((row) => row.status === 'live').length, sources.length)
  assert.equal(f.engine.state.news[0].verification.outlets, Math.min(sources.length, 12))
  assert.equal(f.engine.state.news[0].verification.score, null)
  const publicData = JSON.stringify(f.engine.snapshot())
  assert.ok(!publicData.includes('fake-token'))
  assert.ok(!publicData.includes('test-chat'))
})
test('Notícia nova chega aos dois canais uma vez, sem menções do Discord', async (t) => {
  const f = await fixture(t, { DELIVERY_ENABLED: 'true', DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/fake-token', TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'test-chat' })
  await f.engine.cycle()
  f.setTitle('SEC changes Bitcoin regulation @everyone')
  await f.engine.cycle()
  await f.engine.cycle()
  assert.equal(f.calls.filter((row) => row.platform === 'discord').length, 1)
  assert.equal(f.calls.filter((row) => row.platform === 'telegram').length, 1)
  assert.deepEqual(f.calls[0].body.allowed_mentions.parse, [])
  assert.ok(f.calls[1].body.text.includes('Não é recomendação'))
})
test('Falha no Discord não bloqueia Telegram; retry sobrevive ao reinício sem duplicar o canal bem-sucedido', async (t) => {
  const f = await fixture(t, { DELIVERY_ENABLED: 'true', DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/fake-token', TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'test-chat' })
  await f.engine.cycle()
  f.setDiscordFail(true)
  f.setTitle('New SEC Bitcoin regulation update')
  await f.engine.cycle()
  assert.equal(f.engine.state.queue.length, 1)
  assert.equal(f.engine.state.queue[0].platform, 'discord')
  const resumed = new PulseEngine(f.config, { fetchImpl: f.fetchImpl })
  await resumed.init()
  assert.equal(resumed.state.queue.length, 1)
  f.setDiscordFail(false)
  await drainQueue(resumed.state, f.config, f.fetchImpl, resumed.state.queue[0].nextAttemptAt)
  assert.equal(resumed.state.queue.length, 0)
  assert.equal(f.calls.filter((row) => row.platform === 'telegram').length, 1)
  assert.equal(f.calls.filter((row) => row.platform === 'discord').length, 2)
})
test('Funding só alerta ao cruzar limiar; não repete enquanto continua elevado', async (t) => {
  const f = await fixture(t, { DELIVERY_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'test-chat' })
  await f.engine.cycle()
  f.setRate(0.0012)
  await f.engine.cycle()
  await f.engine.cycle()
  assert.equal(f.calls.length, 3)
  assert.ok(f.calls.every((row) => row.body.text.includes('Funding elevado')))
  f.setRate(-0.0013)
  await f.engine.cycle()
  assert.equal(f.calls.length, 6)
})
test('Indisponibilidade das fontes preserva dados e horários anteriores', async (t) => {
  const f = await fixture(t)
  await f.engine.cycle()
  const previous = JSON.stringify(f.engine.state.news)
  const fundingAt = f.engine.state.funding[0].observedAt
  f.setOffline(true)
  await f.engine.cycle()
  assert.equal(JSON.stringify(f.engine.state.news), previous)
  assert.equal(f.engine.state.funding[0].observedAt, fundingAt)
  assert.equal(f.engine.state.sources.every((row) => row.status === 'error'), true)
  assert.equal(f.engine.state.fundingSources.every((row) => row.status === 'error'), true)
})
test('Demonstração não acessa rede, não altera arquivo real e nunca envia', async (t) => {
  const f = await fixture(t, { DEMO_MODE: 'true', DELIVERY_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'test-chat' })
  await f.engine.cycle()
  assert.equal(f.engine.snapshot().mode, 'demo')
  assert.equal(f.calls.length, 0)
  await assert.rejects(readFile(join(f.dataDir, 'state.json'), 'utf8'), { code: 'ENOENT' })
})
test('Estado corrompido impede início silencioso que poderia reenviar alertas', async (t) => {
  const f = await fixture(t)
  await writeFile(join(f.dataDir, 'state.json'), '{invalid')
  await assert.rejects(new PulseEngine(f.config).init(), /Preserve o arquivo/)
})
test('Falha ao salvar a fila pausa envio, e recuperação retoma a entrega', async (t) => {
  const f = await fixture(t, { DELIVERY_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'test-chat' })
  await f.engine.cycle()
  const blocked = join(f.dataDir, 'blocked')
  await writeFile(blocked, 'not a directory')
  f.engine.config.dataDir = blocked
  f.setTitle('SEC introduces new crypto regulation')
  await f.engine.cycle()
  assert.equal(f.calls.length, 0)
  assert.equal(f.engine.snapshot().persistenceHealthy, false)
  assert.equal(f.engine.state.queue.length, 1)
  f.engine.config.dataDir = f.dataDir
  await f.engine.cycle()
  assert.equal(f.calls.length, 1)
  assert.equal(f.engine.snapshot().persistenceHealthy, true)
})
test('Configuração rejeita intervalo excessivo, wildcard CORS e webhook fora do Discord', () => {
  assert.throws(() => loadConfig({ COLLECTION_INTERVAL_SECONDS: '1' }))
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS: '*' }))
  assert.throws(() => loadConfig({ DISCORD_WEBHOOK_URL: 'https://evil.test/api/webhooks/123/token' }))
})
test('API oferece snapshot e SSE, aplica CORS e recusa escrita', async (t) => {
  const f = await fixture(t, { DEMO_MODE: 'true' })
  const service = await createPulseService(f.config, { autoCollect: false })
  await service.engine.cycle()
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve))
  t.after(() => service.stop())
  const base = `http://127.0.0.1:${service.server.address().port}`
  const response = await fetch(`${base}/api/pulse`, { headers: { Origin: 'http://localhost:5173' } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.equal((await response.json()).mode, 'demo')
  assert.equal((await fetch(`${base}/api/pulse`, { headers: { Origin: 'https://evil.test' } })).status, 403)
  assert.equal((await fetch(`${base}/api/pulse`, { method: 'POST' })).status, 405)
  assert.equal((await (await fetch(`${base}/health`)).json()).status, 'ok')
  const stream = await fetch(`${base}/api/stream`)
  assert.equal(stream.headers.get('content-type'), 'text/event-stream')
  const reader = stream.body.getReader()
  const first = await reader.read()
  assert.ok(new TextDecoder().decode(first.value).includes('event: pulse'))
  await reader.cancel()
})

test('SSE mantém a conexão para dois snapshots maiores que o buffer HTTP padrão', async (t) => {
  const f = await fixture(t, { DEMO_MODE: 'true' })
  const service = await createPulseService(f.config, { autoCollect: false })
  await service.engine.cycle()
  const sample = service.engine.state.news[0]
  service.engine.state.news = Array.from({ length: 300 }, (_, index) => ({ ...sample, id: `large-${index}`, title: `Notícia fictícia ${index}`, summary: 'Trecho fictício para testar transporte de dados. '.repeat(10) }))
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve))
  t.after(() => service.stop())
  const stream = await fetch(`http://127.0.0.1:${service.server.address().port}/api/stream`, { signal: AbortSignal.timeout(5000) })
  const reader = stream.body.getReader(), decoder = new TextDecoder()
  const readEvent = async () => {
    let text = ''
    while (!text.includes('\n\n')) { const { done, value } = await reader.read(); assert.equal(done, false); text += decoder.decode(value, { stream: true }) }
    const line = text.split('\n').find((row) => row.startsWith('data: '))
    return JSON.parse(line.slice(6))
  }
  assert.equal((await readEvent()).news.length, 300)
  service.engine.state.news[0].title = 'Segundo snapshot fictício'
  service.engine.onUpdate(service.engine.snapshot())
  assert.equal((await readEvent()).news[0].title, 'Segundo snapshot fictício')
  await reader.cancel()
})

test('Resumo diário sai uma vez por dia nos dois canais; alerta por importância fora das categorias', async (t) => {
  const f = await fixture(t, { DELIVERY_ENABLED: 'true', DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/fake-token', TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'test-chat', NEWS_ALERT_CATEGORIES: 'Tecnologia' })
  await f.engine.cycle()
  f.engine.config.briefHour = 0
  await f.engine.cycle()
  await f.engine.cycle()
  const digests = f.calls.filter((row) => (row.body.embeds?.[0]?.title ?? row.body.text).includes('Resumo diário'))
  assert.equal(digests.length, 2)
  assert.equal(f.calls.filter((row) => row.platform === 'telegram')[0].body.parse_mode, 'HTML')
  assert.ok(digests.find((row) => row.platform === 'discord').body.embeds[0].fields.length >= 1)
  f.setTitle('SEC changes Bitcoin regulation again')
  await f.engine.cycle()
  assert.equal(f.calls.filter((row) => row.platform === 'telegram' && row.body.text.includes('SEC changes Bitcoin')).length, 1)
})
