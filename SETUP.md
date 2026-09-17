# Kentekenwacht online zetten

Reken op ongeveer een uur. Je hebt vier gratis accounts nodig: GitHub,
Cloudflare, Stripe en Resend. Alleen Stripe vraagt om je identiteit, omdat daar
het geld binnenkomt.

Volg de stappen op volgorde. Na stap 5 draait de site; na stap 7 kan er betaald
worden; na stap 8 draait alles onbewaakt.

Kosten: **€ 0 per maand.** Stripe rekent geen vaste kosten, alleen een bedrag per
transactie — kijk voor het actuele tarief op <https://stripe.com/nl/pricing>. Een
eigen domein is optioneel en kost ± € 10 per jaar; zie stap 9.

---

## 1. Repository aanmaken (5 min)

1. Ga naar <https://github.com/new>.
2. Naam: `kentekenwacht`. Zet hem op **Private** als je liever niet hebt dat
   anderen meekijken; Cloudflare Pages werkt ook met een private repo.
3. Maak hem leeg aan — geen README, geen .gitignore.
4. Upload de map die je van mij hebt gekregen. Twee manieren:

   **Via de website:** klik op "uploading an existing file" en sleep de inhoud
   van de map erin. Let op: sleep de *inhoud*, niet de map zelf. Verborgen
   mappen (`.github`) worden door de browser soms overgeslagen — controleer
   achteraf of `.github/workflows/` erin staat en voeg hem anders los toe met
   "Create new file" en het pad `.github/workflows/bouw.yml`.

   **Via de opdrachtregel** (betrouwbaarder):
   ```bash
   cd kentekenwacht
   git init && git add -A
   git commit -m "Eerste versie"
   git branch -M main
   git remote add origin https://github.com/thomasruis/kentekenwacht.git
   git push -u origin main
   ```

---

## 2. Cloudflare-account en database (10 min)

1. Maak een gratis account op <https://dash.cloudflare.com/sign-up>.
2. Installeer de opdrachtregeltool en log in:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. Maak de database:
   ```bash
   wrangler d1 create kentekenwacht
   ```
   Je krijgt een `database_id` terug. **Zet die in `wrangler.toml`** op de plek
   waar nu `PLAK_HIER_JE_DATABASE_ID` staat.
4. Maak de tabellen aan:
   ```bash
   wrangler d1 execute kentekenwacht --remote --file=./schema.sql
   ```
5. Commit de gewijzigde `wrangler.toml` en push.

---

## 3. Site koppelen aan Cloudflare Pages (5 min)

1. Cloudflare-dashboard → **Workers & Pages** → **Create** → tabblad **Pages** →
   **Connect to Git**.
2. Kies je `kentekenwacht`-repository.
3. Instellingen:
   - Framework preset: **None**
   - Build command: **leeg laten**
   - Build output directory: **`public`**
4. **Save and Deploy.**

Je site staat nu op `https://kentekenwacht.pages.dev` (of een variant daarop als
de naam bezet is). **Noteer die URL**, je hebt hem in stap 6 en 8 nodig.

> Je ziet meteen de startpagina met een werkende kentekencheck. De merk- en
> modelpagina's komen erbij zodra de build voor het eerst draait (stap 10);
> daarna ververst GitHub Actions ze elke nacht.

---

## 4. Database koppelen aan de site (2 min)

In het dashboard van je Pages-project: **Settings → Bindings → Add → D1 database**

- Variable name: `DB`
- D1 database: `kentekenwacht`

Doe dit voor **zowel Production als Preview**. Zonder deze koppeling geven de
API-functies een foutmelding.

---

## 5. Controleren of het werkt (2 min)

Open `https://<jouw-site>.pages.dev` en vul een kenteken in. Je zou binnen een
seconde de voertuiggegevens moeten zien.

Werkt dit niet, dan is er iets mis met de Functions — kijk in het dashboard
onder **Deployments → Functions → Real-time logs**.

> Op dit moment bestaan alleen de startpagina en de kentekencheck. De merk- en
> modelpagina's, het prijsoverzicht en de juridische pagina's worden door de
> build-workflow gegenereerd (stap 10). Ik heb met opzet geen voorbeeldpagina's
> meegeleverd: die zouden verzonnen cijfers tonen, en dat is het laatste wat je
> op een datasite wilt.

---

## 6. Stripe (15 min)

1. Maak een account op <https://dashboard.stripe.com/register>.
2. Vul je bedrijfsgegevens in. Zonder KvK kun je je registreren als
   *natuurlijk persoon / eenmanszaak*; Stripe vraagt dan om je BSN of
   identiteitsbewijs. Zie ook de juridische opmerking onderaan.
3. Zet **iDEAL** aan: Settings → Payment methods → iDEAL → Turn on.
   Dit is belangrijk: zonder iDEAL haakt in Nederland het merendeel af.
4. Maak twee producten aan onder **Product catalogue**:

   | Product | Prijs | Facturering |
   |---|---|---|
   | Kentekenwacht Particulier | € 4,50 | Recurring, **yearly** |
   | Kentekenwacht Wagenpark | € 19,00 | Recurring, **monthly** |

   Kopieer van elk product de **Price ID** (begint met `price_`).
5. Ga naar **Developers → API keys** en kopieer de **Secret key** (`sk_live_…`
   of `sk_test_…` als je eerst wilt testen).
6. Ga naar **Developers → Webhooks → Add endpoint**:
   - Endpoint URL: `https://<jouw-site>.pages.dev/api/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_failed`
   - Kopieer daarna de **Signing secret** (`whsec_…`).
7. Zet het **klantportaal** aan: Settings → Billing → Customer portal →
   activeer, en sta "Cancel subscription" toe. Zonder dit werkt de opzegknop op
   de beheerpagina niet.

---

## 7. Resend voor e-mail (5 min)

1. Maak een gratis account op <https://resend.com/signup>.
   Gratis: 3.000 e-mails per maand, 100 per dag. Ruim genoeg om te beginnen.
2. Ga naar **API Keys** en maak er één aan. Kopieer hem (`re_…`).
3. Zonder eigen domein verstuur je vanaf `onboarding@resend.dev`. Dat werkt,
   maar belandt vaker in spam. Heb je een domein (stap 9), voeg het dan toe
   onder **Domains** en zet de DNS-records klaar.

---

## 8. Geheimen invullen (10 min)

### In Cloudflare Pages
**Settings → Environment variables → Production** (en dezelfde bij Preview).
Zet ze allemaal op **Encrypt** behalve de laatste twee:

| Naam | Waarde |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` uit stap 6.5 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` uit stap 6.6 |
| `STRIPE_PRICE_PARTICULIER` | `price_…` van het jaarproduct |
| `STRIPE_PRICE_ZAKELIJK` | `price_…` van het maandproduct |
| `RESEND_API_KEY` | `re_…` uit stap 7.2 |
| `CRON_SECRET` | zelf verzinnen, bv. de uitvoer van `openssl rand -hex 24` |
| `SITE_URL` | `https://<jouw-site>.pages.dev` (niet versleuteld) |
| `MAIL_AFZENDER` | `Kentekenwacht <onboarding@resend.dev>` (niet versleuteld) |

Deploy daarna opnieuw (Deployments → Retry deployment), anders kent de site de
nieuwe variabelen nog niet.

### In GitHub
**Settings → Secrets and variables → Actions**

Onder **Secrets**:

| Naam | Waarde |
|---|---|
| `CRON_SECRET` | exact dezelfde waarde als in Cloudflare |

Onder **Variables**:

| Naam | Waarde |
|---|---|
| `SITE_URL` | `https://<jouw-site>.pages.dev` |
| `KW_PRIJS_JAAR` | `4,50` |
| `KW_PRIJS_ZAKELIJK` | `19,00` |

---

## 9. Optioneel: eigen domein (10 min, ± € 10 per jaar)

`kentekenwacht.pages.dev` werkt prima, maar een eigen domein is de grootste
enkele verbetering die je kunt doen: het scheelt in vertrouwen bij bezoekers,
in vindbaarheid bij Google en in bezorging van je e-mail.

1. Koop een `.nl`-domein (TransIP, Versio, Cloudflare Registrar).
2. Cloudflare Pages → je project → **Custom domains** → **Set up a domain**.
3. Pas daarna `SITE_URL` aan in Cloudflare én GitHub, en zet je domein in
   Resend onder **Domains** met de bijbehorende DNS-records.

---

## 10. Aanzetten en controleren

1. GitHub → tabblad **Actions** → schakel workflows in als daarom gevraagd wordt.
2. Draai **Site bouwen** handmatig (Run workflow). Dit duurt 10–30 minuten voor
   60 merken. Als hij slaagt, is je site gevuld met verse data.
3. Draai **Meldingen versturen** handmatig. Zonder abonnees meldt hij netjes
   "niets te doen" — dat is de bedoeling.
4. Koop een abonnement op je eigen site met je eigen e-mailadres. Gebruik
   Stripes testkaart `4242 4242 4242 4242` als je nog in testmodus staat.
   Controleer dat de welkomstmail aankomt en dat de beheerlink werkt.
5. Meld je site aan bij Google: <https://search.google.com/search-console>,
   voeg `https://<jouw-site>.pages.dev/sitemap.xml` toe.

Daarna hoef je er niets meer aan te doen.

---

## Wat er vanaf nu vanzelf gebeurt

| Wanneer | Wat | Waar |
|---|---|---|
| Elke nacht 05:30 | Verse RDW-cijfers, alle merk- en modelpagina's opnieuw gegenereerd | GitHub Actions |
| Direct daarna | Nieuwe versie live | Cloudflare Pages |
| Elke ochtend 07:05 | Alle bewaakte kentekens gecontroleerd, meldingen verstuurd | GitHub Actions → Cloudflare |
| Continu | Kentekenchecks, verkopen, opzeggingen | Cloudflare + Stripe |

---

## Problemen oplossen

**"Er ging iets mis" bij het betalen.**
`STRIPE_PRICE_*` ontbreekt of hoort bij de verkeerde modus (test versus live).
Test- en live-sleutels zijn niet uitwisselbaar.

**Betaald, maar geen e-mail en niets in de database.**
De webhook komt niet aan. Kijk in Stripe onder Developers → Webhooks → je
endpoint → Recent deliveries. Een 400 betekent dat `STRIPE_WEBHOOK_SECRET` niet
klopt; een 500 dat de D1-binding ontbreekt (stap 4).

**De workflow "Site bouwen" valt om op `npm run verify`.**
Dan heeft het RDW een dataset of veldnaam gewijzigd. De uitvoer noemt precies
welk veld. Dit is met opzet zo: liever een mislukte build dan een halve site.

**De build duurt te lang.**
Verlaag `KW_MAX_MERKEN` (Run workflow → invoerveld). 20 merken duurt ongeveer
een kwartier.

**Meldingen sturen niets.**
Controleer of `CRON_SECRET` in GitHub exact gelijk is aan die in Cloudflare. Bij
een verschil krijg je een 401.

---

## Juridisch, kort

Ik ben geen jurist; dit is geen juridisch advies. Drie dingen om te regelen
voordat je structureel omzet draait:

- **KvK.** Verkoop je structureel aan consumenten, dan ben je in Nederland
  inschrijfplichtig. Eén testverkoop aan jezelf is dat niet.
- **Btw.** Een dienst aan Nederlandse consumenten valt onder 21% btw. Onder de
  KOR (omzet tot € 20.000) hoef je geen btw af te dragen. Stripe kan btw
  berekenen via Stripe Tax, maar dat kost 0,5% per transactie.
- **Contactgegevens.** Een webshop moet naam, adres en e-mailadres tonen. Vul
  die aan in `scripts/build.mjs` onder `OVER_HTML` zodra je ze hebt.

De RDW-data zelf is vrij van rechten en expliciet bedoeld voor hergebruik, ook
commercieel. Bronvermelding staat al op elke pagina.
