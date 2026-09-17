#!/usr/bin/env node
/**
 * Zelfcontrole tegen de echte RDW-API.
 *
 * Draait bij elke build vóór de generatie, zodat een wijziging aan de kant van
 * het RDW meteen opvalt in plaats van stil een halve site op te leveren.
 *
 *   npm run verify
 */

import {
  DATASETS,
  rdwQuery,
  normaliseerKenteken,
  haalVoertuigRapport,
  formatteerDatum,
  dagenTot,
  slug,
} from '../functions/_lib/rdw.js';

let mislukt = 0;
let gelukt = 0;

function check(naam, voorwaarde, detail = '') {
  if (voorwaarde) {
    gelukt++;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt++;
    console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('\nKentekenwacht — zelfcontrole\n');

  /* 1. Kentekennormalisatie (geen netwerk) */
  console.log('Kentekennormalisatie');
  check('streepjes weg', normaliseerKenteken('12-ab-34') === '12AB34');
  check('spaties weg', normaliseerKenteken(' g 123 bc ') === 'G123BC');
  check('te kort afgewezen', normaliseerKenteken('12AB3') === null);
  check('te lang afgewezen', normaliseerKenteken('12ABC34') === null);
  check('alleen cijfers afgewezen', normaliseerKenteken('123456') === null);
  check('alleen letters afgewezen', normaliseerKenteken('ABCDEF') === null);
  check('rommel afgewezen', normaliseerKenteken(null) === null);

  console.log('\nDatumverwerking');
  check('RDW-datum omzetten', formatteerDatum('20270105') === '05-01-2027');
  check('lege datum', formatteerDatum(null) === null);
  check('onzin-datum', formatteerDatum('xyz') === null);
  check('dagen tot verleden is negatief', dagenTot('20200101') < 0);

  console.log('\nSlugs');
  check('spaties naar streepjes', slug('Volkswagen Golf') === 'volkswagen-golf');
  check('accenten weg', slug('Citroën C3') === 'citroen-c3');
  check('schuine streep', slug('MERCEDES-BENZ A/B') === 'mercedes-benz-a-b');

  /* 2. Datasets bereikbaar en velden aanwezig */
  console.log('\nRDW-datasets');
  const verwacht = {
    voertuig: ['kenteken', 'merk', 'handelsbenaming', 'voertuigsoort', 'vervaldatum_apk'],
    brandstof: ['kenteken', 'brandstof_omschrijving', 'brandstof_volgnummer'],
    recallKoppeling: ['kenteken', 'referentiecode_rdw', 'code_status'],
    recallActie: [
      'referentiecode_rdw',
      'omschrijving_defect',
      'categorie_defect',
      'risicobeoordeling_rdw',
      'publicatiedatum_rdw',
    ],
    gebrekenGeconstateerd: [
      'kenteken',
      'gebrek_identificatie',
      'meld_datum_door_keuringsinstantie',
    ],
    gebrekenCodes: ['gebrek_identificatie', 'gebrek_omschrijving'],
  };

  for (const [naam, velden] of Object.entries(verwacht)) {
    try {
      const rijen = await rdwQuery(DATASETS[naam], { limit: 1 });
      const aanwezig = Object.keys(rijen?.[0] ?? {});
      const ontbreekt = velden.filter((v) => !aanwezig.includes(v));
      check(
        `${naam} (${DATASETS[naam]})`,
        rijen?.length > 0 && ontbreekt.length === 0,
        ontbreekt.length ? `velden ontbreken: ${ontbreekt.join(', ')}` : 'geen rijen'
      );
    } catch (e) {
      check(`${naam} (${DATASETS[naam]})`, false, e.message);
    }
  }

  /* 3. Aggregatiequery's, zoals de build ze gebruikt */
  console.log('\nAggregaties');
  try {
    const merken = await rdwQuery(DATASETS.voertuig, {
      select: 'merk, count(1) AS aantal',
      where: "voertuigsoort='Personenauto' AND merk IS NOT NULL",
      group: 'merk',
      order: 'aantal DESC',
      limit: 3,
    });
    check(
      'groeperen op merk met alias',
      merken.length === 3 && Number(merken[0].aantal) > 0,
      JSON.stringify(merken[0] ?? {})
    );
  } catch (e) {
    check('groeperen op merk met alias', false, e.message);
  }

  /* 4. Volledig rapport, end-to-end */
  console.log('\nVolledig rapport');
  try {
    // Pak een willekeurig kenteken dat een openstaande terugroepactie heeft:
    // dat raakt het grootste deel van de code in één keer.
    const koppels = await rdwQuery(DATASETS.recallKoppeling, { limit: 1 });
    const proefKenteken = koppels?.[0]?.kenteken;
    check('proefkenteken gevonden', Boolean(proefKenteken), 'koppeltabel leeg');

    if (proefKenteken) {
      const r = await haalVoertuigRapport(proefKenteken);
      check('rapport opgebouwd', !r.fout, r.fout ?? '');
      check('merk ingevuld', Boolean(r.voertuig?.merk));
      check('APK-status bepaald', Boolean(r.apk?.status?.code));
      check(
        'terugroepactie verrijkt met omschrijving',
        Array.isArray(r.terugroepacties) &&
          r.terugroepacties.length > 0 &&
          r.terugroepacties.some((t) => t.defect),
        `${r.terugroepacties?.length ?? 0} acties`
      );
      check('bron vermeld', r.bron === 'RDW Open Data');
      console.log(
        `    → ${r.voertuig?.merk} ${r.voertuig?.handelsbenaming}, ` +
          `APK ${r.apk?.vervaldatum}, ${r.terugroepacties.length} terugroepactie(s)`
      );
    }
  } catch (e) {
    check('volledig rapport', false, e.message);
  }

  /* 5. Onbestaand kenteken */
  try {
    const r = await haalVoertuigRapport('ZZ999Z');
    check('onbestaand kenteken netjes afgehandeld', r.fout === 'niet_gevonden', r.fout);
  } catch (e) {
    check('onbestaand kenteken netjes afgehandeld', false, e.message);
  }

  console.log(`\n${gelukt} geslaagd, ${mislukt} mislukt\n`);
  if (mislukt) process.exit(1);
}

main().catch((e) => {
  console.error('zelfcontrole crashte:', e);
  process.exit(1);
});
