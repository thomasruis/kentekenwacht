#!/usr/bin/env node
/**
 * Draait de echte build tegen een nagebootste RDW-API.
 *
 * Doel: controleren dat de generator klopt (en een voorbeeldsite opleveren)
 * in een omgeving zonder toegang tot opendata.rdw.nl.
 *
 *   node scripts/demo-build.mjs
 */

const MERKEN = [
  ['VOLKSWAGEN', 1042311], ['OPEL', 712004], ['PEUGEOT', 655120],
  ['RENAULT', 601998], ['FORD', 588740], ['TOYOTA', 540221],
  ['BMW', 402118], ['MERCEDES-BENZ', 388904], ['AUDI', 371550],
  ['KIA', 305882], ['CITROEN', 291447], ['HYUNDAI', 288013],
  ['SKODA', 244190], ['NISSAN', 231770], ['SEAT', 198432],
  ['FIAT', 176309], ['MAZDA', 152884], ['VOLVO', 148201],
  ['SUZUKI', 139006], ['MINI', 98440],
];

const MODELLEN = {
  VOLKSWAGEN: ['GOLF', 'POLO', 'PASSAT', 'UP!', 'TIGUAN', 'TOURAN', 'CADDY'],
  KIA: ['PICANTO', 'RIO', 'CEED', 'SPORTAGE', 'NIRO', 'SORENTO'],
  STANDAARD: ['CORSA', 'ASTRA', 'MERIVA', 'ZAFIRA', 'INSIGNIA'],
};

const KLEUREN = ['GRIJS', 'ZWART', 'WIT', 'BLAUW', 'ROOD', 'GROEN'];

const RECALLS = Array.from({ length: 40 }, (_, i) => ({
  referentiecode_rdw: `MGP${String(100000 + i)}`,
  publicatiedatum_rdw: `2026${String(((i % 9) + 1)).padStart(2, '0')}${String((i % 28) + 1).padStart(2, '0')}`,
  meldende_producent_distributeur: ['Pon Import B.V.', 'Louwman & Parqui', 'Kia Nederland', 'Stellantis Nederland'][i % 4],
  omschrijving_defect: [
    'De remleiding kan door corrosie gaan lekken.',
    'De bevestiging van de achterste veiligheidsgordel kan losraken.',
    'De software van de motorregeling kan onbedoeld vermogen wegnemen.',
    'De airbaggasgenerator kan bij activering barsten.',
  ][i % 4],
  categorie_defect: [
    'Motorrijtuigen en aanhangwagens - reminrichting',
    'Motorrijtuigen - carrosserie (beschermingsmiddelen inzittenden)',
    'Motorrijtuigen en aanhangwagens - stuurinrichting',
    'Motorrijtuigen - elektrische installatie',
  ][i % 4],
  materi_le_gevolgen: 'Hierdoor kan een gevaarlijke situatie ontstaan.',
  beschrijving_van_het_herstel: 'De producent verhelpt het defect kosteloos bij de dealer.',
  risicobeoordeling_rdw: ['ERN', 'GEM', 'GER'][i % 3],
  nationaal_opgegeven_aantal_voertuigen_terugroepactie: String(500 + i * 137),
  meer_informatie_via_telefoonnummer: '0800-1234567',
}));

const VANDAAG = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
})();

let verzoeken = 0;

globalThis.fetch = async (url) => {
  verzoeken++;
  const u = new URL(String(url));
  const dataset = u.pathname.split('/').pop().replace('.json', '');
  const select = u.searchParams.get('$select') ?? '';
  const where = u.searchParams.get('$where') ?? '';
  const group = u.searchParams.get('$group') ?? '';
  const limit = Number(u.searchParams.get('$limit') ?? 1000);

  const antwoord = (rijen) => ({
    ok: true,
    status: 200,
    json: async () => rijen.slice(0, limit),
    text: async () => JSON.stringify(rijen.slice(0, limit)),
  });

  const merkUitWhere = () => (where.match(/merk='([^']+)'/) ?? [])[1];

  if (dataset === 'm9d7-ebf2') {
    if (group === 'merk') {
      return antwoord(MERKEN.map(([merk, aantal]) => ({ merk, aantal: String(aantal) })));
    }
    if (group === 'handelsbenaming') {
      const merk = merkUitWhere();
      const totaal = (MERKEN.find(([m]) => m === merk) ?? [null, 100000])[1];
      const lijst = MODELLEN[merk] ?? MODELLEN.STANDAARD;
      const verlopenQuery = where.includes('vervaldatum_apk <');
      return antwoord(
        lijst.map((model, i) => {
          const aantal = Math.round(totaal / (lijst.length + i));
          return verlopenQuery
            ? { handelsbenaming: model, verlopen: String(Math.round(aantal * 0.037)) }
            : {
                handelsbenaming: model,
                aantal: String(aantal),
                gem_prijs: String(18000 + i * 4200),
                gem_massa: String(1100 + i * 90),
              };
        })
      );
    }
    if (group === 'eerste_kleur') {
      const merk = merkUitWhere();
      const totaal = (MERKEN.find(([m]) => m === merk) ?? [null, 100000])[1];
      return antwoord(
        KLEUREN.map((kleur, i) => ({
          eerste_kleur: kleur,
          aantal: String(Math.round(totaal / (3 + i * 1.7))),
        }))
      );
    }
    if (select.includes('count(1)')) {
      return antwoord([{ aantal: '9214788' }]);
    }
    return antwoord([]);
  }

  if (dataset === 'j9yg-7rg9') {
    const inMatch = where.match(/referentiecode_rdw in\((.*)\)/);
    if (inMatch) {
      const set = new Set(inMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')));
      return antwoord(RECALLS.filter((r) => set.has(r.referentiecode_rdw)));
    }
    return antwoord([...RECALLS].sort((a, b) => b.publicatiedatum_rdw.localeCompare(a.publicatiedatum_rdw)));
  }

  if (dataset === 'bcmj-kjae') {
    const ref = u.searchParams.get('referentiecode_rdw');
    if (ref) {
      const i = RECALLS.findIndex((r) => r.referentiecode_rdw === ref);
      return antwoord([{ kenteken: `DEMO${String(i).padStart(2, '0')}`, referentiecode_rdw: ref, code_status: 'P' }]);
    }
    return antwoord([]);
  }

  return antwoord([]);
};

// Het merk achter een demo-kenteken: bepaalt de koppeling recall -> merk.
const echteFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.pathname.includes('m9d7-ebf2') && u.searchParams.get('kenteken')?.startsWith('DEMO')) {
    const i = Number(u.searchParams.get('kenteken').slice(4));
    const merk = MERKEN[i % MERKEN.length][0];
    return { ok: true, status: 200, json: async () => [{ merk }], text: async () => '[]' };
  }
  return echteFetch(url);
};

process.env.KW_MAX_MERKEN = process.env.KW_MAX_MERKEN ?? '20';
process.env.SITE_URL = process.env.SITE_URL ?? 'https://kentekenwacht.pages.dev';
// Nooit naar public/ schrijven: die map gaat live en mag geen verzonnen
// cijfers bevatten.
process.env.KW_UIT = 'public-demo';
process.env.KW_DATA = 'data-demo';

// Statische bestanden (css, js, beheer, gelukt) meekopiëren, anders mist de
// demo-map de bezoekerskant.
const { cp, mkdir } = await import('node:fs/promises');
const { join: pad, dirname: mapVan } = await import('node:path');
const { fileURLToPath: naarPad } = await import('node:url');
const WORTEL = pad(mapVan(naarPad(import.meta.url)), '..');
await mkdir(pad(WORTEL, 'public-demo'), { recursive: true });
for (const item of ['assets', 'beheer', 'gelukt', '_headers']) {
  await cp(pad(WORTEL, 'public', item), pad(WORTEL, 'public-demo', item), {
    recursive: true,
  }).catch(() => {});
}

await import('./build.mjs');
console.log(`[demo] ${verzoeken} nagebootste verzoeken`);
