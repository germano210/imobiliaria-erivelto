/* Erivelto Santos \u00b7 hero com v\u00eddeo cont\u00ednuo e janela de contato.
   V\u00eddeo sem som, toca uma vez; com movimento reduzido ou economia de dados fica s\u00f3 a foto de capa. */
(() => {
  'use strict';
  const d = document;
  // Preencher com o n\u00famero real (s\u00f3 d\u00edgitos, com 55 e DDD), ex.: '5551999999999'. Vazio = bot\u00e3o avisa que ainda n\u00e3o est\u00e1 ligado.
  const WHATS = '';
  window.ERIVELTO_WHATS = WHATS;

  initHero();
  initConversa();

  const topo = d.getElementById('topo'), hero = d.querySelector('.hero__palco');
  if (topo && hero) new IntersectionObserver(es => topo.classList.toggle('is-solido', !es[0].isIntersecting), { rootMargin: '-80px 0px 0px 0px' }).observe(hero);

  // bot\u00e3o de WhatsApp no canto: aparece depois que o hero sai da tela
  const zap = d.querySelector('.zap'), heroSec = d.querySelector('.hero');
  if (zap && heroSec) new IntersectionObserver(es => { const fora = !es[0].isIntersecting; zap.classList.toggle('is-on', fora); zap.setAttribute('aria-hidden', fora ? 'false' : 'true'); zap.tabIndex = fora ? 0 : -1; }, { threshold: .05 }).observe(heroSec);

  // links de \u00e2ncora: rolagem suave s\u00f3 no clique (nada de scroll-behavior global, que faz a p\u00e1gina "voltar sozinha" no celular)
  const sem = matchMedia('(prefers-reduced-motion: reduce)').matches;
  d.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const alvo = a.getAttribute('href').length > 1 && d.querySelector(a.getAttribute('href'));
    if (!alvo) return;
    e.preventDefault(); alvo.scrollIntoView({ behavior: sem ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', a.getAttribute('href'));
  }));

  function initHero() {
    const sec = d.querySelector('.hero'), v = d.querySelector('.hero__video'), bt = d.querySelector('.hero__pausa');
    if (!sec || !v) return;
    const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const poucoDado = navigator.connection && (navigator.connection.saveData || /(^|-)2g$/.test(navigator.connection.effectiveType || ''));
    if (reduzir || poucoDado) { v.remove(); return; }
    // O v\u00eddeo \u00e9 um passeio \u00fanico (fachada, hall, sala, terra\u00e7o): toca uma vez e para no terra\u00e7o.
    const retrato = matchMedia('(orientation: portrait)').matches; // celular em p\u00e9: v\u00eddeo vertical pr\u00f3prio, sem recorte
    // vídeo como parte do site: os dois arquivos são baixados inteiros durante o carregamento (blob) e tocam sem pedir nada
    const cel = matchMedia('(max-aspect-ratio: 1/1)').matches;
    const ARQ = cel ? ['video/hero20-m.mp4'] : ['video/hero20.mp4'];
    // um video so: intro + entrada do giro + 10 voltas da logo 3D; perto do fim volta 60 s (10 voltas exatas), sem corte nem pausa
    const LOOP0 = 10.6, VOLTA = 6;
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.controls = false;
    ['muted', 'playsinline', 'webkit-playsinline', 'disablepictureinpicture', 'disableremoteplayback'].forEach(a => v.setAttribute(a, ''));
    if (bt) bt.remove();
    // iPhone (modo economia ou autoplay bloqueado): se o play falhar, mostra a capa e os textos e tenta de novo no 1o toque
    const toca = () => { const p = v.play(); if (p && p.catch) p.catch(() => { window.dispatchEvent(new Event('hero-sem-video')); const um = () => { v.play().catch(() => {}); }; addEventListener('touchstart', um, { once: true, passive: true }); addEventListener('click', um, { once: true }); }); };
    // baixa o video inteiro durante o carregamento (sem travar depois); se nao der, usa o arquivo direto
    window.heroCarrega = async onProg => {
      try { const r = await fetch(ARQ[0]); const b = await r.blob(); if (!b.size) throw 0; v.src = URL.createObjectURL(b); }
      catch (e) { v.src = ARQ[0]; }
      onProg && onProg(); v.load();
      await new Promise(r => { const ok = () => r(); v.addEventListener('canplaythrough', ok, { once: true }); v.addEventListener('loadeddata', ok, { once: true }); v.addEventListener('error', () => { if (v.src.startsWith('blob:')) { v.src = ARQ[0]; v.load(); } else ok(); }); setTimeout(ok, 8000); });
      onProg && onProg();
    };
    let comecou = false;
    const vigia = () => { if (v.duration && v.currentTime > v.duration - 0.25) v.currentTime = LOOP0 + ((v.currentTime - LOOP0) % VOLTA); if (!v.paused) requestAnimationFrame(vigia); };
    v.addEventListener('playing', () => { sec.classList.add('is-tocando'); v.classList.add('is-on'); requestAnimationFrame(vigia); });
    v.addEventListener('ended', () => { v.currentTime = LOOP0; toca(); });
    window.heroComeca = () => { if (comecou) return; comecou = true; v.currentTime = 0; toca(); };
    new IntersectionObserver(es => { if (comecou) es[0].isIntersecting ? toca() : v.pause(); }, { threshold: .1 }).observe(sec);
  }

  function initConversa() {
    const dlg = d.getElementById('conversa'); if (!dlg) return;
    const form = dlg.querySelector('form'), interesse = dlg.querySelector('.conversa__interesse');
    let origem = null, imovel = '';
    const campos = { nome: form.nome, tel: form.tel };
    const marca = (el, ruim) => { const c = el.closest('.campo'), m = c.querySelector('.campo__msg'); c.classList.toggle('is-erro', ruim); m.hidden = !ruim; el.setAttribute('aria-invalid', ruim ? 'true' : 'false'); };
    const digitos = v => v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    const nomeOk = v => v.trim().replace(/[^\p{L}]/gu, '').length >= 2;
    const telOk = v => { const n = digitos(v); return n.length === 10 || (n.length === 11 && n[2] === '9'); };
    const limpa = () => Object.values(campos).forEach(el => marca(el, false));
    // trava a rolagem de fundo guardando a posi\u00e7\u00e3o (html overflow:hidden faz a p\u00e1gina pular no celular)
    let yTrava = 0;
    const trava = () => { yTrava = scrollY; const s = d.body.style; s.position = 'fixed'; s.top = `-${yTrava}px`; s.left = '0'; s.right = '0'; };
    const solta = () => { const s = d.body.style; if (s.position !== 'fixed') return; s.position = s.top = s.left = s.right = ''; scrollTo({ top: yTrava, behavior: 'instant' }); };
    const abrir = (b, casa) => {
      origem = b; imovel = casa || ''; limpa();
      interesse.hidden = !imovel; interesse.textContent = imovel ? 'Im\u00f3vel: ' + imovel : '';
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      trava();
    };
    d.querySelectorAll('[data-abrir-conversa]').forEach(b => b.addEventListener('click', () => abrir(b, '')));
    d.querySelectorAll('[data-interesse]').forEach(b => b.addEventListener('click', () => abrir(b, b.dataset.interesse)));
    const fechar = () => { dlg.close ? dlg.close() : dlg.removeAttribute('open'); };
    dlg.addEventListener('close', () => { solta(); origem && origem.focus({ preventScroll: true }); });
    dlg.querySelector('[data-fechar]').addEventListener('click', fechar);
    dlg.addEventListener('click', e => { if (e.target === dlg) fechar(); });
    form.tel.addEventListener('input', () => {
      const n = digitos(form.tel.value).slice(0, 11);
      form.tel.value = n.length > 6 ? `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : n.length > 2 ? `(${n.slice(0, 2)}) ${n.slice(2)}` : n;
      if (form.tel.closest('.campo').classList.contains('is-erro') && telOk(form.tel.value)) marca(form.tel, false);
    });
    form.nome.addEventListener('input', () => { if (form.nome.closest('.campo').classList.contains('is-erro') && nomeOk(form.nome.value)) marca(form.nome, false); });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const rn = !nomeOk(form.nome.value), rt = !telOk(form.tel.value);
      marca(form.nome, rn); marca(form.tel, rt);
      if (rn || rt) { (rn ? form.nome : form.tel).focus(); return; }
      const tipo = form.querySelector('input[name=tipo]:checked').value;
      const msg = `Ol\u00e1, Erivelto! Meu nome \u00e9 ${form.nome.value.trim()}. Quero ${tipo.toLowerCase()}.` + (imovel ? ` Im\u00f3vel: ${imovel}.` : '') + ` Meu WhatsApp: ${form.tel.value}.`;
      fechar(); form.reset(); limpa();
      if (WHATS) window.open(`https://wa.me/${WHATS}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      else window.Arcane && Arcane.toast('Pedido recebido na tela. O WhatsApp do Erivelto ainda ser\u00e1 ligado neste bot\u00e3o.', { tipo: 'info' });
    });
    d.querySelectorAll('[data-whats]').forEach(b => b.addEventListener('click', () => {
      if (WHATS) window.open(`https://wa.me/${WHATS}?text=${encodeURIComponent('Ol\u00e1, Erivelto! Vim pelo seu site.')}`, '_blank', 'noopener');
      else window.Arcane && Arcane.toast('O WhatsApp do Erivelto ainda ser\u00e1 ligado neste bot\u00e3o.', { tipo: 'info' });
    }));
  }
})();
