const EA_TAX_PCT = 0.05;
const SALES_N_BASE = 30;
const SALES_N_MID = 60;
const SALES_N_MAX = 90;
const MIN_SALES_REQUIRED = 10;
const VALUE_UNDERVALUE_PCT = 0.02;
const VALUE_UNDERVALUE_PCT_PC = 0.025;
const MIN_SALES_PER_HOUR_PC = 5.0;
const MIN_NET_PROFIT_PCT = 0.04;
const MAX_NET_PROFIT_CAP_PCT = 0.05;

function buildPlayersUrl(cfg) {
  const plat = (cfg.platform || 'ps').toLowerCase() === 'pc' ? 'pc' : 'ps';
  const priceKey = plat === 'pc' ? 'pc_price' : 'ps_price';
  return `https://www.futbin.com/players?${priceKey}=${cfg.price_min}-${cfg.price_max}&platform=${plat}&eUnt=1`;
}

function playerToSalesUrl(playerUrl, platform) {
  const u = new URL(playerUrl.split('#')[0]);
  u.pathname = u.pathname.replace('/player/', '/sales/');
  u.searchParams.set('platform', (platform || 'ps').toLowerCase() === 'pc' ? 'pc' : 'ps');
  return u.toString();
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function ceilToStep(value, step) { return Math.ceil(value / step) * step; }
function floorToStep(value, step) { return Math.floor(value / step) * step; }
function stepForPrice(price) { return price >= 50000 ? 500 : 250; }

function minDiffRequired(firstPrice) {
  let raw;
  if (firstPrice < 50000) raw = firstPrice * 0.06 - 250;
  else if (firstPrice < 75000) raw = firstPrice * 0.055 - 250;
  else raw = firstPrice * 0.05;
  const step = firstPrice < 50000 ? 250 : 500;
  return Math.max(step, Math.round(raw / step) * step);
}

function targetSellForMinNetProfit(buy, minNetProfitPct = MIN_NET_PROFIT_PCT) {
  const step = stepForPrice(buy);
  const raw = buy * (1 + minNetProfitPct) / (1 - EA_TAX_PCT);
  return ceilToStep(raw, step);
}

function targetSellForMaxNetProfit(buy, capPct = MAX_NET_PROFIT_CAP_PCT) {
  const step = stepForPrice(buy);
  const maxSell = (buy + buy * capPct) / (1 - EA_TAX_PCT);
  return floorToStep(maxSell, step);
}

function medianInt(values) {
  const vals = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : Math.floor((vals[mid - 1] + vals[mid]) / 2);
}

function percentileInt(values, p) {
  const vals = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const idx = Math.round((vals.length - 1) * clamp(p, 0, 1));
  return vals[idx];
}

function recentSlice(valuesNewestFirst) { return valuesNewestFirst.slice(0, 15); }
function countHits(values, level) { return values.filter(v => v >= level).length; }

function salesSpeedPerHour(rowsNewestFirst, take = 30) {
  const ages = rowsNewestFirst.slice(0, take).map(x => x.age_min).filter(v => Number.isFinite(v) && v >= 0);
  if (ages.length < 10) return 0;
  const newest = Math.min(...ages);
  const oldest = Math.max(...ages);
  const spanMin = oldest - newest;
  if (spanMin <= 0) return 999;
  return ages.length / (spanMin / 60);
}

function determineAdaptiveSalesN(diff, buy, median) {
  if (buy <= 0 || median <= 0) return SALES_N_BASE;
  const diffPct = diff / buy;
  const undervaluePct = (median - buy) / median;
  if (diffPct >= 0.08 || undervaluePct >= 0.06) return SALES_N_MAX;
  if (diffPct >= 0.05 || undervaluePct >= 0.04) return SALES_N_MID;
  return SALES_N_BASE;
}

function trendStateFromSales(pricesNewestFirst) {
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

function dynamicHitsNeeded(probePrice, median) {
  if (median <= 0 || probePrice <= 0) return 3;
  const ratio = probePrice / median;
  if (ratio <= 1.02) return 2;
  if (ratio <= 1.05) return 3;
  if (ratio <= 1.08) return 4;
  return 999;
}

function baseCapRatio(buy) { return buy < 60000 ? 1.05 : 1.03; }
function tightCapRatio(buy) { return buy < 60000 ? 1.04 : 1.02; }

function findBestLevel(buy, salesPricesNewestFirst) {
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

function computeFinalTargetWithQuality({ buy, bestLevel, trend, med, salesPricesNewestFirst, undervaluePct, salesSpeedPerHourValue, platform = 'ps' }) {
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

function analysePlayer({ cfg, player, salesRows }) {
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


const DASHBOARD_URL = chrome.runtime.getURL('dashboard.html');
const LICENSE_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwLYXP3iHbAuXsKKDQoK3MGPZ8SiXaWfrvyozOI7lCrEIutphYqrMuoxx7ggaMlTZqa/exec';
const VERSION = '1.5.2-single-foreground-linktab';

const DEFAULT_CFG = {
  price_min: 20000,
  price_max: 60000,
  platform: 'ps',
  interval_min: 3,
  pages_to_scan: 12,
  concurrency: 3,
  enabled: false,
  page_timeout_sec: 18,
  retry_count: 2,
  keep_debug_log: true
};

const DEFAULT_LICENSE_STATE = {
  key: '',
  valid: false,
  expires_at: null,
  last_checked_at: null,
  message: 'Keine Lizenz aktiviert.'
};

let runtimeState = freshRuntimeState();
let scanPromise = null;

function freshRuntimeState() {
  return {
    version: VERSION,
    running: false,
    stopRequested: false,
    deals: [],
    status: 'Bereit',
    progress: 0,
    lastRunAt: null,
    currentTabIds: [],
    processed: 0,
    totalLinks: 0,
    pagesRead: 0,
    totalPages: 0,
    errors: 0,
    skipped: 0,
    rejectReasons: {},
    lastError: '',
    debugLog: []
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['config', 'runtimeState', 'licenseState']);
  if (!stored.config) await chrome.storage.local.set({ config: DEFAULT_CFG });
  if (!stored.runtimeState) await chrome.storage.local.set({ runtimeState });
  if (!stored.licenseState) await chrome.storage.local.set({ licenseState: DEFAULT_LICENSE_STATE });
});

chrome.action.onClicked.addListener(openOrFocusDashboard);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'GET_STATE') {
        const data = await chrome.storage.local.get(['config', 'runtimeState', 'licenseState']);
        sendResponse({
          config: { ...DEFAULT_CFG, ...(data.config || {}) },
          runtimeState: { ...freshRuntimeState(), ...(data.runtimeState || runtimeState), version: VERSION },
          licenseState: normalizeLicenseState(data.licenseState)
        });
        return;
      }

      if (message?.type === 'ACTIVATE_LICENSE') {
        sendResponse(await activateLicense(String(message.key || '').trim()));
        return;
      }

      if (message?.type === 'CHECK_LICENSE') {
        sendResponse(await checkStoredLicense());
        return;
      }

      if (message?.type === 'CLEAR_LICENSE') {
        const cleared = { ...DEFAULT_LICENSE_STATE, message: 'Lizenz gelöscht.' };
        await persistLicenseState(cleared);
        sendResponse({ ok: true, licenseState: cleared });
        return;
      }

      if (message?.type === 'OPEN_DASHBOARD') {
        await openOrFocusDashboard();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'SAVE_CONFIG') {
        const cfg = normalizeCfg({ ...DEFAULT_CFG, ...(message.config || {}) });
        await chrome.storage.local.set({ config: cfg });
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'START_SCAN') {
        if (runtimeState.running || scanPromise) {
          sendResponse({ ok: false, message: 'Scanner läuft bereits.' });
          return;
        }
        const licenseResult = await ensureLicenseForScan();
        if (!licenseResult.ok) {
          await setStatus(licenseResult.message || 'Lizenzprüfung fehlgeschlagen.', runtimeState.progress);
          sendResponse(licenseResult);
          return;
        }
        const stored = await chrome.storage.local.get(['config']);
        const cfg = normalizeCfg({ ...DEFAULT_CFG, ...(stored.config || {}), ...(message.config || {}) });
        await chrome.storage.local.set({ config: cfg });
        scanPromise = startLoop(cfg).finally(() => { scanPromise = null; });
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'STOP_SCAN') {
        runtimeState.stopRequested = true;
        await logEvent('Stop angefordert. Lauf wird sauber beendet...');
        await persistRuntime();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'CLEAR_DEALS') {
        runtimeState.deals = [];
        await persistRuntime();
        sendResponse({ ok: true });
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, message: err?.message || String(err) });
    }
  })();
  return true;
});

function normalizeCfg(cfg) {
  const out = {
    ...cfg,
    pages_to_scan: Math.max(1, Math.min(50, Number(cfg.pages_to_scan || 12))),
    interval_min: Math.max(1, Number(cfg.interval_min || 3)),
    concurrency: Math.max(1, Math.min(6, Number(cfg.concurrency || 3))),
    price_min: Math.max(0, Number(cfg.price_min || 20000)),
    price_max: Math.max(0, Number(cfg.price_max || 60000)),
    page_timeout_sec: Math.max(8, Math.min(45, Number(cfg.page_timeout_sec || 18))),
    retry_count: Math.max(0, Math.min(4, Number(cfg.retry_count ?? 2))),
    keep_debug_log: cfg.keep_debug_log !== false
  };
  if (out.price_max < out.price_min) [out.price_min, out.price_max] = [out.price_max, out.price_min];
  return out;
}

async function persistRuntime() {
  await chrome.storage.local.set({ runtimeState });
}

async function setStatus(status, progress = runtimeState.progress) {
  runtimeState.status = status;
  runtimeState.progress = progress;
  await persistRuntime();
}

async function logEvent(message, extra = {}) {
  const entry = { ts: new Date().toISOString(), message, ...extra };
  runtimeState.debugLog = [entry, ...(runtimeState.debugLog || [])].slice(0, 120);
  if (extra.error) runtimeState.lastError = String(extra.error).slice(0, 220);
  await persistRuntime();
}

async function noteError(message, err) {
  runtimeState.errors += 1;
  await logEvent(message, { error: err?.message || String(err) });
}

async function persistLicenseState(licenseState) {
  await chrome.storage.local.set({ licenseState });
}

function normalizeLicenseState(state = {}) {
  return { ...DEFAULT_LICENSE_STATE, ...(state || {}) };
}

const GRACE_SECONDS = 72 * 3600;

function toUnixSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value > 9999999999 ? value / 1000 : value);
  const raw = String(value).trim();
  if (!raw || raw === '∞') return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    return Math.floor(n > 9999999999 ? n / 1000 : n);
  }
  const d = new Date(raw.replace('Z', '+00:00'));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

function unixToIso(ts) {
  if (ts === null || ts === undefined) return null;
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}

function isTimeValid(expiresAt, nowSec = Math.floor(Date.now() / 1000)) {
  const exp = toUnixSeconds(expiresAt);
  if (exp === null) return true;
  return nowSec < exp;
}

function isLicenseExpired(expiresAt) { return !isTimeValid(expiresAt); }

function canUseOffline(state = {}, nowSec = Math.floor(Date.now() / 1000)) {
  if (!isTimeValid(state.expires_at, nowSec)) return false;
  const lastOk = toUnixSeconds(state.last_ok ?? state.last_ok_at ?? state.last_checked_at);
  if (lastOk === null) return false;
  return (nowSec - lastOk) <= GRACE_SECONDS;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function stableDeviceId() {
  let stored = await chrome.storage.local.get(['deviceSeed']);
  if (!stored.deviceSeed) {
    stored.deviceSeed = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    await chrome.storage.local.set({ deviceSeed: stored.deviceSeed });
  }
  const parts = [navigator.platform || '', navigator.userAgent || '', chrome.runtime.id || '', stored.deviceSeed];
  return sha256Hex(parts.join('|'));
}

async function fetchLicenseValidation(key) {
  if (!key) return { ok: false, message: 'Bitte einen Lizenzschlüssel eingeben.' };
  const device = await stableDeviceId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(LICENSE_ENDPOINT.replace(/\/$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, device }),
      cache: 'no-store',
      redirect: 'follow',
      credentials: 'omit',
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    const debug = {
      http_status: response.status,
      final_url_host: (() => { try { return new URL(response.url || LICENSE_ENDPOINT).host; } catch { return ''; } })(),
      response_head: String(text || '').slice(0, 500),
      parsed_keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 30).join(', ') : '',
      device: device.slice(0, 12) + '…'
    };
    if (response.status !== 200) return { ok: false, expires_at: null, message: `Server-Fehler (${response.status})`, raw: data, debug };
    if (!data || data.ok !== true) return { ok: false, expires_at: null, message: data?.message || data?.msg || 'Ungültige Lizenz.', raw: data, debug };
    const expUnix = toUnixSeconds(data.expires_at ?? null);
    return { ok: true, expires_at: unixToIso(expUnix), expires_at_unix: expUnix, message: data?.message || data?.msg || 'OK', raw: data, debug };
  } catch (err) {
    return { ok: false, expires_at: null, message: 'Keine Verbindung zum Lizenzserver.', network_error: true, debug: { url_host: 'script.google.com', error: err?.message || String(err) } };
  } finally { clearTimeout(timeout); }
}

async function activateLicense(key) {
  const result = await fetchLicenseValidation(key);
  const nowSec = Math.floor(Date.now() / 1000);
  const licenseState = normalizeLicenseState({
    key,
    valid: !!result.ok,
    expires_at: result.expires_at || null,
    expires_at_unix: result.expires_at_unix ?? toUnixSeconds(result.expires_at),
    last_checked_at: new Date().toISOString(),
    last_ok: result.ok ? nowSec : null,
    last_ok_at: result.ok ? new Date().toISOString() : null,
    message: result.message || '',
    last_http_status: result.debug?.http_status || null,
    last_response_host: result.debug?.final_url_host || result.debug?.url_host || '',
    last_response_head: result.debug?.response_head || '',
    last_parsed_keys: result.debug?.parsed_keys || '',
    last_active_value: '',
    last_status_text: result.raw && typeof result.raw === 'object' ? `ok=${String(result.raw.ok)}` : '',
    last_network_error: result.network_error ? (result.debug?.error || result.message || '') : '',
    last_device: result.debug?.device || ''
  });
  if (licenseState.valid && !isTimeValid(licenseState.expires_at)) {
    licenseState.valid = false;
    licenseState.message = 'Lizenz abgelaufen.';
  }
  await persistLicenseState(licenseState);
  return { ok: licenseState.valid, message: licenseState.message, licenseState };
}

async function checkStoredLicense() {
  const stored = await chrome.storage.local.get(['licenseState']);
  const previous = normalizeLicenseState(stored.licenseState);
  if (!previous.key) {
    await persistLicenseState(previous);
    return { ok: false, message: 'Keine Lizenz gespeichert.', licenseState: previous };
  }
  const result = await fetchLicenseValidation(previous.key);
  const nowSec = Math.floor(Date.now() / 1000);
  if (result.network_error && canUseOffline(previous, nowSec)) {
    const offlineState = normalizeLicenseState({
      ...previous,
      valid: true,
      last_checked_at: new Date().toISOString(),
      message: 'Keine Verbindung zum Lizenzserver. Offline-Grace aktiv.',
      last_network_error: result.debug?.error || result.message || 'offline'
    });
    await persistLicenseState(offlineState);
    return { ok: true, message: offlineState.message, licenseState: offlineState, offline: true };
  }
  const state = normalizeLicenseState({
    key: previous.key,
    valid: !!result.ok,
    expires_at: result.expires_at || null,
    expires_at_unix: result.expires_at_unix ?? toUnixSeconds(result.expires_at),
    last_checked_at: new Date().toISOString(),
    last_ok: result.ok ? nowSec : (previous.last_ok || null),
    last_ok_at: result.ok ? new Date().toISOString() : (previous.last_ok_at || null),
    message: result.message || '',
    last_http_status: result.debug?.http_status || null,
    last_response_host: result.debug?.final_url_host || result.debug?.url_host || '',
    last_response_head: result.debug?.response_head || '',
    last_parsed_keys: result.debug?.parsed_keys || '',
    last_active_value: '',
    last_status_text: result.raw && typeof result.raw === 'object' ? `ok=${String(result.raw.ok)}` : '',
    last_network_error: result.network_error ? (result.debug?.error || result.message || '') : '',
    last_device: result.debug?.device || ''
  });
  if (state.valid && !isTimeValid(state.expires_at)) {
    state.valid = false;
    state.message = 'Lizenz abgelaufen.';
  }
  await persistLicenseState(state);
  return { ok: state.valid, message: state.message, licenseState: state };
}

async function ensureLicenseForScan() {
  const result = await checkStoredLicense();
  if (!result.ok) return result;
  if (!isTimeValid(result.licenseState?.expires_at)) {
    const expiredState = normalizeLicenseState({ ...(result.licenseState || {}), valid: false, message: 'Lizenz abgelaufen.' });
    await persistLicenseState(expiredState);
    return { ok: false, message: 'Lizenz abgelaufen.', licenseState: expiredState };
  }
  return result;
}

function isLostTabError(err) {
  const msg = String(err && (err.message || err) || '');
  return /No tab with id|Invalid tab ID|Cannot access.*tab|Tabs cannot be edited|No window with id/i.test(msg);
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try { await chrome.tabs.get(tabId); return true; } catch { return false; }
}

async function replaceRuntimeTabId(oldTabId, newTabId) {
  const ids = Array.isArray(runtimeState.currentTabIds) ? runtimeState.currentTabIds.slice() : [];
  const idx = ids.indexOf(oldTabId);
  if (idx >= 0) ids[idx] = newTabId;
  else if (newTabId) ids.push(newTabId);
  runtimeState.currentTabIds = [...new Set(ids.filter(Boolean))];
  await persistRuntime();
}

async function recreateWorkerTab(oldTabId, reason = 'tab_lost') {
  try { if (oldTabId) await chrome.tabs.remove(oldTabId); } catch {}
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  await replaceRuntimeTabId(oldTabId, tab.id);
  await logEvent('Worker-Tab neu erstellt (' + reason + ')', { oldTabId, newTabId: tab.id });
  await sleep(250);
  return tab.id;
}

async function openOrFocusDashboard() {
  const tabs = await chrome.tabs.query({ url: DASHBOARD_URL });
  if (tabs.length) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return tab;
  }
  return chrome.tabs.create({ url: DASHBOARD_URL, active: true });
}

async function createWorkerTabs(count) {
  const tabs = [];
  for (let i = 0; i < count; i++) {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    tabs.push(tab);
  }
  runtimeState.currentTabIds = tabs.map(t => t.id).filter(Boolean);
  await persistRuntime();
  return tabs;
}

async function safeRemoveTabs(tabIds = []) {
  for (const tabId of tabIds) {
    try { await chrome.tabs.remove(tabId); } catch {}
  }
}

async function navigateTab(tabId, url, cfg = DEFAULT_CFG, opts = {}) {
  let lastErr;
  const attempts = 1 + Number(cfg.retry_count || 0);
  const active = Boolean(opts.active);
  const timeoutMs = Number(opts.timeoutMs || Number(cfg.page_timeout_sec || 18) * 1000);
  for (let i = 0; i < attempts; i++) {
    if (runtimeState.stopRequested) throw new Error('Scan gestoppt');
    try {
      if (!(await tabExists(tabId))) throw new Error('No tab with id: ' + tabId);
      const updated = await chrome.tabs.update(tabId, { url, active });
      if (active && updated?.windowId) {
        try { await chrome.windows.update(updated.windowId, { focused: true }); } catch {}
      }
      await waitForTabComplete(tabId, timeoutMs);
      await sleep(active ? 900 + i * 500 : 300 + i * 250);
      return;
    } catch (err) {
      lastErr = err;
      if (isLostTabError(err)) throw err;
      await sleep(700 + i * 900);
    }
  }
  throw lastErr || new Error('Tab konnte nicht geladen werden');
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => finish(false, new Error('Tab load timeout')), timeoutMs);
    function finish(ok, err) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      ok ? resolve() : reject(err);
    }
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') finish(true);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') finish(true);
    }).catch(err => finish(false, err));
  });
}

async function runInTab(tabId, func, args = []) {
  if (!(await tabExists(tabId))) throw new Error('No tab with id: ' + tabId);
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return results?.[0]?.result;
}

async function waitForConditionInTab(tabId, predicate, timeoutMs = 8000, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await runInTab(tabId, predicate);
      if (ok) return true;
    } catch {}
    await sleep(intervalMs);
  }
  return false;
}


function extractPlayerLinksFromHtml(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const re = /href=["']([^"']*\/player\/[^"'#?]+(?:\?[^"'#]*)?)/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try {
      const abs = new URL(m[1].replaceAll('&amp;', '&'), pageUrl).toString().split('#')[0];
      if (!seen.has(abs)) { seen.add(abs); out.push(abs); }
    } catch {}
  }
  return out;
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function collectLinksForPageFast(cfg, pageNo) {
  const base = buildPlayersUrl(cfg);
  const url = `${base}&page=${pageNo}`;
  const timeoutMs = Math.max(8000, Math.min(30000, Number(cfg.page_timeout_sec || 18) * 1000));
  const html = await fetchTextWithTimeout(url, timeoutMs);
  const links = extractPlayerLinksFromHtml(html, url);
  if (!links.length) throw new Error('fetch returned no player links');
  return links;
}

async function collectLinksForPage(tabId, cfg, pageNo) {
  // v1.5.2: Clean stable mode for Futbin.
  // No service-worker fetch and no parallel background link collection.
  // The list pages are loaded in one real foreground tab so Futbin cookies/Cloudflare/session are used.
  const base = buildPlayersUrl(cfg);
  const url = `${base}&page=${pageNo}`;
  const linkTimeoutMs = Math.max(25000, Math.min(60000, Number(cfg.page_timeout_sec || 30) * 1000));
  await navigateTab(tabId, url, cfg, { active: true, timeoutMs: linkTimeoutMs });

  // Consent / cookie popups can hide the real list on some systems.
  try {
    await runInTab(tabId, () => {
      const labels = ['Accept', 'I Agree', 'I agree', 'Agree', 'Got it', 'OK', 'Okay', 'Consent', 'Akzeptieren', 'Alle akzeptieren'];
      for (const btn of Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))) {
        const txt = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim();
        if (labels.some(l => txt.toLowerCase().includes(l.toLowerCase()))) {
          try { btn.click(); } catch {}
          break;
        }
      }
    });
  } catch {}

  let hasLinks = await waitForConditionInTab(tabId, () => {
    return document.querySelectorAll("a[href*='/player/']").length > 0;
  }, 22000, 500);

  // Some pages lazy-render the table/list only after scrolling.
  if (!hasLinks) {
    try {
      await runInTab(tabId, async () => {
        for (let i = 0; i < 6; i++) {
          window.scrollBy(0, 900);
          await new Promise(r => setTimeout(r, 250));
        }
        window.scrollTo(0, 0);
      });
    } catch {}
    hasLinks = await waitForConditionInTab(tabId, () => {
      return document.querySelectorAll("a[href*='/player/']").length > 0;
    }, 12000, 500);
  }

  if (!hasLinks) {
    const snap = await runInTab(tabId, () => ({
      title: document.title || '',
      url: location.href || '',
      body: (document.body?.innerText || '').slice(0, 600),
      playerLinks: document.querySelectorAll("a[href*='/player/']").length,
      anchors: document.querySelectorAll('a').length
    })).catch(() => ({}));
    const body = String(snap.body || '').toLowerCase();
    if (body.includes('access denied') || body.includes('forbidden') || body.includes('cloudflare') || body.includes('checking your browser')) {
      throw new Error('Futbin blockiert/Cloudflare im Tab — Futbin im Tab öffnen und Prüfung abschließen');
    }
    throw new Error(`Keine Spielerlinks im aktiven Futbin-Tab gefunden (Titel: ${String(snap.title || '').slice(0, 80)})`);
  }

  const links = await runInTab(tabId, () => {
    return Array.from(document.querySelectorAll("a[href*='/player/']"))
      .map(a => a.href.split('#')[0])
      .filter(Boolean)
      .filter((href, idx, arr) => arr.indexOf(href) === idx);
  });
  await sleep(500);
  return Array.isArray(links) ? links : [];
}

async function collectPlayerLinks(tabIds, cfg) {
  // Sauberer Weg: ein sichtbarer Link-Tab, sequenziell. Danach können die Spieler wieder parallel geprüft werden.
  const all = [];
  const maxAttempts = 1 + Number(cfg.retry_count || 0);
  const totalPages = Number(cfg.pages_to_scan || 12);
  const permanentlyFailed = [];
  let finishedPages = 0;
  runtimeState.pagesRead = 0;
  runtimeState.totalPages = totalPages;
  await persistRuntime();

  let linkTabId = tabIds[0];
  if (!(await tabExists(linkTabId))) linkTabId = await recreateWorkerTab(linkTabId, 'link_tab_missing');

  // Warmup: one visible Futbin load before page loop. This is where Cloudflare/cookies can settle.
  try {
    await setStatus('Öffne Futbin sichtbar zum Aufwärmen...', 0.01);
    await navigateTab(linkTabId, 'https://www.futbin.com/', cfg, { active: true, timeoutMs: 45000 });
    await sleep(1800);
  } catch (err) {
    await logEvent('Futbin-Warmup fehlgeschlagen, versuche trotzdem weiter', { error: err?.message || String(err) });
  }

  for (let pageNo = 1; pageNo <= totalPages && !runtimeState.stopRequested; pageNo++) {
    let success = false;
    let lastMsg = '';
    for (let attempt = 1; attempt <= maxAttempts && !runtimeState.stopRequested; attempt++) {
      await setStatus(`Lese Spieler-Seite ${pageNo}/${totalPages} sichtbar · Versuch ${attempt}/${maxAttempts}`, (finishedPages / Math.max(1, totalPages)) * 0.15);
      try {
        if (!(await tabExists(linkTabId))) linkTabId = await recreateWorkerTab(linkTabId, 'link_tab_lost');
        const links = await collectLinksForPage(linkTabId, cfg, pageNo);
        all.push(...links);
        await logEvent(`Seite ${pageNo}: ${links.length} Spielerlinks gefunden${attempt > 1 ? ` nach Versuch ${attempt}` : ''}`);
        success = true;
        break;
      } catch (err) {
        lastMsg = err?.message || String(err);
        runtimeState.lastError = `Seite ${pageNo}: ${lastMsg}`.slice(0, 220);
        await logEvent(`Seite ${pageNo}: Retry wird eingeplant (${attempt}/${maxAttempts})`, { error: lastMsg });
        if (isLostTabError(err)) linkTabId = await recreateWorkerTab(linkTabId, 'link_tab_lost');
        await sleep(1200 + attempt * 1500);
      }
    }
    finishedPages += 1;
    runtimeState.pagesRead = finishedPages;
    if (!success) {
      permanentlyFailed.push(pageNo);
      runtimeState.errors += 1;
      await logEvent(`Seite ${pageNo}: endgültig übersprungen`, { error: lastMsg });
    }
    await persistRuntime();
  }

  if (permanentlyFailed.length) {
    await logEvent(`Link-Sammlung abgeschlossen. Übersprungene Seiten: ${permanentlyFailed.join(', ')}`);
  }
  return [...new Set(all)];
}

async function scrapePlayerPage(tabId, platform) {
  return runInTab(tabId, (platformArg) => {
    const plat = (platformArg || 'ps').toLowerCase() === 'pc' ? 'pc' : 'ps';
    const box = document.querySelector(`.price-box.platform-${plat}-only`) || document.querySelector('.price-box');
    const parsePrice = (txt) => {
      if (!txt) return 0;
      const digs = String(txt).match(/\d+/g);
      return digs ? parseInt(digs.join(''), 10) : 0;
    };
    if (!box) return null;
    const player = (document.querySelector('.player_name')?.textContent || document.querySelector('h1')?.textContent || document.title.split('-')[0] || '').trim();
    const first = parsePrice(box.querySelector('.lowest-price-1')?.textContent || '');
    const rows = Array.from(box.querySelectorAll('.lowest-prices-wrapper .lowest-price'));
    const list = rows.map(r => parsePrice(r.textContent || '')).filter(n => n > 0);
    const allPrices = [first, ...list].filter(n => n > 0);
    const visiblePrices = [...new Set(allPrices)];
    return {
      player,
      first,
      second: visiblePrices[1] || 0,
      third: visiblePrices[2] || 0,
      fourth: visiblePrices[3] || 0,
      last: list.length ? list[list.length - 1] : first,
      visiblePrices,
      url: location.href.split('#')[0]
    };
  }, [platform]);
}

async function scrapeSalesPage(tabId) {
  return runInTab(tabId, () => {
    const parsePrice = (txt) => {
      if (!txt) return 0;
      let s = String(txt).trim().toUpperCase().replace(/\s+/g, '').replace(/,/g, '');
      const m = s.match(/^(\d+(?:\.\d+)?)K$/);
      if (m) return Math.round(parseFloat(m[1]) * 1000);
      const digs = s.match(/\d+/g);
      return digs ? parseInt(digs.join(''), 10) : 0;
    };
    const parseAbsoluteDate = (raw) => {
      if (!raw) return -1;
      const cleaned = String(raw).trim().replace(/\s+/g, ' ');
      const candidates = [cleaned];
      if (!/\b20\d{2}\b/.test(cleaned)) candidates.push(`${cleaned}, ${new Date().getFullYear()}`);
      for (const candidate of candidates) {
        const dt = new Date(candidate);
        if (!Number.isNaN(dt.getTime())) return Math.max(0, Math.round((Date.now() - dt.getTime()) / 60000));
      }
      return -1;
    };
    const parseAgeMin = (txt, attrs = []) => {
      const values = [txt, ...attrs].map(x => String(x || '').trim()).filter(Boolean);
      for (const raw of values) {
        const s = raw.toLowerCase();
        if (s.includes('just now') || s === 'now') return 0;
        const numMatch = s.match(/\d+/);
        const n = numMatch ? parseInt(numMatch[0], 10) : ((s.includes('a ') || s.includes('an ')) ? 1 : -1);
        if (n >= 0) {
          if (s.includes('sec')) return 0;
          if (s.includes('min')) return n;
          if (s.includes('hour') || s.includes('hr')) return n * 60;
          if (s.includes('day')) return n * 1440;
          if (s.includes('week')) return n * 10080;
        }
        if (s.includes('yesterday')) return 1440;
        const abs = parseAbsoluteDate(raw);
        if (abs >= 0) return abs;
      }
      return -1;
    };
    return Array.from(document.querySelectorAll('table tbody tr')).slice(0, 90).map(r => {
      const tds = r.querySelectorAll('td');
      const timeEl = tds[0] ? (tds[0].querySelector('.sales-date-time, time, [title], [datetime], [data-original-title], [aria-label]') || tds[0]) : null;
      const sold = tds[2] ? parsePrice(tds[2].textContent) : 0;
      const age_min = parseAgeMin(timeEl ? timeEl.textContent : '', timeEl ? [
        timeEl.getAttribute('title'),
        timeEl.getAttribute('datetime'),
        timeEl.getAttribute('data-original-title'),
        timeEl.getAttribute('aria-label')
      ].filter(Boolean) : []);
      return { sold, age_min };
    }).filter(x => x.sold > 0);
  });
}

async function processLink(tabId, link, cfg) {
  await navigateTab(tabId, link, cfg);
  await waitForConditionInTab(tabId, () => document.querySelector('.price-box') || document.querySelector('.lowest-price-1'), 9000);
  const player = await scrapePlayerPage(tabId, cfg.platform);
  if (!player || !player.first) return { accepted: false, reason: 'missing_player_price' };
  if (player.first < Number(cfg.price_min) || player.first > Number(cfg.price_max)) return { accepted: false, reason: 'price_out_of_range' };

  const salesUrl = new URL(link.replace('/player/', '/sales/'));
  salesUrl.searchParams.set('platform', (cfg.platform || 'ps').toLowerCase() === 'pc' ? 'pc' : 'ps');
  await navigateTab(tabId, salesUrl.toString(), cfg);
  await waitForConditionInTab(tabId, () => document.querySelectorAll('table tbody tr').length > 0, 9000);
  const salesRows = await scrapeSalesPage(tabId);
  const analysed = analysePlayer({ cfg, player, salesRows });
  if (analysed.accepted) {
    const exists = runtimeState.deals.some(d => d.url === analysed.deal.url && d.first === analysed.deal.first);
    if (!exists) runtimeState.deals.unshift({ ...analysed.deal, found_at: new Date().toISOString() });
    runtimeState.deals = runtimeState.deals.slice(0, 150);
  }
  return analysed;
}

function bumpReject(reason) {
  const key = reason || 'unknown';
  runtimeState.rejectReasons[key] = (runtimeState.rejectReasons[key] || 0) + 1;
}

async function runSingleScan(tabIds, cfg) {
  await setStatus('Sammle Spieler-Links parallel...', 0);
  const links = await collectPlayerLinks(tabIds, cfg);
  runtimeState.totalLinks = links.length;
  runtimeState.processed = 0;
  runtimeState.skipped = 0;
  runtimeState.rejectReasons = {};
  await persistRuntime();

  if (!links.length) {
    await setStatus('Keine Spieler-Links gefunden. Futbin evtl. blockiert oder DOM geändert.', 1);
    return;
  }

  await logEvent(`${links.length} eindeutige Spielerlinks gesammelt.`);
  let cursor = 0;
  const total = links.length;
  const workers = tabIds.map((initialTabId, workerIndex) => (async () => {
    let tabId = initialTabId;
    while (!runtimeState.stopRequested) {
      const index = cursor++;
      if (index >= total) break;
      const link = links[index];
      await setStatus(`Prüfe Spieler ${index + 1}/${total} · Worker ${workerIndex + 1}/${tabIds.length}`, 0.15 + Math.min(0.84, (runtimeState.processed / total) * 0.84));
      try {
        let result;
        try {
          result = await processLink(tabId, link, cfg);
        } catch (err) {
          if (!isLostTabError(err)) throw err;
          tabId = await recreateWorkerTab(tabId, 'player_worker_tab_lost');
          await sleep(400);
          result = await processLink(tabId, link, cfg);
        }
        if (!result?.accepted) {
          runtimeState.skipped += 1;
          bumpReject(result?.reason || 'unknown');
        }
      } catch (err) {
        runtimeState.errors += 1;
        runtimeState.skipped += 1;
        bumpReject(isLostTabError(err) ? 'tab_lost' : 'page_error');
        runtimeState.lastError = (link + ': ' + (err?.message || err)).slice(0, 220);
      }
      runtimeState.processed += 1;
      runtimeState.progress = 0.15 + Math.min(0.84, (runtimeState.processed / total) * 0.84);
      runtimeState.status = `Deals: ${runtimeState.deals.length} | geprüft: ${runtimeState.processed}/${total} | Fehler: ${runtimeState.errors}`;
      await persistRuntime();
      await sleep(70);
    }
  })());

  await Promise.all(workers);
  await setStatus(`Scan fertig. ${runtimeState.deals.length} Deal(s), ${runtimeState.errors} Fehler.`, 1);
}

async function startLoop(cfg) {
  runtimeState = { ...freshRuntimeState(), running: true, stopRequested: false, lastRunAt: Date.now(), version: VERSION };
  await persistRuntime();
  await openOrFocusDashboard();

  const workerTabs = await createWorkerTabs(cfg.concurrency);
  const workerTabIds = workerTabs.map(t => t.id).filter(Boolean);

  try {
    while (!runtimeState.stopRequested) {
      runtimeState.deals = [];
      runtimeState.processed = 0;
      runtimeState.totalLinks = 0;
      runtimeState.pagesRead = 0;
      runtimeState.totalPages = 0;
      runtimeState.errors = 0;
      runtimeState.skipped = 0;
      runtimeState.rejectReasons = {};
      runtimeState.lastError = '';
      await persistRuntime();
      await runSingleScan(workerTabIds, cfg);
      if (runtimeState.stopRequested) break;
      await setStatus(`Warte ${cfg.interval_min} Minute(n) bis zum nächsten Lauf...`, 1);
      const waitUntil = Date.now() + Number(cfg.interval_min || 3) * 60 * 1000;
      while (!runtimeState.stopRequested && Date.now() < waitUntil) {
        const sec = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));
        runtimeState.status = `Nächster Lauf in ${sec}s · Deals: ${runtimeState.deals.length}`;
        await persistRuntime();
        await sleep(Math.min(5000, waitUntil - Date.now()));
      }
    }
  } finally {
    runtimeState.running = false;
    runtimeState.stopRequested = false;
    await safeRemoveTabs(runtimeState.currentTabIds || []);
    runtimeState.currentTabIds = [];
    await setStatus('Bereit', runtimeState.progress);
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
