/**
 * Conector da API-Sports / API-Football.
 * A chave vem do .env da raiz. Se a leitura falhar, usa a reserva local.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://v3.football.api-sports.io';
const CHAVE_RESERVA = 'f2f0dc8980b6f9d785e69183e046badf';

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
  return {
    teamId: team,
    leagueId: league,
    season: ano,
    golosMarcadosCasa: numero(marcados.home),
    golosMarcadosFora: numero(marcados.away),
    golosSofridosCasa: numero(sofridos.home),
    golosSofridosFora: numero(sofridos.away),
    form: typeof stats.form === 'string' ? stats.form : ''
  };
}

async function calcularMediasConfronto(mandanteId, visitanteId, leagueId, season) {
  const [mandante, visitante] = await Promise.all([
    obterEstatisticasEquipa(mandanteId, leagueId, season),
    obterEstatisticasEquipa(visitanteId, leagueId, season)
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
