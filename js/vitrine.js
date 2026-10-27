/* Vitrine: lista de im\u00f3veis \u00e0 esquerda + mapa do bairro \u00e0 direita (ruas reais do OpenStreetMap).
   A casa da Rua Sezefredo \u00e9 real; as outras 6 s\u00e3o exemplos e aparecem com o selo "Exemplo". */
(() => {
  'use strict';
  const B = window.BAIRRO, d = document;
  const box = d.getElementById('vMapa'), svg = d.getElementById('vSvg');
  if (!B || !box || !svg) return;
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- im\u00f3veis ---------- */
  const IMV = [
    { id: 'casa', real: true, tipo: 'casa', titulo: 'Casa com piscina', preco: 'R$ 1,1 mi', ficha: '2 dorm \u00b7 170 m\u00b2 \u00b7 garagem 2', rua: 'R. Sezefredo da Costa T\u00f4rres, 34', foto: 'img/casa-1.webp', x: B.casa[0], y: B.casa[1] },
    { id: 'e1', tipo: 'casa', titulo: 'Casa moderna', preco: 'R$ 780 mil', ficha: '3 dorm \u00b7 140 m\u00b2', foto: 'img/ex-1.webp' },
    { id: 'e2', tipo: 'casa', titulo: 'Casa t\u00e9rrea', preco: 'R$ 520 mil', ficha: '2 dorm \u00b7 98 m\u00b2', foto: 'img/ex-2.webp' },
    { id: 'e3', tipo: 'casa', titulo: 'Sobrado com jardim', preco: 'R$ 1,35 mi', ficha: '4 dorm \u00b7 220 m\u00b2', foto: 'img/ex-3.webp' },
    { id: 'e4', tipo: 'apto', titulo: 'Apartamento com sacada', preco: 'R$ 360 mil', ficha: '2 dorm \u00b7 68 m\u00b2', foto: 'img/ex-4.webp' },
    { id: 'e5', tipo: 'apto', titulo: 'Apartamento amplo', preco: 'R$ 495 mil', ficha: '3 dorm \u00b7 92 m\u00b2', foto: 'img/ex-5.webp' },
    { id: 'e6', tipo: 'apto', titulo: 'Apartamento compacto', preco: 'R$ 245 mil', ficha: '1 dorm \u00b7 45 m\u00b2', foto: 'img/ex-6.webp' }
  ];
  IMV.slice(1).forEach((m, i) => { const e = B.ex[i]; m.x = e[0]; m.y = e[1]; m.rua = e[2] || 'Bairro residencial'; });

  /* ---------- vantagens ---------- */
  const VANT = [
    { k: 'escola', nome: 'Escolas', ic: 'M3 9l9-4 9 4-9 4zM7 11v4c3 2 7 2 10 0v-4' },
    { k: 'mercado', nome: 'Mercados', ic: 'M4 5h2l2 10h10l2-7H7M9 19h.01M17 19h.01' },
    { k: 'saude', nome: 'Sa\u00fade', ic: 'M12 6v12M6 12h12' },
    { k: 'lazer', nome: 'Pra\u00e7as e lazer', ic: 'M12 4a5 5 0 015 5c0 3-2.5 5-5 5s-5-2-5-5a5 5 0 015-5zM12 14v6' },
    { k: 'rodovia', nome: 'Rodovias', ic: 'M9 4L6 20M15 4l3 16M12 6v2M12 11v2M12 16v2' },
    { k: 'centro', nome: 'Centro e com\u00e9rcio', ic: 'M5 10V20h14V10M4 10l2-5h12l2 5zM10 20v-5h4v5' }
  ];
  const on = new Set(VANT.map(v => v.k));
  const POIS = B.pois.map(([cat, nome, x, y]) => ({ cat: cat === 'comercio' ? 'centro' : cat, nome, x, y }));
  const pathLen = f => { let L = 0; for (let i = 0; i < f.length - 2; i += 2) L += Math.hypot(f[i + 2] - f[i], f[i + 3] - f[i + 1]); return L; };
  const distSeg = (px, py, f) => { let m = 1e9; for (let i = 0; i < f.length - 2; i += 2) { const ax = f[i], ay = f[i + 1], bx = f[i + 2], by = f[i + 3], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1; let t = ((px - ax) * dx + (py - ay) * dy) / L; t = Math.max(0, Math.min(1, t)); m = Math.min(m, Math.hypot(px - ax - t * dx, py - ay - t * dy)); } return m; };
  const perto = m => {
    const r = {};
    ['escola', 'mercado', 'saude', 'lazer'].forEach(k => { let best = null; POIS.forEach(p => { if (p.cat !== k) return; const dd = Math.hypot(p.x - m.x, p.y - m.y); if (!best || dd < best.d) best = { d: dd, nome: p.nome, p }; }); r[k] = best; });
    r.rodovia = { d: Math.min(...B.rod.map(f => distSeg(m.x, m.y, f))), nome: 'ERS-030 / ERS-474' };
    r.centro = { d: Math.hypot(B.centro[0] - m.x, B.centro[1] - m.y), nome: 'Centro' };
    return r;
  };
  const fmtD = dd => dd < 950 ? `${Math.max(50, Math.round(dd / 50) * 50)} m` : `${(dd / 1000).toFixed(1).replace('.', ',')} km`;
  IMV.forEach(m => { m.perto = perto(m); });

  /* ---------- desenho do mapa ---------- */
  const el = (t, a, pai) => { const e = d.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); pai && pai.appendChild(e); return e; };
  const dPoly = (fs, fecha) => fs.map(f => { let s = 'M' + f[0] + ' ' + f[1]; for (let i = 2; i < f.length; i += 2) s += 'L' + f[i] + ' ' + f[i + 1]; return fecha ? s + 'Z' : s; }).join('');
  const W = B.W, H = B.H;
  const g = el('g', {}, svg);
  el('rect', { x: -2000, y: -2000, width: W + 4000, height: H + 4000, class: 'm-fundo' }, g);
  el('path', { d: dPoly(B.green, true), class: 'm-verde' }, g);
  el('path', { d: dPoly(B.water, true), class: 'm-agua' }, g);
  el('path', { d: dPoly(B.streams), class: 'm-rio', 'vector-effect': 'non-scaling-stroke' }, g);
  ['f', 'v', 'r', 't', 's', 'p'].forEach(c => B.roads[c] && el('path', { d: dPoly(B.roads[c]), class: 'm-via m-' + c, 'vector-effect': 'non-scaling-stroke' }, g));
  const rod = el('path', { d: dPoly(B.rod), class: 'm-rod', 'vector-effect': 'non-scaling-stroke' }, g);
  const aneis = el('g', { class: 'm-aneis' }, g);
  const labs = el('g', { class: 'm-labs' }, g);
  B.lab.forEach(([nome, f], i) => {
    // texto sempre da esquerda para a direita
    let ff = f; if (f[f.length - 2] < f[0]) { ff = []; for (let j = f.length - 2; j >= 0; j -= 2) ff.push(f[j], f[j + 1]); }
    el('path', { id: 'vr' + i, d: dPoly([ff]), fill: 'none' }, labs);
    const t = el('text', { 'data-len': Math.round(pathLen(f)) }, labs), tp = el('textPath', { href: '#vr' + i, startOffset: '50%', 'text-anchor': 'middle' }, t);
    tp.textContent = nome.replace(/^Rua /, 'R. ').replace(/^Avenida /, 'Av. ');
  });
  const lay = d.createElement('div'); lay.className = 'vitrine__camada'; box.insertBefore(lay, svg.nextSibling);

  // \u00edcones de vantagens e pinos dos im\u00f3veis (HTML por cima do SVG: texto n\u00edtido em qualquer zoom)
  const icone = k => { const v = VANT.find(v => v.k === k); return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${v.ic}"/></svg>`; };
  const GEN = /^(Pra\u00e7a|Com\u00e9rcio|Quadra esportiva|Escola|Sa\u00fade|Mercado)$/;
  POIS.forEach(p => { if (GEN.test(p.nome) || /^\u00c1rea Verde/.test(p.nome)) { p.el = null; return; } const b = d.createElement('span'); b.className = 'v-poi v-' + p.cat; b.innerHTML = icone(p.cat); b.title = p.nome; p.el = b; lay.appendChild(b); });
  const centroEl = d.createElement('span'); centroEl.className = 'v-centro-tag'; centroEl.textContent = 'Centro'; lay.appendChild(centroEl);
  IMV.forEach(m => {
    const b = d.createElement('button'); b.type = 'button'; b.className = 'v-pin' + (m.real ? ' is-real' : '');
    b.innerHTML = (m.real ? '<span class="pulso" aria-hidden="true"></span>' : '') + `<img src="${m.foto}" alt=""><span><b>${esc(m.preco)}</b>` + (m.real ? '<i>\u00e0 venda</i>' : '<i>exemplo</i>') + '</span>';
    b.setAttribute('aria-label', `${m.titulo}, ${m.preco}` + (m.real ? '' : ', im\u00f3vel de exemplo'));
    b.addEventListener('click', e => { e.stopPropagation(); escolhe(m, true); });
    m.pin = b; lay.appendChild(b);
  });

  /* ---------- c\u00e2mera ---------- */
  const cam = { x: W / 2, y: H / 2, s: 0.2 }, alvo = { ...cam };
  let bw = 1, bh = 1, anim = 0;
  const mede = () => { const r = box.getBoundingClientRect(); bw = r.width; bh = r.height; svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`); };
  const sMin = () => Math.min(bw / W, bh / H) * 0.9, sMax = 2.2;
  const limita = c => { c.s = Math.max(sMin(), Math.min(sMax, c.s)); c.x = Math.max(0, Math.min(W, c.x)); c.y = Math.max(0, Math.min(H, c.y)); };
  const tela = (x, y) => [(x - cam.x) * cam.s + bw / 2, (y - cam.y) * cam.s + bh / 2];
  function pinta() {
    g.setAttribute('transform', `translate(${bw / 2 - cam.x * cam.s} ${bh / 2 - cam.y * cam.s}) scale(${cam.s})`);
    labs.style.display = cam.s > 0.7 ? '' : 'none';
    labs.setAttribute('font-size', (11 / cam.s).toFixed(1));
    labs.querySelectorAll('text').forEach(t => { t.style.display = +t.dataset.len * cam.s > 220 ? '' : 'none'; });
    POIS.forEach(p => { if (!p.el) return; const [x, y] = tela(p.x, p.y); const vis = cam.s > 0.16 && on.has(p.cat) && x > -20 && y > -20 && x < bw + 20 && y < bh + 20; p.el.style.display = vis ? '' : 'none'; if (vis) p.el.style.transform = `translate(${x}px,${y}px)`; });
    const [cx, cy] = tela(B.centro[0], B.centro[1]); centroEl.style.display = on.has('centro') ? '' : 'none'; centroEl.style.transform = `translate(${cx}px,${cy}px)`;
    rod.classList.toggle('is-on', on.has('rodovia'));
    IMV.forEach(m => { const [x, y] = tela(m.x, m.y); m.pin.style.transform = `translate(${x}px,${y}px)`; m.pin.hidden = !visivel(m); });
    if (sel) posPop();
  }
  const passo = () => {
    const k = reduz ? 1 : 0.16; let mexe = false;
    ['x', 'y', 's'].forEach(c => { const dlt = alvo[c] - cam[c]; if (Math.abs(dlt) > (c === 's' ? 1e-4 : 0.3)) { cam[c] += dlt * k; mexe = true; } else cam[c] = alvo[c]; });
    pinta(); anim = mexe ? requestAnimationFrame(passo) : 0;
  };
  const vai = () => { limita(alvo); if (!anim) anim = requestAnimationFrame(passo); };
  // computador: a lista de imoveis fica por cima do mapa, a esquerda
  const padL = () => innerWidth >= 900 && !box.closest('.is-cheio') ? 364 : 0;
  const enquadra = lst => {
    const xs = lst.map(m => m.x), ys = lst.map(m => m.y), pad = 220;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const pl = padL(); alvo.s = Math.min((bw - pl) / (x1 - x0), (bh - 60) / (y1 - y0));
    alvo.x = (x0 + x1) / 2 - pl / 2 / alvo.s; alvo.y = (y0 + y1) / 2 - 30 / alvo.s; vai();
  };

  // arrastar, roda do mouse e pin\u00e7a
  const pts = new Map(); let ini = null;
  // celular: o mapa so mexe depois de aparecer inteiro na tela (evita arrastar o mapa sem querer ao rolar a pagina)
  const toque = matchMedia('(pointer: coarse)').matches, trava = d.getElementById('vTrava');
  let ativo = !toque, tTrava = 0;
  if (toque) {
    box.classList.add('is-toque');
    new IntersectionObserver(es => { ativo = es[0].intersectionRatio >= 0.96; box.classList.toggle('is-ativo', ativo); if (ativo) trava.hidden = true; }, { threshold: [0, .5, .9, .96, 1] }).observe(box);
  }
  const avisa = () => { trava.hidden = false; clearTimeout(tTrava); tTrava = setTimeout(() => { trava.hidden = true; }, 1800); };
  box.addEventListener('pointerdown', e => {
    if (!ativo) { if (!e.target.closest('button')) avisa(); return; }
    if (e.target.closest('button,.vitrine__pop,.vitrine__barra')) return;
    box.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    ini = { cx: alvo.x, cy: alvo.y, s: alvo.s, p: [...pts.values()].map(p => p.slice()), moveu: false };
  });
  box.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !ini) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    const a = [...pts.values()];
    if (a.length === 1 && ini.p.length === 1) { const dx = a[0][0] - ini.p[0][0], dy = a[0][1] - ini.p[0][1]; if (Math.hypot(dx, dy) > 4) ini.moveu = true; alvo.x = ini.cx - dx / alvo.s; alvo.y = ini.cy - dy / alvo.s; }
    else if (a.length === 2 && ini.p.length === 2) { const d0 = Math.hypot(ini.p[0][0] - ini.p[1][0], ini.p[0][1] - ini.p[1][1]), d1 = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); alvo.s = ini.s * d1 / d0; ini.moveu = true; }
    limita(alvo); Object.assign(cam, alvo); pinta();
  });
  const solta = e => { pts.delete(e.pointerId); if (pts.size === 0) { if (ini && !ini.moveu && e.type === 'pointerup') fechaPop(); ini = null; } else ini = { cx: alvo.x, cy: alvo.y, s: alvo.s, p: [...pts.values()].map(p => p.slice()), moveu: true }; };
  box.addEventListener('pointerup', solta); box.addEventListener('pointercancel', solta);
  box.addEventListener('wheel', e => {
    e.preventDefault(); const r = box.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = (mx - bw / 2) / alvo.s + alvo.x, wy = (my - bh / 2) / alvo.s + alvo.y;
    alvo.s *= Math.exp(-e.deltaY * 0.0015); limita(alvo);
    alvo.x = wx - (mx - bw / 2) / alvo.s; alvo.y = wy - (my - bh / 2) / alvo.s; vai();
  }, { passive: false });
  box.querySelectorAll('[data-vz]').forEach(b => b.addEventListener('click', () => { alvo.s *= +b.dataset.vz; vai(); }));

  /* ---------- chips de vantagens ---------- */
  const vant = d.getElementById('vVant');
  vant.innerHTML = VANT.map(v => `<button type="button" class="chip chip--ic is-on" data-v="${v.k}" aria-pressed="true" title="${esc(v.nome)}" aria-label="${esc(v.nome)}">${icone(v.k)}<span>${esc(v.nome)}</span></button>`).join('');
  vant.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; const k = b.dataset.v, liga = !on.has(k); liga ? on.add(k) : on.delete(k); b.classList.toggle('is-on', liga); b.setAttribute('aria-pressed', liga); pinta(); });

  /* ---------- lista ---------- */
  let filtro = 'todos', sel = null;
  const visivel = m => filtro === 'todos' || m.tipo === filtro;
  const chipsPerto = (m, n) => ['escola', 'mercado', 'saude', 'lazer', 'centro'].map(k => ({ k, d: m.perto[k] && m.perto[k].d })).filter(o => o.d != null).sort((a, b) => a.d - b.d).slice(0, n)
    .map(o => `<span class="v-perto">${icone(o.k)}${fmtD(o.d)}</span>`).join('');
  const cards = d.getElementById('vCards');
  cards.innerHTML = IMV.map(m => `<li><button type="button" class="v-card${m.real ? ' is-real' : ''}" data-id="${m.id}">
    <span class="v-card__foto"><img src="${m.foto}" alt="" loading="lazy"><em>${m.real ? '\u00c0 venda' : 'Exemplo'}</em></span>
    <span class="v-card__txt"><b>${esc(m.preco)}</b><span>${esc(m.titulo)}</span><small>${esc(m.ficha)}</small><span class="v-card__perto">${chipsPerto(m, 3)}</span></span>
  </button></li>`).join('') + `<li class="v-card--busca"><p>N\u00e3o achou?</p><button type="button" class="btn btn--vidro" data-abrir-conversa-v>Pedir uma busca</button></li>`;
  cards.addEventListener('click', e => { const b = e.target.closest('.v-card'); if (b) escolhe(IMV.find(m => m.id === b.dataset.id), false); });
  const pedir = cards.querySelector('[data-abrir-conversa-v]'), oculto = d.querySelector('[data-abrir-conversa]');
  pedir.addEventListener('click', () => oculto && oculto.click());
  d.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => {
    filtro = b.dataset.tipo; d.querySelectorAll('[data-tipo]').forEach(x => x.classList.toggle('is-on', x === b));
    cards.querySelectorAll('.v-card').forEach(c => { c.parentNode.hidden = !visivel(IMV.find(m => m.id === c.dataset.id)); });
    fechaPop(); enquadra(IMV.filter(visivel));
  }));

  /* ---------- escolher um im\u00f3vel ---------- */
  const pop = d.getElementById('vPop');
  function aneisDe(m) {
    aneis.innerHTML = '';
    [1000, 500].forEach(r => el('circle', { cx: m.x, cy: m.y, r, class: 'm-anel', 'vector-effect': 'non-scaling-stroke' }, aneis));
    [[1000, '1 km'], [500, '500 m']].forEach(([r, t]) => { const tx = el('text', { x: m.x, y: m.y - r - 12, class: 'm-anel-t', 'text-anchor': 'middle' }, aneis); tx.textContent = t; });
  }
  function escolhe(m, doMapa) {
    if (!m) return;
    sel = m;
    IMV.forEach(o => { o.pin.classList.toggle('is-sel', o === m); });
    cards.querySelectorAll('.v-card').forEach(c => c.classList.toggle('is-sel', c.dataset.id === m.id));
    const c = cards.querySelector(`[data-id="${m.id}"]`); if (c && !doMapa) {} else if (c) c.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
    aneis.innerHTML = '';
    alvo.s = Math.max(alvo.s, Math.min(bw, bh) / 1700); alvo.x = m.x + (bw >= 640 ? (bw * 0.17 - padL() / 2) / alvo.s : 0); alvo.y = m.y + (bw < 640 ? bh * 0.2 / alvo.s : 0); vai();
    const p = m.perto, lin = k => p[k] ? `<li>${icone(k)}<span>${esc(VANT.find(v => v.k === k).nome)}</span><b>${fmtD(p[k].d)}</b></li>` : '';
    pop.innerHTML = `<button type="button" class="v-pop__x" aria-label="Fechar">\u00d7</button>
      <img src="${m.foto}" alt="">
      <div class="v-pop__txt"><p class="v-pop__selo">${m.real ? '\u00c0 venda' : 'Exemplo ilustrativo'}</p><b>${esc(m.preco)}</b><span>${esc(m.titulo)}</span><small>${esc(m.ficha)}</small><small>${esc(m.rua)}</small>
      <ul class="v-pop__perto">${['escola', 'mercado', 'saude', 'lazer', 'rodovia', 'centro'].filter(k => on.has(k)).map(lin).join('')}</ul>
      <small class="v-pop__nota">Dist\u00e2ncias em linha reta.</small>
      <button type="button" class="btn btn--luz v-pop__bt">${m.real ? 'Ver fotos da casa' : 'Quero algo assim'}</button></div>
      <div class="v-pop__outros"><p>Outros im\u00f3veis</p><div role="group" aria-label="Outros im\u00f3veis">${IMV.filter(o => o !== m && visivel(o)).map(o => `<button type="button" data-o="${o.id}"><img src="${o.foto}" alt=""><b>${esc(o.preco)}</b><small>${esc(o.tipo === 'apto' ? 'Apartamento' : 'Casa')} \u00b7 ${o.real ? '\u00e0 venda' : 'exemplo'}</small></button>`).join('')}</div></div>`;
    pop.hidden = false; pop.classList.toggle('is-real', !!m.real);
    pop.querySelector('.v-pop__x').addEventListener('click', fechaPop);
    pop.querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => escolhe(IMV.find(o => o.id === b.dataset.o), true)));
    pop.querySelector('.v-pop__bt').addEventListener('click', () => {
      if (m.real) window.abreCasa && window.abreCasa();
      else { const h = d.getElementById('vInteresse'); h.dataset.interesse = `Algo como: ${m.titulo} (${m.ficha})`; h.click(); }
    });
    posPop();
  }
  function posPop() {
    if (!sel || pop.hidden) return;
    if (bw < 640) { pop.style.transform = ''; pop.classList.add('is-baixo'); return; }
    pop.classList.remove('is-baixo');
    const [x, y] = tela(sel.x, sel.y), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let px = x + 70, py = y - ph / 2; if (px + pw > bw - 12) px = x - pw - 24; px = Math.max(padL() + 12, px); py = Math.max(64, Math.min(bh - ph - 12, py));
    pop.style.transform = `translate(${px}px,${py}px)`;
  }
  function fechaPop() { if (pop.hidden) return; pop.hidden = true; sel = null; aneis.innerHTML = ''; IMV.forEach(o => o.pin.classList.remove('is-sel')); cards.querySelectorAll('.is-sel').forEach(c => c.classList.remove('is-sel')); }

  /* ---------- busca ---------- */
  const q = d.getElementById('vQ'), sug = d.getElementById('vSug');
  const sem = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const IDX = [
    ...IMV.map(m => ({ nome: `${m.titulo} \u00b7 ${m.preco}`, tipo: m.real ? '\u00c0 venda' : 'Exemplo', m, x: m.x, y: m.y, busca: sem(`${m.titulo} ${m.ficha} ${m.rua} ${m.tipo === 'apto' ? 'apartamento apto' : 'casa'}`) })),
    ...POIS.filter(p => !/^(Pra\u00e7a|Com\u00e9rcio|Quadra esportiva|Escola|Sa\u00fade|Mercado)$/.test(p.nome)).map(p => ({ nome: p.nome, tipo: VANT.find(v => v.k === p.cat).nome, x: p.x, y: p.y, busca: sem(p.nome) })),
    ...B.lab.map(([nome, f]) => ({ nome, tipo: 'Rua', x: f[Math.floor(f.length / 4) * 2], y: f[Math.floor(f.length / 4) * 2 + 1], busca: sem(nome) }))
  ];
  let itens = [], at = -1;
  const fecha = () => { sug.hidden = true; q.setAttribute('aria-expanded', 'false'); at = -1; };
  const lista = () => { if (!itens.length) return fecha(); sug.innerHTML = itens.map((it, i) => `<li role="option" aria-selected="${i === at}" data-i="${i}"><span>${esc(it.nome)}</span><small>${esc(it.tipo)}</small></li>`).join(''); sug.hidden = false; q.setAttribute('aria-expanded', 'true'); };
  q.addEventListener('input', () => { const t = sem(q.value.trim()); itens = t.length < 2 ? [] : IDX.filter(it => it.busca.includes(t)).slice(0, 7); at = itens.length ? 0 : -1; lista(); });
  q.addEventListener('keydown', e => { if (sug.hidden) return; if (e.key === 'ArrowDown') { at = Math.min(itens.length - 1, at + 1); lista(); e.preventDefault(); } else if (e.key === 'ArrowUp') { at = Math.max(0, at - 1); lista(); e.preventDefault(); } else if (e.key === 'Escape') fecha(); });
  const ir = i => { const it = itens[i]; if (!it) return; q.value = it.nome; fecha(); q.blur(); if (it.m) escolhe(it.m, true); else { alvo.x = it.x; alvo.y = it.y; alvo.s = Math.max(alvo.s, 0.6); vai(); } box.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'center' }); };
  sug.addEventListener('pointerdown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); ir(+li.dataset.i); } });
  d.getElementById('vBusca').addEventListener('submit', e => { e.preventDefault(); if (at >= 0) ir(at); });
  q.addEventListener('blur', () => setTimeout(fecha, 120));

  /* ---------- tela cheia ---------- */
  const corpo = box.closest('.vitrine__corpo'), btC = d.getElementById('vCheio');
  btC.addEventListener('click', () => { const ligar = !corpo.classList.contains('is-cheio'); corpo.classList.toggle('is-cheio', ligar); d.documentElement.classList.toggle('mapa-cheio', ligar); btC.setAttribute('aria-label', ligar ? 'Sair da tela cheia' : 'Mapa em tela cheia'); requestAnimationFrame(() => { mede(); limita(alvo); pinta(); posPop(); }); });
  d.addEventListener('keydown', e => { if (e.key === 'Escape' && corpo.classList.contains('is-cheio')) btC.click(); });

  /* ---------- in\u00edcio ---------- */
  new ResizeObserver(() => { mede(); limita(alvo); Object.assign(cam, alvo); pinta(); }).observe(box);
  mede(); enquadra(IMV); Object.assign(cam, alvo); pinta();
  // ao chegar no mapa, aproxima de leve at\u00e9 a casa real
  let viu = false;
  new IntersectionObserver(es => { if (es[0].isIntersecting && !viu) { viu = true; setTimeout(() => { alvo.s *= 1.25; alvo.x = B.casa[0] - padL() / 2 / alvo.s; alvo.y = B.casa[1] - 150; vai(); }, 600); } }, { threshold: .5 }).observe(box);
  window.VITRINE = { real: IMV[0], VANT, icone, fmtD };
})();
