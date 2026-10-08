/* AlgoTrade : noms des actifs en anglais, alignés sur XTB (la référence).
 * resolve({ticker, symbol, title}) -> {name, xtb}
 * Best effort : les matières premières suivent les symboles XTB déjà utilisés par l'app ;
 * les actions suivent la convention XTB « TICKER.US », « .FR », « .DE »… Un actif inconnu garde
 * son titre nettoyé : il suffit d'ajouter une ligne dans les tables ci-dessous. */
(function () {
  'use strict';
  const COMMO = {
    'GC=F': ['Gold', 'GOLD'], 'SI=F': ['Silver', 'SILVER'], 'CL=F': ['Crude Oil WTI', 'OIL.WTI'], 'BZ=F': ['Brent Crude Oil', 'OIL'],
    'NG=F': ['Natural Gas', 'NATGAS'], 'ZW=F': ['Wheat', 'WHEAT'], 'ZC=F': ['Corn', 'CORN'], 'CT=F': ['Cotton', 'COTTON'],
    'HG=F': ['Copper', 'COPPER'], 'CC=F': ['Cocoa', 'COCOA'], 'ZS=F': ['Soybeans', 'SOYBEAN'], 'KC=F': ['Coffee', 'COFFEE'],
    'SB=F': ['Sugar', 'SUGAR'], 'PL=F': ['Platinum', 'PLATINUM'], 'PA=F': ['Palladium', 'PALLADIUM']
  };
  const INDEX = {
    '^GSPC': ['US 500', 'US500'], '^NDX': ['US Tech 100', 'US100'], '^DJI': ['US 30', 'US30'], '^GDAXI': ['Germany 40', 'DE40'],
    '^FCHI': ['France 40', 'FR40'], '^FTSE': ['UK 100', 'UK100'], '^N225': ['Japan 225', 'JP225'],
    'BTC-USD': ['Bitcoin', 'BITCOIN'], 'ETH-USD': ['Ethereum', 'ETHEREUM']
  };
  /* mots français (sans accents) trouvés dans les titres d'alertes -> contrat */
  const FR = {or: 'GC=F', xau: 'GC=F', argent: 'SI=F', xag: 'SI=F', petrole: 'CL=F', wti: 'CL=F', brent: 'BZ=F', gaz: 'NG=F', ble: 'ZW=F',
    mais: 'ZC=F', coton: 'CT=F', cuivre: 'HG=F', cacao: 'CC=F', cafe: 'KC=F', sucre: 'SB=F', soja: 'ZS=F', platine: 'PL=F', palladium: 'PA=F'};
  const STOCKS = {
    AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', AMZN: 'Amazon.com', GOOGL: 'Alphabet (Class A)', GOOG: 'Alphabet (Class C)', META: 'Meta Platforms',
    TSLA: 'Tesla', AMD: 'Advanced Micro Devices', INTC: 'Intel', NFLX: 'Netflix', AVGO: 'Broadcom', TSM: 'Taiwan Semiconductor', ASML: 'ASML Holding',
    ORCL: 'Oracle', CRM: 'Salesforce', PLTR: 'Palantir Technologies', COIN: 'Coinbase Global', MU: 'Micron Technology', QCOM: 'Qualcomm',
    JPM: 'JPMorgan Chase', V: 'Visa', MA: 'Mastercard', XOM: 'Exxon Mobil', CVX: 'Chevron', LLY: 'Eli Lilly', UNH: 'UnitedHealth Group',
    JNJ: 'Johnson & Johnson', PFE: 'Pfizer', KO: 'Coca-Cola', PEP: 'PepsiCo', WMT: 'Walmart', DIS: 'Walt Disney', BA: 'Boeing',
    LMT: 'Lockheed Martin', CAT: 'Caterpillar', GE: 'GE Aerospace', SMCI: 'Super Micro Computer', ARM: 'Arm Holdings', SNOW: 'Snowflake',
    UBER: 'Uber Technologies', SHOP: 'Shopify', PYPL: 'PayPal', ADBE: 'Adobe', NOW: 'ServiceNow', PANW: 'Palo Alto Networks', CRWD: 'CrowdStrike',
    'BRK.B': 'Berkshire Hathaway (B)', COST: 'Costco', HD: 'Home Depot', NKE: 'Nike', SBUX: 'Starbucks', MCD: "McDonald's", ABBV: 'AbbVie', MRK: 'Merck',
    'MC.PA': 'LVMH', 'TTE.PA': 'TotalEnergies', 'AIR.PA': 'Airbus', 'SAN.PA': 'Sanofi', 'OR.PA': "L'Oreal", 'RMS.PA': 'Hermes International',
    'SU.PA': 'Schneider Electric', 'BNP.PA': 'BNP Paribas', 'SAF.PA': 'Safran', 'DG.PA': 'Vinci', 'CS.PA': 'AXA', 'STMPA.PA': 'STMicroelectronics',
    'SAP.DE': 'SAP', 'SIE.DE': 'Siemens', 'ASML.AS': 'ASML Holding'
  };
  const ALIAS = {GOLD: 'GC=F', XAUUSD: 'GC=F', 'XAU/USD': 'GC=F', SILVER: 'SI=F', XAGUSD: 'SI=F', WTI: 'CL=F', 'OIL.WTI': 'CL=F', OIL: 'BZ=F',
    NATGAS: 'NG=F', WHEAT: 'ZW=F', CORN: 'ZC=F', COTTON: 'CT=F', COPPER: 'HG=F', COCOA: 'CC=F', SOYBEAN: 'ZS=F', COFFEE: 'KC=F', SUGAR: 'SB=F'};
  const SUFFIX = {PA: 'FR', DE: 'DE', AS: 'NL', L: 'UK', MI: 'IT', MC: 'ES', BR: 'BE'};
  const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const cleanTitle = t => String(t || '').replace(/^\s*cl[oô]ture\s*·\s*/i, '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

  function resolve(o) {
    o = o || {};
    let key = String(o.symbol || o.ticker || '').trim().toUpperCase();
    if (ALIAS[key]) key = ALIAS[key];
    if (COMMO[key]) return {name: COMMO[key][0], xtb: COMMO[key][1]};
    if (INDEX[key]) return {name: INDEX[key][0], xtb: INDEX[key][1]};
    const fx = key.match(/^([A-Z]{3})([A-Z]{3})=X$/);
    if (fx) return {name: fx[1] + '/' + fx[2], xtb: fx[1] + fx[2]};
    if (STOCKS[key] || /^[A-Z]{1,5}(\.[A-Z])?$/.test(key) || /^[A-Z0-9]{1,6}\.[A-Z]{1,2}$/.test(key)) {
      const [base, suf] = key.split('.');
      const xtb = suf && SUFFIX[suf] ? base + '.' + SUFFIX[suf] : (suf && !SUFFIX[suf] && STOCKS[key] ? key : base + '.US');
      const known = STOCKS[key] || STOCKS[base];
      if (known) return {name: known, xtb};
      const t = cleanTitle(o.title);
      return {name: t || key, xtb};
    }
    for (const w of strip(cleanTitle(o.title)).split(/[^a-z]+/)) if (FR[w]) return {name: COMMO[FR[w]][0], xtb: COMMO[FR[w]][1]};
    return {name: cleanTitle(o.title) || key || 'Unknown', xtb: ''};
  }
  /* Levier maximal XTB pour un client particulier européen (plafonds ESMA, appliqués par XTB) : or 20, autres matières premières 10,
   * indices majeurs 20, forex majeurs 30 (autres paires 20), actions 5, crypto 2. À vérifier sur xStation (marge de chaque instrument). */
  const LEV = {GOLD: 20, SILVER: 10, 'OIL.WTI': 10, OIL: 10, NATGAS: 10, WHEAT: 10, CORN: 10, COTTON: 10, COCOA: 10, COPPER: 10, SOYBEAN: 10, COFFEE: 10, SUGAR: 10,
    PLATINUM: 10, PALLADIUM: 10, US500: 20, US100: 20, US30: 20, DE40: 20, FR40: 20, UK100: 20, JP225: 20, BITCOIN: 2, ETHEREUM: 2};
  const FX_MAJORS = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'EURGBP', 'EURJPY', 'EURCHF', 'NZDUSD']);
  function xtbLeverage(o) {
    const k = resolve(o).xtb;
    if (LEV[k]) return LEV[k];
    if (/^[A-Z]{6}$/.test(k)) return FX_MAJORS.has(k) ? 30 : 20;
    if (/\.(US|FR|DE|UK|NL|ES|IT|BE)$/.test(k)) return 5;
    return null;
  }
  const short = (n, max = 15) => n.length > max ? n.slice(0, max - 1) + '…' : n;
  window.AlgoNames = {resolve, short, xtbLeverage};
})();
