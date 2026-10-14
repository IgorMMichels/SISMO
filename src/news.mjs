import { createHash } from 'node:crypto'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { requestText } from './network.mjs'
import { nicheOf } from './niche.mjs'

export const sources = [
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', host: 'coindesk.com', region: 'Exterior', language: 'en', scope: 'crypto' },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', host: 'cointelegraph.com', region: 'Exterior', language: 'en', scope: 'crypto' },
  { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed', host: 'decrypt.co', region: 'Exterior', language: 'en', scope: 'filtered' },
  { id: 'infomoney', name: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/', host: 'infomoney.com.br', region: 'Brasil', language: 'pt-BR', scope: 'economy', allowEmpty: true },
  { id: 'forbes-br', name: 'Forbes Brasil', url: 'https://forbes.com.br/forbes-money/feed/', host: 'forbes.com.br', region: 'Brasil', language: 'pt-BR', scope: 'economy', allowEmpty: true },
  { id: 'livecoins', name: 'Livecoins', url: 'https://livecoins.com.br/feed/', host: 'livecoins.com.br', region: 'Brasil', language: 'pt-BR', scope: 'crypto' },
  { id: 'portal-bitcoin', name: 'Portal do Bitcoin', url: 'https://portaldobitcoin.uol.com.br/feed/', host: 'portaldobitcoin.uol.com.br', region: 'Brasil', language: 'pt-BR', scope: 'crypto' },
  { id: 'cryptoslate', name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/', host: 'cryptoslate.com', region: 'Exterior', language: 'en', scope: 'crypto' },
  { id: 'bitcoin-magazine', name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed', host: 'bitcoinmagazine.com', region: 'Exterior', language: 'en', scope: 'crypto' },
  { id: 'theblock', name: 'The Block', url: 'https://www.theblock.co/rss.xml', host: 'theblock.co', region: 'Exterior', language: 'en', scope: 'crypto' },
  { id: 'protos', name: 'Protos', url: 'https://protos.com/feed/', host: 'protos.com', region: 'Exterior', language: 'en', scope: 'crypto' },
  { id: 'cryptopotato', name: 'CryptoPotato', url: 'https://cryptopotato.com/feed/', host: 'cryptopotato.com', region: 'Exterior', language: 'en', scope: 'crypto' },
  { id: 'newsbtc', name: 'NewsBTC', url: 'https://www.newsbtc.com/feed/', host: 'newsbtc.com', region: 'Exterior', language: 'en', scope: 'crypto' },
  { id: 'beincrypto-br', name: 'BeInCrypto Brasil', url: 'https://br.beincrypto.com/feed/', host: 'br.beincrypto.com', region: 'Brasil', language: 'pt-BR', scope: 'crypto' },
  { id: 'criptonoticias', name: 'CriptoNoticias', url: 'https://www.criptonoticias.com/feed/', host: 'criptonoticias.com', region: 'Exterior', language: 'es', scope: 'crypto' },
  { id: 'beincrypto-es', name: 'BeInCrypto en Español', url: 'https://es.beincrypto.com/feed/', host: 'es.beincrypto.com', region: 'Exterior', language: 'es', scope: 'crypto' },
  { id: 'fed', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', host: 'federalreserve.gov', region: 'Exterior', language: 'en', scope: 'macro', primary: true, allowEmpty: true },
]
export const normalized = (text) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
export const cryptoTerms = /\b(crypto\w*|cripto\w*|bitcoin|btc|ethereum|ether|eth|solana|xrp|blockchain|memecoin\w*|stablecoin\w*|defi|nfts?|web3)\b/i
export function macroNews(text) {
  const value = normalized(text)
  return /\b(dolar|dollar|usd|brl|cambio|exchange rates?|selic|fomc|federal reserve|inflacao|inflacion|inflation|interest rates?|taxas? de juros|tasas? de interes|juros|treasur\w*|politica monetaria|politica monetaria|monetary policy|reserva federal)\b/.test(value)
    || /\b(eleic\w*|election\w*|fiscal)\b/.test(value) && /\b(mercado\w*|markets?|bolsa|econom\w*|divida|debt|orcamento)\b/.test(value)
}
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: false, processEntities: true })
const list = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value]

export function plain(value) {
  const text = typeof value === 'string' ? value : typeof value?.['#text'] === 'string' ? value['#text'] : ''
  return text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}
function canonicalUrl(value, host) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !(url.hostname === host || url.hostname.endsWith(`.${host}`))) return null
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(ref|source)$/i.test(key)) url.searchParams.delete(key)
    url.hash = ''
    return url.href
  } catch { return null }
}
export function categoryOf(text) {
  const value = normalized(text)
  if (/\b(hack\w*|exploit\w*|breach\w*|stolen|drain\w*|fraud\w*|scam\w*|golpe\w*|estafa\w*|roub\w*|robo|hackeo|seguranca|seguridad|security)\b/.test(value) && !/\bsocial security\b/.test(value)) return 'Segurança'
  if (macroNews(text) && !cryptoTerms.test(text)) return 'Macroeconomia'
  if (/\b(regulat\w*|regulac\w*|sec|cvm|legislat\w*|legislac\w*|law|laws|ley|leyes|policy|court|tribunal|congress\w*|congreso|resolucao|tribut\w*)\b/.test(value)) return 'Regulação'
  const niche = nicheOf(value)
  if (niche.topics.includes('memecoins')) return 'Memecoins'
  if (niche.topics.includes('futuros')) return 'Futuros'
  if (/\b(etfs?|institution\w*|instituc\w*|banks?|bancos?|funds?|fundos?|fondos?)\b/.test(value)) return 'Institucional'
  if (/\b(protocol\w*|protocolo\w*|network|rede|red|upgrade\w*|atualizac\w*|actualizac\w*|blockchain)\b/.test(value)) return 'Tecnologia'
  return 'Mercado'
}
export function assetsOf(text) {
  const patterns = { BTC: /\b(bitcoins?|btc)\b/i, ETH: /\b(ethereum|ether|eth)\b/i, SOL: /\b(solana|sol)\b/i, DOGE: /\b(doge|dogecoin)\b/i, XRP: /\b(xrp|ripple)\b/i, BNB: /\b(bnb|binance coin)\b/i, USD: /\b(dolar|dollar|usd)\b/i, BRL: /\b(brl|reais|selic)\b/i }
  return Object.entries(patterns).filter(([, pattern]) => pattern.test(normalized(text))).map(([asset]) => asset)
}
export function relevantNews(item) {
  const source = sources.find((row) => row.id === item.sourceId)
  const text = `${item.title} ${item.summary}`
  if (source?.scope === 'filtered') return cryptoTerms.test(text)
  if (source?.scope === 'economy') return cryptoTerms.test(text) || macroNews(text)
  return true
}
const nicheFields = (text) => { const { topics, module, clickbait } = nicheOf(normalized(text)); return { topics, module, clickbait } }
export function parseFeed(xml, source, now = Date.now()) {
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('XML inválido')
  const document = parser.parse(xml)
  const entries = list(document?.rss?.channel?.item ?? document?.feed?.entry)
  let validEntries = 0
  const items = entries.flatMap((raw) => {
    const title = plain(raw.title).slice(0, 240)
    const link = list(raw.link).find((value) => typeof value === 'string' || !value['@_rel'] || value['@_rel'] === 'alternate')
    const url = canonicalUrl(plain(link?.['@_href'] ?? link), source.host)
    const published = Date.parse(plain(raw.pubDate ?? raw.published ?? raw.updated))
    if (!title || !url || !Number.isFinite(published) || published > now + 5 * 60_000) return []
    validEntries += 1
    if (published < now - 7 * 86400_000) return []
    // Identifica cópias de uma mesma manchete, inclusive entre feeds.
    const key = title.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const id = createHash('sha256').update(key).digest('hex').slice(0, 24)
    const summary = plain(raw.description ?? raw.summary).slice(0, 240)
    // Fontes amplas precisam ter relação com cripto ou economia de mercado.
    if (!relevantNews({ sourceId: source.id, title, summary })) return []
    return [{ id, title, summary, url, source: source.name, sourceId: source.id, region: source.region ?? 'Exterior', language: source.language ?? 'en', primary: Boolean(source.primary), publishedAt: new Date(published).toISOString(), assets: assetsOf(`${title} ${summary}`), category: categoryOf(`${title} ${summary}`), ...nicheFields(`${title} ${summary}`) }]
  })
  if (!items.length && !(source.allowEmpty && validEntries)) throw new Error('Feed sem notícias recentes válidas')
  return items
}
export async function collectNews(source, fetchImpl = fetch, now = Date.now()) {
  const xml = await requestText(source.url, { headers: { 'User-Agent': 'OmegaMarketPulse/0.2 RSS reader', Accept: 'application/rss+xml, application/xml, text/xml' } }, fetchImpl)
  return parseFeed(xml, source, now)
}
