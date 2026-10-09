# AlgoTrade (app) : contrat de données

L'app ne lit que des fichiers du dépôt, aucun serveur. Le bot SFC vit sur `main` ; les alertes et le registre vivent sur la branche séparée `app-data`, pour que rien de ce qui est écrit par l'app ou par les scans ne puisse toucher `main`.

| Fichier | Écrit par | Lu par |
|---|---|---|
| `state.json`, `heartbeat.json`, `bot_log.csv` | SFC (workflow horaire existant, inchangé) | écran SFC |
| `data/alerts.json` (branche `app-data`) | les 3 scans de Place à l'Action | écran Alertes |
| `data/ledger.json` (branche `app-data`) | l'app (depuis le téléphone) | écran Capital |

## `data/alerts.json`

```json
{
  "version": 1,
  "alerts": [
    {
      "id": "2026-10-07-cfd-gold-long",
      "category": "cfd | short_term | long_term",
      "ts": "2026-10-07T01:10:00Z",
      "ticker": "GC=F",
      "title": "Or (XAU/USD)",
      "direction": "long | short | null",
      "summary": "Catalyseur en 1 à 2 phrases.",
      "entry": "3 960-3 975",
      "stop": "3 925",
      "target": "4 050",
      "leverage": "x3",
      "horizon": "2-3 jours",
      "risk": "Ce qui invaliderait l'idée.",
      "sources": [{"name": "Reuters", "url": "https://..."}]
    }
  ]
}
```

Obligatoires : `id` (unique), `category`, `ts` (ISO 8601 UTC), `title`. Le reste est facultatif et s'affiche seulement s'il est présent. Un jour sans candidat n'ajoute rien.

Correspondance des scans :
- `cfd` : scan CFD (long et short, levier x2 à x5)
- `short_term` : scan quotidien actions, +8 % en ~7 jours
- `long_term` : scan hebdomadaire « conviction » (chaîne de valeur)

Règles d'écriture pour un scan : cloner uniquement la branche `app-data`, relire `data/alerts.json`, ajouter l'alerte (jamais réécrire les autres), garder les 200 plus récentes, `git pull --rebase origin app-data` puis `git push origin app-data`. Ne jamais toucher à `main` ni à un autre fichier, et ne jamais écrire de clé API dans le dépôt.

## `data/ledger.json`

Source de vérité : la liste `movements`. Types : `deposit` (vers la réserve), `allocate` (réserve vers compte), `withdraw` (compte vers réserve), `payout` (réserve vers ta banque), `valuation` (valeur actuelle d'un compte, saisie à la main). `accounts` liste les comptes dans l'ordre (leur couleur dans les graphiques suit cet ordre).

## Journal (v23)
Chaque position peut porter `note` (texte, 600 caractères max) et `reason` (Signal solide, Tendance confirmée, Actualité, Intuition, Autre). Réglage local `riskEur` : risque fixe par trade, utilisé par le calculateur.
