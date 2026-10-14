import { collectNews, sources, relevantNews } from './news.mjs'
import { collectFunding } from './funding.mjs'
import { loadState, saveState } from './store.mjs'
import { destinationKey, digestMessage, drainQueue, fundingMessage, newsMessage, platforms, disclaimer } from './delivery.mjs'
import { displayTitle, flagOf, selectDigest } from './digest.mjs'
import { publicError } from './network.mjs'
import { assessNews, enrichWithAi, mergeNews } from './assessment.mjs'

const iso = (time) => new Date(time).toISOString()
const extreme = (rate, threshold) => Math.abs(rate) >= threshold ? Math.sign(rate) : 0

export function makeBrief(news, funding, now = Date.now(), mode = 'live', limit = 10) {
  const sections = selectDigest(news, now, { limit })
  const lines = [mode === 'demo' ? 'Resumo de demonstração · Omega' : 'Resumo do radar · Omega', '', `Atualizado: ${iso(now)}`, '']
  for (const section of sections) {
    lines.push(`${section.emoji} ${section.label}`, ...section.items.map((item) => `• ${flagOf(item.language)} ${displayTitle(item)} (${item.source})${item.importance ? ` · Importância ${item.importance.score}/10 (${item.importance.method === 'ai' ? 'IA' : 'regras'})` : ''}
${item.url}`), '')
  }
  if (!sections.length) lines.push('Nenhuma notícia recente disponível.', '')
  lines.push('Funding de contratos perpétuos', ...funding.map((item) => `• ${item.asset}: ${(item.rate * 100).toFixed(4)}% · ${item.exchange} · observado ${item.observedAt}`), '', 'Manchetes originais e taxas da fonte. Nenhuma checagem independente de veracidade foi realizada.', '', disclaimer)
  return lines.join('\n')
}
export class PulseEngine {
  constructor(config, { fetchImpl = fetch, onUpdate = () => {} } = {}) {
    this.config = config
    this.fetchImpl = fetchImpl
    this.onUpdate = onUpdate
    this.busy = false
    this.lastPersistenceError = null
    this.nextCycleAt = null
    this.startedAt = iso(Date.now())
  }
  async init() { this.state = await loadState(this.config.dataDir) }
  snapshot() {
    const now = Date.now()
    const state = this.state
    return {
      version: 1, mode: this.config.demo ? 'demo' : 'live', startedAt: this.startedAt,
      lastCycleAt: state.lastCycleAt, nextCycleAt: this.nextCycleAt,
      intervalSeconds: this.config.intervalSeconds,
      stale: !state.lastCycleAt || now - Date.parse(state.lastCycleAt) > this.config.intervalSeconds * 3000 || !state.sources.some((source) => source.lastSuccessAt && now - Date.parse(source.lastSuccessAt) <= this.config.intervalSeconds * 3000),
      persistenceHealthy: !this.lastPersistenceError,
      news: state.news, funding: state.funding,
      newsAnalysis: { enabled: this.config.newsAiEnabled && !this.config.demo, configured: Boolean(this.config.newsAiKey), model: this.config.newsAiModel, status: this.config.demo || !this.config.newsAiEnabled ? 'disabled' : !this.config.newsAiKey ? 'not_configured' : state.newsAnalysis?.status ?? 'waiting', lastSuccessAt: state.newsAnalysis?.lastSuccessAt ?? null, error: state.newsAnalysis?.error ?? null },
      sources: state.sources, fundingSources: state.fundingSources ?? [],
      fundingThresholdPercent: this.config.fundingThreshold * 100,
      brief: makeBrief(state.news, state.funding, now, this.config.demo ? 'demo' : 'live', this.config.digestItems),
      channels: platforms.map((platform) => {
        const configured = Boolean(destinationKey(this.config, platform))
        const last = state.deliveryLog.filter((row) => row.platform === platform).at(-1)
        return { platform, configured, enabled: configured && this.config.deliveryEnabled && !this.config.demo, pending: state.queue.filter((job) => job.platform === platform).length, lastStatus: last?.status ?? null, lastAttemptAt: last?.at ?? null }
      }),
    }
  }
  async cycle() {
    if (this.busy) return
    this.busy = true
    try {
      await this.collectCycle()
    } finally {
      this.busy = false
      this.onUpdate(this.snapshot())
    }
  }
  async collectCycle() {
    const now = Date.now()
    const state = this.state
    this.nextCycleAt = iso(now + this.config.intervalSeconds * 1000)
    if (this.config.demo) {
      const title = 'Demonstração: como ler uma atualização de protocolo'
      state.news = [{ id: 'demo-news', title, summary: 'Exemplo fictício para explorar os filtros, a fonte e o resumo do radar. Esta manchete não descreve um acontecimento real.', source: 'Laboratório Omega', sourceId: 'demo', url: 'https://ethereum.org/pt/', publishedAt: iso(now), assets: ['ETH'], category: 'Tecnologia' }]
      state.funding = ['BTC', 'ETH', 'SOL'].map((asset, index) => ({ asset, rate: [0.0001, -0.0002, 0.0012][index], markPrice: [65000, 2500, 150][index], observedAt: iso(now), nextFundingAt: iso(now + 3600_000), exchange: 'Dados fictícios', url: 'https://www.binance.com/en/futures/BTCUSDT' }))
      state.sources = [{ id: 'demo', name: 'Laboratório Omega', status: 'demo', lastSuccessAt: iso(now), lastAttemptAt: iso(now), error: null, itemCount: 1 }]
      state.fundingSources = []
      state.news = assessNews(state.news, now)
      state.lastCycleAt = iso(now)
      // Demonstração não altera o estado persistido nem envia aos canais.
      return
    }
    const [newsResults, fundingResult] = await Promise.all([
      Promise.allSettled(sources.map((source) => collectNews(source, this.fetchImpl, now))),
      collectFunding(this.fetchImpl),
    ])
    const messages = []
    const fresh = []
    const known = new Set(state.knownIds)
    const initialized = new Set(state.initializedSources)
    const merged = new Map(state.news.filter(relevantNews).map((item) => [item.id, item]))
    state.sources = sources.map((source, index) => {
      const result = newsResults[index]
      const previous = state.sources.find((row) => row.id === source.id)
      if (result.status === 'rejected') return { id: source.id, name: source.name, region: source.region, primary: Boolean(source.primary), status: 'error', lastAttemptAt: iso(now), lastSuccessAt: previous?.lastSuccessAt ?? null, itemCount: previous?.itemCount ?? 0, error: publicError(result.reason) }
      const first = !initialized.has(source.id)
      for (const item of result.value) {
        if (!known.has(item.id) && !first && Date.parse(item.publishedAt) >= now - 3600_000) fresh.push(item.id)
        known.add(item.id)
        merged.set(item.id, mergeNews(merged.get(item.id), item))
      }
      initialized.add(source.id)
      return { id: source.id, name: source.name, region: source.region, primary: Boolean(source.primary), status: 'live', lastAttemptAt: iso(now), lastSuccessAt: iso(now), itemCount: result.value.length, error: null }
    })
    state.news = assessNews([...merged.values()].filter((item) => Date.parse(item.publishedAt) >= now - 7 * 86400_000).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 300), now)
    // Alerta: tema configurado ou importância mínima. Previsão de preço e promessa de ganho nunca alertam.
    for (const id of new Set(fresh)) {
      const item = state.news.find((row) => row.id === id)
      if (!item || item.clickbait) continue
      if (this.config.newsCategories.includes(item.category) || (this.config.alertMinImportance >= 0 && item.importance.score >= this.config.alertMinImportance)) messages.push(newsMessage(item))
    }
    state.knownIds = [...known].slice(-5000)
    state.initializedSources = [...initialized]
    const funding = new Map(state.funding.map((item) => [item.asset, item]))
    state.fundingSources = fundingResult.assets.map((asset, index) => {
      const result = fundingResult.results[index]
      const previous = funding.get(asset)
      if (result.status === 'rejected') return { asset, status: 'error', lastSuccessAt: previous?.observedAt ?? null, error: publicError(result.reason) }
      const item = result.value
      if (previous && extreme(item.rate, this.config.fundingThreshold) !== 0 && extreme(item.rate, this.config.fundingThreshold) !== extreme(previous.rate, this.config.fundingThreshold)) messages.push(fundingMessage(item))
      funding.set(asset, item)
      return { asset, status: 'live', lastSuccessAt: item.observedAt, error: null }
    })
    state.funding = [...funding.values()]
    state.lastCycleAt = iso(now)
    const today = iso(now).slice(0, 10)
    const briefDue = this.config.digestNow || (this.config.briefHour !== -1 && new Date(now).getUTCHours() >= this.config.briefHour)
    if (briefDue && state.lastBriefDate !== today && state.sources.some((source) => source.status === 'live')) {
      const sections = selectDigest(state.news, now, { limit: this.config.digestItems })
      if (sections.length) {
        messages.push(digestMessage(today, sections, state.funding, iso(now), makeBrief(state.news, state.funding, now, 'live', this.config.digestItems)))
        state.lastBriefDate = today
      }
    }
    for (const platform of platforms) {
      const key = destinationKey(this.config, platform)
      // Cada destino inicia com uma linha de base. Trocar o canal não reenvia o histórico.
      if (!key || !this.config.deliveryEnabled) continue
      const first = state.destinations[platform] !== key
      state.destinations[platform] = key
      state.queue = state.queue.filter((job) => job.platform !== platform || job.destination === key)
      if (first) continue
      for (const message of messages) {
        if (state.queue.some((job) => job.platform === platform && job.message.id === message.id)) continue
        if (state.queue.filter((job) => job.platform === platform).length >= 100) break
        state.queue.push({ platform, destination: key, message, attempts: 0, nextAttemptAt: now, expiresAt: now + 24 * 3600_000 })
      }
    }
    const expired = state.queue.filter((job) => job.expiresAt <= now)
    for (const job of expired) state.deliveryLog.push({ id: job.message.id, platform: job.platform, at: iso(now), status: 'expired' })
    state.queue = state.queue.filter((job) => job.expiresAt > now)
    state.deliveryLog = state.deliveryLog.slice(-200)
    // Persiste a fila antes de enviar. Falha no disco pausa o envio para preservar a fila.
    try {
      await saveState(this.config.dataDir, state)
      this.lastPersistenceError = null
    } catch {
      this.lastPersistenceError = 'Falha ao persistir o estado'
      console.error('Falha ao persistir o estado; entregas pausadas neste ciclo.')
      return
    }
    await enrichWithAi(state, this.config, this.fetchImpl, now, () => saveState(this.config.dataDir, state))
    for (const job of state.queue) {
      if (job.message.module !== 'news') continue
      const item = state.news.find((row) => `news:${row.id}` === job.message.id)
      if (item) job.message = newsMessage(item)
    }
    // A nota da IA e a mensagem enriquecida também precisam estar no disco antes do envio.
    try { await saveState(this.config.dataDir, state) } catch { this.lastPersistenceError = 'Falha ao persistir a análise'; return }
    await drainQueue(state, this.config, this.fetchImpl, now)
    try { await saveState(this.config.dataDir, state) } catch { this.lastPersistenceError = 'Falha ao persistir as entregas'; console.error(this.lastPersistenceError) }
  }
}
