# SISMO v2 — bot triplo (site + Discord + Telegram)

O SISMO é o serviço `bots/` (Node, sem framework, estado em `data/state.json`). A v2 mantém a arquitetura que já funcionava e muda o que o bot **entende** (nicho do curso, 3 idiomas) e o que ele **entrega** (alerta + resumo diário por módulo).

## Como o bot funcionava (v0.2) e o que faltava

Ciclo a cada 60 s: lê 10 RSS → valida URL/data → deduplica por título → categoriza por regex → nota 0–10 por regras (IA opcional) → agrupa cobertura parecida → alerta Discord/Telegram → resumo diário com 3 manchetes → publica snapshot no site (`/api/pulse`, SSE).

| Lacuna | Efeito |
|---|---|
| Sem noção do curso | 161 de 300 notícias caíam em "Mercado" genérico; memecoins, futuros e trading não existiam como tema |
| Sem espanhol, poucas fontes de nicho | 10 fontes, só 4 em PT e nenhuma em ES; nada focado em golpes/rug pulls |
| Manchete em inglês ia crua para o canal | aluno iniciante lia EN sem tradução |
| Alerta só por categoria, janela de 1 h | notícia 8/10 fora das 3 categorias nunca alertava; previsão de preço (clickbait) passava |
| Resumo diário = 3 itens, texto simples, só às `HH:00 UTC` exatas | resumo perdido se a VM reiniciasse na hora; cortado em 3000 caracteres; sem estrutura por módulo |

## Algoritmo da v2 (por ciclo)

1. **Coleta** — 17 fontes em paralelo (`Promise.allSettled`, timeout 12 s, 2 MB). Falha de uma não afeta as outras. Funding BTC/ETH/SOL da Binance em paralelo.
   - EN: CoinDesk, Cointelegraph, Decrypt (filtrado), CryptoSlate, Bitcoin Magazine, The Block, Protos (golpes/segurança), CryptoPotato, NewsBTC.
   - PT-BR: Livecoins, Portal do Bitcoin, BeInCrypto Brasil, InfoMoney e Forbes Brasil (só cripto/macro).
   - ES: CriptoNoticias, BeInCrypto en Español.
   - Macro: Federal Reserve (fonte primária).
   - Testadas em 14/10/2026 e descartadas por feed parado: DL News (último item em maio) e Criptofácil (30/set). Cointelegraph BR/ES devolvem HTTP 410.
2. **Validação** (`parseFeed`) — rejeita DOCTYPE/XML inválido, URL que não seja HTTPS do domínio da fonte, data futura ou com mais de 7 dias. Remove `utm_*`.
3. **Deduplicação** — `sha256(título normalizado)`. Mesma manchete em vários feeds vira uma notícia com lista de `reports`.
4. **Categoria** (`categoryOf`, primeira regra que casa): Segurança → Macroeconomia → Regulação → **Memecoins** → **Futuros** → Institucional → Tecnologia → Mercado. Regex em EN/PT/ES, texto normalizado sem acentos.
5. **Nicho do curso** (`niche.mjs`) — para cada notícia calcula `topics` (memecoins, futuros, trading, seguranca, plataformas, fundamentos, solana), o `module` (Memecoins > Futuros > Trading > Fundamentos) e o sinal `clickbait` (previsão de preço, "to the moon", "100x", "vai explodir"...).
6. **Importância 0–10 por regras** (`ruleImportance`, versão 2):
   clickbait **2** · hack/exploit/insolvência **8** · macro **6–7** · Regulação **7** · Segurança em memecoin (golpe/rug) **7** · Segurança **6** · Institucional **6** · Futuros **6** · Memecoins com listagem em corretora grande **6** · Memecoins **5** · Tecnologia **5** · resto **4**.
7. **Cobertura** — manchetes parecidas (≥4 termos, Jaccard ≥0,55, ≤36 h) de veículos diferentes viram `similar_coverage`. Fonte primária marcada à parte. **Veracidade nunca é pontuada** (`verdict: not_checked`).
8. **IA opcional** (`NEWS_AI_ENABLED`) — lote de até 10 itens/5 min, no máximo 48 lotes/dia: refina a nota, escreve o contexto e **traduz título e resumo para PT-BR** quando a fonte é EN/ES. Resultado validado por schema estrito; texto do RSS é tratado como não confiável. Sem chave, tudo continua por regras e a notícia vai no idioma original com bandeira.
9. **Alerta imediato** — notícia **nova**, publicada na última hora, de fonte já inicializada, que não seja clickbait e que cumpra **uma** das condições: categoria em `NEWS_ALERT_CATEGORIES` **ou** importância ≥ `ALERT_MIN_IMPORTANCE` (padrão 7). Funding alerta ao cruzar ±0,1 %.
10. **Resumo diário** (`selectDigest`) — notícias das últimas 24 h, sem clickbait, ordenadas por
    `rank = importância + 1 (2+ veículos) + 1 (fonte primária) + 0,5 (Brasil)`,
    no máximo 3 por seção e 10 no total (`DIGEST_ITEMS`). Seções: 🔐 Segurança, 🎓 Fundamentos/macro/regulação, 🐸 Memecoins, 📈 Trading, ⚡ Futuros, mais uma linha de funding. Sai **uma vez por dia (UTC)** a partir de `DAILY_BRIEF_UTC_HOUR` (padrão 11 = 08h BRT); se a VM estava desligada na hora, sai no primeiro ciclo depois.
11. **Entrega** — fila persistida por plataforma, até 5 tentativas com backoff, expira em 24 h, semântica "pelo menos uma vez". Primeiro ciclo de cada fonte ou destino só forma linha de base (não despeja histórico).
    - Telegram: HTML escapado, título em negrito com bandeira 🇺🇸🇧🇷🇪🇸, link "Ler na fonte", resumo diário cortado item a item para caber em 4096.
    - Discord: embed por notícia; resumo diário em embed com um campo por módulo. `allowed_mentions` vazio.
    - Site: o mesmo snapshot (`/api/pulse`, `/api/stream`) com os novos temas Memecoins/Futuros e `module`, `topics`, `translation`.

## Limites conhecidos

- Importância por regras não é calibrada contra preço. É prioridade de leitura.
- Sem tradução (sem IA), a mesma notícia em EN e PT aparece duas vezes: deduplicação entre idiomas não existe.
- O alerta decide a importância **antes** da IA do mesmo ciclo; uma notícia 5 por regras que a IA elevaria a 8 só aparece no site e no próximo resumo.
- Sem checagem de fatos. Toda mensagem diz isso.
- Regex de tema erra: "liquidation" de empresa falida pode cair em Futuros. Ajustar em `src/niche.mjs` e cobrir com teste em `test/niche.test.mjs`.

## Colocar na VM

Escolha **um** modo (não rode os dois no mesmo `data/`):

**A. Serviço contínuo (recomendado)** — alimenta o site em tempo real, alerta e manda o resumo na hora certa.

```bash
cd /opt/omega-market-bots
cp .env.example .env.local   # preencher abaixo
docker compose up -d --build
curl http://127.0.0.1:8787/health
```

**B. Só diário (cron)** — sem site em tempo real nem alertas fora da execução:

```bash
0 11 * * *  cd /opt/omega-market-bots && /usr/bin/node src/collect.mjs --digest >> /var/log/sismo.log 2>&1
```

`.env.local` mínimo:

```dotenv
DELIVERY_ENABLED=true
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/ID/TOKEN
TELEGRAM_BOT_TOKEN=token_do_BotFather
TELEGRAM_CHAT_ID=id_do_canal_ou_grupo
DAILY_BRIEF_UTC_HOUR=11
ALLOWED_ORIGINS=https://seudominio.com
# Opcional, melhora nota e traduz EN/ES para PT:
NEWS_AI_ENABLED=true
OPENAI_API_KEY=...
```

Passos manuais que só você pode fazer:

1. **Discord**: Configurações do canal → Integrações → Webhooks → Novo → copiar URL.
2. **Telegram**: @BotFather → `/newbot` → token. Adicione o bot ao canal/grupo como administrador (canal) e descubra o `chat_id` com `getUpdates`.
3. **Site**: definir `VITE_BOTS_API_URL=https://bots.seudominio.com` no build (proxy HTTPS em `bots/deploy/Caddyfile`).

Na primeira subida cada destino só forma a linha de base e o resumo do dia é marcado como enviado: o primeiro resumo real chega no dia seguinte. Para ver um resumo na hora, pare o serviço, apague o campo `lastBriefDate` de `data/state.json`, suba de novo e rode `npm run digest` (ou espere o próximo ciclo depois da hora configurada).

## Próximos passos (fora desta entrega)

- Comandos interativos (`/resumo`, `/seguranca`) exigem receber webhook do Telegram/Discord — outro serviço, descrito em `docs/bots-do-curso.md`.
- Dedup entre idiomas usando `translation.title`.
- Provedor de IA configurável (hoje OpenAI Responses API).
