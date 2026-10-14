import { requestText } from './network.mjs'

export const fundingAssets = ['BTC', 'ETH', 'SOL']

export async function collectFunding(fetchImpl = fetch) {
  const results = await Promise.allSettled(fundingAssets.map(async (asset) => {
    const data = JSON.parse(await requestText(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${asset}USDT`, {}, fetchImpl, 50_000))
    const rate = Number(data.lastFundingRate)
    const markPrice = Number(data.markPrice)
    const next = Number(data.nextFundingTime)
    const observed = Number(data.time)
    if (data.symbol !== `${asset}USDT` || !Number.isFinite(rate) || Math.abs(rate) > 1 || !Number.isFinite(markPrice) || markPrice <= 0 || !Number.isFinite(next) || next <= 0 || !Number.isFinite(observed) || observed <= 0 || Math.abs(Date.now() - observed) > 5 * 60_000) throw new Error('Funding inválido ou desatualizado')
    return { asset, rate, markPrice, nextFundingAt: new Date(next).toISOString(), observedAt: new Date(observed).toISOString(), exchange: 'Binance USDⓈ-M', url: `https://www.binance.com/en/futures/${asset}USDT` }
  }))
  return { results, assets: fundingAssets }
}
