# Kentekenwacht

Een volledig geautomatiseerde dienst rond Nederlandse voertuigdata. Gratis
kentekencheck met **openstaande terugroepacties** als magneet, een betaald
bewakingsabonnement als verdienmodel.

Draait zonder toezicht en zonder vaste kosten.

**Aan de slag:** zie [SETUP.md](SETUP.md).

---

## Waarom dit werkt

Het RDW publiceert kosteloos welke voertuigen een terugroepactie hebben, tot op
kentekenniveau. Die data is vrij herbruikbaar, ook commercieel, en er is geen
API-sleutel voor nodig. Bijna geen enkele kentekencheck-site ontsluit hem.

Dat is de haak. Wie ontdekt dat er een openstaande veiligheidsactie op zijn auto
staat, wil dat de volgende keer automatisch horen. Dat is het abonnement.

Elke schakel heeft een officiële, gratis API. Geen reverse-engineering, geen
wachtlijsten, geen goedkeuringstrajecten.

---

## Architectuur

```
GitHub Actions ──(1) dagelijkse build──> commit naar repo
                                              │
                                              ▼
                                      Cloudflare Pages  ◄── bezoeker
                                       ├── statische SEO-pagina's
                                       └── Functions
                                            ├── /api/lookup    (gratis check)
                                            ├── /api/checkout  (Stripe)
                                            ├── /api/stripe-webhook
                                            ├── /api/beheer
                                            └── /api/cron      (meldingen)
                                                   ▲    │
GitHub Actions ──(2) dagelijkse tik───────────────┘    ▼
                                                  D1 + Resend + RDW
```

Twee bewuste keuzes:

**De motor ligt niet in een AI-sessie.** Die stopt zodra het gesprek eindigt.
GitHub Actions en Cloudflare draaien door, ongeacht wie er kijkt.

**Het cron-werk draait op Cloudflare, niet in Actions.** Daar zit de
D1-binding al, dus er hoeft geen Cloudflare API-token in GitHub te staan.
Actions is alleen de klok en werkt in porties van zes kentekens: de gratis
Cloudflare-laag staat vijftig *externe* subverzoeken per aanroep toe (D1 valt
onder een apart, veel ruimer budget), en één kenteken kost er tot zeven. De
rekensom staat boven in `functions/api/cron.js` en wordt door een test bewaakt.

---

## Mappen

```
functions/
  _lib/rdw.js         RDW-client: query's, kentekennormalisatie, rapportopbouw
  _lib/signalen.js    beslist wat een melding waard is (los testbaar)
  _lib/helpers.js     Stripe-client, webhookhandtekening, e-mail
  api/                de vijf endpoints
scripts/
  build.mjs           genereert de statische site uit RDW-aggregaten
  templates.mjs       HTML-sjablonen
  verify.mjs          zelfcontrole tegen de echte RDW-API
  zelftest-lokaal.mjs unit-tests met nagebootste API (geen netwerk nodig)
  e2e-test.mjs        browsertest van formulier, resultaat en koopstroom
  mock-rdw.mjs        gedeelde nagebootste API
  demo-build.mjs      volledige build met nagebootste data
public/               statische bestanden + build-output
data/                 cache van de koppeling terugroepactie → merk
schema.sql            D1-tabellen
```

## Tests

```bash
node scripts/zelftest-lokaal.mjs   # 58 controles, geen netwerk nodig
node scripts/e2e-test.mjs          # 26 controles in een echte browser
npm run verify                     # controleert de live RDW-API
node scripts/demo-build.mjs        # bouwt de hele site met nagebootste data
```

De eerste drie draaien ook in de build-workflow; `verify` blokkeert de build als
het RDW een veldnaam wijzigt.

---

## Gegevensbronnen

Alles uit [RDW Open Data](https://opendata.rdw.nl), gratis en zonder sleutel:

| Dataset | Identifier | Waarvoor |
|---|---|---|
| Gekentekende voertuigen | `m9d7-ebf2` | voertuiggegevens, APK-datum |
| Brandstof | `8ys7-d773` | brandstof, emissieklasse, vermogen |
| Terugroepactie per kenteken | `bcmj-kjae` | koppeling kenteken → actie |
| Terugroep_actie | `j9yg-7rg9` | defect, gevolg, risico, producent |
| Geconstateerde gebreken | `a34c-vvps` | gebreken bij de laatste keuring |
| Gebreken | `hx2c-gt7k` | gebrekcode → omschrijving |

---

## Instelbaar

Via omgevingsvariabelen, zonder de code aan te raken:

| Variabele | Standaard | Wat |
|---|---|---|
| `KW_MAX_MERKEN` | 60 | aantal merkpagina's |
| `KW_MAX_MODELLEN` | 14 | modelpagina's per merk |
| `KW_MAX_RECALL_RESOLUTIES` | 250 | nieuwe terugroep→merk-koppelingen per run |
| `KW_PRIJS_JAAR` | 4,50 | getoonde particuliere prijs |
| `KW_PRIJS_ZAKELIJK` | 19,00 | getoonde wagenparkprijs |
| `RDW_APP_TOKEN` | — | optioneel; verhoogt de RDW-limiet |

De prijzen in deze variabelen zijn alleen wat de bezoeker ziet. Wat er echt
wordt afgeschreven staat in Stripe.
