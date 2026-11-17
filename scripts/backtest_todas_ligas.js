/**
 * Ranqueia a janela 56'–80' em cada liga do seletor.
 *
 *   node scripts/backtest_todas_ligas.js
 *   node scripts/backtest_todas_ligas.js --self-test
 *
 * Lê todos os caches locais antes de qualquer chamada. Teto desta execução:
 * 3800 requisições, parando se o saldo diário chegar a 800. A trava de 400
 * do robô ao vivo não encerra a auditoria enquanto o saldo seguir acima de 800.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(PASTA, '..');
const require = createRequire(import.meta.url);
const CACHE_PROPRIO = path.join(PASTA, 'cache_backtest_todas_ligas.json');
const RANKING_PATH = path.join(RAIZ, 'data', 'ranking_ligas.json');

const TETO_EXECUCAO = 3800;
const ORCAMENTO_LIGA = 120;
const PISO_SALDO = 800;
const META_BUSCA = 60;
const TETO_CACHE = 100;
const STAKE = 4;
const LUCRO_GREEN = 2;
const STOP_80 = -1.8;
const XG_MIN = 1.5;
const NO_ALVO_MIN = 5;
const TEMPORADA = 2026;

const LIGAS = [
  { id: 2, nome: 'Champions League' },
  { id: 3, nome: 'Europa League' },
  { id: 848, nome: 'Conference League' },
  { id: 39, nome: 'Premier League' },
  { id: 40, nome: 'Championship' },
  { id: 140, nome: 'La Liga' },
  { id: 141, nome: 'La Liga 2' },
  { id: 135, nome: 'Serie A' },
  { id: 136, nome: 'Serie B' },
  { id: 78, nome: 'Bundesliga' },
  { id: 79, nome: '2. Bundesliga' },
  { id: 61, nome: 'Ligue 1' },
  { id: 62, nome: 'Ligue 2' },
  { id: 94, nome: 'Primeira Liga' },
  { id: 88, nome: 'Eredivisie' },
  { id: 203, nome: 'Süper Lig' },
  { id: 197, nome: 'Super League 1' },
  { id: 71, nome: 'Brasileirão Série A' },
  { id: 72, nome: 'Brasileirão Série B' },
  { id: 128, nome: 'Liga Profesional' },
  { id: 239, nome: 'Primera A' },
  { id: 253, nome: 'MLS' },
  { id: 262, nome: 'Liga MX' },
  { id: 265, nome: 'Primera División' },
  { id: 13, nome: 'Libertadores' },
  { id: 11, nome: 'Sul-Americana' },
  { id: 5, nome: 'Nations League' },
  { id: 32, nome: 'Eliminatórias Europa' },
  { id: 34, nome: 'Eliminatórias Sul-América' }
];
const POR_ID = new Map(LIGAS.map((liga) => [liga.id, liga]));

function numero(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(String(valor).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function lerJson(arquivo) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return null;
  }
}

function lerEstatistica(lista, nomes) {
  const alvo = new Set(nomes.map((nome) => nome.toLowerCase()));
  const item = (lista || []).find((stat) => alvo.has(String(stat?.type || '').toLowerCase()));
  return item ? numero(item.value) : null;
}

function estatisticasDe(corpo) {
  let xg = 0;
  let noAlvo = 0;
  let xgOk = false;
  let alvoOk = false;
  for (const time of corpo?.response || []) {
    const stats = time.statistics || [];
    const xgTime = lerEstatistica(stats, ['expected_goals', 'Expected Goals']);
    const alvoTime = lerEstatistica(stats, ['Shots on Goal', 'Shots on Target']);
    if (xgTime != null) { xg += xgTime; xgOk = true; }
    if (alvoTime != null) { noAlvo += alvoTime; alvoOk = true; }
  }
  if (!xgOk && !alvoOk) return null;
  return {
    xg: xgOk ? Number(xg.toFixed(2)) : null,
    noAlvo: alvoOk ? noAlvo : null
  };
}

function golsDeEventos(eventos, casaId, foraId) {
  return (eventos || []).map((evento) => {
    if (String(evento?.type || '') !== 'Goal') return null;
    const detalhe = String(evento?.detail || '');
    if (/missed|cancel|disallow/i.test(detalhe)) return null;
    const minuto = numero(evento.time?.elapsed);
    if (minuto == null) return null;
    const timeId = evento.team?.id ?? null;
    let lado = null;
    if (timeId != null && Number(timeId) === Number(casaId)) lado = 'casa';
    else if (timeId != null && Number(timeId) === Number(foraId)) lado = 'fora';
    if (lado && /own goal/i.test(detalhe)) lado = lado === 'casa' ? 'fora' : 'casa';
    return { minuto, extra: numero(evento.time?.extra) || 0, lado };
  }).filter(Boolean);
}

function placarAte55(gols) {
  let casa = 0;
  let fora = 0;
  for (const gol of gols || []) {
    if (gol.minuto > 55) continue;
    if (gol.lado === 'casa') casa += 1;
    else if (gol.lado === 'fora') fora += 1;
    else return null;
  }
  return { casa, fora };
}

function empate55(gols) {
  const placar = placarAte55(gols);
  if (!placar) return false;
  return (placar.casa === 0 && placar.fora === 0) || (placar.casa === 1 && placar.fora === 1);
}

function golEntre56e80(gols) {
  return (gols || []).some((gol) => gol.minuto >= 56 && gol.minuto <= 80);
}

function volume(jogo) {
  const stats = jogo?.estatisticas;
  let xg = numero(stats?.xg);
  let noAlvo = numero(stats?.noAlvo);
  if (noAlvo == null && jogo?.lados?.casa && jogo?.lados?.fora) {
    const casa = numero(jogo.lados.casa.noAlvo);
    const fora = numero(jogo.lados.fora.noAlvo);
    if (casa != null && fora != null) noAlvo = casa + fora;
  }
  return { xg, noAlvo };
}

function qualifica(jogo) {
  if (!POR_ID.has(Number(jogo?.ligaId)) || !Array.isArray(jogo?.gols)) return null;
  if (!empate55(jogo.gols)) return null;
  const { xg, noAlvo } = volume(jogo);
  if (xg == null || noAlvo == null || xg < XG_MIN || noAlvo < NO_ALVO_MIN) return null;
  const green = golEntre56e80(jogo.gols);
  return {
    id: jogo.id,
    data: jogo.data || '',
    ligaId: Number(jogo.ligaId),
    green,
    lucro: green ? LUCRO_GREEN : STOP_80
  };
}

function metaDaLiga(qtdNoCache) {
  if (qtdNoCache >= META_BUSCA) return Math.min(qtdNoCache, TETO_CACHE);
  return META_BUSCA;
}

function veredito(roi, jogos) {
  if (!jogos || roi == null) return 'SEM AMOSTRA';
  if (roi >= 15) return 'APROVADA ROI >= 15%';
  if (roi >= 8) return 'SELETIVA ROI 8-14%';
  return 'BLOQUEADA ROI < 8%';
}

function normalizarSalvo(jogo) {
  if (!jogo || jogo.id == null) return null;
  const ligaId = Number(jogo.ligaId);
  if (!POR_ID.has(ligaId)) return null;
  return {
    id: jogo.id,
    data: jogo.data || '',
    liga: jogo.liga || POR_ID.get(ligaId).nome,
    ligaId,
    casa: jogo.casa || '',
    fora: jogo.fora || '',
    casaId: jogo.casaId ?? null,
    foraId: jogo.foraId ?? null,
    gols: Array.isArray(jogo.gols) ? jogo.gols : null,
    estatisticas: jogo.estatisticas && typeof jogo.estatisticas === 'object' ? jogo.estatisticas : null,
    lados: jogo.lados || null
  };
}

function normalizarFixture(item) {
  const ligaId = Number(item?.league?.id);
  const id = item?.fixture?.id;
  if (!id || !POR_ID.has(ligaId)) return null;
  if (String(item?.fixture?.status?.short || '') !== 'FT') return null;
  const casaId = item.teams?.home?.id ?? null;
  const foraId = item.teams?.away?.id ?? null;
  const golsPlacar = (numero(item.goals?.home) || 0) + (numero(item.goals?.away) || 0);
  const eventos = Array.isArray(item.events) ? golsDeEventos(item.events, casaId, foraId) : null;
  const eventosConfiaveis = Array.isArray(eventos) && (golsPlacar === 0 || eventos.length > 0);
  return {
    id,
    data: item.fixture?.date || '',
    liga: item.league?.name || POR_ID.get(ligaId).nome,
    ligaId,
    casa: item.teams?.home?.name || '',
    fora: item.teams?.away?.name || '',
    casaId,
    foraId,
    gols: eventosConfiaveis ? eventos : null,
    estatisticas: estatisticasDe(item.statistics ? { response: item.statistics } : null),
    lados: null
  };
}

function mesclar(mapa, jogo) {
  const atual = normalizarSalvo(jogo);
  if (!atual) return;
  const chave = String(atual.id);
  const previo = mapa.get(chave);
  if (!previo) {
    mapa.set(chave, atual);
    return;
  }
  if (!Array.isArray(previo.gols) && Array.isArray(atual.gols)) previo.gols = atual.gols;
  if (!previo.estatisticas && atual.estatisticas) previo.estatisticas = atual.estatisticas;
  if (!previo.casaId && atual.casaId) previo.casaId = atual.casaId;
  if (!previo.foraId && atual.foraId) previo.foraId = atual.foraId;
  if (!previo.data && atual.data) previo.data = atual.data;
  if (!previo.casa && atual.casa) previo.casa = atual.casa;
  if (!previo.fora && atual.fora) previo.fora = atual.fora;
}

function arquivosCache() {
  const nomes = new Set();
  for (const arquivo of fs.readdirSync(PASTA)) {
    if (arquivo.startsWith('cache_') && arquivo.endsWith('.json')) nomes.add(path.join(PASTA, arquivo));
  }
  nomes.add(CACHE_PROPRIO);
  return [...nomes];
}

function lerCaches() {
  const mapa = new Map();
  for (const arquivo of arquivosCache()) {
    const json = lerJson(arquivo);
    for (const jogo of Object.values(json?.jogos || {})) mesclar(mapa, jogo);
  }
  return mapa;
}

function gravarCache(mapa) {
  const jogos = {};
  for (const [id, jogo] of mapa) jogos[id] = jogo;
  fs.writeFileSync(CACHE_PROPRIO, JSON.stringify({ jogos, temporada: TEMPORADA }));
}

function qualificadosDaLiga(mapa, ligaId) {
  return [...mapa.values()]
    .filter((jogo) => Number(jogo.ligaId) === Number(ligaId))
    .map(qualifica)
    .filter(Boolean)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || Number(b.id) - Number(a.id));
}

function resumir(liga, amostra) {
  const greens = amostra.filter((item) => item.green).length;
  const stops = amostra.length - greens;
  const lucro = Number(amostra.reduce((soma, item) => soma + item.lucro, 0).toFixed(2));
  const apostado = amostra.length * STAKE;
  const taxa = amostra.length ? Number(((greens / amostra.length) * 100).toFixed(1)) : null;
  const roi = apostado ? Number(((lucro / apostado) * 100).toFixed(1)) : null;
  return {
    ligaId: liga.id,
    liga: liga.nome,
    jogos: amostra.length,
    greens,
    stops,
    taxaAcerto: taxa,
    lucro,
    roiPercentual: roi,
    veredito: veredito(roi, amostra.length)
  };
}

function rankingDe(mapa) {
  return LIGAS.map((liga) => {
    const todos = qualificadosDaLiga(mapa, liga.id);
    const amostra = todos.slice(0, metaDaLiga(todos.length));
    return resumir(liga, amostra);
  }).sort((a, b) => {
    if (a.roiPercentual == null && b.roiPercentual == null) return a.liga.localeCompare(b.liga);
    if (a.roiPercentual == null) return 1;
    if (b.roiPercentual == null) return -1;
    return b.roiPercentual - a.roiPercentual || b.jogos - a.jogos || a.liga.localeCompare(b.liga);
  });
}

function textoPct(valor) {
  if (valor == null) return '—';
  const sinal = valor > 0 ? '+' : '';
  return `${sinal}${valor.toFixed(1).replace('.', ',')}%`;
}

function textoDinheiro(valor) {
  const n = Number(valor) || 0;
  const sinal = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sinal}US$ ${Math.abs(n).toFixed(2).replace('.', ',')}`;
}

function imprimirRanking(ranking, extra) {
  const cabecalho = ['Liga', 'Jogos', 'Greens', 'Stops', 'Acerto', 'Lucro', 'ROI', 'Veredito'];
  const linhas = ranking.map((item) => [
    item.liga,
    String(item.jogos),
    String(item.greens),
    String(item.stops),
    item.taxaAcerto == null ? '—' : `${item.taxaAcerto.toFixed(1).replace('.', ',')}%`,
    textoDinheiro(item.lucro),
    textoPct(item.roiPercentual),
    item.veredito
  ]);
  const larguras = cabecalho.map((coluna, indice) => Math.max(coluna.length, ...linhas.map((linha) => linha[indice].length)));
  const formatar = (colunas) => colunas.map((coluna, indice) => coluna.padEnd(larguras[indice])).join('  ');
  console.log('');
  console.log('Janela 56\'–80\' | 0x0 ou 1x1 aos 55\' | xG >= 1,50 | >= 5 no alvo | stake US$ 4,00');
  console.log('GREEN +US$ 2,00 | STOP 80\' -US$ 1,80 | xG e chutes são o agregado da partida.');
  console.log('');
  console.log(formatar(cabecalho));
  console.log(formatar(larguras.map((largura) => '-'.repeat(largura))));
  for (const linha of linhas) console.log(formatar(linha));
  console.log('');
  console.log(`Requisições nesta execução: ${extra.requisicoes} | Motivo: ${extra.motivo}`);
  if (extra.saldo) console.log(`Saldo diário ao encerrar: ${extra.saldo.remaining}/${extra.saldo.limit}`);
}

function gravarRanking(ranking, extra) {
  fs.mkdirSync(path.dirname(RANKING_PATH), { recursive: true });
  fs.writeFileSync(RANKING_PATH, JSON.stringify({
    geradoEm: new Date().toISOString(),
    estrategia: {
      janela: '56-80',
      placar55: ['0x0', '1x1'],
      xgMinimo: XG_MIN,
      chutesNoAlvoMinimo: NO_ALVO_MIN,
      stake: STAKE,
      green: LUCRO_GREEN,
      stop80: STOP_80
    },
    requisicoes: extra.requisicoes,
    motivo: extra.motivo,
    saldo: extra.saldo,
    ranking
  }, null, 2));
}

function criarConsulta(pedir) {
  const estado = { requisicoes: 0, saldo: null, motivo: null, limiteLiga: null, pedidos: new Set() };
  const logOriginal = console.log;
  console.log = (...args) => {
    const texto = args.map((item) => String(item)).join(' ');
    if (texto.includes('[API]')) estado.requisicoes += 1;
    const achado = texto.match(/Saldo real: (\d+)\/(\d+)/);
    if (achado) estado.saldo = { remaining: Number(achado[1]), limit: Number(achado[2]) };
    if (estado.saldo && estado.saldo.remaining <= PISO_SALDO) estado.motivo = 'saldo-800';
    if (estado.requisicoes >= TETO_EXECUCAO) estado.motivo = estado.motivo || 'teto-3800';
    logOriginal(...args);
  };
  function pode() {
    if (estado.motivo) return false;
    if (estado.limiteLiga != null && estado.requisicoes >= estado.limiteLiga) return false;
    if (estado.requisicoes >= TETO_EXECUCAO) {
      estado.motivo = 'teto-3800';
      return false;
    }
    if (estado.saldo && estado.saldo.remaining <= PISO_SALDO) {
      estado.motivo = 'saldo-800';
      return false;
    }
    return true;
  }
  async function consultar(caminho) {
    if (!pode() || estado.pedidos.has(caminho)) return null;
    estado.pedidos.add(caminho);
    try {
      return await pedir(caminho, { critico: true });
    } catch (erro) {
      const texto = String(erro?.message || erro);
      if (/429|pausada até o reset|saldo abaixo de 400/i.test(texto)) {
        estado.motivo = estado.saldo && estado.saldo.remaining <= PISO_SALDO ? 'saldo-800' : 'trava-api';
        return null;
      }
      logOriginal(`Falha em ${caminho}: ${texto}`);
      return null;
    }
  }
  return { estado, consultar, restaurarLog: () => { console.log = logOriginal; } };
}

function janelas() {
  const fim = new Date('2026-11-17T00:00:00Z');
  const inicio = new Date('2026-08-01T00:00:00Z');
  const lista = [];
  for (let cursor = new Date(fim); cursor >= inicio; cursor.setUTCDate(cursor.getUTCDate() - 21)) {
    const ate = cursor.toISOString().slice(0, 10);
    const deData = new Date(cursor);
    deData.setUTCDate(deData.getUTCDate() - 20);
    const de = (deData < inicio ? inicio : deData).toISOString().slice(0, 10);
    lista.push([de, ate]);
    if (de === inicio.toISOString().slice(0, 10)) break;
  }
  return lista;
}

async function completar(jogo, consultar, estado, mapa, ligaId) {
  if (estado.motivo || qualificadosDaLiga(mapa, ligaId).length >= META_BUSCA) return;
  if (!Array.isArray(jogo.gols)) {
    const corpo = await consultar(`/fixtures?id=${jogo.id}`);
    const cheio = normalizarFixture(corpo?.response?.[0]);
    if (cheio?.gols) jogo.gols = cheio.gols;
    if (cheio?.estatisticas) jogo.estatisticas = cheio.estatisticas;
  }
  const vol = volume(jogo);
  if (Array.isArray(jogo.gols) && empate55(jogo.gols) && (vol.xg == null || vol.noAlvo == null)) {
    const corpo = await consultar(`/fixtures/statistics?fixture=${jogo.id}`);
    const stats = estatisticasDe(corpo);
    if (stats) jogo.estatisticas = { ...(jogo.estatisticas || {}), ...stats };
  }
}

async function incorporarLista(mapa, liga, itens, consultar, estado) {
  const ordenados = itens
    .map(normalizarFixture)
    .filter((jogo) => jogo && Number(jogo.ligaId) === liga.id)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  for (const candidato of ordenados) {
    if (estado.motivo || qualificadosDaLiga(mapa, liga.id).length >= META_BUSCA) return;
    const chave = String(candidato.id);
    if (!mapa.has(chave)) mapa.set(chave, candidato);
    const jogo = mapa.get(chave);
    if (!Array.isArray(jogo.gols) && Array.isArray(candidato.gols)) jogo.gols = candidato.gols;
    if (!jogo.estatisticas && candidato.estatisticas) jogo.estatisticas = candidato.estatisticas;
    const vol = volume(jogo);
    const resolvido = Array.isArray(jogo.gols) && (!empate55(jogo.gols) || (vol.xg != null && vol.noAlvo != null));
    if (!resolvido) await completar(jogo, consultar, estado, mapa, liga.id);
  }
}

async function completarLiga(mapa, liga, consultar, estado) {
  const noCache = qualificadosDaLiga(mapa, liga.id).length;
  const meta = metaDaLiga(noCache);
  if (noCache >= META_BUSCA) {
    console.log(`${liga.nome}: ${noCache} no cache, usando ${meta} sem chamada`);
    return;
  }
  console.log(`${liga.nome}: ${noCache} no cache, buscando até ${META_BUSCA}`);
  estado.limiteLiga = estado.requisicoes + ORCAMENTO_LIGA;
  for (const temporada of [TEMPORADA, TEMPORADA - 1]) {
    if (estado.motivo || qualificadosDaLiga(mapa, liga.id).length >= META_BUSCA) break;
    const ultima = await consultar(`/fixtures?league=${liga.id}&season=${temporada}&last=99`);
    await incorporarLista(mapa, liga, ultima?.response || [], consultar, estado);
    if ((ultima?.response || []).length) break;
  }
  for (const [de, ate] of janelas()) {
    if (estado.motivo || qualificadosDaLiga(mapa, liga.id).length >= META_BUSCA) break;
    const corpo = await consultar(`/fixtures?league=${liga.id}&season=${TEMPORADA}&from=${de}&to=${ate}&status=FT`);
    await incorporarLista(mapa, liga, corpo?.response || [], consultar, estado);
  }
  estado.limiteLiga = null;
  gravarCache(mapa);
  console.log(`${liga.nome}: ${qualificadosDaLiga(mapa, liga.id).length} qualificados`);
}

async function main() {
  const mapa = lerCaches();
  const prontas = LIGAS.filter((liga) => qualificadosDaLiga(mapa, liga.id).length >= META_BUSCA).length;
  console.log(`Caches lidos: ${arquivosCache().length} | Ligas já com ${META_BUSCA}+ no cache: ${prontas}/${LIGAS.length}`);
  if (prontas === LIGAS.length) {
    const ranking = rankingDe(mapa);
    const extra = { requisicoes: 0, motivo: 'cache-completo', saldo: null };
    imprimirRanking(ranking, extra);
    gravarRanking(ranking, extra);
    console.log(`Ranking salvo em data/ranking_ligas.json`);
    return;
  }

  const { pedir } = require('../services/apiFootball.js');
  const { estado, consultar, restaurarLog } = criarConsulta(pedir);
  try {
    for (const liga of LIGAS) {
      if (estado.motivo) break;
      await completarLiga(mapa, liga, consultar, estado);
    }
    gravarCache(mapa);
    const ranking = rankingDe(mapa);
    const extra = {
      requisicoes: estado.requisicoes,
      motivo: estado.motivo || 'ligas-varridas',
      saldo: estado.saldo
    };
    imprimirRanking(ranking, extra);
    gravarRanking(ranking, extra);
    console.log('Ranking salvo em data/ranking_ligas.json');
  } finally {
    restaurarLog();
  }
}

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

function testar() {
  assert(metaDaLiga(40) === 60, 'abaixo de 60 busca até 60');
  assert(metaDaLiga(80) === 80, 'cache entre 60 e 100 fica inteiro');
  assert(metaDaLiga(120) === 100, 'cache acima de 100 corta em 100');
  assert(veredito(15, 10) === 'APROVADA ROI >= 15%', '15 aprova');
  assert(veredito(14.9, 10) === 'SELETIVA ROI 8-14%', '14,9 é seletiva');
  assert(veredito(8, 10) === 'SELETIVA ROI 8-14%', '8 é seletiva');
  assert(veredito(7.9, 10) === 'BLOQUEADA ROI < 8%', 'abaixo de 8 bloqueia');
  assert(veredito(null, 0) === 'SEM AMOSTRA', 'sem jogo não recebe veredito financeiro');
  const jogo = (parcial) => ({
    id: 1,
    ligaId: 39,
    data: '2026-11-01T15:00:00Z',
    gols: [],
    estatisticas: { xg: 1.5, noAlvo: 5 },
    ...parcial
  });
  const gol = (minuto, lado) => ({ minuto, extra: 0, lado });
  assert(qualifica(jogo({ gols: [gol(60, 'casa')] }))?.lucro === 2, 'green paga 2');
  assert(qualifica(jogo({ gols: [gol(81, 'casa')] }))?.lucro === -1.8, 'stop aos 81');
  assert(qualifica(jogo({ gols: [gol(55, 'casa')] })) == null, 'gol aos 55 sai do 0x0');
  assert(qualifica(jogo({ ligaId: 10, gols: [] })) == null, 'amistoso fica de fora');
  const linha = resumir({ id: 39, nome: 'Premier League' }, [
    { green: true, lucro: 2 },
    { green: false, lucro: -1.8 }
  ]);
  assert(linha.roiPercentual === 2.5 && linha.veredito.startsWith('BLOQUEADA'), 'roi da amostra');
  console.log('backtest todas ligas ok');
}

if (process.argv.includes('--self-test')) testar();
else main().catch((erro) => {
  console.error(`Auditoria interrompida: ${erro?.message || erro}`);
  process.exitCode = 1;
});
