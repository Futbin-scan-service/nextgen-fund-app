import { buildPlayersUrl, analysePlayer, normalizePlatform, DEFAULT_SPECIAL_FILTER } from './scanner-core.js';

const DASHBOARD_URL = chrome.runtime.getURL('dashboard.html');
const LICENSE_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwLYXP3iHbAuXsKKDQoK3MGPZ8SiXaWfrvyozOI7lCrEIutphYqrMuoxx7ggaMlTZqa/exec';
const VERSION = '1.6.0-diff-specials';

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
  keep_debug_log: true,
  special_filter: DEFAULT_SPECIAL_FILTER
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
    keep_debug_log: cfg.keep_debug_log !== false,
    special_filter: String(cfg.special_filter ?? DEFAULT_SPECIAL_FILTER).trim()
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
    const plat = platformArg;
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
  }, [normalizePlatform(platform)]);
}

async function processLink(tabId, link, cfg) {
  await navigateTab(tabId, link, cfg);
  await waitForConditionInTab(tabId, () => document.querySelector('.price-box') || document.querySelector('.lowest-price-1'), 9000);
  const player = await scrapePlayerPage(tabId, cfg.platform);
  if (!player || !player.first) return { accepted: false, reason: 'missing_player_price' };
  if (player.first < Number(cfg.price_min) || player.first > Number(cfg.price_max)) return { accepted: false, reason: 'price_out_of_range' };

  const analysed = analysePlayer({ player });
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
  await setStatus('Sammle Special-Card-Links...', 0);
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
