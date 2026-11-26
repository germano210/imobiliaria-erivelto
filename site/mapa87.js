/* R87 (John 26/11): mapa de satélite da Esri (ArcGIS) para todas as cidades, igual em todas, com zoom.
   Usado pela ficha do site (ponte.js) e pelo painel ("No mapa"). Carrega o MapLibre (vendor/) só quando um mapa abre.
   A chave é de navegador (fica visível no site): ela precisa estar restrita, no ArcGIS, aos endereços dos sites
   (Referrers) e só com acesso a Basemaps e Geocoding. Trocar a chave: mudar CHAVE abaixo. */
(function () {
  'use strict';
  var CHAVE = 'AAPTaCO2Bk8oEHQAgcRWbPA0CCg..I4araUQkVxy-rCIhMYt_IDToWgLZmszrmfd0pJ2RRYaxqXTnrAgSZfGo6-u0Dnj6yda48tI0TPvTi55s1bp76JdUHho19KZDBb-UEpNvEojorO6ADKA1LmPD0UAYl0m1urXatfqil8GqURM0vX4eayghxkt9zOrOv7BQ0gGvq0a_wWnt2NFyGOE9-MnZAPDJY96fVHUtbvQ00gwCF23jl1jfUn9ctx34Q1XEp6q59eb7tkSkKF4XI_0qy2A5shc.AT1_YpGZlLjU';
  var ESTILO = 'https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/imagery?language=pt-BR&token=' + encodeURIComponent(CHAVE);
  var GEO = 'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/';
  var me = document.currentScript, BASE = me && me.src ? me.src.replace(/[^/]*(\?.*)?$/, '') : '';
  // centros conhecidos (evitam uma consulta); as outras cidades são procuradas uma vez e guardadas no navegador
  var CIDADES = { 'Santo Antônio da Patrulha': [-50.5175, -29.8268], 'Gravataí': [-50.9917, -29.9440], 'Viamão': [-51.0240, -30.0812], 'Cachoeirinha': [-51.0939, -29.9511], 'Porto Alegre': [-51.2177, -30.0346], 'Osório': [-50.2690, -29.8867], 'Bombinhas': [-48.5170, -27.1380], 'Taquara': [-50.7810, -29.6505], 'Glorinha': [-50.7739, -29.8791], 'Tramandaí': [-50.1336, -29.9846], 'Capão da Canoa': [-50.0097, -29.7458], 'Canoas': [-51.1839, -29.9178] };
  var carregando = null;
  function carregar() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (carregando) return carregando;
    carregando = new Promise(function (ok, erro) {
      if (!document.querySelector('link[data-mapa87]')) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = BASE + 'vendor/maplibre-gl.css'; l.setAttribute('data-mapa87', '1'); document.head.appendChild(l); }
      var s = document.createElement('script'); s.src = BASE + 'vendor/maplibre-gl-csp.js'; s.async = true;
      s.onload = function () { try { window.maplibregl.setWorkerUrl(BASE + 'vendor/maplibre-gl-csp-worker.js'); } catch (e) { /* versões antigas */ } ok(window.maplibregl); };
      s.onerror = function () { carregando = null; erro(new Error('mapa')); };
      document.head.appendChild(s);
    });
    return carregando;
  }
  function guardado(k) { try { var v = localStorage.getItem('m87_' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function guarda(k, v) { try { localStorage.setItem('m87_' + k, JSON.stringify(v)); } catch (e) { /* segue */ } }
  function pede(rota, q) {
    var u = GEO + rota + '?f=json&countryCode=BRA&langCode=pt&token=' + encodeURIComponent(CHAVE);
    Object.keys(q).forEach(function (k) { if (q[k] != null) u += '&' + k + '=' + encodeURIComponent(q[k]); });
    return fetch(u).then(function (r) { return r.json(); });
  }
  // centro da cidade [lon, lat]
  function cidade(nome) {
    nome = String(nome || '').trim();
    if (!nome) return Promise.resolve(null);
    if (CIDADES[nome]) return Promise.resolve(CIDADES[nome]);
    var g = guardado('c_' + nome); if (g) return Promise.resolve(g);
    return pede('findAddressCandidates', { SingleLine: nome + ', RS', maxLocations: 1, category: 'City' }).then(function (j) {
      var c = j && j.candidates && j.candidates[0]; if (!c) return null;
      var ll = [+c.location.x.toFixed(5), +c.location.y.toFixed(5)]; guarda('c_' + nome, ll); return ll;
    }).catch(function () { return null; });
  }
  // sugestões de endereço perto de um ponto (painel)
  function sugerir(texto, perto) {
    var ext = perto ? JSON.stringify({ xmin: perto[0] - 0.4, ymin: perto[1] - 0.4, xmax: perto[0] + 0.4, ymax: perto[1] + 0.4, spatialReference: { wkid: 4326 } }) : null;
    return pede('suggest', { text: texto, location: perto ? perto[0] + ',' + perto[1] : null, searchExtent: ext, maxSuggestions: 6 })
      .then(function (j) { return (j && j.suggestions || []).filter(function (s) { return !s.isCollection; }); }).catch(function () { return []; });
  }
  function achar(s) {
    return pede('findAddressCandidates', { SingleLine: s.text, magicKey: s.magicKey, maxLocations: 1, outFields: 'Match_addr' }).then(function (j) {
      var c = j && j.candidates && j.candidates[0]; return c ? { ll: [+c.location.x.toFixed(6), +c.location.y.toFixed(6)], t: c.address } : null;
    }).catch(function () { return null; });
  }
  // círculo (polígono) de r metros em volta de ll
  function circulo(ll, r) {
    var p = [], k = 48, lat = ll[1] * Math.PI / 180;
    for (var i = 0; i <= k; i++) { var a = i / k * 2 * Math.PI; p.push([ll[0] + r * Math.cos(a) / (111320 * Math.cos(lat)), ll[1] + r * Math.sin(a) / 110540]); }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [p] }, properties: {} };
  }
  // deslocamento fixo por imóvel (a área não fica centrada na casa): mesmo cálculo para sempre, sem sorteio
  function desloca(id, ll, r) {
    var h = 7; String(id || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    var ang = (h % 360) * Math.PI / 180, d = r * (0.25 + ((h >>> 9) % 21) / 100), lat = ll[1] * Math.PI / 180;
    return [ll[0] + d * Math.cos(ang) / (111320 * Math.cos(lat)), ll[1] + d * Math.sin(ang) / 110540];
  }
  /* novo mapa num elemento. o = { centro:[lon,lat], zoom, area:[lon,lat] (raio 250 m), pino:[lon,lat], toque:fn(ll), cooperativo } */
  function novo(el, o) {
    return carregar().then(function (ml) {
      var m = new ml.Map({ container: el, style: ESTILO, center: o.centro, zoom: o.zoom || 13, minZoom: 9, maxZoom: 19, attributionControl: false,
        cooperativeGestures: !!o.cooperativo, dragRotate: false, pitchWithRotate: false, touchPitch: false, locale: { 'CooperativeGesturesHandler.WindowsHelpText': 'Use Ctrl + rolagem para dar zoom', 'CooperativeGesturesHandler.MacHelpText': 'Use ⌘ + rolagem para dar zoom', 'CooperativeGesturesHandler.MobileHelpText': 'Use dois dedos para mover o mapa', 'NavigationControl.ZoomIn': 'Aproximar', 'NavigationControl.ZoomOut': 'Afastar' } });
      try { m.touchZoomRotate.disableRotation(); } catch (e) { /* segue */ }
      m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      m.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right');
      m.once('load', function () { var at = el.querySelector('.maplibregl-ctrl-attrib'); if (at) at.classList.remove('maplibregl-compact-show'); });
      if (window.ResizeObserver) new ResizeObserver(function () { try { m.resize(); } catch (e) { /* segue */ } }).observe(el);
      var api = { mapa: m, pino: null };
      function poeArea(ll) {
        var f = ll ? circulo(ll, 250) : { type: 'FeatureCollection', features: [] };
        if (m.getSource('m87a')) { m.getSource('m87a').setData(f); return; }
        m.addSource('m87a', { type: 'geojson', data: f });
        m.addLayer({ id: 'm87af', type: 'fill', source: 'm87a', paint: { 'fill-color': '#C29A5D', 'fill-opacity': 0.28 } });
        m.addLayer({ id: 'm87al', type: 'line', source: 'm87a', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
      }
      api.area = function (ll) { if (m.isStyleLoaded()) poeArea(ll); else m.once('load', function () { poeArea(ll); }); };
      api.marca = function (ll) {
        if (api.pino) { api.pino.remove(); api.pino = null; }
        if (!ll) return;
        var d = document.createElement('div'); d.className = 'm87-pino'; d.innerHTML = '<svg viewBox="0 0 32 40" aria-hidden="true"><path d="M16 39s13-12.5 13-23A13 13 0 0 0 3 16c0 10.5 13 23 13 23z" fill="#003641" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="#fff"/></svg>';
        api.pino = new ml.Marker({ element: d, anchor: 'bottom' }).setLngLat(ll).addTo(m);
      };
      if (o.area) api.area(o.area);
      if (o.pino) api.marca(o.pino);
      if (o.toque) m.on('click', function (e) { o.toque([+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]); });
      return api;
    });
  }
  window.MAPA87 = { carregar: carregar, cidade: cidade, sugerir: sugerir, achar: achar, novo: novo, desloca: desloca, circulo: circulo, CIDADES: CIDADES };
})();
