// Motor de nicho do SISMO: liga cada manchete às jornadas do curso (Fundamentos,
// Memecoins, Trading, Futuros) em inglês, português e espanhol. Regras explicáveis,
// sem IA e sem rede. O texto chega normalizado (minúsculo, sem acentos).
export const courseModules = ['Fundamentos', 'Memecoins', 'Trading', 'Futuros']

const topicPatterns = {
  memecoins: /\b(meme ?coins?|memecoins?|pump\.?fun|bonk|dogwifhat|wif|pepe|shib(a)?|doge(coin)?|trump coin|official trump|rug ?pulls?|bonding curve|degens?|moonshot|raydium|dexscreener|token launch|lancamento de token|lanzamiento de token|memes?)\b/,
  futuros: /\b(futures?|futuros?|perpetual\w*|perpetuo\w*|perps?|funding rates?|taxas? de funding|tasas? de financiacion|open interest|interesse em aberto|interes abierto|liquidations?|liquidated|liquidacoes|liquidaciones|leverag\w*|alavanc\w*|apalanc\w*|margin calls?|short squeeze|long squeeze|hyperliquid)\b/,
  trading: /\b(trad(e|es|ing|er|ers)|operar|rally|breakout|rompimento|ruptura|all.time high|ath|maxima historica|sell.?off|correction|correcao|correccion|bull(ish)? market|bear(ish)? market|mercado de alta|mercado de baixa|mercado alcista|mercado bajista|etf flows?|fluxo de etf|technical analysis|analise tecnica|analisis tecnico)\b/,
  seguranca: /\b(hack\w*|exploit\w*|breach\w*|stolen|drain\w*|phishing|scam\w*|fraud\w*|golpe\w*|estafa\w*|roub\w*|robo|hackeo|seguranca|security|rug ?pulls?|insolv\w*|falencia|quiebra)\b/,
  plataformas: /\b(phantom|axiom|gmgn|trojan|metamask|ledger|trezor|wallets?|carteiras?|carteras?|jupiter|uniswap|binance|coinbase|bybit|okx|kraken|robinhood|mercado bitcoin)\b/,
  fundamentos: /\b(what is|how to|guide|beginners?|explained|explainer|como funciona|guia|iniciantes?|para principiantes|que es|como comprar|como usar|como vender)\b/,
  solana: /\b(solana|sol|phantom|raydium|jupiter|pump\.?fun|jito|firedancer)\b/,
}
// Manchetes de previsão de preço e promessa de ganho ensinam o contrário do curso.
const clickbait = /\b(price predictions?|previsao de preco|prediccion de precio|prediccion del precio|to the moon|100x|1000x|next (bitcoin|shiba|pepe|doge)|will (hit|reach|soar|explode)|vai (explodir|disparar|chegar)|podria (explotar|dispararse)|get rich|ficar rico|hazte rico)\b/

export function nicheOf(text) {
  const topics = Object.entries(topicPatterns).filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic)
  const module = topics.includes('memecoins') ? 'Memecoins' : topics.includes('futuros') ? 'Futuros' : topics.includes('trading') ? 'Trading' : 'Fundamentos'
  return { topics, module, clickbait: clickbait.test(text) }
}

export const languageLabel = { 'pt-BR': { flag: '🇧🇷', code: 'PT' }, es: { flag: '🇪🇸', code: 'ES' }, en: { flag: '🇺🇸', code: 'EN' } }
export const flagOf = (language) => (languageLabel[language] ?? languageLabel.en).flag
