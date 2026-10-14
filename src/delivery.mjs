import { createHash } from 'node:crypto'
import { requestText, publicError } from './network.mjs'
import { displayTitle, flagOf } from './digest.mjs'

export const disclaimer = 'Conteúdo educacional. Não é recomendação de investimento. Criptoativos e futuros envolvem riscos.'
export const platforms = ['discord', 'telegram']

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const clip = (text, size) => (text.length > size ? `${text.slice(0, size - 1).trimEnd()}…` : text)
const languageName = { 'pt-BR': 'português', es: 'espanhol', en: 'inglês' }

export function destinationKey(config, platform) {
  const secret = platform === 'discord' ? config.discordWebhook : config.telegramToken && config.telegramChatId ? `${config.telegramToken}:${config.telegramChatId}` : ''
  return secret ? createHash('sha256').update(secret).digest('hex') : null
}
export function newsMessage(item) {
  const translated = Boolean(item.translation?.title) && item.language !== 'pt-BR'
  const title = translated ? item.translation.title : item.title
  const summary = translated ? item.translation.summary || item.summary : item.summary
  const notes = [
    `Fonte: ${item.source} · Tema: ${item.category}${item.module ? ` · Módulo do curso: ${item.module}` : ''}`,
    item.importance ? `Importância: ${item.importance.score}/10 · ${item.importance.method === 'ai' ? 'estimativa por IA' : 'regras de triagem'}\n${item.importance.reason}` : '',
    item.cryptoContext ?? '',
    translated ? `Tradução automática. Manchete original (${languageName[item.language] ?? item.language}): ${item.title}` : '',
    'Manchete original; conteúdo ainda não verificado independentemente.',
  ].filter(Boolean)
  return { id: `news:${item.id}`, module: 'news', flag: flagOf(item.language), title, summary: `${summary || 'Leia a reportagem completa na fonte.'}\n\n${notes.join('\n')}`, url: item.url, timestamp: item.publishedAt }
}
export function fundingMessage(item) {
  return { id: `funding:${item.asset}:${item.observedAt}`, module: 'funding', title: `Funding elevado: ${item.asset}`, summary: `Taxa informada pela ${item.exchange}: ${(item.rate * 100).toFixed(4)}%.\n${item.rate > 0 ? 'Funding positivo: longs pagam shorts.' : 'Funding negativo: shorts pagam longs.'}\nPróxima liquidação do funding: ${item.nextFundingAt}.\nA taxa pode mudar até o próximo pagamento. Funding extremo pode persistir.`, url: item.url, timestamp: item.observedAt }
}
// Resumo diário estruturado: cada plataforma desenha o mesmo conteúdo no seu formato.
// Guarda só o necessário de cada notícia para manter o estado persistido pequeno.
export function digestMessage(date, sections, funding, timestamp, summary) {
  return {
    id: `brief:${date}`, module: 'brief', title: `📡 SISMO · Resumo diário ${date}`, summary, timestamp,
    sections: sections.map((section) => ({ name: section.label ?? section.name, emoji: section.emoji, items: section.items.map((item) => ({ title: clip(displayTitle(item), 140), url: item.url, source: item.source, flag: flagOf(item.language), score: item.importance?.score ?? null })) })),
    funding: funding.map((row) => ({ asset: row.asset, rate: row.rate })),
  }
}
const fundingLine = (rows) => rows.map((row) => `${row.asset} ${row.rate > 0 ? '+' : ''}${(row.rate * 100).toFixed(4)}%`).join(' · ')
const score = (item) => (item.score === null ? '' : ` · ${item.score}/10`)

function telegramDigest(message) {
  const head = `<b>${escapeHtml(message.title)}</b>\n<i>Últimas 24 horas, por módulo do curso</i>`
  const foot = `${message.funding.length ? `\n\n<b>⚡ Funding (perpétuos)</b>\n${escapeHtml(fundingLine(message.funding))}` : ''}\n\n<i>${escapeHtml(disclaimer)} Manchetes originais, sem checagem independente.</i>`
  const blocks = message.sections.map((section) => ({ head: `<b>${section.emoji} ${escapeHtml(section.name)}</b>`, items: section.items.map((item) => `• ${item.flag} <a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a> — ${escapeHtml(item.source)}${score(item)}`) }))
  const build = () => `${head}\n\n${blocks.filter((block) => block.items.length).map((block) => `${block.head}\n${block.items.join('\n')}`).join('\n\n')}${foot}`
  // Telegram limita a mensagem a 4096 caracteres: remove os itens menos importantes até caber.
  while (build().length > 4000) {
    const block = [...blocks].reverse().find((row) => row.items.length > 1) ?? blocks.find((row) => row.items.length)
    if (!block) break
    block.items.pop()
  }
  return build()
}
export function telegramText(message) {
  if (message.sections) return telegramDigest(message)
  const tag = message.flag ? `${message.flag} ` : ''
  return `<b>${tag}${escapeHtml(message.title)}</b>\n\n${escapeHtml(message.summary.slice(0, 2800))}${message.url ? `\n\n<a href="${escapeHtml(message.url)}">Ler na fonte</a>` : ''}\n\n<i>${escapeHtml(disclaimer)}</i>`.slice(0, 4096)
}
export function discordPayload(message) {
  if (message.sections) {
    const fields = message.sections.filter((section) => section.items.length).slice(0, 24).map((section) => ({ name: `${section.emoji} ${section.name}`, value: clip(section.items.map((item) => `• ${item.flag} [${item.title.replace(/[[\]]/g, '')}](${item.url}) — ${item.source}${score(item)}`).join('\n'), 1024) }))
    if (message.funding.length) fields.push({ name: '⚡ Funding (perpétuos)', value: fundingLine(message.funding) })
    return { allowed_mentions: { parse: [] }, embeds: [{ title: message.title.slice(0, 256), description: `Últimas 24 horas, por módulo do curso.\n\n${disclaimer} Manchetes originais, sem checagem independente.`, color: 0xa78bfa, timestamp: message.timestamp, fields, footer: { text: 'Omega · SISMO' } }] }
  }
  return { allowed_mentions: { parse: [] }, embeds: [{ title: `${message.flag ? `${message.flag} ` : ''}${message.title}`.slice(0, 256), ...(message.url ? { url: message.url } : {}), description: `${message.summary.slice(0, 3000)}\n\n${disclaimer}`, color: 0xa78bfa, timestamp: message.timestamp, footer: { text: 'Omega · SISMO' } }] }
}
export async function sendMessage(config, platform, message, fetchImpl = fetch) {
  if (platform === 'discord') {
    const url = new URL(config.discordWebhook)
    url.searchParams.set('wait', 'true')
    const data = JSON.parse(await requestText(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(discordPayload(message)) }, fetchImpl, 100_000))
    if (!data.id) throw new Error('Resposta de entrega inválida')
    return String(data.id)
  }
  const data = JSON.parse(await requestText(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: config.telegramChatId, text: telegramText(message), parse_mode: 'HTML', link_preview_options: { is_disabled: true } }) }, fetchImpl, 100_000))
  if (!data.ok || !data.result?.message_id) throw new Error('Resposta de entrega inválida')
  return String(data.result.message_id)
}
export async function drainQueue(state, config, fetchImpl = fetch, now = Date.now()) {
  if (!config.deliveryEnabled || config.demo) return
  await Promise.allSettled(platforms.map(async (platform) => {
    const key = destinationKey(config, platform)
    if (!key) return
    const pending = state.queue.filter((job) => job.platform === platform && job.destination === key && job.nextAttemptAt <= now && job.expiresAt > now).slice(0, 3)
    for (const job of pending) {
      const record = { id: job.message.id, platform, at: new Date(now).toISOString(), attempt: job.attempts + 1 }
      try {
        const messageId = await sendMessage(config, platform, job.message, fetchImpl)
        state.queue = state.queue.filter((candidate) => candidate !== job)
        state.deliveryLog.push({ ...record, status: 'sent', messageId })
      } catch (error) {
        job.attempts += 1
        job.nextAttemptAt = now + Math.min(3600, Math.max(30 * 2 ** job.attempts, Number(error.retryAfter) || 0)) * 1000
        state.deliveryLog.push({ ...record, status: job.attempts >= 5 ? 'failed' : 'retrying', error: publicError(error) })
        if (job.attempts >= 5) state.queue = state.queue.filter((candidate) => candidate !== job)
      }
    }
  }))
  state.deliveryLog = state.deliveryLog.slice(-200)
}
