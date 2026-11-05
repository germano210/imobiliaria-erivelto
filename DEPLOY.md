# Publicar o site com Docker no Ubuntu Server

Este repositório é um site estático. O Docker usa Caddy para servir os ficheiros e gerir HTTPS automaticamente. Substitua `site.seudominio.com.br` pelo domínio ou subdomínio escolhido.

## 1. Preparar o acesso externo

1. Reserve um IP local fixo para o Ubuntu no router, por exemplo `192.168.1.50`.
2. No painel DNS do domínio, crie um registo `A` para o nome escolhido apontando ao **IP público** da sua ligação. Crie um registo `AAAA` somente se tiver IPv6 público funcional.
3. No router, encaminhe as portas TCP `80` e `443` para o IP local do Ubuntu. Confirme que essas portas não estão ocupadas por outro serviço no servidor.
4. Se o IP público mudar, configure a atualização dinâmica do DNS com o seu fornecedor. Se a ligação estiver em CGNAT ou o operador bloquear as portas, será necessário obter um IP público ou usar uma solução de túnel.

## 2. Instalar o Docker

Instale o Docker Engine e o plugin Compose pelo [guia oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Verifique a instalação:

```bash
sudo docker version
sudo docker compose version
```

Se usar UFW, preserve a regra de acesso SSH antes de fazer alterações. As portas publicadas pelo Docker podem contornar as regras do UFW; confira as portas expostas em `compose.yaml` e restrinja outros serviços no router ou na configuração de firewall adequada ao Docker.

## 3. Enviar o projeto e iniciar

Com o SSH ativo no Ubuntu, transfira esta pasta pelo PowerShell do Windows (substitua `usuario` e `IP_LOCAL_DO_UBUNTU`):

```powershell
cd D:\trabalhos
scp -r .\projeto-eriveltosantosimoveis usuario@IP_LOCAL_DO_UBUNTU:~/
```

Também pode usar Git: faça commit e push dos ficheiros de Docker adicionados antes de clonar o repositório no servidor. Na pasta do projeto no Ubuntu:

```bash
cd ~/projeto-eriveltosantosimoveis
cp .env.example .env
nano .env
sudo docker compose config
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 site
```

No `.env`, defina exatamente o domínio que apontou no DNS, por exemplo `SITE_DOMAIN=site.seudominio.com.br`. Não inclua `https://` nem uma barra final. O Caddy emite e renova o certificado automaticamente depois de o DNS e as portas estarem corretos.

Teste a partir de uma rede externa (por exemplo, dados móveis):

```bash
curl -I https://site.seudominio.com.br
```

## Atualizar o site

Depois de enviar as novas alterações para a pasta do servidor:

```bash
sudo docker compose up -d --build
```

Os certificados ficam no volume persistente `caddy_data`, preservado nas recriações normais do contêiner. Não execute `docker compose down -v` se quiser mantê-los.

## Alternativa: Cloudflare Tunnel

Use esta opção se preferir publicar o site sem encaminhar portas no router, inclusive em ligações com CGNAT. Neste procedimento, coloque o domínio na Cloudflare com DNS gerido por ela. O contêiner `site` não publica portas no Ubuntu; o `tunnel` liga-se à Cloudflare e encaminha o tráfego pela rede interna do Docker.

1. Em **Cloudflare > Networking > Tunnels**, crie um túnel gerido pelo painel. Na opção de instalação por Docker, copie **apenas o token** do comando apresentado; não execute esse comando separadamente.
2. No Ubuntu, se ainda não houver `.env`, execute `cp .env.tunnel.example .env`. Depois abra-o com `nano .env` e substitua `cole_aqui_o_token_do_tunnel` pelo token real. Se o `.env` já existir, acrescente a variável `CLOUDFLARE_TUNNEL_TOKEN` sem remover as outras. Guarde o token somente no `.env`, que é ignorado pelo Git.
3. Se a publicação direta deste projeto estiver em execução, pare-a com `sudo docker compose down` (sem `-v`). Depois inicie o modo túnel:

```bash
cd ~/projeto-eriveltosantosimoveis
sudo docker compose -f compose.tunnel.yaml up -d --build
sudo docker compose -f compose.tunnel.yaml ps
sudo docker compose -f compose.tunnel.yaml logs --tail=100 tunnel
```

4. No túnel, adicione uma rota do tipo **Published application**. Escolha o subdomínio e o domínio desejados, por exemplo `site.seudominio.com.br`. Em **Service URL**, informe **`http://site:80`**. `site` é o nome do serviço dentro da rede Docker; `localhost` apontaria para o próprio contêiner `cloudflared`. Se já houver um registo A, AAAA ou CNAME com o mesmo nome, remova-o antes de criar a rota; o painel da Cloudflare cria o registo DNS do túnel.

Teste `https://site.seudominio.com.br` de uma rede externa. Neste modo não é necessário criar um registo A para o IP da sua casa nem encaminhar as portas 80/443 no router. Se o túnel não se conectar, verifique os logs e a saída de rede na porta `7844` (UDP ou TCP). Para atualizar o site após copiar novos ficheiros, execute novamente `sudo docker compose -f compose.tunnel.yaml up -d --build`.
