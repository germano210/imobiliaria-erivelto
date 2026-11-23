# Erivelto Santos · site + painel

Site do corretor de imóveis Erivelto Santos (CRECI 63.464, Santo Antônio da Patrulha/RS), com painel para ele cadastrar os imóveis.
Um app só (FastAPI) serve o site, o painel, o aviso de privacidade e a API. Os dados ficam num PostgreSQL e as fotos numa pasta.
Quem mantém: Loud House.

## Estrutura

| Caminho | O que é |
|---|---|
| `site/` | Front estático. `index.html` (site), `painel/` (painel: `index.html`, `c.js`, `c.css`, `termo.html`), `privacidade/` (aviso), `termos/` (termos de uso do site). |
| `site/ponte.js`, `site/ponte.css` | Ligam as páginas à API. Sem servidor, as páginas abrem em modo prévia. Também têm o que o site mostra a mais (selos, aluguel, pedir visita, quero vender). |
| `remendos.py` | As trocas feitas no `site/index.html` (minificado, vem do artefato). Se o artefato for trazido de novo: `python3 remendos.py`. |
| `app/app.py` | Servidor (API + arquivos) e comandos de usuário. |
| `app/testes/` | Testes pytest. `app/testes/e2e/` tem o roteiro de navegador (Playwright). |
| `Dockerfile` | Imagem do app (usuário sem root; fotos em `/dados`). |
| `compose.yaml` | **Teste** na sua máquina (é o padrão: `docker compose ...` sem `-f`). Não precisa de `.env`. |
| `compose.producao.yaml` | **Produção**: app + banco + túnel opcional. Sempre com `-f compose.producao.yaml`. **Nunca foi executado.** |
| `PUBLICAR.md` | O que falta antes de publicar e a origem/licença das mídias. |
| `.env.example` | Modelo das variáveis. O `.env` de verdade nunca vai para o Git. |
| `backup.sh`, `restaurar.sh` | Backup cifrado (age) e restauração conferida. |
| `TESTE.md` | Roteiro de aceite para conferir à mão. |

## Variáveis de ambiente

Lista completa e comentada em `.env.example`. As principais:

| Variável | Para quê | Padrão |
|---|---|---|
| `ERV_BANCO` | Endereço do PostgreSQL (obrigatória) | - |
| `ERV_CHAVE_DADOS` | Chave que cifra nome e WhatsApp dos visitantes (obrigatória). Gere com `python app/app.py chave`. Perdeu a chave = perdeu os contatos | - |
| `ERV_ORIGENS` | Endereços do site que podem mudar dados, separados por vírgula | - |
| `ERV_HTTPS` | `1` = cookie Secure + HSTS. `0` só em teste local | `1` |
| `ERV_NOINDEX` | `1` = pede aos buscadores para não indexar | `1` |
| `ERV_TUNEL_TESTE` | `1` = aceita `https://*.trycloudflare.com` (só no teste) | `0` |
| `ERV_IP_CABECALHO` | Cabeçalho com o IP real (ex.: `CF-Connecting-IP`) | vazio |
| `ERV_PLANO` | `basico`, `fasico` ou `erivelto` | `erivelto` |
| `ERV_AVISO_VERSAO` | Versão do aviso de privacidade que o visitante aceita | `v3` |
| `ERV_TERMO_VERSAO` | Versão do termo que o corretor aceita no painel | `v1` |
| `ERV_LEADS_MESES` | Meses sem atividade até apagar um contato. `0` = não apaga sozinho | `0` |
| `ERV_FOTO_LADO` | Lado maior da foto guardada (px) | `2560` |
| `ERV_WHATSAPP` | Número inicial do site, enquanto o painel não salvar outro. Vazio = botão só avisa | vazio |
| `ERV_SITE`, `ERV_DADOS` | Pastas do site e dos dados (no Docker já vêm certas) | - |
| `POSTGRES_*`, `ERV_BACKUP_*` | Banco no Docker e backup | - |
| `ERV_PORTA`, `ERV_TUNEL_TOKEN`, `COMPOSE_PROFILES` | Só no `compose.producao.yaml`: porta em `127.0.0.1` e túnel dentro do compose | `8080`, vazio, vazio |

Versões: se mudar o texto do aviso, mude a versão em `site/privacidade/index.html`, em `AVISO_VERSAO` no `site/ponte.js` e em `ERV_AVISO_VERSAO`.
Se mudar o termo, mude em `site/painel/termo.html` e em `ERV_TERMO_VERSAO` (o painel pede o aceite de novo). Os testes conferem se batem.

## Teste local (Docker)

**Não testado nesta revisão:** os comandos de Docker abaixo não foram executados depois das últimas mudanças (o ambiente de desenvolvimento não tinha Docker). O app em si foi testado sem Docker (pytest e navegador).

Na pasta do projeto, sem `.env` e sem `-f` (o `compose.yaml` é o de teste):

```
docker compose up -d --build
docker compose exec erivelto python app.py usuario voce@exemplo.com "Teste"
docker compose logs tunel
```

- O 1º comando sobe banco + app + túnel. O 2º cria a conta do painel e mostra a senha temporária uma vez (no 1º acesso o painel pede outra senha e o aceite do termo). Mais contas: repita com outro e-mail. Ver quem tem acesso: `docker compose exec erivelto python app.py usuarios`.
- Abre em `http://localhost:8090` (painel em `/painel/`) e no link `https://....trycloudflare.com` que aparece no 3º comando (para abrir no celular). O link muda a cada reinício do túnel.
- O túnel é o único serviço que dá para dispensar: se só for testar no PC, `docker compose up -d --build banco erivelto` sobe sem ele. Banco e app são obrigatórios.
- Desligar: `docker compose down`. Apagar os dados de teste: `docker compose down -v`.
- Banco e fotos ficam em volumes do Docker (não em pasta), para funcionar no Docker Desktop do Windows.
- Os segredos do `compose.yaml` são fixos e públicos: só para teste, sem dado real.

Depois siga o `TESTE.md`.

## Usuário, senha, e-mail e WhatsApp

Os comandos rodam dentro do container do app (no teste: `docker compose exec erivelto python app.py ...`; em produção: `docker compose -f compose.producao.yaml exec erivelto python app.py ...`).

| Para | Como |
|---|---|
| Criar usuário | `python app.py usuario email@exemplo.com "Nome"` (mostra a senha temporária uma vez) |
| Listar usuários | `python app.py usuarios` (mostra senha temporária/definida e aceite do termo) |
| Esqueceu a senha | `python app.py senha email@exemplo.com` (senha temporária nova; derruba as sessões) |
| Trocar a senha | O próprio corretor: painel > Perfil > Conta > Trocar senha |
| Trocar o e-mail de login | `python app.py email antigo@exemplo.com novo@exemplo.com`. Existe também a rota `PUT /api/painel/email`, ainda sem tela no painel |
| Trocar o WhatsApp do site | O corretor: painel > Perfil > Conta > WhatsApp do site. Sem número salvo, o botão do site só avisa |
| Tirar um imóvel do site sem excluir | Rota `POST /api/painel/imoveis/<id>/despublicar`, ainda sem botão no painel |
| Limpeza | `python app.py limpar` (também roda sozinha 1 vez por dia) |

No 1º acesso o painel pede: trocar a senha temporária e aceitar o termo de uso (`site/painel/termo.html`). O aceite fica na tabela `termos` (usuário, versão, data e hora, IP).
Não há comando para excluir usuário nem para apagar o contato de um visitante a pedido dele (o visitante apaga sozinho em `/privacidade/`).

## O que o corretor faz no painel (T39–T45)

- **Imóvel:** código automático (ES-001, ES-002…), "Para: Venda ou Aluguel" (aluguel: preço por mês, condomínio e IPTU, sem financiamento), situação Disponível, Reservado ou Vendido (vendido sai do site, a não ser que marque "Mostrar no site como vendido"). Tipos: casa, sobrado, apartamento, terreno, sítio ou chácara, sala comercial, galpão. Tudo vale depois de "Publicar".
- **Contatos:** filtro por situação (novo, já falei, visita marcada, proposta, fechado, perdido), anotação curta, pedidos de visita e de venda, e "Baixar planilha (CSV)".
- **No site:** selos no cartão e na ficha, a categoria "Para alugar" no filtro de tipo, o botão "Pedir visita" na ficha (dia e período vão na mensagem do WhatsApp) e o link "Quero vender" no pé da página.
- **Rotas novas:** `PUT /api/painel/leads/<id>` (situação e anotação) e `POST /api/vender` (formulário "Quero vender"; limite de 10 por hora por IP).

## R86 (23/11) · pedidos do Erivelto e do John

- **Painel:** cômodos e "o que tem" viram linhas editáveis (ícone de uma grade de 32, nome, medida em m² ou vagas, observação; adicionar e excluir). Ficam em `cm` e `ot` no imóvel; `c`, `x`, `outros` e `infos` continuam saindo deles (o site antigo segue lendo). Campos novos: `onde` {t: cf|ca|lot|bairro|outro, n, e}, `per` (aluguel: mes|dia|ano), `end`/`nomes` (já tratados pelo `para_visitante`), `mapa` + `loc` (toque no mapa; só há imagem de Santo Antônio da Patrulha) e `px` (lugares perto). Contatos em 2 grupos ("Querem comprar ou alugar" × "Querem anunciar"). Aba **Desempenho**. Cor `#003641`.
- **Servidor:** tabela `aberturas` (dia, imóvel, total; sem IP, conta ou cookie), `POST /api/visto` (limite 120/h por IP, só soma) e `GET /api/painel/desempenho`. O `migrar()` cria a tabela sozinho na subida.
- **Site (ponte.js/ponte.css):** cor `#003641`, botão "Anunciar meu imóvel" ao lado do Login (abre o "Quero vender"), letras maiores, cartão de vidro branco com a foto à esquerda e "Ver cômodos", a lista some por baixo do grid de busca, ficha com "Onde fica" e cômodos/itens em quadrados com ícone, "Pedir visita" em forma de conversa, aluguel /mês, /dia ou /ano (`PONTE.sufixo`, nos remendos do T40).
- Testes: `app/testes/test_r86_desempenho_e_campos.py` (4). Total: 108 passam.

## Backup e restauração

- `./backup.sh`: gera `erivelto-AAAA-MM-DD_HHMM.tar.age` (banco + fotos), cifrado com a chave pública do age (`ERV_BACKUP_CHAVE`), em `ERV_BACKUP_DESTINO`. Apaga os com mais de 14 dias. A chave privada fica fora do servidor.
- `./restaurar.sh arquivo.tar.age chave-privada.txt`: restaura num banco novo e numa pasta nova, confere se as fotos batem e mostra os passos para colocar no ar. Não mexe no site em uso.
- Agendar o backup (cron) é passo de instalação: **não testado** aqui.
- O `backup.sh` lê as fotos de uma pasta (`dados/midia`). No `compose.yaml` (teste) as fotos ficam em volume: o backup não se aplica ao teste local.

## Testes

```
cd app && pip install -r requirements-teste.txt && python3 -m pytest testes     # 104 testes; precisa de PostgreSQL na máquina
python3 app/testes/e2e/roteiro.py                                                 # navegador: celular e PC, 19 passos (ver app/testes/e2e/LEIA-ME.md)
python3 remendos.py --conferir                                                    # os remendos do site/index.html estão aplicados
```

## Instalar no servidor

**Não testado:** o `compose.producao.yaml` foi escrito e conferido só como arquivo (não havia Docker no ambiente de desenvolvimento). **Nenhum passo abaixo foi executado.** O 1º `up` no servidor é a conferência; se algo falhar, anote a mensagem.

1. Servidor Ubuntu com Docker e o plugin do Compose instalados.
2. Copiar o projeto para uma pasta própria (ex.: `/srv/erivelto`), separada dos outros sites do servidor.
3. Criar o `.env` a partir do `.env.example`. Nunca reutilizar os valores do `compose.yaml` (teste). **Todo comando de produção leva `-f compose.producao.yaml`**: sem ele, o Docker usa o compose de teste.
   - `POSTGRES_USER`, `POSTGRES_DB` (ex.: `erivelto`) e `POSTGRES_PASSWORD` (só letras e números: `openssl rand -hex 24`). O `ERV_BANCO` pode ficar vazio: o compose monta o endereço com essas três.
   - `ERV_CHAVE_DADOS`: gere com `docker run --rm python:3.13-slim python -c "import base64,secrets;print(base64.b64encode(secrets.token_bytes(32)).decode())"` (ou `python app/app.py chave`, se a máquina tiver as bibliotecas do app). Guarde uma cópia fora do servidor.
   - `ERV_ORIGENS=https://eriveltosantosimoveis.com.br,https://www.eriveltosantosimoveis.com.br`
   - `ERV_IP_CABECALHO=CF-Connecting-IP` (já é o padrão no compose), `ERV_NOINDEX=1` por enquanto.
   - `ERV_PORTA`: a porta que o servidor já reserva para o Erivelto (padrão `8080`). Conferir se está livre: `ss -ltn | grep :8080`.
4. Criar a pasta das fotos com o dono certo: `mkdir -p dados/midia && sudo chown -R 1000:1000 dados`.
5. Subir: `docker compose -f compose.producao.yaml up -d --build`. Conferir: `docker compose -f compose.producao.yaml ps` (os serviços ficam "healthy") e `curl -s http://127.0.0.1:8080/api/saude`.
6. Cloudflare Tunnel: **o túnel do Erivelto fica numa conta do Cloudflare diferente da conta dos outros sites do mesmo servidor.** Duas formas, escolha uma:
   - já existe um cloudflared no servidor para o Erivelto: no painel do Cloudflare, apontar o domínio para `http://127.0.0.1:<ERV_PORTA>`;
   - túnel dentro do compose: no `.env`, `ERV_TUNEL_TOKEN=<token do túnel dessa conta>` e `COMPOSE_PROFILES=tunel`; no painel do Cloudflare, apontar o domínio para `http://erivelto:8000`; subir de novo com `docker compose -f compose.producao.yaml up -d`.
7. Criar o usuário do Erivelto (`docker compose -f compose.producao.yaml exec erivelto python app.py usuario email "Nome"`) e entregar a senha temporária por um canal seguro.
8. Agendar o `backup.sh` (cron diário) e fazer um teste de `restaurar.sh`.
9. Seguir o `PUBLICAR.md` e o `TESTE.md` no domínio. Só depois trocar `ERV_NOINDEX=0`.

Atualizar depois de um `git pull`: `docker compose -f compose.producao.yaml up -d --build`. Nunca rodar `down -v` em produção: apaga o banco.

Pendências conhecidas: T02 (revisão jurídica do aviso de privacidade, do termo do painel e dos termos de uso, que hoje são modelos); campos entre colchetes em `site/termos/index.html`; perguntas sobre as mídias (`PUBLICAR.md`).
