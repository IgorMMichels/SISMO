export class RequestError extends Error {
  constructor(message, retryAfter = 0) { super(message); this.retryAfter = retryAfter }
}

export async function requestText(url, options = {}, fetchImpl = fetch, maxBytes = 2_000_000, timeoutMs = 12_000) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) {
    let retryAfter = Number(response.headers.get('retry-after')) || 0
    // Telegram informa retry_after no JSON, em vez de somente no header.
    if (response.status === 429) {
      const reader = response.body?.getReader()
      if (reader) {
        try {
          const { value } = await reader.read()
          if (value && value.length <= 10_000) {
            const details = JSON.parse(new TextDecoder().decode(value))
            retryAfter = Math.max(retryAfter, Number(details.parameters?.retry_after ?? details.retry_after) || 0)
          }
        } catch { /* O backoff padrão continua disponível. */ } finally { await reader.cancel() }
      }
    } else await response.body?.cancel()
    throw new RequestError(`HTTP ${response.status}`, retryAfter)
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw new RequestError('Resposta maior que o limite permitido')
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) throw new RequestError('Resposta maior que o limite permitido')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel()
    throw error
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Evita que URLs com tokens apareçam em logs de falhas de fetch.
export function publicError(error) {
  if (error instanceof RequestError) return error.message
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'Tempo de resposta excedido'
  return 'Não foi possível acessar ou interpretar a fonte'
}
