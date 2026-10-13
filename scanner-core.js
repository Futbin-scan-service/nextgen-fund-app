export const EA_TAX_PCT = 0.05;
// Futbin-Filter für Special Cards (Spieler-Liste). Im Dashboard überschreibbar.
export const DEFAULT_SPECIAL_FILTER = 'version=all_specials';

export function normalizePlatform(platform) {
  return (platform || 'ps').toLowerCase() === 'pc' ? 'pc' : 'ps';
}

export function buildPlayersUrl(cfg) {
  const plat = normalizePlatform(cfg.platform);
  const priceKey = plat === 'pc' ? 'pc_price' : 'ps_price';
  const filter = String(cfg.special_filter ?? DEFAULT_SPECIAL_FILTER).trim().replace(/^[?&]+/, '');
  return `https://www.futbin.com/players?${priceKey}=${cfg.price_min}-${cfg.price_max}&platform=${plat}&eUnt=1${filter ? `&${filter}` : ''}`;
}

export function minDiffRequired(firstPrice) {
  let raw;
  if (firstPrice < 50000) raw = firstPrice * 0.06 - 250;
  else if (firstPrice < 75000) raw = firstPrice * 0.055 - 250;
  else raw = firstPrice * 0.05;
  const step = firstPrice < 50000 ? 250 : 500;
  return Math.max(step, Math.round(raw / step) * step);
}

export function analysePlayer({ player }) {
  const { first, last } = player;
  const diff = last - first;
  const minDiff = minDiffRequired(first);
  if (diff < minDiff) return { accepted: false, reason: 'gap_too_small' };

  const profit = Math.round(last * (1 - EA_TAX_PCT) - first);
  return {
    accepted: true,
    deal: {
      player: player.player,
      url: player.url,
      first,
      last,
      diff,
      min_diff: minDiff,
      profit,
      visible_prices: player.visiblePrices || []
    }
  };
}
