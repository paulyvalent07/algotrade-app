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
    num2: n => nf(2, 2).format(n),
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
  const DEFAULTS = {repo: 'paulyvalent07/AlgoTrade', branch: 'main', dataBranch: 'app-data', token: '', finnhub: '', simStake: 100, riskEur: 10, resetAt: '2026-10-09T10:46:00.000Z'};
  const state = {
    settings: {...DEFAULTS, ...ls.get('at.settings', {})},
    ledger: ls.get('at.ledger', {version: 1, accounts: ['XTB', 'Revolut', 'IG', 'Boursorama', 'Trade Republic'], movements: []}),
    ledgerSha: null,
    positions: ls.get('at.positions', {version: 1, positions: []}), positionsSha: null,
    quotes: ls.get('at.quotes', {positions: {}}),
    outcomes: {}, calib: null,
    stockQuotes: {},
    scans: [],
    alerts: null, alertsErr: null,   // alertsErr : null | 'token' | message
    seen: new Set(ls.get('at.seen', [])),
    dismissed: new Set(ls.get('at.dismissed', [])),
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

  /* Alertes notées 7/10 ou plus (celles qui déclenchent une notification) avec leur résultat mesuré par le workflow « données de marché »
   * (data/outcomes.json) : base de la courbe « si tu avais tout pris ». move = variation du sous-jacent en %, signée selon le sens. */
  function alertSignals() {
    const out = [], taken = takenIds(), N = window.AlgoNames, oc = state.outcomes || {};
    for (const a of (state.alerts || [])) {
      if (!afterReset(a.ts) || !(Number(a.conviction) >= 7)) continue;
      const o = oc[a.id]; if (!o || o.pct == null || !isFinite(o.pct)) continue;
      const open = o.result === 'en cours';
      out.push({id: a.id, ts: a.ts, exitTs: open ? null : (o.ts || a.ts), open, move: o.pct, stake: a.amount_eur, lev: a.category === 'cfd' ? levOf(a) : 1,
        name: N ? N.resolve(a).name : (a.title || a.ticker), taken: taken.has(a.id)});
    }
    return out;
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
  async function loadScans() {
    try { const j = JSON.parse(await ghRaw('data/scans.json', state.settings.dataBranch)); state.scans = (j.scans || []).slice().sort((a, b) => String(b.ts).localeCompare(String(a.ts))); }
    catch (e) { state.scans = []; }
  }
  async function loadOutcomes() {
    try { state.outcomes = JSON.parse(await ghRaw('data/outcomes.json', state.settings.dataBranch)).outcomes || {}; } catch (e) { /* pas encore calculé */ }
    try { state.calib = JSON.parse(await ghRaw('data/calibration.json', state.settings.dataBranch)); } catch (e) { /* pas encore calculé */ }
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
  async function loadPositionsRemote() {
    if (!state.settings.token) return;
    try {
      const r = await ghJsonWithSha('data/positions.json');
      if (r) { state.positions = mergePositions(state.positions, r.data); state.positionsSha = r.sha; ls.set('at.positions', state.positions); }
    } catch (e) { /* le suivi local reste valable */ }
    try {
      const q = await ghJsonWithSha('data/quotes.json');
      if (q) { state.quotes = q.data; ls.set('at.quotes', state.quotes); }
    } catch (e) { /* pas encore de cours */ }
  }
  /* Cours en direct des actions suivies (Finnhub, clé facultative saisie dans les réglages). */
  async function loadLive() { loadStocks(); }
  /* Actions suivies : cours en direct via Finnhub (clé gratuite saisie dans les réglages, gardée sur cet appareil). Actions US uniquement. */
  const stockSym = p => (p.category !== 'cfd' && /^[A-Z]{1,5}(\.[A-Z])?$/.test(p.ticker || '')) ? p.ticker : null;
  async function loadStocks() {
    const key = state.settings.finnhub; if (!key) return;
    const syms = [...new Set(state.positions.positions.filter(p => p.status !== 'closed').map(stockSym).filter(Boolean))].slice(0, 12);
    let any = false;
    await Promise.all(syms.map(async sym => {
      try {
        const r = await fetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(sym) + '&token=' + encodeURIComponent(key), {cache: 'no-store'});
        if (!r.ok) return; const d = await r.json();
        if (d && d.c > 0) { state.stockQuotes[sym] = {last: d.c, ts: d.t ? new Date(d.t * 1000).toISOString() : null, fetched: new Date().toISOString()}; any = true; }
      } catch (e) { /* hors ligne ou limite atteinte : on garde le dernier cours */ }
    }));
    if (any) emit();
  }
  async function loadAll() {
    state.loading = true; emit();
    await Promise.allSettled([loadAlerts(), loadScans(), loadOutcomes(), loadLedgerRemote(), loadPositionsRemote(), loadLive()]);
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


  /* ---------- suivi des positions ---------- */
  /* data/positions.json (écrit par l'app) : une position = une alerte cochée, considérée comme exécutée.
   * data/quotes.json (écrit par le suivi planifié) : derniers cours et touches de stop / objectif, indexés par id. */
  const clean = t => String(t ?? '').replace(/\d+(?:[.,]\d+)?\s*%/g, ' ');
  const NUM = /\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?/g;
  const toNum = x => parseFloat(x.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
  /* « 3 960-3 975 » (milieu), « ≤ 105 $ », « +8 % : 112 / +10 % : 115 » (premier niveau chiffré) */
  function parseLevel(text, kind) {
    if (!text) return null;
    let t = String(text);
    if (kind === 'target' && t.includes(':')) t = t.slice(t.indexOf(':') + 1);
    const nums = (clean(t).match(NUM) || []).map(toNum).filter(isFinite);
    if (!nums.length) return null;
    if (kind === 'entry' && nums.length >= 2 && /\d\s*[-–]\s*\d/.test(t)) return Math.round((nums[0] + nums[1]) / 2 * 1e4) / 1e4;
    return nums[0];
  }
  const levNum = l => parseFloat(String(l ?? '').replace(',', '.').replace(/[^\d.]/g, '')) || 1;
  /* Levier réel : celui de XTB (la référence) pour les CFD, sinon celui indiqué sur l'alerte. */
  function levOf(p) {
    const N = window.AlgoNames;
    if (N && p.category === 'cfd') { const x = N.xtbLeverage(p); if (x) return x; }
    return levNum(p.leverage);
  }
  /* Résultat d'une position à un prix donné : sur le sous-jacent, puis sur le montant alloué (levier inclus). */
  function pnlAt(p, price) {
    if (!isFinite(price) || !isFinite(p.entry) || p.entry <= 0) return null;
    const move = (price / p.entry - 1) * (p.direction === 'short' ? -1 : 1), lev = levOf(p);
    return {underlying: move * 100, pct: move * lev * 100, eur: p.amount * move * lev};
  }
  /* Position enrichie du dernier cours connu (écrit par le suivi planifié). */
  function positionView(p) {
    const q = {...((state.quotes.positions || {})[p.id] || {})};
    const ss = stockSym(p), st = ss ? state.stockQuotes[ss] : null;
    if (st && (!q.last_ts || st.fetched >= q.last_ts)) { q.last = st.last; q.last_ts = st.fetched; }
    const last = p.status === 'closed' ? p.exit?.price : (isFinite(q.last) ? q.last : null);
    const res = last != null ? pnlAt(p, last) : null;
    let hit = null;
    if (p.status !== 'closed') {
      hit = q.hit || null;
      if (!hit && last != null && st) {   // niveaux touchés d'après le cours en direct
        const long = p.direction !== 'short';
        if (Number.isFinite(p.stop) && (long ? last <= p.stop : last >= p.stop)) hit = 'stop';
        else if (Number.isFinite(p.target) && (long ? last >= p.target : last <= p.target)) hit = 'target';
      }
    }
    return {...p, last, last_ts: q.last_ts || null, hit, res, exit: p.status === 'closed' && p.exit && res ? {...p.exit, pct: res.pct, eur: res.eur} : p.exit};
  }
  function mergePositions(local, remote) {
    const byId = new Map(remote.positions.map(p => [p.id, p]));
    for (const p of local.positions) if (p.pending) byId.set(p.id, p);
    return {...remote, positions: [...byId.values()]};
  }
  const stripP = d => ({...d, positions: d.positions.map(({pending, ...p}) => p)});
  async function savePositions(message) {
    ls.set('at.positions', state.positions); emit();
    if (!state.settings.token) return 'local';
    const done = () => { state.positions.positions.forEach(p => delete p.pending); ls.set('at.positions', state.positions); emit(); return 'sync'; };
    try { state.positionsSha = await ghPut('data/positions.json', stripP(state.positions), state.positionsSha, message); return done(); }
    catch (e) {
      if (e.code !== 409 && e.code !== 422) return 'echec:' + e.message;
      try {
        const r = await ghJsonWithSha('data/positions.json');
        if (r) state.positions = mergePositions(state.positions, r.data);
        state.positionsSha = await ghPut('data/positions.json', stripP(state.positions), r ? r.sha : null, message); return done();
      } catch (e2) { return 'echec:' + e2.message; }
    }
  }
  /* ---------- risque fixe par trade ---------- */
  /* Mise (marge XTB) qui perd exactement `risk` € si le stop est touché : perte = mise × levier × écart au stop.
   * Si `stake` est donné, calcule à la place la perte, le gain et le rapport gain/risque de cette mise. */
  function calcRisk({risk, entry, stop, target, leverage, stake}) {
    const ok = v => isFinite(v) && v > 0;
    if (!ok(entry) || !ok(stop) || entry === stop) return null;
    const lev = ok(leverage) ? leverage : 1, dist = Math.abs(entry - stop) / entry;
    const suggested = ok(risk) ? Math.floor(risk / (dist * lev) * 100) / 100 : null;
    const st = ok(stake) ? stake : suggested; if (!ok(st)) return null;
    const loss = st * lev * dist, gain = ok(target) ? st * lev * Math.abs(target - entry) / entry : null;
    return {lev, dist, suggested, stake: st, notional: st * lev, loss, gain, rr: gain != null && loss > 0 ? gain / loss : null};
  }
  const REASONS = ['Signal solide', 'Tendance confirmée', 'Actualité', 'Intuition', 'Autre'];
  function cleanJournal(note, reason) {
    const out = {}, n = String(note || '').trim().slice(0, 600);
    if (n) out.note = n;
    if (REASONS.includes(reason)) out.reason = reason;
    return out;
  }
  function saveJournal(id, note, reason) {
    const p = state.positions.positions.find(x => x.id === id); if (!p) return 'echec:introuvable';
    delete p.note; delete p.reason;
    return updatePosition(id, cleanJournal(note, reason), 'suivi: journal');
  }

  const takenIds = () => new Set(state.positions.positions.map(p => p.alertId));
  function takePosition(alert, {amount, entry, stop, target, note, reason}) {
    if (!isFinite(amount) || amount <= 0) throw new Error('Montant invalide');
    if (!isFinite(entry) || entry <= 0) throw new Error("Prix d'entrée invalide");
    if (takenIds().has(alert.id)) throw new Error('Déjà suivie');
    state.positions.positions.push({id: uid(), alertId: alert.id, ticker: alert.ticker || '', title: alert.title || alert.ticker, category: alert.category,
      direction: alert.direction || 'long', leverage: (alert.category === 'cfd' && window.AlgoNames && window.AlgoNames.xtbLeverage(alert) ? 'x' + window.AlgoNames.xtbLeverage(alert) : alert.leverage) || null, amount: Math.round(amount * 100) / 100, entry,
      stop: isFinite(stop) ? stop : null, target: isFinite(target) ? target : null, ...cleanJournal(note, reason), status: 'open', openedAt: new Date().toISOString(), pending: true});
    return savePositions('suivi: ouverture ' + (alert.ticker || alert.title));
  }
  function updatePosition(id, patch, message) {
    const p = state.positions.positions.find(x => x.id === id); if (!p) return 'echec:introuvable';
    Object.assign(p, patch, {pending: true});
    return savePositions(message || 'suivi: mise à jour');
  }
  function closePosition(id, price) {
    const p = state.positions.positions.find(x => x.id === id); if (!p) return 'echec:introuvable';
    if (!isFinite(price) || price <= 0) throw new Error('Prix invalide');
    const r = pnlAt(p, price);
    return updatePosition(id, {status: 'closed', exit: {price, ts: new Date().toISOString(), pct: r.pct, eur: r.eur}}, 'suivi: clôture ' + p.ticker);
  }
  function deletePosition(id) {
    state.positions.positions = state.positions.positions.filter(p => p.id !== id);
    return savePositions('suivi: suppression');
  }

  /* ---------- notifications (Web Push) ---------- */
  const VAPID_PUBLIC = 'BD7kcZfmGEnBungpccsK0tEyR_dtuLY501OVJieGhopP4hPVqYVqS6KmxzpQ7ay0N5Gt1zVy-BvTksBO3FyLgkQ';
  const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function pushStatus() {
    if (!pushSupported()) return standalone() ? 'unsupported' : 'install';
    if (Notification.permission === 'denied') return 'denied';
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub && Notification.permission === 'granted') return 'on'; } catch (e) { /* ignore */ }
    return 'off';
  }
  async function enablePush() {
    if (!pushSupported()) throw new Error(standalone() ? "Ce navigateur ne gère pas les notifications" : "Ajoute d'abord l'app à l'écran d'accueil (Partager, puis Sur l'écran d'accueil), puis rouvre-la depuis l'icône");
    if (!state.settings.token) throw new Error("Ajoute d'abord ton jeton GitHub dans les réglages");
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications refusées dans les réglages de l’iPhone');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC)});
    const j = sub.toJSON(), entry = {endpoint: j.endpoint, keys: j.keys, ts: new Date().toISOString()};
    for (let i = 0; i < 2; i++) {
      const r = await ghJsonWithSha('data/push.json');
      const data = r ? r.data : {version: 1, subscriptions: []};
      data.subscriptions = (data.subscriptions || []).filter(x => x.endpoint !== entry.endpoint).concat(entry).slice(-5);
      try { await ghPut('data/push.json', data, r ? r.sha : null, 'push: abonnement'); return 'on'; }
      catch (e) { if (e.code !== 409 && e.code !== 422) throw e; }
    }
    throw new Error('Enregistrement impossible, réessaie');
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) {
      const ep = sub.endpoint; await sub.unsubscribe();
      try { const r = await ghJsonWithSha('data/push.json'); if (r) { r.data.subscriptions = (r.data.subscriptions || []).filter(x => x.endpoint !== ep); await ghPut('data/push.json', r.data, r.sha, 'push: désabonnement'); } } catch (e) { /* ignore */ }
    }
  }
  async function testNotification() {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('AlgoTrade', {body: "Les notifications fonctionnent sur cet appareil.", icon: 'icon-192.png', badge: 'icon-192.png', tag: 'test'});
  }

  /* Supprime un compte et ses mouvements : l'argent qui lui était alloué retourne à la réserve. */
  function deleteAccount(name) {
    if (!state.ledger.accounts.includes(name)) throw new Error('Compte introuvable');
    state.ledger.accounts = state.ledger.accounts.filter(n => n !== name);
    state.ledger.movements = state.ledger.movements.filter(m => m.account !== name);
    return saveLedger('ledger: suppression du compte ' + name);
  }


  /* Fixe le montant actuel d'un compte (ou de la réserve) : un mouvement « valuation » ou un ajustement de la réserve. */
  function setAmount(name, amount) {
    if (!isFinite(amount) || amount < 0) throw new Error('Montant invalide');
    amount = Math.round(amount * 100) / 100;
    const c = computeLedger(state.ledger);
    if (!c.acc[name]) throw new Error('Compte introuvable');
    if (Math.round(c.acc[name].value * 100) / 100 === amount) return Promise.resolve('sync');
    state.ledger.movements.push({id: uid(), date: todayISO(), type: 'valuation', account: name, amount, note: 'Mise à jour', pending: true});
    return saveLedger('ledger: mise à jour ' + name);
  }

  /* ---------- autres actions ---------- */
  function saveSettings(s) {
    state.settings = {repo: (s.repo || '').trim() || DEFAULTS.repo, branch: (s.branch || '').trim() || DEFAULTS.branch,
      dataBranch: (s.dataBranch || '').trim() || DEFAULTS.dataBranch, token: (s.token || '').trim(), finnhub: (s.finnhub || '').trim(),
      simStake: parseFloat(s.simStake) > 0 ? parseFloat(s.simStake) : DEFAULTS.simStake,
      riskEur: parseFloat(s.riskEur) > 0 ? parseFloat(s.riskEur) : DEFAULTS.riskEur, resetAt: state.settings.resetAt || DEFAULTS.resetAt};
    ls.set('at.settings', state.settings); state.ledgerSha = null; return loadAll();
  }
  /* Remise à zéro : les signaux du bot (alertes SFC et courbe « si tu avais tout pris ») ne comptent qu'à partir de cet instant.
   * Rien n'est supprimé : tes positions suivies restent, et le bot garde tout son historique. */
  function resetSignals() {
    state.settings = {...state.settings, resetAt: new Date().toISOString()};
    ls.set('at.settings', state.settings); emit(); return state.settings.resetAt;
  }
  const afterReset = ts => String(ts || '') >= (state.settings.resetAt || '');
  const unseenCount = () => (state.alerts || []).filter(a => afterReset(a.ts) && !state.seen.has(a.id) && !state.dismissed.has(a.id)).length;
  function dismissAlert(id) { state.dismissed.add(id); ls.set('at.dismissed', [...state.dismissed].slice(-500)); emit(); }
  function markAlertsSeen() {
    (state.alerts || []).forEach(a => state.seen.add(a.id)); ls.set('at.seen', [...state.seen]); emit();
  }

  window.AlgoCore = {alertSignals, levOf, loadLive, dismissAlert, state, on, fmt, todayISO, computeLedger, snapshots, loadAll, saveSettings,
    resetSignals, afterReset, addMovement, deleteMovement, addAccount, deleteAccount, unseenCount, markAlertsSeen,
    parseLevel, pnlAt, positionView, calcRisk, REASONS, saveJournal, takePosition, updatePosition, closePosition, deletePosition, takenIds,
    setAmount, pushStatus, enablePush, disablePush, testNotification};
})();
