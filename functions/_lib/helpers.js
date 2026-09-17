/** Gedeelde hulpfuncties voor de Pages Functions. */

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

export function fout(code, bericht, status = 400) {
  return json({ fout: code, bericht }, status);
}

/** Willekeurige, URL-veilige identifier. */
export function id(lengte = 24) {
  const bytes = new Uint8Array(lengte);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((b) => 'abcdefghijkmnopqrstuvwxyz23456789'[b % 33])
    .join('');
}

export function nu() {
  return new Date().toISOString();
}

/** Zeer basale e-mailvalidatie; Stripe doet de echte verificatie. */
export function geldigEmail(waarde) {
  return (
    typeof waarde === 'string' &&
    waarde.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(waarde.trim())
  );
}

/* ---------------- Stripe ---------------- */

/**
 * Minimale Stripe-client. De officiële SDK is zwaar voor een Worker en we
 * gebruiken maar vier endpoints, dus we praten rechtstreeks met de REST-API.
 */
export async function stripe(env, pad, methode = 'GET', body = null) {
  const opties = {
    method: methode,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': '2024-06-20',
    },
  };
  if (body) {
    opties.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opties.body = naarFormulier(body);
  }
  const res = await fetch(`https://api.stripe.com/v1/${pad}`, opties);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Stripe ${res.status}: ${data?.error?.message ?? 'onbekende fout'}`
    );
  }
  return data;
}

/** Stripe wil form-encoded data met blokhaakjes voor geneste velden. */
function naarFormulier(obj, voorvoegsel = '', doel = new URLSearchParams()) {
  for (const [sleutel, waarde] of Object.entries(obj)) {
    if (waarde === undefined || waarde === null) continue;
    const naam = voorvoegsel ? `${voorvoegsel}[${sleutel}]` : sleutel;
    if (Array.isArray(waarde)) {
      waarde.forEach((v, i) => {
        if (v !== null && typeof v === 'object') naarFormulier(v, `${naam}[${i}]`, doel);
        else doel.append(`${naam}[${i}]`, String(v));
      });
    } else if (typeof waarde === 'object') {
      naarFormulier(waarde, naam, doel);
    } else {
      doel.append(naam, String(waarde));
    }
  }
  return doel;
}

/**
 * Verifieer de Stripe-webhookhandtekening (schema v1, HMAC-SHA256).
 * Zonder deze controle kan iedereen abonnementen aanmaken.
 */
export async function verifieerStripeHandtekening(ruweBody, kop, geheim, marge = 300) {
  if (!kop || !geheim) return false;

  const delen = Object.fromEntries(
    kop.split(',').map((d) => {
      const i = d.indexOf('=');
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    })
  );
  const tijd = Number(delen.t);
  if (!tijd || Math.abs(Date.now() / 1000 - tijd) > marge) return false;

  const verwachtingen = kop
    .split(',')
    .filter((d) => d.trim().startsWith('v1='))
    .map((d) => d.trim().slice(3));
  if (!verwachtingen.length) return false;

  const sleutel = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(geheim),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const hand = await crypto.subtle.sign(
    'HMAC',
    sleutel,
    new TextEncoder().encode(`${tijd}.${ruweBody}`)
  );
  const hex = [...new Uint8Array(hand)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return verwachtingen.some((v) => tijdsveiligGelijk(v, hex));
}

function tijdsveiligGelijk(a, b) {
  if (a.length !== b.length) return false;
  let verschil = 0;
  for (let i = 0; i < a.length; i++) verschil |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return verschil === 0;
}

/* ---------------- E-mail ---------------- */

/** Verstuur via Resend. Gratis laag: 3.000 mails per maand, 100 per dag. */
export async function verstuurMail(env, { aan, onderwerp, html, tekst }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY ontbreekt');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_AFZENDER ?? 'Kentekenwacht <onboarding@resend.dev>',
      to: [aan],
      subject: onderwerp,
      html,
      text: tekst,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}
