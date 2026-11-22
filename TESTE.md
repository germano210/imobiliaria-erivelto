# Roteiro de aceite (conferir à mão)

Faça primeiro no link de teste (`https://....trycloudflare.com`, ver `compose.yaml`) e depois no domínio `https://eriveltosantosimoveis.com.br`.
Use dados inventados no teste. Marque cada passo: ok ou não ok. Anote o aparelho e o navegador.

Antes de começar: crie o usuário (`docker compose exec erivelto python app.py usuario voce@exemplo.com "Teste"`) e guarde a senha temporária.

## A. Painel, 1º acesso (celular)

| # | Faça | Deve acontecer |
|---|---|---|
| A1 | Abra `/painel/` | Pede e-mail e senha. Não mostra imóveis nem contatos |
| A2 | Entre com uma senha errada | "E-mail ou senha incorretos." |
| A3 | Entre com a senha temporária | Abre "Escolha a sua senha" |
| A4 | Troque a senha (mínimo 10 caracteres) | Abre "Termo de uso do painel" |
| A5 | Tente "Aceitar e continuar" sem marcar a caixa | Botão apagado, não deixa |
| A6 | Recarregue a página | O termo aparece de novo (não dá para pular) |
| A7 | Leia, marque a caixa e aceite | Abre o painel, aba Imóveis, "Nenhum imóvel ainda." |
| A8 | Recarregue a página | Vai direto ao painel, sem termo |

## B. Imóvel, foto e publicar (celular)

| # | Faça | Deve acontecer |
|---|---|---|
| B1 | Toque "+ Novo imóvel" e escolha "Casa" | Abre o cartão do imóvel |
| B2 | Preencha o preço e escolha a cidade | Aparecem no cartão |
| B3 | "+ Fotos" > "+ Adicionar foto": tire ou escolha uma foto | A foto aparece no cartão em alguns segundos |
| B4 | Escolha uma foto pequena ou escura | Aviso "Esta foto pode ficar ruim no site", com as duas opções |
| B5 | Abra o site em outra aba | O imóvel ainda NÃO aparece |
| B6 | Toque "Publicar no site" | "Publicado. Já está no site." |
| B7 | Aba Site do painel | Mostra o site dentro do painel |

## C. WhatsApp do site

| # | Faça | Deve acontecer |
|---|---|---|
| C1 | Antes de salvar um número: no site, abra o imóvel e toque "Pedir mais informações" | Aviso "O WhatsApp do corretor ainda não está disponível aqui." Não abre o WhatsApp |
| C2 | Painel > Perfil > Conta > WhatsApp do site: digite o número e salve | "Salvo. O site já usa este número." |
| C3 | Recarregue o site, abra o imóvel e toque "Pedir mais informações" | Abre o WhatsApp no número salvo, com a mensagem pronta citando o imóvel, a cidade e o preço |
| C4 | Painel > Perfil (recarregue) | "Toques no botão do WhatsApp do site" aumentou 1 |
| C5 | Troque o número no painel e repita C3 | Abre no número novo |

## D. Visitante (celular e depois PC)

| # | Faça | Deve acontecer |
|---|---|---|
| D1 | Abra o site em janela anônima | Carrega e mostra a busca. No pé: "Erivelto Santos · Corretor de imóveis · CRECI 63.464 · Privacidade · Termos" |
| D2 | Toque "Ver imóveis disponíveis" | Mostra o imóvel publicado, com foto, preço e cidade. A linha do pé continua e não cobre botão |
| D3 | Toque "Sobre a casa" | Abre a ficha. A linha do pé some |
| D4 | Toque "Login", preencha nome e WhatsApp sem marcar o aceite | Botão "Entrar" apagado |
| D5 | Toque no link "aviso de privacidade" | Abre o aviso em outra aba |
| D6 | Marque o aceite e entre | Fica conectado |
| D7 | Painel > Contatos (recarregue) | O nome aparece, com botão WhatsApp |
| D8 | Repita D1 a D3 no PC | Tudo cabe na tela, sem barra de rolagem lateral |

## E. Privacidade

| # | Faça | Deve acontecer |
|---|---|---|
| E1 | No pé do site, toque "Privacidade" | Abre o aviso, "Versão v3" |
| E2 | No aparelho em que entrou como visitante, toque "Ver os meus dados" | Mostra nome, WhatsApp, aceite (v3) e o contato |
| E3 | Em OUTRO aparelho, "Apagar meus dados" com o WhatsApp certo e um nome errado | "Não conseguimos confirmar..." Nada é apagado |
| E4 | Com o nome e o WhatsApp certos | "Pronto: seus dados foram apagados." |
| E5 | Painel > Contatos (recarregue) | O contato sumiu |
| E7 | No pé do site, toque "Quero vender", preencha e envie | "Recebido". O pedido aparece em Painel > Contatos, com "Quer vender" |
| E6 | No pé do site, toque "Termos" | Abre os termos de uso, "Versão v1". Antes de publicar no domínio: nenhum trecho entre [colchetes] |

## H. Situação, aluguel, código e contatos (T39–T45)

| # | Faça | Deve acontecer |
|---|---|---|
| H1 | Painel > Imóveis | Cada imóvel tem um código (ES-001…) |
| H2 | Abra um imóvel, toque "Reservado" e "Publicar mudanças"; abra o site | O cartão mostra os selos "Reservado" e o código |
| H3 | Marque "Vendido" (sem "Mostrar no site como vendido") e publique | O imóvel some do site e continua no painel |
| H4 | Crie um imóvel "Para: Aluguel", com preço 2500, e publique | No site aparece "Para alugar" e "R$ 2.500/mês"; no filtro "Tipo" aparece "Para alugar"; não tem simulação |
| H5 | Crie um sobrado (ou galpão, sala, sítio) e publique | O tipo aparece no filtro "Tipo" do site |
| H6 | Entre no site como visitante, abra a ficha, "Pedir visita", escolha dia e período | Abre o WhatsApp com a mensagem citando o código, o dia e o período. Em Painel > Contatos: "Pediu visita: …" |
| H7 | Painel > Contatos: mude a situação e escreva uma anotação; recarregue | Ficam salvas; o filtro por situação mostra o contato |
| H8 | "Baixar planilha (CSV)" e abra no Excel | Uma linha por contato, com acentos certos |

## F. Senha e sair

| # | Faça | Deve acontecer |
|---|---|---|
| F1 | Painel > Perfil > Conta > Trocar senha, com a senha atual errada | "A senha atual não confere." |
| F2 | Troque com a senha certa | "Senha trocada." |
| F3 | Perfil > Conta > Sair | Volta para a tela de login |
| F4 | Entre com a senha antiga | Não entra |
| F5 | Entre com a senha nova | Entra direto, sem termo |

## G. Segurança básica

| # | Faça | Deve acontecer |
|---|---|---|
| G1 | Sem estar logado, abra `/api/painel/estado` e `/api/painel/leads` | `{"erro":"sem_sessao"}` (401). Nenhum dado |
| G2 | Abra `/.git/config` | "Não encontrado." (404) |
| G3 | Abra `/app/app.py` | "Não encontrado." (404) |
| G4 | Abra `/.env` e `/compose.yaml` | 404 |
| G5 | Erre a senha do painel 5 vezes | "Muitas tentativas. Tente de novo em 15 min." |
| G6 | Só no domínio: o endereço abre com cadeado (https) | Sim |

Depois do G5, para liberar na hora: `docker compose exec erivelto python app.py senha email` gera senha nova e zera o bloqueio do e-mail.
