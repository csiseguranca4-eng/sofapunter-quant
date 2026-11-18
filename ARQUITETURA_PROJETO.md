# Arquitetura — SofaPunter Quant

Stack: React 19 + Vite 8 (ESM) no front, Express 5 em `server.js` (porta `process.env.PORT` ou 3001, bind `0.0.0.0`). `services/` é CommonJS (`services/package.json` `"type": "commonjs"`); o servidor e os scripts ESM carregam esse pacote com `createRequire`.

Não existe integração WhatsApp nem gerador de PDF. Mensagens saem pelo Telegram (`@FutStatsLatamOficial`). Odds de casa vêm da 1win. Estatística de futebol vem da API-Football (`https://v3.football.api-sports.io`). Persistência de apostas fica no Supabase, tabela `apostas`.

Produção: Vercel (`vercel.json`) reescreve `/api/*` para `https://sofapunter-backend.onrender.com` e o restante para `index.html`. No browser, `src/apiBase.js` usa `http://localhost:3001` só em `localhost` / `127.0.0.1` sem `VITE_API_URL`; fora disso usa `VITE_API_URL` ou o host do Render.

## 1. Árvore principal

```
SofaPunter AI/
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── server.js                  # API Express
├── liveMonitor.js             # monitor Over + sniper Telegram (intervalo 60s ao importar)
├── ligasOficiais.js
├── ligasOficiais.json
├── quantEngine.js             # Poisson CJS na raiz (espelho de services/quantEngine.js)
├── 1win-client.js             # WebSocket de odds por matchId
├── test-auditoria-completa.js
├── bets_database.json         # planilha local espelhada por POST /api/save-data
├── carpina_monitor.json       # estado do monitor Over
├── layback_sem_api.json       # chaves de jogos já acompanhados sem nova consulta
├── ARQUITETURA_PROJETO.md
├── src/
│   ├── main.jsx
│   ├── App.jsx                # painel único, abas
│   ├── App.css
│   ├── index.css
│   ├── apiBase.js
│   ├── rankingLigas.js
│   ├── metodosEntrada.js
│   ├── SeletorMetodo.jsx
│   ├── PerformanceLigas.jsx
│   ├── LaboratorioShadow.jsx
│   ├── AuditoriaRoi.jsx
│   ├── MetodoBanca.jsx
│   ├── metodoBanca.js
│   ├── CardAporteBlindado.jsx
│   ├── RadarLive.jsx
│   ├── lib/supabaseClient.js
│   └── utils/gestaoSniperEngine.js
├── lib/
│   ├── supabase.js            # cliente servidor + TABELA_APOSTAS
│   └── apostasSupabase.js
├── services/
│   ├── apiFootball.js
│   ├── quantEngine.js
│   ├── tacticalEngine.js
│   ├── filtroLigas.js
│   └── laybackService.js      # stub: getLaybackMarketData = async () => null
├── data/
│   └── ranking_ligas.json
├── public/
│   └── live_status.json
├── logs/
│   └── shadow_audit.json      # criado em runtime
└── scripts/
    ├── backtestSniper100.js
    ├── backtestZebra100.js
    ├── backtest_100_empatados.js
    ├── backtest_todas_ligas.js
    ├── mineMethodsCache.js
    └── cache_backtest_*.json
```

## 2. O que cada arquivo faz

### Front (`src/`)

| Arquivo | Papel |
|---|---|
| `main.jsx` | Monta `<App />` em `#root`. |
| `App.jsx` | Única tela. Abas: Radar de Valor (`opps`), Planilha Diária (`sheet`), Mercados & Win Rate (`markets`), Desempenho por Mercado (`desempenho`), Laboratório Shadow (`shadow`), Performance & Ligas (`performance`). Aba em `?tab=` e `localStorage.sp_active_tab`. |
| `apiBase.js` | `emLocal`, `API_BASE`, `baseApi`, `apiUrl`, `urlVarredura`. Reexporta ligas oficiais. |
| `rankingLigas.js` | Importa `data/ranking_ligas.json` como `LIGAS_RANKING`. |
| `metodosEntrada.js` | Catálogo A+ / A / B / F / Manual, casamento de nome de liga com o ranking e agregação de ROI real. |
| `SeletorMetodo.jsx` | `<select>` de método e de liga do ranking. |
| `PerformanceLigas.jsx` | Aba de auditoria real: período, filtro de método, tabela por método e tabela liga vs backtest. |
| `LaboratorioShadow.jsx` | Aba que lê `GET /api/shadow-audit`. Cards do Método F e do Método B. |
| `AuditoriaRoi.jsx` | Vista da planilha: ROI, ligas lucrativas e vilãs. |
| `MetodoBanca.jsx` | Calendário do mês, painel Método & CDB, badge de resultado da stake. |
| `metodoBanca.js` | Constantes de banca, stake, corte de registro, aportes e resumo diário. Persistência local dos aportes. |
| `CardAporteBlindado.jsx` | Cartão do protocolo de aporte (não grava sozinho). |
| `RadarLive.jsx` | Gráfico 2D de pressão na linha da planilha. Props: `fixtureId`, `marketId`, `partida`. |
| `lib/supabaseClient.js` | Cliente anon do browser (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). `null` se a chave for inválida. `assinarCanal`. |
| `utils/gestaoSniperEngine.js` | Cota de 10 cliques/mês, modos `SNIPER_2T` (1.0) e `TATICO_1T` (0.5), stake por fase da banca. |

Abas da planilha (`vistaPlanilha`): `entradas` (lista + formulário manual), `metodo` (`PainelMetodo`), `auditoria` (`AuditoriaRoi`).

### Servidor

| Arquivo | Papel |
|---|---|
| `server.js` | Rotas HTTP, auditoria 1win, bloco Quant, Gemini, publicação Telegram, planilha Supabase. Importar este arquivo sobe o `listen`. |
| `liveMonitor.js` | Dois ciclos. Carpina: acompanha Over 1.5 / 2.5 já gravados e manda Telegram nos marcos. Sniper: a cada 60 s varre `live=all`, classifica Métodos A / A+ / B, zebra e abafa, e grava shadow F/B. O `setInterval` do sniper nasce no import. |
| `lib/supabase.js` | `createClient` com `SUPABASE_URL` e `SUPABASE_KEY`. `TABELA_APOSTAS = 'apostas'`. |
| `lib/apostasSupabase.js` | Insert/update de pendente, `fixture_id` e liquidação GREEN/RED/CASHOUT. |
| `ligasOficiais.js` | Lista de ligas API-Football, filtro de virtual e grupo do seletor. |
| `1win-client.js` | `fetch1WinMatchOdds(matchId)` via WebSocket Engine.IO no gateway da 1win. |
| `quantEngine.js` | Cópia CJS do motor Poisson usada fora de `services/`. |

### `services/`

| Arquivo | Papel |
|---|---|
| `apiFootball.js` | Cliente HTTP. Header `x-apisports-key`. Cache estático 12 h. Pausa não crítica quando `x-ratelimit-requests-remaining < 400` até a meia-noite UTC. `critico: true` ignora essa pausa. Não devolve os headers; o saldo sai no log `[API]`. |
| `quantEngine.js` | Matriz de Poisson 0–5, odd justa, EV, selo, cantos, cartões, ancoragem no mercado 1X2. |
| `tacticalEngine.js` | Índice de ritmo e prompt tático. Header Gemini só `x-goog-api-key`. |
| `filtroLigas.js` | `deveIgnorarPartida`: juvenil, feminino fora da lista, amistoso e virtual. |
| `laybackService.js` | Isolado de propósito. `getLaybackMarketData` devolve `null`. |

### Scripts de auditoria (não sobem com o servidor)

| Arquivo | Papel |
|---|---|
| `backtestSniper100.js` | 100 jogos, stop 80', cache `cache_backtest_100.json`. Teto 120 req, piso de saldo 1000. |
| `backtestZebra100.js` | Zebra vencendo por 1 gol. Reusa o cache 100 e grava `cache_backtest_zebra.json`. Teto 250, piso 1500. |
| `backtest_100_empatados.js` | 100 FT com 0x0 ou 1x1 aos 55', xG ≥ 1.50, ≥ 5 no alvo, janela 56'–80'. Cache `cache_backtest_empatados.json`. |
| `backtest_todas_ligas.js` | Mesma regra em 29 ligas. Teto 3800 na execução, 120 por liga, piso de saldo 800. Grava `cache_backtest_todas_ligas.json` e `data/ranking_ligas.json`. |
| `mineMethodsCache.js` | Lê só os caches locais. Zero HTTP. |
| `test-auditoria-completa.js` | Chama `montarBlocoQuant` com odds simuladas e dados reais da API-Football. Não faz parte do runtime. |

## 3. Rotas (`server.js`)

Cada rota existe com e sem o prefixo `/api` (`comESemApi`).

| Método | Caminho | Função |
|---|---|---|
| GET | `/api/apostas` | Lista linhas ao vivo do monitor. |
| GET | `/api/shadow-audit` | Lê a tabela `shadow_lab` (ou a sentinela `__shadow_lab__` em `apostas`, se a tabela ainda não existir) e mescla com a memória do monitor. Sem API-Football. |
| GET | `/api/saved-data` | Une Supabase `apostas` com `bets_database.json`. |
| POST | `/api/apostas/registrar` | Insert em `apostas` (`registrarApostaPlanilha`). |
| POST | `/api/apostas/marcar` | Atualiza `metodo`, `league` e `liga` (`marcarApostaPlanilha`). |
| POST | `/api/save-data` | Grava `{ bets, bankroll }` em `bets_database.json`. |
| POST | `/api/apostas-futebol/resultado` | GREEN / RED / CASHOUT / PENDING via `registrarResultadoNaNuvem`. |
| GET | `/api/daily-opportunities` e `/api/fixtures` | Varredura 1win `get-many` (prematch + live). Query `shift`. |
| POST | `/api/check-1win-match` | Deep scan API-Football + odds 1win. Devolve todos os mercados comparados. Sem filtro Gemini. |
| POST | `/api/analisar-ia` | Parecer Gemini sobre o confronto já auditado. |
| POST | `/api/ai-scout-analyze` | Scout tático Gemini. |
| POST | `/api/publish-telegram-tip` | `sendPhoto` no canal. |
| POST | `/api/telegram/send-daily-recap` | `sendMessage` do resumo do dia. |

## 4. Funções centrais

### `server.js`

- Planilha: `inserirLinhaAposta` (até 5 tentativas, remove coluna rejeitada pelo PostgREST), `atualizarLinhaAposta`, `registrarApostaPlanilha`, `marcarApostaPlanilha`, `lerTabelaPlanilha`, `apostasDaNuvem`, `linhaParaPlanilha`, `lucroDoLancamento`.
- Quant: `estimarLambdaMu`, `montarContextoFootball`, `montarBlocoQuant`, `executarXequeMate`, `decidirMercadosAprovados`, `montarMercadosOddsReais`.
- IA: `requestGeminiTacticalText`, `generateAuditTacticalScout`, `parseAiScoutResponse`. Modelos em cascata no arquivo (`MODELOS_GEMINI`).
- Telegram: `enviarTelegramTexto`, `buildDailyRecapText`.
- 1win ao vivo do monitor: `listarJogos1winAoVivo`.

### `liveMonitor.js`

- Over Carpina: `iniciarMonitorCarpina`, `decidirCarpina`, `decidirPrimeiroTempo`, `marcoDevido` (48 em `[48,50)`, 70 em `[70,72)`), `garantirFixtureId`, `gravarMarcoNoSupabase`, `gravarStatusAoVivo`.
- Liquidação: `encerrarApostaNuvem`, `garantirApostaPendente`. GREEN só na ação `green`. Stop só em `cashout-intervalo`, `stop-60`, `stop-65`. Ações de 1T (`take-profit-1t`, `stop-loss-1t`, `pressao-1t`) não encerram o watch.
- Sniper: `cicloSniperXG`, `sniperLiberado`, `classificarMetodoSniper` (B no 1T 22'–35'; A+ 1x1 55'–67'; A 0x0 55'–75'), `decisaoMetodoRanking`, `textoMetodoSniper`, `dispararAlerta`.
- Shadow: `registrarShadowF` (75'–77', 0x0/1x1, xG ≥ 1.50 e ≥ 5 no alvo, stake 4, odd 2.30, green +5.20 / red −4), `registrarShadowB` (só depois do Telegram real do Método B), `acompanharShadow`, `resumoShadow`.
- Ranking: `mapaRankingLigas` lê `data/ranking_ligas.json`. Liga `BLOQUEADA` não dispara Telegram. `SELETIVA` ou amostra `< 10` só dispara A+. `APROVADA` com `>= 10` jogos dispara A e A+ com o ROI no topo.

Estado de módulo do sniper: `alertasSniperEnviados`, `alertasZebraEnviados`, `alertasAbafaEnviados`, `oddsPreJogoMap`, `cooldownEstatisticaSniper`, `consumoSniper` (`dia`, `total`, teto 3750/dia no fuso `America/Sao_Paulo`), `shadowAudit`.

### `services/apiFootball.js`

`pedir`, `listarCorpoAoVivo`, `listarFixturesAoVivo`, `listarFixturesDoDia`, `obterFixtureAoVivo`, `calcularMediasConfronto`, `intensidadesConfronto` (mando 1.05, ou 1 se o ataque visitante supera o mandante em mais de 0.15; se lambda ainda ≥ mu, lambda = mu × 0.75), `obterClassificacao`, `obterH2H`, `obterUltimosJogos`.

### `services/quantEngine.js`

`calcularOddsQuant`, `analisarOportunidadesQuant`, `probabilidadesPoisson`, `ancorarNoMercado`, `calibrarLambdasH2H`, `montarMercadosAdicionais`, `expectativaCantos`, `expectativaCartoes`.

### `src/App.jsx` — estado

`activeTab`, `activeShift`, `selectedLeague`, `ligaPlanilha`, `jogoFocado`, `currentBankroll`, `sheetBets`, `isDataLoaded`, `aportes`, `modosProtocolo`, `vistaPlanilha`, `calendarioAberto`, `customInputs`, `opportunities`, `loading`, `erroVarredura`, `erroAuditoria`, `onewinLinks`, `onewinAudits`, `onewinQuants`, `loading1win`, `loadingIa`, `erroIa`, `analiseIa`, `publishingTip`, `publishedTip`, `recapPreview`, `sendingRecap`, `bilheteMultipla`, `multiplaOddText`, `multiplaStakeText`, `multiplaOddEdited`, `radarPlanilhaAberto`, `entradaManualAberta`, `entradaManual`, `selectedDate`, `profitPeriod`.

`entradaManual`: `jogo`, `mercado`, `metodo`, `liga`, `odd`, `stake`, `modo`, `status`, `devolvido`, `semApi`, `erro`, `salvando`.

Handlers: `handleFetchOpps`, `handleAudit1Win`, `handleAnalisarIa`, `handleAddToSheet`, `salvarEntradaManual`, `handleSaveMultipla`, `handlePublishTelegram`, `handleSetResult`, `handleCashoutPrompt`, `handleDeleteBet`, `atualizarMarcacao`, `gravarApostaNaNuvem`, `persistToDisk`, `sincronizarResultadoNuvem`.

`localStorage`: `sp_active_tab`, `sp_sheet_bets`, `sp_current_bank`, `sp_custom_inputs`, `sp_opportunities`, `sp_onewin_links`, `sp_onewin_audits`, `sp_onewin_quants`, `sp_profit_period`, `sp_operacao`, `sp_stake_padrao`, mais as chaves de aporte e de modo do protocolo.

### Demais módulos de UI

- `metodosEntrada.js`: `normalizarMetodo`, `casarLigaRanking`, `linhaDaLiga`, `dentroDoPeriodo`, `montarPerformance`, `statusComparativo`. Estado só no componente `PerformanceLigas`: `periodo` (`mes` | `3m` | `ano` | `historico`), `filtro` (`todos` | `validados` | `manuais`).
- `LaboratorioShadow.jsx`: estado `auditoria`, `erro`, `carregando`. `validacaoMetodoF`: selo só com ≥ 30 fechados e ROI ≥ 12%.
- `gestaoSniperEngine.js`: `calcularProtocoloMensal`, `contarCliquesMes`, `avaliarStatusMensal`, `gravarModoProtocolo`. Estado persistido em `sp_protocolo_modos`.
- `metodoBanca.js`: `BANCA_OPERACIONAL` 69.16, `STAKE_PADRAO` 4, `INICIO_METODO` `2026-11-14`, `STOP_LOSS_DIARIO` −15, `APORTE_PROTOCOLO` 35, `META_PROTOCOLO` 5000. `lerAportes`, `registrarAporteProtocolo`, `resumoDoDia`, `agruparDias`.
- `AuditoriaRoi.jsx`: `auditarLucro(apostas)`.
- `RadarLive.jsx`: estado interno de pontos de pressão e do canvas; não chama API sozinho.

## 5. Tabelas e arquivos de dados

Supabase:

| Tabela | Uso |
|---|---|
| `shadow_lab` | Auditoria silenciosa dos Métodos F e B. DDL em `supabase/shadow_lab.sql`. Enquanto a tabela não existir, o mesmo livro fica na sentinela de `apostas`. |
| `apostas` | Livro de futebol. Colunas usadas: `id`, `jogo`, `mercado`, `odd`, `stake`, `status` (`PENDENTE`, `GREEN`, `RED`, `CASHOUT`), `lucro`, `created_at`, `fixture_id` (bigint; id `bet_...` não entra), `liga`, `metodo` (`A+`, `A`, `B`, `F`, `MANUAL`). `league` é enviada e removida se o PostgREST não a tiver. Um `metodo` já gravado não é substituído por vazio. A linha `mercado = __shadow_lab__` guarda a auditoria shadow enquanto `shadow_lab` não existe e não entra na planilha. |
| `match_timeline` | Upsert por `fixture_id,minute` no monitor. Insert também em `registarMinutoLive`. |
| `trade_signals` | Insert de `auditarLaybackOverHT`. |

Não há tabela `apostas_futebol`. A rota `/api/apostas-futebol/resultado` escreve em `apostas`.

Arquivos:

| Arquivo | Conteúdo |
|---|---|
| `bets_database.json` | `{ bets, bankroll }` da planilha local. |
| `carpina_monitor.json` | Watches do Over. |
| `public/live_status.json` | Snapshot ao vivo lido pelo painel. |
| `logs/shadow_audit.json` | Cache local da auditoria F e B. A fonte durável é `shadow_lab` (`supabase/shadow_lab.sql`); sem a tabela, o livro fica em `apostas.metricas_resumo` da sentinela `__shadow_lab__`. |
| `data/ranking_ligas.json` | `geradoEm`, `estrategia`, `requisicoes`, `motivo`, `saldo`, `ranking[]` com `ligaId`, `liga`, `jogos`, `greens`, `stops`, `taxaAcerto`, `lucro`, `roiPercentual`, `veredito`. |
| `layback_sem_api.json` | Lista de chaves `jogo\|mercado` sem nova chamada. |
| `scripts/cache_backtest_*.json` | Corpos de fixtures já baixados. Reexecução não refaz o que já está no arquivo. |

## 6. Integrações

- **API-Football.** `services/apiFootball.js`. Plano com teto diário lido do header. Sniper ao vivo: no máximo 6 statistics e 3 odds por ciclo, cooldown de estatística 120 s, cota interna 3750/dia. Backtests têm teto próprio e não importam `liveMonitor.js`.
- **1win.** `GET /api/daily-opportunities` usa `matches/get-many`. Auditoria de um jogo usa `1win-client.js` (WebSocket) mais o espelho `VITE_1WIN_BASE_URL` ou `https://1win.com`. O painel cola link/ID e chama `POST /api/check-1win-match`.
- **Telegram.** Token lido em runtime de `server.js` pelo sniper (`tokenDoTelegramSniper`). Canal `@FutStatsLatamOficial`. Rotas de publicação e de recap. Shadow não envia mensagem.
- **Gemini.** `fetch` nativo, header `x-goog-api-key`. Sem `Authorization: Bearer` e sem `?key=`.
- **Supabase.** Servidor: `lib/supabase.js`. Browser: `src/lib/supabaseClient.js` + Realtime em `assinarCanal`. Polling de `GET /api/saved-data` a cada 20 s com a aba Planilha aberta. `live_status.json` a cada 4 s.
- **LayBack.** Sem API ativa. Checkbox “já estou acompanhando” marca `semApi` e não manda `fixture_id`.

## 7. Regras de produto que o código já aplica

- Stake operacional US$ 4. Banca de referência US$ 69.16. Stop diário −US$ 15. Protocolo: banca &lt; 500 → 5,5% da stake arredondada a US$ 0,50; 500–1999.99 → 4,5%; ≥ 2000 → 3,5%. Cota 10 cliques. `DATA_INICIO_CICLO_OFICIAL = 2026-11-15` conta clique. `INICIO_METODO = 2026-11-14` e `CORTE_REGISTRO_MS` definem o livro do método.
- Pendente não desconta stake. Lucro de pendente é 0.
- Sniper 2T no Telegram: 0x0 só entre 55' e 75'; 1x1 só entre 55' e 67'; xG ≥ 1.50 e chutes no alvo ≥ 5. Método B: 1T, 22'–35', xG ≥ 1.15 e no alvo ≥ 5. Método F não vai ao Telegram.
- Veredito do ranking: `APROVADA ROI >= 15%`, `SELETIVA ROI 8-14%`, `BLOQUEADA ROI < 8%`, `SEM AMOSTRA`.
