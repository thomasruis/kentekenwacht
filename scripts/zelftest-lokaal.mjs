#!/usr/bin/env node
/**
 * Lokale test zonder netwerk. Vervangt fetch door een nagebootste RDW-API met
 * echte responsvormen, zodat de volledige keten (rapport -> signalen -> HTML)
 * gecontroleerd kan worden in een omgeving zonder internettoegang.
 *
 *   node scripts/zelftest-lokaal.mjs
 */

import { installeerMock, VOORRAAD } from './mock-rdw.mjs';
installeerMock();

/* ---------- de test ---------- */

const { haalVoertuigRapport, normaliseerKenteken, slug, titelCase } = await import(
  '../functions/_lib/rdw.js'
);
const T = await import('./templates.mjs');

let ok = 0;
let fout = 0;
const check = (naam, voorwaarde, detail = '') => {
  if (voorwaarde) {
    ok++;
    console.log(`  ✓ ${naam}`);
  } else {
    fout++;
    console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('\nLokale zelftest (nagebootste RDW-API)\n');

console.log('Kenteken');
check('streepjes', normaliseerKenteken('89-kk-z2') === '89KKZ2');
check('te kort', normaliseerKenteken('89KKZ') === null);
check('alleen cijfers', normaliseerKenteken('123456') === null);
check('slug met accent', slug('Citroën C3') === 'citroen-c3');
check('titelcase', titelCase('MERCEDES-BENZ') === 'Mercedes-Benz');

console.log('\nRapport');
const r = await haalVoertuigRapport('89-kk-z2');
check('geen fout', !r.fout, r.fout ?? '');
check('merk in titelcase', r.voertuig.merk === 'Kia', r.voertuig.merk);
check('bouwjaar afgeleid', r.voertuig.bouwjaar === '2010', r.voertuig.bouwjaar);
check('APK-datum omgezet', r.apk.vervaldatum === '05-01-2027', r.apk.vervaldatum);
check('APK-status bepaald', Boolean(r.apk.status.code), r.apk.status.code);
check('brandstof gekoppeld', r.brandstof[0]?.omschrijving === 'Benzine');
check('twee terugroepacties', r.terugroepacties.length === 2);
check(
  'openstaande actie herkend (status P)',
  r.terugroepacties.filter((t) => t.openstaand).length === 1,
  JSON.stringify(r.terugroepacties.map((t) => [t.referentie, t.openstaand]))
);
check('vlag openstaand gezet', r.openstaandeTerugroepactie === true);
check(
  'ernstigste actie staat bovenaan',
  r.terugroepacties[0].risico === 'Ernstig',
  r.terugroepacties[0].risico
);
check(
  'omschrijving gekoppeld',
  r.terugroepacties[0].defect?.includes('stuurkoppeling')
);
check(
  'ongeldige url weggefilterd',
  r.terugroepacties[0].meerInfoUrl === null,
  String(r.terugroepacties[0].meerInfoUrl)
);
check(
  'www-url aangevuld tot https',
  r.terugroepacties[1].meerInfoUrl === 'https://www.suzuki.nl/service/terugroepacties',
  String(r.terugroepacties[1].meerInfoUrl)
);
check(
  'alleen laatste keuring getoond',
  r.gebreken.length === 2,
  `${r.gebreken.length} gebreken`
);
check(
  'nieuwste omschrijving bij hergebruikte code',
  r.gebreken.find((g) => g.code === 'AC4')?.omschrijving === 'Bandenprofiel te gering',
  r.gebreken.find((g) => g.code === 'AC4')?.omschrijving
);

console.log('\nOnbekend kenteken');
const leeg = await haalVoertuigRapport('11AA11');
check('netjes niet_gevonden', leeg.fout === 'niet_gevonden', leeg.fout);
const slecht = await haalVoertuigRapport('!!');
check('ongeldig kenteken', slecht.fout === 'ongeldig_kenteken', slecht.fout);

console.log('\nHTML-generatie');
const html = T.homePagina({
  totaalAutos: 9123456,
  topMerken: [
    { merk: 'VOLKSWAGEN', merkNet: 'Volkswagen', aantal: 1000000 },
    { merk: "O'BRIEN & CO", merkNet: "O'Brien & Co", aantal: 12 },
  ],
  recenteRecalls: [
    {
      categorie: 'Remmen <script>alert(1)</script>',
      producent: 'Test & Co',
      risico: 'Ernstig',
      publicatiedatum: '01-09-2026',
    },
  ],
  bijgewerkt: '13 september 2026',
});
check('doctype aanwezig', html.startsWith('<!doctype html>'));
check('taal is nl', html.includes('<html lang="nl">'));
check('canonical aanwezig', html.includes('rel="canonical"'));
check('json-ld aanwezig', html.includes('application/ld+json'));
check(
  'script in data is ontsnapt',
  !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'),
  'XSS-lek in sjabloon'
);
check('ampersand ontsnapt', html.includes('Test &amp; Co'));
check('getal in NL-notatie', html.includes('9.123.456'));

const merkHtml = T.merkPagina({
  merk: 'VOLKSWAGEN',
  merkNet: 'Volkswagen',
  totaal: 1000000,
  modellen: [
    { model: 'GOLF', modelNet: 'Golf', aantal: 200000, verlopen: 5000, gemPrijs: 28000 },
  ],
  kleuren: [{ kleurNet: 'Grijs', aantal: 300000 }],
  recalls: r.terugroepacties,
  bijgewerkt: '13 september 2026',
});
check('merkpagina linkt naar model', merkHtml.includes('/merk/volkswagen/golf/'));
check('kruimelpad aanwezig', merkHtml.includes('BreadcrumbList'));

const modelHtml = T.modelPagina({
  merk: 'VOLKSWAGEN',
  merkNet: 'Volkswagen',
  model: 'GOLF',
  modelNet: 'Golf',
  aantal: 200000,
  verlopen: 5000,
  gemPrijs: 28000,
  gemMassa: 1300,
  recalls: [],
  bijgewerkt: '13 september 2026',
});
check('modelpagina heeft canonical', modelHtml.includes('/merk/volkswagen/golf/'));
check('percentage berekend', modelHtml.includes('2.5%'));

const wachtHtml = T.wachtPagina({ prijsJaar: '4,50', prijsZakelijk: '19,00' });
check('prijspagina toont bedrag', wachtHtml.includes('4,50'));
check('koopscript ingeladen', wachtHtml.includes('kw-koop.js'));

console.log('\nSubverzoekbudget');
// De gratis Cloudflare-laag staat 50 externe subverzoeken per aanroep toe.
// De cron verwerkt zes kentekens per ronde, dus één rapport mag er hooguit
// zes kosten. Gaat dit omhoog, dan moet de portiegrootte in cron.js omlaag.
{
  const echt = globalThis.fetch;
  let geteld = 0;
  globalThis.fetch = (...a) => {
    geteld++;
    return echt(...a);
  };
  await haalVoertuigRapport('89KKZ2');
  globalThis.fetch = echt;
  check(
    'één rapport kost hooguit 6 externe verzoeken',
    geteld <= 6,
    `${geteld} verzoeken`
  );
  check(
    'zes kentekens plus e-mails passen binnen de 50',
    geteld * 6 + 6 <= 50,
    `${geteld * 6 + 6} verzoeken per ronde`
  );
}

console.log('\nSignalen (waarschuwingsmotor)');
const { bepaalSignalenTest } = await import('./signalen-test.mjs');
const signaalUitslag = bepaalSignalenTest(r);
for (const [naam, geslaagd, detail] of signaalUitslag) check(naam, geslaagd, detail);

console.log(`\n${ok} geslaagd, ${fout} mislukt \n`);
process.exit(fout ? 1 : 0);
