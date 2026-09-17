/**
 * POST /api/stripe-webhook
 *
 * Het enige punt waar abonnementen ontstaan. Stripe is de bron van waarheid over
 * betalingen; deze handler spiegelt dat naar D1.
 *
 * Zet in Stripe deze events aan:
 *   checkout.session.completed
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_failed
 */

import {
  json,
  id,
  nu,
  verifieerStripeHandtekening,
  verstuurMail,
} from '../_lib/helpers.js';
import { normaliseerKenteken } from '../_lib/rdw.js';

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  const ruw = await request.text();
  const geldig = await verifieerStripeHandtekening(
    ruw,
    request.headers.get('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET
  );
  if (!geldig) {
    return json({ fout: 'ongeldige_handtekening' }, 400);
  }

  let gebeurtenis;
  try {
    gebeurtenis = JSON.parse(ruw);
  } catch {
    return json({ fout: 'ongeldige_json' }, 400);
  }

  try {
    switch (gebeurtenis.type) {
      case 'checkout.session.completed':
        await bijCheckoutVoltooid(env, gebeurtenis.data.object, waitUntil);
        break;
      case 'customer.subscription.updated':
        await bijAbonnementGewijzigd(env, gebeurtenis.data.object);
        break;
      case 'customer.subscription.deleted':
        await zetStatus(env, gebeurtenis.data.object.id, 'opgezegd');
        break;
      case 'invoice.payment_failed':
        if (gebeurtenis.data.object.subscription) {
          await zetStatus(env, gebeurtenis.data.object.subscription, 'betaling_mislukt');
        }
        break;
      default:
        break; // Overige events negeren we bewust.
    }
  } catch (e) {
    console.error('webhook-verwerking mislukt', gebeurtenis.type, e);
    // 500 zodat Stripe het opnieuw aanbiedt.
    return json({ fout: 'verwerking_mislukt' }, 500);
  }

  return json({ ontvangen: true });
}

/* ------------------------------------------------------------------ */

async function bijCheckoutVoltooid(env, sessie, waitUntil) {
  const email = (sessie.customer_details?.email ?? sessie.metadata?.email ?? '')
    .trim()
    .toLowerCase();
  if (!email) throw new Error('checkout zonder e-mailadres');

  const plan = sessie.metadata?.plan === 'zakelijk' ? 'zakelijk' : 'particulier';
  const maxKentekens = plan === 'zakelijk' ? 50 : 3;
  const kentekens = String(sessie.metadata?.kentekens ?? '')
    .split(',')
    .map(normaliseerKenteken)
    .filter(Boolean)
    .slice(0, maxKentekens);

  const tijd = nu();
  const bestaand = await env.DB.prepare('SELECT id, beheer_token FROM abonnees WHERE email = ?')
    .bind(email)
    .first();

  let abonneeId;
  let beheerToken;

  if (bestaand) {
    abonneeId = bestaand.id;
    beheerToken = bestaand.beheer_token;
    await env.DB.prepare(
      `UPDATE abonnees SET plan=?, status='actief', max_kentekens=?,
        stripe_customer_id=?, stripe_subscription_id=?, bijgewerkt_op=?
       WHERE id=?`
    )
      .bind(plan, maxKentekens, sessie.customer, sessie.subscription, tijd, abonneeId)
      .run();
  } else {
    abonneeId = id(20);
    beheerToken = id(32);
    await env.DB.prepare(
      `INSERT INTO abonnees
        (id, email, plan, status, max_kentekens, stripe_customer_id,
         stripe_subscription_id, beheer_token, aangemaakt_op, bijgewerkt_op)
       VALUES (?, ?, ?, 'actief', ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        abonneeId,
        email,
        plan,
        maxKentekens,
        sessie.customer,
        sessie.subscription,
        beheerToken,
        tijd,
        tijd
      )
      .run();
  }

  if (kentekens.length) {
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO kentekens (abonnee_id, kenteken, toegevoegd_op)
       VALUES (?, ?, ?)`
    );
    await env.DB.batch(kentekens.map((k) => stmt.bind(abonneeId, k, tijd)));
  }

  const basis = env.SITE_URL ?? 'https://kentekenwacht.pages.dev';
  const beheerUrl = `${basis}/beheer/?t=${beheerToken}`;

  // De welkomstmail mag de webhook niet ophouden; Stripe wil binnen enkele
  // seconden een 200.
  waitUntil(
    verstuurMail(env, {
      aan: email,
      onderwerp: 'Je kentekens staan onder bewaking',
      tekst: welkomTekst(kentekens, beheerUrl),
      html: welkomHtml(kentekens, beheerUrl),
    }).catch((e) => console.error('welkomstmail mislukt', e))
  );
}

async function bijAbonnementGewijzigd(env, abo) {
  const status =
    abo.status === 'active' || abo.status === 'trialing'
      ? 'actief'
      : abo.status === 'past_due' || abo.status === 'unpaid'
        ? 'betaling_mislukt'
        : 'opgezegd';

  await env.DB.prepare(
    `UPDATE abonnees SET status=?, periode_eindigt_op=?, bijgewerkt_op=?
     WHERE stripe_subscription_id=?`
  )
    .bind(
      status,
      abo.current_period_end
        ? new Date(abo.current_period_end * 1000).toISOString()
        : null,
      nu(),
      abo.id
    )
    .run();
}

async function zetStatus(env, subscriptionId, status) {
  await env.DB.prepare(
    'UPDATE abonnees SET status=?, bijgewerkt_op=? WHERE stripe_subscription_id=?'
  )
    .bind(status, nu(), subscriptionId)
    .run();
}

/* ------------------------------------------------------------------ */

function welkomTekst(kentekens, beheerUrl) {
  return `Je bewaking staat aan.

Vanaf morgenochtend controleren we elke dag het RDW-register op deze kentekens:
${kentekens.map((k) => `  - ${k}`).join('\n')}

Je krijgt bericht bij:
  - een nieuwe terugroepactie op je voertuig
  - een APK die over 60, 30 of 7 dagen verloopt
  - een gewijzigde verzekerings- of tellerstandstatus
  - gebreken die bij een keuring zijn gevonden

Kentekens toevoegen, wijzigen of opzeggen:
${beheerUrl}

Bewaar deze link. Hij is persoonlijk en geeft toegang tot je abonnement.

Kentekenwacht — gegevens uit RDW Open Data. Geen officiële RDW-dienst.`;
}

function welkomHtml(kentekens, beheerUrl) {
  return `<!doctype html><html lang="nl"><body style="margin:0;background:#f7f8fa;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#10151c">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
  <div style="background:#fff;border:1px solid #dde2e9;border-radius:12px;padding:26px">
    <h1 style="margin:0 0 14px;font-size:1.35rem">Je bewaking staat aan</h1>
    <p style="margin:0 0 16px;line-height:1.6">Vanaf morgenochtend controleren we elke dag
      het RDW-register op deze kentekens:</p>
    <p style="margin:0 0 20px">
      ${kentekens
        .map(
          (k) =>
            `<span style="display:inline-block;background:#f5c518;border:2px solid #1a1a1a;border-radius:6px;padding:6px 12px;font:700 1.05rem ui-monospace,monospace;letter-spacing:.08em;margin:0 6px 6px 0">${k}</span>`
        )
        .join('')}
    </p>
    <p style="margin:0 0 10px;line-height:1.6">Je krijgt bericht bij:</p>
    <ul style="margin:0 0 20px;padding-left:20px;line-height:1.7">
      <li>een nieuwe terugroepactie op je voertuig</li>
      <li>een APK die over 60, 30 of 7 dagen verloopt</li>
      <li>een gewijzigde verzekerings- of tellerstandstatus</li>
      <li>gebreken die bij een keuring zijn gevonden</li>
    </ul>
    <p style="margin:0 0 20px">
      <a href="${beheerUrl}" style="display:inline-block;background:#14407a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:600">Kentekens beheren</a>
    </p>
    <p style="margin:0;font-size:.85rem;color:#838d9b;line-height:1.6">
      Bewaar deze link — hij is persoonlijk en geeft toegang tot je abonnement.<br>
      Kentekenwacht gebruikt RDW Open Data en is geen officiële RDW-dienst.
    </p>
  </div>
</div>
</body></html>`;
}
