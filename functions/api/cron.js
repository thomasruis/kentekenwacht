/**
 * POST /api/cron   (Authorization: Bearer <CRON_SECRET>)
 *
 * De waarschuwingsmotor. Loopt alle bewaakte kentekens langs, vergelijkt de
 * huidige RDW-stand met de vorige momentopname en mailt wat er veranderd is.
 *
 * Waarom hier en niet in GitHub Actions: hier zit de D1-binding al, dus er hoeft
 * geen Cloudflare API-token rond te slingeren. GitHub Actions is alleen de klok.
 *
 * SUBVERZOEKBUDGET — hier hangt de portiegrootte van af.
 *
 * De gratis Cloudflare-laag telt twee aparte budgetten per aanroep:
 *   - 50 EXTERNE subverzoeken (fetch naar het internet)
 *   - 1000 subverzoeken naar Cloudflare-diensten (D1, KV, R2)
 *
 * D1 zit dus ruim, maar onze RDW-aanroepen niet. Eén kenteken kost extern:
 *   1 voertuig + 1 brandstof + 1 terugroepkoppeling        = 3 altijd
 *   + 1 terugroepomschrijving   (alleen bij een actie)
 *   + 1 geconstateerde gebreken = 1 altijd
 *   + 1 gebrekomschrijvingen    (alleen bij gebreken)
 *   -------------------------------------------------------
 *   4 typisch, 6 in het slechtste geval
 *
 * Daarbovenop kost elke verstuurde e-mail 1 extern verzoek, en in het
 * uiterste geval heeft elk kenteken een eigen abonnee. Het slechtste geval
 * per kenteken is dus 7.
 *
 *   6 kentekens x 7 = 42, plus wat marge = ruim binnen de 50.
 *   8 kentekens x 7 = 56 zou de limiet overschrijden.
 *
 * Vandaar zes. Op een betaald plan (10.000 externe subverzoeken) kan dit
 * flink omhoog; geef dan ?portie=20 mee vanuit de workflow.
 */

import { json, nu, verstuurMail } from '../_lib/helpers.js';
import { haalVoertuigRapport } from '../_lib/rdw.js';
import { maakSnapshot, bepaalSignalen } from '../_lib/signalen.js';

const PORTIE_STANDAARD = 6;

export async function onRequestPost(context) {
  const { request, env } = context;

  const aangeboden = (request.headers.get('authorization') ?? '').replace(
    /^Bearer\s+/i,
    ''
  );
  if (!env.CRON_SECRET || aangeboden !== env.CRON_SECRET) {
    return json({ fout: 'niet_toegestaan' }, 401);
  }

  const url = new URL(request.url);
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const portie = Math.min(
    20,
    Math.max(1, Number(url.searchParams.get('portie') ?? PORTIE_STANDAARD))
  );

  const start = Date.now();

  // Alleen kentekens van betalende abonnees, en niet vaker dan eens per 20 uur.
  const grens = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { results: rijen } = await env.DB.prepare(
    `SELECT k.id, k.kenteken, k.snapshot, k.abonnee_id,
            a.email, a.beheer_token, a.plan
       FROM kentekens k
       JOIN abonnees a ON a.id = k.abonnee_id
      WHERE a.status = 'actief'
        AND (k.laatste_check IS NULL OR k.laatste_check < ?)
      ORDER BY k.id
      LIMIT ? OFFSET ?`
  )
    .bind(grens, portie, offset)
    .all();

  if (!rijen?.length) {
    await logJob(env, 'cron', start, 0, 0, 0, 'niets te doen');
    return json({ verwerkt: 0, verzonden: 0, klaar: true });
  }

  let verzonden = 0;
  let fouten = 0;
  const perAbonnee = new Map();

  for (const rij of rijen) {
    try {
      const rapport = await haalVoertuigRapport(rij.kenteken, {
        appToken: env.RDW_APP_TOKEN,
        timeoutMs: 12000,
        pogingen: 2,
      });
      if (rapport?.fout) {
        await markeerGecontroleerd(env, rij.id, null);
        continue;
      }

      const vorige = veiligJson(rij.snapshot);
      const huidige = maakSnapshot(rapport);
      const signalen = bepaalSignalen(vorige, huidige, rapport);

      // Eerste controle: alleen de momentopname vastleggen, niet meteen
      // mailen over alles wat er toch al was.
      if (!vorige) {
        await markeerGecontroleerd(env, rij.id, huidige);
        continue;
      }

      const nieuw = [];
      for (const s of signalen) {
        const al = await env.DB.prepare(
          `SELECT 1 FROM meldingen
            WHERE abonnee_id=? AND kenteken=? AND soort=? AND sleutel=?`
        )
          .bind(rij.abonnee_id, rij.kenteken, s.soort, s.sleutel)
          .first();
        if (!al) nieuw.push(s);
      }

      if (nieuw.length) {
        if (!perAbonnee.has(rij.abonnee_id)) {
          perAbonnee.set(rij.abonnee_id, {
            email: rij.email,
            beheerToken: rij.beheer_token,
            items: [],
          });
        }
        perAbonnee
          .get(rij.abonnee_id)
          .items.push({ kenteken: rij.kenteken, rapport, signalen: nieuw });
      }

      await markeerGecontroleerd(env, rij.id, huidige);
    } catch (e) {
      fouten++;
      console.error('controle mislukt', rij.kenteken, e);
    }
  }

  // Eén mail per abonnee, ook als er meerdere kentekens iets melden.
  const basis = env.SITE_URL ?? new URL(request.url).origin;
  for (const [abonneeId, blok] of perAbonnee) {
    try {
      await verstuurMail(env, {
        aan: blok.email,
        onderwerp: onderwerpVoor(blok.items),
        tekst: mailTekst(blok.items, `${basis}/beheer/?t=${blok.beheerToken}`),
        html: mailHtml(blok.items, `${basis}/beheer/?t=${blok.beheerToken}`, basis),
      });
      verzonden++;

      const stmt = env.DB.prepare(
        `INSERT OR IGNORE INTO meldingen
           (abonnee_id, kenteken, soort, sleutel, verzonden_op)
         VALUES (?, ?, ?, ?, ?)`
      );
      const tijd = nu();
      const batch = [];
      for (const item of blok.items) {
        for (const s of item.signalen) {
          batch.push(stmt.bind(abonneeId, item.kenteken, s.soort, s.sleutel, tijd));
        }
      }
      if (batch.length) await env.DB.batch(batch);
    } catch (e) {
      fouten++;
      console.error('mail mislukt', blok.email, e);
    }
  }

  await logJob(env, 'cron', start, rijen.length, verzonden, fouten, null);

  return json({
    verwerkt: rijen.length,
    verzonden,
    fouten,
    klaar: rijen.length < portie,
    volgendeOffset: offset + rijen.length,
  });
}

/* ------------------------------------------------------------------ */

function veiligJson(waarde) {
  if (!waarde) return null;
  try {
    return JSON.parse(waarde);
  } catch {
    return null;
  }
}

async function markeerGecontroleerd(env, kentekenId, snapshot) {
  await env.DB.prepare(
    'UPDATE kentekens SET laatste_check=?, snapshot=COALESCE(?, snapshot) WHERE id=?'
  )
    .bind(nu(), snapshot ? JSON.stringify(snapshot) : null, kentekenId)
    .run();
}

async function logJob(env, job, start, gecontroleerd, verzonden, fouten, detail) {
  try {
    await env.DB.prepare(
      `INSERT INTO job_log (job, gestart_op, duur_ms, gecontroleerd, verzonden, fouten, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        job,
        new Date(start).toISOString(),
        Date.now() - start,
        gecontroleerd,
        verzonden,
        fouten,
        detail
      )
      .run();
  } catch (e) {
    console.error('joblog mislukt', e);
  }
}

/* ---------------- e-mailopmaak ---------------- */

function onderwerpVoor(items) {
  const alle = items.flatMap((i) => i.signalen);
  if (alle.some((s) => s.soort === 'recall')) {
    return `Terugroepactie op ${items[0].kenteken}`;
  }
  if (alle.some((s) => s.soort === 'apk_verlopen')) {
    return `APK verlopen: ${items[0].kenteken}`;
  }
  const apk = alle.find((s) => s.soort.startsWith('apk_'));
  if (apk) return `${apk.kop} — ${items[0].kenteken}`;
  return `Wijziging op ${items[0].kenteken}`;
}

function mailTekst(items, beheerUrl) {
  const regels = items.flatMap((i) => [
    '',
    `${i.kenteken} — ${[i.rapport.voertuig?.merk, i.rapport.voertuig?.handelsbenaming]
      .filter(Boolean)
      .join(' ')}`,
    ...i.signalen.flatMap((s) =>
      [
        `  * ${s.kop}`,
        `    ${s.tekst}`,
        s.extra ? `    ${s.extra}` : null,
        s.actie ? `    → ${s.actie}` : null,
      ].filter(Boolean)
    ),
  ]);
  return `Er is iets veranderd aan je bewaakte voertuig${items.length > 1 ? 'en' : ''}.
${regels.join('\n')}

Kentekens beheren of opzeggen: ${beheerUrl}

Kentekenwacht — gegevens uit RDW Open Data. Geen officiële RDW-dienst.`;
}

function mailHtml(items, beheerUrl, basis) {
  const kleur = { 3: '#c62828', 2: '#e39a1c', 1: '#14407a' };
  return `<!doctype html><html lang="nl"><body style="margin:0;background:#f7f8fa;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#10151c">
<div style="max-width:580px;margin:0 auto;padding:28px 20px">
${items
  .map(
    (i) => `<div style="background:#fff;border:1px solid #dde2e9;border-radius:12px;padding:22px;margin-bottom:16px">
  <p style="margin:0 0 14px">
    <span style="display:inline-block;background:#f5c518;border:2px solid #1a1a1a;border-radius:6px;padding:5px 11px;font:700 1rem ui-monospace,monospace;letter-spacing:.08em">${i.kenteken}</span>
    <span style="color:#5a6472;margin-left:8px">${[
      i.rapport.voertuig?.merk,
      i.rapport.voertuig?.handelsbenaming,
    ]
      .filter(Boolean)
      .join(' ')}</span>
  </p>
  ${i.signalen
    .map(
      (s) => `<div style="border-left:4px solid ${kleur[s.urgentie] ?? '#14407a'};padding:2px 0 2px 14px;margin-bottom:16px">
    <strong style="display:block;font-size:1.05rem;margin-bottom:4px">${s.kop}</strong>
    <p style="margin:0 0 6px;line-height:1.6">${escapeHtml(s.tekst)}</p>
    ${s.extra ? `<p style="margin:0 0 6px;line-height:1.6;color:#5a6472">${escapeHtml(s.extra)}</p>` : ''}
    ${s.actie ? `<p style="margin:0;font-weight:600">${escapeHtml(s.actie)}</p>` : ''}
  </div>`
    )
    .join('')}
  <p style="margin:0"><a href="${basis}/?kenteken=${i.kenteken}" style="color:#14407a">Volledig rapport bekijken →</a></p>
</div>`
  )
  .join('')}
  <p style="font-size:.85rem;color:#838d9b;line-height:1.6;text-align:center">
    <a href="${beheerUrl}" style="color:#5a6472">Kentekens beheren of opzeggen</a><br>
    Kentekenwacht gebruikt RDW Open Data en is geen officiële RDW-dienst.
  </p>
</div>
</body></html>`;
}

function escapeHtml(w) {
  return String(w ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
