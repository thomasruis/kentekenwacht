/**
 * Gedeelde RDW-client.
 *
 * Draait ongewijzigd in Cloudflare Workers én in Node 18+ (GitHub Actions):
 * gebruikt alleen globale fetch en standaard JS.
 *
 * Bron: https://opendata.rdw.nl (Socrata SODA v2.1)
 * Geen API-key nodig. Hergebruik toegestaan, ook commercieel.
 * Bronvermelding is verplicht: "Bron: RDW Open Data".
 */

const BASE = 'https://opendata.rdw.nl/resource';

/** Dataset-identifiers. Geverifieerd op 2026-09-13. */
export const DATASETS = {
  voertuig: 'm9d7-ebf2', // Gekentekende_voertuigen
  brandstof: '8ys7-d773', // Gekentekende_voertuigen_brandstof
  carrosserie: 'jhie-znh9', // Carrosserie-specificatie
  recallKoppeling: 'bcmj-kjae', // Terugroep actie -> kenteken
  recallActie: 'j9yg-7rg9', // Terugroep_actie (omschrijving defect)
  recallRisico: '9ihi-jgpf', // Terugroep_actie_risico
  gebrekenGeconstateerd: 'a34c-vvps', // Geconstateerde Gebreken (per kenteken)
  gebrekenCodes: 'hx2c-gt7k', // Gebreken (code -> omschrijving)
};

/** Risicocodes uit veld `risicobeoordeling_rdw`. */
const RISICO = {
  ERN: { label: 'Ernstig', rang: 3 },
  GEM: { label: 'Gemiddeld', rang: 2 },
  GER: { label: 'Gering', rang: 1 },
};

/* ------------------------------------------------------------------ */
/* Kenteken                                                            */
/* ------------------------------------------------------------------ */

/**
 * Normaliseer een kenteken naar het formaat dat RDW gebruikt:
 * hoofdletters, geen streepjes of spaties. "12-ab-34" -> "12AB34".
 */
export function normaliseerKenteken(input) {
  if (typeof input !== 'string') return null;
  const schoon = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
  // Nederlandse kentekens zijn altijd exact 6 tekens.
  if (schoon.length !== 6) return null;
  // Minstens één letter en één cijfer; sluit "000000" en "AAAAAA" uit.
  if (!/[A-Z]/.test(schoon) || !/[0-9]/.test(schoon)) return null;
  return schoon;
}

/** Zet 20270105 om naar een Date (UTC middernacht). */
export function parseRdwDatum(waarde) {
  if (!waarde) return null;
  const s = String(waarde).slice(0, 8);
  if (!/^\d{8}$/.test(s)) return null;
  const d = new Date(
    Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatteerDatum(waarde) {
  const d = parseRdwDatum(waarde);
  if (!d) return null;
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(
    d.getUTCMonth() + 1
  ).padStart(2, '0')}-${d.getUTCFullYear()}`;
}

export function dagenTot(waarde) {
  const d = parseRdwDatum(waarde);
  if (!d) return null;
  const nu = new Date();
  const vandaag = Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate());
  return Math.round((d.getTime() - vandaag) / 86400000);
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

/**
 * Haal records op uit een RDW-dataset.
 * @param {string} dataset  resource-id, bv. 'm9d7-ebf2'
 * @param {Record<string,string|number>} params SoQL-parameters zonder $-prefix
 *        voor de standaardvelden (limit, select, where, group, order).
 */
export async function rdwQuery(dataset, params = {}, opties = {}) {
  const url = new URL(`${BASE}/${dataset}.json`);
  for (const [sleutel, waarde] of Object.entries(params)) {
    if (waarde === undefined || waarde === null) continue;
    const naam = ['select', 'where', 'group', 'order', 'limit', 'offset', 'q'].includes(
      sleutel
    )
      ? `$${sleutel}`
      : sleutel;
    url.searchParams.set(naam, String(waarde));
  }

  const pogingen = opties.pogingen ?? 3;
  let laatsteFout;
  for (let i = 0; i < pogingen; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Kentekenwacht/1.0 (+https://kentekenwacht.pages.dev)',
          ...(opties.appToken ? { 'X-App-Token': opties.appToken } : {}),
        },
        signal: AbortSignal.timeout(opties.timeoutMs ?? 20000),
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`RDW gaf status ${res.status}`);
      }
      if (!res.ok) {
        const tekst = await res.text();
        throw new Error(`RDW ${res.status}: ${tekst.slice(0, 200)}`);
      }
      return await res.json();
    } catch (fout) {
      laatsteFout = fout;
      if (i < pogingen - 1) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** i));
      }
    }
  }
  throw laatsteFout;
}

/** Escape een waarde voor gebruik in een SoQL WHERE-clausule. */
export function soqlString(waarde) {
  return `'${String(waarde).replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------ */
/* Het rapport                                                         */
/* ------------------------------------------------------------------ */

/**
 * Bouw een volledig voertuigrapport uit vijf RDW-datasets.
 * Retourneert null als het kenteken niet bestaat.
 */
export async function haalVoertuigRapport(kentekenInput, opties = {}) {
  const kenteken = normaliseerKenteken(kentekenInput);
  if (!kenteken) return { fout: 'ongeldig_kenteken' };

  const [voertuigen, brandstoffen, recallKoppelingen] = await Promise.all([
    rdwQuery(DATASETS.voertuig, { kenteken, limit: 1 }, opties),
    rdwQuery(DATASETS.brandstof, { kenteken, limit: 4 }, opties).catch(() => []),
    rdwQuery(DATASETS.recallKoppeling, { kenteken, limit: 50 }, opties).catch(
      () => []
    ),
  ]);

  const v = voertuigen?.[0];
  if (!v) return { fout: 'niet_gevonden', kenteken };

  // Terugroepacties: haal de omschrijvingen erbij.
  const terugroepacties = await verrijkTerugroepacties(recallKoppelingen, opties);

  // Keuringsgebreken bij de laatste APK.
  const gebreken = await haalGebreken(kenteken, opties).catch(() => []);

  const apkDagen = dagenTot(v.vervaldatum_apk);

  return {
    kenteken,
    opgehaaldOp: new Date().toISOString(),
    voertuig: {
      merk: titelCase(v.merk),
      handelsbenaming: titelCase(v.handelsbenaming),
      voertuigsoort: v.voertuigsoort ?? null,
      inrichting: v.inrichting ?? null,
      kleur: titelCase(v.eerste_kleur),
      aantalZitplaatsen: numOfNull(v.aantal_zitplaatsen),
      aantalDeuren: numOfNull(v.aantal_deuren),
      aantalWielen: numOfNull(v.aantal_wielen),
      cilinderinhoud: numOfNull(v.cilinderinhoud),
      massaLedig: numOfNull(v.massa_ledig_voertuig),
      massaRijklaar: numOfNull(v.massa_rijklaar),
      maximumMassaTrekkenGeremd: numOfNull(
        v.maximum_trekken_massa_geremd ?? v.maximum_massa_trekken_geremd
      ),
      datumEersteToelating: formatteerDatum(v.datum_eerste_toelating),
      datumEersteToelatingNl: formatteerDatum(
        v.datum_eerste_tenaamstelling_in_nederland
      ),
      datumTenaamstelling: formatteerDatum(v.datum_tenaamstelling),
      bouwjaar: v.datum_eerste_toelating
        ? String(v.datum_eerste_toelating).slice(0, 4)
        : null,
      catalogusprijs: numOfNull(v.catalogusprijs),
      brutoBpm: numOfNull(v.bruto_bpm),
      exportIndicator: jaNee(v.export_indicator),
      wamVerzekerd: jaNee(v.wam_verzekerd),
      europeseVoertuigcategorie: v.europese_voertuigcategorie ?? null,
      zuinigheidslabel: v.zuinigheidslabel ?? null,
      wachtOpKeuren: jaNee(v.wacht_op_keuren),
      tellerstandoordeel: v.tellerstandoordeel ?? null,
    },
    brandstof: (brandstoffen ?? []).map((b) => ({
      omschrijving: b.brandstof_omschrijving ?? null,
      volgnummer: numOfNull(b.brandstof_volgnummer),
      verbruikGecombineerd: numOfNull(b.brandstofverbruik_gecombineerd),
      co2Gecombineerd: numOfNull(
        b.co2_uitstoot_gecombineerd ?? b.co2_uitstoot_gewogen
      ),
      nettomaximumvermogen: numOfNull(b.nettomaximumvermogen),
      emissiecode: b.emissiecode_omschrijving ?? null,
      geluidsniveauRijdend: numOfNull(b.geluidsniveau_rijdend),
    })),
    apk: {
      vervaldatum: formatteerDatum(v.vervaldatum_apk),
      vervaldatumRuw: v.vervaldatum_apk ?? null,
      dagenResterend: apkDagen,
      status: apkStatus(apkDagen, v.voertuigsoort),
    },
    terugroepacties,
    openstaandeTerugroepactie: terugroepacties.some((t) => t.openstaand),
    gebreken,
    bron: 'RDW Open Data',
  };
}

function apkStatus(dagen, voertuigsoort) {
  if (dagen === null) {
    // Aanhangwagens en sommige categorieën zijn niet APK-plichtig.
    return { code: 'geen_apk', label: 'Geen APK-datum geregistreerd' };
  }
  if (dagen < 0)
    return {
      code: 'verlopen',
      label: `APK ${Math.abs(dagen)} dag${Math.abs(dagen) === 1 ? '' : 'en'} verlopen`,
    };
  if (dagen <= 30)
    return { code: 'bijna_verlopen', label: `APK verloopt over ${dagen} dagen` };
  if (dagen <= 60)
    return { code: 'let_op', label: `APK verloopt over ${dagen} dagen` };
  return { code: 'geldig', label: `APK nog ${dagen} dagen geldig` };
}

/**
 * Koppel elke recall-referentie aan de omschrijving van de actie.
 * `code_status` uit de koppeltabel bepaalt of de actie nog openstaat.
 */
async function verrijkTerugroepacties(koppelingen, opties) {
  if (!koppelingen?.length) return [];

  const referenties = [...new Set(koppelingen.map((k) => k.referentiecode_rdw))].filter(
    Boolean
  );
  if (!referenties.length) return [];

  const inClausule = referenties.map(soqlString).join(',');
  const acties = await rdwQuery(
    DATASETS.recallActie,
    { where: `referentiecode_rdw in(${inClausule})`, limit: 100 },
    opties
  ).catch(() => []);

  const perReferentie = new Map(acties.map((a) => [a.referentiecode_rdw, a]));

  return koppelingen
    .map((k) => {
      const a = perReferentie.get(k.referentiecode_rdw) ?? {};
      const risico = RISICO[a.risicobeoordeling_rdw] ?? null;
      // Status "P" = producent heeft herstel gemeld, "H" = hersteld aan voertuig.
      // Alles wat niet expliciet als hersteld is gemeld, behandelen we als openstaand.
      const herteld = String(k.code_status ?? '').toUpperCase() === 'H';
      return {
        referentie: k.referentiecode_rdw,
        status: k.status ?? null,
        codeStatus: k.code_status ?? null,
        openstaand: !herteld,
        publicatiedatum: formatteerDatum(a.publicatiedatum_rdw),
        producent: a.meldende_producent_distributeur ?? null,
        defect: a.omschrijving_defect ?? null,
        categorie: a.categorie_defect ?? null,
        gevolgen: a['materi_le_gevolgen'] ?? null,
        herstel: a.beschrijving_van_het_herstel ?? null,
        risico: risico?.label ?? null,
        risicoRang: risico?.rang ?? 0,
        meerInfoUrl: geldigeUrl(a.meer_informatie_op_internet),
        meerInfoTelefoon: a.meer_informatie_via_telefoonnummer ?? null,
        aantalVoertuigenNl: numOfNull(
          a.nationaal_opgegeven_aantal_voertuigen_terugroepactie
        ),
      };
    })
    .sort((a, b) => b.risicoRang - a.risicoRang);
}

/** Gebreken die bij de laatste keuring zijn geconstateerd. */
async function haalGebreken(kenteken, opties) {
  const rijen = await rdwQuery(
    DATASETS.gebrekenGeconstateerd,
    { kenteken, order: 'meld_datum_door_keuringsinstantie DESC', limit: 25 },
    opties
  );
  if (!rijen?.length) return [];

  const codes = [...new Set(rijen.map((r) => r.gebrek_identificatie))].filter(Boolean);
  let omschrijvingen = new Map();
  if (codes.length) {
    const inClausule = codes.map(soqlString).join(',');
    const codeRijen = await rdwQuery(
      DATASETS.gebrekenCodes,
      {
        where: `gebrek_identificatie in(${inClausule})`,
        // Gebrekcodes worden hergebruikt: er staan meerdere rijen per code,
        // elk met een eigen geldigheidsperiode. Nieuwste eerst.
        order: 'ingangsdatum_gebrek DESC',
        limit: 500,
      },
      opties
    ).catch(() => []);
    for (const c of codeRijen) {
      if (!omschrijvingen.has(c.gebrek_identificatie)) {
        omschrijvingen.set(c.gebrek_identificatie, c.gebrek_omschrijving);
      }
    }
  }

  // Alleen de meest recente keuringsdatum tonen.
  const nieuwsteDatum = rijen[0]?.meld_datum_door_keuringsinstantie;
  return rijen
    .filter((r) => r.meld_datum_door_keuringsinstantie === nieuwsteDatum)
    .map((r) => ({
      code: r.gebrek_identificatie,
      omschrijving:
        omschrijvingen.get(r.gebrek_identificatie) ?? 'Omschrijving onbekend',
      aantal: numOfNull(r.aantal_gebreken_geconstateerd) ?? 1,
      gemeldOp: formatteerDatum(r.meld_datum_door_keuringsinstantie),
    }));
}

/* ------------------------------------------------------------------ */
/* Hulpjes                                                             */
/* ------------------------------------------------------------------ */

function numOfNull(waarde) {
  if (waarde === undefined || waarde === null || waarde === '') return null;
  const n = Number(waarde);
  return Number.isFinite(n) ? n : null;
}

function jaNee(waarde) {
  if (waarde === undefined || waarde === null) return null;
  const s = String(waarde).toLowerCase();
  if (s === 'ja' || s === 'j' || s === 'true') return true;
  if (s === 'nee' || s === 'n' || s === 'false') return false;
  return null;
}

function geldigeUrl(waarde) {
  if (!waarde || /niet bekend/i.test(waarde)) return null;
  const s = String(waarde).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  return null;
}

export function titelCase(waarde) {
  if (!waarde) return null;
  return String(waarde)
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z0-9])/g, (_, pre, teken) => pre + teken.toUpperCase());
}

/** Maak van een merk/model een URL-segment. */
export function slug(waarde) {
  return String(waarde ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
