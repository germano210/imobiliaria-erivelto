/* Ponte entre o site/painel e a API (servidor/). Sem servidor, nada aqui roda: a página segue em modo prévia (localStorage). */
(function () {
  'use strict';
  var P = window.PONTE = { srv: false, pagina: window.__PAGINA || 'site', g: null };
  var ESTADO = null, REV = 0, FILA = Promise.resolve(), TM = null, PEND = 0, ERRO = '', ULT = null, BLOQ = false, AGENDADO = false;

  /* ---------- utilidades ---------- */
  function req(metodo, url, corpo) {
    var h = { 'X-Requested-With': 'tlh' }, init = { method: metodo, headers: h, credentials: 'same-origin', cache: 'no-store' };
    if (corpo !== undefined) {
      if (typeof Blob !== 'undefined' && corpo instanceof Blob) { init.body = corpo; h['Content-Type'] = corpo.type || 'application/octet-stream'; }
      else { init.body = JSON.stringify(corpo); h['Content-Type'] = 'application/json'; }
    }
    return fetch(url, init).then(function (r) {
      return r.json().then(function (j) { return j; }, function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    }, function () { return { ok: false, status: 0, j: { erro: 'rede' } }; });
  }
  P.req = req;
  function el(tag, attrs, filhos) {
    var e = document.createElement(tag), k;
    if (attrs) for (k in attrs) { if (k === 'texto') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (filhos || []).forEach(function (f) { e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return e;
  }
  function css() {
    if (document.getElementById('ponte-css')) return;
    var l = el('link', { id: 'ponte-css', rel: 'stylesheet', href: 'ponte.css' });
    document.head.appendChild(l);
  }
  function detectar() {
    return new Promise(function (res) {
      var ctl = window.AbortController ? new AbortController() : null;
      var tm = setTimeout(function () { if (ctl) ctl.abort(); res(false); }, 1500);
      try {
        fetch('api/saude', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { clearTimeout(tm); res(!!(j && j.ok && j.servico === 'erivelto')); }, function () { clearTimeout(tm); res(false); });
      } catch (e) { clearTimeout(tm); res(false); }
    });
  }
  function aviso(msg, tipo) {
    var a = document.getElementById('pt-aviso');
    if (a) a.remove();
    a = el('div', { id: 'pt-aviso', role: tipo === 'erro' ? 'alert' : 'status', class: 'pt-aviso' + (tipo === 'erro' ? ' erro' : ''), texto: msg });
    document.body.appendChild(a);
    setTimeout(function () { if (a.parentNode) a.remove(); }, 6000);
  }
  P.aviso = aviso;
  function telaErro(msg) {
    var d = el('div', { class: 'pt-tela', role: 'alert' }, [el('div', { class: 'pt-cartao' }, [
      el('p', { texto: msg }), (function () { var b = el('button', { type: 'button', class: 'pt-btn', texto: 'Tentar de novo' }); b.onclick = function () { location.reload(); }; return b; })()])]);
    document.body.appendChild(d);
  }
  function iniciar() { if (window.__PONTE_INICIAR) window.__PONTE_INICIAR(); }

  /* ---------- fila de envios que podem falhar sem travar nada (chamadas e leads) ---------- */
  var CHAVE_FILA = 'erivelto_fila';
  function lerFila() { try { var a = JSON.parse(localStorage.getItem(CHAVE_FILA) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function gravarFila(a) { try { if (a.length) localStorage.setItem(CHAVE_FILA, JSON.stringify(a.slice(-30))); else localStorage.removeItem(CHAVE_FILA); } catch (e) { /* sem storage: segue */ } }
  var voando = false;
  function esvaziarFila() {
    if (voando) return; var a = lerFila(); if (!a.length) return; voando = true;
    var item = a[0];
    req('POST', item.url, item.corpo).then(function (r) {
      var f = lerFila();
      if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 401)) f.shift();
      else { f[0].n = (f[0].n || 0) + 1; if (f[0].n > 8) f.shift(); }
      gravarFila(f); voando = false;
      if (r.ok || (f.length && r.status !== 0)) setTimeout(esvaziarFila, 300);
    });
  }
  function enviarComReenvio(url, corpo) {
    var f = lerFila(); f.push({ url: url, corpo: corpo, n: 0 }); gravarFila(f); esvaziarFila();
  }
  window.addEventListener('online', esvaziarFila);

  /* ---------- SITE ---------- */
  var AVISO_VERSAO = 'v2'; // a mesma de site/privacidade/index.html e do padrão de ERV_AVISO_VERSAO no servidor
  P.estadoSite = function (est) {
    est = est || ESTADO;
    return {
      v: 3, tipos: est.tipos, exemplo: false, m20: 1, leads: [], chamadas: [], mapa: est.mapa, mapa_pub: est.mapa,
      imoveis: (est.imoveis || []).map(function (p) { var o = JSON.parse(JSON.stringify(p)); o.pub = JSON.parse(JSON.stringify(p)); return o; }),
    };
  };
  P.contaInicial = function () { var c = ESTADO && ESTADO.conta; return c && c.nome && c.wa ? { nome: c.nome, wa: c.wa, em: Date.now() } : null; };
  P.ligar = function (g) { P.g = g; };
  P.htmlAceite = function () {
    return '<label class="ak12"><input type="checkbox" class="uk12"><span>Li e aceito o <a href="privacidade" target="_blank" rel="noopener">aviso de privacidade</a></span></label>';
  };
  function msgConta(r) {
    if (r.status === 429) return 'Muitas tentativas. Tente de novo em alguns minutos.';
    if (r.status === 400 && r.j && r.j.campo === 'whatsapp') return 'Confira o WhatsApp (com DDD).';
    if (r.status === 400 && r.j && r.j.campo === 'nome') return 'Confira o nome.';
    if (r.status === 400 && r.j && r.j.erro === 'aceite_obrigatorio') return 'Marque que leu o aviso de privacidade.';
    return 'Não consegui salvar agora. Tente de novo.';
  }
  P.entrar = function (nome, wa) {
    return req('POST', 'api/contas', { nome: nome, whatsapp: wa, aceite: true, versao_aviso: AVISO_VERSAO }).then(function (r) {
      if (!r.ok) return { ok: false, erro: msgConta(r) };
      return req('GET', 'api/estado').then(function (e) {
        if (e.ok) { ESTADO = e.j; if (P.g && P.g.refresh) P.g.refresh(P.estadoSite(e.j)); }
        return { ok: true };
      });
    });
  };
  P.sair = function () {
    req('POST', 'api/contas/sair', {}).then(function () {
      return req('GET', 'api/estado');
    }).then(function (e) { if (e && e.ok) { ESTADO = e.j; if (P.g && P.g.refresh) P.g.refresh(P.estadoSite(e.j)); } });
  };
  P.lead = function (d) {
    enviarComReenvio('api/leads', { via: d.via, imovel_id: d.id || undefined, imovel: d.imovel || undefined, cidade: d.cidade || undefined });
  };
  P.chamada = function (t) { enviarComReenvio('api/chamadas', { id: t.id, nm: t.nm, o: t.o }); };

  // T05: CRECI e link legal sempre à vista na busca e nos resultados. Some na ficha do imóvel (classe "f5"), que tem botões embaixo.
  function rodape() {
    if (document.getElementById('pt-rodape')) return;
    var r = el('div', { id: 'pt-rodape', class: 'pt-rodape' }, [
      el('span', { texto: 'Erivelto Santos \u00b7 Corretor de imóveis \u00b7 CRECI 63.464 \u00b7 ' }), el('a', { href: 'privacidade/', texto: 'Privacidade' })]);
    document.body.appendChild(r);
    var sc = document.querySelector('.sc12');
    function ver() { r.hidden = !!(sc && sc.classList.contains('f5')); }
    if (sc && window.MutationObserver) new MutationObserver(ver).observe(sc, { attributes: true, attributeFilter: ['class'] });
    ver();
  }
  function iniciarSite() {
    return req('GET', 'api/estado').then(function (r) {
      if (!r.ok) { telaErro('Não consegui carregar os imóveis agora.'); return; }
      ESTADO = r.j; P.srv = true;
      try { window.SITE11.PLANO = ESTADO.plano; window.SITE11.WHATSAPP = !!ESTADO.whatsapp; window.SITE11.AVISO = false; } catch (e) { /* segue */ }
      css();
      // T23: sem número salvo no painel, o botão do WhatsApp não abre conversa nenhuma (nem conta como chamada): só avisa.
      if (!P.waSite()) document.addEventListener('click', function (ev) {
        var a = ev.target.closest && ev.target.closest('a[href^="https://wa.me/"]'); if (!a) return;
        ev.preventDefault(); ev.stopImmediatePropagation(); aviso('O WhatsApp do corretor ainda não está disponível aqui.');
      }, true);
      iniciar(); rodape(); esvaziarFila();
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') esvaziarFila(); });
    });
  }

  /* ---------- PAINEL ---------- */
  function mensagemLogin(r) {
    if (r.status === 429) { var min = Math.max(1, Math.ceil(((r.j && r.j.espera) || 60) / 60)); return 'Muitas tentativas. Tente de novo em ' + min + ' min.'; }
    if (r.status === 401) return 'E-mail ou senha incorretos.';
    if (r.status === 0) return 'Sem conexão com o servidor.';
    return 'Não foi possível entrar agora.';
  }
  function campo(rotulo, id, tipo, auto) {
    var i = el('input', { id: id, type: tipo, autocomplete: auto, class: 'pt-in', required: 'required' });
    return { rotulo: el('label', { for: id, class: 'pt-lb', texto: rotulo }), input: i };
  }
  function telaLogin() {
    return new Promise(function (res) {
      css();
      var em = campo('E-mail', 'pt-email', 'email', 'username'), se = campo('Senha', 'pt-senha', 'password', 'current-password');
      var msg = el('p', { class: 'pt-msg', role: 'alert' });
      var btn = el('button', { type: 'submit', class: 'pt-btn pri', texto: 'Entrar' });
      var f = el('form', { class: 'pt-cartao', novalidate: 'novalidate' }, [
        el('h1', { class: 'pt-t', texto: 'Painel do Erivelto' }), em.rotulo, em.input, se.rotulo, se.input, msg, btn]);
      var tela = el('div', { class: 'pt-tela', id: 'pt-login' }, [f]);
      f.onsubmit = function (ev) {
        ev.preventDefault(); msg.textContent = '';
        if (!em.input.value.trim() || !se.input.value) { msg.textContent = 'Preencha o e-mail e a senha.'; return; }
        btn.disabled = true;
        req('POST', 'api/painel/entrar', { email: em.input.value.trim(), senha: se.input.value }).then(function (r) {
          btn.disabled = false;
          if (r.ok) { se.input.value = ''; tela.remove(); res(r.j); } else { msg.textContent = mensagemLogin(r); se.input.value = ''; se.input.focus(); }
        });
      };
      document.body.appendChild(tela);
      em.input.focus();
    });
  }
  function telaTroca(obrigatoria) {
    return new Promise(function (res) {
      css();
      var at = campo('Senha atual', 'pt-atual', 'password', 'current-password'), nv = campo('Senha nova (mínimo 10 caracteres)', 'pt-nova', 'password', 'new-password'), rp = campo('Repita a senha nova', 'pt-rep', 'password', 'new-password');
      var msg = el('p', { class: 'pt-msg', role: 'alert' });
      var btn = el('button', { type: 'submit', class: 'pt-btn pri', texto: 'Trocar a senha' });
      var filhos = [el('h1', { class: 'pt-t', texto: obrigatoria ? 'Escolha a sua senha' : 'Trocar a senha' }),
        el('p', { class: 'pt-p', texto: obrigatoria ? 'A senha inicial só vale para o primeiro acesso.' : '' }),
        at.rotulo, at.input, nv.rotulo, nv.input, rp.rotulo, rp.input, msg, btn];
      if (!obrigatoria) { var c = el('button', { type: 'button', class: 'pt-btn', texto: 'Cancelar' }); c.onclick = function () { tela.remove(); res(false); }; filhos.push(c); }
      var f = el('form', { class: 'pt-cartao', novalidate: 'novalidate' }, filhos);
      var tela = el('div', { class: 'pt-tela', id: 'pt-troca' }, [f]);
      f.onsubmit = function (ev) {
        ev.preventDefault(); msg.textContent = '';
        if (nv.input.value.length < 10) { msg.textContent = 'A senha nova precisa de pelo menos 10 caracteres.'; return; }
        if (nv.input.value !== rp.input.value) { msg.textContent = 'As duas senhas novas não são iguais.'; return; }
        btn.disabled = true;
        req('POST', 'api/painel/senha', { atual: at.input.value, nova: nv.input.value }).then(function (r) {
          btn.disabled = false;
          if (r.ok) { tela.remove(); aviso('Senha trocada.'); res(true); return; }
          msg.textContent = r.status === 403 ? 'A senha atual não confere.' : r.status === 429 ? 'Muitas tentativas. Espere um pouco.' : r.j && r.j.erro === 'senha_fraca' ? 'Escolha uma senha diferente da atual.' : 'Não foi possível trocar agora.';
        });
      };
      document.body.appendChild(tela);
      at.input.focus();
    });
  }
  // T24: termo do painel no 1º acesso. O texto vem de painel/termo.html; o aceite vai com a versão que está na tela.
  function sairPainel() { return req('POST', 'api/painel/sair', {}).then(function () { location.reload(); }); }
  function telaTermo(versao) {
    return new Promise(function (res) {
      css();
      var texto = el('div', { class: 'pt-termo', id: 'pt-termo-corpo', tabindex: '0', texto: 'Carregando o termo…' });
      var chk = el('input', { type: 'checkbox', id: 'pt-termo-ok', disabled: 'disabled' });
      var msg = el('p', { class: 'pt-msg', role: 'alert' });
      var btn = el('button', { type: 'submit', class: 'pt-btn pri', id: 'pt-termo-aceitar', disabled: 'disabled', texto: 'Aceitar e continuar' });
      var sair = el('button', { type: 'button', class: 'pt-btn', id: 'pt-termo-sair', texto: 'Sair sem aceitar' });
      var f = el('form', { class: 'pt-cartao pt-largo', novalidate: 'novalidate' }, [
        el('h1', { class: 'pt-t', texto: 'Termo de uso do painel' }),
        el('p', { class: 'pt-p', texto: 'Leia e aceite para usar o painel.' }), texto,
        el('label', { class: 'pt-chk', for: 'pt-termo-ok' }, [chk, el('span', { texto: 'Li e aceito o termo (versão ' + versao + ').' })]), msg, btn, sair]);
      var tela = el('div', { class: 'pt-tela', id: 'pt-termo' }, [f]);
      chk.onchange = function () { btn.disabled = !chk.checked; };
      sair.onclick = function () { sair.disabled = true; sairPainel(); };
      f.onsubmit = function (ev) {
        ev.preventDefault(); if (!chk.checked) return;
        btn.disabled = true; msg.textContent = '';
        req('POST', 'api/painel/termo/aceitar', { aceite: true, versao: versao }).then(function (r) {
          if (r.ok) { tela.remove(); res(true); return; }
          btn.disabled = false;
          msg.textContent = r.status === 401 ? 'A sessão terminou. Recarregue a página e entre de novo.' : r.status === 400 ? 'O termo mudou. Recarregue a página para ler a versão nova.' : 'Não foi possível registrar agora. Tente de novo.';
        });
      };
      document.body.appendChild(tela);
      fetch('painel/termo.html', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (h) {
        var t = h && new DOMParser().parseFromString(h, 'text/html').getElementById('pt-termo-texto');
        // só libera o aceite se o texto na tela for o da versão que o servidor pede
        if (!t || t.getAttribute('data-versao') !== versao) { texto.textContent = 'Não consegui carregar o termo desta versão. Recarregue a página; se continuar, fale com a Loud House.'; return; }
        texto.innerHTML = t.innerHTML; chk.disabled = false; chk.focus();
      }, function () { texto.textContent = 'Não consegui carregar o termo. Recarregue a página.'; });
    });
  }
  // Conta (aba Perfil do painel): WhatsApp do site, trocar senha e sair. O painel/c.js só chama P.contaHtml(); os toques chegam aqui.
  var EMAIL = '';
  function waBonito(n) { return n ? '+' + n.slice(0, 2) + ' ' + n.slice(2, 4) + ' ' + n.slice(4, 9) + '-' + n.slice(9) : ''; }
  P.contaHtml = function () {
    var n = P.waSite(), ch = (ref && ref.d && ref.d.chamadas) || [];
    return '<div class="sec" id="pt-conta"><div class="t">Conta</div>' + (EMAIL ? '<span class="sub">' + attr(EMAIL) + '</span>' : '') +
      '<button class="lin" data-pt="wa"><span class="v">WhatsApp do site<br><span class="sub" id="pt-conta-wa">' + (n ? waBonito(n) : 'Ainda sem número: o botão do site não abre conversa') + '</span></span><span class="ch">›</span></button>' +
      '<div class="dica" id="pt-conta-toques">Toques no botão do WhatsApp do site: ' + ch.length + '</div>' +
      '<button class="lin" data-pt="senha"><span class="v">Trocar senha</span><span class="ch">›</span></button>' +
      '<button class="lin" data-pt="sair"><span class="v">Sair</span></button>' +
      '<div class="dica"><a href="painel/termo.html" target="_blank" rel="noopener">Termo de uso do painel</a> · <a href="privacidade/" target="_blank" rel="noopener">Aviso de privacidade do site</a></div></div>';
  };
  function redesenharPerfil() { var t = document.querySelector('#c-app [data-tab="perfil"][aria-current="page"]'); if (t) t.click(); }
  function telaWa() {
    css();
    var inp = el('input', { id: 'ep34w', class: 'pt-in', type: 'tel', inputmode: 'tel', autocomplete: 'off', maxlength: '19', 'aria-label': 'WhatsApp do site', 'aria-describedby': 'ep34m', value: waFmt(P.waSite().slice(2)) });
    var lk = el('a', { id: 'ep34l', class: 'pt-p', target: '_blank', rel: 'noopener noreferrer' }), msg = el('p', { id: 'ep34m', class: 'pt-p', 'aria-live': 'polite' });
    var btn = el('button', { type: 'button', class: 'pt-btn pri', id: 'ep34s', disabled: 'disabled', texto: 'Salvar' }), fe = el('button', { type: 'button', class: 'pt-btn', id: 'pt-wa-fechar', texto: 'Fechar' });
    var tela = el('div', { class: 'pt-tela', id: 'pt-wa', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pt-wa-t' }, [el('div', { class: 'pt-cartao' }, [
      el('h1', { class: 'pt-t', id: 'pt-wa-t', texto: 'WhatsApp do site' }), el('p', { class: 'pt-p', texto: 'O botão do site abre a conversa com este número.' }), inp, lk, msg, btn, fe])]);
    fe.onclick = function () { tela.remove(); redesenharPerfil(); };
    document.body.appendChild(tela); P.waLigar(tela); inp.focus();
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#pt-conta [data-pt]'); if (!b || !P.srv) return;
    var a = b.getAttribute('data-pt');
    if (a === 'wa') telaWa();
    else if (a === 'senha') telaTroca(false);
    else if (a === 'sair') { b.disabled = true; flush().then(sairPainel); }
  });
  function barra(email) {
    EMAIL = email;
    var b = el('div', { class: 'pt-barra', id: 'pt-barra' });
    var t = el('button', { type: 'button', class: 'pt-link', texto: 'Trocar senha' });
    t.onclick = function () { m.removeAttribute('open'); telaTroca(false); };
    var s = el('button', { type: 'button', class: 'pt-link', texto: 'Sair', id: 'pt-sair' });
    s.onclick = function () { flush().then(sairPainel); };
    var m = el('details', { class: 'pt-mn' }, [el('summary', { 'aria-label': 'Conta', texto: '\u22ef' }), el('div', { class: 'pt-mm' }, [t, s])]);
    b.appendChild(el('span', { class: 'pt-em', texto: email })); b.appendChild(m);
    document.body.insertBefore(b, document.body.firstChild);
  }
  function carregarContatos() {
    return Promise.all([req('GET', 'api/painel/leads'), req('GET', 'api/painel/chamadas')]).then(function (a) {
      return { leads: a[0].ok ? a[0].j.leads : null, chamadas: a[1].ok ? a[1].j.chamadas : null };
    });
  }
  P.estadoPainel = function () {
    var e = JSON.parse(JSON.stringify(ESTADO));
    e.leads = e.leads || []; e.chamadas = e.chamadas || []; e.m20 = 1;
    return e;
  };

  var ref = null;
  P.ligarPainel = function (g) {
    P.g = g; ref = g;
    var d = g.d;
    ULT = { im: {}, tipos: JSON.stringify(d.tipos), mapa: JSON.stringify(d.mapa) };
    d.imoveis.forEach(function (i) { ULT.im[i.id] = JSON.stringify(rasc(i)); });
    setInterval(function () { if (document.visibilityState === 'visible' && !BLOQ) atualizarContatos(); }, 20000);
  };
  function rasc(i) { var o = JSON.parse(JSON.stringify(i)); delete o.pub; return o; }
  function atualizarContatos() {
    carregarContatos().then(function (c) {
      if (!ref) return; var d = ref.d, mudou = false;
      if (c.leads && JSON.stringify(c.leads) !== JSON.stringify(d.leads)) { d.leads.length = 0; c.leads.forEach(function (x) { d.leads.push(x); }); mudou = true; }
      if (c.chamadas && JSON.stringify(c.chamadas) !== JSON.stringify(d.chamadas)) { d.chamadas.length = 0; c.chamadas.forEach(function (x) { d.chamadas.push(x); }); mudou = true; }
      if (mudou && ref.notify) ref.notify();
    });
  }
  function marca(s, texto) {
    var o = document.querySelector('.ep1-sv'); if (!o) return;
    o.dataset.s = s; var sp = o.querySelector('span'); if (sp) sp.textContent = texto;
  }
  function hora() { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  P.estadoMarca = function (a) { if (a === 'ok' && (PEND > 0 || AGENDADO)) return 'ing'; if (a === 'ok' && ERRO) return null; return a; };
  function fila(fn) { PEND++; var p = FILA.then(fn, fn).then(function (v) { PEND--; return v; }, function (e) { PEND--; throw e; }); FILA = p.catch(function () {}); return p; }

  function enviarMudancas() {
    if (BLOQ || !ref) return Promise.resolve();
    var d = ref.d, lista = [], vistos = {};
    d.imoveis.forEach(function (i) { var s = JSON.stringify(rasc(i)); vistos[i.id] = 1; if (ULT.im[i.id] !== s) lista.push({ id: i.id, s: s, o: JSON.parse(s) }); });
    var tp = JSON.stringify(d.tipos), mp = JSON.stringify(d.mapa), passos = Promise.resolve({ ok: true });
    if (lista.length || tp !== ULT.tipos) {
      var corpo = { rev: REV, imoveis: lista.map(function (x) { return x.o; }) };
      if (tp !== ULT.tipos) corpo.tipos = d.tipos;
      passos = req('PUT', 'api/painel/estado', corpo).then(function (r) {
        if (r.ok) { REV = r.j.rev; lista.forEach(function (x) { ULT.im[x.id] = x.s; }); ULT.tipos = tp; }
        return r;
      });
    }
    return passos.then(function (r) {
      if (!r.ok) return r;
      if (mp === ULT.mapa || !d.mapa) return r;
      return req('PUT', 'api/painel/mapa', { rev: REV, mapa: d.mapa }).then(function (r2) { if (r2.ok) { REV = r2.j.rev; ULT.mapa = mp; } return r2; });
    }).then(function (r) { return tratarSalvo(r); });
  }
  var tentativas = 0;
  function tratarSalvo(r) {
    if (r.ok) { tentativas = 0; ERRO = ''; if (PEND <= 1 && !AGENDADO) marca('ok', 'Salvo · ' + hora()); return r; }
    if (r.status === 409) { BLOQ = true; ERRO = 'conflito'; marca('err', 'Mudou em outro aparelho'); aviso('Este painel mudou em outro aparelho. Recarregue a página para continuar.', 'erro'); return r; }
    if (r.status === 401) { BLOQ = true; marca('err', 'Sessão encerrada'); aviso('A sessão terminou. Entre de novo (suas mudanças não salvas ficam nesta tela até recarregar).', 'erro'); return r; }
    if (r.status === 403 && r.j && r.j.erro === 'aceitar_termo') { BLOQ = true; ERRO = 'termo'; marca('err', 'Falta aceitar o termo'); aviso('O termo de uso do painel mudou. Recarregue a página para ler e aceitar.', 'erro'); return r; }
    if (r.status === 400) { ERRO = 'invalido'; marca('err', 'Não salvou: confira ' + ((r.j && r.j.campo) || 'os campos')); return r; }
    ERRO = 'rede'; tentativas++; marca('err', 'Não salvou · tentando de novo');
    if (tentativas <= 6) setTimeout(function () { P.salvar(); }, Math.min(30000, 1500 * tentativas * tentativas));
    return r;
  }
  P.salvar = function () {
    if (BLOQ) return; marca('ing', 'Salvando…'); clearTimeout(TM); AGENDADO = true;
    TM = setTimeout(function () { AGENDADO = false; fila(enviarMudancas); }, 400);
  };
  function flush() { clearTimeout(TM); AGENDADO = false; return fila(enviarMudancas); }
  P.flush = flush;
  P.publicar = function (id) {
    return flush().then(function (r0) {
      if (r0 && r0.ok === false) return { ok: false, msg: 'Não deu para salvar antes de publicar. Veja o aviso de erro e tente de novo.' };
      return fila(function () { return req('POST', 'api/painel/imoveis/' + encodeURIComponent(id) + '/publicar', {}); }).then(function (r) {
        if (r.ok) { REV = r.j.rev; return { ok: true }; }
        var m = 'Não foi possível publicar.';
        if (r.status === 422 && r.j.falta) m = 'Para publicar, falta: ' + r.j.falta.join(', ') + '.';
        else if (r.status === 403 && r.j.erro === 'limite_plano') m = 'O plano do site chegou no limite de imóveis (' + r.j.limite + ').';
        else if (r.status === 401) m = 'A sessão terminou. Entre de novo.';
        else if (r.status === 409) m = 'Mudou em outro aparelho. Recarregue a página.';
        aviso(m, 'erro'); return { ok: false, msg: m };
      });
    });
  };
  P.publicarMapa = function () {
    return flush().then(function () {
      return fila(function () { return req('POST', 'api/painel/mapa/publicar', {}); }).then(function (r) {
        if (r.ok) { REV = r.j.rev; return { ok: true }; }
        var m = r.status === 403 ? 'O plano do site não comporta tantas cidades (' + (r.j.limite || '') + ').' : 'Não foi possível publicar o mapa.';
        aviso(m, 'erro'); return { ok: false, msg: m };
      });
    });
  };
  P.apagar = function (id) {
    return flush().then(function () {
      return fila(function () { return req('DELETE', 'api/painel/imoveis/' + encodeURIComponent(id)); }).then(function (r) {
        if (r.ok || r.status === 404) { if (r.ok) REV = r.j.rev; delete ULT.im[id]; return { ok: true }; }
        aviso('Não foi possível excluir agora. Recarregue a página.', 'erro'); return { ok: false };
      });
    });
  };

  /* ---------- fotos (12.35): 2 tamanhos sem ampliar, ajuste leve que não inventa, aviso de foto pequena/escura/tremida ---------- */
  // Tamanhos gerados no aparelho: s = 1280 px no lado maior (cards, celular), g = até 2560 px (ficha no PC e celular 3x).
  // Nunca amplia: se a original é menor, fica do tamanho dela. JPEG qualidade 0,88.
  var FOTO = { S: 1280, G: 2560, Q: 0.88, MIN_LADO: 1600, ESCURA: 50, TREMIDA: 200, MAX_BYTES: 2.9 * 1024 * 1024 };
  P.FOTO = FOTO;
  function carregarImagem(arq) {
    if (window.createImageBitmap) {
      return createImageBitmap(arq, { imageOrientation: 'from-image' }).catch(function () { return viaImg(arq); });
    }
    return viaImg(arq);
  }
  function viaImg(arq) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(arq), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('imagem')); };
      im.src = u;
    });
  }
  function desenhar(im, lado) {
    var w = im.width || im.naturalWidth, h = im.height || im.naturalHeight, k = Math.min(1, lado / Math.max(w, h));
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    return c;
  }
  // Medidas simples numa cópia de 512 px: brilho médio (0-255) e nitidez = variância do Laplaciano (4 vizinhos) no cinza.
  // Limites (est., calibrados em 13 fotos de teste na 12.35): escura < 50 (cena de fim de tarde = 55, escurecidas = 21-37);
  // tremida < 200 na nitidez relativa (nítidas 1.400-3.700; desfoques fortes 72-354). Só pega desfoque forte: tremido leve passa.
  function medir(im) {
    var c = desenhar(im, 512), x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
    var g = new Float32Array(W * H), hist = new Uint32Array(256), soma = 0, soma2 = 0, i, n = W * H;
    for (i = 0; i < n; i++) { var y = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; g[i] = y; soma += y; soma2 += y * y; hist[Math.min(255, y | 0)]++; }
    var m = 0, m2 = 0, cnt = 0, xx, yy;
    for (yy = 1; yy < H - 1; yy++) for (xx = 1; xx < W - 1; xx++) {
      var p = yy * W + xx, l = g[p - 1] + g[p + 1] + g[p - W] + g[p + W] - 4 * g[p]; m += l; m2 += l * l; cnt++;
    }
    m /= cnt || 1;
    function pct(q) { var alvo = n * q, a = 0; for (var v = 0; v < 256; v++) { a += hist[v]; if (a >= alvo) return v; } return 255; }
    var vl = m2 / (cnt || 1) - m * m, vg = Math.max(1, soma2 / n - (soma / n) * (soma / n));
    // nitidez relativa ao contraste da própria foto (assim foto escura não passa por tremida)
    return { brilho: soma / n, nitidez: 1000 * vl / vg, lap: vl, p1: pct(0.005), p99: pct(0.995) };
  }
  P.medirFoto = medir;
  // Ajuste leve que não inventa conteúdo: níveis (contraste) limitados a 1,2x, clareia foto escura com gama >= 0,8,
  // e nitidez leve (máscara de nitidez 3x3, força 0,35, ignora diferenças < 2). Mesma curva nos 3 canais (não muda cor).
  function curva(md) {
    var lo = Math.min(md.p1, 20), hi = Math.max(md.p99, 235), k = Math.min(1.2, 255 / Math.max(1, hi - lo));
    lo = Math.max(0, (hi + lo) / 2 - 127.5 / k);
    var gama = 1;
    if (md.brilho < 105) { var alvo = Math.min(115, md.brilho + Math.min(25, (110 - md.brilho) * 0.5)); gama = Math.max(0.8, Math.log(alvo / 255) / Math.log(Math.max(1, md.brilho) / 255)); }
    var t = new Uint8ClampedArray(256), igual = true;
    for (var v = 0; v < 256; v++) { var z = Math.max(0, Math.min(1, (v - lo) * k / 255)); t[v] = Math.round(255 * Math.pow(z, gama)); if (Math.abs(t[v] - v) > 1) igual = false; }
    return igual ? null : t;
  }
  function ajustar(c, t) {
    var x = c.getContext('2d'), W = c.width, H = c.height, img = x.getImageData(0, 0, W, H), d = img.data, n = W * H, i, ch;
    if (t) for (i = 0; i < d.length; i += 4) { d[i] = t[d[i]]; d[i + 1] = t[d[i + 1]]; d[i + 2] = t[d[i + 2]]; }
    var A = 0.35, LIM = 2, lin = new Float32Array(n), bl = new Float32Array(n), xx, yy, p;
    for (ch = 0; ch < 3; ch++) {
      for (yy = 0; yy < H; yy++) { var o = yy * W; for (xx = 0; xx < W; xx++) { var e = xx ? xx - 1 : 0, r = xx < W - 1 ? xx + 1 : xx; lin[o + xx] = (d[(o + e) * 4 + ch] + 2 * d[(o + xx) * 4 + ch] + d[(o + r) * 4 + ch]) * 0.25; } }
      for (yy = 0; yy < H; yy++) { var u = (yy ? yy - 1 : 0) * W, s0 = yy * W, b0 = (yy < H - 1 ? yy + 1 : yy) * W; for (xx = 0; xx < W; xx++) bl[s0 + xx] = (lin[u + xx] + 2 * lin[s0 + xx] + lin[b0 + xx]) * 0.25; }
      for (p = 0; p < n; p++) { var v0 = d[p * 4 + ch], df = v0 - bl[p]; if (df > LIM || df < -LIM) d[p * 4 + ch] = v0 + A * df; }
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  function jpeg(c, q) {
    return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error('jpeg')); }, 'image/jpeg', q); });
  }
  // Gera um tamanho: desenha em `lado`, ajusta e comprime; se passar de 2,9 MB, baixa a qualidade até 0,76 e depois o tamanho.
  function gerar(im, lado, t) {
    var c = ajustar(desenhar(im, lado), t), q = FOTO.Q;
    return (function tentar() {
      return jpeg(c, q).then(function (b) {
        if (b.size <= FOTO.MAX_BYTES) return { b: b, w: c.width, h: c.height, q: q };
        if (q > 0.77) { q = Math.round((q - 0.06) * 100) / 100; return tentar(); }
        c = ajustar(desenhar(im, Math.round(Math.max(c.width, c.height) * 0.85)), null); q = FOTO.Q; return tentar();
      });
    })();
  }
  P.prepararFoto = function (arq) {
    return carregarImagem(arq).then(function (im) {
      var w = im.width || im.naturalWidth, h = im.height || im.naturalHeight, lado = Math.max(w, h), md = medir(im), t = curva(md);
      var avisos = [];
      if (lado < FOTO.MIN_LADO) avisos.push('Foto pequena (' + lado + ' px): pode ficar sem nitidez.');
      if (md.brilho < FOTO.ESCURA) avisos.push('Foto escura.');
      if (md.nitidez < FOTO.TREMIDA) avisos.push('Foto tremida ou fora de foco.');
      return { im: im, w: w, h: h, lado: lado, medida: md, curva: t, avisos: avisos };
    });
  };
  P.gerarTamanhos = function (pr) {
    var lS = Math.min(FOTO.S, pr.lado), comG = pr.lado > FOTO.S * 1.1;
    return gerar(pr.im, lS, pr.curva).then(function (s) {
      if (!comG) return { s: s };
      return gerar(pr.im, Math.min(FOTO.G, pr.lado), pr.curva).then(function (g) { return { s: s, g: g }; });
    });
  };
  // ---------- 12.37: ampliação sem IA (só no "Usar mesmo assim" de foto pequena) ----------
  // Lanczos3 próprio (separável, 6 amostras por pixel de saída): no máximo 2x e até o lado maior chegar a 1600 px. Não inventa conteúdo.
  function lz(x) { if (x === 0) return 1; if (x <= -3 || x >= 3) return 0; var p = Math.PI * x; return 3 * Math.sin(p) * Math.sin(p / 3) / (p * p); }
  function tabela(ni, no) {
    var r = ni / no, i0 = new Int32Array(no), w = new Float32Array(no * 6), o, k;
    for (o = 0; o < no; o++) {
      var c = (o + 0.5) * r - 0.5, f = Math.floor(c), soma = 0;
      i0[o] = f - 2;
      for (k = 0; k < 6; k++) { var v = lz(c - (f - 2 + k)); w[o * 6 + k] = v; soma += v; }
      for (k = 0; k < 6; k++) w[o * 6 + k] /= soma;
    }
    return { i0: i0, w: w };
  }
  function lanczos3(src, dw, dh) {
    var sw = src.width, sh = src.height, sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
    var tx = tabela(sw, dw), ty = tabela(sh, dh), tmp = new Float32Array(dw * sh * 3), x, y, k, ch;
    for (y = 0; y < sh; y++) for (x = 0; x < dw; x++) {
      var a = tx.i0[x], r = 0, g = 0, b = 0;
      for (k = 0; k < 6; k++) { var i = Math.min(sw - 1, Math.max(0, a + k)), w = tx.w[x * 6 + k], q = (y * sw + i) * 4; r += w * sd[q]; g += w * sd[q + 1]; b += w * sd[q + 2]; }
      var t = (y * dw + x) * 3; tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b;
    }
    var out = document.createElement('canvas'); out.width = dw; out.height = dh;
    var ox = out.getContext('2d'), im = ox.createImageData(dw, dh), od = im.data;
    for (y = 0; y < dh; y++) for (x = 0; x < dw; x++) {
      var a2 = ty.i0[y], s0 = [0, 0, 0];
      for (k = 0; k < 6; k++) { var j = Math.min(sh - 1, Math.max(0, a2 + k)), w2 = ty.w[y * 6 + k], q2 = (j * dw + x) * 3; s0[0] += w2 * tmp[q2]; s0[1] += w2 * tmp[q2 + 1]; s0[2] += w2 * tmp[q2 + 2]; }
      var o = (y * dw + x) * 4;
      for (ch = 0; ch < 3; ch++) od[o + ch] = s0[ch]; // Uint8ClampedArray já limita (0-255) e arredonda
      od[o + 3] = 255;
    }
    ox.putImageData(im, 0, 0);
    return out;
  }
  P.lanczos3 = lanczos3;
  P.ampliar = function (pr) {
    var k = Math.min(2, FOTO.MIN_LADO / pr.lado), dw = Math.max(1, Math.round(pr.w * k)), dh = Math.max(1, Math.round(pr.h * k));
    var c = document.createElement('canvas'); c.width = pr.w; c.height = pr.h;
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, pr.w, pr.h); x.drawImage(pr.im, 0, 0);
    var g = lanczos3(c, dw, dh);
    if (pr.im.close) pr.im.close();
    return { im: g, w: dw, h: dh, lado: Math.max(dw, dh), medida: pr.medida, curva: pr.curva, avisos: pr.avisos, ampliada: true, lado_original: pr.lado };
  };
  function perguntar(avisos, pequena) {
    return new Promise(function (res) {
      css();
      var ul = el('ul', { class: 'pt-fq' }, avisos.map(function (a) { return el('li', { texto: a }); }));
      var outra = el('button', { type: 'button', class: 'pt-btn', texto: 'Escolher outra' });
      var usar = el('button', { type: 'button', class: 'pt-btn pri', texto: 'Usar mesmo assim', id: 'pt-usar' });
      var tela = el('div', { class: 'pt-tela', id: 'pt-fq', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pt-fq-t' }, [el('div', { class: 'pt-cartao' }, [
        el('h1', { class: 'pt-t', id: 'pt-fq-t', texto: 'Esta foto pode ficar ruim no site' }), ul,
        pequena ? el('p', { class: 'pt-p', id: 'pt-orig', texto: 'Envie a original, sem passar pelo WhatsApp.' }) : el('p', { class: 'pt-p', texto: 'Se puder, tire de novo com luz do dia.' }),
        el('div', { class: 'pt-fqb' }, [outra, usar])].filter(Boolean))]);
      outra.onclick = function () { tela.remove(); res(false); };
      usar.onclick = function () { tela.remove(); res(true); };
      document.body.appendChild(tela); usar.focus();
    });
  }
  function enviar(blob) { return req('POST', 'api/painel/fotos', blob); }
  function msgEnvio(r) { return r.status === 415 ? 'Esse arquivo não é uma foto válida.' : r.status === 413 ? 'A foto ficou grande demais.' : r.status === 401 ? 'A sessão terminou. Entre de novo.' : r.status === 429 ? 'Muitas fotos seguidas. Espere alguns minutos.' : 'Não consegui enviar a foto. Tente de novo.'; }
  P.escolherFoto = function (cb) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true; inp.id = 'pt-foto';
    inp.onchange = function () {
      var arq = inp.files && inp.files[0]; inp.remove(); if (!arq) return;
      if (arq.size > 40 * 1024 * 1024) { aviso('A foto é grande demais (máx. 40 MB).', 'erro'); return; }
      aviso('Conferindo a foto…');
      P.prepararFoto(arq).then(function (pr) {
        var a = document.getElementById('pt-aviso'); if (a) a.remove();
        return (pr.avisos.length ? perguntar(pr.avisos, pr.lado < FOTO.MIN_LADO) : Promise.resolve(true)).then(function (usar) {
          if (!usar) { if (pr.im.close) pr.im.close(); return; }
          aviso('Enviando a foto…');
          if (pr.lado < FOTO.MIN_LADO) pr = P.ampliar(pr);
          return P.gerarTamanhos(pr).then(function (t) {
            if (pr.im.close) pr.im.close();
            return enviar(t.s.b).then(function (r1) {
              if (!r1.ok) { aviso(msgEnvio(r1), 'erro'); return; }
              var foto = { s: r1.j.s, w: t.s.w };
              if (pr.ampliada) { foto.ampliada = true; foto.lado_original = pr.lado_original; }
              var fim = function () { var a2 = document.getElementById('pt-aviso'); if (a2) a2.remove(); cb(foto); };
              if (!t.g) return fim();
              return enviar(t.g.b).then(function (r2) {
                if (r2.ok) { foto.g = r2.j.s; foto.gw = t.g.w; }
                fim(); // sem a grande, o site usa a de 1280 px
              });
            });
          });
        });
      }).catch(function () { aviso('Não consegui ler essa foto. Tente outra.', 'erro'); });
    };
    document.body.appendChild(inp); inp.click();
  };
  // srcset das fotos enviadas em 2 tamanhos (o caminho já foi validado no servidor; escapo mesmo assim)
  function attr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  P.srcset = function (f, sizes) {
    if (!f || !f.g || !(f.w > 0) || !(f.gw > 0)) return '';
    return ' srcset="' + attr(f.s) + ' ' + Math.round(f.w) + 'w, ' + attr(f.g) + ' ' + Math.round(f.gw) + 'w" sizes="' + attr(sizes || '100vw') + '"';
  };
  P.fotoEm = function (img, f, sizes) {
    if (!img || !f) return;
    if (f.g && f.w > 0 && f.gw > 0) { img.sizes = sizes || '100vw'; img.srcset = f.s + ' ' + Math.round(f.w) + 'w, ' + f.g + ' ' + Math.round(f.gw) + 'w'; }
    else img.removeAttribute('srcset');
    if (img.getAttribute('src') !== f.s) img.src = f.s;
  };
  // Dicas no passo das fotos do painel (texto mínimo; ícones simples)
  var IC = {
    deitado: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M18 12h.01"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    lente: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    passo: '<path d="M14 5l-7 7 7 7"/><path d="M20 12H8"/>',
    nivel: '<path d="M3 12h18"/><rect x="8" y="5" width="8" height="14" rx="2"/>',
    ordem: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    vazio: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    original: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 15l4-4 4 4 3-3 5 5"/>',
  };
  function ic(k) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>'; }
  P.dicasFotos = function (aberto) {
    css();
    var itens = [
      ['deitado', 'Celular deitado (na horizontal)'],
      ['sol', 'De dia, luzes acesas, janelas abertas'],
      ['lente', 'Lente limpa'],
      ['passo', 'Sem zoom: dê um passo para trás'],
      ['nivel', 'Celular na altura do peito, reto'],
      ['ordem', '1 foto por cômodo: fachada, sala, cozinha, quartos, banheiros, área externa'],
      ['vazio', 'Sem pessoas e sem bagunça'],
      ['original', 'Mande a foto original da câmera (a que passou pelo WhatsApp perde qualidade)'],
    ];
    return '<details class="pt-dicas"' + (aberto ? ' open' : '') + '><summary>Como tirar boas fotos</summary><ul>' +
      itens.map(function (i) { return '<li>' + ic(i[0]) + '<span>' + i[1] + '</span></li>'; }).join('') + '</ul></details>';
  };

  /* ---------- WhatsApp do site: campo no painel (Configurações); o site lê o número daqui ---------- */
  var WA_PADRAO = '5551989498872', WA_CHAVE = 'erivelto_wa_site', RE_WA = /^55[1-9][1-9]9\d{8}$/;
  function waLocal() { try { var v = localStorage.getItem(WA_CHAVE); return RE_WA.test(v || '') ? v : null; } catch (e) { return null; } }
  // Modo servidor: só o número salvo no painel (API); sem número, '' (o site não abre conversa com ninguém).
  // Prévia (sem servidor): o que o painel guardou neste aparelho, ou o número padrão da prévia.
  P.waSite = function () {
    if (P.srv) { var n = ESTADO && ESTADO.whatsapp_numero; return RE_WA.test(n || '') ? n : ''; }
    return waLocal() || WA_PADRAO;
  };
  function waDig(v) {
    v = String(v || ''); var d = v.replace(/\D/g, '');
    if (v.indexOf('+') >= 0) d = d.replace(/^55?/, ''); else if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2);
    return d.slice(0, 11);
  }
  function waFmt(d) {
    if (!d) return '';
    var t = '+55 (' + d.slice(0, 2);
    if (d.length > 2) t += ') ' + d.slice(2, 7);
    if (d.length > 7) t += '-' + d.slice(7, 11);
    return t;
  }
  P.waHtml = function () {
    return '<section class="ep1-sec" id="ep34"><h5>WhatsApp do site</h5><div class="ep1-f">' +
      '<input class="ep1-in" id="ep34w" type="tel" inputmode="tel" autocomplete="off" maxlength="19" aria-label="WhatsApp do site" aria-describedby="ep34m" value="' + waFmt(P.waSite().slice(2)) + '">' +
      '<a class="ep1-h" id="ep34l" target="_blank" rel="noopener noreferrer"></a><small class="ep1-h" id="ep34m" aria-live="polite"></small></div>' +
      '<button type="button" class="ep1-b pri" id="ep34s" disabled>Salvar</button></section>';
  };
  P.waLigar = function (raiz) {
    var inp = raiz.querySelector('#ep34w'), lk = raiz.querySelector('#ep34l'), msg = raiz.querySelector('#ep34m'), btn = raiz.querySelector('#ep34s');
    if (!inp || !lk || !msg || !btn) return;
    function ver(falar) {
      var d = waDig(inp.value), n = '55' + d, ok = RE_WA.test(n);
      if (ok) { lk.href = 'https://wa.me/' + n; lk.textContent = 'wa.me/' + n; lk.hidden = false; } else { lk.removeAttribute('href'); lk.textContent = ''; lk.hidden = true; }
      if (falar !== false) msg.textContent = ok ? '' : 'Celular com DDD: 11 números, o terceiro é 9.';
      btn.disabled = !ok || n === P.waSite();
      return ok ? n : null;
    }
    inp.oninput = function () { var f = waFmt(waDig(inp.value)); if (inp.value !== f) inp.value = f; ver(); };
    inp.onkeydown = function (ev) { if (ev.key === 'Enter' && !btn.disabled) btn.click(); };
    btn.onclick = function () {
      var n = ver(); if (!n || btn.disabled) return;
      if (!P.srv) {
        try { localStorage.setItem(WA_CHAVE, n); msg.textContent = 'Salvo.'; } catch (e) { msg.textContent = 'Não salvou neste aparelho.'; }
        ver(false); return;
      }
      btn.disabled = true; msg.textContent = 'Salvando…';
      req('PUT', 'api/painel/whatsapp', { numero: n }).then(function (r) {
        if (r.ok && RE_WA.test(r.j.whatsapp_numero || '')) { ESTADO.whatsapp_numero = r.j.whatsapp_numero; msg.textContent = 'Salvo. O site já usa este número.'; ver(false); return; }
        msg.textContent = r.status === 401 ? 'A sessão terminou. Entre de novo.' : r.status === 400 ? 'Confira o número.' : 'Não salvou. Tente de novo.';
        btn.disabled = false;
      });
    };
    ver(false);
  };

  function iniciarPainel() {
    css();
    return req('GET', 'api/painel/sessao').then(function (s0) {
      if (!s0.ok) { telaErro('Não consegui carregar o painel agora.'); return null; }
      if (!s0.j.logado) return telaLogin().then(function (l) { return l.trocar ? telaTroca(true) : true; }).then(function () { return iniciarPainel(); }).then(function () { return null; });
      return req('GET', 'api/painel/estado');
    }).then(function (r) {
      if (!r) return;
      if (r.status === 403 && r.j && r.j.erro === 'aceitar_termo') return telaTermo(r.j.versao).then(function () { return iniciarPainel(); });
      if (!r.ok) { telaErro('Não consegui carregar o painel agora.'); return; }
      if (r.j.admin && r.j.admin.trocar) return telaTroca(true).then(function () { return iniciarPainel(); });
      ESTADO = r.j; REV = r.j.rev;
      return carregarContatos().then(function (c) {
        ESTADO.leads = c.leads || []; ESTADO.chamadas = c.chamadas || [];
        P.srv = true;
        try { window.SITE11.PLANO = ESTADO.plano; window.SITE11.AVISO = false; } catch (e) { /* segue */ }
        barra(r.j.admin.email); iniciar();
      });
    });
  }

  /* ---------- partida ---------- */
  var comeco = P.pagina === 'painel' ? iniciarPainel : iniciarSite;
  detectar().then(function (ok) { if (ok) return comeco(); iniciar(); }).catch(function (e) {
    if (window.console) console.error('ponte', e && e.message); if (!P.srv) iniciar();
  });
})();
