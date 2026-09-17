/** Scenariotests voor de waarschuwingslogica. Geen netwerk, geen database. */

import { maakSnapshot, bepaalSignalen } from '../functions/_lib/signalen.js';

/** Bouw een rapport met de gegeven APK-termijn in dagen. */
function rapportMetApk(dagen, extra = {}) {
  const d = new Date(Date.now() + dagen * 86400000);
  const ruw = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
  return {
    kenteken: '89KKZ2',
    voertuig: {
      merk: 'Kia',
      handelsbenaming: 'Sorento',
      wamVerzekerd: true,
      tellerstandoordeel: 'Logisch',
      datumTenaamstelling: '01-03-2018',
      ...extra.voertuig,
    },
    apk: { vervaldatumRuw: ruw, vervaldatum: 'x', dagenResterend: dagen },
    terugroepacties: extra.terugroepacties ?? [],
    gebreken: extra.gebreken ?? [],
  };
}

const soorten = (s) => s.map((x) => x.soort).sort();

export function bepaalSignalenTest(echtRapport) {
  const uitslag = [];
  const t = (naam, voorwaarde, detail = '') => uitslag.push([naam, voorwaarde, detail]);

  /* --- Eerste keer: geen vorige momentopname --- */
  const r1 = rapportMetApk(200);
  const s1 = maakSnapshot(r1);
  t(
    'nulmeting zonder APK-drempel geeft niets',
    bepaalSignalen(null, s1, r1).length === 0,
    soorten(bepaalSignalen(null, s1, r1)).join(',')
  );

  /* --- APK-drempels --- */
  for (const [dagen, verwacht] of [
    [90, null],
    [59, 'apk_60'],
    [30, 'apk_30'],
    [7, 'apk_7'],
    [1, 'apk_7'],
    [-3, 'apk_verlopen'],
  ]) {
    const r = rapportMetApk(dagen);
    const s = bepaalSignalen(maakSnapshot(rapportMetApk(365)), maakSnapshot(r), r);
    const apkSignalen = s.filter((x) => x.soort.startsWith('apk'));
    t(
      `APK op ${dagen} dagen → ${verwacht ?? 'geen melding'}`,
      verwacht
        ? apkSignalen.length === 1 && apkSignalen[0].soort === verwacht
        : apkSignalen.length === 0,
      soorten(apkSignalen).join(',')
    );
  }

  /* --- Geen dubbele APK-drempels tegelijk --- */
  const r5 = rapportMetApk(5);
  const s5 = bepaalSignalen(maakSnapshot(rapportMetApk(365)), maakSnapshot(r5), r5);
  t(
    'slechts één APK-drempel per keer',
    s5.filter((x) => x.soort.startsWith('apk')).length === 1,
    soorten(s5).join(',')
  );

  /* --- Nieuwe terugroepactie --- */
  const zonder = rapportMetApk(300);
  const met = rapportMetApk(300, {
    terugroepacties: [
      {
        referentie: 'MGP999',
        openstaand: true,
        defect: 'Remleiding kan lekken',
        gevolgen: 'Langere remweg',
      },
    ],
  });
  const sRecall = bepaalSignalen(maakSnapshot(zonder), maakSnapshot(met), met);
  t(
    'nieuwe terugroepactie geeft melding',
    sRecall.length === 1 && sRecall[0].soort === 'recall',
    soorten(sRecall).join(',')
  );
  t(
    'terugroepactie krijgt hoogste urgentie',
    sRecall[0]?.urgentie === 3,
    String(sRecall[0]?.urgentie)
  );
  t(
    'defecttekst overgenomen',
    sRecall[0]?.tekst === 'Remleiding kan lekken',
    sRecall[0]?.tekst
  );

  /* --- Dezelfde terugroepactie meldt niet opnieuw --- */
  const sHerhaald = bepaalSignalen(maakSnapshot(met), maakSnapshot(met), met);
  t(
    'bekende terugroepactie meldt niet opnieuw',
    sHerhaald.length === 0,
    soorten(sHerhaald).join(',')
  );

  /* --- Herstelde actie telt niet als openstaand --- */
  const hersteld = rapportMetApk(300, {
    terugroepacties: [{ referentie: 'MGP999', openstaand: false, defect: 'x' }],
  });
  t(
    'herstelde actie zit niet in de momentopname',
    maakSnapshot(hersteld).recalls.length === 0
  );

  /* --- Verzekering vervalt --- */
  const verzekerd = rapportMetApk(300);
  const onverzekerd = rapportMetApk(300, { voertuig: { wamVerzekerd: false } });
  const sWam = bepaalSignalen(
    maakSnapshot(verzekerd),
    maakSnapshot(onverzekerd),
    onverzekerd
  );
  t(
    'wegvallende verzekering geeft melding',
    sWam.some((x) => x.soort === 'wam'),
    soorten(sWam).join(',')
  );
  const sWamTerug = bepaalSignalen(
    maakSnapshot(onverzekerd),
    maakSnapshot(verzekerd),
    verzekerd
  );
  t(
    'weer verzekerd geeft géén melding',
    !sWamTerug.some((x) => x.soort === 'wam'),
    soorten(sWamTerug).join(',')
  );

  /* --- Tellerstandoordeel --- */
  const onlogisch = rapportMetApk(300, {
    voertuig: { tellerstandoordeel: 'Onlogisch' },
  });
  t(
    'gewijzigd tellerstandoordeel geeft melding',
    bepaalSignalen(maakSnapshot(rapportMetApk(300)), maakSnapshot(onlogisch), onlogisch)
      .some((x) => x.soort === 'teller')
  );

  /* --- Nieuwe keuring met gebreken --- */
  const metGebrek = rapportMetApk(300, {
    gebreken: [{ omschrijving: 'Remschijf te sterk gesleten', gemeldOp: '10-01-2026' }],
  });
  const sGebrek = bepaalSignalen(
    maakSnapshot(rapportMetApk(300)),
    maakSnapshot(metGebrek),
    metGebrek
  );
  t(
    'nieuwe keuringsgebreken geven melding',
    sGebrek.some((x) => x.soort === 'gebreken'),
    soorten(sGebrek).join(',')
  );

  /* --- Tenaamstelling --- */
  const verkocht = rapportMetApk(300, {
    voertuig: { datumTenaamstelling: '01-09-2026' },
  });
  t(
    'overschrijving geeft melding',
    bepaalSignalen(maakSnapshot(rapportMetApk(300)), maakSnapshot(verkocht), verkocht)
      .some((x) => x.soort === 'tenaamstelling')
  );

  /* --- Sortering op urgentie --- */
  const alles = rapportMetApk(-1, {
    voertuig: { tellerstandoordeel: 'Onlogisch' },
    terugroepacties: [{ referentie: 'X1', openstaand: true, defect: 'd' }],
  });
  const sAlles = bepaalSignalen(maakSnapshot(rapportMetApk(365)), maakSnapshot(alles), alles);
  t(
    'meldingen staan op urgentie gesorteerd',
    sAlles.length >= 2 && sAlles[0].urgentie >= sAlles[sAlles.length - 1].urgentie,
    sAlles.map((x) => `${x.soort}:${x.urgentie}`).join(',')
  );

  /* --- Voertuig zonder APK-datum (aanhanger) --- */
  const geenApk = {
    ...rapportMetApk(300),
    apk: { vervaldatumRuw: null, vervaldatum: null, dagenResterend: null },
  };
  t(
    'voertuig zonder APK-datum geeft geen APK-melding',
    !bepaalSignalen(maakSnapshot(geenApk), maakSnapshot(geenApk), geenApk).some((x) =>
      x.soort.startsWith('apk')
    )
  );

  /* --- Het echte rapport uit de nagebootste API --- */
  if (echtRapport) {
    const leeg = { apk: null, wam: null, teller: null, tenaamstelling: null, recalls: [], gebrekDatum: null };
    const s = bepaalSignalen(leeg, maakSnapshot(echtRapport), echtRapport);
    t(
      'echt rapport levert de openstaande terugroepactie op',
      s.some((x) => x.soort === 'recall' && x.sleutel === 'MGP070060'),
      soorten(s).join(',')
    );
  }

  return uitslag;
}
