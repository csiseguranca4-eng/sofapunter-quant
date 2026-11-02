import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fetch1WinMatchOdds } from './1win-client.js';

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

      const score = Math.min(95, Math.round(dnbProb * 100) + 12);

      processedGames.push({
        id: matchId.toString(),
        league: tournamentName,
        home: homeName,
        away: awayName,
        time: timeFormatted,
        score: score,
        dnbProb: dnbProb,
        isBrazil: isBrazil,
        justification: `Favorito: ${favTeam} (${(dnbProb * 100).toFixed(0)}% prob no DNB). Cole o link para auditar as odds oficiais da 1win.`,
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

    const selected = filteredList.slice(0, 6);

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
        { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
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

// =========================================================================
// ROTA 2: AUDITORIA REAL VIA WEBSOCKET (FAVORITO + MERCADOS DE GOLS)
// =========================================================================
app.post('/api/check-1win-match', async (req, res) => {
  try {
    const { urlOrId, homeTeam, awayTeam, league, score, justification } = req.body;
    const matchId = (urlOrId || '').toString().match(/(\d{6,12})/)?.[0];

    if (!matchId) {
      return res.status(400).json({ success: false, message: 'ID da partida não identificado no link informado.' });
    }

    console.log(`\n======================================================`);
    console.log(`📡 [WEBSOCKET 1WIN] Auditando partida ${matchId}...`);

    const allMarkets = await fetch1WinMatchOdds(matchId);
    console.log(`🎯 [WEBSOCKET 1WIN] Recebidas ${allMarkets.length} odds oficiais.`);

    const auditedMarkets = [];

    // 1. EMPATE ANULA (DNB) DO FAVORITO
    const dnbOptions = allMarkets.filter(m => 
      m.market === 'Handicap' && 
      (m.selection.endsWith(' 0') || m.selection.includes(' 0.0'))
    );

    if (dnbOptions.length > 0) {
      dnbOptions.sort((a, b) => a.odd - b.odd);
      const favoriteDnb = dnbOptions[0];

      const fairOdd = Number((favoriteDnb.odd * 0.92).toFixed(2));
      const ev = Number((((favoriteDnb.odd - fairOdd) / fairOdd) * 100).toFixed(1));

      auditedMarkets.push({
        id: `real_1win_${matchId}_dnb`,
        name: favoriteDnb.selection,
        marketType: 'Empate Anula (DNB)',
        odd1win: favoriteDnb.odd,
        fairOdd: fairOdd,
        evPercent: ev,
        isTopEV: favoriteDnb.odd >= 1.35,
        recommendation: favoriteDnb.odd >= 1.35 
          ? `✅ Favorito identificado (${favoriteDnb.selection}) com Odd ${favoriteDnb.odd}` 
          : `⚠️ Odd esmagada (${favoriteDnb.odd}). Risco não compensa.`
      });
    }

    // 2. MERCADOS DE GOLS: OVER 1.5 E OVER 2.5
    const totalGoals = allMarkets.filter(m => m.market === 'Total' || m.market.includes('Total de gol'));

    const over15 = totalGoals.find(m => m.selection.toLowerCase().includes('acima de 1.5') || m.selection.includes('> 1.5'));
    if (over15) {
      const fair15 = Number((over15.odd * 0.93).toFixed(2));
      auditedMarkets.push({
        id: `real_1win_${matchId}_over15`,
        name: 'Total de Gols: Acima de 1.5',
        marketType: 'Gols (Over 1.5)',
        odd1win: over15.odd,
        fairOdd: fair15,
        evPercent: Number((((over15.odd - fair15) / fair15) * 100).toFixed(1)),
        isTopEV: over15.odd >= 1.25
      });
    }

    const over25 = totalGoals.find(m => m.selection.toLowerCase().includes('acima de 2.5') || m.selection.includes('> 2.5'));
    if (over25) {
      const fair25 = Number((over25.odd * 0.92).toFixed(2));
      auditedMarkets.push({
        id: `real_1win_${matchId}_over25`,
        name: 'Total de Gols: Acima de 2.5',
        marketType: 'Gols (Over 2.5)',
        odd1win: over25.odd,
        fairOdd: fair25,
        evPercent: Number((((over25.odd - fair25) / fair25) * 100).toFixed(1)),
        isTopEV: over25.odd >= 1.40
      });
    }

    // 3. AMBOS OS TIMES MARCAM (BTTS)
    const bttsGroup = allMarkets.filter(m => m.market.includes('Ambos os times') || m.market.includes('Ambas as equipes'));
    const bttsYes = bttsGroup.find(m => m.selection.toLowerCase().includes('sim') || m.outcome === '1');
    if (bttsYes) {
      const fairBtts = Number((bttsYes.odd * 0.92).toFixed(2));
      auditedMarkets.push({
        id: `real_1win_${matchId}_btts`,
        name: 'Ambos os Times Marcam: Sim',
        marketType: 'Ambos Marcam',
        odd1win: bttsYes.odd,
        fairOdd: fairBtts,
        evPercent: Number((((bttsYes.odd - fairBtts) / fairBtts) * 100).toFixed(1)),
        isTopEV: bttsYes.odd >= 1.45
      });
    }

    // 4. DUPLA CHANCE DO FAVORITO
    const dcGroup = allMarkets.filter(m => m.market.includes('Dupla Chance') || m.market.includes('Hipótese dupla') || m.market === 'Resultado duplo');
    if (dcGroup.length > 0) {
      dcGroup.sort((a, b) => a.odd - b.odd);
      const favDC = dcGroup[0];
      const fairDc = Number((favDC.odd * 0.94).toFixed(2));
      auditedMarkets.push({
        id: `real_1win_${matchId}_dc`,
        name: `Dupla Hipótese: ${favDC.selection}`,
        marketType: 'Dupla Chance',
        odd1win: favDC.odd,
        fairOdd: fairDc,
        evPercent: Number((((favDC.odd - fairDc) / fairDc) * 100).toFixed(1)),
        isTopEV: favDC.odd >= 1.20
      });
    }

    auditedMarkets.forEach((market) => {
      market.name = formatMarketName(market.name, { home: homeTeam, away: awayTeam });
    });

    let tacticalReading = '';
    if (allMarkets.length > 0) {
      const auditedLines = auditedMarkets.map(m =>
        `${m.marketType}: ${m.name} | odd 1win ${m.odd1win} | justa ${m.fairOdd} | EV ${m.evPercent}%`
      ).join('\n');
      const rawLines = allMarkets.slice(0, 40).map(m =>
        `${m.market}: ${m.selection} @ ${m.odd}`
      ).join('\n');
      tacticalReading = await generateAuditTacticalScout({
        homeTeam,
        awayTeam,
        league,
        score,
        cardText: justification,
        oddsList: `${auditedLines}\n${rawLines}`.trim()
      });
    }

    res.json({
      success: true,
      matchId,
      totalMarketsCaptured: allMarkets.length,
      markets: auditedMarkets,
      tacticalReading: tacticalReading || null,
      aiScout: tacticalReading || null
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
app.listen(PORT, () => {
  console.log(`✅ SofaPunter Motor 1WIN ativo em http://localhost:${PORT}`);
});