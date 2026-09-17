/** HTML-sjablonen. Pure functies: data in, string uit. */

import { slug } from '../functions/_lib/rdw.js';

export const SITE = {
  naam: 'Kentekenwacht',
  tagline: 'APK, terugroepacties en voertuiggegevens uit het RDW-register',
  // Wordt bij de build overschreven met de echte URL uit env.SITE_URL.
  url: 'https://kentekenwacht.pages.dev',
};

export function esc(w) {
  if (w === null || w === undefined) return '';
  return String(w)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const nf = new Intl.NumberFormat('nl-NL');
export const getal = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? null
    : nf.format(Math.round(Number(n)));

export const euro = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? null
    : new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(Number(n));

/* ------------------------------------------------------------------ */

export function layout({
  titel,
  beschrijving,
  canoniek,
  inhoud,
  kruimels = [],
  schema = null,
  zoekbalk = false,
}) {
  const kruimelHtml = kruimels.length
    ? `<nav class="kruimels wrap" aria-label="Kruimelpad">${kruimels
        .map((k, i) =>
          k.url && i < kruimels.length - 1
            ? `<a href="${esc(k.url)}">${esc(k.label)}</a>`
            : `<span>${esc(k.label)}</span>`
        )
        .join(' <span aria-hidden="true">›</span> ')}</nav>`
    : '';

  const kruimelSchema = kruimels.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: kruimels.map((k, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: k.label,
          ...(k.url ? { item: SITE.url + k.url } : {}),
        })),
      }
    : null;

  const schemas = [schema, kruimelSchema].filter(Boolean);

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)}</title>
<meta name="description" content="${esc(beschrijving)}">
<link rel="canonical" href="${esc(SITE.url + canoniek)}">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beschrijving)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="nl_NL">
<meta property="og:url" content="${esc(SITE.url + canoniek)}">
<meta name="theme-color" content="#f5c518">
<link rel="stylesheet" href="/assets/kw.css">
<link rel="icon" href="/assets/plaat.svg" type="image/svg+xml">
${schemas
  .map(
    (s) =>
      `<script type="application/ld+json">${JSON.stringify(s).replace(
        /</g,
        '\\u003c'
      )}</script>`
  )
  .join('\n')}
</head>
<body>
<header class="kw-kop">
  <div class="wrap">
    <a class="kw-logo" href="/">
      <span class="kw-logo-mark" aria-hidden="true">NL</span>
      Kentekenwacht
    </a>
    <nav class="kw-nav">
      <a href="/">Kenteken checken</a>
      <a href="/terugroepacties/">Terugroepacties</a>
      <a href="/merken/">Merken</a>
      <a href="/wacht/">Bewaking</a>
    </nav>
  </div>
</header>
${kruimelHtml}
<main>
${inhoud}
</main>
<footer class="kw-voet">
  <div class="wrap">
    <div>
      <strong>Kentekenwacht</strong><br>
      Gegevens uit <a href="https://opendata.rdw.nl" rel="noopener">RDW Open Data</a>.
      Geen officiële RDW-dienst.
    </div>
    <div>
      <a href="/over/">Over</a> ·
      <a href="/privacy/">Privacy</a> ·
      <a href="/voorwaarden/">Voorwaarden</a> ·
      <a href="/wacht/">Bewaking</a>
    </div>
  </div>
</footer>
${zoekbalk ? '<script src="/assets/kw.js" defer></script>' : ''}
</body>
</html>`;
}

/* ------------------------------------------------------------------ */

export function zoekFormulier(autofocus = false) {
  return `<form id="kw-form" class="kw-zoek" autocomplete="off">
  <label class="kw-plaat-veld" for="kw-kenteken">
    <span class="kw-plaat-nl" aria-hidden="true"><span aria-hidden="true">★</span>NL</span>
    <input id="kw-kenteken" name="kenteken" type="text" inputmode="text"
           placeholder="XX-999-X" maxlength="8" spellcheck="false"
           aria-label="Kenteken"${autofocus ? ' autofocus' : ''}>
  </label>
  <button id="kw-knop" class="knop" type="submit">Check kenteken</button>
</form>
<div id="kw-uitvoer" class="wrap verborgen" style="text-align:left;padding-top:26px"></div>`;
}

/* ------------------------------------------------------------------ */

export function homePagina({ totaalAutos, topMerken, recenteRecalls, bijgewerkt }) {
  const inhoud = `
<section class="wrap kw-hero">
  <h1>Check gratis of jouw auto een openstaande terugroepactie heeft</h1>
  <p class="lead">Eén kenteken, vijf RDW-registers: APK-vervaldatum, terugroepacties,
     keuringsgebreken en alle voertuiggegevens. Zonder account.</p>
  ${zoekFormulier(true)}
  <p class="kw-hint">Gratis · geen registratie · bron: RDW Open Data${
    totaalAutos ? ` · ${getal(totaalAutos)} personenauto's in het register` : ''
  }</p>
</section>

<section class="wrap">
  <div class="kaart prose">
    <h2>Waarom een terugroepactie je vaak niet bereikt</h2>
    <p>Fabrikanten roepen voertuigen terug als er een veiligheidsprobleem is — remmen,
       airbags, stuurinrichting. De fabrikant schrijft dan de op dat moment bekende
       eigenaar aan. Heb je de auto tweedehands gekocht of ben je verhuisd, dan komt die
       brief er vaak niet, terwijl het defect er wel is.</p>
    <p>Herstel na een terugroepactie is <strong>altijd gratis</strong> bij een
       merkdealer, ook als de garantie allang is verlopen.</p>
    <p class="bron-noot">Het RDW publiceert deze gegevens zelf ook, op
       <a href="https://ovi.rdw.nl" rel="noopener">ovi.rdw.nl</a>. Daar moet je alleen
       zelf gaan kijken — wij doen het elke dag voor je en mailen als er iets verandert.</p>
  </div>
</section>

<section class="wrap">
  <h2 class="sectie">Recent gepubliceerde terugroepacties</h2>
  <div class="tabel-wrap">
    <table class="kw">
      <thead><tr><th>Categorie</th><th>Producent</th><th>Risico</th><th>Gepubliceerd</th></tr></thead>
      <tbody>
      ${recenteRecalls
        .slice(0, 12)
        .map(
          (r) => `<tr>
        <td>${esc(r.categorie ?? '—')}</td>
        <td>${esc(r.producent ?? '—')}</td>
        <td>${risicoBadge(r.risico)}</td>
        <td>${esc(r.publicatiedatum ?? '—')}</td>
      </tr>`
        )
        .join('')}
      </tbody>
    </table>
  </div>
  <p><a href="/terugroepacties/">Alle recente terugroepacties →</a></p>
</section>

<section class="wrap">
  <h2 class="sectie">Populaire merken</h2>
  <ul class="link-raster">
    ${topMerken
      .slice(0, 24)
      .map(
        (m) =>
          `<li><a href="/merk/${slug(m.merk)}/">${esc(m.merkNet)} <span style="color:var(--tekst-zwak)">${getal(
            m.aantal
          )}</span></a></li>`
      )
      .join('')}
  </ul>
  <p><a href="/merken/">Alle merken →</a></p>
</section>

<section class="wrap">
  <div class="kaart" style="border-color:var(--accent)">
    <h2>Laat het je automatisch melden</h2>
    <p class="prose">Een terugroepactie verschijnt zonder aankondiging en een APK verloopt stil.
       Kentekenwacht controleert jouw kenteken elke dag en mailt zodra er iets verandert.</p>
    <p><a class="knop" href="/wacht/">Bekijk bewaking — vanaf € 4,50 per jaar</a></p>
  </div>
</section>

<p class="wrap bron-noot">Gegevens bijgewerkt op ${esc(bijgewerkt)}. Bron: RDW Open Data.</p>
`;

  return layout({
    titel: 'Kentekencheck: APK, terugroepacties en voertuiggegevens | Kentekenwacht',
    beschrijving:
      'Gratis kentekencheck met openstaande terugroepacties, APK-vervaldatum, keuringsgebreken en alle RDW-voertuiggegevens. Geen account nodig.',
    canoniek: '/',
    inhoud,
    zoekbalk: true,
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE.naam,
      url: SITE.url,
      description: SITE.tagline,
      inLanguage: 'nl-NL',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${SITE.url}/?kenteken={kenteken}`,
        'query-input': 'required name=kenteken',
      },
    },
  });
}

/* ------------------------------------------------------------------ */

export function merkPagina({ merk, merkNet, totaal, modellen, kleuren, recalls, bijgewerkt }) {
  const verlopenTotaal = modellen.reduce((s, m) => s + (m.verlopen ?? 0), 0);
  const pct = totaal ? ((verlopenTotaal / totaal) * 100).toFixed(1) : null;

  const inhoud = `
<section class="wrap" style="padding-top:26px">
  <h1>${esc(merkNet)} in het RDW-register</h1>
  <p class="lead" style="color:var(--tekst-zacht);max-width:62ch">
    Er staan ${getal(totaal)} personenauto's van het merk ${esc(merkNet)} in het
    Nederlandse kentekenregister. Hieronder de meest voorkomende modellen, de
    APK-status en de terugroepacties die op dit merk geregistreerd zijn.
  </p>

  <div class="kaart">
    <h2>Check een specifieke ${esc(merkNet)}</h2>
    ${zoekFormulier()}
  </div>

  <div class="data-grid" style="margin-bottom:18px">
    <div><div class="label">Geregistreerd</div><div class="waarde">${getal(totaal)}</div></div>
    <div><div class="label">APK verlopen</div><div class="waarde">${getal(verlopenTotaal)}${
      pct ? ` <span style="font-weight:400;color:var(--tekst-zwak)">(${pct}%)</span>` : ''
    }</div></div>
    <div><div class="label">Modellen</div><div class="waarde">${getal(modellen.length)}</div></div>
    <div><div class="label">Terugroepacties</div><div class="waarde">${getal(recalls.length)}</div></div>
  </div>

  <h2 class="sectie">Modellen</h2>
  <div class="tabel-wrap">
    <table class="kw">
      <thead><tr><th>Model</th><th>Aantal</th><th>APK verlopen</th><th>Gem. catalogusprijs</th></tr></thead>
      <tbody>
      ${modellen
        .map(
          (m) => `<tr>
        <td><a href="/merk/${slug(merk)}/${slug(m.model)}/">${esc(m.modelNet)}</a></td>
        <td>${getal(m.aantal)}</td>
        <td>${getal(m.verlopen ?? 0)}</td>
        <td>${euro(m.gemPrijs) ?? '—'}</td>
      </tr>`
        )
        .join('')}
      </tbody>
    </table>
  </div>

  ${
    kleuren.length
      ? `<h2 class="sectie">Kleuren</h2>
  <div class="tabel-wrap"><table class="kw">
    <thead><tr><th>Kleur</th><th>Aantal</th><th>Aandeel</th></tr></thead><tbody>
    ${kleuren
      .map(
        (k) =>
          `<tr><td>${esc(k.kleurNet)}</td><td>${getal(k.aantal)}</td><td>${(
            (k.aantal / totaal) *
            100
          ).toFixed(1)}%</td></tr>`
      )
      .join('')}
    </tbody></table></div>`
      : ''
  }

  ${recallSectie(recalls, merkNet)}

  <div class="kaart" style="border-color:var(--accent);margin-top:26px">
    <h2>Rijd je zelf een ${esc(merkNet)}?</h2>
    <p class="prose">Zet je kenteken onder bewaking. Je krijgt automatisch bericht bij een
      nieuwe terugroepactie op jouw voertuig en ruim voor je APK verloopt.</p>
    <p><a class="knop" href="/wacht/">Bewaking instellen — vanaf € 4,50 per jaar</a></p>
  </div>

  <p class="bron-noot">Bijgewerkt op ${esc(bijgewerkt)}. Bron: RDW Open Data.</p>
</section>`;

  return layout({
    titel: `${merkNet}: aantallen, modellen en terugroepacties | Kentekenwacht`,
    beschrijving: `${getal(totaal)} ${merkNet}-personenauto's in het RDW-register. Bekijk modellen, APK-status en ${recalls.length} geregistreerde terugroepacties.`,
    canoniek: `/merk/${slug(merk)}/`,
    inhoud,
    zoekbalk: true,
    kruimels: [
      { label: 'Home', url: '/' },
      { label: 'Merken', url: '/merken/' },
      { label: merkNet },
    ],
  });
}

/* ------------------------------------------------------------------ */

export function modelPagina({
  merk,
  merkNet,
  model,
  modelNet,
  aantal,
  verlopen,
  gemPrijs,
  gemMassa,
  recalls,
  bijgewerkt,
}) {
  const pct = aantal ? ((verlopen / aantal) * 100).toFixed(1) : null;
  const naam = `${merkNet} ${modelNet}`;

  const inhoud = `
<section class="wrap" style="padding-top:26px">
  <h1>${esc(naam)}</h1>
  <p class="lead" style="color:var(--tekst-zacht);max-width:62ch">
    Er rijden ${getal(aantal)} exemplaren van de ${esc(naam)} rond met een Nederlands
    kenteken. ${
      pct
        ? `Bij ${getal(verlopen)} daarvan (${pct}%) is de APK verlopen.`
        : ''
    }
  </p>

  <div class="data-grid" style="margin-bottom:18px">
    <div><div class="label">Geregistreerd</div><div class="waarde">${getal(aantal)}</div></div>
    <div><div class="label">APK verlopen</div><div class="waarde">${getal(verlopen)}${
      pct ? ` <span style="font-weight:400;color:var(--tekst-zwak)">(${pct}%)</span>` : ''
    }</div></div>
    ${gemPrijs ? `<div><div class="label">Gem. catalogusprijs</div><div class="waarde">${euro(gemPrijs)}</div></div>` : ''}
    ${gemMassa ? `<div><div class="label">Gem. massa leeg</div><div class="waarde">${getal(gemMassa)} kg</div></div>` : ''}
  </div>

  <div class="kaart">
    <h2>Check een specifieke ${esc(naam)}</h2>
    <p class="prose">Vul het kenteken in voor de APK-datum, openstaande terugroepacties
      en de gebreken die bij de laatste keuring zijn gevonden.</p>
    ${zoekFormulier()}
  </div>

  ${recallSectie(recalls, merkNet)}

  <div class="kaart prose">
    <h2>Waar let je op bij een tweedehands ${esc(naam)}?</h2>
    <ul>
      <li><strong>Openstaande terugroepacties.</strong> Vul het kenteken hierboven in.
          Herstel is gratis bij de merkdealer, ook bij een oude auto.</li>
      <li><strong>APK-vervaldatum.</strong> Een auto die pas net is gekeurd zegt meer dan
          een auto waarvan de APK over drie weken verloopt.</li>
      <li><strong>Tellerstandoordeel.</strong> Het RDW registreert of de reeks
          tellerstanden logisch is. Staat daar "Onlogisch", loop dan weg.</li>
      <li><strong>Gebreken bij de laatste keuring.</strong> Die staan in het register en
          vertellen je hoe de auto is onderhouden.</li>
    </ul>
  </div>

  <p class="bron-noot">Bijgewerkt op ${esc(bijgewerkt)}. Bron: RDW Open Data.</p>
</section>`;

  return layout({
    titel: `${naam}: aantal in Nederland, APK-status en terugroepacties | Kentekenwacht`,
    beschrijving: `${getal(aantal)} exemplaren van de ${naam} in het RDW-register.${
      pct ? ` Bij ${pct}% is de APK verlopen.` : ''
    } Check terugroepacties op kenteken.`,
    canoniek: `/merk/${slug(merk)}/${slug(model)}/`,
    inhoud,
    zoekbalk: true,
    kruimels: [
      { label: 'Home', url: '/' },
      { label: 'Merken', url: '/merken/' },
      { label: merkNet, url: `/merk/${slug(merk)}/` },
      { label: modelNet },
    ],
  });
}

/* ------------------------------------------------------------------ */

function risicoBadge(risico) {
  if (!risico) return '<span class="badge">Onbekend</span>';
  const kl = risico === 'Ernstig' ? 'rood' : risico === 'Gemiddeld' ? 'oranje' : '';
  return `<span class="badge ${kl}">${esc(risico)}</span>`;
}

function recallSectie(recalls, merkNet) {
  if (!recalls?.length) {
    return `<h2 class="sectie">Terugroepacties</h2>
    <div class="status ok"><span class="ikoon">✅</span><div>
      <strong>Geen terugroepacties gevonden</strong>
      <p>Voor ${esc(merkNet)} staan in onze dagelijkse uitsnede van het RDW-register geen
         terugroepacties. Dat sluit niet uit dat er op jouw specifieke voertuig wél een
         actie loopt — check daarvoor het kenteken.</p></div></div>`;
  }
  return `<h2 class="sectie">Terugroepacties (${recalls.length})</h2>
  ${recalls
    .slice(0, 40)
    .map(
      (r) => `<div class="recall ${
        r.risico === 'Ernstig' ? 'ernstig' : r.risico === 'Gemiddeld' ? 'gemiddeld' : ''
      }">
    <h4>${esc(r.categorie ?? 'Terugroepactie')} ${risicoBadge(r.risico)}</h4>
    ${r.defect ? `<p><strong>Defect:</strong> ${esc(r.defect)}</p>` : ''}
    ${r.gevolgen ? `<p><strong>Mogelijk gevolg:</strong> ${esc(r.gevolgen)}</p>` : ''}
    <div class="meta">${[
      r.producent ? esc(r.producent) : null,
      r.publicatiedatum ? `gepubliceerd ${esc(r.publicatiedatum)}` : null,
      r.aantalVoertuigenNl ? `${getal(r.aantalVoertuigenNl)} voertuigen in Nederland` : null,
    ]
      .filter(Boolean)
      .join(' · ')}</div>
  </div>`
    )
    .join('')}`;
}

/* ------------------------------------------------------------------ */

export function merkenIndex({ merken, bijgewerkt }) {
  const inhoud = `
<section class="wrap" style="padding-top:26px">
  <h1>Alle automerken in het RDW-register</h1>
  <p class="lead" style="color:var(--tekst-zacht);max-width:62ch">
    ${getal(merken.length)} merken, gesorteerd op het aantal personenauto's dat er in
    Nederland van geregistreerd staat.</p>
  <div class="tabel-wrap">
    <table class="kw">
      <thead><tr><th>Merk</th><th>Personenauto's</th></tr></thead>
      <tbody>
      ${merken
        .map(
          (m) =>
            `<tr><td><a href="/merk/${slug(m.merk)}/">${esc(m.merkNet)}</a></td><td>${getal(
              m.aantal
            )}</td></tr>`
        )
        .join('')}
      </tbody>
    </table>
  </div>
  <p class="bron-noot">Bijgewerkt op ${esc(bijgewerkt)}. Bron: RDW Open Data.</p>
</section>`;

  return layout({
    titel: 'Alle automerken in Nederland — aantallen uit het RDW-register | Kentekenwacht',
    beschrijving:
      'Overzicht van alle automerken met het aantal personenauto’s dat er in Nederland van geregistreerd staat, direct uit RDW Open Data.',
    canoniek: '/merken/',
    inhoud,
    kruimels: [{ label: 'Home', url: '/' }, { label: 'Merken' }],
  });
}

/* ------------------------------------------------------------------ */

export function terugroepactiesPagina({ recalls, bijgewerkt }) {
  const inhoud = `
<section class="wrap" style="padding-top:26px">
  <h1>Recente terugroepacties in Nederland</h1>
  <p class="lead" style="color:var(--tekst-zacht);max-width:64ch">
    Alle terugroepacties die het RDW publiceert, nieuwste eerst. Wil je weten of er één
    op jouw auto van toepassing is, vul dan je kenteken in — dat is de enige manier om
    het zeker te weten.</p>

  <div class="kaart">${zoekFormulier()}</div>

  ${recalls
    .slice(0, 150)
    .map(
      (r) => `<div class="recall ${
        r.risico === 'Ernstig' ? 'ernstig' : r.risico === 'Gemiddeld' ? 'gemiddeld' : ''
      }">
    <h4>${esc(r.categorie ?? 'Terugroepactie')} ${risicoBadge(r.risico)}</h4>
    ${r.defect ? `<p><strong>Defect:</strong> ${esc(r.defect)}</p>` : ''}
    ${r.gevolgen ? `<p><strong>Mogelijk gevolg:</strong> ${esc(r.gevolgen)}</p>` : ''}
    ${r.herstel ? `<p><strong>Herstel:</strong> ${esc(r.herstel)}</p>` : ''}
    <div class="meta">${[
      r.producent ? esc(r.producent) : null,
      r.publicatiedatum ? `gepubliceerd ${esc(r.publicatiedatum)}` : null,
      r.aantalVoertuigenNl ? `${getal(r.aantalVoertuigenNl)} voertuigen in Nederland` : null,
      r.referentie ? `ref. ${esc(r.referentie)}` : null,
    ]
      .filter(Boolean)
      .join(' · ')}</div>
  </div>`
    )
    .join('')}

  <p class="bron-noot">Bijgewerkt op ${esc(bijgewerkt)}. Bron: RDW Open Data.</p>
</section>`;

  return layout({
    titel: 'Recente terugroepacties auto’s Nederland | Kentekenwacht',
    beschrijving:
      'Actueel overzicht van terugroepacties die het RDW publiceert, met defect, risico en producent. Check op kenteken of jouw auto erbij zit.',
    canoniek: '/terugroepacties/',
    inhoud,
    zoekbalk: true,
    kruimels: [{ label: 'Home', url: '/' }, { label: 'Terugroepacties' }],
  });
}

/* ------------------------------------------------------------------ */

export function wachtPagina({ prijsJaar, prijsZakelijk }) {
  const inhoud = `
<section class="wrap" style="padding-top:26px">
  <h1>Kentekenwacht: dagelijkse bewaking van jouw kenteken</h1>
  <p class="lead" style="color:var(--tekst-zacht);max-width:64ch">
    Wij controleren elke ochtend het RDW-register en mailen je zodra er iets verandert
    aan jouw voertuig. Je hoeft er verder niets voor te doen.</p>

  <div class="kaart">
    <h2>Waar we op letten</h2>
    <div class="data-grid vast-drie">
      <div><div class="label">APK</div><div class="waarde">60, 30 en 7 dagen vooraf</div></div>
      <div><div class="label">Terugroepacties</div><div class="waarde">Zodra er één bijkomt</div></div>
      <div><div class="label">WAM-verzekering</div><div class="waarde">Als de dekking wegvalt</div></div>
      <div><div class="label">Tellerstandoordeel</div><div class="waarde">Bij wijziging</div></div>
      <div><div class="label">Keuringsgebreken</div><div class="waarde">Na elke keuring</div></div>
      <div><div class="label">Tenaamstelling</div><div class="waarde">Bij overschrijving</div></div>
    </div>
  </div>

  <div class="prijs-rij">
    <div class="prijs uitgelicht">
      <div class="label" style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--tekst-zwak)">Particulier</div>
      <div class="bedrag">€ ${esc(prijsJaar)}</div>
      <div class="per">per kenteken, per jaar</div>
      <ul>
        <li>Dagelijkse controle van het RDW-register</li>
        <li>E-mail bij elke wijziging</li>
        <li>APK-herinnering op 60, 30 en 7 dagen</li>
        <li>Tot 3 kentekens per account</li>
        <li>Opzeggen wanneer je wilt</li>
      </ul>
      <a class="knop" href="#" data-plan="particulier" id="kw-koop-particulier">Bewaking starten</a>
    </div>
    <div class="prijs">
      <div class="label" style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--tekst-zwak)">Wagenpark</div>
      <div class="bedrag">€ ${esc(prijsZakelijk)}</div>
      <div class="per">per maand, tot 50 kentekens</div>
      <ul>
        <li>Alles uit Particulier</li>
        <li>Tot 50 kentekens</li>
        <li>Wekelijks overzicht per e-mail</li>
        <li>CSV-export van je wagenpark</li>
        <li>Meerdere ontvangers per melding</li>
      </ul>
      <a class="knop secundair" href="#" data-plan="zakelijk" id="kw-koop-zakelijk">Wagenpark bewaken</a>
    </div>
  </div>

  <div class="kaart prose">
    <h2>Veelgestelde vragen</h2>
    <h3>Krijg ik dit niet al van het RDW?</h3>
    <p>Voor een deel wel, en dat zeggen we er liever eerlijk bij. Het RDW stuurt zes
       weken voor de vervaldatum een APK-herinnering aan de tenaamgestelde, per post of
       via de Berichtenbox. En op <a href="https://ovi.rdw.nl" rel="noopener">ovi.rdw.nl</a>
       kun je zelf gratis opzoeken of er een terugroepactie op je kenteken staat.</p>
    <p>Wat het RDW niet doet, is dagelijks voor je kijken en je mailen zodra er iets
       verandert. Een terugroepactie kan jaren na aankoop verschijnen, en de fabrikant
       schrijft de op dat moment bekende eigenaar aan — bij een tweedehands auto of na
       een verhuizing komt die brief er vaak niet. Ook over een vervallen
       WAM-verzekering, een gewijzigd tellerstandoordeel of de gebreken bij de laatste
       keuring krijg je van niemand automatisch bericht.</p>
    <p><strong>Rijd je één auto en let je goed op je post?</strong> Dan heb je ons
       waarschijnlijk niet nodig. Heb je meerdere voertuigen, of wil je er simpelweg
       niet aan hoeven denken, dan wel.</p>
    <h3>Welke gegevens slaan jullie op?</h3>
    <p>Je e-mailadres en de kentekens die je zelf invoert. Verder niets. Zie de
       <a href="/privacy/">privacyverklaring</a>.</p>
    <h3>Kan ik opzeggen?</h3>
    <p>Ja, op elk moment via de link onderaan elke e-mail. Je bewaking loopt dan door tot
       het einde van de betaalde periode.</p>
    <h3>Is dit een officiële RDW-dienst?</h3>
    <p>Nee. Kentekenwacht is onafhankelijk en gebruikt de openbare data die het RDW
       kosteloos publiceert.</p>
  </div>
</section>
<script src="/assets/kw-koop.js" defer></script>`;

  return layout({
    titel: 'Kenteken laten bewaken — APK- en terugroepactie-meldingen | Kentekenwacht',
    beschrijving:
      'Dagelijkse controle van het RDW-register op jouw kenteken. Automatisch bericht bij een nieuwe terugroepactie, naderende APK of gewijzigde verzekering.',
    canoniek: '/wacht/',
    inhoud,
    kruimels: [{ label: 'Home', url: '/' }, { label: 'Bewaking' }],
    schema: {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Kentekenwacht bewaking',
      serviceType: 'Voertuigmonitoring',
      areaServed: 'NL',
      provider: { '@type': 'Organization', name: SITE.naam, url: SITE.url },
    },
  });
}

/* ------------------------------------------------------------------ */

export function tekstPagina({ titel, beschrijving, pad, html, kruimelLabel }) {
  return layout({
    titel: `${titel} | Kentekenwacht`,
    beschrijving,
    canoniek: pad,
    inhoud: `<section class="wrap" style="padding-top:26px"><div class="kaart prose">${html}</div></section>`,
    kruimels: [{ label: 'Home', url: '/' }, { label: kruimelLabel ?? titel }],
  });
}
