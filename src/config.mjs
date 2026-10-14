import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const botRoot = fileURLToPath(new URL('../', import.meta.url))

export function loadConfig(env = process.env) {
  if (env === process.env) {
    try { process.loadEnvFile(resolve(botRoot, '.env.local')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] ?? fallback)
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Configuração inválida: ${name}`)
    return value
  }
  const threshold = Number(env.FUNDING_EXTREME_PERCENT ?? 0.1)
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 10) throw new Error('Configuração inválida: FUNDING_EXTREME_PERCENT')
  const webhook = env.DISCORD_WEBHOOK_URL?.trim() || ''
  if (webhook) {
    const url = new URL(webhook)
    if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || !/^\/api\/webhooks\/\d+\/[^/]+$/.test(url.pathname)) throw new Error('DISCORD_WEBHOOK_URL deve ser um webhook HTTPS do Discord.')
  }
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim()).filter(Boolean)
  for (const value of allowedOrigins) if (new URL(value).origin !== value) throw new Error('ALLOWED_ORIGINS deve conter origens completas, sem caminhos.')
  return {
    host: env.HOST || '127.0.0.1',
    port: integer('PORT', 8787, 1, 65535),
    dataDir: resolve(botRoot, env.DATA_DIR || 'data'),
    intervalSeconds: integer('COLLECTION_INTERVAL_SECONDS', 60, 30, 3600),
    demo: env.DEMO_MODE === 'true' || process.argv.includes('--demo'),
    allowedOrigins,
    deliveryEnabled: env.DELIVERY_ENABLED === 'true',
    discordWebhook: webhook,
    telegramToken: env.TELEGRAM_BOT_TOKEN?.trim() || '',
    telegramChatId: env.TELEGRAM_CHAT_ID?.trim() || '',
    newsCategories: (env.NEWS_ALERT_CATEGORIES ?? 'Regulação,Segurança,Institucional').split(',').map((value) => value.trim()),
    fundingThreshold: threshold / 100,
    briefHour: integer('DAILY_BRIEF_UTC_HOUR', -1, -1, 23),
    // --digest: envia o resumo do dia neste ciclo, em vez de esperar a hora configurada (uso com cron/timer).
    digestNow: process.argv.includes('--digest'),
    digestItems: integer('DIGEST_ITEMS', 10, 3, 20),
    alertMinImportance: integer('ALERT_MIN_IMPORTANCE', 7, -1, 10),
    newsAiEnabled: env.NEWS_AI_ENABLED === 'true',
    newsAiKey: env.OPENAI_API_KEY?.trim() || '',
    newsAiModel: env.NEWS_AI_MODEL?.trim() || 'gpt-5-mini',
    newsAiIntervalSeconds: integer('NEWS_AI_INTERVAL_SECONDS', 300, 60, 86400),
    newsAiBatchSize: integer('NEWS_AI_BATCH_SIZE', 10, 1, 20),
    newsAiDailyBatches: integer('NEWS_AI_MAX_BATCHES_PER_DAY', 48, 1, 1440),
  }
}
