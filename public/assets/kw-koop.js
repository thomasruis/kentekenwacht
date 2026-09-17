/* Koopstroom op /wacht/ — e-mail en kentekens verzamelen, dan door naar Stripe. */
(function () {
  'use strict';

  var LIMIET = { particulier: 3, zakelijk: 50 };
  var paneel = null;

  function el(tag, attrs, kinderen) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kinderen || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function normaliseer(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  function bouwPaneel(plan) {
    var max = plan === 'zakelijk' ? 5 : LIMIET.particulier; // zakelijk: rest via beheer
    var wrap = el('div', { class: 'kaart', id: 'kw-koop-paneel', style: 'border-color:var(--accent);scroll-margin-top:80px' });

    wrap.appendChild(el('h2', {
      text: plan === 'zakelijk' ? 'Wagenparkbewaking starten' : 'Bewaking starten'
    }));
    wrap.appendChild(el('p', {
      class: 'prose',
      text: plan === 'zakelijk'
        ? 'Vul je e-mailadres in en de eerste kentekens. De rest voeg je na de betaling toe via je beheerpagina.'
        : 'Vul je e-mailadres in en de kentekens die je wilt laten bewaken.'
    }));

    var emailRij = el('div', { style: 'margin-bottom:16px' });
    emailRij.appendChild(el('label', {
      for: 'kw-email', text: 'E-mailadres',
      style: 'display:block;font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--tekst-zwak);margin-bottom:6px'
    }));
    var email = el('input', {
      id: 'kw-email', type: 'email', required: 'required',
      autocomplete: 'email', placeholder: 'jij@voorbeeld.nl',
      style: 'width:100%;max-width:360px;padding:12px 14px;border:1px solid var(--rand-sterk);border-radius:9px;background:var(--bg-kaart);color:var(--tekst);font:400 1rem var(--font)'
    });
    emailRij.appendChild(email);
    wrap.appendChild(emailRij);

    wrap.appendChild(el('div', {
      html: '<div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--tekst-zwak);margin-bottom:8px">Kenteken' + (max > 1 ? 's' : '') + '</div>'
    }));

    var platen = el('div', { id: 'kw-platen', style: 'display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px' });
    for (var i = 0; i < max; i++) {
      var label = el('label', { class: 'kw-plaat-veld', style: 'transform:scale(.86);transform-origin:left center' });
      label.innerHTML = '<span class="kw-plaat-nl" aria-hidden="true"><span aria-hidden="true">★</span>NL</span>';
      var inp = el('input', {
        type: 'text', maxlength: '8', spellcheck: 'false',
        placeholder: 'XX-999-X', 'aria-label': 'Kenteken ' + (i + 1),
        class: 'kw-koop-kenteken'
      });
      inp.addEventListener('input', function () { this.value = normaliseer(this.value); });
      label.appendChild(inp);
      platen.appendChild(label);
    }
    wrap.appendChild(platen);

    var fout = el('div', { id: 'kw-koop-fout', class: 'status alarm verborgen' });
    wrap.appendChild(fout);

    var knop = el('button', { class: 'knop', type: 'button', text: 'Doorgaan naar betalen' });
    knop.addEventListener('click', function () { verstuur(plan, email, knop, fout); });
    wrap.appendChild(knop);

    wrap.appendChild(el('p', {
      class: 'bron-noot',
      text: 'Betalen met iDEAL of creditcard via Stripe. Je gegevens gebruiken we alleen voor deze meldingen.'
    }));

    return wrap;
  }

  function toonFout(vak, bericht) {
    vak.innerHTML = '<span class="ikoon">⚠️</span><div><p>' + bericht + '</p></div>';
    vak.classList.remove('verborgen');
  }

  function verstuur(plan, emailVeld, knop, foutVak) {
    foutVak.classList.add('verborgen');

    var email = (emailVeld.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      toonFout(foutVak, 'Vul een geldig e-mailadres in.');
      emailVeld.focus();
      return;
    }

    var kentekens = [].slice.call(document.querySelectorAll('.kw-koop-kenteken'))
      .map(function (i) { return normaliseer(i.value); })
      .filter(function (k) { return k.length === 6; });

    if (!kentekens.length) {
      toonFout(foutVak, 'Vul minstens één volledig kenteken in (zes tekens).');
      return;
    }

    knop.disabled = true;
    var origineel = knop.textContent;
    knop.innerHTML = '<span class="laden"></span>';

    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, kentekens: kentekens, plan: plan })
    })
      .then(function (res) {
        return res.json().then(function (d) { return { ok: res.ok, data: d }; });
      })
      .then(function (r) {
        if (r.ok && r.data.url) { window.location.href = r.data.url; return; }
        toonFout(foutVak, (r.data && r.data.bericht) || 'Er ging iets mis. Probeer het opnieuw.');
        knop.disabled = false;
        knop.textContent = origineel;
      })
      .catch(function () {
        toonFout(foutVak, 'Geen verbinding met de server. Probeer het opnieuw.');
        knop.disabled = false;
        knop.textContent = origineel;
      });
  }

  function open(plan) {
    if (paneel) paneel.remove();
    paneel = bouwPaneel(plan);
    var rij = document.querySelector('.prijs-rij');
    rij.parentNode.insertBefore(paneel, rij.nextSibling);
    paneel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var e = document.getElementById('kw-email');
    if (e) setTimeout(function () { e.focus(); }, 320);
  }

  ['particulier', 'zakelijk'].forEach(function (plan) {
    var knop = document.getElementById('kw-koop-' + plan);
    if (knop) {
      knop.addEventListener('click', function (ev) { ev.preventDefault(); open(plan); });
    }
  });

  // Kenteken uit /wacht/?kenteken=12ABC3 meteen invullen.
  var vooraf = new URLSearchParams(location.search).get('kenteken');
  if (vooraf) {
    open('particulier');
    var eerste = document.querySelector('.kw-koop-kenteken');
    if (eerste) eerste.value = normaliseer(vooraf);
  }
})();
