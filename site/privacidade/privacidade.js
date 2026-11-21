(function () {
  'use strict';
  var msg = document.getElementById('pv-msg');
  function req(metodo, url, corpo) {
    var init = { method: metodo, headers: { 'X-Requested-With': 'tlh' }, credentials: 'same-origin', cache: 'no-store' };
    if (corpo) { init.body = JSON.stringify(corpo); init.headers['Content-Type'] = 'application/json'; }
    return fetch(url, init).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: {} }; }); },
      function () { return { ok: false, status: 0, j: {} }; });
  }
  document.getElementById('pv-apagar').onsubmit = function (ev) {
    ev.preventDefault();
    var wa = document.getElementById('pv-wa').value.trim(), nome = document.getElementById('pv-nome').value.trim();
    if (!wa) { msg.textContent = 'Informe o WhatsApp.'; return; }
    req('POST', '/api/privacidade/apagar', { whatsapp: wa, nome: nome }).then(function (r) {
      if (r.status === 429) msg.textContent = 'Muitas tentativas. Tente de novo mais tarde.';
      else if (r.status === 400) msg.textContent = 'Confira o WhatsApp (com DDD).';
      else if (!r.ok) msg.textContent = 'Não foi possível agora. Tente de novo.';
      else if (r.j.apagado) msg.textContent = 'Pronto: seus dados foram apagados.';
      else if (r.j.confirmado) msg.textContent = 'Não há dados seus guardados.';
      else msg.textContent = 'Não conseguimos confirmar que o nome e o WhatsApp são seus. Escreva o nome como entrou no site, ou fale com o corretor pelo WhatsApp do site.';
    });
  };
  // WhatsApp do corretor (o número salvo no painel), para os pedidos que o formulário não resolve
  req('GET', '/api/estado').then(function (r) {
    var n = r.ok && r.j && r.j.whatsapp_numero, a = document.getElementById('pv-wa-link'), f = document.getElementById('pv-wa-fala');
    if (!a || !/^55\d{10,11}$/.test(n || '')) return;
    a.href = 'https://wa.me/' + n; a.textContent = ' +' + n.slice(0, 2) + ' ' + n.slice(2, 4) + ' ' + n.slice(4, -4) + '-' + n.slice(-4);
    a.hidden = false; if (f) f.hidden = true;
  });
  document.getElementById('pv-ver').onclick = function () {
    var pre = document.getElementById('pv-dados');
    req('GET', '/api/privacidade/meus-dados').then(function (r) {
      pre.hidden = false;
      pre.textContent = r.ok ? JSON.stringify(r.j, null, 2) : r.status === 401 ? 'Para ver os dados, entre no site neste aparelho e volte aqui.' : 'Não foi possível agora.';
    });
  };
})();
