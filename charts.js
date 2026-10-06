/* AlgoTrade : graphiques SVG/HTML sans dépendance.
 * Les couleurs viennent de variables CSS (--series-0 à --series-7, --surface, --grid, --axis,
 * --text-2, --text-3, --dumb-from, --dumb-to, --up, --down) : pour changer le design,
 * on change ces variables, pas ce fichier.
 * Série 0 = la réserve (gris, couleur de contexte). Séries 1 à 7 = comptes, dans l'ordre. */
(function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const nfInt = v => new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0}).format(v);
  const pctFmt = v => new Intl.NumberFormat('fr-FR', {minimumFractionDigits: 1, maximumFractionDigits: 1}).format(v) + ' %';
  const col = slot => `var(--series-${slot})`;
  /* La couleur suit le compte, jamais son rang : un compte garde sa couleur quand les autres changent. */
  const slotOf = (name, accounts) => name === 'Réserve' ? 0 : Math.min(accounts.indexOf(name) + 1, 7);
  const tip = (title, rows) => esc(JSON.stringify({t: title, r: rows}));
  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  const arrow = d => d > 0 ? '▲' : d < 0 ? '▼' : '•';

  /* Barre de répartition (part du tout). parts : [{name, value, slot}] */
  function splitBar(parts, fmtEur) {
    const tot = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
    if (tot <= 0) return '';
    const segs = parts.filter(p => p.value > 0).map(p => {
      const share = p.value / tot * 100;
      return `<i tabindex="0" style="width:${share}%;background:${col(p.slot)}" aria-label="${esc(p.name)} ${esc(fmtEur(p.value))}"
        data-tip="${tip(p.name, [{n: 'Montant', v: fmtEur(p.value), s: p.slot}, {n: 'Part du total', v: pctFmt(share)}])}"></i>`;
    }).join('');
    return `<div class="split" role="group" aria-label="Répartition du capital">${segs}</div>`;
  }

  /* Colonnes empilées : composition du capital à chaque date de saisie. */
  function stackedColumns(snaps, accounts, fmtEur, dateShort, dateLong) {
    const W = 340, H = 200, L = 46, R = 10, T = 22, B = 26, iw = W - L - R, ih = H - T - B;
    const names = ['Réserve', ...accounts];
    const val = (s, nm) => Math.max(0, nm === 'Réserve' ? s.reserve : s.values[nm]);
    const totalOf = s => names.reduce((a, nm) => a + val(s, nm), 0);
    const maxTot = Math.max(1, ...snaps.map(totalOf));
    const step = niceStep(maxTot / 3), top = Math.ceil(maxTot / step) * step;
    const y = v => T + ih - (v / top) * ih;
    let out = '';
    for (let v = 0; v <= top + 1e-9; v += step)
      out += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'axis' : 'grid'}"/>
        <text x="${L - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${nfInt(v)}</text>`;
    const n = snaps.length, slot = iw / n, bw = Math.min(24, slot - 6);
    snaps.forEach((s, i) => {
      const cx = L + slot * (i + 0.5), x = cx - bw / 2;
      const segs = names.map(nm => ({nm, v: val(s, nm)})).filter(o => o.v > 0);
      let acc = 0;
      segs.forEach((o, k) => {
        const yTop = y(acc + o.v), yBot = y(acc) - (k > 0 ? 2 : 0);   // 2 px d'air entre segments
        acc += o.v;
        const h = yBot - yTop; if (h < 0.5) return;
        const fill = col(slotOf(o.nm, accounts));
        if (k === segs.length - 1) {
          const r = Math.min(4, h / 2);
          out += `<path d="M${x},${yBot} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${yBot} Z" fill="${fill}"/>`;
        } else out += `<rect x="${x}" y="${yTop}" width="${bw}" height="${h}" fill="${fill}"/>`;
      });
      const rows = segs.slice().reverse().map(o => ({n: o.nm, v: fmtEur(o.v), s: slotOf(o.nm, accounts)})).concat([{n: 'Total', v: fmtEur(totalOf(s))}]);
      out += `<rect class="hit" x="${cx - slot / 2}" y="${T}" width="${slot}" height="${ih}" tabindex="0" aria-label="${esc(dateLong(s.date))} : ${esc(fmtEur(totalOf(s)))}" data-tip="${tip(dateLong(s.date), rows)}"/>`;
      if (n <= 7 || (n - 1 - i) % 2 === 0)
        out += `<text x="${cx}" y="${H - 8}" class="tick" text-anchor="middle">${esc(dateShort(s.date))}</text>`;
    });
    const last = snaps[n - 1], lx = Math.min(Math.max(L + slot * (n - 0.5), L + 26), W - R - 26);
    out += `<text x="${lx}" y="${y(totalOf(last)) - 6}" class="value" text-anchor="middle">${esc(fmtEur(totalOf(last)))}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Évolution de la répartition du capital">${out}</svg>`;
  }

  /* Haltères : versé → valeur actuelle, un compte par ligne. rows : [{name, invested, value}] */
  function dumbbell(rows, fmtEur, fmtSigned) {
    rows = rows.filter(r => r.invested !== 0 || r.value !== 0);
    if (!rows.length) return '';
    const W = 340, L = 100, X1 = W - 84, rowH = 38, T = 6, B = 22, H = T + rows.length * rowH + B;
    const mx = Math.max(...rows.map(r => Math.max(r.invested, r.value)), 1) * 1.08;
    const x = v => L + (Math.max(0, v) / mx) * (X1 - L);
    const step = niceStep(mx / 3);
    let out = '';
    for (let v = 0; v <= mx; v += step)
      out += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}" class="${v === 0 ? 'axis' : 'grid'}"/>
        <text x="${x(v)}" y="${H - 6}" class="tick" text-anchor="middle">${nfInt(v)}</text>`;
    rows.forEach((r, i) => {
      const cy = T + i * rowH + rowH / 2, d = r.value - r.invested;
      const pct = r.invested > 0 ? d / r.invested * 100 : null;
      const label = r.name.length > 14 ? r.name.slice(0, 13) + '…' : r.name;
      const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      out += `<text x="0" y="${cy + 4}" class="label">${esc(label)}</text>
        <line x1="${x(r.invested)}" x2="${x(r.value)}" y1="${cy}" y2="${cy}" class="link"/>
        <circle cx="${x(r.invested)}" cy="${cy}" r="5" class="dot-from"/>
        <circle cx="${x(r.value)}" cy="${cy}" r="5" class="dot-to"/>
        <text x="${W}" y="${cy + 4}" class="delta ${cls}" text-anchor="end">${arrow(d)} ${esc(fmtSigned(d, 0))}</text>
        <rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}" tabindex="0" aria-label="${esc(r.name)} : versé ${esc(fmtEur(r.invested))}, valeur ${esc(fmtEur(r.value))}"
          data-tip="${tip(r.name, [{n: 'Versé', v: fmtEur(r.invested)}, {n: 'Valeur actuelle', v: fmtEur(r.value)}, {n: 'Écart', v: fmtSigned(d, 2) + (pct === null ? '' : ' (' + (pct > 0 ? '+' : pct < 0 ? '−' : '') + pctFmt(Math.abs(pct)) + ')')}])}"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Montant versé et valeur actuelle par compte">${out}</svg>`;
  }

  const legend = items => `<div class="legend-line">${items.map(it =>
    `<span><i class="key" style="background:${col(it.slot)}"></i>${esc(it.name)}</span>`).join('')}</div>`;
  const dumbKey = () => `<div class="legend-line"><span><i class="dotkey from"></i>Versé</span><span><i class="dotkey to"></i>Valeur actuelle</span></div>`;

  /* Infobulle unique : souris, toucher et clavier. Les noms passent par textContent. */
  function attachTooltips() {
    if (window.__tipReady) return; window.__tipReady = true;
    const el = document.createElement('div'); el.id = 'tip'; el.setAttribute('role', 'tooltip'); document.body.appendChild(el);
    const hide = () => el.classList.remove('on');
    function place(px, py) {
      const r = el.getBoundingClientRect();
      el.style.left = Math.min(Math.max(8, px - r.width / 2), innerWidth - r.width - 8) + 'px';
      el.style.top = (py - r.height - 14 < 8 ? py + 18 : py - r.height - 14) + 'px';
    }
    function show(t, px, py) {
      let d; try { d = JSON.parse(t.dataset.tip); } catch { return; }
      el.replaceChildren();
      const title = document.createElement('div'); title.className = 'tip-t'; title.textContent = d.t; el.appendChild(title);
      d.r.forEach(r => {
        const row = document.createElement('div'); row.className = 'tip-r';
        if (r.s != null) { const k = document.createElement('i'); k.className = 'tip-k'; k.style.background = col(r.s); row.appendChild(k); }
        const v = document.createElement('b'); v.textContent = r.v;
        const n = document.createElement('span'); n.textContent = r.n;
        row.append(v, n); el.appendChild(row);
      });
      el.classList.add('on'); place(px, py);
    }
    const target = e => e.target.closest ? e.target.closest('[data-tip]') : null;
    ['pointerover', 'pointermove', 'pointerdown'].forEach(ev => document.addEventListener(ev, e => {
      const t = target(e); if (t) show(t, e.clientX, e.clientY); else hide();
    }));
    document.addEventListener('focusin', e => {
      const t = target(e); if (!t) return hide();
      const b = t.getBoundingClientRect(); show(t, b.left + b.width / 2, b.top);
    });
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, {passive: true});
  }

  window.AlgoCharts = {splitBar, stackedColumns, dumbbell, legend, dumbKey, slotOf, attachTooltips};
})();
