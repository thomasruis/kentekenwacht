#!/usr/bin/env node
/**
 * End-to-end test van de bezoekerskant.
 *
 * Start een lokale server die public/ serveert en /api/lookup nabootst met een
 * echt opgebouwd rapport, en bedient de site daarna met een echte browser.
 * Dit controleert wat de unit-tests niet raken: het formulier, de weergave van
 * het resultaat en de koopstroom.
 *
 *   node scripts/e2e-test.mjs
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { installeerMock } from './mock-rdw.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HIER, '..', 'public-demo');

/* 1. Rapport opbouwen met de echte code tegen de nagebootste RDW-API. */
installeerMock();
const { haalVoertuigRapport } = await import('../functions/_lib/rdw.js');
const RAPPORT = await haalVoertuigRapport('89KKZ2');

/* 2. Server */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
};

let checkoutOntvangen = null;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');

  if (u.pathname === '/api/lookup') {
    const k = (u.searchParams.get('kenteken') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    res.writeHead(k === '89KKZ2' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        k === '89KKZ2'
          ? RAPPORT
          : { fout: 'niet_gevonden', bericht: 'Dit kenteken staat niet in het RDW-register.' }
      )
    );
    return;
  }

  if (u.pathname === '/api/checkout') {
    let body = '';
    for await (const stuk of req) body += stuk;
    checkoutOntvangen = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: 'http://127.0.0.1:8788/nep-stripe' }));
    return;
  }

  if (u.pathname === '/nep-stripe') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Stripe</title><h1 id="stripe">Betaalpagina</h1>');
    return;
  }

  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'text/plain' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('404');
  }
});
await new Promise((r) => server.listen(8788, r));

/* 3. Browser */
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright/index.js');

let ok = 0;
let mis = 0;
const check = (naam, voorwaarde, detail = '') => {
  if (voorwaarde) {
    ok++;
    console.log(`  ✓ ${naam}`);
  } else {
    mis++;
    console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ''}`);
  }
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const jsFouten = [];
page.on('pageerror', (e) => jsFouten.push(String(e)));

console.log('\nEnd-to-end (echte browser)\n');
console.log('Kentekencheck');

await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle' });

// Invoer normaliseert terwijl je typt.
await page.fill('#kw-kenteken', '89-kk-z2');
check(
  'invoer genormaliseerd tijdens typen',
  (await page.inputValue('#kw-kenteken')) === '89KKZ2',
  await page.inputValue('#kw-kenteken')
);

await page.click('#kw-knop');
await page.waitForSelector('#kw-uitvoer .data-grid', { timeout: 8000 });

const tekst = await page.textContent('#kw-uitvoer');
check('merk en model getoond', tekst.includes('Kia') && tekst.includes('Sorento'));
// 89KKZ2 is sidecode 99-XXX-9, dus de juiste notatie is 89-KKZ-2.
check('kenteken in juiste sidecode-notatie', tekst.includes('89-KKZ-2'), tekst.slice(0, 60));
check('APK-blok aanwezig', tekst.includes('APK'));
check(
  'openstaande terugroepactie gemeld',
  tekst.includes('openstaande terugroepactie'),
  'waarschuwing ontbreekt'
);
check('defectomschrijving getoond', tekst.includes('stuurkoppeling'));
check('herstelde actie als hersteld gemarkeerd', tekst.includes('Hersteld'));
check('keuringsgebreken getoond', tekst.includes('Bandenprofiel te gering'));
check('catalogusprijs in euro-notatie', /€\s?43\.995/.test(tekst), 'prijsopmaak');
check('bron vermeld', tekst.includes('RDW Open Data'));
check('conversieblok aanwezig', tekst.includes('onder bewaking'));

check('URL bijgewerkt', page.url().includes('kenteken=89KKZ2'), page.url());
check(
  'paginatitel bijgewerkt',
  (await page.title()).includes('Kia Sorento'),
  await page.title()
);

// Onbekend kenteken
await page.goto('http://127.0.0.1:8788/?kenteken=11AA11', { waitUntil: 'networkidle' });
await page.waitForSelector('#kw-uitvoer .status', { timeout: 8000 });
check(
  'onbekend kenteken geeft nette melding',
  (await page.textContent('#kw-uitvoer')).includes('niet in het RDW-register')
);

// Te kort kenteken
await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle' });
await page.fill('#kw-kenteken', '89KK');
await page.click('#kw-knop');
await page.waitForTimeout(300);
check(
  'te kort kenteken wordt afgevangen',
  (await page.textContent('#kw-uitvoer')).includes('zes tekens')
);

console.log('\nKoopstroom');
await page.goto('http://127.0.0.1:8788/wacht/', { waitUntil: 'networkidle' });
await page.click('#kw-koop-particulier');
await page.waitForSelector('#kw-koop-paneel', { timeout: 5000 });
check('koopformulier verschijnt', await page.isVisible('#kw-email'));
check(
  'drie kentekenvelden voor particulier',
  (await page.locator('.kw-koop-kenteken').count()) === 3
);

// Zonder geldig e-mailadres mag er niets verstuurd worden.
await page.fill('#kw-email', 'geen-email');
await page.locator('.kw-koop-kenteken').first().fill('89KKZ2');
await page.click('#kw-koop-paneel button.knop');
await page.waitForTimeout(250);
check(
  'ongeldig e-mailadres wordt geweigerd',
  (await page.textContent('#kw-koop-fout')).includes('geldig e-mailadres') &&
    checkoutOntvangen === null
);

// Zonder kenteken evenmin.
await page.fill('#kw-email', 'thomas@voorbeeld.nl');
await page.locator('.kw-koop-kenteken').first().fill('');
await page.click('#kw-koop-paneel button.knop');
await page.waitForTimeout(250);
check(
  'ontbrekend kenteken wordt geweigerd',
  (await page.textContent('#kw-koop-fout')).includes('kenteken') &&
    checkoutOntvangen === null
);

// Correct ingevuld: door naar Stripe.
await page.locator('.kw-koop-kenteken').nth(0).fill('89-KK-Z2');
await page.locator('.kw-koop-kenteken').nth(1).fill('12ABC3');
await page.click('#kw-koop-paneel button.knop');
await page.waitForSelector('#stripe', { timeout: 8000 });
check('doorgestuurd naar betaalpagina', await page.isVisible('#stripe'));
check(
  'checkout kreeg genormaliseerde kentekens',
  JSON.stringify(checkoutOntvangen?.kentekens) === JSON.stringify(['89KKZ2', '12ABC3']),
  JSON.stringify(checkoutOntvangen)
);
check('checkout kreeg het juiste plan', checkoutOntvangen?.plan === 'particulier');
check('checkout kreeg het e-mailadres', checkoutOntvangen?.email === 'thomas@voorbeeld.nl');

// Diep linken vanaf een resultaat.
checkoutOntvangen = null;
await page.goto('http://127.0.0.1:8788/wacht/?kenteken=89KKZ2', { waitUntil: 'networkidle' });
await page.waitForSelector('#kw-koop-paneel', { timeout: 5000 });
check(
  'kenteken uit de URL vooringevuld',
  (await page.locator('.kw-koop-kenteken').first().inputValue()) === '89KKZ2'
);

console.log('\nBeheerpagina');
await page.goto('http://127.0.0.1:8788/beheer/', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
check(
  'beheerpagina zonder token geeft uitleg',
  (await page.textContent('#kw-beheer')).includes('link in je e-mail')
);

console.log('\nAlgemeen');
check('geen JavaScript-fouten', jsFouten.length === 0, jsFouten[0] ?? '');

await browser.close();
server.close();

console.log(`\n${ok} geslaagd, ${mis} mislukt\n`);
process.exit(mis ? 1 : 0);
