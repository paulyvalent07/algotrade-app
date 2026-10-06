/* AlgoTrade : couche données et calculs (aucun DOM, aucun style).
 * L'habillage (index.html, CSS) peut être remplacé librement : il suffit de lire
 * window.AlgoCore.state, d'écouter 'change' et d'appeler les actions ci-dessous.
 * Contrat des fichiers : voir DATA_CONTRACT.md. */
(function () {
  'use strict';

  /* ---------- utilitaires ---------- */
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const nf = (min, max) => new Intl.NumberFormat('fr-FR', {minimumFractionDigits: min, maximumFractionDigits: max});
  const fmt = {
    eur: (n, d = 0) => new Intl.NumberFormat('fr-FR', {style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d}).format(n),
    signed: (n, d = 2) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt.eur(Math.abs(n), d),
    pct: (n, d = 1) => nf(d, d).format(n) + ' %',
    num: n => nf(0, 0).format(n),
    ago(iso) {
      const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
      if (!isFinite(m)) return 'date inconnue';
      if (m < 1) return "à l'instant";
      if (m < 60) return `il y a ${m} min`;
      const h = Math.round(m / 60);
      return h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
    },
    dateTime: iso => new Date(iso).toLocaleString('fr-FR', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}),
    dateShort: iso => new Date(iso).toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit'}),
    dateLong: iso => new Date(iso).toLocaleDateString('fr-FR', {day: '2-digit', month: 'short', year: 'numeric'})
  };
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  /* ---------- état ---------- */
  const DEFAULTS = {repo: 'paulyvalent07/AlgoTrade', branch: 'main', dataBranch: 'app-data', token: ''};
  const state = {
    settings: {...DEFAULTS, ...ls.get('at.settings', {})},
    ledger: ls.get('at.ledger', {version: 1, accounts: ['XTB', 'Revolut', 'IG', 'Boursorama', 'Trade Republic'], movements: []}),
    ledgerSha: null,
    alerts: null, alertsErr: null,   // alertsErr : null | 'token' | message
    sfc: null, sfcErr: null,
    seen: new Set(ls.get('at.seen', [])),
    loading: false
  };
  const listeners = new Set();
  const emit = () => listeners.forEach(f => { try { f(state); } catch (e) { console.error(e); } });
  const on = (ev, f) => { if (ev === 'change') { listeners.add(f); return () => listeners.delete(f); } };

  /* ---------- calculs du capital ---------- */
  /* Mouvements : deposit (vers la réserve), allocate (réserve vers compte), withdraw (compte vers réserve),
   * payout (réserve vers la banque), valuation (valeur actuelle d'un compte, saisie à la main). */
  function computeLedger(ledger, upTo) {
    const names = ledger.accounts;
    const acc = Object.fromEntries(names.map(n => [n, {invested: 0, value: 0}]));
    let reserve = 0;
    const mv = ledger.movements.map((m, i) => ({...m, i})).filter(m => !upTo || m.date <= upTo)
      .sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i);
    for (const m of mv) {
      const a = acc[m.account];
      switch (m.type) {
        case 'deposit': reserve += m.amount; break;
        case 'payout': reserve -= m.amount; break;
        case 'allocate': reserve -= m.amount; if (a) { a.invested += m.amount; a.value += m.amount; } break;
        case 'withdraw': reserve += m.amount; if (a) { a.invested -= m.amount; a.value -= m.amount; } break;
        case 'valuation': if (a) a.value = m.amount; break;
      }
    }
    const value = names.reduce((s, n) => s + acc[n].value, 0);
    const invested = names.reduce((s, n) => s + acc[n].invested, 0);
    return {reserve, acc, value, invested, perf: value - invested, total: reserve + value};
  }

  /* Photos de la répartition à chaque date de mouvement (les `max` dernières). */
  function snapshots(ledger, max = 12) {
    const dates = [...new Set(ledger.movements.map(m => m.date))].sort().slice(-max);
    return dates.map(d => {
      const c = computeLedger(ledger, d);
      return {date: d, reserve: c.reserve, values: Object.fromEntries(ledger.accounts.map(n => [n, c.acc[n].value])), total: c.total};
    });
  }

  /* Résumé de SFC prêt à afficher. */
  function sfcSummary(sfc) {
    if (!sfc) return null;
    const {state: st, heartbeat: hb, log} = sfc;
    const ageMin = (Date.now() - new Date(hb.ts).getTime()) / 60000;
    const exits = log.filter(r => r.event === 'EXIT').sort((a, b) => b.ts.localeCompare(a.ts));
    const pnl = r => parseFloat(r.pnl_eur) || 0;
    return {
      alive: ageMin < 130, lastCycle: hb.ts,
      cum: st.cum_pnl || 0, capital: st.trading_capital || 0,
      week: exits.filter(r => Date.now() - new Date(r.ts).getTime() < 7 * 864e5).reduce((s, r) => s + pnl(r), 0),
      errors24h: log.filter(r => /error/.test(r.event) && Date.now() - new Date(r.ts).getTime() < 864e5).length,
      positions: Object.entries(st.positions || {}).map(([symbol, p]) => ({
        symbol, side: p.side, entry: +p.entry, tp: +p.tp, sl: +p.sl, notional: p.notional,
        since: p.entry_ts.replace(' ', 'T') + 'Z', real: !!p.deal_id
      })),
      exits: exits.slice(0, 8).map(r => ({symbol: r.symbol, ts: r.ts, pnl: pnl(r), reason: r.reason}))
    };
  }

  /* ---------- GitHub ---------- */
  const ghHeaders = accept => {
    const h = {Accept: accept, 'X-GitHub-Api-Version': '2022-11-28'};
    if (state.settings.token) h.Authorization = 'Bearer ' + state.settings.token;
    return h;
  };
  const ghUrl = p => `https://api.github.com/repos/${state.settings.repo}/contents/${p}`;
  async function ghRaw(path, branch = state.settings.branch) {
    const r = await fetch(`${ghUrl(path)}?ref=${encodeURIComponent(branch)}`, {headers: ghHeaders('application/vnd.github.raw+json'), cache: 'no-store'});
    if (r.status === 404) { const e = new Error('404'); e.code = 404; throw e; }
    if (!r.ok) throw new Error('GitHub ' + r.status);
    return r.text();
  }
  async function ghJsonWithSha(path, branch = state.settings.dataBranch) {
    const r = await fetch(`${ghUrl(path)}?ref=${encodeURIComponent(branch)}`, {headers: ghHeaders('application/vnd.github+json'), cache: 'no-store'});
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const j = await r.json();
    const bin = atob(j.content.replace(/\n/g, ''));
    return {data: JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))), sha: j.sha};
  }
  async function ghPut(path, obj, sha, message) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2) + '\n');
    let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
    const body = {message, content: btoa(bin), branch: state.settings.dataBranch};
    if (sha) body.sha = sha;
    const r = await fetch(ghUrl(path), {method: 'PUT', headers: {...ghHeaders('application/vnd.github+json'), 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    if (!r.ok) { const e = new Error('GitHub ' + r.status); e.code = r.status; throw e; }
    return (await r.json()).content.sha;
  }
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (ch !== '\r') f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const head = rows.shift() || [];
    return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  }
  const needToken = e => e && (e.code === 404 || /GitHub 40[134]/.test(e.message)) && !state.settings.token;

  /* ---------- chargement ---------- */
  async function loadAlerts() {
    try {
      const j = JSON.parse(await ghRaw('data/alerts.json', state.settings.dataBranch));
      state.alerts = (j.alerts || []).slice().sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
      state.alertsErr = null;
    } catch (e) {
      if (e.code === 404 && state.settings.token) { state.alerts = []; state.alertsErr = null; }
      else { state.alerts = null; state.alertsErr = needToken(e) ? 'token' : e.message; }
    }
  }
  async function loadSfc() {
    try {
      const [st, hb, log] = await Promise.all([ghRaw('state.json'), ghRaw('heartbeat.json'), ghRaw('bot_log.csv')]);
      state.sfc = {state: JSON.parse(st), heartbeat: JSON.parse(hb), log: parseCSV(log)};
      state.sfcErr = null;
    } catch (e) { state.sfc = null; state.sfcErr = needToken(e) ? 'token' : e.message; }
  }
  function mergeLedger(local, remote) {
    const ids = new Set(remote.movements.map(m => m.id));
    return {...remote, movements: [...remote.movements, ...local.movements.filter(m => !ids.has(m.id) && m.pending)]};
  }
  async function loadLedgerRemote() {
    if (!state.settings.token) return;
    try {
      const r = await ghJsonWithSha('data/ledger.json');
      if (r) { state.ledger = mergeLedger(state.ledger, r.data); state.ledgerSha = r.sha; ls.set('at.ledger', state.ledger); }
    } catch (e) { /* le registre local reste valable */ }
  }
  async function loadAll() {
    state.loading = true; emit();
    await Promise.allSettled([loadAlerts(), loadSfc(), loadLedgerRemote()]);
    state.loading = false; emit();
  }

  /* ---------- actions sur le registre ---------- */
  const strip = l => ({...l, movements: l.movements.map(({pending, ...m}) => m)});
  async function saveLedger(message) {
    ls.set('at.ledger', state.ledger); emit();
    if (!state.settings.token) return 'local';
    try {
      state.ledgerSha = await ghPut('data/ledger.json', strip(state.ledger), state.ledgerSha, message);
    } catch (e) {
      if (e.code !== 409 && e.code !== 422) return 'echec:' + e.message;
      try {   // conflit : on relit la version distante et on y rajoute nos mouvements en attente
        const r = await ghJsonWithSha('data/ledger.json');
        const local = {...state.ledger, movements: state.ledger.movements.map(m => ({...m, pending: m.pending ?? true}))};
        state.ledger = r ? mergeLedger(local, r.data) : state.ledger;
        state.ledgerSha = await ghPut('data/ledger.json', strip(state.ledger), r ? r.sha : null, message);
      } catch (e2) { return 'echec:' + e2.message; }
    }
    state.ledger.movements.forEach(m => delete m.pending);
    ls.set('at.ledger', state.ledger); emit();
    return 'sync';
  }
  /* Chaque action renvoie 'local' | 'sync' | 'echec:<raison>'. */
  function addMovement({type, account = null, amount, date, note = ''}) {
    if (!isFinite(amount) || amount < 0) throw new Error('Montant invalide');
    state.ledger.movements.push({id: uid(), date: date || todayISO(), type, account: (type === 'deposit' || type === 'payout') ? null : account,
      amount: Math.round(amount * 100) / 100, note, pending: true});
    return saveLedger('ledger: ' + type);
  }
  function deleteMovement(id) {
    state.ledger.movements = state.ledger.movements.filter(m => m.id !== id);
    return saveLedger('ledger: suppression');
  }
  function addAccount(name) {
    name = String(name || '').trim().slice(0, 40);
    if (!name || name === 'Réserve' || state.ledger.accounts.includes(name)) throw new Error('Nom invalide ou déjà utilisé');
    state.ledger.accounts.push(name);
    return saveLedger('ledger: nouveau compte ' + name);
  }

  /* ---------- autres actions ---------- */
  function saveSettings(s) {
    state.settings = {repo: (s.repo || '').trim() || DEFAULTS.repo, branch: (s.branch || '').trim() || DEFAULTS.branch,
      dataBranch: (s.dataBranch || '').trim() || DEFAULTS.dataBranch, token: (s.token || '').trim()};
    ls.set('at.settings', state.settings); state.ledgerSha = null; return loadAll();
  }
  const unseenCount = () => (state.alerts || []).filter(a => !state.seen.has(a.id)).length;
  function markAlertsSeen() {
    (state.alerts || []).forEach(a => state.seen.add(a.id)); ls.set('at.seen', [...state.seen]); emit();
  }

  window.AlgoCore = {state, on, fmt, todayISO, computeLedger, snapshots, sfcSummary, loadAll, saveSettings,
    addMovement, deleteMovement, addAccount, unseenCount, markAlertsSeen};
})();
