#!/usr/bin/env node
/**
 * Beveiligingstests. Zonder een kloppende handtekeningcontrole kan iedereen
 * die de webhook-URL kent gratis abonnementen aanmaken, dus dit is de
 * belangrijkste test in het project.
 *
 *   node scripts/beveiliging-test.mjs
 */

import {
  verifieerStripeHandtekening,
  id,
  geldigEmail,
} from '../functions/_lib/helpers.js';

let ok = 0;
let mis = 0;
const check = (naam, voorwaarde) => {
  if (voorwaarde) {
    ok++;
    console.log(`  ✓ ${naam}`);
  } else {
    mis++;
    console.log(`  ✗ ${naam}`);
  }
};

/** Onderteken zoals Stripe dat doet. */
async function onderteken(body, geheim, tijd) {
  const sleutel = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(geheim),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    sleutel,
    new TextEncoder().encode(`${tijd}.${body}`)
  );
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

console.log('\nBeveiliging\n');
console.log('Stripe-webhookhandtekening');

const geheim = 'whsec_testgeheim123';
const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
const t = Math.floor(Date.now() / 1000);
const hex = await onderteken(body, geheim, t);
const nep = 'a'.repeat(64);

check(
  'geldige handtekening geaccepteerd',
  (await verifieerStripeHandtekening(body, `t=${t},v1=${hex}`, geheim)) === true
);
check(
  'verkeerde handtekening geweigerd',
  (await verifieerStripeHandtekening(body, `t=${t},v1=${nep}`, geheim)) === false
);
check(
  'gewijzigde body geweigerd',
  (await verifieerStripeHandtekening(`${body}x`, `t=${t},v1=${hex}`, geheim)) === false
);
check(
  'verkeerd geheim geweigerd',
  (await verifieerStripeHandtekening(body, `t=${t},v1=${hex}`, 'ander')) === false
);
check(
  'oude tijdstempel geweigerd (replay-aanval)',
  (await verifieerStripeHandtekening(body, `t=${t - 9999},v1=${hex}`, geheim)) === false
);
check(
  'toekomstige tijdstempel geweigerd',
  (await verifieerStripeHandtekening(body, `t=${t + 9999},v1=${hex}`, geheim)) === false
);
check(
  'ontbrekende kop geweigerd',
  (await verifieerStripeHandtekening(body, null, geheim)) === false
);
check(
  'ontbrekend geheim geweigerd',
  (await verifieerStripeHandtekening(body, `t=${t},v1=${hex}`, null)) === false
);
check(
  'kop zonder v1 geweigerd',
  (await verifieerStripeHandtekening(body, `t=${t}`, geheim)) === false
);
check(
  'meerdere handtekeningen: één juiste volstaat',
  (await verifieerStripeHandtekening(body, `t=${t},v1=${nep},v1=${hex}`, geheim)) === true
);

console.log('\nTokens');
const ids = new Set(Array.from({ length: 5000 }, () => id(24)));
check('5000 tokens zijn allemaal uniek', ids.size === 5000);
check('token heeft de gevraagde lengte', id(32).length === 32);
check('token is URL-veilig', /^[a-z0-9]+$/.test(id(40)));

console.log('\nE-mailvalidatie');
check('gewoon adres', geldigEmail('thomas@voorbeeld.nl'));
check('plusadres', geldigEmail('thomas+auto@voorbeeld.nl'));
check('zonder apenstaartje geweigerd', !geldigEmail('thomas.nl'));
check('zonder topniveaudomein geweigerd', !geldigEmail('a@b'));
check('leeg geweigerd', !geldigEmail(''));
check('niet-tekst geweigerd', !geldigEmail(null));
check('extreem lang geweigerd', !geldigEmail(`${'a'.repeat(300)}@b.nl`));

console.log(`\n${ok} geslaagd, ${mis} mislukt\n`);
process.exit(mis ? 1 : 0);
