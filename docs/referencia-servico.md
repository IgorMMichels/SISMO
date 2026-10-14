# Omega Market Bots

Serviço independente (SISMO) para Market Pulse (RSS em EN/PT/ES), Funding Monitor (BTC/ETH/SOL) e resumo diário por módulo do curso, entregue no site, Discord e Telegram. Pode ficar em qualquer pasta ou numa VM; não importa arquivos do frontend, não usa chaves do Vite e não depende do banco do curso.

## Rodar local

Requer Node 22.16+ e npm. Node 24 é usado na imagem Docker.

```powershell
cd C:\Users\igor\Downloads\cursoai\bots
npm ci
Copy-Item .env.example .env.local
npm start
```

Em outro terminal, na pasta do site:

```powershell
npm run dev
```

Abra `/radar` no endereço informado pelo Vite. A página também aparece em `/curso/radar` e na seção de bots em Ferramentas. O proxy de desenvolvimento aponta para `http://127.0.0.1:8787`; se mudar a porta, configure `VITE_BOTS_API_URL` no site.

`npm run demo` funciona sem fontes externas, mostra dados fictícios e nunca envia mensagens. `npm run collect` executa um ciclo único. Rode um único coletor por `DATA_DIR`: o arquivo de estado usa escrita atômica, mas não é um banco para múltiplos processos.

## Atualizações

- Coleta padrão: 60 segundos. `COLLECTION_INTERVAL_SECONDS` aceita 30 a 3600.
- SSE publica uma atualização ao concluir cada ciclo; o site também consulta a cada 15 segundos.
- Timeout de rede e limite de tamanho por resposta; fontes falham independentemente.
- Notícias sem URL HTTPS da fonte ou data válida são descartadas. Histórico limitado a 7 dias/300 notícias; manchetes iguais são deduplicadas e preservam os links dos outros publicadores.
- 17 fontes em inglês, português e espanhol (lista e critérios em `docs/sismo-v2.md`). Decrypt é filtrado por cripto; InfoMoney/Forbes por cripto ou macroeconomia. Câmbio, juros, inflação e política monetária entram.
- Nicho do curso: cada notícia recebe `module` (Fundamentos, Memecoins, Trading, Futuros) e `topics`; previsão de preço/promessa de ganho recebe nota 2 e nunca alerta nem entra no resumo.
- Alerta imediato: tema em `NEWS_ALERT_CATEGORIES` ou importância ≥ `ALERT_MIN_IMPORTANCE` (padrão 7).
- Resumo diário por módulo (`DAILY_BRIEF_UTC_HOUR`, `DIGEST_ITEMS`); `npm run digest` roda um ciclo e envia o resumo do dia (uso com cron).
- Com IA ligada, manchetes EN/ES ganham título e resumo em PT-BR (`translation`); sem IA vão no idioma original com bandeira.
- Feed do Fed acessível sem comunicado nos últimos sete dias aparece com zero notícias, sem fingir uma falha de conexão.
- Valores antigos de funding permanecem com o horário original quando a API falha. A interface identifica falha/desatualização.
- Não há fallback silencioso para dados fictícios no modo real.

`GET /api/pulse` retorna o snapshot público. `GET /api/stream` publica eventos `pulse`. `GET /health` retorna `ok` ou `degraded`; HTTP 200 significa que o processo responde, não que todas as fontes estão saudáveis. A API é somente leitura, não revela segredos e não oferece endpoint público para disparar mensagens.

## Importância, contexto e IA opcional

Cada notícia tem prioridade de leitura estimada de 0 a 10, método, justificativa e relação educacional com cripto. 0–3: periférica; 4–5: rotina; 6–7: relevante; 8–10: impacto amplo/excepcional. Regras atribuem 4 a 8 conforme tema; a IA pode usar toda a escala. Não há calibração estatística de impacto de preço.

A veracidade fica sem nota (`verification.score=null`, `verdict=not_checked`). O radar distingue origem primária, uma fonte e cobertura semelhante, com links. Similaridade exige quatro termos significativos, Jaccard ≥0,55 e intervalo ≤36 horas. Não traduz/agrupa entre idiomas e não verifica divergências. Origem oficial identifica um comunicado do próprio órgão, sem certificar todas as alegações.

Para habilitar IA de importância/contexto, edite **o `.env.local` deste serviço** e reinicie `npm start`:

```dotenv
NEWS_AI_ENABLED=true
OPENAI_API_KEY=sua_chave_da_api
NEWS_AI_MODEL=gpt-5-mini
NEWS_AI_INTERVAL_SECONDS=300
NEWS_AI_BATCH_SIZE=10
NEWS_AI_MAX_BATCHES_PER_DAY=48
```

A API é paga separadamente. Sem habilitação/chave não há chamada. A chave nunca vai no frontend nem no snapshot público. Só manchetes/trechos das últimas 24 horas são analisados, em lotes, priorizados por regras e com cache persistido; correção no trecho invalida a análise. Até 48 tentativas/dia UTC por padrão, inclusive falhas; limite salvo antes de chamar. O lote usa Responses API com schema JSON estrito, valida IDs/notas e tem timeout de 45 segundos. A coleta aguarda a análise e agenda o próximo ciclo após concluir; não sobrepõe execuções. Em falha, recusa, limite ou demonstração, permanece por regras. IA não faz pesquisa nem fact-checking.

Filtros do site incluem Brasil/exterior, Macroeconomia, USD/BRL e importância mínima. O padrão ordena por importância; também pode ordenar por data. Alertas incluem nota/contexto. Para enviar macro aos canais, acrescente `Macroeconomia` a `NEWS_ALERT_CATEGORIES`.

RSS adicionais: [InfoMoney](https://www.infomoney.com.br/feed/), [Forbes Brasil](https://forbes.com.br/forbes-money/feed/), [Livecoins](https://livecoins.com.br/feed/), [Portal do Bitcoin](https://portaldobitcoin.uol.com.br/feed/), [CryptoSlate](https://cryptoslate.com/feed/), [Bitcoin Magazine](https://bitcoinmagazine.com/feed), [Fed](https://www.federalreserve.gov/feeds/feeds.htm). Integração IA: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Discord e Telegram

Crie um webhook num canal de teste do Discord e um bot no Telegram via BotFather. Para Telegram, envie `/start` ao bot (chat privado) ou adicione-o ao grupo; para canal, dê permissão de postagem. Obtenha o Chat ID pelo próprio Telegram Bot API/getUpdates ou pelo administrador do canal.

Configure em `bots/.env.local`:

```dotenv
DELIVERY_ENABLED=true
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/SEU_ID/SEU_TOKEN
TELEGRAM_BOT_TOKEN=SEU_TOKEN
TELEGRAM_CHAT_ID=SEU_CHAT_ID
```

O webhook do Discord deve ter o ID numérico real. Pode configurar só uma das plataformas. Reinicie o serviço ao mudar variáveis. `DELIVERY_ENABLED=false` pausa ambos.

A primeira coleta bem-sucedida de cada fonte forma a linha de base. O primeiro ciclo de cada novo destino também forma a linha de base; notícias anteriores não são enviadas. Depois disso, novas manchetes publicadas na última hora, dos temas `NEWS_ALERT_CATEGORIES`, entram na fila. Funding só alerta quando cruza o limite (padrão ±0,1%) ou muda de extremo positivo para negativo; não repete enquanto permanece do mesmo lado do limite.

A fila e o histórico de tentativas ficam em `data/state.json`, com no máximo 100 pendências por plataforma e 200 registros. Cada plataforma tenta até 3 mensagens por ciclo, com até 5 tentativas e backoff; uma falha não bloqueia a outra. Pendências expiram em 24 horas. Mudança de destino descarta pendências destinadas ao canal anterior. A fila é persistida antes do envio. Uma queda entre a aceitação da mensagem pelo provedor e a gravação do sucesso pode gerar uma repetição: a entrega tem semântica de pelo menos uma vez.

Para resumo automático nos canais, configure `DAILY_BRIEF_UTC_HOUR=9` (06h em São Paulo). `-1` desativa. Será enviado no primeiro ciclo dentro da hora escolhida, uma vez por dia; não há recuperação de dias em que o serviço estava desligado. O resumo manual do site fica sempre disponível. Os segredos ficam somente no serviço e são omitidos dos logs/API/ZIP.

## Levar para outra pasta ou VM

No Windows, na raiz do projeto:

```powershell
npm run bots:export
```

Isso cria `artifacts/omega-market-bots.zip` contendo apenas código, lockfile, testes, documentação e configuração de exemplo. Não inclui `.env.local`, dados, `node_modules`, site ou chaves. Extraia numa pasta nova, execute `npm ci`, crie `.env.local` e execute `npm start`.

### Docker numa VM Linux

Com Docker e Compose instalados, extraia o pacote em `/opt/omega-market-bots`:

```bash
cd /opt/omega-market-bots
cp .env.example .env.local
# Edite ALLOWED_ORIGINS para a origem HTTPS exata do site.
docker compose up -d --build
docker compose logs --tail=100 -f
curl http://127.0.0.1:8787/health
```

O volume `market-bots-data` mantém estado/fila entre reinícios. Não rode `docker compose down -v` se precisar preservá-lo. `restart: unless-stopped` religa o processo após reinício do host, enquanto Docker inicia no boot. Os logs têm rotação. A porta é publicada só em loopback; use proxy HTTPS para o acesso do site.

### HTTPS e conexão do site

1. Aponte um subdomínio, por exemplo `bots.seudominio.com`, para a VM e configure um proxy HTTPS. O exemplo em `deploy/Caddyfile` usa Caddy no host e `BOTS_DOMAIN` no ambiente desse serviço. Abra as portas 80/443 necessárias ao proxy; mantenha 8787 em loopback.
2. Em `.env.local` dos bots, configure `ALLOWED_ORIGINS=https://seudominio.com,https://www.seudominio.com`, ajustando aos domínios realmente usados. CORS restringe navegadores; o feed continua sendo público.
3. No ambiente de build do site, configure `VITE_BOTS_API_URL=https://bots.seudominio.com` e gere/publice novamente o frontend. Essa URL não é segredo. Não use HTTP para um site HTTPS.
4. Verifique `https://bots.seudominio.com/health` e abra o radar do site. SSE requer proxy sem buffer; o exemplo usa `flush_interval -1`. Se o proxy bloquear SSE, o polling continua.

Em produção, sem `VITE_BOTS_API_URL`, o site informa que o radar não foi conectado. O serviço da VM pode ser atualizado independentemente do frontend enquanto o contrato da API v1 for mantido.

### Sem Docker

`deploy/omega-market-bots.service` é uma alternativa systemd. Crie o usuário/grupo `omega-bots`, instale Node, execute `npm ci --omit=dev` na pasta, crie o diretório `data` e atribua a pasta ao usuário do serviço. Ajuste `ExecStart` se Node não estiver em `/usr/bin/node`. Instale a unit em `/etc/systemd/system`, execute `systemctl daemon-reload` e `systemctl enable --now omega-market-bots`. O mesmo proxy HTTPS se aplica. Escolha Docker ou systemd; não rode ambos sobre a mesma porta/estado.

## Testes e limites do piloto

`npm test` verifica normalização, URLs/datas, deduplicação, fontes com falha, retomada, fila independente, retries, contratos HTTP e SSE, sem enviar a canais reais. `npm run collect` verifica as fontes reais, sujeito à disponibilidade regional dos provedores.

O feed e as taxas são reais; temas/ativos são heurísticos. Há importância de 0 a 10 por regras explicáveis ou IA opcional. Não há nota de verdade, análise de sentimento ou promessa de reversão: a apuração independente é pendente. Manchetes semelhantes só fornecem links para comparação; podem repetir a mesma agência e não comprovam o fato. Funding usa `lastFundingRate` e `nextFundingTime` informados pela Binance, sem supor que todos os contratos tenham o mesmo intervalo. O resumo reúne três destaques das últimas 24 horas por importância estimada e as taxas disponíveis.

Fontes e APIs: [RSS do CoinDesk](https://www.coindesk.com/coindesk-news/2021/09/17/coindesk-rss), [Cointelegraph RSS](https://cointelegraph.com/rss), [Decrypt RSS](https://decrypt.co/feed), [Binance Futures](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Mark-Price), [Discord webhooks](https://docs.discord.com/developers/resources/webhook#execute-webhook), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage).

A avaliação dos demais módulos está em `docs/bots-avaliacao.md` no repositório do site. Nenhuma infraestrutura remota foi provisionada por esta implementação.
