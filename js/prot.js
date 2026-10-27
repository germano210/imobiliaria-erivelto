/* Prot\u00f3tipo \u00b7 carregamento, textos do topo depois da logo, mapa com uma casa e card da casa. */
(() => {
  'use strict';
  const d = document, root = d.documentElement;
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LOGO_T = 9.6;   // segundo do v\u00eddeo em que a logo aparece atr\u00e1s da porta (ajustar quando o v\u00eddeo for aprovado)

  /* ---- carregamento: baixa tudo que a p\u00e1gina mostra (fotos da casa, capa e o come\u00e7o do mapa) ---- */
  const FOTOS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `img/casa-${i}.webp`);
  const MAPA = [1, 2, 3, 4, 5, 6].map(i => `img/ex-${i}.webp`);
  const lista = ['img/hero-poster.webp', 'img/hero-poster-m.webp', 'img/erivelto-r.webp', ...FOTOS, ...MAPA];
  const ov = d.getElementById('carrega'), barra = d.getElementById('carregaBarra'), pct = d.getElementById('carregaPct');
  const hero = d.querySelector('.hero'), video = d.querySelector('.hero__video');
  root.classList.add('carregando');
  hero.classList.add('is-espera');
  [...d.querySelectorAll('.hero__texto>*')].forEach((el, i) => el.style.setProperty('--i', i));
  let feitos = 0; const total = lista.length + 2, t0 = performance.now();
  // a barra sempre anda de 0 a 100 % em ~5 s; so chega a 100 quando tudo estiver baixado
  let real = 0, mostrado = 0;
  const passo = () => { feitos++; real = feitos / total; };
  const anima = () => { const t = Math.min(1, (performance.now() - t0) / 5000); const alvo = Math.min(t, real < 1 ? Math.min(t, .97) : 1);
    mostrado += (alvo - mostrado) * .12; const p = Math.round(mostrado * 100); barra.style.width = p + '%'; pct.textContent = p;
    if (p < 100) requestAnimationFrame(anima); else if (!saiu) fim(); };
  requestAnimationFrame(anima);
  const fotosOk = Promise.all(lista.map(src => new Promise(r => { const im = new Image(); im.onload = im.onerror = () => { passo(); r(); }; im.src = src; })));
  const vids = window.heroCarrega ? window.heroCarrega(passo) : Promise.resolve();
  let saiu = false;
  function fim() {
    if (saiu) return; saiu = true;
    
    const espera = 0;   // carregamento dura no m\u00ednimo ~3 s
    setTimeout(() => {
      ov.classList.add('is-fora'); root.classList.remove('carregando');
      window.heroComeca && window.heroComeca();
      if (!video || reduz) mostraTexto();
    }, reduz ? 0 : espera + 300);
  }
  Promise.all([fotosOk, vids]).then(() => { real = 1; });
  setTimeout(fim, 30000);   // rede muito lenta: nunca prende a pessoa
  // textos entram depois que a logo aparece no v\u00eddeo
  function mostraTexto() { hero.classList.remove('is-espera'); }
  if (video) {
    video.addEventListener('timeupdate', () => { if (video.currentTime >= LOGO_T) mostraTexto(); });
    video.addEventListener('ended', mostraTexto);
    video.addEventListener('error', mostraTexto);
  }
  setTimeout(mostraTexto, 30000);
  addEventListener('hero-sem-video', mostraTexto);

  /* ---- mapa: js/vitrine.js ---- */


  /* ---- 03: linha que acende conforme a rolagem ---- */
  const linha = d.getElementById('linha'), luz = d.getElementById('linhaLuz');
  if (linha && luz) {
    const passos = [...linha.querySelectorAll('li')];
    const atualiza = () => {
      const r = linha.getBoundingClientRect(), vh = innerHeight;
      const p = Math.max(0, Math.min(1, (vh * 0.75 - r.top) / (r.height + vh * 0.25)));
      linha.style.setProperty('--p', (p * 100).toFixed(1) + '%');
      passos.forEach((li, i) => li.classList.toggle('is-on', p >= (i + 0.15) / passos.length || reduz));
    };
    addEventListener('scroll', () => requestAnimationFrame(atualiza), { passive: true }); addEventListener('resize', atualiza); atualiza();
  }

  /* ---- 04: formulario na pagina (mesmo envio do botao de contato) ---- */
  const cf = d.getElementById('contatoForm');
  if (cf) {
    const dig = v => v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    const nomeOk = v => v.trim().replace(/[^\p{L}]/gu, '').length >= 2;
    const telOk = v => { const n = dig(v); return n.length === 10 || (n.length === 11 && n[2] === '9'); };
    const marca = (el, ruim) => { const c = el.closest('.campo'); c.classList.toggle('is-erro', ruim); c.querySelector('.campo__msg').hidden = !ruim; el.setAttribute('aria-invalid', ruim ? 'true' : 'false'); };
    cf.tel.addEventListener('input', () => { const n = dig(cf.tel.value).slice(0, 11); cf.tel.value = n.length > 6 ? `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : n.length > 2 ? `(${n.slice(0, 2)}) ${n.slice(2)}` : n; if (telOk(cf.tel.value)) marca(cf.tel, false); });
    cf.nome.addEventListener('input', () => { if (nomeOk(cf.nome.value)) marca(cf.nome, false); });
    cf.addEventListener('submit', e => {
      e.preventDefault();
      const rn = !nomeOk(cf.nome.value), rt = !telOk(cf.tel.value); marca(cf.nome, rn); marca(cf.tel, rt);
      if (rn || rt) { (rn ? cf.nome : cf.tel).focus(); return; }
      const tipo = cf.querySelector('input[name=tipo]:checked').value;
      const msg = `Ol\u00e1, Erivelto! Meu nome \u00e9 ${cf.nome.value.trim()}. Quero ${tipo.toLowerCase()}. Meu WhatsApp: ${cf.tel.value}.`;
      const W = window.ERIVELTO_WHATS;
      if (W) window.open(`https://wa.me/${W}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      else window.Arcane && Arcane.toast('Pedido recebido na tela. O WhatsApp do Erivelto ainda ser\u00e1 ligado neste bot\u00e3o.', { tipo: 'info' });
      cf.reset();
    });
  }
})();
