// Récupère les derniers cours (Yahoo) de l'univers du bot SFC et les écrit dans quotes.json.
// Données de marché publiques, aucun secret : le fichier est publié sur la branche « live » de ce dépôt public.
import {writeFileSync} from 'node:fs';

const SYMBOLS = ['CL=F', 'NG=F', 'SI=F', 'GC=F', 'ZW=F', 'ZC=F', 'CT=F'];
const prices = {};
for (const sym of SYMBOLS) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`,
      {headers: {'User-Agent': 'Mozilla/5.0'}, signal: AbortSignal.timeout(15000)});
    const m = (await r.json()).chart.result[0].meta;
    if (isFinite(m.regularMarketPrice)) prices[sym] = {last: m.regularMarketPrice, ts: new Date((m.regularMarketTime || 0) * 1000).toISOString()};
  } catch (e) { console.log('indisponible :', sym, '-', e.message); }
}
if (!Object.keys(prices).length) { console.log('aucun cours récupéré'); process.exit(1); }
writeFileSync('quotes.json', JSON.stringify({version: 1, ts: new Date().toISOString(), prices}) + '\n');
console.log('cours :', Object.entries(prices).map(([k, v]) => k + ' ' + v.last).join(' · '));
