const qs = (s) => document.querySelector(s);

function fmtInt(n) {
  try { return Number(n).toLocaleString('de-DE'); } catch { return String(n); }
}
function fmtPct(x) {
  try { return `${x >= 0 ? '+' : ''}${(Number(x) * 100).toFixed(1)}%`; } catch { return '+0.0%'; }
}
function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('de-DE');
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

let autoLicenseCheckDone = false;

function licenseDebugText(licenseState = {}) {
  const parts = [];
  if (licenseState.last_http_status) parts.push(`HTTP ${licenseState.last_http_status}`);
  if (licenseState.last_response_host) parts.push(licenseState.last_response_host);
  if (licenseState.last_active_value !== undefined && licenseState.last_active_value !== '') parts.push(`Aktiv=${licenseState.last_active_value}`);
  if (licenseState.last_network_error) parts.push(`Fehler=${licenseState.last_network_error}`);
  return parts.join(' · ');
}

function renderLicense(licenseState = {}) {
  const statusEl = qs('#licenseStatus');
  const metaEl = qs('#licenseMeta');
  const inputEl = qs('#license_key');
  const inputMainEl = qs('#license_key_main');
  const gateEl = qs('#licenseGate');
  if (licenseState.key) {
    inputEl.value = licenseState.key;
    if (inputMainEl) inputMainEl.value = licenseState.key;
  }

  if (licenseState.valid) {
    if (gateEl) gateEl.classList.add('hidden');
    statusEl.textContent = 'Lizenz aktiv';
    statusEl.className = 'licenseStatus ok';
    const dbg = licenseDebugText(licenseState);
    metaEl.textContent = `Ablauf: ${fmtDate(licenseState.expires_at)}${licenseState.last_checked_at ? ` · zuletzt geprüft: ${fmtDate(licenseState.last_checked_at)}` : ''}${dbg ? ` · ${dbg}` : ''}`;
    return;
  }

  if (gateEl) gateEl.classList.remove('hidden');

  if (licenseState.key) {
    statusEl.textContent = licenseState.message || 'Lizenz nicht aktiv';
    statusEl.className = 'licenseStatus bad';
    const parts = [];
    if (licenseState.expires_at) parts.push(`Ablauf: ${fmtDate(licenseState.expires_at)}`);
    if (licenseState.last_checked_at) parts.push(`zuletzt geprüft: ${fmtDate(licenseState.last_checked_at)}`);
    const dbg = licenseDebugText(licenseState);
    if (dbg) parts.push(dbg);
    metaEl.textContent = parts.join(' · ');
    return;
  }

  if (gateEl) gateEl.classList.remove('hidden');
  statusEl.textContent = 'Keine Lizenz aktiviert.';
  statusEl.className = 'licenseStatus warn';
  metaEl.textContent = 'Ohne aktive Lizenz startet der Scanner nicht.';
}

async function loadState() {
  const { config, runtimeState, licenseState } = await send({ type: 'GET_STATE' });
  qs('#platform').value = config.platform || 'ps';
  qs('#price_min').value = config.price_min ?? 20000;
  qs('#price_max').value = config.price_max ?? 60000;
  qs('#interval_min').value = config.interval_min ?? 3;
  qs('#pages_to_scan').value = config.pages_to_scan ?? 12;
  qs('#concurrency').value = config.concurrency ?? 3;
  if (qs('#page_timeout_sec')) qs('#page_timeout_sec').value = config.page_timeout_sec ?? 18;
  if (qs('#retry_count')) qs('#retry_count').value = config.retry_count ?? 2;

  qs('#status').textContent = runtimeState.status || 'Bereit';
  qs('#progress').value = Math.round((runtimeState.progress || 0) * 100);
  qs('#statDeals').textContent = fmtInt((runtimeState.deals || []).length);
  qs('#statProcessed').textContent = fmtInt(runtimeState.processed || 0);
  qs('#statTotal').textContent = fmtInt(runtimeState.totalLinks || 0);
  if (qs('#statErrors')) qs('#statErrors').textContent = fmtInt(runtimeState.errors || 0);
  if (qs('#statSkipped')) qs('#statSkipped').textContent = fmtInt(runtimeState.skipped || 0);
  renderDiagnostics(runtimeState || {});
  renderDeals(runtimeState.deals || []);
  renderLicense(licenseState || {});
  const licenseOk = !!(licenseState && licenseState.valid);
  qs('#startBtn').disabled = !!runtimeState.running || !licenseOk;
  qs('#startBtn').title = licenseOk ? '' : 'Bitte zuerst Lizenz aktivieren';
  qs('#stopBtn').disabled = !runtimeState.running;
}

async function autoCheckLicenseOnce() {
  if (autoLicenseCheckDone) return;
  autoLicenseCheckDone = true;
  const data = await send({ type: 'GET_STATE' });
  const state = data?.licenseState || {};
  if (state.key) {
    qs('#status').textContent = 'Prüfe Lizenz live...';
    await send({ type: 'CHECK_LICENSE' });
    await loadState();
  }
}

function currentConfig() {
  return {
    platform: qs('#platform').value,
    price_min: Number(qs('#price_min').value),
    price_max: Number(qs('#price_max').value),
    interval_min: Number(qs('#interval_min').value),
    pages_to_scan: Number(qs('#pages_to_scan').value),
    concurrency: Number(qs('#concurrency').value),
    page_timeout_sec: Number(qs('#page_timeout_sec')?.value || 18),
    retry_count: Number(qs('#retry_count')?.value || 2)
  };
}


function renderDiagnostics(runtimeState) {
  const root = qs('#diagnosticsText');
  if (!root) return;
  const reasons = Object.entries(runtimeState.rejectReasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `<span class="pill">${escapeHtml(k)}: ${fmtInt(v)}</span>`)
    .join(' ');
  const lines = [];
  lines.push(`Version: ${escapeHtml(runtimeState.version || '—')} · Seiten: ${fmtInt(runtimeState.pagesRead || 0)}/${fmtInt(runtimeState.totalPages || 0)} · Fortschritt: ${Math.round((runtimeState.progress || 0) * 100)}%`);
  if (runtimeState.lastError) lines.push(`Letzter Fehler: ${escapeHtml(runtimeState.lastError)}`);
  if (reasons) lines.push(`Reject-Gründe: ${reasons}`);
  const log = (runtimeState.debugLog || []).slice(0, 3).map(e => `<div class="logLine">${escapeHtml(new Date(e.ts).toLocaleTimeString('de-DE'))}: ${escapeHtml(e.message || '')}${e.error ? ' — ' + escapeHtml(e.error) : ''}</div>`).join('');
  root.innerHTML = lines.map(x => `<div>${x}</div>`).join('') + log;
}

function renderDeals(deals) {
  const root = qs('#deals');
  if (!deals.length) {
    root.innerHTML = '<div class="empty">Noch keine Deals gefunden.</div>';
    return;
  }
  root.innerHTML = deals.map(deal => {
    const trendClass = deal.trend > 0 ? 'trendUp' : deal.trend < 0 ? 'trendDown' : 'trendFlat';
    const trendSymbol = deal.trend > 0 ? '▲' : deal.trend < 0 ? '▼' : '•';
    const salesPerHour = Number.isFinite(Number(deal.sales_per_hour)) ? Number(deal.sales_per_hour).toFixed(1) : '—';
    return `
      <section class="card">
        <div class="cardTitle"><span>${escapeHtml((deal.player || 'Unknown').toUpperCase())}</span><span class="${trendClass}">${trendSymbol}</span></div>
        <div class="row2">
          <div><div class="metricLabel">BUY</div><div class="metricValue">${fmtInt(deal.first || 0)}</div></div>
          <div><div class="metricLabel">SELL</div><div class="metricValue">${fmtInt(deal.target_sell || 0)}</div></div>
        </div>
        <div class="profit">+ ${fmtInt(deal.profit || 0)} (${fmtPct(deal.undervalue_pct || 0)})</div>
        <div class="meta"><div>MARKTPR. P5</div><div>${fmtInt(deal.last || 0)}</div></div>
        <div class="meta"><div>SALES / H</div><div>${salesPerHour}</div></div>
        <div class="meta"><div>HIT RATIO</div><div>${deal.hit_count || 0} / ${deal.hits_needed || 0}</div></div>
        <a href="${deal.url}" target="_blank" rel="noreferrer">Futbin öffnen</a>
      </section>
    `;
  }).join('');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

qs('#startBtn').addEventListener('click', async () => {
  const config = currentConfig();
  await send({ type: 'SAVE_CONFIG', config });
  const res = await send({ type: 'START_SCAN', config });
  if (!res?.ok) {
    await loadState();
    return;
  }
  await loadState();
});

qs('#stopBtn').addEventListener('click', async () => {
  await send({ type: 'STOP_SCAN' });
  await loadState();
});

async function activateFromInput(selector) {
  const key = qs(selector).value.trim();
  const res = await send({ type: 'ACTIVATE_LICENSE', key });
  if (!res?.ok) {
    alert(res?.message || 'Lizenz konnte nicht aktiviert werden.');
  }
  await loadState();
}

qs('#activateLicenseBtn').addEventListener('click', () => activateFromInput('#license_key'));
qs('#activateLicenseBtnMain').addEventListener('click', () => activateFromInput('#license_key_main'));

qs('#checkLicenseBtn').addEventListener('click', async () => {
  qs('#status').textContent = 'Prüfe Lizenz live...';
  const res = await send({ type: 'CHECK_LICENSE' });
  if (!res?.ok) {
    alert(res?.message || 'Lizenzprüfung fehlgeschlagen.');
  }
  await loadState();
});

qs('#clearLicenseBtn')?.addEventListener('click', async () => {
  await send({ type: 'CLEAR_LICENSE' });
  await loadState();
});

qs('#refreshBtn').addEventListener('click', loadState);
qs('#clearDealsBtn')?.addEventListener('click', async () => {
  await send({ type: 'CLEAR_DEALS' });
  await loadState();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.runtimeState || changes.licenseState)) loadState();
});

loadState().then(autoCheckLicenseOnce);
