# Testes de navegador (e2e)

Roteiro Playwright que usa o site e o painel de verdade, em modo servidor, do começo ao fim.

## Rodar

Na raiz do projeto:

```
pip install -r app/requirements-teste.txt playwright
python3 -m playwright install chromium
python3 app/testes/e2e/roteiro.py              # celular (iPhone 13) e PC (1366x768)
python3 app/testes/e2e/roteiro.py celular      # só um: celular | pc
python3 app/testes/e2e/roteiro.py --capturas   # guarda imagens em dados-teste/e2e-capturas/
```

Precisa de PostgreSQL instalado na máquina (`initdb` e `pg_ctl`), ou da variável `ERV_TESTE_BANCO=postgresql://...`
(atenção: as tabelas desse banco são usadas pelo teste). Não usa Docker nem internet.
O roteiro sobe um banco temporário e o app (`ERV_HTTPS=0`) numa porta livre e apaga tudo no fim. Leva cerca de 3 minutos.
Sai com código 0 quando todos os passos passam. Com `E2E_DEBUG=1` mostra o erro completo.

Para só deixar o site no ar e olhar à mão: `python3 app/testes/e2e/servidor_local.py voce@exemplo.com`
(mostra o endereço e a senha temporária; Ctrl+C desliga e apaga).

## O que o roteiro faz (19 passos, em cada aparelho)

1. Cria o usuário pela linha de comando.
2. Segurança básica: painel sem login dá 401, senha errada não entra, `/.git/config` e `/app/app.py` dão 404.
3. Entra com a senha temporária e troca a senha.
4. Termo do painel: aparece antes de tudo, sem aceite a API dá 403, o aceite fica no banco.
5. Cadastra um imóvel pela interface (tipo, preço, cidade, 1 foto enviada) e publica.
6. Abre o site em outro navegador e vê o imóvel.
7. Linha com CRECI e links Privacidade, Termos e Quero vender na busca e nos resultados.
8. Sem número salvo, o botão do WhatsApp só avisa.
9. Visitante entra (nome + WhatsApp + aceite) e vira contato no painel.
10. Salva o WhatsApp do site no painel.
11. O botão abre `https://wa.me/55…` com a mensagem pronta; a chamada aparece no painel.
12. Troca o número no painel. 13. O site usa o número novo.
14. T39–T45: reservado e código no site, vendido escondido, "Para alugar" no filtro, pedir visita, quero vender, situação, anotação e planilha dos contatos.
15. Privacidade: versão v3, ver os dados, apagar os dados.
16. Aba Site do painel. 17. Troca de senha. 18. Sair. 19. Sem erros de JavaScript.

## O que este roteiro NÃO cobre

- Safari de verdade: o "celular" é o Chromium com tamanho, toque e identificação do iPhone 13.
- O aplicativo do WhatsApp: a chamada a `wa.me` é interceptada; confere-se o endereço e a mensagem.
- Câmera do celular: a foto vem de um arquivo gerado pelo teste.
- HTTPS, Cloudflare e Docker (confira à mão com o `TESTE.md`).
