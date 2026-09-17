/**
 * GET /api/lookup?kenteken=XX-999-X
 *
 * Publiek en gratis. Dit is de magneet: het levert een compleet voertuigrapport
 * uit RDW open data, inclusief openstaande terugroepacties — precies wat de
 * meeste kentekencheck-sites niet laten zien.
 *
 * Caching gebeurt op de edge (Cloudflare Cache API), zodat een populair kenteken
 * de RDW-API niet onnodig belast. RDW-data verandert hooguit dagelijks.
 */

import { haalVoertuigRapport, normaliseerKenteken } from '../_lib/rdw.js';

const CACHE_SECONDEN = 6 * 60 * 60; // 6 uur

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const ruw = url.searchParams.get('kenteken') ?? '';
  const kenteken = normaliseerKenteken(ruw);

  if (!kenteken) {
    return json(
      {
        fout: 'ongeldig_kenteken',
        bericht:
          'Geef een geldig Nederlands kenteken op, bijvoorbeeld 12-ABC-3 of 12ABC3.',
      },
      400
    );
  }

  // Edge-cache op genormaliseerd kenteken, niet op de ruwe invoer.
  const cacheSleutel = new Request(
    `https://kentekenwacht.invalid/lookup/${kenteken}`,
    { method: 'GET' }
  );
  const cache = caches.default;

  const gecacht = await cache.match(cacheSleutel);
  if (gecacht) {
    const kopie = new Response(gecacht.body, gecacht);
    kopie.headers.set('X-Kw-Cache', 'HIT');
    return kopie;
  }

  let rapport;
  try {
    rapport = await haalVoertuigRapport(kenteken, {
      appToken: env?.RDW_APP_TOKEN, // optioneel; verhoogt de RDW-limiet
      timeoutMs: 15000,
    });
  } catch (fout) {
    return json(
      {
        fout: 'bron_onbereikbaar',
        bericht:
          'De RDW-gegevensbron reageert nu niet. Probeer het over een minuut opnieuw.',
        detail: String(fout?.message ?? fout).slice(0, 200),
      },
      503
    );
  }

  if (rapport?.fout === 'niet_gevonden') {
    return json(
      {
        fout: 'niet_gevonden',
        kenteken,
        bericht:
          'Dit kenteken staat niet in het RDW-register. Controleer of je het goed hebt overgenomen.',
      },
      404
    );
  }

  const antwoord = json(rapport, 200, {
    'Cache-Control': `public, max-age=1800, s-maxage=${CACHE_SECONDEN}`,
    'X-Kw-Cache': 'MISS',
  });

  waitUntil(cache.put(cacheSleutel, antwoord.clone()));
  return antwoord;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-Robots-Tag': 'noindex',
      ...extraHeaders,
    },
  });
}
