import test from 'node:test'
import assert from 'node:assert/strict'
import { nicheOf } from '../src/niche.mjs'
import { normalized, categoryOf, parseFeed, sources } from '../src/news.mjs'
import { assessNews, ruleImportance } from '../src/assessment.mjs'
import { selectDigest } from '../src/digest.mjs'
import { digestMessage, newsMessage, telegramText, discordPayload } from '../src/delivery.mjs'

const now = Date.now()
const item = (id, overrides = {}) => ({ id, title: 'Bitcoin ETF sees record inflows', summary: 'Funds report demand.', sourceId: 'coindesk', source: 'CoinDesk', url: `https://coindesk.com/${id}`, publishedAt: new Date(now - 3600_000).toISOString(), assets: ['BTC'], category: 'Institucional', language: 'en', region: 'Exterior', ...overrides })
const assessed = (rows) => assessNews(rows.map((row) => ({ ...row, ...nicheOf(normalized(`${row.title} ${row.summary}`)) })), now)

test('Nicho reconhece memecoins, futuros e segurança em inglês, português e espanhol', () => {
  assert.equal(nicheOf(normalized('Pump.fun memecoin launch drains wallets')).module, 'Memecoins')
  assert.equal(nicheOf(normalized('Liquidações em contratos futuros de Bitcoin superam US$ 1 bilhão')).module, 'Futuros')
  assert.equal(nicheOf(normalized('Aumenta el interés abierto en futuros perpetuos')).module, 'Futuros')
  assert.ok(nicheOf(normalized('Estafa con memecoin deja miles de víctimas')).topics.includes('seguranca'))
  assert.equal(nicheOf(normalized('Bitcoin rally breaks all-time high')).module, 'Trading')
  assert.equal(nicheOf(normalized('Central bank publishes annual report')).module, 'Fundamentos')
  assert.equal(categoryOf('Golpe com memecoin rouba carteiras'), 'Segurança')
  assert.equal(categoryOf('Meme coin PEPE jumps 20%'), 'Memecoins')
})

test('Previsão de preço e promessa de ganho são ruído: nota 2, fora do digest', () => {
  const rows = assessed([item('hype', { title: 'Dogecoin price prediction: DOGE to the moon', category: 'Memecoins' }), item('real', { title: 'SEC sues exchange over unregistered tokens', category: 'Regulação' })])
  assert.equal(rows[0].importance.score, 2)
  assert.equal(rows[1].importance.score, 7)
  const names = selectDigest(rows, now).flatMap((section) => section.items.map((row) => row.id))
  assert.deepEqual(names, ['real'])
})

test('Importância por regras prioriza o que protege o aluno e explica o motivo', () => {
  assert.equal(ruleImportance(item('s', { title: 'Rug pull on new Solana memecoin', category: 'Segurança' })).score, 7)
  assert.equal(ruleImportance(item('f', { title: 'Futures liquidations jump', category: 'Futuros' })).score, 6)
  assert.equal(ruleImportance(item('m', { title: 'Meme coin community grows', category: 'Memecoins' })).score, 5)
  assert.ok(ruleImportance(item('x', { title: 'Hackers drain exchange', category: 'Segurança' })).reason.length > 20)
})

test('Digest limita seções, mistura idiomas e usa a tradução em português', () => {
  const rows = assessed([
    item('a', { title: 'Hack drains lending protocol', category: 'Segurança' }),
    item('b', { title: 'Futures open interest hits record', category: 'Futuros' }),
    item('c', { title: 'Futuros: liquidaciones récord en Bitcoin', category: 'Futuros', language: 'es', sourceId: 'criptonoticias', source: 'CriptoNoticias', url: 'https://www.criptonoticias.com/c' }),
    item('d', { title: 'Futures traders brace for volatility', category: 'Futuros' }),
    item('e', { title: 'Perpetual futures funding rate turns negative', category: 'Futuros' }),
    item('f', { title: 'CVM publica regra para corretoras', category: 'Regulação', language: 'pt-BR', region: 'Brasil', sourceId: 'livecoins', source: 'Livecoins', url: 'https://livecoins.com.br/f' }),
  ])
  rows[0].translation = { title: 'Ataque hacker drena protocolo de empréstimo', summary: '' }
  const sections = selectDigest(rows, now, { limit: 10, perSection: 3 })
  assert.ok(sections.every((section) => section.items.length <= 3))
  assert.equal(sections.find((section) => section.name === 'Futuros').items.length, 3)
  assert.equal(sections[0].name, 'Segurança')
  const message = digestMessage('2026-10-14', sections, [{ asset: 'BTC', rate: 0.0001 }], new Date(now).toISOString(), 'texto')
  assert.equal(message.sections[0].items[0].title, 'Ataque hacker drena protocolo de empréstimo')
  assert.ok(message.sections.flatMap((section) => section.items).some((row) => row.flag === '🇧🇷'))
})

test('Telegram usa HTML escapado e cabe em 4096; Discord respeita limites de campo', () => {
  const rows = assessed(Array.from({ length: 12 }, (_, index) => item(`n${index}`, { title: `Futuros <b>${index}</b> & ${'muito longo '.repeat(20)}`, category: 'Futuros' })))
  const message = digestMessage('2026-10-14', selectDigest(rows, now, { limit: 20, perSection: 20 }), [{ asset: 'ETH', rate: -0.0002 }], new Date(now).toISOString(), '')
  const text = telegramText(message)
  assert.ok(text.length <= 4096)
  assert.ok(!text.includes('<b>0</b>') && text.includes('&lt;b&gt;'))
  assert.match(text, /Não é recomendação/)
  const payload = discordPayload(message)
  assert.ok(payload.embeds[0].fields.every((field) => field.value.length <= 1024))
  assert.deepEqual(payload.allowed_mentions.parse, [])
})

test('Alerta de notícia traduzida mostra bandeira, título em português e o original', () => {
  const row = assessed([item('t', { title: 'SEC approves new rule', category: 'Regulação', language: 'es', sourceId: 'criptonoticias', source: 'CriptoNoticias', url: 'https://www.criptonoticias.com/t' })])[0]
  row.translation = { title: 'SEC aprova nova regra', summary: 'Resumo em português.' }
  const message = newsMessage(row)
  assert.equal(message.title, 'SEC aprova nova regra')
  assert.match(message.summary, /Tradução automática\. Manchete original \(espanhol\): SEC approves new rule/)
  const text = telegramText(message)
  assert.ok(text.startsWith('<b>🇪🇸 SEC aprova nova regra</b>'))
})

test('Fontes novas em espanhol entram com idioma e ativos corretos', () => {
  const es = sources.find((row) => row.id === 'criptonoticias')
  const xml = `<rss><channel><item><title>Bitcoin sube tras decisión de la Reserva Federal</title><link>https://www.criptonoticias.com/mercados/nota/</link><pubDate>${new Date().toUTCString()}</pubDate><description>El bitcoin y el ether reaccionan.</description></item></channel></rss>`
  const [parsed] = parseFeed(xml, es)
  assert.equal(parsed.language, 'es')
  assert.equal(parsed.module, 'Fundamentos')
  assert.deepEqual(parsed.assets, ['BTC', 'ETH'])
})
