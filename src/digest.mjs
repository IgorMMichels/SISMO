import { nicheOf, flagOf, courseModules } from './niche.mjs'
import { normalized } from './news.mjs'

export const sectionEmoji = { Segurança: '🔐', Fundamentos: '🎓', Memecoins: '🐸', Trading: '📈', Futuros: '⚡' }
export const sectionLabel = { Fundamentos: 'Fundamentos, macro e regulação' }
export const sectionOrder = ['Segurança', ...courseModules]

export const moduleOf = (item) => item.module ?? nicheOf(normalized(`${item.title} ${item.summary}`)).module
const isClickbait = (item) => item.clickbait ?? nicheOf(normalized(`${item.title} ${item.summary}`)).clickbait

// Ordem de leitura do digest: importância + sinais que o aluno consegue conferir.
// Cobertura por vários veículos e comunicado oficial sobem; conteúdo do Brasil tem leve prioridade.
export function rankOf(item) {
  const outlets = item.verification?.outlets ?? 1
  return (item.importance?.score ?? 4) + (outlets > 1 ? 1 : 0) + (item.primary || item.verification?.status === 'primary_source' ? 1 : 0) + (item.region === 'Brasil' ? 0.5 : 0)
}

// Seleciona as manchetes das últimas 24h por seção do curso, com limite por seção
// para que um único assunto não domine o resumo.
export function selectDigest(news, now = Date.now(), { limit = 10, perSection = 3 } = {}) {
  const ranked = news
    .filter((item) => Date.parse(item.publishedAt) >= now - 86400_000 && !isClickbait(item))
    .sort((a, b) => rankOf(b) - rankOf(a) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  const sections = new Map()
  let total = 0
  for (const item of ranked) {
    if (total >= limit) break
    const name = item.category === 'Segurança' ? 'Segurança' : moduleOf(item)
    const section = sections.get(name) ?? sections.set(name, []).get(name)
    if (section.length >= perSection) continue
    section.push(item)
    total += 1
  }
  return [...sections.entries()]
    .sort(([a, itemsA], [b, itemsB]) => rankOf(itemsB[0]) - rankOf(itemsA[0]) || sectionOrder.indexOf(a) - sectionOrder.indexOf(b))
    .map(([name, items]) => ({ name, label: sectionLabel[name] ?? name, emoji: sectionEmoji[name] ?? '📰', items }))
}

export const displayTitle = (item) => (item.translation?.title && item.language !== 'pt-BR' ? item.translation.title : item.title)
export const methodLabel = (item) => (item.importance?.method === 'ai' ? 'IA' : 'regras')
export { flagOf }
