/**
 * Nagebootste RDW-API met echte responsvormen.
 *
 * Gedeeld door de lokale zelftest en de end-to-end test, zodat er maar één
 * plek is waar de vorm van de RDW-antwoorden wordt vastgelegd.
 */

export const VOORRAAD = {
  'm9d7-ebf2': [
    {
      kenteken: '89KKZ2',
      voertuigsoort: 'Personenauto',
      merk: 'KIA',
      handelsbenaming: 'SORENTO',
      eerste_kleur: 'GRIJS',
      inrichting: 'stationwagen',
      datum_eerste_toelating: '20100615',
      datum_tenaamstelling: '20180301',
      vervaldatum_apk: '20270105',
      cilinderinhoud: '2359',
      massa_ledig_voertuig: '1790',
      massa_rijklaar: '1890',
      aantal_zitplaatsen: '5',
      aantal_deuren: '5',
      aantal_wielen: '4',
      catalogusprijs: '43995',
      wam_verzekerd: 'Ja',
      export_indicator: 'Nee',
      europese_voertuigcategorie: 'M1',
      tellerstandoordeel: 'Logisch',
      wacht_op_keuren: 'Nee',
    },
  ],
  '8ys7-d773': [
    {
      kenteken: '89KKZ2',
      brandstof_volgnummer: '1',
      brandstof_omschrijving: 'Benzine',
      emissiecode_omschrijving: '5',
      nettomaximumvermogen: '128',
    },
  ],
  'bcmj-kjae': [
    {
      kenteken: '89KKZ2',
      referentiecode_rdw: 'MGP070060',
      code_status: 'P',
      status: 'Producent heeft herstel gemeld',
    },
    {
      kenteken: '89KKZ2',
      referentiecode_rdw: 'MGP080098',
      code_status: 'H',
      status: 'Hersteld',
    },
  ],
  'j9yg-7rg9': [
    {
      referentiecode_rdw: 'MGP070060',
      publicatiedatum_rdw: '20130328',
      meldende_producent_distributeur: 'Louwman Parts & Service B.V.',
      omschrijving_defect:
        'De bouten van de stuurkoppeling op de stuuras zijn mogelijk niet goed vastgedraaid.',
      categorie_defect: 'Motorrijtuigen en aanhangwagens - stuurinrichting',
      materi_le_gevolgen: 'De verbinding van de stuurkoppeling kan los gaan zitten.',
      beschrijving_van_het_herstel: 'De producent verhelpt het defect kosteloos.',
      meer_informatie_op_internet: '(Nog) niet bekend',
      meer_informatie_via_telefoonnummer: '0162-585217',
      risicobeoordeling_rdw: 'ERN',
      nationaal_opgegeven_aantal_voertuigen_terugroepactie: '1323',
    },
    {
      referentiecode_rdw: 'MGP080098',
      publicatiedatum_rdw: '20130618',
      meldende_producent_distributeur: 'B.V. Nimag',
      omschrijving_defect: 'Stekkerverbinding zij-airbag kan klem raken.',
      categorie_defect: 'Motorrijtuigen - carrosserie',
      materi_le_gevolgen: 'De zij-airbag werkt mogelijk niet.',
      risicobeoordeling_rdw: 'GEM',
      meer_informatie_op_internet: 'www.suzuki.nl/service/terugroepacties',
      nationaal_opgegeven_aantal_voertuigen_terugroepactie: '6554',
    },
  ],
  'a34c-vvps': [
    {
      kenteken: '89KKZ2',
      gebrek_identificatie: 'AC4',
      meld_datum_door_keuringsinstantie: '20250110',
      aantal_gebreken_geconstateerd: '1',
    },
    {
      kenteken: '89KKZ2',
      gebrek_identificatie: '475',
      meld_datum_door_keuringsinstantie: '20250110',
      aantal_gebreken_geconstateerd: '2',
    },
    {
      kenteken: '89KKZ2',
      gebrek_identificatie: '005',
      meld_datum_door_keuringsinstantie: '20230108',
      aantal_gebreken_geconstateerd: '1',
    },
  ],
  'hx2c-gt7k': [
    {
      gebrek_identificatie: 'AC4',
      gebrek_omschrijving: 'Bandenprofiel te gering',
      ingangsdatum_gebrek: '20200401',
    },
    {
      gebrek_identificatie: 'AC4',
      gebrek_omschrijving: 'OUDE OMSCHRIJVING',
      ingangsdatum_gebrek: '20100401',
    },
    {
      gebrek_identificatie: '475',
      gebrek_omschrijving: 'Remschijf te sterk gesleten',
      ingangsdatum_gebrek: '20170401',
    },
  ],
};

export let verzoeken = 0;

export function installeerMock() {
  globalThis.fetch = mockFetch;
}

export const mockFetch = async (url) => {
  verzoeken++;
  const u = new URL(String(url));
  const dataset = u.pathname.split('/').pop().replace('.json', '');
  let rijen = VOORRAAD[dataset] ?? [];

  // Eenvoudige nabootsing van kolomfilters en $where ... in(...).
  for (const [sleutel, waarde] of u.searchParams) {
    if (sleutel.startsWith('$')) continue;
    rijen = rijen.filter((r) => String(r[sleutel] ?? '') === waarde);
  }
  const where = u.searchParams.get('$where');
  if (where) {
    const m = where.match(/^(\w+) in\((.*)\)$/);
    if (m) {
      const set = new Set(m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')));
      rijen = rijen.filter((r) => set.has(r[m[1]]));
    }
  }
  const order = u.searchParams.get('$order');
  if (order) {
    const [veld, richting] = order.split(/\s+/);
    rijen = [...rijen].sort((a, b) =>
      String(a[veld] ?? '').localeCompare(String(b[veld] ?? ''))
    );
    if ((richting ?? '').toUpperCase() === 'DESC') rijen.reverse();
  }
  const limit = Number(u.searchParams.get('$limit') ?? 1000);

  return {
    ok: true,
    status: 200,
    json: async () => rijen.slice(0, limit),
    text: async () => JSON.stringify(rijen.slice(0, limit)),
  };
};

