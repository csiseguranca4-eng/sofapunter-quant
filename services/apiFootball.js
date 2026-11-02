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
  const cantosFavor = lerBlocoCantos(stats.corners?.for);
  const cantosContra = lerBlocoCantos(stats.corners?.against);
  const amarelos = somarFaixas(stats.cards?.yellow);
  const vermelhos = somarFaixas(stats.cards?.red);
  const cartoesTotais = (amarelos || 0) + (vermelhos || 0);
  return {
    teamId: team,
    leagueId: league,
    season: ano,
    jogos,
    golosMarcadosCasa: numero(marcados.home),
    golosMarcadosFora: numero(marcados.away),
    golosSofridosCasa: numero(sofridos.home),
    golosSofridosFora: numero(sofridos.away),
    form: typeof stats.form === 'string' ? stats.form : '',
    cantosAFavorCasa: cantosFavor.casa,
    cantosAFavorFora: cantosFavor.fora,
    cantosContraCasa: cantosContra.casa,
    cantosContraFora: cantosContra.fora,
    cantosPorJogo: cantosFavor.jogo,
    cartoesPorJogo: jogos > 0 && (amarelos != null || vermelhos != null)
      ? Number((cartoesTotais / jogos).toFixed(2))
      : null
  };
}

function somarFaixas(bloco) {
  if (!bloco || typeof bloco !== 'object') return null;
  const valores = Object.values(bloco).map((faixa) => numero(faixa?.total)).filter((item) => item != null);
  if (!valores.length) return null;
  return valores.reduce((total, item) => total + item, 0);
}

function lerBlocoCantos(bloco) {
  if (!bloco || typeof bloco !== 'object') return { casa: null, fora: null, jogo: null };
  const media = bloco.average || {};
  return {
    casa: numero(media.home),
    fora: numero(media.away),
    jogo: numero(media.total ?? bloco.total?.total ?? bloco.total)
  };
}

function dataCurta(iso) {
  const encontrada = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!encontrada) return '';
  return `${encontrada[3]}/${encontrada[2]}/${encontrada[1].slice(2)}`;
}

function resumirFixture(jogo) {
  const golsCasa = numero(jogo?.goals?.home);
  const golsFora = numero(jogo?.goals?.away);
  if (golsCasa == null || golsFora == null) return null;
  const casa = jogo.teams?.home?.name || 'Casa';
  const fora = jogo.teams?.away?.name || 'Fora';
  const vencedor = jogo.teams?.home?.winner ? casa : jogo.teams?.away?.winner ? fora : 'Empate';
  return {
    data: dataCurta(jogo.fixture?.date),
    casa,
    fora,
    golsCasa,
    golsFora,
    placar: `${golsCasa}x${golsFora}`,
    vencedor,
    totalGols: golsCasa + golsFora
  };
}

function percentual(parte, total) {
  if (!(total > 0)) return null;
  return Number(((parte / total) * 100).toFixed(1));
}

async function obterClassificacao(leagueId, season, teamId) {
  const league = Number(leagueId);
  const ano = Number(season);
  const team = Number(teamId);
  if (!Number.isFinite(league) || !Number.isFinite(ano) || !Number.isFinite(team)) return null;

  const dados = await pedir(`/standings?league=${league}&season=${ano}`);
  const grupos = dados?.response?.[0]?.league?.standings;
  const linhas = Array.isArray(grupos) ? grupos.flat() : [];
  const linha = linhas.find((item) => Number(item?.team?.id) === team);
  if (!linha) return null;
  const forma = String(linha.form || '').replace(/\s+/g, '');
  return {
    posicao: numero(linha.rank),
    pontos: numero(linha.points),
    jogos: numero(linha.all?.played),
    saldoGols: numero(linha.goalsDiff),
    forma: forma.slice(-5)
  };
}

async function obterH2H(mandanteId, visitanteId, limite = 5) {
  const casa = Number(mandanteId);
  const fora = Number(visitanteId);
  const last = Number(limite) > 0 ? Number(limite) : 5;
  if (!Number.isFinite(casa) || !Number.isFinite(fora)) return [];

  const dados = await pedir(`/fixtures/headtohead?h2h=${casa}-${fora}&last=${last}`);
  const lista = Array.isArray(dados?.response) ? dados.response : [];
  return lista.map(resumirFixture).filter(Boolean);
}

async function obterUltimosJogos(teamId, limite = 10) {
  const team = Number(teamId);
  const last = Number(limite) > 0 ? Number(limite) : 10;
  if (!Number.isFinite(team)) return { jogos: [], over25: null, btts: null };

  const dados = await pedir(`/fixtures?team=${team}&last=${last}`);
  const jogos = (Array.isArray(dados?.response) ? dados.response : []).map(resumirFixture).filter(Boolean);
  return {
    jogos,
    over25: percentual(jogos.filter((jogo) => jogo.totalGols >= 3).length, jogos.length),
    btts: percentual(jogos.filter((jogo) => jogo.golsCasa > 0 && jogo.golsFora > 0).length, jogos.length)
  };
}

function valorCorner(statistics) {
  const item = (statistics || []).find((linha) => linha?.type === 'Corner Kicks');
  return numero(item?.value);
}

async function mediasCantosRecentes(teamId, leagueId, season) {
  const dados = await pedir(`/fixtures?team=${teamId}&league=${leagueId}&season=${season}&last=8&status=FT`);
  const jogos = Array.isArray(dados?.response) ? dados.response : [];
  if (jogos.length < 3) return null;

  const amostras = (await Promise.all(jogos.map(async (jogo) => {
    try {
      const corpo = await pedir(`/fixtures/statistics?fixture=${jogo.fixture.id}`);
      const times = Array.isArray(corpo?.response) ? corpo.response : [];
      const proprio = times.find((item) => Number(item?.team?.id) === Number(teamId));
      const adversario = times.find((item) => Number(item?.team?.id) !== Number(teamId));
      const aFavor = valorCorner(proprio?.statistics);
      const contra = valorCorner(adversario?.statistics);
      if (aFavor == null || contra == null) return null;
      return { emCasa: Number(jogo.teams?.home?.id) === Number(teamId), aFavor, contra };
    } catch (_) {
      return null;
    }
  }))).filter(Boolean);

  if (amostras.length < 3) return null;
  const media = (lista) => (
    lista.length ? Number((lista.reduce((total, item) => total + item, 0) / lista.length).toFixed(2)) : null
  );
  const casa = amostras.filter((item) => item.emCasa);
  const fora = amostras.filter((item) => !item.emCasa);
  return {
    cantosAFavorCasa: media(casa.map((item) => item.aFavor)),
    cantosContraCasa: media(casa.map((item) => item.contra)),
    cantosAFavorFora: media(fora.map((item) => item.aFavor)),
    cantosContraFora: media(fora.map((item) => item.contra)),
    cantosPorJogo: media(amostras.map((item) => item.aFavor))
  };
}

async function anexarCantos(stats) {
  if (!stats || Number.isFinite(stats.cantosPorJogo) || Number.isFinite(stats.cantosAFavorCasa)) return stats;
  try {
    const medias = await mediasCantosRecentes(stats.teamId, stats.leagueId, stats.season);
    if (medias) Object.assign(stats, medias);
  } catch (_) { /* cantos vazios não derrubam o confronto */ }
  return stats;
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

  await Promise.all([anexarCantos(mandante), anexarCantos(visitante)]);

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
  calcularMediasConfronto,
  obterClassificacao,
  obterH2H,
  obterUltimosJogos
};

if (require.main === module) {
    console.log("=== TESTANDO CONEXÃO API-FOOTBALL COM FLAMENGO ===");
    buscarIdEquipa("Flamengo").then(id => {
        console.log("ID encontrado para o Flamengo:", id);
    }).catch(err => {
        console.error("Erro no teste:", err.message);
    });
}
