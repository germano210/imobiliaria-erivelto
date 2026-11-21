# Erivelto Santos · site + painel

Site do corretor de imóveis Erivelto Santos (CRECI 63.464, Santo Antônio da Patrulha/RS), com painel para ele cadastrar os imóveis.
Um app só (FastAPI) serve o site, o painel, o aviso de privacidade e a API. Os dados ficam num PostgreSQL e as fotos numa pasta.
Quem mantém: Loud House.

## Estrutura

| Caminho | O que é |
|---|---|
| `site/` | Front estático. `index.html` (site), `painel/` (painel: `index.html`, `c.js`, `c.css`, `termo.html`), `privacidade/` (aviso). |
| `site/ponte.js`, `site/ponte.css` | Ligam as páginas à API. Sem servidor, as páginas abrem em modo prévia. |
| `app/app.py` | Servidor (API + arquivos) e comandos de usuário. |
| `app/testes/` | Testes pytest. `app/testes/e2e/` tem o roteiro de navegador (Playwright). |
| `Dockerfile` | Imagem do app (usuário sem root; fotos em `/dados`). |
| `compose.teste.yaml` | Instância de teste local com link público temporário. |
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
| `ERV_AVISO_VERSAO` | Versão do aviso de privacidade que o visitante aceita | `v2` |
| `ERV_TERMO_VERSAO` | Versão do termo que o corretor aceita no painel | `v1` |
| `ERV_LEADS_MESES` | Meses sem atividade até apagar um contato. `0` = não apaga sozinho | `0` |
| `ERV_FOTO_LADO` | Lado maior da foto guardada (px) | `2560` |
| `ERV_WHATSAPP` | Número inicial do site, enquanto o painel não salvar outro. Vazio = botão só avisa | vazio |
| `ERV_SITE`, `ERV_DADOS` | Pastas do site e dos dados (no Docker já vêm certas) | - |
| `POSTGRES_*`, `ERV_BACKUP_*` | Banco no Docker e backup | - |

Versões: se mudar o texto do aviso, mude a versão em `site/privacidade/index.html`, em `AVISO_VERSAO` no `site/ponte.js` e em `ERV_AVISO_VERSAO`.
Se mudar o termo, mude em `site/painel/termo.html` e em `ERV_TERMO_VERSAO` (o painel pede o aceite de novo). Os testes conferem se batem.

## Teste local (Docker)

**Não testado nesta revisão:** os comandos de Docker abaixo não foram executados depois das últimas mudanças (o ambiente de desenvolvimento não tinha Docker). O app em si foi testado sem Docker (pytest e navegador).

```
docker compose -f compose.teste.yaml up -d --build
docker compose -f compose.teste.yaml logs tunel
docker exec -it erivelto-teste python app.py usuario voce@exemplo.com "Teste"
```

- Abre em `http://localhost:8090` (porta 8090) e no link `https://....trycloudflare.com` que aparece no log do túnel. O link muda a cada reinício do túnel.
- O terceiro comando cria o usuário e mostra a senha temporária uma vez.
- Desligar: `docker compose -f compose.teste.yaml down`. Apagar os dados de teste: `docker compose -f compose.teste.yaml down -v`.
- Banco e fotos ficam em volumes do Docker (não em pasta), para funcionar no Docker Desktop do Windows.
- Os segredos do `compose.teste.yaml` são fixos e públicos: só para teste, sem dado real.

Depois siga o `TESTE.md`.

## Usuário, senha, e-mail e WhatsApp

Os comandos rodam dentro do container do app (no teste: `docker exec -it erivelto-teste python app.py ...`).

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

## Backup e restauração

- `./backup.sh`: gera `erivelto-AAAA-MM-DD_HHMM.tar.age` (banco + fotos), cifrado com a chave pública do age (`ERV_BACKUP_CHAVE`), em `ERV_BACKUP_DESTINO`. Apaga os com mais de 14 dias. A chave privada fica fora do servidor.
- `./restaurar.sh arquivo.tar.age chave-privada.txt`: restaura num banco novo e numa pasta nova, confere se as fotos batem e mostra os passos para colocar no ar. Não mexe no site em uso.
- Agendar o backup (cron) é passo de instalação: **não testado** aqui.
- O `backup.sh` lê as fotos de uma pasta (`dados/midia`). No `compose.teste.yaml` as fotos ficam em volume: o backup não se aplica ao teste local.

## Testes

```
cd app && pip install -r requirements-teste.txt && python3 -m pytest testes     # 80 testes; precisa de PostgreSQL na máquina
python3 app/testes/e2e/roteiro.py                                                 # navegador: celular e PC (ver app/testes/e2e/LEIA-ME.md)
```

## Instalar no servidor

**Atenção: o docker-compose de produção ainda NÃO existe. É a tarefa T25, pendente.** Os passos abaixo são o plano; **nenhum foi testado**.

1. Servidor Ubuntu com Docker e o plugin do Compose instalados.
2. Copiar o projeto para uma pasta própria (ex.: `/srv/erivelto`), separada dos outros sites do servidor.
3. Criar o `.env` a partir do `.env.example`: `ERV_BANCO`, `ERV_CHAVE_DADOS` (`python app/app.py chave`; guarde uma cópia fora do servidor), `ERV_ORIGENS=https://eriveltosantosimoveis.com.br,https://www.eriveltosantosimoveis.com.br`, `ERV_HTTPS=1`, `ERV_IP_CABECALHO=CF-Connecting-IP`, `ERV_TUNEL_TESTE=0`, senhas do Postgres. Nunca reutilizar os valores do `compose.teste.yaml`.
4. Escrever o compose de produção (T25): app + banco + cloudflared, sem porta aberta para fora, reinício automático. Se as fotos ficarem em pasta (`./dados`), ela precisa pertencer ao usuário 1000 do container (`chown -R 1000 dados`).
5. Cloudflare Tunnel: **o túnel do Erivelto fica numa conta do Cloudflare diferente da conta dos outros sites do mesmo servidor.** Criar o túnel e o token nessa conta, apontar o domínio para o serviço do app e rodar um cloudflared próprio para ele, sem misturar com o cloudflared dos outros sites.
6. Subir, criar o usuário do Erivelto (`python app.py usuario ...`) e entregar a senha temporária por um canal seguro.
7. Agendar o `backup.sh` (cron diário) e fazer um teste de `restaurar.sh`.
8. Seguir o `TESTE.md` no domínio. Só depois trocar `ERV_NOINDEX=0`.

Pendências conhecidas: T25 (compose de produção), T02 (revisão jurídica do aviso de privacidade e do termo, que hoje são modelos).
