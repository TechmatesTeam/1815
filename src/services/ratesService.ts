import { cacheService, CacheKeys } from './cacheService';
import { logger } from '@/utils/logger';

export class RatesService {
  private coinId = 'cardano';

  /**
   * Get ADA price for requested fiat currencies (USD, EUR, GBP...)
   */
  async getPrices(vsCurrencies: string[]): Promise<Record<string, number>> {
    // Normalize currencies to lowercase
    const key = `ada_prices:${vsCurrencies.sort().join(',').toLowerCase()}`;

    // Try cache first
    const cached = await cacheService.get<Record<string, number>>(key, {
      prefix: CacheKeys.BLOCKFROST, // reuse a prefix
    });

    if (cached) {
      return cached;
    }

    try {
      const currenciesParam = vsCurrencies.map(c => c.toLowerCase()).join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${this.coinId}&vs_currencies=${currenciesParam}`;

      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`CoinGecko responded ${resp.status}`);
      }

      const json = await resp.json();
      const prices: Record<string, number> = {};

      for (const cur of vsCurrencies) {
        const val = json?.[this.coinId]?.[cur.toLowerCase()];
        if (typeof val === 'number') {
          prices[cur.toUpperCase()] = val;
        }
      }

      // Cache for 60 seconds to avoid rate-limiting
      await cacheService.set(key, prices, { prefix: CacheKeys.BLOCKFROST, ttl: 60 });

      return prices;
    } catch (error) {
      logger.warn('Failed to fetch ADA prices from CoinGecko, falling back to 0', error);
      // Return zeros so the caller can gracefully handle
      const fallback: Record<string, number> = {};
      for (const cur of vsCurrencies) fallback[cur.toUpperCase()] = 0;
      return fallback;
    }
  }
}

export const ratesService = new RatesService();
