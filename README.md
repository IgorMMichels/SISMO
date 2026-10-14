# SISMO

Bot de notícias cripto para o nicho do curso (fundamentos, memecoins, trading e futuros). Varre 17 feeds RSS em inglês, português e espanhol, dá nota de importância de 0 a 10 e entrega em três lugares:

- **Site**: API `GET /api/pulse` e `GET /api/stream` (SSE).
- **Discord**: webhook, com alerta por notícia e resumo diário em embed.
- **Telegram**: bot, com alerta por notícia e resumo diário em HTML.

Não dá recomendação de compra ou venda e não checa a veracidade das notícias. Toda mensagem diz isso.

## Rodar local

Requer Node 22.16 ou mais novo.

```bash
npm ci
cp .env.example .env.local
npm test
npm run demo      # dados fictícios, nunca envia mensagens
npm run collect   # um ciclo com fontes reais, sem enviar (DELIVERY_ENABLED=false)
npm start         # serviço contínuo em http://127.0.0.1:8787
```

## Configurar os canais

Edite `.env.local`:

```dotenv
DELIVERY_ENABLED=true
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/ID/TOKEN
TELEGRAM_BOT_TOKEN=token_do_BotFather
TELEGRAM_CHAT_ID=id_do_chat_ou_canal
DAILY_BRIEF_UTC_HOUR=11
ALLOWED_ORIGINS=https://seudominio.com
```

1. Discord: canal → Integrações → Webhooks → Novo webhook → copiar URL.
2. Telegram: converse com @BotFather, `/newbot`, copie o token. Adicione o bot ao canal ou grupo (administrador, no caso de canal) e pegue o `chat_id` em `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. IA opcional (nota refinada e tradução EN/ES para PT-BR): `NEWS_AI_ENABLED=true` e `OPENAI_API_KEY`. Sem chave, o bot usa só regras.

`.env.local` fica fora do Git. Nunca commite tokens.

## Levar para a VM

Escolha **um** modo.

### Docker (recomendado)

```bash
git clone https://github.com/IgorMMichels/SISMO.git /opt/sismo
cd /opt/sismo
cp .env.example .env.local   # preencher
docker compose up -d --build
docker compose logs --tail=100 -f
curl http://127.0.0.1:8787/health
```

O volume `market-bots-data` guarda o estado e a fila. Não use `docker compose down -v` se quiser preservá-lo. A porta fica só em loopback; para o site acessar, use o proxy HTTPS de `deploy/Caddyfile`.

### systemd, sem Docker

Use `deploy/omega-market-bots.service` (ajuste o caminho para `/opt/sismo`), com `npm ci --omit=dev`.

### Só uma vez por dia (cron)

```bash
0 11 * * *  cd /opt/sismo && /usr/bin/node src/collect.mjs --digest >> /var/log/sismo.log 2>&1
```

Esse modo não alimenta o site em tempo real e só alerta durante a execução.

## Primeira execução

Cada fonte e cada destino novo só forma a linha de base: o histórico não é despejado no canal e o resumo do dia é marcado como enviado. O primeiro resumo real chega no dia seguinte. Para ver um na hora, pare o serviço, apague `lastBriefDate` em `data/state.json`, suba de novo e rode `npm run digest`.

## Documentação

- [docs/algoritmo-e-plano.md](docs/algoritmo-e-plano.md): como o bot decide, limites conhecidos e passos de deploy.
- [docs/referencia-servico.md](docs/referencia-servico.md): referência detalhada do serviço (API, fila, IA, HTTPS). Algumas partes citam o site do curso, onde o radar é exibido.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/` | coleta, nicho, nota, resumo, entrega, servidor |
| `test/` | testes (`npm test`), sem rede e sem envio real |
| `deploy/` | Caddyfile e unit systemd |
