# Brief de design : refaire l'habillage de l'app AlgoTrade

Le dossier `app/` est séparé en trois couches. Pour un nouveau design, **on ne touche qu'à la couche 3** :

| Fichier | Rôle | À modifier ? |
|---|---|---|
| `core.js` | données, calculs, lecture et écriture GitHub, actions | Non |
| `charts.js` | graphiques SVG (barre, colonnes empilées, haltères) et infobulle | Non, ils se restylent par variables CSS |
| `index.html` | mise en page, CSS, rendu des écrans | **Oui, c'est le design** |

## Direction artistique voulue

Luxe, futuriste, épuré, dans la ligne d'Apple : beaucoup d'espace, une typographie fine et précise, très peu de couleurs, des surfaces en verre ou en métal mat, des mouvements doux uniquement quand ils répondent à un geste. Les chiffres sont les héros. Aucun élément décoratif sans rôle. Mode clair et mode sombre, tous deux soignés.

## Écrans (3 onglets, mobile d'abord)

1. **Alertes** : flux de cartes (CFD, action court terme, action long terme), filtrable. Chaque alerte : catégorie, date, sens (achat/vente), titre, résumé, niveaux (entrée, stop, objectif, levier, horizon), risque principal, sources en liens. Les non lues sont signalées.
2. **SFC** : état du bot (actif ou silencieux), résultat cumulé, 7 derniers jours, capital de trading, positions ouvertes (réel IG ou simulé), derniers trades.
3. **Capital** : où est l'épargne. Barre de répartition, évolution dans le temps (colonnes empilées), versé contre valeur actuelle par compte, puis historique des mouvements. Boutons : nouveau mouvement, ajouter un compte.

En-tête permanent : capital total et résultat cumulé de SFC. Barre d'onglets en bas, zones sûres iPhone respectées (`env(safe-area-inset-*)`).

## API disponible (ne pas réécrire)

```js
const C = window.AlgoCore, G = window.AlgoCharts;

C.state            // { settings, ledger, alerts, alertsErr, sfc, sfcErr, seen, loading }
C.on('change', fn) // appelé après tout changement de données : re-rendre l'écran
C.loadAll()        // recharge alertes, SFC et registre depuis GitHub

C.computeLedger(C.state.ledger) // { reserve, acc:{nom:{invested,value}}, value, invested, perf, total }
C.snapshots(C.state.ledger, 12) // [{ date, reserve, values:{compte:valeur}, total }]
C.sfcSummary(C.state.sfc)       // { alive, lastCycle, cum, capital, week, errors24h, positions[], exits[] } ou null

C.addMovement({type, account, amount, date, note}) // 'deposit'|'allocate'|'withdraw'|'payout'|'valuation'
C.deleteMovement(id)  C.addAccount(nom)  C.saveSettings({repo, branch, token})
C.unseenCount()  C.markAlertsSeen()
// Les actions d'écriture renvoient une promesse : 'sync' | 'local' | 'echec:<raison>'

C.fmt.eur(n, décimales)  C.fmt.signed(n, décimales)  C.fmt.pct(n)  C.fmt.ago(iso)  C.fmt.dateTime(iso)

G.splitBar(parts, fmtEur)                        // parts: [{name, value, slot}]
G.stackedColumns(snaps, comptes, fmtEur, dateShort, dateLong)
G.dumbbell(rows, fmtEur, fmtSigned)              // rows: [{name, invested, value}]
G.legend(items)  G.dumbKey()  G.slotOf(nom, comptes)  G.attachTooltips()
```

Les graphiques renvoient du HTML/SVG à insérer tel quel. Ils lisent ces variables CSS, à redéfinir pour changer leur look :
`--series-0` (réserve, gris) à `--series-7` (comptes, dans l'ordre), `--surface`, `--grid`, `--axis`, `--text-2`, `--text-3`, `--ink`, `--up`, `--down`, `--dumb-from`, `--dumb-to`.
Les classes de l'infobulle (`#tip`, `.tip-t`, `.tip-r`, `.tip-k`) et des graphiques (`.chart`, `.split`, `.legend-line`) se restylent dans le CSS.

## Contraintes

- Fichiers statiques seulement : HTML, CSS, JS sans build ni framework imposé. Une bibliothèque via CDN est acceptable si elle est nécessaire.
- Les textes sont en français, les montants en euros au format `fr-FR`.
- Toujours échapper les textes venant des données (alertes, noms de comptes) : utiliser les fonctions d'échappement déjà présentes ou `textContent`.
- Les couleurs des comptes doivent rester stables (un compte garde sa couleur) et distinguables par des personnes daltoniennes : si tu changes les couleurs des séries, garde des légendes et valeurs visibles en plus de la couleur.
- Accessibilité : contraste lisible, focus clavier visible, `prefers-reduced-motion` respecté.
- Garder `manifest.webmanifest`, `sw.js` et les icônes (installation sur l'écran d'accueil iPhone).

## Prompt prêt à coller dans ChatGPT

> Tu es directeur artistique et développeur front-end. Je te donne une petite application web mobile (PWA) de suivi d'investissements, déjà fonctionnelle. Je veux que tu refasses uniquement son habillage visuel : le fichier `index.html` (CSS et rendu des écrans), sans toucher à `core.js` ni `charts.js`.
>
> Direction : luxe, futuriste, épuré, dans la ligne d'Apple. Beaucoup d'espace, typographie fine et précise, palette très réduite, surfaces en verre ou en métal mat, chiffres au premier plan, aucun décor inutile, mouvements doux uniquement en réponse à un geste. Mode clair et mode sombre soignés. Mobile d'abord (iPhone, zones sûres).
>
> Voici les fichiers : `index.html` actuel, `core.js`, `charts.js` et `DESIGN_BRIEF.md`. Respecte l'API décrite dans le brief et les contraintes. Rends-moi un `index.html` complet et prêt à remplacer l'actuel, et explique en quelques lignes tes choix de typographie, de couleurs et de mise en page.
