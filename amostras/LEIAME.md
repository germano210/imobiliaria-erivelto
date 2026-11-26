# Amostras para corretoras (TLH)

Cópia do site + painel do Erivelto com nome, logo 3D e 3 imóveis de outra corretora. Cor de destaque #003641.

Gerar (depois de qualquer mudança em `site/`):

    python3 amostras/gerar.py amostras/velleda/config.json
    python3 amostras/gerar.py amostras/severgnini/config.json

Saída: `amostras/<slug>/site/` (fora do git). É site estático (prévia: dados ficam no navegador).

## Subir no Cloudflare (Geeg)
Workers & Pages › Create › Pages › Upload assets › projeto `velleda-amostra` (e `severgnini-amostra`) ›
arrastar a pasta `amostras/<slug>/site/` (ou o zip dela) › Deploy. Domínio: loudhouse.com.br/amostra/<slug> (opcional).
