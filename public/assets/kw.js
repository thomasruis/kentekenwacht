/* Kentekenwacht — client. Geen dependencies. */
(function () {
  'use strict';

  var form = document.getElementById('kw-form');
  var invoer = document.getElementById('kw-kenteken');
  var knop = document.getElementById('kw-knop');
  var uitvoer = document.getElementById('kw-uitvoer');
  if (!form || !invoer || !uitvoer) return;

  /* ---------- hulpjes ---------- */

  function esc(w) {
    if (w === null || w === undefined) return '';
    return String(w)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normaliseer(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  /** Zet 12ABC3 om naar de leesbare streepjesvorm van de RDW-sidecode. */
  function metStreepjes(k) {
    var patronen = [
      /^([A-Z]{2})(\d{2})(\d{2})$/, /^(\d{2})(\d{2})([A-Z]{2})$/,
      /^(\d{2})([A-Z]{2})(\d{2})$/, /^([A-Z]{2})(\d{2})([A-Z]{2})$/,
      /^([A-Z]{2})([A-Z]{2})(\d{2})$/, /^(\d{2})([A-Z]{2})([A-Z]{2})$/,
      /^(\d{2})([A-Z]{3})(\d{1})$/, /^(\d{1})([A-Z]{3})(\d{2})$/,
      /^([A-Z]{2})(\d{3})([A-Z]{1})$/, /^([A-Z]{1})(\d{3})([A-Z]{2})$/,
      /^([A-Z]{3})(\d{2})([A-Z]{1})$/, /^([A-Z]{1})(\d{2})([A-Z]{3})$/,
      /^(\d{1})([A-Z]{2})(\d{3})$/, /^(\d{3})([A-Z]{2})(\d{1})$/
    ];
    for (var i = 0; i < patronen.length; i++) {
      var m = k.match(patronen[i]);
      if (m) return m[1] + '-' + m[2] + '-' + m[3];
    }
    return k;
  }

  function getal(n) {
    if (n === null || n === undefined) return null;
    return new Intl.NumberFormat('nl-NL').format(n);
  }

  function euro(n) {
    if (n === null || n === undefined) return null;
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency', currency: 'EUR', maximumFractionDigits: 0
    }).format(n);
  }

  /* ---------- weergave ---------- */

  function rijenHtml(paren) {
    var items = paren.filter(function (p) {
      return p[1] !== null && p[1] !== undefined && p[1] !== '';
    });
    if (!items.length) return '';
    return '<div class="data-grid">' + items.map(function (p) {
      return '<div><div class="label">' + esc(p[0]) + '</div>' +
             '<div class="waarde">' + esc(p[1]) + '</div></div>';
    }).join('') + '</div>';
  }

  function apkBanner(r) {
    var s = r.apk.status || {};
    var klasse = { verlopen: 'alarm', bijna_verlopen: 'let-op', let_op: 'let-op',
                   geldig: 'ok', geen_apk: 'neutraal' }[s.code] || 'neutraal';
    var ikoon = { verlopen: '⛔', bijna_verlopen: '⚠️', let_op: '⚠️',
                  geldig: '✅', geen_apk: 'ℹ️' }[s.code] || 'ℹ️';
    var extra = '';
    if (s.code === 'verlopen') {
      extra = 'Rijden met een verlopen APK levert een boete op en je verzekering kan dekking weigeren.';
    } else if (s.code === 'bijna_verlopen' || s.code === 'let_op') {
      extra = 'Plan de keuring op tijd in; vlak voor de vervaldatum zitten garages vaak vol.';
    } else if (s.code === 'geldig') {
      extra = 'Vervaldatum: ' + (r.apk.vervaldatum || 'onbekend') + '.';
    } else {
      extra = 'Voor dit voertuig staat geen APK-vervaldatum in het register.';
    }
    return '<div class="status ' + klasse + '"><span class="ikoon">' + ikoon + '</span>' +
      '<div><strong>' + esc(s.label || 'APK-status onbekend') + '</strong>' +
      '<p>' + esc(extra) + '</p></div></div>';
  }

  function recallsHtml(r) {
    var open = (r.terugroepacties || []).filter(function (t) { return t.openstaand; });
    var dicht = (r.terugroepacties || []).filter(function (t) { return !t.openstaand; });

    var html = '';
    if (!r.terugroepacties || !r.terugroepacties.length) {
      html += '<div class="status ok"><span class="ikoon">✅</span><div>' +
        '<strong>Geen terugroepacties bekend</strong>' +
        '<p>Voor dit kenteken staat geen terugroepactie geregistreerd bij de RDW.</p></div></div>';
      return html;
    }

    if (open.length) {
      html += '<div class="status alarm"><span class="ikoon">⛔</span><div>' +
        '<strong>' + open.length + ' openstaande terugroepactie' + (open.length === 1 ? '' : 's') + '</strong>' +
        '<p>De producent heeft een defect gemeld dat nog niet als hersteld aan dit voertuig is geregistreerd. ' +
        'Herstel is gratis bij de dealer.</p></div></div>';
    }

    html += (open.concat(dicht)).map(function (t) {
      var kl = t.risico === 'Ernstig' ? 'ernstig' : (t.risico === 'Gemiddeld' ? 'gemiddeld' : '');
      var badge = t.openstaand
        ? '<span class="badge rood">Openstaand</span>'
        : '<span class="badge groen">Hersteld</span>';
      var risico = t.risico
        ? ' <span class="badge ' + (t.risico === 'Ernstig' ? 'rood' : t.risico === 'Gemiddeld' ? 'oranje' : '') + '">Risico: ' + esc(t.risico) + '</span>'
        : '';
      var meta = [];
      if (t.producent) meta.push(esc(t.producent));
      if (t.publicatiedatum) meta.push('gepubliceerd ' + esc(t.publicatiedatum));
      if (t.aantalVoertuigenNl) meta.push(getal(t.aantalVoertuigenNl) + ' voertuigen in Nederland');
      if (t.referentie) meta.push('ref. ' + esc(t.referentie));

      return '<div class="recall ' + kl + '">' +
        '<h4>' + esc(t.categorie || 'Terugroepactie') + ' ' + badge + risico + '</h4>' +
        (t.defect ? '<p><strong>Defect:</strong> ' + esc(t.defect) + '</p>' : '') +
        (t.gevolgen ? '<p><strong>Mogelijk gevolg:</strong> ' + esc(t.gevolgen) + '</p>' : '') +
        (t.herstel ? '<p><strong>Herstel:</strong> ' + esc(t.herstel) + '</p>' : '') +
        (t.meerInfoUrl ? '<p><a href="' + esc(t.meerInfoUrl) + '" rel="nofollow noopener" target="_blank">Informatie van de producent</a>' +
          (t.meerInfoTelefoon ? ' · ' + esc(t.meerInfoTelefoon) : '') + '</p>'
          : (t.meerInfoTelefoon ? '<p>Contact producent: ' + esc(t.meerInfoTelefoon) + '</p>' : '')) +
        '<div class="meta">' + meta.join(' · ') + '</div>' +
        '</div>';
    }).join('');

    return html;
  }

  function gebrekenHtml(r) {
    if (!r.gebreken || !r.gebreken.length) return '';
    return '<div class="kaart"><h2>Gebreken bij de laatste keuring</h2>' +
      '<p class="bron-noot">Gemeld op ' + esc(r.gebreken[0].gemeldOp || 'onbekende datum') + ' door de keuringsinstantie.</p>' +
      '<div class="tabel-wrap"><table class="kw"><thead><tr><th>Gebrek</th><th>Code</th><th>Aantal</th></tr></thead><tbody>' +
      r.gebreken.map(function (g) {
        return '<tr><td>' + esc(g.omschrijving) + '</td><td><code>' + esc(g.code) + '</code></td><td>' + esc(g.aantal) + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>';
  }

  function conversieBlok(r) {
    var dringend = r.openstaandeTerugroepactie ||
      (r.apk.status && (r.apk.status.code === 'verlopen' || r.apk.status.code === 'bijna_verlopen'));
    var kop = dringend
      ? 'Wil je hier automatisch bericht over krijgen?'
      : 'Dit blijft niet vanzelf zo';
    var tekst = dringend
      ? 'Kentekenwacht controleert dit kenteken elke dag en mailt je zodra er iets verandert — een nieuwe terugroepactie, een naderende APK of een gewijzigde verzekeringsstatus.'
      : 'Een APK verloopt en terugroepacties komen onaangekondigd. Kentekenwacht controleert dit kenteken elke dag en waarschuwt je per e-mail, ruim op tijd.';

    return '<div class="kaart" style="border-color:var(--accent)">' +
      '<h2>' + esc(kop) + '</h2>' +
      '<p class="prose">' + esc(tekst) + '</p>' +
      '<p><a class="knop" href="/wacht/?kenteken=' + esc(r.kenteken) + '">Zet dit kenteken onder bewaking</a></p>' +
      '<p class="bron-noot">Vanaf € 4,50 per jaar per kenteken. Opzeggen kan altijd.</p>' +
      '</div>';
  }

  function render(r) {
    var v = r.voertuig || {};
    var b = (r.brandstof || [])[0] || {};
    var titel = [v.merk, v.handelsbenaming].filter(Boolean).join(' ') || 'Voertuig';

    var html = '';
    html += '<h2 class="sectie">' + esc(titel) +
      ' <span class="badge">' + esc(metStreepjes(r.kenteken)) + '</span></h2>';

    html += apkBanner(r);
    html += recallsHtml(r);

    html += '<div class="kaart"><h2>Voertuiggegevens</h2>' + rijenHtml([
      ['Merk', v.merk],
      ['Model', v.handelsbenaming],
      ['Soort', v.voertuigsoort],
      ['Inrichting', v.inrichting],
      ['Kleur', v.kleur],
      ['Bouwjaar', v.bouwjaar],
      ['Eerste toelating', v.datumEersteToelating],
      ['Op naam sinds', v.datumTenaamstelling],
      ['Brandstof', b.omschrijving],
      ['Emissieklasse', b.emissiecode],
      ['Cilinderinhoud', v.cilinderinhoud ? getal(v.cilinderinhoud) + ' cm³' : null],
      ['Vermogen', b.nettomaximumvermogen ? getal(b.nettomaximumvermogen) + ' kW' : null],
      ['Massa leeg', v.massaLedig ? getal(v.massaLedig) + ' kg' : null],
      ['Massa rijklaar', v.massaRijklaar ? getal(v.massaRijklaar) + ' kg' : null],
      ['Zitplaatsen', v.aantalZitplaatsen],
      ['Deuren', v.aantalDeuren],
      ['Catalogusprijs', euro(v.catalogusprijs)],
      ['WAM-verzekerd', v.wamVerzekerd === null ? null : (v.wamVerzekerd ? 'Ja' : 'Nee')],
      ['Tellerstandoordeel', v.tellerstandoordeel],
      ['Geëxporteerd', v.exportIndicator === null ? null : (v.exportIndicator ? 'Ja' : 'Nee')],
      ['Voertuigcategorie', v.europeseVoertuigcategorie]
    ]) + '<p class="bron-noot">Bron: RDW Open Data. Opgehaald op ' +
      esc(new Date(r.opgehaaldOp).toLocaleString('nl-NL')) + '.</p></div>';

    if (v.wamVerzekerd === false) {
      html = html.replace('<div class="kaart"><h2>Voertuiggegevens',
        '<div class="status let-op"><span class="ikoon">⚠️</span><div><strong>Niet WAM-verzekerd</strong>' +
        '<p>Volgens het register is dit voertuig niet verzekerd. Dat mag alleen als het geschorst is of buiten gebruik staat.</p>' +
        '</div></div><div class="kaart"><h2>Voertuiggegevens');
    }

    html += gebrekenHtml(r);
    html += conversieBlok(r);

    uitvoer.innerHTML = html;
    uitvoer.classList.remove('verborgen');
    if (history.replaceState) {
      history.replaceState(null, '', '?kenteken=' + encodeURIComponent(r.kenteken));
    }
    document.title = titel + ' ' + metStreepjes(r.kenteken) + ' — APK en terugroepacties | Kentekenwacht';
  }

  function toonFout(bericht) {
    uitvoer.innerHTML = '<div class="status let-op"><span class="ikoon">⚠️</span><div>' +
      '<strong>Geen resultaat</strong><p>' + esc(bericht) + '</p></div></div>';
    uitvoer.classList.remove('verborgen');
  }

  /* ---------- ophalen ---------- */

  var bezig = false;

  function zoek(kentekenRuw) {
    var k = normaliseer(kentekenRuw);
    if (k.length !== 6) {
      toonFout('Een Nederlands kenteken bestaat uit zes tekens, bijvoorbeeld 12-ABC-3.');
      return;
    }
    if (bezig) return;
    bezig = true;
    knop.disabled = true;
    var origineel = knop.innerHTML;
    knop.innerHTML = '<span class="laden"></span>';
    uitvoer.classList.remove('verborgen');
    uitvoer.innerHTML = '<div class="status neutraal"><span class="ikoon">🔎</span><div>' +
      '<strong>Gegevens ophalen…</strong><p>We raadplegen vijf RDW-registers.</p></div></div>';

    fetch('/api/lookup?kenteken=' + encodeURIComponent(k), { headers: { Accept: 'application/json' } })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok) { toonFout(r.data && r.data.bericht ? r.data.bericht : 'Er ging iets mis.'); return; }
        render(r.data);
      })
      .catch(function () {
        toonFout('De verbinding met de server mislukte. Controleer je internetverbinding en probeer het opnieuw.');
      })
      .finally(function () {
        bezig = false;
        knop.disabled = false;
        knop.innerHTML = origineel;
      });
  }

  /* ---------- koppelen ---------- */

  invoer.addEventListener('input', function () {
    var pos = invoer.selectionStart;
    var voor = invoer.value;
    invoer.value = normaliseer(voor);
    if (invoer.value.length === voor.length) {
      try { invoer.setSelectionRange(pos, pos); } catch (e) { /* leeg */ }
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    zoek(invoer.value);
  });

  // Diep linken: /?kenteken=12ABC3 voert de zoekopdracht meteen uit.
  var uitUrl = new URLSearchParams(location.search).get('kenteken');
  if (uitUrl) {
    invoer.value = normaliseer(uitUrl);
    zoek(uitUrl);
  }
})();
