#!/usr/bin/env node
/**
 * Bouwt de statische site uit live RDW-data.
 *
 * Draait dagelijks op GitHub Actions. De output in public/ wordt teruggecommit,
 * waarna Cloudflare Pages automatisch deployt.
 *
 * Ontwerpkeuze: aggregaten worden per merk opgehaald in één query in plaats van
 * per model. Dat scheelt een factor 20 aan verzoeken richting de RDW-API.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DATASETS,
  rdwQuery,
  soqlString,
  titelCase,
  slug,
  formatteerDatum,
} from '../functions/_lib/rdw.js';
import * as T from './templates.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const WORTEL = join(HIER, '..');
// KW_UIT laat de demo-build naar een aparte map schrijven, zodat een test
// nooit de echte public/ met verzonnen cijfers overschrijft.
const UIT = join(WORTEL, process.env.KW_UIT || 'public');
const DATA = join(WORTEL, process.env.KW_DATA || 'data');

/* ---- afstelling ---------------------------------------------------- */

const MAX_MERKEN = Number(process.env.KW_MAX_MERKEN ?? 60);
const MAX_MODELLEN_PER_MERK = Number(process.env.KW_MAX_MODELLEN ?? 14);
const MIN_AANTAL_MODEL = 150; // onder deze drempel is een modelpagina te dun
const MAX_RECALL_RESOLUTIES = Number(process.env.KW_MAX_RECALL_RESOLUTIES ?? 250);
const PERSONENAUTO = "voertuigsoort='Personenauto'";

const RDW_OPTIES = { appToken: process.env.RDW_APP_TOKEN || undefined };

/* ---- hulpjes ------------------------------------------------------- */

const log = (...a) => console.log('[build]', ...a);

function vandaagRdw() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

function vandaagNl() {
  return new Date().toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  });
}

async function schrijf(pad, inhoud) {
  const vol = join(UIT, pad);
  await mkdir(dirname(vol), { recursive: true });
  await writeFile(vol, inhoud, 'utf8');
}

async function leesJson(pad, standaard) {
  try {
    return JSON.parse(await readFile(pad, 'utf8'));
  } catch {
    return standaard;
  }
}

/** Socrata geeft aggregaten soms als string terug. */
const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Voer taken uit met een begrensde parallelliteit. */
async function inBatches(items, grootte, fn) {
  const resultaten = [];
  for (let i = 0; i < items.length; i += grootte) {
    const blok = items.slice(i, i + grootte);
    resultaten.push(...(await Promise.all(blok.map(fn))));
  }
  return resultaten;
}

/* ---- ophalen ------------------------------------------------------- */

async function haalMerken() {
  const rijen = await rdwQuery(
    DATASETS.voertuig,
    {
      select: 'merk, count(1) AS aantal',
      where: `${PERSONENAUTO} AND merk IS NOT NULL`,
      group: 'merk',
      order: 'aantal DESC',
      limit: MAX_MERKEN,
    },
    RDW_OPTIES
  );
  return rijen
    .map((r) => ({ merk: r.merk, merkNet: titelCase(r.merk), aantal: n(r.aantal) }))
    .filter((r) => r.merk && r.aantal);
}

async function haalMerkDetail(merk) {
  const m = soqlString(merk);
  const [modellen, verlopen, kleuren] = await Promise.all([
    rdwQuery(
      DATASETS.voertuig,
      {
        select:
          'handelsbenaming, count(1) AS aantal, avg(catalogusprijs) AS gem_prijs, avg(massa_ledig_voertuig) AS gem_massa',
        where: `${PERSONENAUTO} AND merk=${m} AND handelsbenaming IS NOT NULL`,
        group: 'handelsbenaming',
        order: 'aantal DESC',
        limit: 40,
      },
      RDW_OPTIES
    ),
    rdwQuery(
      DATASETS.voertuig,
      {
        select: 'handelsbenaming, count(1) AS verlopen',
        where: `${PERSONENAUTO} AND merk=${m} AND vervaldatum_apk < '${vandaagRdw()}'`,
        group: 'handelsbenaming',
        limit: 400,
      },
      RDW_OPTIES
    ).catch(() => []),
    rdwQuery(
      DATASETS.voertuig,
      {
        select: 'eerste_kleur, count(1) AS aantal',
        where: `${PERSONENAUTO} AND merk=${m} AND eerste_kleur IS NOT NULL`,
        group: 'eerste_kleur',
        order: 'aantal DESC',
        limit: 8,
      },
      RDW_OPTIES
    ).catch(() => []),
  ]);

  const verlopenPerModel = new Map(
    verlopen.map((v) => [v.handelsbenaming, n(v.verlopen) ?? 0])
  );

  return {
    modellen: modellen
      .map((r) => ({
        model: r.handelsbenaming,
        modelNet: titelCase(r.handelsbenaming),
        aantal: n(r.aantal),
        gemPrijs: n(r.gem_prijs),
        gemMassa: n(r.gem_massa),
        verlopen: verlopenPerModel.get(r.handelsbenaming) ?? 0,
      }))
      .filter((r) => r.model && r.aantal),
    kleuren: kleuren
      .map((k) => ({ kleurNet: titelCase(k.eerste_kleur), aantal: n(k.aantal) }))
      .filter((k) => k.kleurNet && k.aantal),
  };
}

async function haalRecalls() {
  const rijen = await rdwQuery(
    DATASETS.recallActie,
    { order: 'publicatiedatum_rdw DESC', limit: 1200 },
    RDW_OPTIES
  );
  const RISICO = { ERN: 'Ernstig', GEM: 'Gemiddeld', GER: 'Gering' };
  return rijen.map((a) => ({
    referentie: a.referentiecode_rdw,
    publicatiedatum: formatteerDatum(a.publicatiedatum_rdw),
    publicatieRuw: a.publicatiedatum_rdw ?? '',
    producent: a.meldende_producent_distributeur ?? null,
    defect: a.omschrijving_defect ?? null,
    categorie: a.categorie_defect ?? null,
    gevolgen: a['materi_le_gevolgen'] ?? null,
    herstel: a.beschrijving_van_het_herstel ?? null,
    risico: RISICO[a.risicobeoordeling_rdw] ?? null,
    aantalVoertuigenNl: n(a.nationaal_opgegeven_aantal_voertuigen_terugroepactie),
  }));
}

/**
 * Koppel terugroepacties aan een merk.
 *
 * De RDW-data legt die koppeling niet vast: een actie noemt alleen de importeur
 * ("Louwman Parts & Service B.V."), niet het merk. Daarom pakken we per actie één
 * betrokken kenteken en zoeken we daarvan het merk op.
 *
 * Dat kost twee verzoeken per actie, dus we cachen het resultaat in de repo en
 * lossen per run maximaal een paar honderd nieuwe acties op. Na een handvol dagen
 * is de cache compleet en kost dit vrijwel niets meer.
 */
async function koppelRecallsAanMerken(recalls) {
  const cachePad = join(DATA, 'recall-merken.json');
  const cache = await leesJson(cachePad, {});

  const onbekend = recalls
    .map((r) => r.referentie)
    .filter((ref) => ref && !(ref in cache))
    .slice(0, MAX_RECALL_RESOLUTIES);

  if (onbekend.length) {
    log(`terugroepacties koppelen aan merk: ${onbekend.length} nieuw`);
    await inBatches(onbekend, 6, async (ref) => {
      try {
        const koppels = await rdwQuery(
          DATASETS.recallKoppeling,
          { referentiecode_rdw: ref, limit: 1 },
          RDW_OPTIES
        );
        const kenteken = koppels?.[0]?.kenteken;
        if (!kenteken) {
          cache[ref] = null;
          return;
        }
        const v = await rdwQuery(
          DATASETS.voertuig,
          { kenteken, select: 'merk', limit: 1 },
          RDW_OPTIES
        );
        cache[ref] = v?.[0]?.merk ?? null;
      } catch {
        // Niet cachen bij een fout: volgende run opnieuw proberen.
      }
    });
    await mkdir(DATA, { recursive: true });
    await writeFile(cachePad, JSON.stringify(cache, null, 1), 'utf8');
  }

  const perMerk = new Map();
  for (const r of recalls) {
    const merk = cache[r.referentie];
    if (!merk) continue;
    if (!perMerk.has(merk)) perMerk.set(merk, []);
    perMerk.get(merk).push(r);
  }
  const opgelost = Object.values(cache).filter(Boolean).length;
  log(`merkkoppeling: ${opgelost} van ${Object.keys(cache).length} acties opgelost`);
  return perMerk;
}

/* ---- statische teksten --------------------------------------------- */

const OVER_HTML = `
<h1>Over Kentekenwacht</h1>
<p>Kentekenwacht doet twee dingen. Het laat je gratis zien wat er over een voertuig
   in het RDW-register staat: de APK-vervaldatum, <strong>openstaande
   terugroepacties</strong>, de gebreken bij de laatste keuring en alle
   voertuiggegevens. En het houdt dat voor je in de gaten, elke dag, met een e-mail
   zodra er iets verandert.</p>
<p>Dat eerste kan ook bij het RDW zelf, op <a href="https://ovi.rdw.nl"
   rel="noopener">ovi.rdw.nl</a> — wij zeggen dat er liever bij dan dat je het zelf
   ontdekt. Het verschil zit in het tweede: daar moet je zelf gaan kijken, hier word
   je gewaarschuwd.</p>
<h2>Waar komt de data vandaan?</h2>
<p>Alles komt uit <a href="https://opendata.rdw.nl" rel="noopener">RDW Open Data</a>,
   de openbare dataset die de Dienst Wegverkeer kosteloos publiceert en die
   uitdrukkelijk bedoeld is voor hergebruik. We gebruiken vijf registers: gekentekende
   voertuigen, brandstof, terugroepacties, de koppeling tussen terugroepacties en
   kentekens, en geconstateerde gebreken.</p>
<h2>Hoe actueel is het?</h2>
<p>Kentekenchecks halen de gegevens live op bij het RDW, met maximaal zes uur
   caching. De merk- en modelpagina's worden elke nacht opnieuw berekend.</p>
<h2>Zijn jullie het RDW?</h2>
<p>Nee. Kentekenwacht is een onafhankelijke dienst en heeft geen enkele band met het
   RDW. Voor officiële informatie ga je naar <a href="https://www.rdw.nl"
   rel="noopener">rdw.nl</a>.</p>
<h2>Klopt er iets niet?</h2>
<p>Wij tonen de data zoals het RDW die aanlevert en kunnen er zelf niets aan wijzigen.
   Staat er iets onjuists in het register, neem dan contact op met het RDW.</p>`;

const PRIVACY_HTML = `
<h1>Privacyverklaring</h1>
<p><em>Laatst bijgewerkt: ${vandaagNl()}</em></p>
<h2>Kentekencheck</h2>
<p>Een kenteken dat je invult sturen we door naar de openbare RDW-API om de gegevens
   op te halen. We slaan die opzoeking niet op en koppelen hem niet aan jou.</p>
<h2>Bewakingsabonnement</h2>
<p>Neem je een abonnement, dan bewaren we je e-mailadres en de kentekens die je zelf
   opgeeft. Die gebruiken we uitsluitend om je de meldingen te sturen waarvoor je
   betaalt. We verkopen geen gegevens en sturen geen ongevraagde reclame.</p>
<h2>Betalingen</h2>
<p>Betalingen lopen via Stripe. Wij zien nooit je betaalgegevens; we bewaren alleen de
   klantverwijzing die Stripe teruggeeft.</p>
<h2>Bewaartermijn</h2>
<p>Zeg je op, dan verwijderen we je gegevens binnen 30 dagen na het einde van je
   abonnement. Betaalgegevens bewaart Stripe zolang de wet dat vereist.</p>
<h2>Je rechten</h2>
<p>Je kunt je gegevens opvragen, corrigeren of laten verwijderen. Stuur een mail naar
   het adres onderaan elke melding; we reageren binnen 30 dagen.</p>
<h2>Cookies</h2>
<p>Kentekenwacht plaatst geen tracking- of advertentiecookies.</p>`;

const VOORWAARDEN_HTML = `
<h1>Algemene voorwaarden</h1>
<p><em>Laatst bijgewerkt: ${vandaagNl()}</em></p>
<h2>1. De dienst</h2>
<p>Kentekenwacht toont gegevens uit het openbare RDW-register en kan je per e-mail
   waarschuwen bij wijzigingen. Wij zijn geen officiële RDW-dienst.</p>
<h2>2. Juistheid van gegevens</h2>
<p>Wij tonen de RDW-data ongewijzigd. Wij kunnen niet instaan voor de juistheid,
   volledigheid of actualiteit ervan en aanvaarden geen aansprakelijkheid voor
   beslissingen die je erop baseert. Controleer bij twijfel altijd bij het RDW of bij
   een erkende garage.</p>
<h2>3. Meldingen</h2>
<p>Wij doen ons best meldingen tijdig te versturen, maar garanderen geen aflevering.
   Een uitblijvende melding ontslaat je niet van je eigen verantwoordelijkheid om je
   APK op tijd te laten doen of een terugroepactie op te volgen.</p>
<h2>4. Abonnement en betaling</h2>
<p>Abonnementen lopen per jaar (particulier) of per maand (wagenpark) en worden
   automatisch verlengd tot je opzegt. Opzeggen kan op elk moment; je bewaking loopt
   door tot het einde van de betaalde periode. Er volgt geen restitutie over de
   resterende periode, behalve waar de wet dat voorschrijft.</p>
<h2>5. Herroepingsrecht</h2>
<p>Als consument heb je 14 dagen bedenktijd. Omdat de dienst direct begint, stem je bij
   aanschaf in met onmiddellijke levering; je herroepingsrecht vervalt daarmee zodra de
   dienst volledig is geleverd.</p>
<h2>6. Toepasselijk recht</h2>
<p>Op deze voorwaarden is Nederlands recht van toepassing.</p>`;

/* ---- hoofdroutine --------------------------------------------------- */

async function main() {
  const start = Date.now();
  if (process.env.SITE_URL) T.SITE.url = process.env.SITE_URL.replace(/\/+$/, '');
  const bijgewerkt = vandaagNl();
  const paden = [];

  log(`site-url: ${T.SITE.url}`);

  /* 1. Merken en totaal */
  const merken = await haalMerken();
  log(`${merken.length} merken opgehaald`);
  const totaalRij = await rdwQuery(
    DATASETS.voertuig,
    { select: 'count(1) AS aantal', where: PERSONENAUTO },
    RDW_OPTIES
  ).catch(() => []);
  const totaalAutos = n(totaalRij?.[0]?.aantal);

  /* 2. Terugroepacties */
  const recalls = await haalRecalls();
  log(`${recalls.length} terugroepacties opgehaald`);
  const recallsPerMerk = await koppelRecallsAanMerken(recalls);

  /* 3. Merk- en modelpagina's */
  let modelPaginas = 0;
  const merkDetails = await inBatches(merken, 4, async (m) => {
    try {
      const detail = await haalMerkDetail(m.merk);
      return { ...m, ...detail };
    } catch (fout) {
      log(`merk ${m.merk} overgeslagen: ${fout.message}`);
      return { ...m, modellen: [], kleuren: [] };
    }
  });

  for (const m of merkDetails) {
    const merkRecalls = recallsPerMerk.get(m.merk) ?? [];
    const zichtbareModellen = m.modellen.slice(0, MAX_MODELLEN_PER_MERK);

    await schrijf(
      `merk/${slug(m.merk)}/index.html`,
      T.merkPagina({
        merk: m.merk,
        merkNet: m.merkNet,
        totaal: m.aantal,
        modellen: zichtbareModellen,
        kleuren: m.kleuren,
        recalls: merkRecalls,
        bijgewerkt,
      })
    );
    paden.push({ url: `/merk/${slug(m.merk)}/`, prio: '0.7' });

    for (const mod of zichtbareModellen) {
      if (mod.aantal < MIN_AANTAL_MODEL) continue;
      await schrijf(
        `merk/${slug(m.merk)}/${slug(mod.model)}/index.html`,
        T.modelPagina({
          merk: m.merk,
          merkNet: m.merkNet,
          model: mod.model,
          modelNet: mod.modelNet,
          aantal: mod.aantal,
          verlopen: mod.verlopen,
          gemPrijs: mod.gemPrijs,
          gemMassa: mod.gemMassa,
          recalls: merkRecalls,
          bijgewerkt,
        })
      );
      paden.push({ url: `/merk/${slug(m.merk)}/${slug(mod.model)}/`, prio: '0.6' });
      modelPaginas++;
    }
  }
  log(`${merkDetails.length} merkpagina's, ${modelPaginas} modelpagina's`);

  /* 4. Vaste pagina's */
  await schrijf(
    'index.html',
    T.homePagina({
      totaalAutos,
      topMerken: merken,
      recenteRecalls: recalls,
      bijgewerkt,
    })
  );
  paden.push({ url: '/', prio: '1.0' });

  await schrijf('merken/index.html', T.merkenIndex({ merken, bijgewerkt }));
  paden.push({ url: '/merken/', prio: '0.8' });

  await schrijf(
    'terugroepacties/index.html',
    T.terugroepactiesPagina({ recalls, bijgewerkt })
  );
  paden.push({ url: '/terugroepacties/', prio: '0.9' });

  await schrijf(
    'wacht/index.html',
    T.wachtPagina({
      prijsJaar: process.env.KW_PRIJS_JAAR ?? '4,50',
      prijsZakelijk: process.env.KW_PRIJS_ZAKELIJK ?? '19,00',
    })
  );
  paden.push({ url: '/wacht/', prio: '0.9' });

  for (const [pad, titel, beschrijving, html] of [
    ['over', 'Over Kentekenwacht', 'Wat Kentekenwacht doet, waar de data vandaan komt en wat we niet zijn.', OVER_HTML],
    ['privacy', 'Privacyverklaring', 'Welke gegevens Kentekenwacht verwerkt en hoe lang we ze bewaren.', PRIVACY_HTML],
    ['voorwaarden', 'Algemene voorwaarden', 'De voorwaarden waaronder Kentekenwacht wordt geleverd.', VOORWAARDEN_HTML],
  ]) {
    await schrijf(
      `${pad}/index.html`,
      T.tekstPagina({ titel, beschrijving, pad: `/${pad}/`, html })
    );
    paden.push({ url: `/${pad}/`, prio: '0.3' });
  }

  /* 5. Sitemap, robots, favicon */
  const nu = new Date().toISOString().slice(0, 10);
  await schrijf(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paden
  .map(
    (p) =>
      `  <url><loc>${T.SITE.url}${p.url}</loc><lastmod>${nu}</lastmod><priority>${p.prio}</priority></url>`
  )
  .join('\n')}
</urlset>`
  );

  await schrijf(
    'robots.txt',
    `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${T.SITE.url}/sitemap.xml
`
  );

  await schrijf(
    'assets/plaat.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 44">
<rect x="1.5" y="1.5" width="61" height="41" rx="6" fill="#f5c518" stroke="#1a1a1a" stroke-width="3"/>
<rect x="1.5" y="1.5" width="14" height="41" rx="6" fill="#039"/>
<rect x="9" y="1.5" width="7" height="41" fill="#039"/>
<text x="8.5" y="30" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">N</text>
<text x="40" y="32" font-family="ui-monospace,monospace" font-size="20" font-weight="700" fill="#1a1a1a" text-anchor="middle">KW</text>
</svg>`
  );

  await schrijf(
    '_headers',
    `/assets/*
  Cache-Control: public, max-age=604800

/api/*
  X-Robots-Tag: noindex

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
`
  );

  log(
    `klaar: ${paden.length} pagina's in ${((Date.now() - start) / 1000).toFixed(1)}s`
  );
}

main().catch((fout) => {
  console.error('[build] MISLUKT:', fout);
  process.exit(1);
});
