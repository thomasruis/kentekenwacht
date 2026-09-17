/**
 * POST /api/checkout
 * body: { email, kentekens: ["12ABC3"], plan: "particulier" | "zakelijk" }
 *
 * Maakt een Stripe Checkout Session en geeft de betaal-URL terug.
 * iDEAL staat aan: zonder iDEAL laat je in Nederland de helft van de conversie liggen.
 *
 * We slaan hier nog niets op. Pas als Stripe bevestigt dat er betaald is
 * (webhook) maken we het abonnement aan. Anders vult de database zich met
 * afgebroken pogingen.
 */

import { json, fout, geldigEmail, stripe } from '../_lib/helpers.js';
import { normaliseerKenteken } from '../_lib/rdw.js';

const PLANNEN = {
  particulier: { maxKentekens: 3, prijsEnvSleutel: 'STRIPE_PRICE_PARTICULIER' },
  zakelijk: { maxKentekens: 50, prijsEnvSleutel: 'STRIPE_PRICE_ZAKELIJK' },
};

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return fout('ongeldige_body', 'Kon het verzoek niet lezen.');
  }

  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!geldigEmail(email)) {
    return fout('ongeldig_email', 'Vul een geldig e-mailadres in.');
  }

  const planNaam = body?.plan === 'zakelijk' ? 'zakelijk' : 'particulier';
  const plan = PLANNEN[planNaam];

  const prijsId = env[plan.prijsEnvSleutel];
  if (!prijsId) {
    return fout(
      'niet_geconfigureerd',
      'De betaalomgeving is nog niet ingesteld. Probeer het later opnieuw.',
      503
    );
  }

  const kentekens = [
    ...new Set(
      (Array.isArray(body?.kentekens) ? body.kentekens : [])
        .map(normaliseerKenteken)
        .filter(Boolean)
    ),
  ].slice(0, plan.maxKentekens);

  if (!kentekens.length) {
    return fout('geen_kentekens', 'Geef minstens één geldig kenteken op.');
  }

  const oorsprong = new URL(request.url).origin;

  try {
    const sessie = await stripe(env, 'checkout/sessions', 'POST', {
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: prijsId, quantity: 1 }],
      payment_method_types: ['card', 'ideal'],
      allow_promotion_codes: true,
      locale: 'nl',
      success_url: `${oorsprong}/gelukt/?sessie={CHECKOUT_SESSION_ID}`,
      cancel_url: `${oorsprong}/wacht/?geannuleerd=1`,
      // Metadata reist mee naar de webhook: daar maken we het abonnement aan.
      subscription_data: {
        metadata: { kentekens: kentekens.join(','), plan: planNaam, email },
      },
      metadata: { kentekens: kentekens.join(','), plan: planNaam, email },
      // Verplicht voor NL: btw laten berekenen en de voorwaarden laten accepteren.
      consent_collection: { terms_of_service: 'required' },
      custom_text: {
        terms_of_service_acceptance: {
          message: `Ik ga akkoord met de [algemene voorwaarden](${oorsprong}/voorwaarden/) en de [privacyverklaring](${oorsprong}/privacy/).`,
        },
      },
    });

    return json({ url: sessie.url, id: sessie.id });
  } catch (e) {
    console.error('checkout mislukt', e);
    return fout(
      'stripe_fout',
      'Het starten van de betaling lukte niet. Probeer het opnieuw.',
      502
    );
  }
}
