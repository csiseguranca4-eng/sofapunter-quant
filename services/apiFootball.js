/**
 * Conector da API-Sports / API-Football.
 * A chave vem do .env da raiz. Se a leitura falhar, usa a reserva local.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://v3.football.api-sports.io';
const CHAVE_RESERVA = '6ae436cbf2752144b1c89b761207b84b';

function carregarChave() {
  if (process.env.API_FOOTBALL_KEY) return process.env.API_FOOTBALL_KEY;

  const envPath = path.resolve(__dirname, '../.env');
  try {
    require('dotenv').config({ path: envPath });
  } catch (_) {
    try {
      const texto = fs.readFileSync(envPath, 'utf8');
      const linha = texto.split(/\r?\n/).find((item) => item.startsWith('API_FOOTBALL_KEY='));
      if (linha) {
        const valor = linha.slice('API_FOOTBALL_KEY='.length).trim().replace(/^['"]|['"]$/g, '');
        if (valor) process.env.API_FOOTBALL_KEY = valor;
      }
    } catch (_) { /* o fallback abaixo cobre a ausência do arquivo */ }
  }

  return process.env.API_FOOTBALL_KEY || CHAVE_RESERVA;
}

function cabecalhos() {
  return {
    'x-apisports-key': process.env.API_FOOTBALL_KEY || CHAVE_RESERVA
  };
}

carregarChave();

function numero(valor) {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function mediaPonderada(primeiro, segundo) {
  const valores = [primeiro, segundo].filter((item) => Number.isFinite(item));
  if (!valores.length) return null;
  const soma = valores.reduce((total, item) => total + item, 0);
  return Number((soma / valores.length).toFixed(2));
}

async function pedir(caminho) {
  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    headers: cabecalhos(),
    signal: AbortSignal.timeout(15000)
  });
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const detalhe = corpo?.message || resposta.statusText || 'falha HTTP';
    throw new Error(`API-Football ${resposta.status}: ${detalhe}`);
  }
  const erros = corpo?.errors;
  const temErro = Array.isArray(erros) ? erros.length > 0 : erros && typeof erros === 'object' && Object.keys(erros).length > 0;
  if (temErro) {
    throw new Error(`API-Football: ${typeof erros === 'string' ? erros : JSON.stringify(erros)}`);
  }
  return corpo;
}

async function buscarIdEquipa(nomeEquipa) {
  const nome = String(nomeEquipa || '').trim();
  if (!nome) throw new Error('Informe o nome da equipa.');

  const dados = await pedir(`/teams?search=${encodeURIComponent(nome)}`);
  const id = dados?.response?.[0]?.team?.id;
  if (!Number.isFinite(Number(id))) {
    throw new Error(`Nenhuma equipa encontrada para "${nome}".`);
  }
  return Number(id);
}

async function obterEstatisticasEquipa(teamId, leagueId, season) {
  const team = Number(teamId);
  const league = Number(leagueId);
  const ano = Number(season);
  if (!Number.isFinite(team) || !Number.isFinite(league) || !Number.isFinite(ano)) {
    throw new Error('Informe teamId, leagueId e season numéricos.');
  }

  const dados = await pedir(`/teams/statistics?team=${team}&league=${league}&season=${ano}`);
  const stats = dados?.response;
  if (!stats || typeof stats !== 'object') {
    throw new Error(`Estatísticas indisponíveis para a equipa ${team}.`);
  }

  const marcados = stats.goals?.for?.average || {};
  const sofridos = stats.goals?.against?.average || {};
  const jogos = numero(stats.fixtures?.played?.total) || 0;
  return {
    teamId: team,
    leagueId: league,
    season: ano,
    jogos,
    golosMarcadosCasa: numero(marcados.home),
    golosMarcadosFora: numero(marcados.away),
    golosSofridosCasa: numero(sofridos.home),
    golosSofridosFora: numero(sofridos.away),
    form: typeof stats.form === 'string' ? stats.form : ''
  };
}

const TEMPORADA_PRIORITARIA = [2026, 2025];

function erroDeTemporada(error) {
  return /season|plan|2022|2024|2025|2026/i.test(String(error?.message || ''));
}

function temporadaTemDados(stats) {
  if (!stats) return false;
  const medias = [
    stats.golosMarcadosCasa,
    stats.golosMarcadosFora,
    stats.golosSofridosCasa,
    stats.golosSofridosFora
  ].filter((item) => Number.isFinite(item));
  return stats.jogos >= 3 && medias.length >= 2;
}

async function ligasDoTime(teamId) {
  try {
    const dados = await pedir(`/leagues?team=${teamId}&current=true`);
    const lista = Array.isArray(dados?.response) ? dados.response : [];
    const emAndamento = lista.filter((item) => (item.seasons || []).some((temporada) => temporada.current));
    if (emAndamento.length) return emAndamento;
    if (lista.length) return lista;
  } catch (error) {
    if (!erroDeTemporada(error)) throw error;
  }

  for (const ano of TEMPORADA_PRIORITARIA) {
    try {
      const dados = await pedir(`/leagues?team=${teamId}&season=${ano}`);
      const lista = Array.isArray(dados?.response) ? dados.response : [];
      if (lista.length) return lista;
    } catch (error) {
      if (!erroDeTemporada(error)) throw error;
    }
  }
  return [];
}

async function estatisticasNaTemporadaDisponivel(teamId, leagueId, season) {
  const anoAtual = TEMPORADA_PRIORITARIA.includes(Number(season)) ? Number(season) : TEMPORADA_PRIORITARIA[0];
  const anos = [anoAtual, anoAtual - 1];
  let melhor = null;
  let ultimoErro = null;

  for (const ano of anos) {
    try {
      const stats = await obterEstatisticasEquipa(teamId, leagueId, ano);
      if (temporadaTemDados(stats)) return stats;
      if (!melhor || stats.jogos > melhor.jogos) melhor = stats;
    } catch (error) {
      ultimoErro = error;
      if (!erroDeTemporada(error)) throw error;
    }
  }

  if (melhor) return melhor;
  throw ultimoErro || new Error('Estatísticas indisponíveis para a temporada.');
}

function escolherLiga(lista, preferidas) {
  const pool = preferidas?.length ? preferidas : lista;
  const liga = pool.find((item) => item?.league?.type === 'League') || pool[0];
  const leagueId = Number(liga?.league?.id);
  const temporadas = liga?.seasons || [];
  const temporadaAtual = temporadas.find((item) => item.current && TEMPORADA_PRIORITARIA.includes(Number(item.year)))
    || temporadas.find((item) => item.current)
    || temporadas.find((item) => Number(item.year) === 2026)
    || temporadas.find((item) => Number(item.year) === 2025)
    || temporadas[0];
  const season = Number(temporadaAtual?.year);
  if (!Number.isFinite(leagueId) || !Number.isFinite(season)) return null;
  return { leagueId, season };
}

async function resolverLigasConfronto(mandanteId, visitanteId, leagueId, season) {
  const ligaInformada = Number(leagueId);
  const temporadaInformada = Number(season);
  if (Number.isFinite(ligaInformada) && Number.isFinite(temporadaInformada)) {
    return {
      mandante: { leagueId: ligaInformada, season: temporadaInformada },
      visitante: { leagueId: ligaInformada, season: temporadaInformada }
    };
  }

  const [ligasMandante, ligasVisitante] = await Promise.all([
    ligasDoTime(mandanteId),
    ligasDoTime(visitanteId)
  ]);
  const idsVisitante = new Set(ligasVisitante.map((item) => item?.league?.id));
  const compartilhadas = ligasMandante.filter((item) => idsVisitante.has(item?.league?.id));
  const comum = compartilhadas.length ? escolherLiga(ligasMandante, compartilhadas) : null;
  if (comum) return { mandante: comum, visitante: comum };

  const casa = escolherLiga(ligasMandante);
  const fora = escolherLiga(ligasVisitante);
  if (!casa || !fora) throw new Error('Nenhuma liga atual encontrada para o confronto.');
  return { mandante: casa, visitante: fora };
}

async function calcularMediasConfronto(mandanteId, visitanteId, leagueId, season) {
  const ligas = await resolverLigasConfronto(mandanteId, visitanteId, leagueId, season);
  const [mandante, visitante] = await Promise.all([
    estatisticasNaTemporadaDisponivel(mandanteId, ligas.mandante.leagueId, ligas.mandante.season),
    estatisticasNaTemporadaDisponivel(visitanteId, ligas.visitante.leagueId, ligas.visitante.season)
  ]);

  const lambdaReal = mediaPonderada(mandante.golosMarcadosCasa, visitante.golosSofridosFora);
  const muReal = mediaPonderada(visitante.golosMarcadosFora, mandante.golosSofridosCasa);
  if (lambdaReal == null || muReal == null) {
    throw new Error('As médias de golos do confronto vieram incompletas.');
  }

  return { lambdaReal, muReal, mandante, visitante };
}

module.exports = {
  buscarIdEquipa,
  obterEstatisticasEquipa,
  calcularMediasConfronto
};

if (require.main === module) {
    console.log("=== TESTANDO CONEXÃO API-FOOTBALL COM FLAMENGO ===");
    buscarIdEquipa("Flamengo").then(id => {
        console.log("ID encontrado para o Flamengo:", id);
    }).catch(err => {
        console.error("Erro no teste:", err.message);
    });
}
