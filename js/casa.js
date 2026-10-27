/* Pagina da casa: foto em tela cheia (deslizar + pontinhos), gaveta com lista curta, descricao e mini mapa, um botao "Agendar visita". */
(() => {
  'use strict';
  const d = document, dlg = d.getElementById('casa');
  if (!dlg) return;
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FOTOS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `img/casa-${i}.webp`);
  const LEG = ['Fachada', 'Entrada e p\u00e1tio', 'Sala com lareira', 'Sala e jantar', 'Cozinha', '\u00c1rea gourmet', 'Piscina', 'Mezanino', 'Sacada'];
  const fotos = d.getElementById('casaFotos'), trilho = d.getElementById('casaTrilho'), pontos = d.getElementById('casaPontos'), cont = d.getElementById('casaCont');
  trilho.innerHTML = FOTOS.map((s, i) => `<figure><img src="${s}" alt="${LEG[i]}" ${i ? 'loading="lazy"' : ''} draggable="false"></figure>`).join('');
  pontos.innerHTML = FOTOS.map((_, i) => `<button type="button" role="tab" aria-label="Foto ${i + 1}: ${LEG[i]}" data-i="${i}"></button>`).join('');
  let atual = 0;
  const marca = i => { atual = i; cont.textContent = `${i + 1} / ${FOTOS.length} \u00b7 ${LEG[i]}`; pontos.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-selected', k === i)); };
  const vai = i => { i = Math.max(0, Math.min(FOTOS.length - 1, i)); fotos.scrollTo({ left: i * fotos.clientWidth, behavior: reduz ? 'auto' : 'smooth' }); marca(i); };
  fotos.addEventListener('scroll', () => { const i = Math.round(fotos.scrollLeft / fotos.clientWidth); if (i !== atual) marca(i); }, { passive: true });
  pontos.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) vai(+b.dataset.i); });
  dlg.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => vai(atual + +b.dataset.f)));
  dlg.addEventListener('keydown', e => { if (e.key === 'ArrowRight') vai(atual + 1); else if (e.key === 'ArrowLeft') vai(atual - 1); });
  // arrastar com o mouse (no celular o deslizar e nativo)
  let x0 = null, s0 = 0;
  fotos.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; x0 = e.clientX; s0 = fotos.scrollLeft; fotos.classList.add('is-arrasto'); });
  addEventListener('pointermove', e => { if (x0 != null) fotos.scrollLeft = s0 - (e.clientX - x0); });
  addEventListener('pointerup', e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; fotos.classList.remove('is-arrasto'); vai(Math.abs(dx) > 50 ? atual + (dx < 0 ? 1 : -1) : atual); });

  // gaveta
  const gav = d.getElementById('casaGaveta'), alca = d.getElementById('casaAlca');
  const abreGav = on => { gav.classList.toggle('is-aberta', on); dlg.classList.toggle('gaveta-aberta', on); alca.setAttribute('aria-expanded', on); };
  alca.addEventListener('click', () => abreGav(!gav.classList.contains('is-aberta')));
  let y0 = null;
  alca.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  alca.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (dy < -30) abreGav(true); else if (dy > 30) abreGav(false); });

  // mini mapa (mesmas ruas reais do mapa principal)
  let mapaFeito = false;
  function miniMapa() {
    if (mapaFeito || !window.BAIRRO || !window.VITRINE) return; mapaFeito = true;
    const B = window.BAIRRO, V = window.VITRINE, m = V.real, R = 750;
    const vb = `${m.x - R * 1.4} ${m.y - R} ${R * 2.8} ${R * 2}`;
    const poly = fs => fs.map(f => { let s = 'M' + f[0] + ' ' + f[1]; for (let i = 2; i < f.length; i += 2) s += 'L' + f[i] + ' ' + f[i + 1]; return s; }).join('');
    const marcas = ['escola', 'mercado', 'saude', 'lazer'].map(k => m.perto[k] && m.perto[k].p ? { k, p: m.perto[k].p } : null).filter(Boolean);
    d.getElementById('casaMapa').innerHTML = `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Mapa da regi\u00e3o da casa">
      <rect x="${m.x - 5000}" y="${m.y - 5000}" width="10000" height="10000" fill="#EEE8DC"/>
      <path d="${poly(B.green)}" fill="rgba(120,170,120,.32)"/>
      <path d="${poly(B.roads.r || [])}" fill="none" stroke="rgba(17,38,73,.25)" stroke-width="7" stroke-linecap="round"/>
      <path d="${poly([...(B.roads.t || []), ...(B.roads.s || [])])}" fill="none" stroke="rgba(17,38,73,.5)" stroke-width="11" stroke-linecap="round"/>
      <path d="${poly(B.roads.p || [])}" fill="none" stroke="rgba(17,38,73,.7)" stroke-width="14" stroke-linecap="round"/>
      <path d="${poly(B.rod)}" fill="none" stroke="#C99A3A" stroke-width="16" stroke-linecap="round" opacity=".8"/>
      ${marcas.map(o => `<g transform="translate(${o.p.x} ${o.p.y})"><circle r="34" fill="#fff" stroke="rgba(17,38,73,.25)" stroke-width="3"/><g transform="translate(-18 -18) scale(1.5)" class="v-${o.k}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${V.VANT.find(v => v.k === o.k).ic}"/></g></g>`).join('')}
      <g transform="translate(${m.x} ${m.y})"><circle r="70" fill="rgba(212,175,95,.25)"/><circle r="30" fill="#D4AF5F" stroke="#0B1B38" stroke-width="8"/></g>
    </svg>`;
    d.getElementById('casaDist').innerHTML = ['escola', 'mercado', 'saude', 'lazer', 'rodovia', 'centro'].filter(k => m.perto[k])
      .map(k => `<li>${V.icone(k)}<span>${V.VANT.find(v => v.k === k).nome}</span><b>${V.fmtD(m.perto[k].d)}</b></li>`).join('');
  }

  // abrir / fechar
  let yTrava = 0;
  function abreCasa() {
    miniMapa(); abreGav(false);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    fotos.scrollLeft = 0; marca(0); fotos.focus({ preventScroll: true });
    const mede = () => dlg.style.setProperty('--gav', alca.offsetHeight + 'px'); mede(); addEventListener('resize', mede);
    yTrava = scrollY; Object.assign(d.body.style, { position: 'fixed', top: `-${yTrava}px`, left: '0', right: '0' });
  }
  const fecha = () => { dlg.close ? dlg.close() : dlg.removeAttribute('open'); };
  dlg.addEventListener('close', () => { if (d.body.style.position === 'fixed') { Object.assign(d.body.style, { position: '', top: '', left: '', right: '' }); scrollTo({ top: yTrava, behavior: 'instant' }); } });
  dlg.querySelector('[data-fechar-casa]').addEventListener('click', fecha);
  d.getElementById('casaAgendar').addEventListener('click', () => { fecha(); setTimeout(() => d.getElementById('casaInteresse').click(), 60); });
  window.abreCasa = abreCasa;
})();
