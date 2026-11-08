function hojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function semAcento(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function temTexto(texto, frases) {
  return frases.some((frase) => texto.includes(frase));
}

function temPais(texto, nomes) {
  return nomes.some((nome) => new RegExp(`(^| )${nome}( |$)`).test(texto));
}

const LIGAS_API_FOOTBALL = new Map([
  [78, 'bundesliga'],
  [79, 'bundesliga_2'],
  [136, 'serie_b']
]);

function classificarLeagueGroup(textoLiga, jogoBrasil, leagueId) {
  const porId = LIGAS_API_FOOTBALL.get(Number(leagueId));
  if (porId) return porId;
  const texto = String(textoLiga || '');
  if (temTexto(texto, ['uefa champions', 'uefa europa', 'uefa conference', 'liga dos campeoes', 'liga europa'])) {
    return 'uefa_cups';
  }
  if (temTexto(texto, ['copa del rey', 'copa do rei', 'fa cup', 'copa da inglaterra', 'coppa italia', 'copa do brasil', 'dfb pokal', 'coupe de france', 'copa de la liga'])) {
    return 'national_cups';
  }
  if (jogoBrasil || temTexto(texto, ['brasileirao', 'serie a brasil', 'serie b brasil']) || temPais(texto, ['brazil', 'brasil'])) {
    return 'brazil';
  }
  if (temPais(texto, ['england', 'inglaterra'])) return 'premier_league';
  if (temPais(texto, ['spain', 'espanha'])) return 'laliga';
  if (temTexto(texto, ['2. bundesliga', '2 bundesliga', 'bundesliga 2', 'ii bundesliga'])) return 'bundesliga_2';
  if (temTexto(texto, ['bundesliga'])) return 'bundesliga';
  if (!jogoBrasil && temTexto(texto, ['serie b']) && !temPais(texto, ['brazil', 'brasil'])) return 'serie_b';
  if (temPais(texto, ['italy', 'italia'])) return 'serie_a';
  if (temPais(texto, ['france', 'franca'])) return 'ligue_1';
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
}

function montarJogo(jogo) {
  const home = jogo.teams?.home?.name;
  const away = jogo.teams?.away?.name;
  const fixtureId = jogo.fixture?.id;
  if (!home || !away || !fixtureId) return null;
  const liga = jogo.league?.name || 'Futebol';
  const pais = jogo.league?.country || '';
  const textoLiga = semAcento(`${liga} ${pais}`);
  const leagueId = Number(jogo.league?.id);
  const isBrazil = semAcento(pais) === 'brazil' || semAcento(pais) === 'brasil' || temPais(textoLiga, ['brazil', 'brasil']);
  const leagueGroup = classificarLeagueGroup(textoLiga, isBrazil, leagueId);
  const oddHome = 1.95;
  const oddDraw = 3.3;
  const oddAway = 3.8;
  const pHome = 1 / oddHome;
  const pDraw = 1 / oddDraw;
  const pAway = 1 / oddAway;
  const margin = pHome + pDraw + pAway;
  const normHome = pHome / margin;
  const normAway = pAway / margin;
  const favTeam = normHome >= normAway ? home : away;
  const favProb = normHome >= normAway ? normHome : normAway;
  const underProb = normHome >= normAway ? normAway : normHome;
  const dnbProb = favProb / (favProb + underProb);
  const fairDnb = Number((1 / dnbProb).toFixed(2));
  const fairDc = Number((1 / (favProb + (pDraw / margin))).toFixed(2));
  const nomeLiga = semAcento(liga);
  const eliteDireta = (
    (leagueGroup === 'uefa_cups' && nomeLiga.includes('uefa'))
    || (leagueGroup === 'premier_league' && nomeLiga === 'premier league')
    || (leagueGroup === 'laliga' && ['la liga', 'laliga', 'segunda division', 'laliga2'].includes(nomeLiga))
    || (leagueGroup === 'serie_a' && nomeLiga === 'serie a')
    || leagueGroup === 'serie_b'
    || leagueGroup === 'bundesliga'
    || leagueGroup === 'bundesliga_2'
    || (leagueGroup === 'ligue_1' && ['ligue 1', 'ligue 2'].includes(nomeLiga))
  );
  let score = Math.min(95, Math.round(dnbProb * 100) + 12);
  if (eliteDireta) score += 40;
  if (/\bu\d{2}\b|\bii\b|\biii\b|youth|reserves|women|woman|feminino|feminina/.test(semAcento(`${home} ${away} ${liga}`))) score -= 30;
  const hora = new Date(jogo.fixture.date);
  const time = Number.isNaN(hora.getTime())
    ? ''
    : hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return {
    id: String(fixtureId),
    league: liga,
    leagueId: Number.isFinite(leagueId) ? leagueId : null,
    leagueGroup,
    home,
    away,
    time,
    score,
    dnbProb,
    isBrazil,
    justification: `Favorito: ${favTeam} (${(dnbProb * 100).toFixed(0)}% prob no DNB). Abra o jogo na 1win para conferir as odds oficiais.`,
    markets: [
      {
        id: `pre_${fixtureId}_dnb`,
        name: `${favTeam} Empate Anula (DNB)`,
        marketType: 'Empate Anula (DNB)',
        defaultOdd: fairDnb,
        fairOdd: fairDnb,
        evPercent: 0,
        isTopPick: true,
        tag: '⚡ AGUARDANDO AUDITORIA'
      },
      {
        id: `pre_${fixtureId}_dc`,
        name: `Dupla Hipótese: ${favTeam} ou Empate`,
        marketType: 'Dupla Chance',
        defaultOdd: fairDc,
        fairOdd: fairDc,
        evPercent: 0,
        isTopPick: false,
        tag: 'Alternativa'
      }
    ]
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ success: false, message: 'Use GET.' });
    return;
  }
  const chave = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY;
  if (!chave) {
    res.status(500).json({ success: false, message: 'Configure API_FOOTBALL_KEY nas variáveis de ambiente da Vercel.' });
    return;
  }
  const shift = String(req.query?.shift || 'europe').toLowerCase() === 'brazil' ? 'brazil' : 'europe';
  const data = hojeSaoPaulo();
  try {
    const resposta = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${data}&timezone=America/Sao_Paulo`,
      { headers: { 'x-apisports-key': chave } }
    );
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const detalhe = corpo?.message || corpo?.errors && JSON.stringify(corpo.errors) || 'A API-Football recusou a consulta.';
      res.status(resposta.status).json({ success: false, message: String(detalhe) });
      return;
    }
    const ignorar = new Set(['CANC', 'PST', 'ABD', 'AWD', 'WO']);
    const jogos = (corpo.response || [])
      .filter((jogo) => !ignorar.has(String(jogo.fixture?.status?.short || '')))
      .filter((jogo) => !/cyber|simulated|srl|fifa|e-?soccer/i.test(`${jogo.league?.name || ''} ${jogo.league?.country || ''}`))
      .map(montarJogo)
      .filter(Boolean)
      .filter((jogo) => (shift === 'brazil' ? jogo.isBrazil : !jogo.isBrazil))
      .sort((a, b) => b.score - a.score || String(a.time).localeCompare(String(b.time)));
    const selecionados = new Map(jogos.slice(0, 20).map((jogo) => [jogo.id, jogo]));
    jogos.forEach((jogo) => {
      if (LIGAS_API_FOOTBALL.has(jogo.leagueId)) selecionados.set(jogo.id, jogo);
    });
    const listaFinal = [...selecionados.values()]
      .sort((a, b) => b.score - a.score || String(a.time).localeCompare(String(b.time)));
    res.status(200).json({ success: true, count: listaFinal.length, shift, games: listaFinal });
  } catch (erro) {
    res.status(500).json({ success: false, message: erro.message || 'Falha ao consultar os jogos do dia.' });
  }
}
