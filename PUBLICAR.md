# Antes de publicar o site do Erivelto

Lista do que falta conferir ou decidir antes de o site ir ao ar no domínio `eriveltosantosimoveis.com.br`.
Levantado em 21/11/2026 (tarefas T04, T06 e T25). **Nada aqui é parecer jurídico**: a revisão (T02) continua pendente.

## 1. Lista de conferência

- [ ] **Termos de uso (`site/termos/index.html`)**: preencher os 4 trechos entre colchetes. Enquanto houver colchete, a página está incompleta.
  - `[CPF ou CNPJ do Erivelto]`
  - `[endereço profissional]`
  - `[comarca do foro]` (sugestão: Santo Antônio da Patrulha/RS)
  - `[e-mail de contato]` (se não houver e-mail, tirar o "ou por" da frase)
- [ ] **Textos legais são modelos** (sem revisão jurídica, T02): aviso de privacidade v2, termo do painel v1 e termos de uso v1.
- [ ] **Servidor**: seguir o README, "Instalar no servidor" (`.env`, `compose.producao.yaml`, túnel, usuário do Erivelto). O `compose.producao.yaml` nunca foi executado: o 1º `up` é a conferência.
- [ ] **Backup agendado** (`backup.sh` no cron) e um teste de `restaurar.sh`. O aviso de privacidade promete cópias cifradas apagadas em 14 dias: só é verdade com o backup agendado.
- [ ] **Roteiro `TESTE.md`** no domínio, do A ao G.
- [ ] **Mídias**: responder as perguntas da seção 3.
- [ ] Só depois: `ERV_NOINDEX=0`. Atenção: as páginas ainda têm `noindex` no próprio HTML; tirar é a tarefa T31.

## 2. Origem e licença das mídias (T06)

Como foi levantado: lista dos arquivos de `site/`, metadados de cada um (`identify` e `ffprobe`) e os créditos escritos no código do site. **Nenhum arquivo traz autor, câmera, data ou licença nos metadados**, então a coluna "Origem" só afirma o que o próprio projeto mostra. O que não deu para saber está como "a confirmar".

| Arquivos | O que é | Origem | Licença / autorização | Situação |
|---|---|---|---|---|
| `casa/fachada.jpg`, `jardim.jpg`, `piscina.jpg` (900 px) | 3 fotos de uma casa de verdade (fachada com rede, jardim, piscina), com tratamento de cor. Sem pessoas, sem placa, sem EXIF/GPS | A confirmar: quem tirou e de quem é a casa | Precisa da autorização do proprietário (e de quem fotografou) para anunciar | **A confirmar** |
| `t0/` (6 vídeos de 8,8 s em 3 tamanhos + 2 capas) | Vídeo de abertura: casa moderna ao entardecer. Parece imagem gerada por computador (render ou IA). Regravado com ffmpeg, sem metadado de origem | A confirmar: ferramenta usada e conta/plano | Depende dos termos da ferramenta (uso comercial permitido no plano?) | **A confirmar** |
| `fr/058.webp`, `fr/156.webp` | 2 quadros (540×960) de uma cena de interior, do mesmo estilo do vídeo | A confirmar (mesma pergunta do vídeo) | Idem | **A confirmar** |
| `maq/maq_argila.webp`, `maq_cor.webp` | Folhas com 48 vistas de uma maquete 3D de casa | A confirmar: ferramenta usada | Idem | **A confirmar** |
| `lg/` (`logo.webp`, `es.webp`, `ring.webp`, `q1`–`q4.webp`) | Logo "ES" dourado e partes dele | Marca do Erivelto. A confirmar: quem desenhou | O termo do painel (v1) registra a autorização do Erivelto para uso da marca. Se um designer fez o logo, o Erivelto precisa ter o direito de uso | **A confirmar** |
| `m14/rs.webp`, `v1220/rs_p.webp`, `v1222/rs_s2.webp`, `v1226/rs_s2_bl*.webp` | Imagens de satélite do RS (inteira, reduzida e borrada) | Sentinel-2 cloudless 2016, da EOX (crédito escrito no código do site) | CC BY 4.0. Uso comercial permitido com crédito. A versão **2016** é a livre; as de 2018 em diante não permitem uso comercial sem licença paga | Crédito no site: ver seção 4 |
| `m13/map13.webp`, `m15/sap.webp`, `m15/sap_borrado.webp`, `m16/sap_det.webp`, `v1222/sap_w.webp`, `sap_wbl.webp` | Mapas de Santo Antônio da Patrulha (relevo, cidade, detalhe com ruas e prédios) | Montados com Sentinel-2 cloudless 2016 (EOX), OpenStreetMap, ESA WorldCover 2021, Microsoft Building Footprints e SRTM/NASA (créditos escritos no código) | CC BY 4.0 (EOX, WorldCover), ODbL (OpenStreetMap), SRTM é de uso livre. Microsoft: ver seção 4 | Crédito no site: ver seção 4 |
| `m14/nuvens.webp` | Camada de nuvens por cima do mapa do RS | A confirmar (não há crédito no código) | A confirmar | **A confirmar** |
| `fontes/*.woff2` (26 arquivos) | Fontes Inter, Manrope, Poppins e Instrument Serif, cópia local | Famílias abertas (o `fontes.css` registra a licença) | SIL Open Font License 1.1: uso comercial e cópia no site permitidos | Em ordem |
| Fotos enviadas pelo painel (`/midia/...`) | Fotos dos imóveis que o Erivelto cadastra | Do corretor | O termo do painel (v1) diz que ele só envia fotos que pode usar. O servidor tira EXIF e GPS | Em ordem (termo é modelo) |

Observações:
- O `site/index.html` cita muitos outros arquivos (`v26/...`, `v15/...`, `intro_v1.mp4` etc.) que **não estão na pasta**. No teste de navegador de 20/11 o site não pediu nenhum deles. Se algum voltar para a pasta, entra nesta tabela.
- Os quadros `fr/000`–`fr/156` do pacote do GEEG e de `_to_delete/v7/fr/` têm a mesma origem dos dois que ficaram.
- `privacidade.css` pede a fonte "Space Grotesk", que não está em `fontes/`: os títulos do aviso e dos termos usam a fonte do aparelho. Não é problema de licença, só de aparência.

## 3. Perguntas para o John / Erivelto

1. As 3 fotos de `casa/`: de quem é a casa, quem fotografou, e o dono autorizou o uso no site? Elas aparecem para o visitante ou são só exemplo do modo prévia?
2. O vídeo `t0/`, os quadros `fr/` e a maquete `maq/`: qual ferramenta gerou e em qual conta/plano? O plano permite uso comercial?
3. O logo "ES": quem fez? O Erivelto tem o direito de uso (arquivo original, contrato ou recibo)?
4. `m14/nuvens.webp`: de onde veio?
5. Os prédios do mapa (Microsoft Building Footprints): quando foram baixados? (ver seção 4)

## 4. Créditos dos mapas: o que foi feito e o que falta

- **Feito (21/11):** os créditos completos, com link, estão na página de termos (`/termos/`, item 8). O crédito que a EOX pede é: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)", legível e perto do uso.
- **Falta conferir na tela:** junto de cada mapa o site mostra um crédito resumido (ex.: "Sentinel-2 · OSM · Microsoft · ESA WorldCover" e "Sentinel-2 (borrado)"). O texto completo existe no código, mas não foi conferido em qual tela ele aparece. Se só o resumido aparecer, o ideal é ele levar para `/termos/#conteudo`. Isso mexe no `site/index.html`, que hoje é igual ao do artefato: fica como tarefa nova, se o John quiser.
- **Microsoft Building Footprints:** o site escreve "(ODbL)". O repositório oficial hoje informa a licença CDLA Permissive 2.0 (versões antigas saíram em ODbL). As duas permitem o uso com crédito; vale acertar o nome da licença conforme a data em que os dados foram baixados.

Fontes consultadas em 21/11/2026: s2maps.eu e eox.at (licença e texto do crédito do Sentinel-2 cloudless), github.com/microsoft/GlobalMLBuildingFootprints (licença atual), worldcover2021.esa.int (licença do WorldCover), wiki.openstreetmap.org (Microsoft Building Footprints em ODbL).
