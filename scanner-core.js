export const EA_TAX_PCT = 0.05;
export const SALES_N_BASE = 30;
export const SALES_N_MID = 60;
export const SALES_N_MAX = 90;
export const MIN_SALES_REQUIRED = 10;
export const VALUE_UNDERVALUE_PCT = 0.02;
export const VALUE_UNDERVALUE_PCT_PC = 0.025;
export const MIN_SALES_PER_HOUR_PC = 5.0;
export const MIN_NET_PROFIT_PCT = 0.04;
export const MAX_NET_PROFIT_CAP_PCT = 0.05;

export function buildPlayersUrl(cfg) {
  const plat = (cfg.platform || 'ps').toLowerCase() === 'pc' ? 'pc' : 'ps';
  const priceKey = plat === 'pc' ? 'pc_price' : 'ps_price';
  return `https://www.futbin.com/players?${priceKey}=${cfg.price_min}-${cfg.price_max}&platform=${plat}&eUnt=1`;
}

export function playerToSalesUrl(playerUrl, platform) {
  const u = new URL(playerUrl.split('#')[0]);
  u.pathname = u.pathname.replace('/player/', '/sales/');
  u.searchParams.set('platform', (platform || 'ps').toLowerCase() === 'pc' ? 'pc' : 'ps');
  return u.toString();
}

export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
export function ceilToStep(value, step) { return Math.ceil(value / step) * step; }
export function floorToStep(value, step) { return Math.floor(value / step) * step; }
export function stepForPrice(price) { return price >= 50000 ? 500 : 250; }

export function minDiffRequired(firstPrice) {
  let raw;
  if (firstPrice < 50000) raw = firstPrice * 0.06 - 250;
  else if (firstPrice < 75000) raw = firstPrice * 0.055 - 250;
  else raw = firstPrice * 0.05;
  const step = firstPrice < 50000 ? 250 : 500;
  return Math.max(step, Math.round(raw / step) * step);
}

export function targetSellForMinNetProfit(buy, minNetProfitPct = MIN_NET_PROFIT_PCT) {
  const step = stepForPrice(buy);
  const raw = buy * (1 + minNetProfitPct) / (1 - EA_TAX_PCT);
  return ceilToStep(raw, step);
}

export function targetSellForMaxNetProfit(buy, capPct = MAX_NET_PROFIT_CAP_PCT) {
  const step = stepForPrice(buy);
  const maxSell = (buy + buy * capPct) / (1 - EA_TAX_PCT);
  return floorToStep(maxSell, step);
}

export function medianInt(values) {
  const vals = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : Math.floor((vals[mid - 1] + vals[mid]) / 2);
}

export function percentileInt(values, p) {
  const vals = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const idx = Math.round((vals.length - 1) * clamp(p, 0, 1));
  return vals[idx];
}

export function recentSlice(valuesNewestFirst) { return valuesNewestFirst.slice(0, 15); }
export function countHits(values, level) { return values.filter(v => v >= level).length; }

export function salesSpeedPerHour(rowsNewestFirst, take = 30) {
  const ages = rowsNewestFirst.slice(0, take).map(x => x.age_min).filter(v => Number.isFinite(v) && v >= 0);
  if (ages.length < 10) return 0;
  const newest = Math.min(...ages);
  const oldest = Math.max(...ages);
  const spanMin = oldest - newest;
  if (spanMin <= 0) return 999;
  return ages.length / (spanMin / 60);
}

export function determineAdaptiveSalesN(diff, buy, median) {
  if (buy <= 0 || median <= 0) return SALES_N_BASE;
  const diffPct = diff / buy;
  const undervaluePct = (median - buy) / median;
  if (diffPct >= 0.08 || undervaluePct >= 0.06) return SALES_N_MAX;
  if (diffPct >= 0.05 || undervaluePct >= 0.04) return SALES_N_MID;
  return SALES_N_BASE;
}

export function trendStateFromSales(pricesNewestFirst) {
  if (pricesNewestFirst.length < 16) return 0;
  const recent = pricesNewestFirst.slice(0, 8);
  const older = pricesNewestFirst.slice(8, 16);
  const mr = medianInt(recent);
  const mo = medianInt(older);
  if (mr <= 0 || mo <= 0) return 0;
  if (mr > mo * 1.005) return 1;
  if (mr < mo * 0.995) return -1;
  return 0;
}

export function dynamicHitsNeeded(probePrice, median) {
  if (median <= 0 || probePrice <= 0) return 3;
  const ratio = probePrice / median;
  if (ratio <= 1.02) return 2;
  if (ratio <= 1.05) return 3;
  if (ratio <= 1.08) return 4;
  return 999;
}

function baseCapRatio(buy) { return buy < 60000 ? 1.05 : 1.03; }
function tightCapRatio(buy) { return buy < 60000 ? 1.04 : 1.02; }

export function findBestLevel(buy, salesPricesNewestFirst) {
  const prices = salesPricesNewestFirst;
  const step = stepForPrice(buy);
  const minProfitTarget = targetSellForMinNetProfit(buy, MIN_NET_PROFIT_PCT);
  const med = medianInt(prices);
  if (med <= 0) return { med, best: minProfitTarget, start: 0 };

  const p60 = percentileInt(prices, 0.60);
  let start = floorToStep(Math.max(minProfitTarget, p60), step);
  const p90 = percentileInt(prices, 0.90);
  const medCap = Math.floor(med * 1.03);
  let cap = floorToStep(Math.min(p90 || medCap, medCap), step);
  if (cap < start) cap = start;

  let best = start;
  for (let probe = start; probe <= cap; probe += step) {
    const need = dynamicHitsNeeded(probe, med);
    if (need >= 999) break;
    const hits = countHits(prices, probe);
    if (hits >= need + 1) best = probe;
    else break;
  }
  return { med, best, start };
}

export function computeFinalTargetWithQuality({ buy, bestLevel, trend, med, salesPricesNewestFirst, undervaluePct, salesSpeedPerHourValue, platform = 'ps' }) {
  const step = stepForPrice(buy);
  const recent = recentSlice(salesPricesNewestFirst);
  const minProfitTarget = targetSellForMinNetProfit(buy, MIN_NET_PROFIT_PCT);
  const isPc = (platform || 'ps').toLowerCase() === 'pc';

  let baseTarget = trend > 0 ? bestLevel : trend < 0 ? bestLevel - 2 * step : bestLevel - step;
  let candidate = Math.max(minProfitTarget, baseTarget);

  let need = dynamicHitsNeeded(candidate, med);
  let hitsAll = countHits(salesPricesNewestFirst, candidate);
  let hitsRecent = countHits(recent, candidate);

  let capRatio = baseCapRatio(buy);
  const weakConf = hitsAll <= need || hitsRecent === 0 || (trend < 0 && hitsRecent <= 1);
  if (weakConf) capRatio = tightCapRatio(buy);

  const capLevel = med > 0 ? floorToStep(med * capRatio, step) : candidate;
  candidate = Math.min(candidate, capLevel);
  candidate = Math.max(minProfitTarget, candidate);

  need = dynamicHitsNeeded(candidate, med);
  hitsAll = countHits(salesPricesNewestFirst, candidate);
  hitsRecent = countHits(recent, candidate);

  let extraSteps = 0;
  const s = Number(salesSpeedPerHourValue || 0);
  if (isPc) {
    if (s > 0 && s < 6) extraSteps = Math.max(extraSteps, 1);
    if (s > 0 && s < 4) extraSteps = Math.max(extraSteps, 2);
    if (s > 0 && s < 2.5) extraSteps = Math.max(extraSteps, 3);
  } else {
    if (s > 0 && s < 10) extraSteps = Math.max(extraSteps, 1);
    if (s > 0 && s < 6) extraSteps = Math.max(extraSteps, 2);
    if (s > 0 && s < 4) extraSteps = Math.max(extraSteps, 3);
    if (s > 0 && s < 2) extraSteps = Math.max(extraSteps, 4);
  }

  if (hitsAll <= need) extraSteps = Math.max(extraSteps, 2);
  else if (hitsAll === need + 1) extraSteps = Math.max(extraSteps, 1);
  if (hitsRecent === 0) extraSteps = Math.max(extraSteps, 2);
  else if (hitsRecent === 1 && candidate / med > 1.01) extraSteps = Math.max(extraSteps, 1);
  if (trend < 0) extraSteps = Math.max(extraSteps, 1);
  if (buy >= 60000 && undervaluePct < 0.03 && hitsRecent <= 1) extraSteps = Math.max(extraSteps, 2);

  let finalTarget = candidate - extraSteps * step;
  finalTarget = Math.max(minProfitTarget, finalTarget);
  finalTarget = med > 0 ? Math.min(finalTarget, capLevel) : finalTarget;
  finalTarget = Math.max(minProfitTarget, finalTarget);
  return { finalTarget: Math.trunc(finalTarget), undercutSteps: Math.trunc(extraSteps) };
}

export function analysePlayer({ cfg, player, salesRows }) {
  const { first, last } = player;
  const diff = last - first;
  const minDiff = minDiffRequired(first);
  if (diff < minDiff) return { accepted: false, reason: 'gap_too_small' };

  if (salesRows.length < MIN_SALES_REQUIRED) return { accepted: false, reason: 'not_enough_sales_base' };
  const basePrices = salesRows.map(x => x.sold).filter(Boolean);
  const med30 = medianInt(basePrices);
  if (med30 <= 0) return { accepted: false, reason: 'median_invalid_base' };

  const minUndervalue = (cfg.platform || 'ps').toLowerCase() === 'pc' ? VALUE_UNDERVALUE_PCT_PC : VALUE_UNDERVALUE_PCT;
  const undervaluePct30 = (med30 - first) / med30;
  if (undervaluePct30 < minUndervalue) return { accepted: false, reason: 'undervalue_too_low_base' };

  const desiredN = determineAdaptiveSalesN(diff, first, med30);
  const effectiveRows = salesRows.slice(0, desiredN);
  if (effectiveRows.length < MIN_SALES_REQUIRED) return { accepted: false, reason: 'not_enough_sales_final' };

  const prices = effectiveRows.map(x => x.sold).filter(Boolean);
  const med = medianInt(prices);
  if (med <= 0) return { accepted: false, reason: 'median_invalid_final' };

  const undervaluePct = (med - first) / med;
  const trend = trendStateFromSales(prices);
  const speedH = salesSpeedPerHour(effectiveRows, Math.min(60, effectiveRows.length));
  if ((cfg.platform || 'ps').toLowerCase() === 'pc' && speedH < MIN_SALES_PER_HOUR_PC) {
    return { accepted: false, reason: 'pc_sales_too_slow' };
  }

  const recent = recentSlice(prices);
  if (trend < 0 && countHits(recent, floorToStep(med, stepForPrice(first))) === 0 && undervaluePct < 0.025) {
    return { accepted: false, reason: 'negative_trend_weak_recent' };
  }

  const best = findBestLevel(first, prices);
  let { finalTarget, undercutSteps } = computeFinalTargetWithQuality({
    buy: first,
    bestLevel: best.best,
    trend,
    med: best.med,
    salesPricesNewestFirst: prices,
    undervaluePct,
    salesSpeedPerHourValue: speedH,
    platform: cfg.platform
  });

  const minProfitTarget = targetSellForMinNetProfit(first, MIN_NET_PROFIT_PCT);
  const capLevel = targetSellForMaxNetProfit(first, MAX_NET_PROFIT_CAP_PCT);
  if (capLevel > 0) finalTarget = Math.min(finalTarget, capLevel);
  finalTarget = Math.max(finalTarget, minProfitTarget);

  const needFinal = dynamicHitsNeeded(finalTarget, best.med);
  if (needFinal >= 999) return { accepted: false, reason: 'target_above_allowed_band' };
  const hitsFinal = countHits(prices, finalTarget);
  if (hitsFinal < needFinal) return { accepted: false, reason: 'not_enough_hits_at_target' };

  const profit = Math.round(finalTarget * (1 - EA_TAX_PCT) - first);
  return {
    accepted: true,
    deal: {
      player: player.player,
      url: player.url,
      sales_url: playerToSalesUrl(player.url, cfg.platform),
      first,
      target_sell: finalTarget,
      undervalue_pct: undervaluePct,
      median_sale: best.med,
      trend,
      sales_per_hour: Number(speedH.toFixed(2)),
      sales_checked: effectiveRows.length,
      hit_count: hitsFinal,
      hits_needed: needFinal,
      undercut_steps: undercutSteps,
      last,
      diff,
      min_diff: minDiff,
      profit,
      second: player.second,
      third: player.third,
      fourth: player.fourth,
      visible_prices: player.visiblePrices || [],
      p5_market: last,
      gap: diff,
      gewinn: profit,
      expected_net_profit: profit,
      expected_net_profit_pct: first ? profit / first : 0,
      value_score: Math.round(clamp(undervaluePct / 0.10, 0, 1) * 100)
    }
  };
}
