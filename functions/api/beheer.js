/**
 * /api/beheer — zelfbediening voor abonnees.
 *
 * Toegang via het persoonlijke token uit de e-mail. Geen wachtwoorden, geen
 * inlogscherm: dat scheelt de klant gedoe en ons een hoop code en risico.
 * Het token is 32 tekens uit crypto.getRandomValues en staat alleen in e-mail.
 *
 * GET  /api/beheer?t=TOKEN
 * POST /api/beheer   { t, actie: "toevoegen"|"verwijderen"|"portaal", kenteken? }
 */

import { json, fout, nu, stripe } from '../_lib/helpers.js';
import { normaliseerKenteken } from '../_lib/rdw.js';

async function zoekAbonnee(env, token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  return env.DB.prepare(
    `SELECT id, email, plan, status, max_kentekens, stripe_customer_id,
            periode_eindigt_op
       FROM abonnees WHERE beheer_token = ?`
  )
    .bind(token)
    .first();
}

async function kentekensVan(env, abonneeId) {
  const { results } = await env.DB.prepare(
    `SELECT kenteken, label, toegevoegd_op, laatste_check
       FROM kentekens WHERE abonnee_id = ? ORDER BY id`
  )
    .bind(abonneeId)
    .all();
  return results ?? [];
}

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('t');
  const abonnee = await zoekAbonnee(env, token);
  if (!abonnee) return fout('onbekend_token', 'Deze beheerlink is niet geldig.', 404);

  return json({
    email: abonnee.email,
    plan: abonnee.plan,
    status: abonnee.status,
    maxKentekens: abonnee.max_kentekens,
    periodeEindigtOp: abonnee.periode_eindigt_op,
    kentekens: await kentekensVan(env, abonnee.id),
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fout('ongeldige_body', 'Kon het verzoek niet lezen.');
  }

  const abonnee = await zoekAbonnee(env, body?.t);
  if (!abonnee) return fout('onbekend_token', 'Deze beheerlink is niet geldig.', 404);

  /* --- Stripe-klantportaal: opzeggen, betaalmethode, facturen --- */
  if (body.actie === 'portaal') {
    if (!abonnee.stripe_customer_id) {
      return fout('geen_klant', 'Er is geen betaalprofiel aan dit account gekoppeld.');
    }
    try {
      const sessie = await stripe(env, 'billing_portal/sessions', 'POST', {
        customer: abonnee.stripe_customer_id,
        return_url: `${env.SITE_URL ?? new URL(request.url).origin}/beheer/?t=${body.t}`,
        locale: 'nl',
      });
      return json({ url: sessie.url });
    } catch (e) {
      console.error('portaal mislukt', e);
      return fout('stripe_fout', 'Het klantportaal is nu niet bereikbaar.', 502);
    }
  }

  /* --- Kenteken toevoegen --- */
  if (body.actie === 'toevoegen') {
    if (abonnee.status !== 'actief') {
      return fout('niet_actief', 'Je abonnement is niet actief.', 403);
    }
    const kenteken = normaliseerKenteken(body.kenteken);
    if (!kenteken) return fout('ongeldig_kenteken', 'Dat is geen geldig kenteken.');

    const huidig = await kentekensVan(env, abonnee.id);
    if (huidig.some((k) => k.kenteken === kenteken)) {
      return fout('bestaat_al', 'Dit kenteken staat al onder bewaking.');
    }
    if (huidig.length >= abonnee.max_kentekens) {
      return fout(
        'limiet_bereikt',
        `Je pakket staat ${abonnee.max_kentekens} kentekens toe.`,
        403
      );
    }

    await env.DB.prepare(
      'INSERT INTO kentekens (abonnee_id, kenteken, toegevoegd_op) VALUES (?, ?, ?)'
    )
      .bind(abonnee.id, kenteken, nu())
      .run();

    return json({ ok: true, kentekens: await kentekensVan(env, abonnee.id) });
  }

  /* --- Kenteken verwijderen --- */
  if (body.actie === 'verwijderen') {
    const kenteken = normaliseerKenteken(body.kenteken);
    if (!kenteken) return fout('ongeldig_kenteken', 'Dat is geen geldig kenteken.');

    await env.DB.batch([
      env.DB.prepare('DELETE FROM kentekens WHERE abonnee_id = ? AND kenteken = ?').bind(
        abonnee.id,
        kenteken
      ),
      env.DB.prepare('DELETE FROM meldingen WHERE abonnee_id = ? AND kenteken = ?').bind(
        abonnee.id,
        kenteken
      ),
    ]);

    return json({ ok: true, kentekens: await kentekensVan(env, abonnee.id) });
  }

  return fout('onbekende_actie', 'Die actie kennen we niet.');
}
