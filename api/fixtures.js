import { ligaOficialPorTexto, partidaVirtual } from '../ligasOficiais.js';

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

function montarJogo(jogo) {
  const home = jogo.teams?.home?.name;
  const away = jogo.teams?.away?.name;
  const fixtureId = jogo.fixture?.id;
  if (!home || !away || !fixtureId) return null;
  const liga = jogo.league?.name || 'Futebol';
  const pais = jogo.league?.country || '';
  const leagueId = Number(jogo.league?.id);
  if (partidaVirtual(`${liga} ${pais}`, `${home} ${away}`)) return null;
  const oficial = ligaOficialPorTexto(`${liga} ${pais}`, leagueId);
  if (!oficial) return null;
  const isBrazil = oficial.regiao === 'Brasil';
  const leagueGroup = oficial.grupo;
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
  let score = Math.min(95, Math.round(dnbProb * 100) + 12);
  score += 40;
  if (/\bu\d{2}\b|\bii\b|\biii\b|youth|reserves|women|woman|feminino|feminina/.test(semAcento(`${home} ${away} ${liga}`))) score -= 30;
  const hora = new Date(jogo.fixture.date);
  const time = Number.isNaN(hora.getTime())
    ? ''
    : hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return {
    id: String(fixtureId),
    league: oficial.nome,
    leagueId: oficial.id,
    leagueGroup,
    regiao: oficial.regiao,
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
    const aoVivo = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);
    const jogos = (corpo.response || [])
      .filter((jogo) => {
        const status = String(jogo.fixture?.status?.short || '');
        if (aoVivo.has(status)) return true;
        return !ignorar.has(status);
      })
      .map(montarJogo)
      .filter(Boolean)
      .filter((jogo) => (shift === 'brazil' ? jogo.regiao === 'Brasil' : jogo.regiao !== 'Brasil'))
      .sort((a, b) => b.score - a.score || String(a.time).localeCompare(String(b.time)));
    const listaFinal = jogos;
    res.status(200).json({ success: true, count: listaFinal.length, shift, games: listaFinal });
  } catch (erro) {
    res.status(500).json({ success: false, message: erro.message || 'Falha ao consultar os jogos do dia.' });
  }
}
