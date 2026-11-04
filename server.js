import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { codigoDuplaChance, fetch1WinMatchOdds } from './1win-client.js';
import { iniciarMonitorCarpina } from './liveMonitor.js';
import { TABELA_APOSTAS } from './lib/supabase.js';
import { registrarResultadoNaNuvem } from './lib/apostasSupabase.js';

const require = createRequire(import.meta.url);
const { analisarOportunidadesQuant, ancorarNoMercado, calcularOddsQuant, calibrarLambdasH2H, confrontoDeGols, favoritoDoConfronto, montarMercadosAdicionais, probabilidadesPoisson } = require('./services/quantEngine.js');
const { buscarIdEquipa, obterEstatisticasEquipa, calcularMediasConfronto, obterClassificacao, obterH2H, obterUltimosJogos, obterFixtureAoVivo, listarFixturesDoDia } = require('./services/apiFootball.js');
const { calcularIndiceRitmo, gerarPromptTaticoQuant } = require('./services/tacticalEngine.js');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// CAMINHO DO BANCO DE DADOS EM ARQUIVO FÍSICO
const DB_FILE = path.resolve('./bets_database.json');

// Garante que o arquivo existe
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ bets: [], bankroll: 335 }, null, 2));
}

// CHAVE GOOGLE AI STUDIO (GEMINI)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDJslnbr3zzQ6uIb-9ToB65Pt1Vts2UBPo';

// BOT DO TELEGRAM
const TELEGRAM_BOT_TOKEN = '9131635244:AAHUqedO0Jv_1HYn21EFgvAEp_O1GpwJq0Y';
const TELEGRAM_CHANNEL = '@FutStatsLatamOficial';
const TELEGRAM_AFFILIATE_URL = 'https://r1wquow.com/?p=zqv4';

function formatSignedLine(raw) {
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return String(raw);
  if (n === 0) return '0';
  const sign = n > 0 ? '+' : '-';
  const abs = Math.abs(n);
  const text = Number.isInteger(abs) ? abs.toFixed(1) : String(abs);
  return `${sign}${text}`;
}

function formatMarketName(rawName, teams = {}) {
  const original = String(rawName || '').replace(/\s+/g, ' ').trim();
  if (!original) return original;
  if (/^handicap(?:\s+asi[aá]tico)?\s+0\s*:/i.test(original)) return original;
  if (/^handicap\s*:/i.test(original)) return original;

  const asZero = (team) => {
    const clean = String(team || '').replace(/^[:\-–\s]+|[:\-–\s]+$/g, '').trim();
    return clean ? `Handicap 0: ${clean}` : 'Handicap 0';
  };
  const asLine = (team, line) => {
    const clean = String(team || '').replace(/^[:\-–\s]+|[:\-–\s]+$/g, '').trim();
    if (!clean) return original;
    if (Number(String(line).replace(',', '.')) === 0) return `Handicap 0: ${clean}`;
    return `Handicap: ${clean} ${formatSignedLine(line)}`;
  };

  const paren = original.match(/^(.*?)\s*\(\s*([+-]?\d+(?:[.,]\d+)?)\s*\)$/);
  if (paren && paren[1].trim()) return asLine(paren[1], paren[2]);

  const tail = original.match(/^(.*?)\s+([+-]?\d+(?:[.,]\d+)?)$/);
  if (tail && tail[1].trim()) {
    const line = Number(tail[2].replace(',', '.'));
    if (line === 0 || /^[+-]/.test(tail[2])) return asLine(tail[1], tail[2]);
  }

  const teamFirst = original.match(/^(.*?)\s+(?:empate anula(?:\s*\(\s*dnb\s*\))?|dnb|draw no bet)$/i);
  if (teamFirst && teamFirst[1].trim()) return asZero(teamFirst[1]);

  const labelFirst = original.match(/^(?:empate anula(?:\s*\(\s*dnb\s*\))?|dnb|draw no bet)(?:\s*[:\-–]\s*(.+))?$/i);
  if (labelFirst) return asZero(labelFirst[1] || teams.team || teams.favorite || '');

  return original;
}

// GATEWAY OFICIAL DA 1WIN
const ONEWIN_GATEWAY = 'https://api-gateway.top-parser.com';

const onewinHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://1win.io',
  'Referer': 'https://1win.io/',
  'Content-Type': 'application/json'
};

// =========================================================================
// ROTAS DE PERSISTÊNCIA FÍSICA (NUNCA MAIS APAGA AO DESLIGAR O PC)
// =========================================================================
app.get('/api/saved-data', (req, res) => {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const data = JSON.parse(raw || '{"bets":[],"bankroll":335}');
    res.json({ success: true, ...data });
  } catch (e) {
    res.json({ success: true, bets: [], bankroll: 335 });
  }
});

app.post('/api/save-data', (req, res) => {
  try {
    const { bets, bankroll } = req.body;
    fs.writeFileSync(DB_FILE, JSON.stringify({ bets: bets || [], bankroll: bankroll || 335 }, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/apostas-futebol/resultado', async (req, res) => {
  try {
    const partida = String(req.body?.partida || '').trim();
    const mercado = String(req.body?.mercado || '').trim();
    const status = String(req.body?.status || '').trim().toUpperCase();
    const permitidos = new Set(['GREEN', 'RED', 'CASHOUT', 'PENDING', 'PENDENTE']);
    if (!partida || !mercado || !permitidos.has(status)) {
      res.status(400).json({ success: false, message: 'Informe partida, mercado e status GREEN, RED ou CASHOUT.' });
      return;
    }
    const lucro = req.body?.lucro == null || req.body?.lucro === '' ? null : Number(req.body.lucro);
    const resultado = await registrarResultadoNaNuvem({ partida, mercado, status, lucro });
    res.json({ success: true, ...resultado });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// =========================================================================
// ROTA 1: VARREDURA POR REGIÃO (EUROPA O DIA TODO | BRASIL O DIA TODO)
// =========================================================================
app.get('/api/daily-opportunities', async (req, res) => {
  try {
    const shift = (req.query.shift || 'europe').toLowerCase();

    console.log('\n======================================================');
    console.log(`📡 [1WIN VARREDURA] Região solicitada: ${shift.toUpperCase()} (O DIA TODO)`);

    const response = await axios.post(
      `${ONEWIN_GATEWAY}/matches/get-many`,
      {
        service: 'prematch',
        excludeSportType: 'polybet',
        sportId: 18,
        limit: 800,
        hotsLimit: 400
      },
      { headers: onewinHeaders, timeout: 12000 }
    );

    const items = response.data?.result?.items || [];
    console.log(`⚽ Total bruto recebido da 1win: ${items.length} partidas`);

    if (!items || items.length === 0) {
      return res.json({ success: true, count: 0, games: [] });
    }

    const brazilianTerms = [
      'brasil', 'brazil', 'brasileir', 'paulista', 'carioca', 'mineiro', 'gaucho',
      'copa do brasil', 'flamengo', 'palmeiras', 'corinthians', 'sao paulo', 'santos',
      'gremio', 'internacional', 'fluminense', 'botafogo', 'vasco', 'cruzeiro',
      'atletico mineiro', 'atletico-mg', 'athletico-pr', 'athletico paranaense', 'bahia',
      'fortaleza', 'cuiaba', 'bragantino', 'chapecoense', 'coritiba', 'sport recife',
      'vitoria', 'goias', 'remo', 'ceara', 'avai', 'ponte preta', 'guarani', 'vila nova',
      'novorizontino', 'mirassol', 'operario', 'amazonas', 'paysandu', 'crb', 'brusque',
      'ituano', 'londrina', 'america-mg', 'america mg', 'juventude', 'criciuma',
      'atletico-go', 'atletico goianiense', 'serie a', 'serie b', 'serie c', 'serie d'
    ];

    const virtualMatchRe = /\b(cyber|simulated|srl|fifa|e-?soccer|2x2|3x3|4x4|penalty)\b/i;
    const gruposElite = new Set(['uefa_cups', 'premier_league', 'laliga', 'serie_a', 'ligue_1']);
    const temTexto = (texto, frases) => frases.some((frase) => texto.includes(frase));
    const temPais = (texto, nomes) => nomes.some((nome) => new RegExp(`(^| )${nome}( |$)`).test(texto));
    const classificarLeagueGroup = (textoLiga, jogoBrasil) => {
      const texto = String(textoLiga || '');
      if (temTexto(texto, ['champions league', 'liga dos campeoes', 'europa league', 'liga europa', 'conference league', 'uefa'])) {
        return 'uefa_cups';
      }
      if (temTexto(texto, ['copa del rey', 'copa do rei', 'fa cup', 'copa da inglaterra', 'coppa italia', 'copa do brasil', 'dfb pokal', 'coupe de france', 'copa de la liga'])) {
        return 'national_cups';
      }
      if (jogoBrasil || temTexto(texto, ['brasileirao', 'serie a brasil', 'serie b brasil']) || temPais(texto, ['brazil', 'brasil'])) {
        return 'brazil';
      }
      if (temPais(texto, ['england', 'inglaterra']) || (temTexto(texto, ['premier league']) && !temPais(texto, ['israel']))) {
        return 'premier_league';
      }
      if (temTexto(texto, ['laliga', 'la liga', 'segunda division']) || temPais(texto, ['spain', 'espanha'])) {
        return 'laliga';
      }
      if (temPais(texto, ['italy', 'italia']) || temTexto(texto, ['serie a'])) {
        return 'serie_a';
      }
      if (temTexto(texto, ['ligue 1']) || /(^| )league 1( |$)/.test(texto) || temPais(texto, ['france', 'franca'])) {
        return 'ligue_1';
      }
      if (temPais(texto, ['portugal']) || temTexto(texto, ['liga betclic', 'primeira liga'])) {
        return 'portugal';
      }
      if (temPais(texto, ['turkey', 'turquia']) || /(^| )super lig( |$)/.test(texto)) {
        return 'turkey';
      }
      if (temPais(texto, ['greece', 'grecia']) || (temTexto(texto, ['super league']) && !temPais(texto, ['china', 'switzerland', 'swiss', 'suica']))) {
        return 'greece';
      }
      if (temPais(texto, ['argentina']) || temTexto(texto, ['liga profesional'])) {
        return 'argentina';
      }
      return 'others';
    };

    const saoPauloDateKey = (date) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date);
      const pick = (type) => parts.find((part) => part.type === type)?.value || '';
      return `${pick('year')}-${pick('month')}-${pick('day')}`;
    };

    const todaySaoPaulo = saoPauloDateKey(new Date());
    const processedGames = [];

    const otherSportRe = /basketball|basquete|volleyball|v[oô]lei|tennis|t[eê]nis|handball|handebol|hockey|h[oó]quei|baseball|beisebol|cricket|cr[ií]quete|ufc|mma|table-tennis|american-football|futebol americano|ice-hockey|esport/;

    for (const item of items) {
      const sportId = Number(item.sportId ?? item.sport?.id);
      const sportLabels = [
        item.sport?.name,
        item.sport?.slug,
        item.sport?.tag,
        typeof item.sport === 'string' ? item.sport : '',
        item.sportName,
        item.tournament?.sport?.name,
        item.tournament?.sport?.slug,
        item.tournament?.sport?.tag
      ].filter(Boolean).map((value) => String(value).toLowerCase());
      const isFootballName = sportLabels.some((label) => /^(football|futebol|soccer)$/.test(label));
      if (sportId !== 18 || sportLabels.some((label) => otherSportRe.test(label)) || (sportLabels.length > 0 && !isFootballName)) continue;

      const homeName = item.homeTeam?.name || item.home?.name || (typeof item.homeTeam === 'string' ? item.homeTeam : null);
      const awayName = item.awayTeam?.name || item.away?.name || (typeof item.awayTeam === 'string' ? item.awayTeam : null);
      const matchId = item.id;
      const tournamentName = item.tournament?.name || item.category?.name || item.tournamentName || 'Futebol';

      if (!homeName || !awayName || !matchId) continue;

      const rawDate = item.startAt || item.dateStart || item.date || item.matchDate || item.timeStart || (Date.now() / 1000);
      let dateObj;
      if (typeof rawDate === 'string' && Number.isNaN(Number(rawDate.trim()))) {
        dateObj = new Date(rawDate);
      } else {
        const timestamp = Number(rawDate) > 10000000000 ? Number(rawDate) : Number(rawDate) * 1000;
        dateObj = new Date(timestamp);
      }

      if (Number.isNaN(dateObj.getTime()) || saoPauloDateKey(dateObj) !== todaySaoPaulo) continue;

      const timeFormatted = dateObj.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo'
      });

      const sportSlug = item.sport?.slug || item.sport?.tag || (typeof item.sport === 'string' ? item.sport : '') || item.sportName || '';
      const tournamentSlug = item.tournament?.slug || '';
      const fullString = `${homeName} ${awayName} ${tournamentName}`.toLowerCase();
      const virtualText = `${fullString} ${sportSlug} ${tournamentSlug} ${item.name || ''}`;
      if (item.sport?.isEsport === true || virtualMatchRe.test(virtualText)) continue;

      const isBrazil = brazilianTerms.some(term => fullString.includes(term));

      let oddHome = 1.95;
      let oddDraw = 3.30;
      let oddAway = 3.80;

      const rawOdds = item.outcomes || item.odds || item.prices || [];
      if (Array.isArray(rawOdds) && rawOdds.length >= 3) {
        oddHome = Number(rawOdds[0]?.odds || rawOdds[0]?.p || rawOdds[0]?.price || 1.95);
        oddDraw = Number(rawOdds[1]?.odds || rawOdds[1]?.p || rawOdds[1]?.price || 3.30);
        oddAway = Number(rawOdds[2]?.odds || rawOdds[2]?.p || rawOdds[2]?.price || 3.80);
      }

      const pHome = 1 / (oddHome > 1 ? oddHome : 1.95);
      const pDraw = 1 / (oddDraw > 1 ? oddDraw : 3.30);
      const pAway = 1 / (oddAway > 1 ? oddAway : 3.80);
      const margin = pHome + pDraw + pAway;

      const normHome = pHome / margin;
      const normAway = pAway / margin;

      const isHomeFav = normHome >= normAway;
      const favTeam = isHomeFav ? homeName : awayName;
      const favProb = isHomeFav ? normHome : normAway;
      const underProb = isHomeFav ? normAway : normHome;

      const dnbProb = favProb / (favProb + underProb);
      const fairDnb = Number((1 / dnbProb).toFixed(2));
      const fairDc = Number((1 / (favProb + (pDraw / margin))).toFixed(2));

      const textoLiga = [tournamentName, tournamentSlug, item.category?.name, item.category?.slug]
        .filter(Boolean)
        .join(' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ');
      const leagueGroup = classificarLeagueGroup(textoLiga, isBrazil);
      let score = Math.min(95, Math.round(dnbProb * 100) + 12);
      if (gruposElite.has(leagueGroup)) score += 40;

      processedGames.push({
        id: matchId.toString(),
        league: tournamentName,
        leagueGroup,
        home: homeName,
        away: awayName,
        time: timeFormatted,
        score: score,
        dnbProb: dnbProb,
        isBrazil: isBrazil,
        justification: `Favorito: ${favTeam} (${(dnbProb * 100).toFixed(0)}% prob no DNB). Abra o jogo na 1win para conferir as odds oficiais.`,
        markets: [
          {
            id: `pre_${matchId}_dnb`,
            name: formatMarketName(`${favTeam} Empate Anula (DNB)`, { team: favTeam, home: homeName, away: awayName }),
            marketType: 'Empate Anula (DNB)',
            defaultOdd: fairDnb,
            fairOdd: fairDnb,
            evPercent: 0,
            isTopPick: true,
            tag: '⚡ AGUARDANDO AUDITORIA'
          },
          {
            id: `pre_${matchId}_dc`,
            name: `Dupla Hipótese: ${favTeam} ou Empate`,
            marketType: 'Dupla Chance',
            defaultOdd: fairDc,
            fairOdd: fairDc,
            evPercent: 0,
            isTopPick: false,
            tag: 'Alternativa'
          }
        ]
      });
    }

    console.log(`📅 [DIA ${todaySaoPaulo} SP] ${processedGames.length} jogos reais de hoje após filtro anti-virtual`);

    let filteredList = [];

    if (shift === 'europe') {
      filteredList = processedGames.filter(g => !g.isBrazil);
    } else {
      filteredList = processedGames.filter(g => g.isBrazil);
    }

    filteredList.sort((a, b) => b.score - a.score);

    const selected = filteredList.slice(0, 20);

    console.log(`✅ [SELEÇÃO ${shift.toUpperCase()}] ${selected.length} jogos carregados:`);
    selected.forEach((g, idx) => {
      console.log(`   ${idx + 1}. [${g.time} - ${g.isBrazil ? 'BR' : 'EUR'}] ${g.home} vs ${g.away} (${g.league})`);
    });

    res.json({ success: true, count: selected.length, shift, games: selected });

  } catch (err) {
    console.error('❌ Falha na varredura:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

const GEMINI_TEXT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.6-flash'];

function cleanGeminiText(value) {
  return String(value || '').replace(/```/g, '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
}

function buildDynamicTacticalReading(homeTeam, awayTeam, odds) {
  const best = (Array.isArray(odds) ? odds : [])
    .map((item) => ({ name: item?.name, odd: Number(item?.odd) }))
    .filter((item) => item.name && Number.isFinite(item.odd) && item.odd > 1)
    .sort((a, b) => a.odd - b.odd)[0];
  const projection = best
    ? `A projeção aponta jogo vertical, com valor em ${formatMarketName(best.name)} (${best.odd.toFixed(2)}) na 1win.`
    : 'A projeção aponta jogo vertical, com valor nas odds auditadas da 1win.';
  return `Leitura tática: ${homeTeam} tem tendência ofensiva clara diante de ${awayTeam}. ${projection}`;
}

async function requestGeminiTacticalText(promptText, options = {}) {
  const wantJson = options.json === true;
  const attempts = wantJson
    ? [
        ...GEMINI_TEXT_MODELS.map((model) => ({ model, json: true })),
        ...GEMINI_TEXT_MODELS.map((model) => ({ model, json: false }))
      ]
    : GEMINI_TEXT_MODELS.map((model) => ({ model, json: false }));

  for (const attempt of attempts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent?key=${GEMINI_API_KEY}`;
    try {
      const generationConfig = { temperature: 0.4 };
      if (attempt.json) generationConfig.responseMimeType = 'application/json';
      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: options.timeout || 20000 }
      );
      const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      const cleaned = attempt.json ? String(text || '').trim() : cleanGeminiText(text);
      if (cleaned) return cleaned;
    } catch (error) {
      console.error('ERRO GEMINI DETALHADO:', error?.response?.data || error?.message || error);
    }
  }
  return '';
}

function normalizeAiPicks(picks, teams = {}) {
  if (!Array.isArray(picks)) return [];
  return picks.slice(0, 2).map((pick) => {
    const market = formatMarketName(String(pick?.market || '').trim(), teams);
    const odd = Number(String(pick?.oddEstimated ?? '').replace(',', '.'));
    if (!market || !Number.isFinite(odd) || odd <= 1) return null;
    return { market, oddEstimated: odd.toFixed(2) };
  }).filter(Boolean);
}

function parseAiScoutResponse(raw, homeTeam, awayTeam, odds) {
  const fallbackReading = buildDynamicTacticalReading(homeTeam, awayTeam, odds);
  const source = String(raw || '').trim();
  if (!source) return { tacticalReading: fallbackReading, aiPicks: [] };

  const fenced = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^json\s*/i, '')
    .trim();

  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(fenced.slice(start, end + 1));
      const reading = String(parsed?.tacticalReading || '').trim();
      return {
        tacticalReading: reading && !/volume de ataque constante como mandante/i.test(reading)
          ? reading
          : fallbackReading,
        aiPicks: normalizeAiPicks(parsed?.aiPicks, { home: homeTeam, away: awayTeam })
      };
    } catch (_) { /* cai para a leitura parcial abaixo */ }
  }

  const readingMatch = fenced.match(/"tacticalReading"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (readingMatch) {
    let reading = readingMatch[1];
    try { reading = JSON.parse(`"${readingMatch[1]}"`); } catch (_) { /* texto parcial */ }
    reading = String(reading || '').trim();
    return {
      tacticalReading: reading && !/volume de ataque constante como mandante/i.test(reading)
        ? reading
        : fallbackReading,
      aiPicks: []
    };
  }

  const plain = fenced.replace(/^["'\s]+|["'\s]+$/g, '').trim();
  const looksStructured = plain.startsWith('{') || plain.includes('"aiPicks"') || plain.includes('"tacticalReading"');
  return {
    tacticalReading: !looksStructured && plain && !/volume de ataque constante como mandante/i.test(plain)
      ? plain
      : fallbackReading,
    aiPicks: []
  };
}

async function generateAuditTacticalScout({ homeTeam, awayTeam, league, score, cardText, oddsList }) {
  const promptText = `
Você é um scout tático de futebol para o canal FutStats Latam.
Dados reais da partida auditada na 1win:
- Mandante: ${homeTeam || 'não informado'}
- Visitante: ${awayTeam || 'não informado'}
- Liga: ${league || 'não informada'}
- Score do card: ${score ?? 'não informado'}
- Texto atual do card: ${cardText || 'não informado'}
- Odds reais capturadas na 1win:
${oddsList || 'nenhuma odd capturada'}

Gere um Scout Tático exclusivo e técnico de 2 a 3 frases em português (Brasil) para o canal FutStats. Destaque o comportamento tático real das equipes e onde está o valor (+EV) com base nas odds auditadas. Não utilize frases padrão ou modelos pré-prontos.

Responda apenas com o texto do scout, sem título, sem markdown e sem aspas.
`;

  const scout = await requestGeminiTacticalText(promptText);
  if (scout) {
    console.log('🤖 [SCOUT AUDITORIA] Texto gerado pelo Gemini.');
    return scout;
  }
  return buildDynamicTacticalReading(homeTeam, awayTeam);
}

function normalizarNomeQuant(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function selecaoEhTime(selection, team) {
  const nomeSelecao = normalizarNomeQuant(String(selection || '').replace(/\s+0(?:\.0)?$/, ''));
  const nomeTime = normalizarNomeQuant(team);
  if (!nomeSelecao || !nomeTime) return false;
  if (nomeSelecao === nomeTime || nomeSelecao.startsWith(`${nomeTime} `)) return true;
  const tokens = nomeTime.split(' ').filter((token) => token.length >= 4);
  return tokens.length > 0 && tokens.every((token) => nomeSelecao.includes(token));
}

function ehMercadoResultado(market) {
  const nome = normalizarNomeQuant(market);
  if (!nome) return false;
  if (/primeiro|segundo|1 tempo|2 tempo|intervalo|escanteio|cartao|canto|handicap|total|gols|ambas|ambos|dupla|hipotese|double|paridade|exato|placar|antecipad|early|payout/.test(nome)) {
    return false;
  }
  if (/tempo regulamentar|resultado final|full time/.test(nome)) return true;
  return /^(resultado|1x2|vencedor|match winner|resultado da partida)$/.test(nome);
}

function escolher1x2(rows, homeTeam, awayTeam) {
  const porCodigo = {
    casa: rows.find((row) => String(row.outcome) === '1'),
    empate: rows.find((row) => String(row.outcome || '').toUpperCase() === 'X'),
    fora: rows.find((row) => String(row.outcome) === '2')
  };
  const porNome = {
    casa: rows.find((row) => selecaoEhTime(row.selection, homeTeam) && !/empate|draw/i.test(row.selection || '')),
    empate: rows.find((row) => /empate|draw/i.test(row.selection || '')),
    fora: rows.find((row) => selecaoEhTime(row.selection, awayTeam) && !selecaoEhTime(row.selection, homeTeam))
  };
  if (porCodigo.casa && porCodigo.empate && porCodigo.fora) {
    const codigo1EhVisitante = selecaoEhTime(porCodigo.casa.selection, awayTeam) && !selecaoEhTime(porCodigo.casa.selection, homeTeam);
    const codigo2EhMandante = selecaoEhTime(porCodigo.fora.selection, homeTeam) && !selecaoEhTime(porCodigo.fora.selection, awayTeam);
    if (codigo1EhVisitante && codigo2EhMandante) {
      return { casa: porCodigo.fora, empate: porCodigo.empate, fora: porCodigo.casa };
    }
    return porCodigo;
  }
  if (porNome.casa && porNome.empate && porNome.fora) return porNome;
  return porCodigo.casa ? porCodigo : porNome;
}

function extrairOddsQuant(allMarkets, homeTeam, awayTeam) {
  const odds = {};
  const grupos = new Map();
  allMarkets.forEach((item) => {
    if (!grupos.has(item.market)) grupos.set(item.market, []);
    grupos.get(item.market).push(item);
  });

  const candidatos = [...grupos.entries()]
    .filter(([market]) => ehMercadoResultado(market))
    .sort((a, b) => {
      const prioridade = (nome) => {
        const normalizado = normalizarNomeQuant(nome);
        if (normalizado === 'resultado do tempo regulamentar') return 0;
        return /tempo regulamentar|resultado final|full time/.test(normalizado) ? 1 : 2;
      };
      return prioridade(a[0]) - prioridade(b[0]);
    });

  for (const [, rows] of candidatos) {
    const escolhido = escolher1x2(rows, homeTeam, awayTeam);
    const distintos = new Set([escolhido.casa, escolhido.empate, escolhido.fora]);
    if (distintos.size === 3 && [...distintos].every((row) => row && row.odd > 1)) {
      odds.casa = escolhido.casa.odd;
      odds.empate = escolhido.empate.odd;
      odds.fora = escolhido.fora.odd;
      break;
    }
  }

  const dnb = allMarkets.filter((item) => (
    /handicap/i.test(item.market || '') &&
    item.odd > 1 &&
    (String(item.selection || '').trim().endsWith(' 0') || String(item.selection || '').includes(' 0.0'))
  ));
  dnb.forEach((row) => {
    if (!odds.dnbMandante && selecaoEhTime(row.selection, homeTeam)) odds.dnbMandante = row.odd;
    else if (!odds.dnbVisitante && selecaoEhTime(row.selection, awayTeam)) odds.dnbVisitante = row.odd;
  });
  dnb.forEach((row) => {
    if (!odds.dnbMandante && row.outcome === '1') odds.dnbMandante = row.odd;
    else if (!odds.dnbVisitante && row.outcome === '2') odds.dnbVisitante = row.odd;
  });

  const totais = allMarkets.filter((item) => /^totais$/i.test(String(item?.market || '').trim()));
  const over15 = acharTotal(totais, 1.5, true);
  const under15 = acharTotal(totais, 1.5, false);
  const over25 = acharTotal(totais, 2.5, true);
  const under25 = acharTotal(totais, 2.5, false);
  if (over15?.odd > 1) odds.over15 = over15.odd;
  if (under15?.odd > 1) odds.under15 = under15.odd;
  if (over25?.odd > 1) odds.over25 = over25.odd;
  if (under25?.odd > 1) odds.under25 = under25.odd;

  const btts = allMarkets.filter((item) => /^ambos os times marcar/i.test(String(item?.market || '').trim()));
  const bttsSim = btts.find((item) => item.outcome === 'yes' || /^sim$/i.test(item.selection || ''));
  const bttsNao = btts.find((item) => item.outcome === 'no' || /^n[aã]o$/i.test(item.selection || ''));
  if (bttsSim?.odd > 1) odds.bttsSim = bttsSim.odd;
  if (bttsNao?.odd > 1) odds.bttsNao = bttsNao.odd;

  return odds;
}

function acharTotal(totais, linha, over) {
  const sentido = over ? /acima|over|mais|>/i : /abaixo|under|menos|</i;
  return totais.find((item) => sentido.test(item.selection || '') && linhaNumerica(item.selection) === linha);
}

function probabilidadePoissonAte(media, limite) {
  let termo = Math.exp(-media);
  let soma = termo;
  for (let gols = 1; gols <= limite; gols += 1) {
    termo *= media / gols;
    soma += termo;
  }
  return soma;
}

function totalGolsPorOver25(probabilidadeOver) {
  const alvo = Math.min(0.97, Math.max(0.03, probabilidadeOver));
  let minimo = 0.3;
  let maximo = 6;
  for (let passo = 0; passo < 48; passo += 1) {
    const meio = (minimo + maximo) / 2;
    const chanceOver = 1 - probabilidadePoissonAte(meio, 2);
    if (chanceOver < alvo) minimo = meio;
    else maximo = meio;
  }
  return (minimo + maximo) / 2;
}

function estimarLambdaMu(odds) {
  let pCasa = 0.46;
  let pEmpate = 0.26;
  let pFora = 0.28;
  if (odds.casa > 1 && odds.empate > 1 && odds.fora > 1) {
    const bruto = [1 / odds.casa, 1 / odds.empate, 1 / odds.fora];
    const soma = bruto[0] + bruto[1] + bruto[2];
    pCasa = bruto[0] / soma;
    pEmpate = bruto[1] / soma;
    pFora = bruto[2] / soma;
  }

  let total = null;
  if (odds.over25 > 1) {
    let pOver = 1 / odds.over25;
    if (odds.under25 > 1) {
      const pUnder = 1 / odds.under25;
      pOver = pOver / (pOver + pUnder);
    } else {
      pOver = Math.min(0.92, Math.max(0.08, pOver / 1.06));
    }
    total = totalGolsPorOver25(pOver);
  }
  if (!(total > 0)) {
    total = Math.min(4.2, Math.max(1.6, 3.15 - pEmpate * 2.1));
  }

  const peso = pCasa + pFora;
  const lambda = Math.min(4.5, Math.max(0.2, peso > 0 ? total * (pCasa / peso) : total * 0.55));
  const mu = Math.min(4.5, Math.max(0.2, peso > 0 ? total * (pFora / peso) : total * 0.45));
  return {
    lambda: Number(lambda.toFixed(2)),
    mu: Number(mu.toFixed(2))
  };
}

function oddNaLinha(allMarkets, teste, linha, over) {
  const sentido = over ? /acima|over|mais|>/i : /abaixo|under|menos|</i;
  const item = allMarkets.find((row) => (
    (teste.test(row.market || '') || teste.test(row.selection || '')) &&
    sentido.test(row.selection || '') &&
    linhaNumerica(row.selection) === linha &&
    row.odd > 1
  ));
  return item ? item.odd : null;
}

function oddsCantosECartoes(allMarkets) {
  const mapa = {};
  const cantos = /escanteio|corner|canto/i;
  const cartoes = /cart(?:ao|ão|oes|ões)|card|amarelo|yellow/i;
  [[8.5, 'Cantos'], [9.5, 'Cantos'], [10.5, 'Cantos']].forEach(([linha]) => {
    const over = oddNaLinha(allMarkets, cantos, linha, true);
    const under = oddNaLinha(allMarkets, cantos, linha, false);
    if (over) mapa[`Cantos Over ${linha}`] = over;
    if (under) mapa[`Cantos Under ${linha}`] = under;
  });
  [[3.5, 'Cartões'], [4.5, 'Cartões']].forEach(([linha]) => {
    const over = oddNaLinha(allMarkets, cartoes, linha, true);
    const under = oddNaLinha(allMarkets, cartoes, linha, false);
    if (over) mapa[`Cartões Over ${linha}`] = over;
    if (under) mapa[`Cartões Under ${linha}`] = under;
  });
  return mapa;
}

function linhaTabela(linha) {
  if (!linha) return null;
  return {
    pos: linha.posicao,
    pts: linha.pontos,
    sg: linha.saldoGols,
    jogos: linha.jogos,
    forma: linha.forma
  };
}

function formaDosJogos(ultimos, nomeTime) {
  const jogos = Array.isArray(ultimos?.jogos) ? ultimos.jogos.slice(0, 5) : [];
  if (!jogos.length) return '';
  const alvo = normalizarNomeQuant(nomeTime);
  const letras = jogos.map((jogo) => {
    if (jogo?.vencedor === 'Empate') return 'D';
    const vencedor = normalizarNomeQuant(jogo?.vencedor);
    if (!vencedor || !alvo) return '-';
    if (vencedor === alvo || alvo.includes(vencedor) || vencedor.includes(alvo)) return 'W';
    return 'L';
  }).reverse();
  return letras.join('').slice(0, 5);
}

function linhaStandings(linha, formaRecente) {
  const formaTabela = String(linha?.forma || '').replace(/[^WDL]/gi, '').slice(-5);
  const rank = Number(linha?.pos);
  const points = Number(linha?.pts);
  const goalsDiff = Number(linha?.sg);
  return {
    rank: Number.isFinite(rank) ? rank : '-',
    points: Number.isFinite(points) ? points : '-',
    form: formaTabela || formaRecente || '-----',
    goalsDiff: Number.isFinite(goalsDiff) ? goalsDiff : 0
  };
}

function dataH2HCompleta(data) {
  const encontrada = String(data || '').match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!encontrada) return String(data || '');
  const ano = encontrada[3].length === 2 ? `20${encontrada[3]}` : encontrada[3];
  return `${encontrada[1]}/${encontrada[2]}/${ano}`;
}

function montarH2HList(h2h) {
  return (Array.isArray(h2h) ? h2h : []).slice(0, 5).map((jogo) => ({
    date: dataH2HCompleta(jogo?.data),
    home: jogo?.casa || 'Casa',
    away: jogo?.fora || 'Fora',
    score: `${jogo?.golsCasa ?? 0} - ${jogo?.golsFora ?? 0}`,
    winner: jogo?.vencedor || 'Empate'
  }));
}

function numeroProjecao(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Number(numero.toFixed(1)) : null;
}

async function montarContextoFootball({ ids, confrontoReal, lambda, mu, allMarkets, homeTeam, awayTeam }) {
  const vazio = {
    tabela: { mandante: null, visitante: null },
    standings: {
      home: linhaStandings(null, ''),
      away: linhaStandings(null, '')
    },
    h2h: [],
    h2hList: [],
    h2hNota: 'Sem confrontos diretos recentes',
    ultimos10: null,
    ajusteH2H: null,
    mercadosAdicionais: { cantos: { mediaEsperada: null, linhas: [] }, cartoes: { mediaEsperada: null, linhas: [] } }
  };
  if (!ids?.idMandante || !ids?.idVisitante) return { ...vazio, lambda, mu };

  const leagueId = confrontoReal?.mandante?.leagueId;
  const season = confrontoReal?.mandante?.season;
  const [classCasa, classFora, h2h, ultCasa, ultFora] = await Promise.all([
    leagueId ? obterClassificacao(leagueId, season, ids.idMandante).catch((erro) => {
      console.log('Aviso API-Football: classificação do mandante indisponível.', erro.message);
      return null;
    }) : null,
    leagueId ? obterClassificacao(leagueId, season, ids.idVisitante).catch((erro) => {
      console.log('Aviso API-Football: classificação do visitante indisponível.', erro.message);
      return null;
    }) : null,
    obterH2H(ids.idMandante, ids.idVisitante, 10).catch(() => []),
    obterUltimosJogos(ids.idMandante, 10).catch(() => null),
    obterUltimosJogos(ids.idVisitante, 10).catch(() => null)
  ]);

  let ajusteH2H = null;
  let lambdaFinal = lambda;
  let muFinal = mu;
  if (lambda > 0 && mu > 0 && Array.isArray(h2h) && h2h.length) {
    ajusteH2H = calibrarLambdasH2H(lambda, mu, h2h);
    lambdaFinal = ajusteH2H.lambda;
    muFinal = ajusteH2H.mu;
  }

  const tabela = {
    mandante: linhaTabela(classCasa),
    visitante: linhaTabela(classFora)
  };
  const h2hList = montarH2HList(h2h);

  return {
    tabela,
    standings: {
      home: linhaStandings(
        tabela.mandante,
        formaDosJogos(ultCasa, homeTeam) || String(confrontoReal?.mandante?.form || '').replace(/[^WDL]/gi, '').slice(-5)
      ),
      away: linhaStandings(
        tabela.visitante,
        formaDosJogos(ultFora, awayTeam) || String(confrontoReal?.visitante?.form || '').replace(/[^WDL]/gi, '').slice(-5)
      )
    },
    h2h: Array.isArray(h2h) ? h2h : [],
    h2hList,
    h2hNota: h2hList.length ? null : 'Sem confrontos diretos recentes',
    ultimos10: {
      mandante: ultCasa,
      visitante: ultFora
    },
    ajusteH2H,
    mercadosAdicionais: montarMercadosAdicionais(
      confrontoReal?.mandante,
      confrontoReal?.visitante,
      oddsCantosECartoes(allMarkets || [])
    ),
    lambda: lambdaFinal,
    mu: muFinal
  };
}

function linhaNumerica(selection) {
  const encontrado = String(selection || '').replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return encontrado ? Number(encontrado[1]) : null;
}

function expectativaDaLinha(allMarkets, testeMercado, minimo, maximo) {
  const linhas = allMarkets.filter((item) => testeMercado.test(item.market || '') || testeMercado.test(item.selection || ''));
  const overs = linhas.filter((item) => item.odd > 1 && /acima|over|>/i.test(item.selection || ''));
  if (!overs.length) return null;
  overs.sort((a, b) => Math.abs(a.odd - 1.9) - Math.abs(b.odd - 1.9));
  const over = overs[0];
  const linha = linhaNumerica(over.selection);
  if (!(linha > 0)) return null;
  const under = linhas.find((item) => (
    item.odd > 1 &&
    /abaixo|under|</i.test(item.selection || '') &&
    linhaNumerica(item.selection) === linha
  ));
  let pOver = 1 / over.odd;
  if (under) pOver = pOver / (pOver + (1 / under.odd));
  else pOver = Math.min(0.92, Math.max(0.08, pOver / 1.05));
  const expectativa = linha + (pOver - 0.5) * 3.2;
  if (expectativa < minimo || expectativa > maximo) return null;
  return expectativa;
}

function estimarEstatisticasRitmo(allMarkets, lambda, mu) {
  const totalGols = lambda + mu;
  const escanteios = expectativaDaLinha(allMarkets, /escanteio|corner/i, 7, 16)
    ?? (7.2 + totalGols * 1.55);
  const chutes = expectativaDaLinha(allMarkets, /chute.*alvo|shots on target|finalizac|remate/i, 6, 16)
    ?? (4.2 + totalGols * 2.15);
  const posse = Math.min(70, Math.max(28, 30 + totalGols * 7));
  return {
    escanteiosTotais: Number(escanteios.toFixed(1)),
    chutesNoAlvo: Number(chutes.toFixed(1)),
    posseTercoFinal: Number(posse.toFixed(1))
  };
}

function parseTaticaQuant(raw) {
  const fonte = String(raw || '').trim();
  if (!fonte) return null;
  const limpo = fonte.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio === -1 || fim <= inicio) return null;
  const parsed = JSON.parse(limpo.slice(inicio, fim + 1));
  const estilo = String(parsed?.estiloConfronto || '').trim().split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  const validacao = String(parsed?.validacaoTatica || '').trim();
  const resumo = String(parsed?.resumoVisual || '').split('\n')[0].trim().slice(0, 160);
  const notaBruta = Number(parsed?.scoreConfianca);
  const scoreConfianca = Number.isFinite(notaBruta)
    ? Math.max(0, Math.min(100, Math.round(notaBruta)))
    : null;
  if (!estilo && !validacao && !resumo && scoreConfianca == null) return null;
  return { estiloConfronto: estilo, validacaoTatica: validacao, scoreConfianca, resumoVisual: resumo };
}

async function montarBlocoQuant({ allMarkets, homeTeam, awayTeam, league, justification, semTatica = false }) {
  const oddsBrutas = extrairOddsQuant(allMarkets, homeTeam, awayTeam);
  const oddsCasa = {};
  ['casa', 'empate', 'fora', 'dnbMandante', 'dnbVisitante', 'over15', 'under15', 'over25', 'under25', 'bttsSim', 'bttsNao'].forEach((chave) => {
    if (oddsBrutas[chave] > 1) oddsCasa[chave] = oddsBrutas[chave];
  });
  if (!Object.keys(oddsCasa).length) return null;

  let lambda = null;
  let mu = null;
  let fonteDados = 'Sintético (Odds 1win)';
  let idsTimes = null;
  let confrontoReal = null;

  try {
    const nomeMandanteRaspado = homeTeam;
    const nomeVisitanteRaspado = awayTeam;
    const idMandante = await buscarIdEquipa(nomeMandanteRaspado);
    const idVisitante = await buscarIdEquipa(nomeVisitanteRaspado);

    if (idMandante && idVisitante) {
      idsTimes = { idMandante, idVisitante };
      confrontoReal = await calcularMediasConfronto(idMandante, idVisitante);
      if (confrontoReal && confrontoReal.lambdaReal && confrontoReal.muReal) {
        lambda = confrontoReal.lambdaReal;
        mu = confrontoReal.muReal;
        fonteDados = 'API-Football (Histórico Real)';
      }
    }
  } catch (errApi) {
    console.log('Aviso API-Football: usando fallback de odds sintéticas.', errApi.message);
  }

  if (!(lambda > 0) || !(mu > 0)) {
    const sintetico = estimarLambdaMu(oddsBrutas);
    lambda = sintetico.lambda;
    mu = sintetico.mu;
    fonteDados = 'Sintético (Odds 1win)';
  }

  let contexto = {
    tabela: { mandante: null, visitante: null },
    standings: {
      home: linhaStandings(null, ''),
      away: linhaStandings(null, '')
    },
    h2h: [],
    h2hList: [],
    h2hNota: 'Sem confrontos diretos recentes',
    ultimos10: null,
    ajusteH2H: null,
    mercadosAdicionais: { cantos: { mediaEsperada: null, linhas: [] }, cartoes: { mediaEsperada: null, linhas: [] } }
  };
  try {
    contexto = await montarContextoFootball({
      ids: idsTimes,
      confrontoReal,
      lambda,
      mu,
      allMarkets,
      homeTeam,
      awayTeam
    });
    if (contexto.lambda > 0 && contexto.mu > 0) {
      lambda = contexto.lambda;
      mu = contexto.mu;
    }
  } catch (errApi) {
    console.log('Aviso API-Football: contexto parcial ignorado.', errApi.message);
  }

  const alinhado = consolidarFavorito(lambda, mu, oddsBrutas, contexto.ultimos10);
  lambda = alinhado.lambda;
  mu = alinhado.mu;
  if (alinhado.fonteExtra) fonteDados = `${fonteDados} | ${alinhado.fonteExtra}`;

  const resultadoQuant = analisarOportunidadesQuant(lambda, mu, oddsCasa);
  const estatisticas = estimarEstatisticasRitmo(allMarkets, lambda, mu);
  const ritmo = calcularIndiceRitmo(estatisticas);

  let tatica = null;
  if (!semTatica) try {
    const contexto = String(justification || '').trim();
    const prompt = gerarPromptTaticoQuant({
      mandante: homeTeam || 'Mandante',
      visitante: awayTeam || 'Visitante',
      liga: league || '',
      estatisticas,
      ritmo,
      taticaMandante: /volume de ataque constante como mandante/i.test(contexto) ? '' : contexto
    }, resultadoQuant);
    tatica = parseTaticaQuant(await requestGeminiTacticalText(prompt, { json: true }));
  } catch (error) {
    console.error('⚠️ [QUANT] Leitura tática estruturada indisponível:', error?.message || error);
  }

  let probabilities = null;
  try {
    probabilities = probabilidadesPoisson(lambda, mu);
  } catch (erro) {
    console.log('Aviso Quant: probabilidades Poisson indisponíveis.', erro.message);
  }

  const cantosProjetados = numeroProjecao(contexto.mercadosAdicionais?.cantos?.mediaEsperada)
    ?? numeroProjecao(estatisticas.escanteiosTotais);
  const cartoesProjetados = numeroProjecao(contexto.mercadosAdicionais?.cartoes?.mediaEsperada);

  console.log(`📈 [QUANT] λ ${lambda} | μ ${mu} | ${fonteDados} | +EV ${resultadoQuant.melhoresEntradas.length}`);
  return {
    melhoresEntradas: resultadoQuant.melhoresEntradas,
    mercadosAuditados: resultadoQuant.mercados,
    ritmo,
    tatica,
    fonteDados,
    probabilities,
    standings: contexto.standings,
    h2hList: contexto.h2hList || [],
    h2hNota: contexto.h2hNota || null,
    statsProjection: {
      expectedCorners: cantosProjetados,
      expectedCards: cartoesProjetados
    },
    tabela: contexto.tabela,
    h2h: contexto.h2h,
    ultimos10: contexto.ultimos10,
    ajusteH2H: contexto.ajusteH2H?.motivo ? contexto.ajusteH2H : null,
    mercadosAdicionais: contexto.mercadosAdicionais,
    lambda,
    mu,
    perfilTimes: {
      mandante: perfilEquipe(confrontoReal?.mandante, contexto.ultimos10?.mandante),
      visitante: perfilEquipe(confrontoReal?.visitante, contexto.ultimos10?.visitante)
    },
    oddsMercado: oddsBrutas
  };
}

function probs1x2Mercado(odds) {
  if (!(odds?.casa > 1) || !(odds?.fora > 1)) return null;
  const bruto = [1 / odds.casa, odds.empate > 1 ? 1 / odds.empate : 0, 1 / odds.fora];
  const soma = bruto[0] + bruto[1] + bruto[2];
  if (!(soma > 0)) return null;
  return { casa: bruto[0] / soma, empate: bruto[1] / soma, fora: bruto[2] / soma };
}

function vitoriasNosUltimos(bloco, quantidade) {
  return (Array.isArray(bloco?.jogos) ? bloco.jogos : [])
    .slice(0, quantidade)
    .filter((jogo) => jogo?.resultado === 'W').length;
}

function faixaDaZebra(odd) {
  const implicita = 1 / Number(odd);
  return Math.max(0.08, Math.min(0.10, implicita));
}

function consolidarFavorito(lambda, mu, odds, ultimos) {
  let modelo;
  try {
    modelo = calcularOddsQuant(lambda, mu);
  } catch {
    return { lambda, mu, fonteExtra: null };
  }
  const ancora = ancorarNoMercado(
    { casa: modelo.matchOdds.casa.probabilidade, fora: modelo.matchOdds.fora.probabilidade },
    odds
  );
  let pCasa = ancora.casa;
  let pFora = ancora.fora;
  let motivo = ancora.motivo;
  const winsCasa = vitoriasNosUltimos(ultimos?.mandante, 5);
  const winsFora = vitoriasNosUltimos(ultimos?.visitante, 5);
  if (winsFora >= 4 && winsCasa <= 2 && !(Number(odds?.fora) > 3.5)) {
    pFora = Math.max(pFora || 0, 0.62);
    pCasa = Math.min(pCasa || 0.18, 0.18);
    motivo = motivo || 'forma do visitante';
  } else if (winsCasa >= 4 && winsFora <= 2 && !(Number(odds?.casa) > 3.5)) {
    pCasa = Math.max(pCasa || 0, 0.62);
    pFora = Math.min(pFora || 0.18, 0.18);
    motivo = motivo || 'forma do mandante';
  }
  if (!ancora.ancorou && motivo == null) return { lambda, mu, fonteExtra: null };
  if (pCasa + pFora > 0.9) {
    const fator = 0.9 / (pCasa + pFora);
    pCasa *= fator;
    pFora *= fator;
  }
  const achado = lambdasDoAlvo(pCasa, pFora, null);
  if (!achado) return { lambda, mu, fonteExtra: null };
  return { lambda: achado.lambda, mu: achado.mu, fonteExtra: motivo || '1X2 da 1win' };
}

function lambdasDoAlvo(pCasa, pFora, overAlvo) {
  let melhor = null;
  for (let lambda = 0.25; lambda <= 3; lambda += 0.05) {
    for (let mu = 0.25; mu <= 3; mu += 0.05) {
      let modelo;
      try {
        modelo = calcularOddsQuant(Number(lambda.toFixed(2)), Number(mu.toFixed(2)));
      } catch {
        continue;
      }
      const erro = Math.abs(modelo.matchOdds.casa.probabilidade - pCasa) * 2.2
        + Math.abs(modelo.matchOdds.fora.probabilidade - pFora)
        + (Number.isFinite(overAlvo) ? Math.abs(modelo.gols.over25.probabilidade - overAlvo) * 0.8 : 0);
      if (!melhor || erro < melhor.erro) {
        melhor = { lambda: Number(lambda.toFixed(2)), mu: Number(mu.toFixed(2)), erro };
      }
    }
  }
  return melhor;
}

function perfilEquipe(stats, ultimos) {
  if (!stats && !ultimos) return null;
  const jogos = Array.isArray(ultimos?.jogos) ? ultimos.jogos.slice(0, 10) : [];
  return {
    jogos: stats?.jogos ?? jogos.length,
    forma: ultimos?.forma || stats?.form || '',
    mediaGolsMarcados: stats?.mediaGolsMarcados ?? null,
    mediaGolsSofridos: stats?.mediaGolsSofridos ?? null,
    golsMarcadosCasa: stats?.golosMarcadosCasa ?? null,
    golsMarcadosFora: stats?.golosMarcadosFora ?? null,
    golsSofridosCasa: stats?.golosSofridosCasa ?? null,
    golsSofridosFora: stats?.golosSofridosFora ?? null,
    cleanSheets: stats?.cleanSheets ?? null,
    jogosSemMarcar: stats?.jogosSemMarcar ?? null,
    sequenciaMarcando: ultimos?.sequenciaMarcando ?? null,
    sequenciaSofrendo: ultimos?.sequenciaSofrendo ?? null,
    cantosPorJogo: stats?.cantosPorJogo ?? null,
    cantosContraCasa: stats?.cantosContraCasa ?? null,
    cantosContraFora: stats?.cantosContraFora ?? null,
    amarelosPorJogo: stats?.amarelosPorJogo ?? null,
    vermelhosPorJogo: stats?.vermelhosPorJogo ?? null,
    cartoesPorJogo: stats?.cartoesPorJogo ?? null,
    ultimos10: jogos.map((jogo) => ({
      data: jogo.data,
      placar: jogo.placar,
      resultado: jogo.resultado,
      marcados: jogo.marcados,
      sofridos: jogo.sofridos
    }))
  };
}

function linhaDoMercado(id) {
  if (id === 'dnbMandante' || id === 'dnbVisitante') return '0';
  if (id === 'over15' || id === 'under15') return '1.5';
  if (id === 'over25' || id === 'under25') return '2.5';
  const numero = String(id || '').match(/(\d+(?:\.\d+)?)/);
  return numero ? numero[1] : '';
}

function nomeMercadoXeque(id, nome, home, away) {
  const mapa = {
    casa: `Resultado: ${home}`,
    empate: 'Resultado: Empate',
    fora: `Resultado: ${away}`,
    dnbMandante: `Handicap 0: ${home}`,
    dnbVisitante: `Handicap 0: ${away}`,
    over15: 'Total de Gols: Acima de 1.5',
    under15: 'Total de Gols: Abaixo de 1.5',
    over25: 'Total de Gols: Acima de 2.5',
    under25: 'Total de Gols: Abaixo de 2.5',
    bttsSim: 'Ambos os Times Marcam: Sim',
    bttsNao: 'Ambos os Times Marcam: Não',
    dupla1X: `Dupla Hipótese: ${home} ou Empate`,
    duplaX2: `Dupla Hipótese: Empate ou ${away}`,
    dupla12: `Dupla Hipótese: ${home} ou ${away}`
  };
  return mapa[id] || nome;
}

function podeSerTopo(id, mercado, odd) {
  if (Number(odd) >= 4) return false;
  const lado = ladoDoResultado(id);
  if (!lado || !mercado) return true;
  return mercado[lado] >= 0.28;
}

function ladoDoResultado(id) {
  if (id === 'casa' || id === 'dnbMandante' || id === 'dupla1X') return 'casa';
  if (id === 'fora' || id === 'dnbVisitante' || id === 'duplaX2') return 'fora';
  return null;
}

function resultadoInconsistente(id, mercado, modelo) {
  const lado = ladoDoResultado(id);
  if (!lado || !mercado || !modelo) return false;
  const outro = lado === 'casa' ? 'fora' : 'casa';
  const zebra = mercado[lado] < 0.22 && mercado[outro] > mercado[lado];
  return zebra && modelo[lado] > mercado[lado] + 0.18;
}

function candidatosMatematicos(quant, allMarkets, home, away) {
  const lista = [];
  const mercado = probs1x2Mercado(quant?.oddsMercado);
  let modelo = null;
  let matriz = null;
  if (quant?.lambda > 0 && quant?.mu > 0) {
    try {
      matriz = calcularOddsQuant(quant.lambda, quant.mu);
      modelo = { casa: matriz.matchOdds.casa.probabilidade, fora: matriz.matchOdds.fora.probabilidade };
    } catch { /* o filtro de zebra segue sem o modelo */ }
  }
  const favoritoId = favoritoDoConfronto(quant?.oddsMercado, matriz);
  const jogoAberto = confrontoDeGols(matriz);
  const obrigatorios = new Set(['over15', 'over25', 'bttsSim', 'bttsNao']);
  (quant?.mercadosAuditados || []).forEach((mercadoLinha) => {
    const odd1win = Number(mercadoLinha.oddCasa);
    let oddJusta = Number(mercadoLinha.oddJusta);
    let ev = Number(mercadoLinha.ev) || 0;
    if (jogoAberto && (mercadoLinha.mercado === 'under15' || mercadoLinha.mercado === 'under25' || mercadoLinha.ocultar)) return;
    if (ladoDoResultado(mercadoLinha.mercado) && odd1win >= 4) {
      const piso = odd1win >= 8 ? Number((1 / faixaDaZebra(odd1win)).toFixed(2)) : 6;
      if (!(oddJusta >= piso)) {
        oddJusta = piso;
        ev = (odd1win / piso) - 1;
      }
    }
    const positivo = odd1win > oddJusta && oddJusta > 1 && ev > 0.02;
    const obrigatorio = obrigatorios.has(mercadoLinha.mercado) && odd1win > 1 && oddJusta > 1;
    const exibirFavorito = mercadoLinha.mercado === favoritoId && odd1win > 1 && oddJusta > 1;
    if (!positivo && !obrigatorio && !exibirFavorito) return;
    if (positivo && resultadoInconsistente(mercadoLinha.mercado, mercado, modelo)) return;
    lista.push({
      id: mercadoLinha.mercado,
      nome: nomeMercadoXeque(mercadoLinha.mercado, mercadoLinha.nome, home, away),
      linha: linhaDoMercado(mercadoLinha.mercado),
      oddJusta,
      odd1win,
      ev,
      tag: exibirFavorito ? 'FAVORITO' : null
    });
  });

  ['cantos', 'cartoes'].forEach((chave) => {
    const bloco = quant?.mercadosAdicionais?.[chave];
    (bloco?.linhas || []).forEach((linha) => {
      const odd1win = Number(linha.oddCasa);
      const oddJusta = Number(linha.oddJusta);
      const positivo = odd1win > oddJusta && oddJusta > 1 && linha.ev > 0;
      const cotado = chave === 'cantos' && odd1win > 1 && oddJusta > 1;
      if (!positivo && !cotado) return;
      const id = `${chave}-${String(linha.nome || '').toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`;
      lista.push({
        id,
        nome: linha.nome,
        linha: linhaDoMercado(linha.nome),
        oddJusta,
        odd1win,
        ev: Number(linha.ev)
      });
    });
  });

  if (quant?.lambda > 0 && quant?.mu > 0) {
    try {
      const modelo = calcularOddsQuant(quant.lambda, quant.mu);
      const chances = {
        '1X': modelo.matchOdds.casa.probabilidade + modelo.matchOdds.empate.probabilidade,
        X2: modelo.matchOdds.empate.probabilidade + modelo.matchOdds.fora.probabilidade,
        '12': modelo.matchOdds.casa.probabilidade + modelo.matchOdds.fora.probabilidade
      };
      const codigoFavorito = favoritoId === 'casa' ? '1X' : favoritoId === 'fora' ? 'X2' : null;
      const grupos = (allMarkets || []).filter((item) => codigoDuplaChance(item.market, item.selection, item.outcome));
      grupos.forEach((item) => {
        const codigo = item.dupla || codigoDuplaChance(item.market, item.selection, item.outcome);
        const chance = chances[codigo];
        if (!codigo || !(chance > 0) || !(item.odd > 1)) return;
        const oddJusta = 1 / chance;
        const ev = (item.odd * chance) - 1;
        const baseDupla = codigo === codigoFavorito;
        if (!(item.odd > oddJusta && ev > 0.02) && !baseDupla) return;
        const id = codigo === '1X' ? 'dupla1X' : codigo === 'X2' ? 'duplaX2' : 'dupla12';
        if (lista.some((linha) => linha.id === id)) return;
        lista.push({
          id,
          nome: nomeMercadoXeque(id, item.selection, home, away),
          linha: codigo,
          oddJusta,
          odd1win: item.odd,
          ev,
          tag: null,
          baseDupla
        });
      });
    } catch (erro) {
      console.log('Aviso Xeque-Mate: dupla hipótese fora do modelo.', erro.message);
    }
  }

  const vistos = new Set();
  const peso = (linha) => {
    if (jogoAberto && linha.id === 'over15') return 0;
    if (jogoAberto && linha.id === 'over25') return 1;
    if (jogoAberto && linha.id === 'bttsSim') return 2;
    if (linha.tag === 'FAVORITO') return 3;
    if (linha.baseDupla) return 4;
    return 5;
  };
  return lista
    .filter((linha) => {
      if (vistos.has(linha.id)) return false;
      vistos.add(linha.id);
      return true;
    })
    .sort((a, b) => peso(a) - peso(b) || b.ev - a.ev);
}

function extrairJsonGemini(raw) {
  const fonte = String(raw || '').trim();
  if (!fonte) return null;
  const limpo = fonte.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio === -1 || fim <= inicio) return null;
  try {
    return JSON.parse(limpo.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

function stakeDaEntrada(sugerida, ev, stakeBase) {
  const teto = Number(stakeBase) > 0 ? Number(stakeBase) : 5;
  const numero = Number(String(sugerida ?? '').replace(',', '.'));
  if (Number.isFinite(numero) && numero > 0 && numero <= teto) return Number(numero.toFixed(2));
  const peso = Number.isFinite(ev) && ev > 0 ? Math.min(1, ev / 0.1) : 0.5;
  return Number((teto * (0.55 + 0.45 * peso)).toFixed(2));
}

function numeroPercentual(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor > 1 ? valor : valor * 100;
  const numero = Number(String(valor ?? '').replace('%', '').replace(',', '.').trim());
  return Number.isFinite(numero) ? numero : null;
}

function grupoDoId(id) {
  if (id === 'casa' || id === 'empate' || id === 'fora') return '1X2';
  if (String(id).startsWith('dupla')) return 'Dupla Chance';
  if (/over|under/.test(id)) return 'Totais';
  if (/btts/.test(id)) return 'Ambas';
  return 'Resultado';
}

function catalogoDoAnalista(quant, allMarkets, home, away) {
  const lista = [];
  let matriz = null;
  if (quant?.lambda > 0 && quant?.mu > 0) {
    try { matriz = calcularOddsQuant(quant.lambda, quant.mu); } catch { matriz = null; }
  }
  (quant?.mercadosAuditados || []).forEach((linha) => {
    const odd1win = Number(linha.oddCasa);
    const oddJusta = Number(linha.oddJusta);
    if (!(odd1win > 1) || !(oddJusta > 1)) return;
    const ev = Number.isFinite(Number(linha.ev)) ? Number(linha.ev) : (odd1win / oddJusta) - 1;
    lista.push({
      id: linha.mercado,
      tipo: nomeMercadoXeque(linha.mercado, linha.nome, home, away),
      mercado: grupoDoId(linha.mercado),
      odd1win: Number(odd1win.toFixed(2)),
      oddJusta: Number(oddJusta.toFixed(2)),
      edge: Number((ev * 100).toFixed(1))
    });
  });
  if (matriz) {
    const chances = {
      '1X': matriz.matchOdds.casa.probabilidade + matriz.matchOdds.empate.probabilidade,
      X2: matriz.matchOdds.empate.probabilidade + matriz.matchOdds.fora.probabilidade,
      '12': matriz.matchOdds.casa.probabilidade + matriz.matchOdds.fora.probabilidade
    };
    (allMarkets || []).forEach((item) => {
      const codigo = item.dupla || codigoDuplaChance(item.market, item.selection, item.outcome);
      const chance = chances[codigo];
      if (!codigo || !(chance > 0) || !(item.odd > 1)) return;
      const id = codigo === '1X' ? 'dupla1X' : codigo === 'X2' ? 'duplaX2' : 'dupla12';
      if (lista.some((linha) => linha.id === id)) return;
      const oddJusta = Number((1 / chance).toFixed(2));
      lista.push({
        id,
        tipo: nomeMercadoXeque(id, item.selection, home, away),
        mercado: 'Dupla Chance',
        odd1win: Number(Number(item.odd).toFixed(2)),
        oddJusta,
        edge: Number((((item.odd * chance) - 1) * 100).toFixed(1))
      });
    });
  }
  return { lista, matriz };
}

function probabilidadesDoAnalista(quant, matriz) {
  const origem = quant?.probabilities || {};
  const deMatriz = (valor) => (Number.isFinite(valor) ? Number((valor * 100).toFixed(1)) : null);
  return {
    home: numeroPercentual(origem.homeWin) ?? deMatriz(matriz?.matchOdds?.casa?.probabilidade),
    draw: numeroPercentual(origem.draw) ?? deMatriz(matriz?.matchOdds?.empate?.probabilidade),
    away: numeroPercentual(origem.awayWin) ?? deMatriz(matriz?.matchOdds?.fora?.probabilidade),
    over25: numeroPercentual(origem.over25) ?? deMatriz(matriz?.gols?.over25?.probabilidade),
    btts: numeroPercentual(origem.btts) ?? deMatriz(matriz?.btts?.sim?.probabilidade)
  };
}

function idFavoritoObrigatorio(probs, odds) {
  const casa = Number(odds?.casa);
  const fora = Number(odds?.fora);
  const curtoFora = fora > 1 && fora <= 1.8 && (!(casa > 1) || fora < casa);
  const curtoCasa = casa > 1 && casa <= 1.8 && (!(fora > 1) || casa < fora);
  if ((probs?.away || 0) >= 55 && (probs.away > probs.home) && !curtoCasa) return 'fora';
  if ((probs?.home || 0) >= 55 && (probs.home >= probs.away) && !curtoFora) return 'casa';
  if (curtoFora) return 'fora';
  if (curtoCasa) return 'casa';
  return null;
}

function acharNoCatalogo(item, catalogo) {
  const id = String(item?.id || '').trim();
  if (id) {
    const porId = catalogo.find((linha) => linha.id === id);
    if (porId) return porId;
  }
  const tipo = normalizarNomeQuant(item?.tipo || item?.name);
  if (!tipo) return null;
  return catalogo.find((linha) => normalizarNomeQuant(linha.tipo) === tipo) || null;
}

function montarAprovado(base, item, stakeBase) {
  const tags = new Set(['FAVORITO', 'BASE MULTIPLA', 'GOLS', 'VALOR']);
  const tagPedida = String(item?.tag || '').trim().toUpperCase();
  let tag = tags.has(tagPedida) ? tagPedida : 'VALOR';
  if (base.id === 'casa' || base.id === 'fora') {
    if (tag === 'FAVORITO' || tag === 'BASE MULTIPLA' || tag === 'VALOR') tag = tag === 'VALOR' && base.edge > 0 ? 'VALOR' : tag;
  }
  if (base.id === 'over15' || base.id === 'over25' || base.id === 'bttsSim') tag = tag === 'VALOR' ? 'GOLS' : tag;
  const aptoMultipla = item?.aptoMultipla === true || tag === 'FAVORITO' || tag === 'BASE MULTIPLA' || tag === 'GOLS';
  const badge = tag === 'FAVORITO' ? 'FAVORITO' : base.edge > 0 ? '+EV' : tag;
  return {
    id: base.id,
    tipo: base.tipo,
    mercado: base.mercado,
    odd1win: base.odd1win,
    oddJusta: base.oddJusta,
    edge: base.edge,
    tag,
    badge,
    stakeSugerida: stakeDaEntrada(item?.stakeSugerida, base.edge / 100, stakeBase),
    aptoMultipla
  };
}

function decidirMercadosAprovados({ lido, catalogo, probs, odds, aberto, stakeBase }) {
  const favoritoId = idFavoritoObrigatorio(probs, odds);
  const bloqueados = new Set(aberto ? ['under15', 'under25'] : []);
  const vistos = new Set();
  const aprovados = [];
  const acrescentar = (base, item) => {
    if (!base || vistos.has(base.id) || bloqueados.has(base.id)) return;
    vistos.add(base.id);
    const pronto = montarAprovado(base, item, stakeBase);
    if (base.id === favoritoId) {
      pronto.tag = 'FAVORITO';
      pronto.badge = 'FAVORITO';
      pronto.aptoMultipla = true;
    }
    aprovados.push(pronto);
  };
  (Array.isArray(lido?.mercadosAprovados) ? lido.mercadosAprovados : []).forEach((item) => {
    const tipo = normalizarNomeQuant(item?.tipo);
    if (/cartao|1 tempo|2 tempo|antecipad/.test(tipo)) return;
    acrescentar(acharNoCatalogo(item, catalogo), item);
  });
  const favorito = catalogo.find((linha) => linha.id === favoritoId);
  if (favorito) acrescentar(favorito, { tag: 'FAVORITO', aptoMultipla: true });
  if (aberto) {
    ['over15', 'over25', 'bttsSim'].forEach((id) => {
      const linha = catalogo.find((item) => item.id === id);
      if (linha) acrescentar(linha, { tag: 'GOLS', aptoMultipla: true });
    });
  }
  const peso = (linha) => {
    if (linha.tag === 'FAVORITO') return 0;
    if (linha.id === 'over15') return 1;
    if (linha.id === 'over25') return 2;
    if (linha.id === 'bttsSim') return 3;
    if (linha.tag === 'BASE MULTIPLA') return 4;
    return 5;
  };
  return aprovados.sort((a, b) => peso(a) - peso(b) || b.edge - a.edge);
}

async function executarXequeMate({ homeTeam, awayTeam, league, quant, allMarkets, stakeBase, link }) {
  const { lista, matriz } = catalogoDoAnalista(quant, allMarkets, homeTeam, awayTeam);
  const probs = probabilidadesDoAnalista(quant, matriz);
  const aberto = (probs.over25 || 0) >= 50 || confrontoDeGols(matriz);
  const catalogo = lista.filter((linha) => !(aberto && (linha.id === 'under15' || linha.id === 'under25')));
  const tetoStake = Number(stakeBase) > 0 ? Number(stakeBase) : 5;
  const deepScan = {
    fonte: quant?.fonteDados || 'indisponível',
    lambda: quant?.lambda ?? null,
    mu: quant?.mu ?? null,
    classificacao: quant?.standings || null,
    h2h: (quant?.h2h || []).slice(0, 10),
    perfil: quant?.perfilTimes || null
  };
  const prompt = `Você é o Chief Betting Analyst do SofaPunter Quant. A decisão final de quais apostas aparecem no card é sua.
Devolva apenas JSON, sem markdown, neste schema:
{"resumoTatico":"string detalhando o momento e a leitura do jogo","probabilidades":{"home":0,"draw":0,"away":0,"over25":0,"btts":0},"mercadosAprovados":[{"id":"id do catálogo","tipo":"string","mercado":"string","odd1win":0,"oddJusta":0,"edge":0,"tag":"FAVORITO","badge":"FAVORITO","stakeSugerida":0,"aptoMultipla":true}],"mensagemTelegram":"texto curto com a leitura e o link"}
Regras operacionais obrigatórias:
a) REGRA DO FAVORITO: se um time tiver probabilidade >= 55%, aprove obrigatoriamente a vitória direta dele em mercadosAprovados com tag FAVORITO, badge FAVORITO e aptoMultipla true. Isso vale para odd 1.15, 1.25 ou 1.49. Nunca descarte o favorito por edge negativo.
b) REGRA DE GOLS: se Over 2.5 >= 50% ou o jogo for aberto, aprove Over 1.5, Over 2.5 e Ambas Marcam: Sim com tag GOLS. É proibido aprovar Under 2.5 ou Abaixo de 2.5 nesse cenário, mesmo com cotação 3.36 a 3.50.
c) DUPLA HIPÓTESE: aprove somente 1X, 12 e X2 do tempo regulamentar que estejam no catálogo. Ignore cartões, 1º tempo e 2º tempo.
Copie id, odd1win, oddJusta e edge exatamente do catálogo. Não invente cotação. A stake fica entre 0 e ${tetoStake} reais.
Probabilidades já calculadas, em percentual: ${JSON.stringify(probs)}
Jogo aberto: ${aberto ? 'sim' : 'não'}
Catálogo real da 1win: ${JSON.stringify(catalogo)}
Confronto: ${homeTeam} vs ${awayTeam}
Liga: ${league || 'não informada'}
Link: ${link || 'não informado'}
Deep scan: ${JSON.stringify(deepScan)}`;

  let lido = null;
  try {
    const texto = await requestGeminiTacticalText(prompt, { json: true, timeout: 45000 });
    lido = extrairJsonGemini(texto);
  } catch (erro) {
    console.error('⚠️ [XEQUE-MATE] Gemini indisponível:', erro?.message || erro);
  }

  const aprovados = decidirMercadosAprovados({
    lido,
    catalogo,
    probs,
    odds: quant?.oddsMercado,
    aberto,
    stakeBase: tetoStake
  });
  const resumo = String(lido?.resumoTatico || lido?.diagnostico_tatico || '').trim()
    || 'Leitura pelas regras do analista: o favorito permanece no card e o Under fica de fora quando o jogo é aberto.';
  const markets = aprovados.map((linha, index) => ({
    id: `xeque_${linha.id}_${index}`,
    chave: linha.id,
    tipo: linha.tipo,
    mercado: linha.mercado,
    name: linha.tipo,
    marketType: linha.mercado,
    odd1win: linha.odd1win,
    oddJusta: linha.oddJusta,
    fairOdd: linha.oddJusta,
    edge: linha.edge,
    evPercent: linha.edge,
    tag: linha.tag,
    badge: linha.badge,
    aptoMultipla: linha.aptoMultipla,
    isTopEV: false,
    stakeSugerida: linha.stakeSugerida
  }));
  const mensagemModelo = [
    `⚽ ${homeTeam} vs ${awayTeam}`,
    league ? `🏆 ${league}` : '',
    resumo,
    ...markets.slice(0, 4).map((linha) => `🎯 ${linha.tipo} @ ${linha.odd1win} | justa ${linha.oddJusta} | ${linha.tag}`),
    link ? `🔗 ${link}` : ''
  ].filter(Boolean).join('\n');
  const mensagem = String(lido?.mensagemTelegram || lido?.mensagem_telegram || '').trim() || mensagemModelo;
  markets.forEach((linha) => {
    linha.mensagemTelegram = mensagem;
  });
  console.log(`🧠 [ANALISTA] ${markets.length} mercados aprovados${aberto ? ' | jogo aberto' : ''}`);
  return {
    diagnostico_tatico: resumo,
    mensagem_telegram: mensagem,
    markets,
    mercadosAprovados: markets,
    probabilidades: probs
  };
}

// =========================================================================
// ROTA 2: AUDITORIA REAL VIA WEBSOCKET (FAVORITO + MERCADOS DE GOLS)
// =========================================================================
app.post('/api/check-1win-match', async (req, res) => {
  try {
    const { urlOrId, homeTeam, awayTeam, league, justification, stakeBase } = req.body;
    const matchId = (urlOrId || '').toString().match(/(\d{6,12})/)?.[0];

    if (!matchId) {
      return res.status(400).json({ success: false, message: 'ID da partida não identificado no link informado.' });
    }

    console.log(`\n======================================================`);
    console.log(`📡 [WEBSOCKET 1WIN] Auditando partida ${matchId}...`);

    console.log(`🔬 [DEEP SCAN] ${homeTeam} vs ${awayTeam}`);
    const allMarkets = await fetch1WinMatchOdds(matchId);
    console.log(`🎯 [WEBSOCKET 1WIN] Recebidas ${allMarkets.length} odds oficiais.`);

    let quant = null;
    try {
      quant = await montarBlocoQuant({ allMarkets, homeTeam, awayTeam, league, justification, semTatica: true });
    } catch (error) {
      console.error('⚠️ [QUANT] Auditoria segue sem o motor:', error?.message || error);
      quant = null;
    }

    const link = /^https?:\/\//i.test(String(urlOrId || '')) ? String(urlOrId).trim() : '';
    const xeque = await executarXequeMate({
      homeTeam,
      awayTeam,
      league,
      quant,
      allMarkets,
      stakeBase: Number(stakeBase),
      link
    });
    if (quant && xeque.diagnostico_tatico) {
      quant.tatica = {
        ...(quant.tatica || {}),
        resumoVisual: xeque.diagnostico_tatico.split('\n')[0].slice(0, 160),
        validacaoTatica: xeque.diagnostico_tatico
      };
    }

    res.json({
      success: true,
      matchId,
      totalMarketsCaptured: allMarkets.length,
      markets: xeque.markets,
      mercadosAprovados: xeque.mercadosAprovados,
      auditoria: {
        resumoTatico: xeque.diagnostico_tatico,
        probabilidades: xeque.probabilidades,
        mercadosAprovados: xeque.mercadosAprovados
      },
      tacticalReading: xeque.diagnostico_tatico,
      mensagemTelegram: xeque.mensagem_telegram,
      aiScout: xeque.diagnostico_tatico,
      quant
    });

  } catch (error) {
    console.error('❌ Falha na auditoria:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ROTA 3: ANÁLISE PROFUNDA DE SCOUT TÁTICO, H2H, GOLS E ESCANTEIOS VIA GEMINI
// =========================================================================
app.post('/api/ai-scout-analyze', async (req, res) => {
  const { homeTeam, awayTeam, league, odds, score, metrics } = req.body;

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ success: false, message: 'Dados da partida incompletos.' });
  }

  console.log(`\n🤖 [IA SCOUT] Analisando: ${homeTeam} vs ${awayTeam} (${league})...`);

  const promptText = `Você é o analista tático sênior do canal FutStats. Analise o confronto entre ${homeTeam} e ${awayTeam}.
1. Escreva uma leitura tática real, objetiva e exclusiva de 2 frases em PORTUGUÊS (Brasil) destacando a dinâmica do jogo e tendências.
2. Escolha LIVREMENTE as 2 maiores tendências/probabilidades de mercado para este confronto (utilize a nomenclatura padrão em português, ex: Handicap 0, Total de Gols: Acima de X, Ambas as Equipes Marcam: Sim/Não, Dupla Hipótese).
3. Retorne estritamente o objeto JSON.

Métricas do card:
- Liga: ${league || 'não informada'}
- Score: ${score ?? 'não informado'}
- Odds: ${JSON.stringify(odds || [])}
- Métricas: ${JSON.stringify(metrics || {})}

{
  "tacticalReading": "Texto da leitura tática em português (2 frases)...",
  "aiPicks": [
    { "market": "Nome do mercado livre sugerido pela IA (ex: Handicap 0, Total de Gols, Ambas Marcam)", "oddEstimated": "1.75" },
    { "market": "Nome do segundo mercado livre sugerido pela IA", "oddEstimated": "1.85" }
  ]
}`;

  const geminiText = await requestGeminiTacticalText(promptText, { json: true });
  const parsed = parseAiScoutResponse(geminiText, homeTeam, awayTeam, odds);

  console.log(`✅ [SCOUT CONCLUÍDO] Leitura pronta para ${homeTeam} vs ${awayTeam}. Mercados IA: ${parsed.aiPicks.length}.`);
  res.json({ success: true, tacticalReading: parsed.tacticalReading, aiPicks: parsed.aiPicks });
});

// =========================================================================
// PUBLICAÇÃO DE TIP NO TELEGRAM (FOTO + LEGENDA HTML + BOTÃO)
// =========================================================================
const escapeTelegramHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const officialImages = [
  'https://i.postimg.cc/d7mFHJJg/corrida-futebol.jpg',
  'https://i.postimg.cc/7CM4sqqp/depositphotos-21114749-stock-photo-two-football-players-striking-the.webp',
  'https://i.postimg.cc/R3Qmsvvk/depositphotos-93593016-stock-photo-soccer-players-in-action-on.webp',
  'https://i.postimg.cc/wtczf96K/imagem-carrinho.jpg'
];
const LEGACY_TELEGRAM_PHOTO = 'https://i.imgur.com/8QZzG8v.jpeg';
let currentImageIndex = 0;

app.post('/api/publish-telegram-tip', async (req, res) => {
  try {
    const body = req.body || {};
    const photoUrl = String(body.photoUrl || '').trim();
    const league = String(body.league || body.liga || '').trim();
    const match = String(
      body.match || body.partida || (body.home && body.away ? `${body.home} vs ${body.away}` : '')
    ).trim();
    const tacticalReading = String(
      body.tacticalReading || body.justification || body.lectura || ''
    ).trim();
    const market = formatMarketName(String(body.market || body.mercado || '').trim(), {
      home: body.home || body.homeTeam,
      away: body.away || body.awayTeam
    });
    const odd = Number(body.odd ?? body.odd1win ?? body.cuota);
    const stake = Number(body.stake);

    const useOfficialRotation = !photoUrl || photoUrl === LEGACY_TELEGRAM_PHOTO;
    if (!useOfficialRotation && !/^https?:\/\//i.test(photoUrl)) {
      return res.status(400).json({ success: false, message: 'Envie photoUrl com o endereço público da imagem.' });
    }
    if (!league || !match || !market || !Number.isFinite(odd) || odd <= 1 || !Number.isFinite(stake) || stake <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Informe liga, partida, mercado, odd 1win e stake para publicar o tip.'
      });
    }

    const reading = /volume de ataque constante como mandante|Lectura táctica alineada al mercado elegido/i.test(tacticalReading)
      ? ''
      : tacticalReading;
    const captionHead = [
      `🏆 <b>Liga:</b> ${escapeTelegramHtml(league)}`,
      `⚽ <b>Partida:</b> ${escapeTelegramHtml(match)}`
    ].join('\n');
    const captionTail = [
      `🎯 <b>Mercado:</b> ${escapeTelegramHtml(market)}`,
      `💰 <b>Cotação 1win:</b> ${odd.toFixed(2)}`,
      '',
      '⚠️ <b>Aviso +18:</b> Conteúdo exclusivo para maiores de 18 anos. Jogue com responsabilidade.'
    ].join('\n');
    const readingLabel = '📊 <b>Leitura tática:</b> ';
    const readingBudget = 1024 - captionHead.length - captionTail.length - readingLabel.length - 2;
    let safeReading = escapeTelegramHtml(reading);
    if (safeReading.length > readingBudget) {
      safeReading = `${safeReading.slice(0, Math.max(0, readingBudget - 1)).trim()}…`;
    }
    const caption = reading
      ? `${captionHead}\n${readingLabel}${safeReading}\n${captionTail}`
      : `${captionHead}\n${captionTail}`;
    const photoToSend = useOfficialRotation
      ? officialImages[currentImageIndex]
      : photoUrl;
    if (useOfficialRotation) {
      currentImageIndex = (currentImageIndex + 1) % officialImages.length;
    }
    const rawDirectLink = String(body.directLink || '').trim();
    const buttonUrl = /^https?:\/\//i.test(rawDirectLink) ? rawDirectLink : TELEGRAM_AFFILIATE_URL;

    const telegramResponse = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        chat_id: TELEGRAM_CHANNEL,
        photo: photoToSend,
        caption,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🎯 ENTRAR NA JOGADA (1WIN)', url: buttonUrl }
          ]]
        }
      },
      { timeout: 15000 }
    );

    if (!telegramResponse.data?.ok) {
      const description = telegramResponse.data?.description || 'O Telegram recusou a publicação.';
      console.error('❌ [TELEGRAM] Falha ao publicar:', description);
      return res.status(502).json({ success: false, message: description });
    }

    console.log(`📣 [TELEGRAM] Tip publicado em ${TELEGRAM_CHANNEL}: ${match}`);
    res.json({
      success: true,
      messageId: telegramResponse.data.result?.message_id || null
    });
  } catch (error) {
    const description = error.response?.data?.description || error.message;
    console.error('❌ [TELEGRAM] Falha ao publicar:', description);
    res.status(500).json({ success: false, message: description });
  }
});

function formatRecapDate(value) {
  const iso = String(value || '').trim().slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso || '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function buildDailyRecapText(body) {
  const lines = (Array.isArray(body.entries) ? body.entries : []).map((entry) => {
    const match = String(entry.match || entry.jogo || 'Jogo').trim();
    const market = String(entry.market || entry.mercado || 'Mercado').trim();
    const status = String(entry.status || '').toUpperCase();
    const odd = Number(entry.odd);
    const oddLabel = Number.isFinite(odd) ? odd.toFixed(2) : '—';
    if (status === 'GREEN') return `✅ ${match} — ${market} (Odd ${oddLabel})`;
    if (status === 'RED') return `❌ ${match} — ${market} (Odd ${oddLabel})`;
    if (status === 'CASHOUT') return `🟡 ${match} — ${market} (Cash Out / Reembolso)`;
    return '';
  }).filter(Boolean);

  if (!lines.length) return '';

  return [
    '📊 FECHAMENTO DIÁRIO | BOT FUTSTATS',
    `🗓 Data: ${formatRecapDate(body.date)}`,
    '',
    lines.join('\n'),
    '',
    '📈 Resumo do Dia:',
    `🟢 Greens: ${Number(body.greens) || 0}`,
    `🔴 Reds: ${Number(body.reds) || 0}`,
    `🟡 Cashouts: ${Number(body.cashouts) || 0}`,
    `💰 Saldo do Dia: ${Number(body.units) >= 0 ? '+' : ''}${Number(body.units || 0).toFixed(2)} Unidades`,
    '',
    'Gestão de banca e consistência com o método +EV! 🎯🚀'
  ].join('\n');
}

app.post('/api/telegram/send-daily-recap', async (req, res) => {
  try {
    const text = buildDailyRecapText(req.body || {});
    if (!text) {
      return res.status(400).json({ success: false, message: 'Não há jogos finalizados para montar o resumo.' });
    }
    const telegramResponse = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHANNEL, text: text.slice(0, 4096) },
      { timeout: 15000 }
    );
    if (!telegramResponse.data?.ok) {
      const description = telegramResponse.data?.description || 'O Telegram recusou o resumo.';
      console.error('❌ [TELEGRAM] Falha no resumo diário:', description);
      return res.status(502).json({ success: false, message: description });
    }
    console.log(`📣 [TELEGRAM] Resumo diário publicado em ${TELEGRAM_CHANNEL}.`);
    res.json({ success: true, messageId: telegramResponse.data.result?.message_id || null });
  } catch (error) {
    const description = error.response?.data?.description || error.message;
    console.error('❌ [TELEGRAM] Falha no resumo diário:', description);
    res.status(500).json({ success: false, message: description });
  }
});

// =========================================================================
// INICIALIZAÇÃO DO SERVIDOR NA PORTA 3001
// =========================================================================
const executadoDiretamente = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

async function enviarTelegramTexto(texto) {
  const telegramResponse = await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    { chat_id: TELEGRAM_CHANNEL, text: String(texto || '').slice(0, 4096) },
    { timeout: 15000 }
  );
  if (!telegramResponse.data?.ok) {
    throw new Error(telegramResponse.data?.description || 'O Telegram recusou a mensagem.');
  }
}

if (executadoDiretamente) {
  app.listen(PORT, () => {
    console.log(`✅ SofaPunter Motor 1WIN ativo em http://localhost:${PORT}`);
    console.log(`☁️ Apostas ao vivo na tabela ${TABELA_APOSTAS}`);
    iniciarMonitorCarpina({
      arquivoBets: DB_FILE,
      tabelaApostas: TABELA_APOSTAS,
      consultarFixture: obterFixtureAoVivo,
      listarDia: listarFixturesDoDia,
      enviarTelegram: enviarTelegramTexto
    });
  });
}

export { montarBlocoQuant, decidirMercadosAprovados, idFavoritoObrigatorio };