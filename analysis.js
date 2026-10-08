/* AlgoTrade : graphiques d'analyse des positions en cours (SVG/HTML, sans dépendance).
 * Même principe que charts.js : les couleurs viennent des variables CSS (--up, --down, --series-N, --grid…). */
(function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const nfInt = v => new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0}).format(v);
  const tip = (t, r) => esc(JSON.stringify({t, r}));
  const niceStep = x => { const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  const fp = n => new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 4}).format(n);
  const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);

  /* Positions suivies -> lignes prêtes pour les graphiques (résultat, exposition, résultat au stop et à l'objectif). */
  function rows(views, C, N) {
    return views.map(p => {
      const id = N.resolve(p), lev = C.levOf(p);
      const at = v => (v != null && isFinite(v)) ? C.pnlAt(p, v) : null, s = at(p.stop), t = at(p.target);
      return {id: p.id, name: id.name, sym: id.xtb, cat: p.category, dir: p.direction === 'short' ? 'short' : 'long', lev, amount: p.amount, notional: p.amount * lev,
        eur: p.res ? p.res.eur : null, pct: p.res ? p.res.pct : null, entry: p.entry, stop: p.stop, target: p.target, last: p.last,
        lossAtStop: s ? s.eur : null, gainAtTarget: t ? t.eur : null};
    });
  }

  /* 1. Résultat par position : barres divergentes autour de zéro */
  function pnlBars(rs, F, N) {
    const R = rs.filter(r => r.eur != null).sort((a, b) => b.eur - a.eur);
    if (!R.length) return '';
    const W = 340, L = 108, RR = 66, rowH = 30, T = 4, H = T * 2 + R.length * rowH;
    const mn = Math.min(0, ...R.map(r => r.eur)), mx = Math.max(0, ...R.map(r => r.eur)), span = (mx - mn) || 1;
    const x = v => L + (v - mn) / span * (W - L - RR), x0 = x(0);
    let out = `<line class="axis" x1="${x0}" x2="${x0}" y1="${T}" y2="${H - T}"/>`;
    R.forEach((r, i) => {
      const cy = T + i * rowH + rowH / 2, xv = x(r.eur), w = Math.max(2, Math.abs(xv - x0)), up = r.eur >= 0;
      out += `<text x="0" y="${cy + 4}" class="label">${esc(N.short(r.name, 16))}</text>
        <rect class="${up ? 'bar-up' : 'bar-down'}" x="${Math.min(xv, x0)}" y="${cy - 7}" width="${w}" height="14" rx="7"/>
        <text x="${W}" y="${cy + 4}" class="delta ${up ? 'up' : 'down'}" text-anchor="end">${esc(F.signed(r.eur, 0))}</text>
        <rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}" tabindex="0" aria-label="${esc(r.name)} : ${esc(F.signed(r.eur, 2))}"
          data-tip="${tip(r.name, [{n: 'Résultat', v: F.signed(r.eur, 2)}, {n: 'Sur le montant engagé', v: (r.pct > 0 ? '+' : r.pct < 0 ? '−' : '') + F.pct(Math.abs(r.pct), 1)}, {n: 'Engagé', v: F.eur(r.amount, 0)}])}"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Résultat latent par position">${out}</svg>`;
  }

  /* 2. Répartition : barre par position + légende chiffrée, puis parts par type et par sens */
  function allocation(rs, F, N) {
    const tot = sum(rs, r => r.amount); if (tot <= 0) return '';
    const R = rs.slice().sort((a, b) => b.amount - a.amount), col = i => `var(--series-${i % 7 + 1})`;
    const bar = `<div class="split" role="group" aria-label="Répartition du capital engagé">${R.map((r, i) => {
      const sh = r.amount / tot * 100;
      return `<i tabindex="0" style="width:${sh}%;background:${col(i)}" aria-label="${esc(r.name)} ${esc(F.eur(r.amount, 0))}" data-tip="${tip(r.name, [{n: 'Engagé', v: F.eur(r.amount, 0), s: i % 7 + 1}, {n: 'Part du total', v: F.pct(sh, 1)}])}"></i>`;
    }).join('')}</div>`;
    const leg = `<div class="legend-line">${R.map((r, i) => `<span><i class="key" style="background:${col(i)}"></i>${esc(N.short(r.name, 18))} <b class="num">${F.pct(r.amount / tot * 100, 0)}</b></span>`).join('')}</div>`;
    return bar + leg;
  }
  function breakdown(rs, F, label) {
    const tot = sum(rs, r => r.amount); if (tot <= 0) return '';
    const g = {}; rs.forEach(r => { const k = label(r); g[k] = (g[k] || 0) + r.amount; });
    return Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      `<div class="bd"><div class="bd-h"><span>${esc(k)}</span><b class="num">${F.pct(v / tot * 100, 0)} · ${F.eur(v, 0)}</b></div><div class="bd-t"><i style="width:${v / tot * 100}%"></i></div></div>`).join('');
  }

  /* 3. Exposition : montant engagé (plein) contre exposition réelle avec le levier (fantôme) */
  function exposure(rs, F, N) {
    const R = rs.slice().sort((a, b) => b.notional - a.notional); if (!R.length) return '';
    const W = 340, L = 112, RR = 72, rowH = 38, T = 4, H = T * 2 + R.length * rowH, mx = Math.max(...R.map(r => r.notional), 1);
    const x = v => L + v / mx * (W - L - RR);
    let out = `<line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - T}"/>`;
    R.forEach((r, i) => {
      const cy = T + i * rowH + rowH / 2;
      out += `<text x="0" y="${cy - 2}" class="label">${esc(N.short(r.name, 16))}</text><text x="0" y="${cy + 12}" class="tick">${r.lev > 1 ? 'x' + r.lev + ' · ' : ''}${esc(F.eur(r.amount, 0))} engagés</text>
        <rect class="bar-ghost" x="${L}" y="${cy - 6}" width="${Math.max(2, x(r.notional) - L)}" height="12" rx="6"/>
        <rect class="bar-core" x="${L}" y="${cy - 6}" width="${Math.max(2, x(r.amount) - L)}" height="12" rx="6"/>
        <text x="${W}" y="${cy + 4}" class="value" text-anchor="end">${esc(F.eur(r.notional, 0))}</text>
        <rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}" tabindex="0" aria-label="${esc(r.name)} : exposition ${esc(F.eur(r.notional, 0))}"
          data-tip="${tip(r.name, [{n: 'Engagé', v: F.eur(r.amount, 0)}, {n: 'Levier', v: 'x' + r.lev}, {n: 'Exposition', v: F.eur(r.notional, 0)}, {n: 'Sens', v: r.dir === 'short' ? 'Vente' : 'Achat'}])}"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Montant engagé et exposition avec levier par position">${out}</svg>`;
  }
  const exposureKey = () => `<div class="legend-line"><span><i class="dotkey core"></i>Engagé</span><span><i class="dotkey ghost"></i>Exposition (levier inclus)</span></div>`;

  /* 4. Où en est chaque position entre son stop et son objectif */
  function levels(rs, F, N) {
    const R = rs.filter(r => isFinite(r.stop) && isFinite(r.target) && r.stop !== r.target && r.entry > 0 && r.stop != null && r.target != null);
    if (!R.length) return '';
    const W = 340, X0 = 12, X1 = W - 12, rowH = 62, T = 2, H = T * 2 + R.length * rowH;
    let out = '';
    R.forEach((r, i) => {
      const y = T + i * rowH, span = r.target - r.stop, pos = v => Math.min(1, Math.max(0, (v - r.stop) / span)), X = k => X0 + k * (X1 - X0);
      const xe = X(pos(r.entry)), has = r.last != null && isFinite(r.last), kl = has ? (r.last - r.stop) / span : null, xl = has ? X(pos(r.last)) : null;
      const out1 = kl != null && (kl < 0 || kl > 1);
      out += `<text x="${X0}" y="${y + 14}" class="label">${esc(N.short(r.name, 22))}</text>
        ${r.eur != null ? `<text x="${W}" y="${y + 14}" class="delta ${r.eur >= 0 ? 'up' : 'down'}" text-anchor="end">${esc(F.signed(r.eur, 0))}</text>` : ''}
        <rect class="zone-loss" x="${X0}" y="${y + 26}" width="${Math.max(0, xe - X0)}" height="8" rx="4"/>
        <rect class="zone-gain" x="${xe}" y="${y + 26}" width="${Math.max(0, X1 - xe)}" height="8" rx="4"/>
        <line class="axis" x1="${xe}" x2="${xe}" y1="${y + 22}" y2="${y + 38}"/>
        ${has ? `<circle class="lvl-dot${out1 ? ' out' : ''}" cx="${xl}" cy="${y + 30}" r="6"/>` : ''}
        <text x="${X0}" y="${y + 54}" class="tick" text-anchor="start">Stop${r.lossAtStop != null ? ' · ' + esc(F.signed(r.lossAtStop, 0)) : ''}</text>
        <text x="${X1}" y="${y + 54}" class="tick" text-anchor="end">Objectif${r.gainAtTarget != null ? ' · ' + esc(F.signed(r.gainAtTarget, 0)) : ''}</text>
        <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}" tabindex="0" aria-label="${esc(r.name)} entre stop et objectif"
          data-tip="${tip(r.name, [{n: 'Stop', v: fp(r.stop) + (r.lossAtStop != null ? ' (' + F.signed(r.lossAtStop, 0) + ')' : '')}, {n: 'Entrée', v: fp(r.entry)}, {n: 'Dernier cours', v: has ? fp(r.last) : '–'}, {n: 'Objectif', v: fp(r.target) + (r.gainAtTarget != null ? ' (' + F.signed(r.gainAtTarget, 0) + ')' : '')}])}"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Position de chaque trade entre son stop et son objectif">${out}</svg>`;
  }

  /* 5. Résultat réalisé cumulé des positions clôturées */
  function realised(closed, F, dateShort, dateLong) {
    const C = closed.filter(p => p.exit && isFinite(p.exit.eur)).sort((a, b) => String(a.exit.ts).localeCompare(String(b.exit.ts)));
    if (C.length < 2) return '';
    let c = 0; const pts = C.map(p => { c += p.exit.eur; return {v: c, d: p.exit.eur, ts: p.exit.ts, name: p.name}; });
    const W = 340, H = 180, L = 46, R = 14, T = 18, B = 26, iw = W - L - R, ih = H - T - B;
    const lo0 = Math.min(0, ...pts.map(p => p.v)), hi0 = Math.max(0, ...pts.map(p => p.v)), pad = (hi0 - lo0) * .15 || 1;
    const step = niceStep((hi0 - lo0 + 2 * pad) / 3), lo = Math.floor((lo0 - pad) / step) * step, hi = Math.ceil((hi0 + pad) / step) * step;
    const x = i => L + (pts.length === 1 ? 0 : i / (pts.length - 1)) * iw, y = v => T + ih - (v - lo) / (hi - lo || 1) * ih;
    let out = `<defs><linearGradient id="realfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--glacier)" stop-opacity=".16"/><stop offset="1" stop-color="var(--glacier)" stop-opacity="0"/></linearGradient></defs>`;
    for (let v = lo; v <= hi + 1e-9; v += step) out += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${Math.abs(v) < 1e-9 ? 'axis' : 'grid'}"/><text x="${L - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${nfInt(v)}</text>`;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
    out += `<path d="${d} L${x(pts.length - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#realfill)"/><path d="${d}" class="capline"/>`;
    pts.forEach((p, i) => {
      out += `<circle cx="${x(i)}" cy="${y(p.v)}" r="${i === pts.length - 1 ? 4 : 2.6}" class="${i === pts.length - 1 ? 'capdot last' : 'capdot'}"/>
        <rect class="hit" x="${x(i) - Math.max(10, iw / pts.length / 2)}" y="${T}" width="${Math.max(20, iw / pts.length)}" height="${ih}" tabindex="0" aria-label="${esc(p.name)}"
          data-tip="${tip(p.name, [{n: 'Clôture', v: dateLong(p.ts)}, {n: 'Résultat du trade', v: F.signed(p.d, 2)}, {n: 'Cumul', v: F.signed(p.v, 2)}])}"/>`;
      if (pts.length <= 6 || i % Math.ceil(pts.length / 5) === 0 || i === pts.length - 1) out += `<text x="${Math.min(Math.max(x(i), L + 12), W - R - 12)}" y="${H - 8}" class="tick" text-anchor="middle">${esc(dateShort(p.ts))}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Résultat réalisé cumulé">${out}</svg>`;
  }

  window.AlgoAnalysis = {rows, pnlBars, allocation, breakdown, exposure, exposureKey, levels, realised, sum};
})();
