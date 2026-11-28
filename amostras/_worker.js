// Cloudflare Pages (modo avançado): responde pedidos "Range" dos vídeos (sem isso o vídeo não toca no iPhone).
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const r = request.headers.get('range');
    if (!r || res.status !== 200) return res;
    const m = /^bytes=(\d*)-(\d*)$/.exec(r.trim());
    if (!m) return res;
    const buf = await res.arrayBuffer(), n = buf.byteLength;
    let a = m[1] === '' ? Math.max(0, n - Number(m[2])) : Number(m[1]);
    let b = m[1] === '' || m[2] === '' ? n - 1 : Math.min(Number(m[2]), n - 1);
    if (a > b || a >= n) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + n } });
    const h = new Headers(res.headers);
    h.set('Content-Range', 'bytes ' + a + '-' + b + '/' + n);
    h.set('Content-Length', String(b - a + 1));
    h.set('Accept-Ranges', 'bytes');
    return new Response(buf.slice(a, b + 1), { status: 206, headers: h });
  }
};
