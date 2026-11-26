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
  // versão vinda do endereço deste script (ponte.js?v=…, posta pelo servidor): o ponte.css vai com a mesma
  var VER = ((document.currentScript && /[?&]v=([\w-]+)/.exec(document.currentScript.src)) || [])[1] || '';
  P.ver = VER;
  function css() {
    if (document.getElementById('ponte-css')) return;
    var l = el('link', { id: 'ponte-css', rel: 'stylesheet', href: 'ponte.css' + (VER ? '?v=' + VER : '') });
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
  var AVISO_VERSAO = 'v3'; // a mesma de site/privacidade/index.html e do padrão de ERV_AVISO_VERSAO no servidor
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
  P.leadMudar = function (lid, dados) { return req('PUT', 'api/painel/leads/' + encodeURIComponent(lid), dados); };   // T43
  P.lead = function (d) {
    enviarComReenvio('api/leads', { via: d.via, imovel_id: d.id || undefined, imovel: d.imovel || undefined, cidade: d.cidade || undefined });
  };
  P.chamada = function (t) { enviarComReenvio('api/chamadas', { id: t.id, nm: t.nm, o: t.o }); };

  // T05, T04 e T45: CRECI, links legais (Privacidade, Termos) e "Quero vender" sempre à vista na busca e nos resultados. Some na ficha do imóvel (classe "f5"), que tem botões embaixo.
  // T05, T04 e T45 · R86e/R86f (John 24/11): sai a barra de baixo. CRECI, Privacidade e Termos ficam discretos no fim da
  // ficha do imóvel (no cartão "Pra salvar seus dados" não: John pediu para tirar). "Quero vender" sai (o botão "Anunciar" do topo faz isso). Na prévia entra o link do painel.
  function legal() {
    var r = el('p', { class: 'pt-legal' }, [
      el('span', { texto: 'Erivelto Santos \u00b7 CRECI 63.464 \u00b7 ' }), el('a', { href: 'privacidade/', texto: 'Privacidade' }), el('span', { texto: ' \u00b7 ' }), el('a', { href: 'termos/', texto: 'Termos' })]);
    if (!P.srv) { r.appendChild(el('span', { texto: ' \u00b7 ' })); r.appendChild(el('a', { href: 'painel/', texto: 'Painel (prévia)' })); }
    return r;
  }
  function legal86() {
    var nv = document.querySelector('.sc12 .nv12'); if (nv && !nv.querySelector('.pt-legal')) nv.appendChild(legal());
  }
  // R86f (John 24/11): imóvel sem financiamento (o corretor não cadastrou) não mostra nada de financiamento ao visitante,
  // nem no cartão "Pra salvar seus dados e disponibilizar" aberto de dentro da ficha dele.
  function semFin86() {
    var sc = document.querySelector('.sc12'), uc = document.querySelector('.uc12'); if (!sc || !uc) return;
    var pp = sc.querySelector('.pp12b'), id = sc.classList.contains('f5') && pp && pp.dataset.fin, a = id && MAP86[id];
    var esconde = !!(a && !a.fin), ul = uc.querySelector('.ub3'); if (!ul) return;
    var n = 0;
    [].forEach.call(ul.children, function (li) { var f = /financ/i.test(li.textContent); li.hidden = f && esconde; if (!li.hidden) n++; });
    ul.style.setProperty('--n', n);
  }
  function rodape() {
    var v = document.getElementById('pt-rodape'); if (v) v.remove();
    function apos() { legal86(); semFin86(); }
    document.addEventListener('click', function () { setTimeout(apos, 0); setTimeout(apos, 300); }, true);
  }
  /* ---------- T39–T45: o que o site mostra de cada imóvel (o site/index.html chama estas funções; ver remendos.py) ---------- */
  var RE_COD = /^ES-\d{3,5}$/;
  var VIT = typeof WeakMap === 'function' ? new WeakMap() : null;
  // T39: vendido sai da busca (ou fica no fim, com selo, se o corretor marcou "mostrar como vendido"). T40: aluguel vira a
  // categoria "Para alugar" (tipo "aluguel" na busca; o tipo de verdade fica em "tr"), sem financiamento.
  P.vitrine = function (lista) {
    var ok = [], vend = [];
    (lista || []).forEach(function (a) {
      if (!a) return;
      var sit = a.sit === 'res' || a.sit === 'vend' ? a.sit : 'disp', alug = a.final === 'aluguel';
      if (sit === 'vend' && !a.vendMostra) return;
      var b = a;
      if (alug || sit === 'vend') {
        b = VIT && VIT.get(a);
        if (!b) {
          b = JSON.parse(JSON.stringify(a));
          if (alug) { b.tr = a.tipo; b.tipo = 'aluguel'; b.alug = true; }
          b.fin = false; b.fn = null;            // aluguel e vendido: sem simulação de financiamento
          if (VIT) VIT.set(a, b);
        }
      }
      (sit === 'vend' ? vend : ok).push(b);
    });
    return ok.concat(vend);
  };
  P.selos = function (a, ficha) {
    if (!a) return '';
    var s = [];
    if (a.sit === 'vend') s.push('<span class="pt-selo vend">Vendido</span>');
    else if (a.sit === 'res') s.push('<span class="pt-selo res">Reservado</span>');
    if (a.alug) s.push('<span class="pt-selo alug">Para alugar</span>');
    // R86e (John 24/11): o código ES-… não aparece no site; fica só no painel
    return s.length ? '<span class="pt-selos' + (ficha ? ' f' : '') + '">' + s.join('') + '</span>' : '';
  };
  // Aluguel: o corretor guarda o valor do MÊS e escolhe como o site mostra (perAlug): por dia (mês ÷ 30), mês ou ano (mês × 12).
  // Centavos só quando a conta não dá inteiro (1100/mês = R$ 36,67/dia): o anúncio vale como oferta, então não arredonda para baixo.
  var PER_ALUG = { dia: ['/dia', 1 / 30], mes: ['/mês', 1], ano: ['/ano', 12] };
  P.precoAlug = function (a) {
    var p = PER_ALUG[a && a.perAlug] || PER_ALUG.mes, v = Math.round((+(a && a.preco) || 0) * p[1] * 100) / 100;
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + p[0];
  };
  // T42 (código), T40 (aluguel), T39 (reservado/vendido) na mensagem pronta do WhatsApp. Recebe a mensagem que o site montou.
  P.msg = function (a, t) {
    if (!a || typeof t !== 'string') return t;
    if (RE_COD.test(a.cod || '')) t = t.replace(/^(Olá, Erivelto! Vi no seu site [^"]*"[^"]*")/, '$1 (cód. ' + a.cod + ')');
    if (a.alug) t = t.replace(' o imóvel "', ' o imóvel para alugar "').replace(/, de (R\$.*?), e quero/, ', por ' + P.precoAlug(a) + ', e quero');
    if (a.sit === 'vend') t = t.replace('e quero mais informações.', 'que já foi vendido, e quero um imóvel parecido.');
    else if (a.sit === 'res') t = t.replace('e quero mais informações.', 'que está reservado, e quero mais informações.');
    return t;
  };

  /* ---------- T44: pedir visita (dia e período vão na mensagem do WhatsApp; quem entrou no site vira contato "visita") ---------- */
  var VISITAS = {};
  P.botaoVisita = function (a) {
    if (!a || a.sit === 'vend' || a.ex) return '';
    VISITAS[a.id] = a;
    return '<button type="button" class="pt-visita" data-pt-visita="' + attr(a.id) + '">Pedir visita</button>';
  };
  var PERIODOS = [['manha', 'de manhã'], ['tarde', 'à tarde'], ['noite', 'à noite']];
  function dias() {
    var out = [], d = new Date(), sem = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    for (var i = 0; i < 7; i++) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i), dm = ('0' + x.getDate()).slice(-2) + '/' + ('0' + (x.getMonth() + 1)).slice(-2);
      out.push([dm, i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : sem[x.getDay()] + ' ' + dm, i === 0 ? 'hoje (' + dm + ')' : i === 1 ? 'amanhã (' + dm + ')' : sem[x.getDay()] + ', ' + dm]);
    }
    return out;
  }
  function contaVisitante() {
    if (P.srv) { var c = ESTADO && ESTADO.conta; return c && c.nome && c.wa ? c : null; }
    try { var l = JSON.parse(localStorage.getItem('erivelto_conta') || 'null'); return l && l.nome && l.wa ? l : null; } catch (e) { return null; }
  }
  function store() { return P.g || window.ST12 || null; }
  function abrirWa(href) {   // passa pelos mesmos avisos do site (prévia e "sem número"): um link de verdade, clicado
    var a = el('a', { href: href, target: '_blank', rel: 'noopener' }); a.style.display = 'none';
    document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 0);
  }
  function telaVisita(a, base) {   // R86: em forma de conversa com o corretor (escolha C de John). Mesma mensagem, mesmo registro.
    css();
    var escolha = { dia: null, per: null }, ds = dias(), nm = nomeDe(a), conta = contaVisitante();
    var msg = el('p', { class: 'pt-msg', 'aria-live': 'polite' });
    var ir = el('button', { type: 'button', class: 'pt-btn pri', id: 'pt-visita-ir', disabled: 'disabled', texto: 'Enviar pelo WhatsApp' });
    var fe = el('button', { type: 'button', class: 'pt-btn', texto: 'Cancelar' });
    var eu = el('p', { class: 'pt-bal eu vazio', 'aria-live': 'polite', texto: 'Escolha o dia e o período…' });
    var nome = conta ? null : el('input', { class: 'pt-in', id: 'pt-visita-nome', maxlength: '60', autocomplete: 'name', 'aria-label': 'Seu nome (opcional)', placeholder: 'Seu nome (opcional)' });
    function frase() {
      if (!escolha.dia || !escolha.per) { eu.textContent = 'Escolha o dia e o período…'; eu.classList.add('vazio'); return; }
      eu.textContent = 'Quero visitar ' + escolha.dia[2] + ', ' + escolha.per[1] + '.'; eu.classList.remove('vazio');
    }
    function grupo(nome2, itens, k) {
      var g = el('div', { class: 'pt-chips', role: 'radiogroup', 'aria-label': nome2 });
      itens.forEach(function (it) {
        var b = el('button', { type: 'button', class: 'pt-chip', role: 'radio', 'aria-checked': 'false', 'data-v': it[0], texto: it[1] });
        b.onclick = function () { escolha[k] = it; g.querySelectorAll('.pt-chip').forEach(function (o) { o.setAttribute('aria-checked', String(o === b)); }); ir.disabled = !(escolha.dia && escolha.per); frase(); };
        g.appendChild(b);
      });
      return g;
    }
    var PER_C = [['manha', 'Manhã', 'de manhã'], ['tarde', 'Tarde', 'à tarde'], ['noite', 'Noite', 'à noite']].map(function (p) { return [p[0], p[1], p[2]]; });
    var gp = grupo('Período', PER_C, 'per');
    gp.querySelectorAll('.pt-chip').forEach(function (b, j) { b.onclick = (function (o) { return function () { escolha.per = [PER_C[j][0], PER_C[j][2]]; gp.querySelectorAll('.pt-chip').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); }); ir.disabled = !(escolha.dia && escolha.per); frase(); }; })(); });
    var topo = el('div', { class: 'pt-ctop' });
    topo.innerHTML = '<span class="pt-cav"><img src="lg/logo.webp" alt=""></span><span><b>Erivelto Santos</b><small>Corretor de imóveis · confirma o horário com você</small></span>';
    var ele = el('p', { class: 'pt-bal ele', texto: 'Oi! Quer conhecer ' + (nm && nm !== 'Imóvel' ? '"' + nm + '"' : 'o imóvel') + '? Me diga o dia e o período que fica bom para você.' });
    var tela = el('div', { class: 'pt-tela', id: 'pt-visita', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pt-visita-t' }, [el('div', { class: 'pt-cartao pt-conversa' }, [
      el('h1', { class: 'pt-t pt-sr', id: 'pt-visita-t', texto: 'Pedir visita' }), topo, ele, eu,
      el('p', { class: 'pt-lb', texto: 'Dia' }), grupo('Dia', ds, 'dia'), el('p', { class: 'pt-lb', texto: 'Período' }), gp].concat(nome ? [nome] : []).concat([msg, ir, fe]))]);
    fe.onclick = function () { tela.remove(); };
    ir.onclick = function () {
      if (!escolha.dia || !escolha.per) return;
      if (P.srv && !P.waSite()) { msg.textContent = 'O WhatsApp do corretor ainda não está disponível aqui.'; return; }
      var pedido = escolha.dia[2] + ', ' + escolha.per[1];
      var texto = base.indexOf('e quero mais informações.') >= 0 ? base.replace('e quero mais informações.', 'e quero marcar uma visita ' + pedido + '.') : base + ' Quero marcar uma visita ' + pedido + '.';
      var quem = nome && nome.value.trim(); if (quem) texto += ' Sou ' + quem.slice(0, 60) + '.';
      var href = 'https://wa.me/' + P.waSite() + '?text=' + encodeURIComponent(texto);
      registrarVisita(a, pedido);
      tela.remove(); abrirWa(href);
    };
    document.body.appendChild(tela); var b0 = tela.querySelector('.pt-chip'); if (b0) b0.focus();
  }
  function nomeDe(a) { var m = /"([^"]*)"/.exec(a.__msg || ''); return (a.nome && String(a.nome).trim()) || (m ? m[1] : 'Imóvel'); }
  function registrarVisita(a, pedido) {
    var nm = nomeDe(a), preco = a.__preco || '', o = '"' + nm + '"' + (preco ? ' · ' + preco : '') + ' · "Pedir visita"';
    var ch = { t: Date.now(), c: a.cidade, id: a.id, nm: nm, o: o }, st = store(), c = contaVisitante();
    if (P.srv) {
      P.chamada(ch);
      if (c) enviarComReenvio('api/leads', { via: 'visita', imovel_id: a.id, imovel: '"' + nm + '"' + (preco ? ' · ' + preco : ''), cidade: a.cidade, pedido: pedido });
      return;
    }
    if (!st || !st.d) return;   // prévia: fica neste navegador, como o resto
    st.d.chamadas.push(ch);
    if (c) {
      var dig = String(c.wa).replace(/\D/g, ''), l = st.d.leads.filter(function (x) { return String(x.wa || '').replace(/\D/g, '') === dig; })[0];
      if (!l) { l = { nome: c.nome, wa: c.wa, via: [], t: Date.now() }; st.d.leads.push(l); }
      if ((l.via || []).indexOf('visita') < 0) l.via = (l.via || []).concat('visita');
      l.imovel = '"' + nm + '"' + (preco ? ' · ' + preco : ''); l.nm = nm; l.id = a.id; l.cidade = a.cidade; l.pedido = pedido; l.t = Date.now();
    }
    try { st.save(); } catch (e) { /* segue */ }
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-pt-visita]'); if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    var a = VISITAS[b.getAttribute('data-pt-visita')]; if (!a) return;
    var lk = b.parentNode && b.parentNode.querySelector('a.nw12'), base = '';
    try { base = new URL(lk.href).searchParams.get('text') || ''; } catch (e) { base = ''; }
    if (!base) base = 'Olá, Erivelto! Vi no seu site o imóvel "' + (a.nome || 'Imóvel') + '", em ' + a.cidade + ', e quero mais informações.';
    a.__msg = base; var pm = /, (?:de|por) (R\$.*?), e quero/.exec(base); a.__preco = pm ? pm[1] : '';
    telaVisita(a, base);
  });

  /* ---------- T45: "Quero vender meu imóvel" (formulário curto; cai nos contatos do painel) ---------- */
  var TIPOS_VENDER = [['casa', 'Casa'], ['apartamento', 'Apartamento'], ['terreno', 'Terreno'], ['sobrado', 'Sobrado'], ['sitio', 'Sítio ou chácara'], ['sala', 'Sala comercial'], ['galpao', 'Galpão'], ['outro', 'Outro']];
  // John 23/11 (R86c, A): mesmo cartão do Login, poucos campos, o tipo vira uma lista (não 8 pílulas soltas)
  P.telaVender = function () {
    css();
    var X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    var tipo = el('select', { class: 'an-in', id: 'pt-v-tipo', 'aria-label': 'Tipo do imóvel' });
    tipo.innerHTML = '<option value="">Tipo do imóvel</option>' + TIPOS_VENDER.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('');
    var cid = el('input', { class: 'an-in', id: 'pt-v-cidade', maxlength: '80', autocomplete: 'address-level2', 'aria-label': 'Cidade do imóvel', placeholder: 'Cidade do imóvel' });
    var nome = el('input', { class: 'an-in', id: 'pt-v-nome', maxlength: '60', autocomplete: 'name', 'aria-label': 'Seu nome', placeholder: 'Seu nome' });
    var wa = el('input', { class: 'an-in', id: 'pt-v-wa', type: 'tel', inputmode: 'tel', maxlength: '25', autocomplete: 'tel', 'aria-label': 'Seu WhatsApp', placeholder: 'Seu WhatsApp' });
    var ace = el('label', { class: 'an-chk' }); ace.innerHTML = '<input type="checkbox" id="pt-v-aceite"><span>Li e aceito o <a href="privacidade/" target="_blank" rel="noopener">aviso de privacidade</a></span>';
    var msg = el('p', { class: 'an-msg', 'aria-live': 'polite' });
    var env = el('button', { type: 'button', class: 'an-bt', id: 'pt-v-enviar', disabled: 'disabled', texto: 'Enviar' });
    var fe = el('button', { type: 'button', class: 'an-x', 'aria-label': 'Fechar' }); fe.innerHTML = X;
    var corpo = el('div', { class: 'an-card' }, [fe,
      el('p', { class: 'an-t', id: 'pt-v-t', texto: 'Anunciar meu imóvel' }),
      el('p', { class: 'an-s', texto: 'O Erivelto fala com você pelo WhatsApp.' }),
      tipo, cid, nome, wa, ace, msg, env]);
    var tela = el('div', { class: 'an-tela', id: 'pt-vender', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pt-v-t' }, [corpo]);
    var chk = ace.querySelector('input');
    function dados() { return { tipo: tipo.value, cidade: cid.value.trim(), obs: '', nome: nome.value.trim(), whatsapp: wa.value.trim() }; }
    function ver() { var d = dados(); env.disabled = !(d.tipo && d.cidade.length >= 2 && d.nome.length >= 2 && waDig(d.whatsapp).length >= 10 && chk.checked); }
    [cid, nome, wa].forEach(function (i) { i.oninput = ver; }); tipo.onchange = ver; chk.onchange = ver;
    function fechar() { tela.remove(); document.removeEventListener('keydown', esc); }
    function esc(ev) { if (ev.key === 'Escape') fechar(); }
    document.addEventListener('keydown', esc);
    fe.onclick = fechar; tela.addEventListener('click', function (ev) { if (ev.target === tela) fechar(); });
    function pronto(texto) { corpo.innerHTML = ''; corpo.appendChild(fe); corpo.appendChild(el('p', { class: 'an-t', id: 'pt-v-t', texto: 'Recebido' })); corpo.appendChild(el('p', { class: 'an-s', id: 'pt-v-ok', texto: texto })); var f2 = el('button', { type: 'button', class: 'an-bt', texto: 'Fechar' }); f2.onclick = fechar; corpo.appendChild(f2); f2.focus(); }
    env.onclick = function () {
      var d = dados(); if (env.disabled) return;
      if (!P.srv) {
        var st = store();
        if (st && st.d) { st.d.leads.push({ nome: d.nome, wa: d.whatsapp, via: ['vender'], imovel: '-', id: null, cidade: d.cidade, t: Date.now(), vender: { tipo: d.tipo, cidade: d.cidade, obs: d.obs } }); try { st.save(); } catch (e) { /* segue */ } }
        pronto('Prévia: o pedido ficou só neste navegador. No site no ar, ele chega ao painel do Erivelto.'); return;
      }
      env.disabled = true; msg.textContent = 'Enviando…';
      req('POST', 'api/vender', { nome: d.nome, whatsapp: d.whatsapp, tipo: d.tipo, cidade: d.cidade, obs: d.obs, aceite: true, versao_aviso: AVISO_VERSAO }).then(function (r) {
        if (r.ok) { pronto('O Erivelto vai falar com você pelo WhatsApp.'); return; }
        msg.textContent = r.status === 400 && r.j && r.j.campo === 'cidade' ? 'Confira a cidade.' : msgConta(r); env.disabled = false;
      });
    };
    document.body.appendChild(tela); tipo.focus();
  };
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('[data-pt-vender]'); if (!a) return;
    ev.preventDefault(); P.telaVender();
  });

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
      iniciar(); rodape(); esvaziarFila(); liga86(); visto86('');
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') esvaziarFila(); });
    });
  }

  /* ---------- R86 (23/11): pedido do Erivelto e do John ----------
     cor principal #003641; "Anunciar meu imóvel" ao lado do Login; letras maiores; cartão de vidro branco com a foto à esquerda;
     a lista some por baixo do grid de busca (sem corte reto); "Ver cômodos" abre no cartão; ficha com "Onde fica" e
     "O que o imóvel tem" em ícones grandes; Pedir visita em forma de conversa; contador do Desempenho. */
  var ICO86 = {"cama":"<rect x=\"5\" y=\"7\" width=\"22\" height=\"9\" rx=\"2\"/><rect x=\"8\" y=\"11\" width=\"6.5\" height=\"4\" rx=\"1.5\"/><rect x=\"17.5\" y=\"11\" width=\"6.5\" height=\"4\" rx=\"1.5\"/><path d=\"M3 16h26v7H3z\"/><path d=\"M3 20h26M5 23v3M27 23v3\"/>","suite":"<path d=\"M4 24V12M4 19h24v5M28 24v-6a3 3 0 0 0-3-3H14v4\"/><circle cx=\"9\" cy=\"15.5\" r=\"2.2\"/><path d=\"M22 5.5c0 1.7-1.3 3-3 3s-3-1.3-3-3c0-1.6 3-4 3-4s3 2.4 3 4z\"/>","banho":"<path d=\"M4 16h24v3a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z\"/><path d=\"M7 16V8.5a3 3 0 0 1 6 0\"/><path d=\"M10 25l-1 3M22 25l1 3\"/>","sofa":"<path d=\"M6.5 14v-3.5a3 3 0 0 1 3-3h13a3 3 0 0 1 3 3V14\"/><path d=\"M4 14.5a2 2 0 0 1 4 0V19h16v-4.5a2 2 0 0 1 4 0V23H4z\"/><path d=\"M6 23v3M26 23v3\"/>","cozinha":"<rect x=\"7\" y=\"9\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M7 15h18\"/><circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"16\" cy=\"12\" r=\"1\"/><circle cx=\"20\" cy=\"12\" r=\"1\"/><rect x=\"11\" y=\"18.5\" width=\"10\" height=\"5\" rx=\"1\"/><path d=\"M12 5v2M16 5v2M20 5v2\"/>","lavanderia":"<rect x=\"7\" y=\"4\" width=\"18\" height=\"24\" rx=\"2\"/><path d=\"M7 10h18\"/><circle cx=\"16\" cy=\"19\" r=\"5\"/><circle cx=\"11\" cy=\"7\" r=\".8\"/>","garagem":"<path d=\"M3 13L16 5l13 8\"/><path d=\"M6 11.5V27h20V11.5\"/><path d=\"M10.5 21l1.4-3.6h8.2l1.4 3.6\"/><rect x=\"9.5\" y=\"21\" width=\"13\" height=\"4\" rx=\"1\"/><path d=\"M11.5 25v1.5M20.5 25v1.5\"/>","varanda":"<path d=\"M3 13L16 5l13 8\"/><path d=\"M6 12v15M26 12v15M6 16h20M6 27h20\"/><path d=\"M10 16c0 4 3 6 6 6s6-2 6-6\"/>","sacada":"<path d=\"M5 18h22M5 18v9M27 18v9M5 27h22M10 18v9M15 18v9M20 18v9\"/><path d=\"M9 14V6h14v8\"/><path d=\"M16 6v8\"/>","churras":"<path d=\"M6 13h20a10 10 0 0 1-20 0z\"/><path d=\"M11.5 22l-3 6.5M20.5 22l3 6.5M16 23v5.5\"/><path d=\"M12.5 9.5c0-2 2-2 2-4M17.5 9.5c0-2 2-2 2-4\"/>","piscina":"<path d=\"M10 19V7a2.5 2.5 0 0 1 5 0\"/><path d=\"M18 19V7a2.5 2.5 0 0 1 5 0\"/><path d=\"M10 11h8M10 15h8\"/><path d=\"M3 22c2 0 2-1.4 4.3-1.4S9.6 22 11.9 22s2.3-1.4 4.6-1.4S18.8 22 21 22s2.2-1.4 4.4-1.4S27.8 22 29 22\"/><path d=\"M3 26.5c2 0 2-1.4 4.3-1.4s2.3 1.4 4.6 1.4 2.3-1.4 4.6-1.4 2.3 1.4 4.5 1.4 2.2-1.4 4.4-1.4 2.4 1.4 3.6 1.4\"/>","jardim":"<path d=\"M16 28V14\"/><path d=\"M16 18c-5 0-8-3-8-8 5 0 8 3 8 8zM16 15c0-4.5 2.7-7.5 7.5-7.5 0 4.5-2.7 7.5-7.5 7.5z\"/><path d=\"M8 28h16\"/>","patio":"<circle cx=\"16\" cy=\"11\" r=\"6.5\"/><path d=\"M16 17.5V27M11 27h10M13 14l3 3 3-3\"/>","armario":"<rect x=\"6\" y=\"4\" width=\"20\" height=\"24\" rx=\"1\"/><path d=\"M16 4v24M13 14.5v3M19 14.5v3M6 24h20\"/>","academia":"<path d=\"M4 13v6M8 10v12M24 10v12M28 13v6M8 16h16\"/>","salao":"<path d=\"M6 27l5-15 9 9z\"/><path d=\"M14 8l1-3M20 10l3-2M22 15l3 1\"/><circle cx=\"18\" cy=\"5\" r=\".8\"/><circle cx=\"26\" cy=\"11\" r=\".8\"/>","escritura":"<path d=\"M9 4h10l6 6v18H9z\"/><path d=\"M19 4v6h6\"/><path d=\"M12.5 15h9M12.5 19h9M12.5 23h5\"/>","agua":"<path d=\"M12 6s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z\"/><path d=\"M23 4l-4 8h5l-4 8\"/>","elevador":"<rect x=\"7\" y=\"4\" width=\"18\" height=\"24\" rx=\"2\"/><path d=\"M16 4v24\"/><path d=\"M10.5 13l2-2.5 2 2.5M17.5 11l2 2.5 2-2.5\"/>","portaria":"<path d=\"M16 4l10 4v7c0 6-4.5 10.5-10 13-5.5-2.5-10-7-10-13V8z\"/><path d=\"M12 16l3 3 5-6\"/>","murado":"<path d=\"M4 26h24M4 11h24M4 26V11M28 26V11M4 16h24M4 21h24M10 11v5M18 11v5M14 16v5M22 16v5M10 21v5M18 21v5\"/>","esquina":"<path d=\"M4 9h17a2 2 0 0 1 2 2v17\"/><path d=\"M4 15h11a2 2 0 0 1 2 2v11\"/><path d=\"M4 12h3M10 12h3M20 25v-3M20 19v-3\"/>","frente":"<path d=\"M4 16h24M4 12v8M28 12v8\"/><path d=\"M8 16l3-2.5M8 16l3 2.5M24 16l-3-2.5M24 16l-3 2.5\"/>","andar":"<path d=\"M5 27h6v-6h6v-6h6V9h4\"/><path d=\"M5 27h22\"/>","condominio":"<rect x=\"5\" y=\"7\" width=\"22\" height=\"20\" rx=\"2\"/><path d=\"M5 12h22M10 4v5M22 4v5\"/><path d=\"M13 21.5c0 1.2 1.3 2 3 2s3-.8 3-2-1.3-1.7-3-2-3-.8-3-2 1.3-2 3-2 3 .8 3 2M16 14v1.5M16 23.5V25\"/>","terreno":"<path d=\"M3 26l7-6 6 4 6-7 7 9z\"/><path d=\"M16 17V5l6 3-6 3\"/>","area":"<path d=\"M6 7h20v15H6z\" stroke-dasharray=\"2.2 2.2\"/><path d=\"M11 12.5l.6 1.2 1.3.2-.9.9.2 1.3-1.2-.6-1.2.6.2-1.3-.9-.9 1.3-.2z\"/><path d=\"M20 15l.6 1.2 1.3.2-.9.9.2 1.3-1.2-.6-1.2.6.2-1.3-.9-.9 1.3-.2z\"/><path d=\"M6 26.5h20M6 25v3M26 25v3\"/>","chave":"<circle cx=\"10\" cy=\"16\" r=\"5\"/><path d=\"M15 16h13M24 16v4M28 16v3\"/>","plano":"<path d=\"M3 23h26\"/><path d=\"M6 23v-4h20v4\"/><path d=\"M11 15h10M16 11v4\"/>","predio":"<rect x=\"8\" y=\"4\" width=\"16\" height=\"24\"/><path d=\"M12 9h2M18 9h2M12 14h2M18 14h2M12 19h2M18 19h2M14 28v-4h4v4\"/>","outro":"<path d=\"M16 28s-8-7.5-8-14a8 8 0 0 1 16 0c0 6.5-8 14-8 14z\"/><circle cx=\"16\" cy=\"14\" r=\"3\"/>","mais":"<circle cx=\"16\" cy=\"16\" r=\"11\"/><path d=\"M16 11v10M11 16h10\"/>"};
  Object.assign(ICO86, {"lavabo": "<path d=\"M5 14h22\"/><path d=\"M7 14c0 5 3 8 9 8s9-3 9-8\"/><path d=\"M16 22v4M12 27h8\"/><path d=\"M16 14V8a3 3 0 0 1 5-2\"/>", "jantar": "<path d=\"M4 15h24\"/><path d=\"M7 15v11M25 15v11\"/><circle cx=\"11\" cy=\"10\" r=\"2.5\"/><circle cx=\"21\" cy=\"10\" r=\"2.5\"/>", "despensa": "<rect x=\"6\" y=\"4\" width=\"20\" height=\"24\" rx=\"2\"/><path d=\"M6 12h20M6 20h20\"/><path d=\"M10 8h3M16 16h4M11 24h5\"/>", "escritorio": "<rect x=\"7\" y=\"5\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M16 17v4M11 21h10\"/><path d=\"M4 27h24\"/>", "closet": "<path d=\"M16 8a2.5 2.5 0 1 1 2.5 2.5L16 12\"/><path d=\"M16 12L4 21h24L16 12z\"/><path d=\"M5 27h22\"/>", "edicula": "<path d=\"M4 15L13 7l9 8\"/><path d=\"M7 13v13h12V13\"/><path d=\"M22 18h6v8h-6\"/><path d=\"M11 26v-6h4v6\"/>", "mezanino": "<path d=\"M4 5h24v22H4z\"/><path d=\"M4 15h16\"/><path d=\"M20 15v12M9 15v-4h6v4\"/>", "lareira": "<rect x=\"5\" y=\"6\" width=\"22\" height=\"21\" rx=\"2\"/><path d=\"M10 27v-8a6 6 0 0 1 12 0v8\"/><path d=\"M16 26c-2.5 0-3.5-1.6-3.5-3.2 0-2 3.5-3.8 3.5-6.3 1.8 1.8 3.5 3.6 3.5 6.3 0 1.6-1 3.2-3.5 3.2z\"/>", "arcond": "<rect x=\"4\" y=\"7\" width=\"24\" height=\"9\" rx=\"2\"/><path d=\"M8 12h16\"/><path d=\"M10 20c0 2-1.5 2-1.5 4M16 20c0 2-1.5 2-1.5 4M22 20c0 2-1.5 2-1.5 4\"/>", "solar": "<path d=\"M7 12h18l3 12H4z\"/><path d=\"M13 12l-2 12M19 12l2 12M5.5 18h21\"/><circle cx=\"26\" cy=\"5\" r=\"2\"/>", "poco": "<path d=\"M6 17h20v10H6z\"/><path d=\"M9 17V8h14v9\"/><path d=\"M16 8V4M13 4h6\"/><path d=\"M6 22h20\"/>", "cerca": "<path d=\"M3 11h26M3 18h26\"/><path d=\"M7 6v21M16 6v21M25 6v21\"/><path d=\"M5 6l2-2 2 2M14 6l2-2 2 2M23 6l2-2 2 2\"/>", "camera": "<rect x=\"5\" y=\"8\" width=\"20\" height=\"10\" rx=\"3\"/><circle cx=\"21\" cy=\"13\" r=\"2.5\"/><path d=\"M9 18v5M5 23h8\"/>", "alarme": "<path d=\"M9 22V15a7 7 0 0 1 14 0v7\"/><path d=\"M6 22h20v4H6z\"/><path d=\"M16 4v2M5 8l2 2M27 8l-2 2\"/>", "portao": "<path d=\"M3 27h26M5 27V9M27 27V9\"/><path d=\"M5 12h22M5 22h22M11 12v10M16 12v10M21 12v10\"/>", "interfone": "<rect x=\"9\" y=\"4\" width=\"14\" height=\"24\" rx=\"3\"/><circle cx=\"16\" cy=\"11\" r=\"2.5\"/><path d=\"M13 18h6M13 22h6\"/>", "playground": "<path d=\"M7 5v22M7 9h4l12 14h4\"/><path d=\"M11 9v14\"/>", "quadra": "<rect x=\"4\" y=\"8\" width=\"24\" height=\"16\" rx=\"1\"/><path d=\"M16 8v16\"/><circle cx=\"16\" cy=\"16\" r=\"3\"/><path d=\"M4 13h4v6H4M28 13h-4v6h4\"/>", "sauna": "<path d=\"M5 25h22M7 25v-9h18v9\"/><path d=\"M11 12c0-2 2-2 2-4M16 12c0-2 2-2 2-4M21 12c0-2 2-2 2-4\"/>", "mobiliado": "<path d=\"M12 5h8l3 9H9z\"/><path d=\"M16 14v11M11 27h10\"/>", "pet": "<circle cx=\"9\" cy=\"13\" r=\"2.5\"/><circle cx=\"14\" cy=\"8\" r=\"2.5\"/><circle cx=\"20\" cy=\"8\" r=\"2.5\"/><circle cx=\"25\" cy=\"13\" r=\"2.5\"/><path d=\"M16 15c-4 0-7 5-7 8 0 2.5 3 3 7 1 4 2 7 1.5 7-1 0-3-3-8-7-8z\"/>", "vista": "<path d=\"M3 26l8-13 5 8 4-5 9 10z\"/><circle cx=\"24\" cy=\"8\" r=\"2.5\"/>"});
  Object.assign(ICO86, {"hall": "<path d=\"M9 27V5h14v22\"/><path d=\"M5 27h22\"/><circle cx=\"19\" cy=\"16.5\" r=\"1\"/>", "copa": "<path d=\"M5 17h22M8 17v10M24 17v10\"/><path d=\"M12 8h7v4a3.5 3.5 0 0 1-7 0z\"/><path d=\"M19 9h1.5a1.5 1.5 0 0 1 0 3H19\"/>", "gourmet": "<path d=\"M10 18a4.5 4.5 0 0 1 .5-9 5.5 5.5 0 0 1 11 0 4.5 4.5 0 0 1 .5 9z\"/><path d=\"M10 18v7h12v-7M10 21.5h12\"/>", "servico": "<path d=\"M6 12h20l-2 14H8z\"/><path d=\"M10 12V7h12v5\"/><path d=\"M12 17h8\"/>", "dependencia": "<path d=\"M4 25V13M4 21h17v4M21 25v-4a2 2 0 0 0-2-2h-7v2\"/><circle cx=\"8\" cy=\"17.5\" r=\"2\"/><path d=\"M25 27V6h4\"/>", "hospedes": "<path d=\"M3 26V13M3 22h18v4M21 26v-4a2 2 0 0 0-2-2h-7v2\"/><circle cx=\"7\" cy=\"18\" r=\"2\"/><rect x=\"21\" y=\"8\" width=\"8\" height=\"9\" rx=\"1.5\"/><path d=\"M23.5 8V6h3v2\"/>", "bebe": "<path d=\"M5 8v19M27 8v19M5 12h22M5 23h22\"/><path d=\"M10 12v11M14 12v11M18 12v11M22 12v11\"/>", "brinquedoteca": "<rect x=\"5\" y=\"17\" width=\"10\" height=\"10\" rx=\"1\"/><rect x=\"17\" y=\"17\" width=\"10\" height=\"10\" rx=\"1\"/><path d=\"M11 15l5-9 5 9z\"/>", "atelie": "<path d=\"M16 5C9 5 4 9.5 4 15.5S9 27 15 27c2 0 2.5-1.5 2-3s0-3 2-3h3c3 0 6-2 6-6C28 9 22.5 5 16 5z\"/><circle cx=\"10\" cy=\"15\" r=\"1.5\"/><circle cx=\"13\" cy=\"10\" r=\"1.5\"/><circle cx=\"19\" cy=\"9.5\" r=\"1.5\"/><circle cx=\"23.5\" cy=\"13.5\" r=\"1.5\"/>", "cinema": "<rect x=\"4\" y=\"5\" width=\"24\" height=\"15\" rx=\"2\"/><path d=\"M14 9.5v6l5-3z\"/><path d=\"M10 26h12M16 20v6\"/>", "jogos": "<path d=\"M9 11h14a5 5 0 0 1 5 5l1 6a3 3 0 0 1-5.5 1.6L21 21H11l-2.5 2.6A3 3 0 0 1 3 22l1-6a5 5 0 0 1 5-5z\"/><path d=\"M10 14v4M8 16h4\"/><circle cx=\"21\" cy=\"15\" r=\".9\"/><circle cx=\"23.5\" cy=\"17.5\" r=\".9\"/>", "adega": "<path d=\"M9 4h4v6l2 3v14H7V13l2-3z\"/><path d=\"M19 12h8c0 4-1.5 6-4 6s-4-2-4-6zM23 18v7M20 27h6\"/>", "biblioteca": "<path d=\"M4 27h24\"/><rect x=\"6\" y=\"8\" width=\"4\" height=\"19\"/><rect x=\"11\" y=\"5\" width=\"4\" height=\"22\"/><path d=\"M17 10l4-1 4 17-4 1z\"/>", "sotao": "<path d=\"M3 17L16 5l13 12\"/><path d=\"M6 15v12h20V15\"/><path d=\"M13 12.5h6v4.5h-6z\"/>", "porao": "<path d=\"M4 13L16 4l12 9\"/><path d=\"M7 11v16h18V11\"/><path d=\"M4 18h24\"/><path d=\"M16 20v5M13.5 22.5L16 25l2.5-2.5\"/>", "deposito": "<path d=\"M4 10l12-5 12 5v13l-12 5-12-5z\"/><path d=\"M4 10l12 5 12-5M16 15v13\"/>", "terraco": "<path d=\"M7 13a9 6 0 0 1 18 0z\"/><path d=\"M16 13v7\"/><path d=\"M4 20h24M6 20v7M26 20v7\"/>", "quintal": "<path d=\"M4 27h24\"/><path d=\"M6 27v-9M11 27v-9M16 27v-9M21 27v-9M26 27v-9M4 21h24\"/><circle cx=\"22\" cy=\"9\" r=\"3.5\"/>", "hidro": "<path d=\"M4 16h24v3a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z\"/><circle cx=\"12\" cy=\"10\" r=\"1.6\"/><circle cx=\"17\" cy=\"6.5\" r=\"1.6\"/><circle cx=\"21\" cy=\"11\" r=\"1.6\"/><path d=\"M10 25l-1 3M22 25l1 3\"/>", "deck": "<path d=\"M4 14h24v13H4z\"/><path d=\"M4 18.5h24M4 23h24M10 14v4.5M19 18.5V23M13 23v4M23 14v4.5\"/>", "pergolado": "<path d=\"M4 10h24M4 14h24\"/><path d=\"M8 8v19M24 8v19\"/><path d=\"M12 10v4M16 10v4M20 10v4\"/>", "quiosque": "<path d=\"M4 13L16 6l12 7z\"/><path d=\"M7 13v14M25 13v14M7 19h18M4 27h24\"/>", "horta": "<path d=\"M4 22h24v5H4z\"/><path d=\"M10 22v-6M10 16c-3 0-4-2-4-4 3 0 4 2 4 4zM10 16c0-3 2-4 4-4 0 3-2 4-4 4z\"/><path d=\"M21 22v-8M21 14c-3 0-4-2-4-4 3 0 4 2 4 4zM21 14c0-3 2-4 4-4 0 3-2 4-4 4z\"/>", "pomar": "<circle cx=\"16\" cy=\"12\" r=\"8\"/><path d=\"M16 20v8M11 28h10\"/><circle cx=\"13\" cy=\"10\" r=\"1.2\"/><circle cx=\"19\" cy=\"12\" r=\"1.2\"/><circle cx=\"15\" cy=\"15\" r=\"1.2\"/>", "lago": "<path d=\"M3 13c2 0 2-1.4 4.3-1.4S9.6 13 11.9 13s2.3-1.4 4.6-1.4S18.8 13 21 13s2.2-1.4 4.4-1.4S27.8 13 29 13\"/><path d=\"M3 19c2 0 2-1.4 4.3-1.4S9.6 19 11.9 19s2.3-1.4 4.6-1.4S18.8 19 21 19s2.2-1.4 4.4-1.4S27.8 19 29 19\"/><path d=\"M3 25c2 0 2-1.4 4.3-1.4S9.6 25 11.9 25s2.3-1.4 4.6-1.4S18.8 25 21 25s2.2-1.4 4.4-1.4S27.8 25 29 25\"/>", "gas": "<path d=\"M16 27c-4 0-6-2.5-6-5.5 0-4 6-7 6-12 3 3 6 7 6 12 0 3-2 5.5-6 5.5z\"/><path d=\"M16 27c-1.5 0-2.5-1-2.5-2.5S16 21 16 21s2.5 2 2.5 3.5S17.5 27 16 27z\"/>", "aquecimento": "<path d=\"M13 19V7a3 3 0 0 1 6 0v12a5 5 0 1 1-6 0z\"/><path d=\"M16 12v9\"/><circle cx=\"16\" cy=\"23\" r=\"2\"/>", "fibra": "<path d=\"M4 12a17 17 0 0 1 24 0M8 16a11 11 0 0 1 16 0M12 20a5 5 0 0 1 8 0\"/><circle cx=\"16\" cy=\"24\" r=\"1.4\"/>", "gerador": "<rect x=\"5\" y=\"8\" width=\"22\" height=\"16\" rx=\"2\"/><path d=\"M17 11.5l-4 6h5l-3 5\"/><path d=\"M9 24v3M23 24v3\"/>", "cisterna": "<path d=\"M7 9v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9\"/><ellipse cx=\"16\" cy=\"9\" rx=\"9\" ry=\"3\"/><path d=\"M16 14s3 3.5 3 5.5a3 3 0 0 1-6 0c0-2 3-5.5 3-5.5z\"/>", "carregador": "<path d=\"M11 4v6M21 4v6M8 10h16v4a8 8 0 0 1-16 0z\"/><path d=\"M16 22v6\"/><path d=\"M17 12.5L14.5 16h3L15 19.5\"/>", "bicicletario": "<circle cx=\"8\" cy=\"21\" r=\"5\"/><circle cx=\"24\" cy=\"21\" r=\"5\"/><path d=\"M8 21l5-9h7l4 9M13 12l3 9H8M18 9h4\"/>", "coworking": "<rect x=\"7\" y=\"7\" width=\"18\" height=\"12\" rx=\"1.5\"/><path d=\"M4 24h24l-2-5H6z\"/>", "acessivel": "<circle cx=\"15\" cy=\"5.5\" r=\"2\"/><path d=\"M15 9v8h7l3 6\"/><path d=\"M15 13h6\"/><path d=\"M11 14.5a7 7 0 1 0 9 9\"/>", "sol": "<circle cx=\"16\" cy=\"16\" r=\"5\"/><path d=\"M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2 2M22.5 22.5l2 2M7.5 24.5l2-2M22.5 9.5l2-2\"/>", "reformado": "<rect x=\"5\" y=\"5\" width=\"18\" height=\"7\" rx=\"1.5\"/><path d=\"M23 8.5h3v6H15v4\"/><rect x=\"13\" y=\"18.5\" width=\"4\" height=\"9\" rx=\"1\"/>", "estreia": "<path d=\"M16 4l2.5 7.5L26 14l-7.5 2.5L16 24l-2.5-7.5L6 14l7.5-2.5z\"/><path d=\"M25 22l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z\"/>", "financia": "<path d=\"M4 12L16 5l12 7M6 12h20M8 12v11M13 12v11M19 12v11M24 12v11M4 26h24\"/>", "permuta": "<path d=\"M6 11h19l-4-4M26 21H7l4 4\"/>"});   // R87: mais cômodos e itens
  ICO86.ondefica = '<path d="M6 14L16 6l10 8"/><path d="M9 12v8h14v-8"/><path d="M14 20v-4h4v4"/><path d="M3 27h26M3 23h26M5 27v-6M10 27v-6M15 27v-6M20 27v-6M25 27v-6"/>';   // R87: casa atrás do muro
  var ONDE86 = { cf: 'Condomínio fechado', ca: 'Condomínio aberto', lot: 'Loteamento', bairro: 'Bairro', outro: '' };
  var MAP86 = {};
  function ic86(k, cl) { return '<svg viewBox="0 0 32 32" class="' + (cl || 'r86-ic') + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (ICO86[k] || ICO86.mais) + '</svg>'; }
  function e86(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function onde86(a) {
    var o = a && a.onde, t = o && ONDE86[o.t] !== undefined ? ONDE86[o.t] : null, b = a && a.end && a.end.bairro;
    var p = [];
    if (t !== null) p.push(o.t === 'outro' ? (o.n || '') : t + (o.n ? ' ' + o.n : ''));
    if (b && !(o && o.t === 'bairro' && o.n === b)) p.push(b);
    return p.filter(Boolean).join(' · ');
  }
  function m2txt(v) { return (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' m²'; }
  // imóvel sem as linhas novas (cadastrado antes, ou o exemplo da prévia): os cômodos saem das informações que o site já tem
  var NOME86 = { cama: 'Quartos', suite: 'Suítes', banho: 'Banheiros', garagem: 'Garagem', sofa: 'Salas', cozinha: 'Cozinha', area: 'Área', andar: 'Andar', condominio: 'Condomínio', frente: 'Frente' };
  var COMODO86 = ['cama', 'suite', 'banho', 'garagem', 'sofa', 'cozinha', 'area', 'andar', 'frente', 'condominio'];
  function deInfos86(a, comodos) {
    return (a.infos || []).filter(function (o) { return o && o.t && (COMODO86.indexOf(o.i) >= 0) === comodos; }).map(function (o) {
      var k = ICO86[o.i] ? o.i : (o.i === 'churrasqueira' ? 'churras' : 'mais');
      return comodos ? { k: k, n: NOME86[o.i] || String(o.t), s: NOME86[o.i] ? String(o.t) : '', o: '' } : { k: k, n: String(o.t).charAt(0).toUpperCase() + String(o.t).slice(1), o: '' };
    });
  }
  function linhas86(a) {
    if (!Array.isArray(a.cm)) return deInfos86(a, true);
    var L = [];
    (Array.isArray(a.cm) ? a.cm : []).forEach(function (r) { if (r && r.n) L.push({ k: r.k, n: r.n, s: r.k === 'garagem' ? (r.q > 1 ? r.q + ' vagas' : '1 vaga') : (r.m2 ? m2txt(r.m2) : ''), o: r.o || '' }); });
    return L;
  }
  // R87 (John 26/11): medidas e valores (áreas, terreno, andar, condomínio, IPTU, frente) não apareciam no cartão nem na ficha
  var AR86 = { total: 'Área total', construida: 'Área construída', terreno: 'Terreno', privativa: 'Área privativa' };
  function med86(a) {
    var L = [];
    (Array.isArray(a.ar) ? a.ar : []).forEach(function (r) {
      if (!r || !(+r.m2 > 0)) return; var k = r.r === 'outra' ? (r.n || '') : r.r, nm = AR86[k] || (r.n ? 'Área ' + r.n : 'Área');
      L.push({ k: k === 'terreno' ? 'terreno' : 'area', n: nm, v: m2txt(r.m2) });
    });
    (Array.isArray(a.infos) ? a.infos : []).forEach(function (o) {
      if (!o || typeof o.t !== 'string') return;
      if (o.i === 'andar') L.push({ k: 'andar', n: 'Andar', v: o.t.replace(/\s*andar\s*$/i, '') });
      else if (o.i === 'frente') L.push({ k: 'frente', n: 'Frente', v: o.t.replace(/\s*de frente\s*$/i, '') });
      else if (o.i === 'condominio' && /^(Condomínio|IPTU)\s+R\$/i.test(o.t)) { var m = /^(Condomínio|IPTU)\s+(R\$.*)$/i.exec(o.t); L.push({ k: 'condominio', n: m[1] === 'IPTU' ? 'IPTU' : 'Condomínio', v: m[2].replace(/\/mês$/, '') + '/mês' }); }
    });
    return L;
  }
  function itens86(a) { if (!Array.isArray(a.ot)) return deInfos86(a, false); return (a.ot).filter(function (r) { return r && r.n; }).map(function (r) { return { k: r.k, n: r.n, o: r.o || '' }; }); }
  var vit0 = P.vitrine;
  function rotulo86(o) {   // "3 (1 suíte)" → "3 quartos (1 suíte)"; "1" → "1 banheiro"
    if (!o || typeof o.t !== 'string') return o;
    var m = /^\s*(\d+)(.*)$/.exec(o.t); if (!m || /[a-zà-ú]/i.test(m[2].replace(/\(.*\)/, ''))) return o;
    var n = +m[1], w = o.i === 'cama' ? (n === 1 ? 'quarto' : 'quartos') : o.i === 'banho' ? (n === 1 ? 'banheiro' : 'banheiros') : '';
    return w ? { i: o.i, t: n + ' ' + w + m[2] } : o;
  }
  P.vitrine = function (e) {
    var r = vit0 ? vit0(e) : e;
    if (P.pagina === 'site') r = (r || []).map(function (a) { if (!a || !Array.isArray(a.infos)) return a; var c = Object.assign({}, a); c.infos = a.infos.map(rotulo86); return c; });
    (r || []).forEach(function (a) { if (a && a.id) MAP86[a.id] = a; }); return r;
  };

  // contador do Desempenho: o site (1 vez por aba) e cada imóvel aberto (1 vez por aba). Sem cookie, sem dado pessoal.
  var VISTO86 = {};
  function visto86(id) {
    if (!P.srv || P.pagina !== 'site' || /[?&]painel=1/.test(location.search)) return;
    var k = id || '_site'; if (VISTO86[k]) return; VISTO86[k] = 1;
    try { if (sessionStorage.getItem('erv_v_' + k)) return; sessionStorage.setItem('erv_v_' + k, '1'); } catch (e) { /* segue */ }
    req('POST', 'api/visto', id ? { id: id } : {});
  }
  P.visto = visto86;

  // cartão da lista
  function cartao86(art) {
    if (art.dataset.r86 || !pc86()) return; var a = MAP86[art.dataset.id]; if (!a) return;
    art.dataset.r86 = '1'; art.classList.add('r86c');
    var ov = art.querySelector('.ov7'), nm = art.querySelector('.nm8'), bt = art.querySelector('.bt7'); if (!ov) return;
    var od = onde86(a);
    if (od && nm) nm.insertAdjacentHTML('afterend', '<p class="r86-onde">' + ic86('ondefica', 'r86-ic s') + '<span>' + e86(od) + '</span></p>');
    // R86e (John 24/11): sem "Ver cômodos +"; os cômodos e o que o imóvel tem aparecem direto no cartão, em 2 linhas de pílulas
    var cm = linhas86(a), ot = itens86(a), md = med86(a);
    if (cm.length || ot.length || md.length) {
      var pil = function (r) { return '<span class="r86-pl">' + ic86(r.k, 'r86-ic s') + e86(r.n) + (r.s ? ' <small>' + e86(r.s) + '</small>' : '') + '</span>'; };
      var h = (cm.length ? '<div class="r86-lin"><span class="r86-lr">Cômodos</span><div class="r86-pls">' + cm.map(pil).join('') + '</div></div>' : '') +
        (md.length ? '<div class="r86-lin"><span class="r86-lr">Medidas</span><div class="r86-pls">' + md.map(function (r) { return '<span class="r86-pl">' + ic86(r.k, 'r86-ic s') + e86(r.n) + ' <small>' + e86(r.v) + '</small></span>'; }).join('') + '</div></div>' : '') +
        (ot.length ? '<div class="r86-lin"><span class="r86-lr">O que tem</span><div class="r86-pls">' + ot.map(pil).join('') + '</div></div>' : '');
      ov.insertAdjacentHTML('beforeend', '<div class="r86-info">' + h + '</div>'); art.classList.add('r86-tem');
    }
  }

  // ficha do imóvel (o site chama P.botaoVisita ao montar a ficha: é a deixa para completar)
  var bv0 = P.botaoVisita;
  P.botaoVisita = function (a) { if (a && a.id) { setTimeout(function () { ficha86(a); fichaCel86(a); fotos86(); legal86(); }, 0); visto86(a.id); } return ''; };
  // John 23/11 (R86c): a foto vira um card, uma por vez, com setas e "1 / N" (PC = A, celular = C)
  var FI86 = 0;
  function tbs86() { return [].slice.call(document.querySelectorAll('.sc12 .th12 .tb12')); }
  function fotos86() {
    var fp = document.querySelector('.sc12 .fp12'); if (!fp) return;
    var n = tbs86().length, box = fp.querySelector('.r86-fa');
    if (!box) {
      box = el('div', { class: 'r86-fa' });
      box.innerHTML = '<button type="button" class="r86-ar p" data-r86-ar="-1" aria-label="Foto anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
        '<button type="button" class="r86-ar n" data-r86-ar="1" aria-label="Próxima foto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button><span class="r86-nf" aria-live="polite"></span>';
      fp.appendChild(box);
    }
    box.hidden = n < 2; cont86();
  }
  // R86l (John 25/11): a fila de miniaturas fica parada (todas as fotos, mesma ordem); a aberta tem a classe 'on'
  function pos86() { var l = tbs86(), i = 0; l.forEach(function (t) { if (t.classList.contains('on')) i = +t.dataset.i; }); return { i: i, n: l.length, l: l }; }
  function cont86() { var p = pos86(), c = document.querySelector('.sc12 .r86-nf'); if (c) c.textContent = (p.i + 1) + ' / ' + p.n; }
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('.sc12 .th12 .tb12');
    if (t) { if (!t.classList.contains('bl')) setTimeout(cont86, 0); return; }
    var b = ev.target.closest && ev.target.closest('[data-r86-ar]'); if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    var p = pos86(); if (p.n < 2) return;
    var ii = (p.i + (+b.getAttribute('data-r86-ar')) + p.n) % p.n, alvo = p.l.filter(function (t) { return +t.dataset.i === ii; })[0];
    if (!alvo) return;   // foto travada: o clique na miniatura mostra o mesmo aviso de entrar
    alvo.click(); setTimeout(cont86, 0);   // foto bloqueada: o site mostra o mesmo aviso de quando se toca na miniatura
  }, true);   // John 23/11: um botão só na ficha (sem Pedir visita)
  // R86g (John 24/11, D): ficha no celular = foto no topo com cantos arredondados, preço, resumo em 3 números e abas
  // Sobre · Cômodos · Onde fica (o mapa do site vai para a aba "Onde fica"; o botão do WhatsApp continua o do site)
  function fichaCel86(a0) {
    var a = MAP86[a0.id] || a0, nv = document.querySelector('.sc12 .nv12'); if (!nv || pc86()) return;
    var velho = nv.querySelector('.r86-d'); if (velho) { var mp0 = velho.querySelector('.nv24p'); if (mp0) (nv.querySelector('.nv24s') || nv).appendChild(mp0); velho.remove(); }
    var pills = [].map.call(nv.querySelectorAll('.if8 li'), function (li) { return li.textContent.trim(); }).join(' · ');
    function num(re) { var m = re.exec(pills); return m ? +m[1] : 0; }
    var qt = num(/(\d+)\s+quartos?/i), su = num(/(\d+)\s+su[ií]tes?/i), bn = num(/(\d+)\s+banheiros?/i), vg = num(/(\d+)\s+vagas?/i);
    var res = [];
    if (qt) res.push(['cama', qt, qt > 1 ? 'quartos' : 'quarto']);
    if (su) res.push(['suite', su, su > 1 ? 'suítes' : 'suíte']); else if (bn) res.push(['banho', bn, bn > 1 ? 'banheiros' : 'banheiro']);
    if (vg) res.push(['garagem', vg, vg > 1 ? 'vagas' : 'vaga']);
    var od = onde86(a), oe = a.onde && a.onde.e, cm = linhas86(a), ot = itens86(a), md = med86(a), mapa = nv.querySelector('.nv24p');
    var abas = [['s', 'Sobre']]; if (cm.length || md.length) abas.push(['c', cm.length ? 'Cômodos' : 'Medidas']); if (mapa || od || a.cidade) abas.push(['o', 'Onde fica']);
    var h = '<div class="r86-d">' + (res.length ? '<div class="r86-res">' + res.slice(0, 3).map(function (r) { return '<div>' + ic86(r[0]) + '<b>' + r[1] + '</b><small>' + r[2] + '</small></div>'; }).join('') + '</div>' : '') +
      (abas.length > 1 ? '<div class="r86-tabs" role="tablist">' + abas.map(function (t, i) { return '<button type="button" role="tab" data-r86-tab="' + t[0] + '" aria-selected="' + (i === 0) + '">' + t[1] + '</button>'; }).join('') + '</div>' : '') +
      '<div class="r86-pn" data-r86-pn="s">' + (ot.length ? '<p class="r86-h">O que tem</p><div class="r86-pls">' + ot.map(function (r) { return '<span class="r86-pl">' + ic86(r.k, 'r86-ic s') + e86(r.n) + '</span>'; }).join('') + '</div>' : '') +
        (!ot.length && pills ? '<p class="r86-h">O imóvel</p><div class="r86-pls">' + [].map.call(nv.querySelectorAll('.if8 li'), function (li) { return '<span class="r86-pl">' + e86(li.textContent.trim()) + '</span>'; }).join('') + '</div>' : '') + '</div>' +
      (cm.length || md.length ? '<div class="r86-pn" data-r86-pn="c" hidden>' + cm.map(function (r) { return '<div class="r86-row">' + ic86(r.k) + '<b>' + e86(r.n) + (r.o ? '<em>' + e86(r.o) + '</em>' : '') + '</b>' + (r.s ? '<small>' + e86(r.s) + '</small>' : '') + '</div>'; }).join('') +
        (md.length ? (cm.length ? '<p class="r86-h">Medidas e valores</p>' : '') + md.map(function (r) { return '<div class="r86-row">' + ic86(r.k) + '<b>' + e86(r.n) + '</b><small>' + e86(r.v) + '</small></div>'; }).join('') : '') + '</div>' : '') +
      '<div class="r86-pn" data-r86-pn="o" hidden>' + (od ? '<div class="r86-row">' + ic86('ondefica') + '<b>' + e86(od) + (oe ? '<em>' + e86(oe) + '</em>' : '') + '</b></div>' : '') + '</div></div>';
    var nh = nv.querySelector('.nh12'); if (nh) nh.insertAdjacentHTML('afterend', h); else nv.insertAdjacentHTML('afterbegin', h);
    var box = nv.querySelector('.r86-d'), pno = box.querySelector('[data-r86-pn=o]'); if (mapa && pno) pno.appendChild(mapa);
    if (pno) { var hp = pno.querySelector('.nv24p'); if (!hp) { hp = el('div', { class: 'nv24p r87-h' }); pno.appendChild(hp); } onde87(a, hp); }
    nv.classList.add('r86-dd');
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-r86-tab]'); if (!b) return;
    var box = b.closest('.r86-d'); if (!box) return;
    box.querySelectorAll('[data-r86-tab]').forEach(function (o) { o.setAttribute('aria-selected', String(o === b)); });
    box.querySelectorAll('[data-r86-pn]').forEach(function (p) { p.hidden = p.getAttribute('data-r86-pn') !== b.getAttribute('data-r86-tab'); });
    if (b.getAttribute('data-r86-tab') === 'o' && M87.vivo) setTimeout(function () { try { M87.vivo.mapa.resize(); } catch (e) { /* segue */ } }, 30);
  });
  // R86n (John 25/11): (1) deslizar o dedo na foto troca de foto (a foto não se mexe; só troca, como a seta);
  // (2) troca sem "flic": a foto anterior fica por baixo e a nova surge por cima (esmaece em 0,22 s) quando já estiver decodificada.
  // O cartão de informações não é mais refeito a cada foto (remendo R86n), então não treme.
  (function () {
    var d = null;
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || !e.isPrimary) { d = null; return; }
      var f = e.target.closest && e.target.closest('.sc12.f5 .fp12'); if (!f || e.target.closest('button')) { d = null; return; }
      d = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now() };
    }, true);
    document.addEventListener('pointerup', function (e) {
      if (!d || e.pointerId !== d.id) return; var o = d; d = null;
      var dx = e.clientX - o.x, dy = e.clientY - o.y;
      if (Date.now() - o.t > 900 || Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      var b = document.querySelector('.sc12 .r86-ar.' + (dx < 0 ? 'n' : 'p')); if (b) b.click();
    }, true);
    document.addEventListener('pointercancel', function () { d = null; }, true);
    var PRE = {};
    function pre86() { document.querySelectorAll('.sc12.f5 .th12 .tb12:not(.bl) img').forEach(function (t) { var u = t.getAttribute('src'); if (u && !PRE[u]) { PRE[u] = new Image(); PRE[u].decoding = 'async'; PRE[u].src = u; } }); }
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        var t = m.target; if (!t.classList || !t.classList.contains('fx12') || t.classList.contains('r86-vel') || !m.oldValue || m.oldValue === t.getAttribute('src')) return;
        var f = t.parentNode; if (!f) return;
        f.querySelectorAll('.r86-vel').forEach(function (x) { x.remove(); });
        var v = t.cloneNode(false); v.classList.add('r86-vel'); ['srcset', 'sizes', 'alt', 'aria-label', 'style'].forEach(function (k) { v.removeAttribute(k); });
        v.setAttribute('aria-hidden', 'true'); v.setAttribute('src', m.oldValue); f.insertBefore(v, t);
        t.style.transition = 'none'; t.style.opacity = '0';
        var ok = function () { requestAnimationFrame(function () { t.style.transition = 'opacity .22s ease'; t.style.opacity = '1'; setTimeout(function () { v.remove(); t.style.transition = ''; t.style.opacity = ''; }, 280); }); };
        (t.decode ? t.decode() : Promise.resolve()).then(ok, ok);
      });
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['src'], attributeOldValue: true });
    setInterval(pre86, 900);
  })();
  function ficha86(a0) {
    var a = MAP86[a0.id] || a0, nv = document.querySelector('.sc12 .nv12'); if (!nv || !pc86()) return;
    var velho = nv.querySelector('.r86-f'); if (velho) velho.remove();
    var od = onde86(a), oe = a.onde && a.onde.e, cm = linhas86(a), ot = itens86(a), md = med86(a);
    if (!od && !cm.length && !ot.length && !md.length) { nv.classList.remove('r86-fo'); mapaPc87(a, nv); return; }
    var h = '<div class="r86-f">';
    if (od) h += '<div class="r86-fo1">' + ic86('ondefica') + '<span><b>' + e86(od) + '</b>' + (oe ? '<small>' + e86(oe) + '</small>' : '') + '</span></div>';
    if (cm.length) h += '<p class="r86-ft">Cômodos e medidas</p><div class="r86-gr">' + cm.map(function (r) { return '<div class="r86-t">' + ic86(r.k) + '<b>' + e86(r.n) + '</b>' + (r.s ? '<small>' + e86(r.s) + '</small>' : '') + (r.o ? '<em>' + e86(r.o) + '</em>' : '') + '</div>'; }).join('') + '</div>';
    if (md.length) h += '<p class="r86-ft">Medidas e valores</p><div class="r86-gr">' + md.map(function (r) { return '<div class="r86-t">' + ic86(r.k) + '<b>' + e86(r.v) + '</b><small>' + e86(r.n) + '</small></div>'; }).join('') + '</div>';
    if (ot.length) h += '<p class="r86-ft">O que o imóvel tem</p><div class="r86-gr">' + ot.map(function (r) { return '<div class="r86-t">' + ic86(r.k) + '<b>' + e86(r.n) + '</b>' + (r.o ? '<em>' + e86(r.o) + '</em>' : '') + '</div>'; }).join('') + '</div>';
    h += '</div>';
    var nh = nv.querySelector('.nh12'), alvo = nv.querySelector('.nv24s') || nh;
    if (alvo && alvo !== nh) alvo.insertAdjacentHTML('afterbegin', h); else if (nh) nh.insertAdjacentHTML('afterend', h); else nv.insertAdjacentHTML('afterbegin', h);
    nv.classList.toggle('r86-fo', cm.length + ot.length + md.length > 0);
    mapaPc87(a, nv);
  }
  function mapaPc87(a, nv) {
    var host = nv.querySelector('.nv24p');
    if (!host) { var base = nv.querySelector('.nv24s') || nv.querySelector('.r86-f') || nv; host = base.querySelector('.r87-h') || el('div', { class: 'nv24p r87-h' }); if (!host.parentNode) base.appendChild(host); }
    onde87(a, host);
  }

  /* ---------- R87 (John 26/11): "Onde fica" com o satélite da Esri, igual em todas as cidades, com zoom ----------
     Substitui o mapa de imagem da ficha (só existia para Santo Antônio). Sem entrar: a cidade, sem o ponto do imóvel.
     Depois de entrar: a área aproximada (círculo de 250 m, deslocado) ou o ponto exato, como o corretor marcou no painel. */
  var M87 = { url: (function () { var s = document.querySelector('script[src*="ponte.js"]'); return s ? s.src.replace(/ponte\.js(\?.*)?$/, '') + 'mapa87.js' : 'mapa87.js'; })(), p: null, vivo: null };
  function mapa87js() {
    if (window.MAPA87) return Promise.resolve(window.MAPA87);
    if (M87.p) return M87.p;
    M87.p = new Promise(function (ok, erro) { var s = document.createElement('script'); s.src = M87.url; s.async = true; s.onload = function () { ok(window.MAPA87); }; s.onerror = function () { M87.p = null; erro(new Error('mapa87')); }; document.head.appendChild(s); });
    return M87.p;
  }
  function onde87(a, host) {
    if (!host || !a || !a.cidade) return;
    var velho = host.querySelector('.r87-m'); if (velho && velho.dataset.id === String(a.id)) return; if (velho) velho.remove();
    host.querySelectorAll('.m15').forEach(function (m) { m.classList.add('r87-esc'); });
    var lib = !!contaVisitante(), ll = a.loc && a.loc.ll, modo = a.mapa || (ll ? 'area' : 'nada'), mostra = lib && ll && modo !== 'nada';
    var g = g87(a), txt = mostra ? (modo === 'pino' ? 'Ponto exato ' + g.d + ' ' + g.s : 'Área aproximada ' + g.d + ' ' + g.s + ' (o círculo não fica centrado na casa)') : '';
    var box = el('div', { class: 'r87-m' }); box.dataset.id = String(a.id);
    box.innerHTML = '<div class="r87-mm" role="region" aria-label="Mapa de satélite de ' + e86(a.cidade) + '"></div>' +
      (mostra ? '<small class="r87-mc">' + e86(txt) + '</small>' : '<span class="r87-mk">' + (lib ? '<b>' + e86(a.cidade) + '</b><small>O corretor ainda vai marcar ' + g.o + ' ' + g.s + ' no mapa.</small>' :
        '<b>Onde fica ' + g.o + ' ' + g.s + '</b><small>aparece para quem entrou</small><button type="button" class="m15b" data-m15="entrar">Entrar</button>') + '</span>');
    host.insertBefore(box, host.firstChild);
    var alvo = box.querySelector('.r87-mm');
    mapa87js().then(function (M) {
      return (mostra ? Promise.resolve(ll) : M.cidade(a.cidade)).then(function (c) {
        if (!c) { box.classList.add('r87-sem'); return; }
        var centro = mostra && modo !== 'pino' ? M.desloca(a.id, ll, 250) : c;
        return M.novo(alvo, { centro: centro, zoom: mostra ? 15.2 : 12.6, cooperativo: true, area: mostra && modo !== 'pino' ? centro : null, pino: mostra && modo === 'pino' ? ll : null }).then(function (api) { M87.vivo = api; });
      });
    }).catch(function () { box.classList.add('r87-sem'); });
  }
  function g87(a) { var t = { casa: ['da', 'casa', 'a'], apartamento: ['do', 'apartamento', 'o'], terreno: ['do', 'terreno', 'o'], sobrado: ['do', 'sobrado', 'o'], sitio: ['do', 'sítio', 'o'], sala: ['da', 'sala', 'a'], galpao: ['do', 'galpão', 'o'] }[a.tipo] || ['do', 'imóvel', 'o']; return { d: t[0], s: t[1], o: t[2] }; }

  // "Anunciar meu imóvel" ao lado do Login (abre o mesmo formulário do "Quero vender")
  // R86f (John 24/11): o "Anunciar" fica fixo como o Login: mesmo lugar, mesmo fade, some e volta junto (lido a cada quadro;
  // só escreve quando algo do Login mudou, então parado não custa nada)
  var AN86 = '';
  function anunciar86() {
    var sc = document.querySelector('.sc12'), li = sc && sc.querySelector('.li12'); if (!li) return;
    var b = sc.querySelector('.pt-anun');
    if (!b) { b = el('button', { type: 'button', class: 'pt-anun', 'data-pt-vender': '1' }); b.innerHTML = '<span class="l">Anunciar meu imóvel</span><span class="c">Anunciar</span>'; sc.appendChild(b); AN86 = ''; }
    var s = getComputedStyle(li), q = li.getBoundingClientRect(), qs = sc.getBoundingClientRect();
    var vis = s.display !== 'none' && s.visibility !== 'hidden' && q.width > 0;
    var chave = vis ? [s.opacity, s.pointerEvents, s.fontSize, s.fontWeight, s.backgroundColor, s.borderTopColor, s.color, q.height, q.top - qs.top, qs.right - q.left].join('|') : 'x';
    if (chave === AN86 && b.isConnected) return; AN86 = chave;
    b.style.display = vis ? '' : 'none'; if (!vis) return;
    b.style.opacity = s.opacity; b.style.pointerEvents = +s.opacity < 0.05 ? 'none' : s.pointerEvents;
    // John 23/11: a letra do "Anunciar" do mesmo tamanho do "Login" (copia a letra, a altura e o vidro dele)
    b.style.fontSize = s.fontSize; b.style.fontWeight = s.fontWeight; b.style.letterSpacing = s.letterSpacing;
    b.style.height = q.height + 'px'; b.style.background = s.backgroundColor; b.style.borderColor = s.borderTopColor; b.style.color = s.color;
    b.style.top = (q.top - qs.top) + 'px';
    b.style.right = (qs.right - q.left + 8) + 'px';
  }
  function anQuadro86() { anunciar86(); requestAnimationFrame(anQuadro86); }
  // a lista some por baixo do grid de busca: a área de rolar começa no meio do grid (o grid fica por cima)
  function corte86() {
    var ls = document.querySelector('.sc12 .ls12'), bk = document.querySelector('.sc12 .bk12');
    if (!ls || !bk) return;
    var ql = ls.getBoundingClientRect(), qb = bk.getBoundingClientRect();
    if (!ql.height || !qb.height) return;
    var atual = parseFloat(ls.style.getPropertyValue('--r86d')) || 0, topo = ql.top + atual, d = Math.max(0, Math.round(topo - (qb.top + qb.height * 0.5)));
    if (Math.abs(d - atual) > 1) ls.style.setProperty('--r86d', d + 'px');
  }
  var T86 = 0;
  function ciclo86() {
    if (T86) return; T86 = requestAnimationFrame(function () {
      T86 = 0;
      document.querySelectorAll('.sc12 .lsi12 .cd12[data-id]:not([data-r86])').forEach(cartao86);
      anunciar86(); corte86();
    });
  }
  // R86f (John 24/11): no celular, o teclado não pode encolher o cenário. Enquanto alguém digita, a altura do site fica
  // travada na de antes do teclado (o teclado passa por cima). Chrome/Android: o meta viewport (interactive-widget) já faz isso.
  var H86 = { w: 0, h: 0, on: false, els: [] };
  /* R86h: modo PC x celular = a mesma conta do site (classe dk do .sc12; antes de existir, a proporção da janela) */
  function pc86() { var s = document.querySelector('.sc12'); if (s) return s.classList.contains('dk'); return innerWidth > Math.max(innerHeight, H86.h || 0) * .75; }
  function modo86() { var pc = pc86(), r = document.documentElement.classList; if (r.contains('r86pc') !== pc) r.toggle('r86pc', pc); if (r.contains('r86mo') === pc) r.toggle('r86mo', !pc); }
  /* R86k (John/Erivelto 25/11, iPhone): no celular o bloco de busca sobe para logo abaixo do topo (nome + Anunciar/Login),
     e o começo da lista sobe junto (o corte continua no meio do bloco, que agora está mais alto) */
  function sobe86() {
    var sc = document.querySelector('.sc12'); if (!sc) return;
    var up = 0;
    if (!pc86()) {
      var bk = sc.querySelector('.bk12'), hd = sc.querySelector('.hd12'), li = sc.querySelector('.li12');
      if (bk && hd) {
        var at = parseFloat(sc.style.getPropertyValue('--r86up')) || 0, top0 = bk.getBoundingClientRect().top + at;
        var base = Math.max(hd.getBoundingClientRect().bottom, li ? li.getBoundingClientRect().bottom : 0);
        if (base > 0 && top0 > 0) up = Math.max(0, Math.round(top0 - (base + 12)));
      }
    }
    var cur = parseFloat(sc.style.getPropertyValue('--r86up')) || 0;
    if (Math.abs(cur - up) > 1) sc.style.setProperty('--r86up', up + 'px');
  }
  /* R86l (John 25/11): em telas mais baixas o bloco de busca passava do fim da tela e o mapa ficava para fora, sem rolar.
     O mapa encolhe até caber (mínimo 180 px); se mesmo assim não couber, o bloco ganha rolagem por dentro. */
  var NAT86 = { k: '', h: 0 };
  function mapa86() {
    var sc = document.querySelector('.sc12'); if (!sc) return;
    var bk = sc.querySelector('.bk12'), mw = bk && bk.querySelector('.mw12'), mh = '', bh = '', rola = false;
    if (bk && mw && !pc86()) {
      var rm = mw.getBoundingClientRect(), rb = bk.getBoundingClientRect();
      if (rm.top > 0 && rm.height > 0 && getComputedStyle(bk).visibility !== 'hidden') {
        var vh = (H86.on && H86.h) ? H86.h : innerHeight, pad = Math.max(0, rb.bottom - rm.bottom), livre = Math.floor(vh - rm.top - pad - 14);
        var cur = sc.style.getPropertyValue('--r86mh'), chave = innerWidth + 'x' + vh;
        if (!cur || NAT86.k !== chave) NAT86 = { k: chave, h: rm.height };   /* altura natural do mapa (sem limite), para não ficar oscilando */
        if (livre < NAT86.h - 1) mh = Math.max(180, livre) + 'px';
        if (livre < 180) { rola = true; bh = Math.max(160, Math.floor(vh - rb.top - 12)) + 'px'; }
      }
    }
    if ((sc.style.getPropertyValue('--r86mh') || '') !== mh) { mh ? sc.style.setProperty('--r86mh', mh) : sc.style.removeProperty('--r86mh'); }
    if ((sc.style.getPropertyValue('--r86bh') || '') !== bh) { bh ? sc.style.setProperty('--r86bh', bh) : sc.style.removeProperty('--r86bh'); }
    if (bk && bk.classList.contains('r86-rola') !== rola) bk.classList.toggle('r86-rola', rola);
  }
  (function m86() { modo86(); sobe86(); mapa86(); requestAnimationFrame(m86); })();
  function alturaBase86() { var w = innerWidth, h = innerHeight; if (Math.abs(w - H86.w) > 40 || !H86.on && h > H86.h || !H86.h) { if (Math.abs(w - H86.w) > 40) H86.h = 0; H86.w = w; if (!H86.on) H86.h = Math.max(H86.h, h); } }
  function digita86(ev) {
    var t = ev.target; if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !matchMedia('(pointer:coarse)').matches || H86.on) return;
    alturaBase86(); H86.on = true; var sc = document.querySelector('.sc12'), e = sc, h = H86.h + 'px';
    H86.els = []; while (e && e !== document.documentElement) { var p = getComputedStyle(e).position; if (p === 'fixed' || e === sc) { H86.els.push([e, e.style.height, e.style.bottom]); e.style.setProperty('height', h, 'important'); e.style.setProperty('bottom', 'auto', 'important'); } e = e.parentElement; }
  }
  function solta86() {
    setTimeout(function () {
      var a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      H86.els.forEach(function (x) { x[0].style.removeProperty('height'); x[0].style.removeProperty('bottom'); if (x[1]) x[0].style.height = x[1]; if (x[2]) x[0].style.bottom = x[2]; }); H86.els = []; H86.on = false; alturaBase86();
    }, 250);
  }
  function liga86() {
    if (P.pagina !== 'site') return;
    document.documentElement.classList.add('r86');
    new MutationObserver(ciclo86).observe(document.body, { childList: true, subtree: true });   // só quando entram cartões novos (não a cada quadro da rolagem)
    var sc = document.querySelector('.sc12'); if (sc) new MutationObserver(ciclo86).observe(sc, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', ciclo86); ciclo86();
    alturaBase86(); window.addEventListener('resize', alturaBase86); document.addEventListener('focusin', digita86, true); document.addEventListener('focusout', solta86, true);
    anQuadro86();   // R86f: o Anunciar acompanha o Login a cada quadro
    setInterval(ciclo86, 2500);
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
  /* R86j (John 24/11): o fundo do login/troca de senha do painel é o mesmo cenário em loop do site (vídeo t0; com movimento reduzido, só a foto) */
  function fundoCena(tela) {
    var f = el('div', { class: 'pt-fundo', 'aria-hidden': 'true' }), por = false, ret = false;
    try { por = matchMedia('(prefers-reduced-motion:reduce)').matches; } catch (e) {}
    try { ret = matchMedia('(orientation:portrait) and (max-width:900px)').matches; } catch (e) {}
    var t = ret ? 'm' : (innerWidth >= 1600 || (window.devicePixelRatio || 1) >= 2) ? '2560' : '1280', n = t === 'm' ? 't0_m_806' : 't0_' + t;
    f.style.backgroundImage = 'url(t0/' + (t === 'm' ? 't0_poster_m.jpg' : 't0_poster_2560.jpg') + ')';
    if (!por && document.createElement('video').canPlayType) {
      var v = document.createElement('video'); v.muted = true; v.defaultMuted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.disablePictureInPicture = true; v.tabIndex = -1;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('loop', ''); v.setAttribute('aria-hidden', 'true');
      [['video/webm; codecs="vp9"', 't0/' + n + '.webm'], ['video/mp4', 't0/' + n + '.mp4']].forEach(function (a) { var s = document.createElement('source'); s.type = a[0]; s.src = a[1]; v.appendChild(s); });
      f.appendChild(v); var go = function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); }; v.addEventListener('canplay', go); go();
    }
    tela.insertBefore(f, tela.firstChild);
  }
  /* R86j (John 24/11): clicar no branco do cartão da lista também abre a ficha (como o botão "Sobre a casa"); arrastar para rolar não conta */
  (function () {
    var d0 = null;
    document.addEventListener('pointerdown', function (e) { d0 = { x: e.clientX, y: e.clientY }; }, true);
    document.addEventListener('click', function (e) {
      var cd = e.target.closest && e.target.closest('.sc12 .cd12'); if (!cd || e.target.closest('a,button,input,select,textarea,label,[role=button]')) return;
      if (d0 && Math.abs(e.clientX - d0.x) + Math.abs(e.clientY - d0.y) > 10) return;
      var b = cd.querySelector('.vm12'); if (b) b.click();
    });
  })();
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
      fundoCena(tela); document.body.appendChild(tela);
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
      fundoCena(tela); document.body.appendChild(tela);
      at.input.focus();
    });
  }
  // R86o (John 25/11): trocar o e-mail de login pelo painel (a rota PUT /api/painel/email já existia, sem tela). Pede a senha atual.
  function telaEmail() {
    css();
    var em = campo('E-mail novo', 'pt-email-novo', 'email', 'username'), se = campo('Senha atual', 'pt-email-senha', 'password', 'current-password');
    var msg = el('p', { class: 'pt-msg', role: 'alert' }), btn = el('button', { type: 'submit', class: 'pt-btn pri', texto: 'Trocar o e-mail' });
    var c = el('button', { type: 'button', class: 'pt-btn', texto: 'Cancelar' });
    var f = el('form', { class: 'pt-cartao', novalidate: 'novalidate' }, [el('h1', { class: 'pt-t', texto: 'Trocar e-mail de login' }),
      el('p', { class: 'pt-p', texto: (EMAIL ? 'Hoje: ' + EMAIL + '. ' : '') + 'Depois de trocar, entre com o e-mail novo. A senha continua a mesma.' }), em.rotulo, em.input, se.rotulo, se.input, msg, btn, c]);
    var tela = el('div', { class: 'pt-tela', id: 'pt-email-t' }, [f]);
    c.onclick = function () { tela.remove(); };
    f.onsubmit = function (ev) {
      ev.preventDefault(); msg.textContent = '';
      var v = em.input.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) { msg.textContent = 'Confira o e-mail.'; return; }
      if (EMAIL && v === EMAIL.toLowerCase()) { msg.textContent = 'Esse já é o e-mail de login.'; return; }
      btn.disabled = true;
      req('PUT', 'api/painel/email', { email: v, senha: se.input.value }).then(function (r) {
        btn.disabled = false;
        if (r.ok) { EMAIL = (r.j && r.j.email) || v; tela.remove(); aviso('E-mail de login trocado para ' + EMAIL + '.'); redesenharPerfil(); return; }
        msg.textContent = r.status === 403 ? 'A senha atual não confere.' : r.status === 429 ? 'Muitas tentativas. Espere um pouco.' : r.status === 409 ? 'Esse e-mail já é usado por outra conta.' : r.status === 400 ? 'Confira o e-mail.' : 'Não foi possível trocar agora.';
      });
    };
    fundoCena(tela); document.body.appendChild(tela); em.input.focus();
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
      '<button class="lin" data-pt="email"><span class="v">Trocar e-mail de login</span><span class="ch">›</span></button>' +
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
    else if (a === 'email') telaEmail();
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
  // R86e (John 24/11): várias fotos de uma vez. Cada uma passa pela mesma conferência e envio, uma depois da outra.
  P.escolherFoto = function (cb) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.hidden = true; inp.id = 'pt-foto';
    inp.onchange = function () {
      var arqs = [].slice.call(inp.files || []); inp.remove(); if (!arqs.length) return;
      var n = arqs.length, i = 0;
      function rot(t) { return n > 1 ? t + ' (' + (i + 1) + ' de ' + n + ')' : t; }
      function proxima() {
        if (i >= n) return;
        var arq = arqs[i];
        function segue() { i++; proxima(); }
        if (arq.size > 40 * 1024 * 1024) { aviso(rot('A foto é grande demais (máx. 40 MB).'), 'erro'); setTimeout(segue, 1500); return; }
        aviso(rot('Conferindo a foto…'));
        P.prepararFoto(arq).then(function (pr) {
          var a = document.getElementById('pt-aviso'); if (a) a.remove();
          return (pr.avisos.length ? perguntar(pr.avisos, pr.lado < FOTO.MIN_LADO) : Promise.resolve(true)).then(function (usar) {
            if (!usar) { if (pr.im.close) pr.im.close(); return; }
            aviso(rot('Enviando a foto…'));
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
        }).catch(function () { aviso(rot('Não consegui ler essa foto. Tente outra.'), 'erro'); }).then(segue);
      }
      proxima();
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

  // mostra o código do erro na tela, para quem for olhar o servidor saber o que procurar (sem dado pessoal)
  function codigoErro(r) { return ' (erro ' + (r && r.status || 'sem conexão') + (r && r.j && r.j.erro ? ' · ' + String(r.j.erro).slice(0, 40) : '') + ')'; }
  function iniciarPainel() {
    css();
    return req('GET', 'api/painel/sessao').then(function (s0) {
      if (!s0.ok) { telaErro('Não consegui carregar o painel agora.' + codigoErro(s0)); return null; }
      if (!s0.j.logado) return telaLogin().then(function (l) { return l.trocar ? telaTroca(true) : true; }).then(function () { return iniciarPainel(); }).then(function () { return null; });
      // entrou com a senha temporária e recarregou a página antes de trocar: volta para a troca (antes caía em erro)
      if (s0.j.trocar) return telaTroca(true).then(function () { return iniciarPainel(); }).then(function () { return null; });
      return req('GET', 'api/painel/estado');
    }).then(function (r) {
      if (!r) return;
      if (r.status === 403 && r.j && r.j.erro === 'aceitar_termo') return telaTermo(r.j.versao).then(function () { return iniciarPainel(); });
      if (r.status === 403 && r.j && r.j.erro === 'trocar_senha') return telaTroca(true).then(function () { return iniciarPainel(); });
      if (r.status === 401) return iniciarPainel();   // a sessão caiu no meio do caminho: pede o login de novo
      if (!r.ok) { telaErro('Não consegui carregar o painel agora.' + codigoErro(r)); return; }
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
  detectar().then(function (ok) { if (ok) return comeco(); iniciar(); if (P.pagina === 'site') { css(); rodape(); liga86(); } }).catch(function (e) {
    if (window.console) console.error('ponte', e && e.message); if (!P.srv) iniciar();
  });
})();
