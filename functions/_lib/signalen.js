/**
 * Het beslisdeel van de waarschuwingsmotor: wat is er veranderd, en is dat
 * een mail waard?
 *
 * Apart van cron.js gehouden zodat het zonder netwerk of database te testen is.
 * Dit is de code waar het product op staat of valt: te veel mailen kost je de
 * klant, te weinig mailen maakt het abonnement waardeloos.
 */

/** Comprimeer een rapport tot de velden waarop we wijzigingen detecteren. */
export function maakSnapshot(r) {
  return {
    apk: r.apk?.vervaldatumRuw ?? null,
    wam: r.voertuig?.wamVerzekerd ?? null,
    teller: r.voertuig?.tellerstandoordeel ?? null,
    tenaamstelling: r.voertuig?.datumTenaamstelling ?? null,
    recalls: (r.terugroepacties ?? [])
      .filter((t) => t.openstaand)
      .map((t) => t.referentie)
      .sort(),
    gebrekDatum: r.gebreken?.[0]?.gemeldOp ?? null,
  };
}

/**
 * Vergelijk twee momentopnamen en lever de gebeurtenissen op die tellen.
 * @param {object|null} vorige  snapshot van de vorige controle
 * @param {object} huidige      snapshot van nu
 * @param {object} rapport      het volledige rapport, voor de tekst
 */
export function bepaalSignalen(vorige, huidige, rapport) {
  const signalen = [];

  /* Nieuwe openstaande terugroepacties — de belangrijkste melding. */
  const oud = new Set(vorige?.recalls ?? []);
  for (const ref of huidige.recalls) {
    if (oud.has(ref)) continue;
    const actie = (rapport.terugroepacties ?? []).find((t) => t.referentie === ref);
    signalen.push({
      soort: 'recall',
      sleutel: ref,
      urgentie: 3,
      kop: 'Nieuwe terugroepactie',
      tekst: actie?.defect ?? 'Er is een terugroepactie op dit voertuig geregistreerd.',
      extra: actie?.gevolgen ?? null,
      actie: 'Herstel is gratis bij de merkdealer. Maak een afspraak.',
    });
  }

  /* APK. De sleutel bevat de vervaldatum, zodat dezelfde drempel volgend
     jaar opnieuw mag worden gemeld maar dit jaar niet twee keer. */
  const dagen = rapport.apk?.dagenResterend;
  const apkSleutel = huidige.apk ?? 'onbekend';
  if (typeof dagen === 'number') {
    if (dagen < 0) {
      signalen.push({
        soort: 'apk_verlopen',
        sleutel: apkSleutel,
        urgentie: 3,
        kop: 'APK is verlopen',
        tekst: `De APK verliep op ${rapport.apk.vervaldatum}.`,
        actie: 'Met een verlopen APK mag je de weg niet op. Plan direct een keuring.',
      });
    } else {
      for (const [drempel, soort] of [
        [7, 'apk_7'],
        [30, 'apk_30'],
        [60, 'apk_60'],
      ]) {
        if (dagen <= drempel) {
          signalen.push({
            soort,
            sleutel: apkSleutel,
            urgentie: drempel <= 7 ? 3 : drempel <= 30 ? 2 : 1,
            kop: `APK verloopt over ${dagen} dagen`,
            tekst: `Vervaldatum: ${rapport.apk.vervaldatum}.`,
            actie: 'Plan de keuring nu in; vlak voor de datum zitten garages vol.',
          });
          break; // Alleen de scherpste drempel die geldt.
        }
      }
    }
  }

  /* Verzekering weggevallen. */
  if (vorige?.wam === true && huidige.wam === false) {
    signalen.push({
      soort: 'wam',
      sleutel: new Date().toISOString().slice(0, 10),
      urgentie: 3,
      kop: 'Verzekering vervallen',
      tekst: 'Dit voertuig staat niet langer als WAM-verzekerd geregistreerd.',
      actie: 'Onverzekerd op de weg levert een boete op. Controleer je polis.',
    });
  }

  /* Tellerstandoordeel gewijzigd — relevant bij verkoop. */
  if (vorige && vorige.teller !== huidige.teller && huidige.teller) {
    signalen.push({
      soort: 'teller',
      sleutel: String(huidige.teller),
      urgentie: 2,
      kop: 'Tellerstandoordeel gewijzigd',
      tekst: `Het RDW beoordeelt de reeks tellerstanden nu als: ${huidige.teller}.`,
    });
  }

  /* Nieuwe keuring met gebreken. */
  if (vorige && vorige.gebrekDatum !== huidige.gebrekDatum && huidige.gebrekDatum) {
    const lijst = (rapport.gebreken ?? []).map((g) => g.omschrijving).slice(0, 5);
    signalen.push({
      soort: 'gebreken',
      sleutel: String(huidige.gebrekDatum),
      urgentie: 2,
      kop: 'Gebreken bij keuring',
      tekst: `Bij de keuring van ${huidige.gebrekDatum} is geconstateerd: ${lijst.join('; ')}.`,
    });
  }

  /* Overschrijving: nuttig als signaal dat de auto verkocht is. */
  if (
    vorige?.tenaamstelling &&
    huidige.tenaamstelling &&
    vorige.tenaamstelling !== huidige.tenaamstelling
  ) {
    signalen.push({
      soort: 'tenaamstelling',
      sleutel: String(huidige.tenaamstelling),
      urgentie: 1,
      kop: 'Tenaamstelling gewijzigd',
      tekst: `Het voertuig staat sinds ${huidige.tenaamstelling} op een andere naam.`,
    });
  }

  return signalen.sort((a, b) => b.urgentie - a.urgentie);
}
