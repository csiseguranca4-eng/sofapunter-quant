import axios from 'axios';

const LAYBACK_GATEWAY_URL = 'https://polymarket-read-gateway-yzjl3.ondigitalocean.app/api/polymarket/gamma/markets';

/**
 * Consulta cotações e liquidez da Layback
 */
export async function getLaybackMarketData(marketId) {
  if (!marketId) return null;

  try {
    const response = await axios.get(`${LAYBACK_GATEWAY_URL}?id=${marketId}`, {
      timeout: 3500
    });

    const market = response.data;
    if (!market || !market.outcomePrices) return null;

    const prices = typeof market.outcomePrices === 'string' 
      ? JSON.parse(market.outcomePrices) 
      : market.outcomePrices;

    return {
      marketId,
      rawPrices: prices,
      overOdd: prices[0] ? parseFloat((1 / parseFloat(prices[0])).toFixed(2)) : null,
      underOdd: prices[1] ? parseFloat((1 / parseFloat(prices[1])).toFixed(2)) : null,
      liquidity: parseFloat(market.liquidity || 0),
      volume: parseFloat(market.volume || 0)
    };
  } catch (error) {
    return null;
  }
}