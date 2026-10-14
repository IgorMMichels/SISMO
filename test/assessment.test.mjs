import test from 'node:test'
import assert from 'node:assert/strict'
import { sources, parseFeed, categoryOf, assetsOf, relevantNews } from '../src/news.mjs'
import { assessNews, mergeNews, enrichWithAi, parseAiResponse, similarHeadlines } from '../src/assessment.mjs'
import { loadConfig } from '../src/config.mjs'
import { makeBrief } from '../src/engine.mjs'

const now = Date.now()
const article = (id = 'a', overrides = {}) => ({ id, title: 'SEC approves spot Bitcoin ETF after court ruling', summary: 'New regulation for Bitcoin funds.', sourceId: 'coindesk', source: 'CoinDesk', url: `https://coindesk.com/${id}`, publishedAt: new Date(now).toISOString(), assets: ['BTC'], category: 'Regulação', ...overrides })
const responseOf = (rows) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ assessments: rows }) }] }] })
const aiConfig = () => loadConfig({ NEWS_AI_ENABLED: 'true', OPENAI_API_KEY: 'fake-private-key', NEWS_AI_BATCH_SIZE: '2', NEWS_AI_MAX_BATCHES_PER_DAY: '1' })

test('Catálogo tem Brasil, exterior e comunicado oficial, sem URLs fora dos publicadores', () => {
  assert.equal(sources.length, 17)
  assert.equal(sources.filter((row) => row.region === 'Brasil').length, 5)
  assert.equal(new Set(sources.map((row) => row.id)).size, sources.length)
  assert.deepEqual([...new Set(sources.map((row) => row.language))].sort(), ['en', 'es', 'pt-BR'])
  assert.ok(sources.some((row) => row.primary))
  assert.ok(sources.every((row) => new URL(row.url).protocol === 'https:'))
})

test('Macroeconomia em português inclui dólar/eleições e exclui política e bilionários sem contexto', () => {
  const sourceId = 'forbes-br'
  assert.equal(relevantNews({ sourceId, title: 'Dólar desaba após primeiro turno das eleições', summary: 'Câmbio responde ao resultado.' }), true)
  assert.equal(categoryOf('Dólar desaba após primeiro turno das eleições'), 'Macroeconomia')
  assert.equal(relevantNews({ sourceId, title: 'Candidato vence eleição em cidade pequena', summary: 'Conheça o prefeito eleito.' }), false)
  assert.equal(relevantNews({ sourceId, title: 'Conheça a mansão de um bilionário', summary: 'Casa de luxo à venda.' }), false)
  assert.deepEqual(assetsOf('Selic e dólar afetam preços em reais'), ['USD', 'BRL'])
  assert.deepEqual(assetsOf('Real-world Bitcoin assets'), ['BTC'])
  assert.equal(categoryOf('CVM publica resolução para regular criptomoedas'), 'Regulação')
  assert.equal(categoryOf('Golpe rouba bitcoins de usuários'), 'Segurança')
})

test('Feed oficial sem notícias na última semana é disponível, não uma falha; XML ruim continua erro', () => {
  const fed = sources.find((row) => row.id === 'fed')
  const xml = `<rss><channel><item><title>Federal Reserve FOMC statement</title><link>https://www.federalreserve.gov/newsevents/example.htm</link><pubDate>${new Date(now - 14 * 86400_000).toUTCString()}</pubDate></item></channel></rss>`
  assert.deepEqual(parseFeed(xml, fed, now), [])
  assert.throws(() => parseFeed('<rss>', fed))
  assert.throws(() => parseFeed(xml.replace('www.federalreserve.gov', 'evil.test'), fed))
})

test('Notas são limitadas e explicáveis; macro tem relação com cripto sem promessa direcional', () => {
  const news = assessNews([article(), article('macro', { title: 'Dólar cai após eleições', summary: 'Câmbio em queda.', category: 'Macroeconomia', sourceId: 'forbes-br', source: 'Forbes Brasil', url: 'https://forbes.com.br/macro' }), article('hack', { title: 'Protocol exploit drains user funds', category: 'Segurança' })], now)
  assert.ok(news.every((row) => row.importance.score >= 0 && row.importance.score <= 10 && row.importance.reason))
  assert.equal(news[1].importance.score, 7)
  assert.equal(news[1].region, 'Brasil')
  assert.match(news[1].cryptoContext, /USD\/BRL/)
  assert.match(news[1].cryptoContext, /não determina/)
  assert.equal(news[2].importance.score, 8)
  assert.ok(news.every((row) => row.verification.score === null && row.verification.verdict === 'not_checked'))
})

test('Deduplicação preserva fontes e cache de IA; republicação não vira verdade confirmada', () => {
  const first = { ...article(), importance: { version: 1, method: 'ai', score: 8 }, cryptoContext: 'Contexto em cache.' }
  const other = article('a', { sourceId: 'cointelegraph', source: 'Cointelegraph', url: 'https://cointelegraph.com/example', summary: 'Different summary.' })
  const merged = mergeNews(first, other)
  assert.equal(merged.reports.length, 2)
  assert.equal(merged.importance.method, 'ai')
  const row = assessNews([merged], now)[0]
  assert.equal(row.verification.status, 'similar_coverage')
  assert.equal(row.verification.score, null)
  assert.match(row.verification.reason, /mesma agência/)
  const updated = mergeNews(merged, article('a', { summary: 'Correction: no approval has happened.' }))
  assert.equal(updated.importance, undefined)
  assert.equal(updated.cryptoContext, undefined)
})

test('Comunicação primária confirma origem e permanece sem veredicto sobre as alegações', () => {
  const row = assessNews([article('fed', { sourceId: 'fed', source: 'Federal Reserve', url: 'https://www.federalreserve.gov/newsevents/example.htm' })], now)[0]
  assert.equal(row.verification.status, 'primary_source')
  assert.equal(row.verification.verdict, 'not_checked')
  assert.equal(row.verification.score, null)
})

test('Similaridade é conservadora: exige conteúdo comum e janela de tempo', () => {
  const a = article()
  assert.equal(similarHeadlines(a, article('b', { title: 'SEC approves spot Bitcoin ETF after court ruling today' })), true)
  assert.equal(similarHeadlines(a, article('b', { title: 'SEC reviews Bitcoin ETF market trading volume' })), false)
  assert.equal(similarHeadlines(a, article('b', { publishedAt: new Date(now - 3 * 86400_000).toISOString() })), false)
})

test('IA desativada ou sem chave não faz chamadas; demonstração também não', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; throw new Error('must not call') }
  const state = { news: assessNews([article()], now) }
  await enrichWithAi(state, loadConfig({}), fetchImpl, now)
  await enrichWithAi(state, loadConfig({ NEWS_AI_ENABLED: 'true' }), fetchImpl, now)
  await enrichWithAi(state, { ...aiConfig(), demo: true }, fetchImpl, now)
  assert.equal(calls, 0)
})

test('IA usa lote validado, cache, limite diário persistido e não altera a apuração', async () => {
  const state = { news: assessNews([article()], now) }, config = aiConfig()
  let calls = 0, persisted = 0
  const fetchImpl = async (url, options) => {
    calls++
    assert.equal(url, 'https://api.openai.com/v1/responses')
    const body = JSON.parse(options.body)
    assert.equal(body.store, false)
    assert.equal(body.text.format.strict, true)
    assert.equal(body.tools, undefined)
    assert.match(body.instructions, /conteúdo não confiável/)
    assert.equal(persisted, 1)
    return Response.json(responseOf([{ id: 'a', score: 8, reason: 'Regra pode alterar acesso aos fundos.', cryptoContext: 'Avalie o alcance, sem previsão de preço.', titlePt: 'SEC aprova ETF de Bitcoin à vista após decisão judicial', summaryPt: 'Nova regra para fundos de Bitcoin.' }]))
  }
  await enrichWithAi(state, config, fetchImpl, now, async () => { persisted++ })
  assert.equal(state.news[0].importance.method, 'ai')
  assert.equal(state.news[0].translation.title, 'SEC aprova ETF de Bitcoin à vista após decisão judicial')
  assert.equal(state.news[0].verification.verdict, 'not_checked')
  assert.ok(!JSON.stringify(state).includes('fake-private-key'))
  await enrichWithAi(state, config, fetchImpl, now + 1000)
  assert.equal(calls, 1)
  state.news.push(...assessNews([article('b')], now))
  await enrichWithAi(state, config, fetchImpl, now + 3600_000)
  assert.equal(calls, 1)
  assert.equal(state.newsAnalysis.status, 'daily_limit')
})

test('IA incompleta, IDs trocados e nota inválida são rejeitados; erro preserva regras', async () => {
  const rows = [{ id: 'a', score: 8, reason: 'Contexto.', cryptoContext: 'Contexto cripto.', titlePt: '', summaryPt: '' }]
  assert.throws(() => parseAiResponse({ ...responseOf(rows), status: 'incomplete' }, [article()]))
  assert.throws(() => parseAiResponse(responseOf([{ ...rows[0], id: 'unknown' }]), [article()]))
  assert.throws(() => parseAiResponse(responseOf([{ ...rows[0], score: 11 }]), [article()]))
  assert.throws(() => parseAiResponse(responseOf([]), [article()]))
  assert.throws(() => parseAiResponse(responseOf([{ id: 'a', score: 8, reason: 'Contexto.', cryptoContext: 'Contexto cripto.' }]), [article()]))
  const state = { news: assessNews([article()], now) }
  await enrichWithAi(state, aiConfig(), async () => new Response('{}', { status: 401 }), now)
  assert.equal(state.newsAnalysis.status, 'error')
  assert.equal(state.newsAnalysis.error, 'HTTP 401')
  assert.equal(state.news[0].importance.method, 'rules')
})

test('Falha ao persistir a tentativa impede chamada paga e mantém a classificação por regras', async () => {
  let calls = 0
  const state = { news: assessNews([article()], now) }
  await enrichWithAi(state, aiConfig(), async () => { calls++ }, now, async () => { throw new Error('disk unavailable') })
  assert.equal(calls, 0)
  assert.equal(state.news[0].importance.method, 'rules')
})

test('Resumo seleciona maior importância e mantém indicação de ausência de checagem', () => {
  const news = [article('routine', { title: 'Market price update', summary: 'Routine prices.', category: 'Mercado' }), article('important')]
  const brief = makeBrief(assessNews(news, now), [], now)
  assert.ok(brief.indexOf('SEC approves') < brief.indexOf('Market price update'))
  assert.ok(brief.indexOf('SEC approves') > -1)
  assert.match(brief, /Importância 7\/10/)
  assert.match(brief, /Nenhuma checagem independente/)
})
