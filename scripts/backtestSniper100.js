/**
 * Completa o cache local e simula o Stop 80'.
 *
 *   node --env-file=.env scripts/backtestSniper100.js
 *   node scripts/backtestSniper100.js --self-test
 *
 * Não refaz statistics nem events já gravados. Nesta execução o teto é de
 * 120 requisições e a coleta para se x-ratelimit-requests-remaining < 1000.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(PASTA, 'cache_backtest_100.json');
const ENV_PATH = path.resolve(PASTA, '../.env');
const BASE = 'https://v3.football.api-sports.io';

const META = 100;
const TETO_EXECUCAO = 120;
const PISO_SALDO = 1000;
const STAKE = 4;
const LUCRO_GREEN = 2.08;
const CASHOUT_80 = -1.85;
const XG_MIN = 1.5;
const FINALIZACOES_MIN = 12;
const NO_ALVO_MIN = 5;

const CLUBES = [
  { id: 141, nome: 'LaLiga 2' },
  { id: 88, nome: 'Eredivisie' },
  { id: 39, nome: 'Premier League' },
  { id: 135, nome: 'Serie A' },
  { id: 78, nome: 'Bundesliga' },
  { id: 2, nome: 'Champions League' },
  { id: 71, nome: 'Brasileirão' }
];
const IDS_CLUBES = new Set(CLUBES.map((liga) => liga.id));
const ID_NATIONS = 5;

function lerChave() {
  if (process.env.API_FOOTBALL_KEY) return process.env.API_FOOTBALL_KEY;
  try {
    const texto = fs.readFileSync(ENV_PATH, 'utf8');
    const linha = texto.split(/\r?\n/).find((item) => item.startsWith('API_FOOTBALL_KEY='));
    if (!linha) return '';
    return linha.slice('API_FOOTBALL_KEY='.length).trim().replace(/^['"]|['"]$/g, '');
  } catch {
    return '';
  }
}

function lerCache() {
  const salvo = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  return { ...salvo, jogos: salvo.jogos || {}, ordem: salvo.ordem || [] };
}

function gravarCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
}

function numero(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function completo(jogo) {
  return Boolean(jogo?.estatisticas) && Array.isArray(jogo?.gols);
}

function rankClube(jogo) {
  const indice = CLUBES.findIndex((liga) => liga.id === Number(jogo?.ligaId));
  return indice === -1 ? CLUBES.length : indice;
}

function grupoLiga(jogo) {
  const id = Number(jogo?.ligaId);
  if (IDS_CLUBES.has(id)) return 'clube';
  if (id === ID_NATIONS || /nations/i.test(String(jogo?.liga || ''))) return 'selecao';
  return 'outro';
}

function lerEstatistica(lista, nomes) {
  const alvo = new Set(nomes.map((nome) => nome.toLowerCase()));
  const item = (lista || []).find((stat) => alvo.has(String(stat?.type || '').toLowerCase()));
  return item ? numero(item.value) : null;
}

function lerEstatisticas(corpo) {
  let xg = 0;
  let finais = 0;
  let alvo = 0;
  let xgOk = false;
  let finaisOk = false;
  let alvoOk = false;
  for (const time of corpo?.response || []) {
    const stats = time.statistics || [];
    const xgTime = lerEstatistica(stats, ['expected_goals', 'Expected Goals']);
    const finaisTime = lerEstatistica(stats, ['Total Shots', 'Total shots']);
    const alvoTime = lerEstatistica(stats, ['Shots on Goal', 'Shots on Target']);
    if (xgTime != null) { xg += xgTime; xgOk = true; }
    if (finaisTime != null) { finais += finaisTime; finaisOk = true; }
    if (alvoTime != null) { alvo += alvoTime; alvoOk = true; }
  }
  return {
    xg: xgOk ? Number(xg.toFixed(2)) : null,
    finalizacoes: finaisOk ? finais : null,
    noAlvo: alvoOk ? alvo : null
  };
}

function lerGols(corpo, jogo) {
  return (corpo?.response || [])
    .filter((evento) => evento?.type === 'Goal')
    .map((evento) => {
      const minuto = numero(evento.time?.elapsed);
      if (minuto == null) return null;
      const timeId = evento.team?.id ?? null;
      let lado = null;
      if (timeId != null && timeId === jogo.casaId) lado = 'casa';
      else if (timeId != null && timeId === jogo.foraId) lado = 'fora';
      return { minuto, extra: numero(evento.time?.extra) || 0, lado };
    })
    .filter(Boolean);
}

function volumeOfensivo(stats) {
  if (!stats) return false;
  const porXg = stats.xg != null && stats.xg >= XG_MIN;
  const porChutes = stats.finalizacoes != null && stats.noAlvo != null
    && stats.finalizacoes >= FINALIZACOES_MIN && stats.noAlvo >= NO_ALVO_MIN;
  return porXg || porChutes;
}

function placarAte(gols, minuto) {
  let casa = 0;
  let fora = 0;
  for (const gol of gols || []) {
    if (gol.minuto <= minuto) {
      if (gol.lado === 'casa') casa += 1;
      else if (gol.lado === 'fora') fora += 1;
    }
  }
  return { casa, fora };
}

function golDepois(gols, minimoExclusivo, maximo) {
  return (gols || []).some((gol) => gol.minuto > minimoExclusivo && gol.minuto <= maximo);
}

function semGolEntre(gols, inicio, fim) {
  return !(gols || []).some((gol) => gol.minuto >= inicio && gol.minuto <= fim);
}

function liquidar(gols, minimoExclusivo, maximo) {
  if (golDepois(gols, minimoExclusivo, maximo)) return { green: true, lucro: LUCRO_GREEN };
  return { green: false, lucro: CASHOUT_80 };
}

function empateAlvo(placar) {
  return placar.casa === placar.fora && placar.casa >= 0 && placar.casa <= 2;
}

function desempatado(placar) {
  return (placar.casa === 1 && placar.fora === 0) || (placar.casa === 0 && placar.fora === 1);
}

function simularJogo(gols) {
  const aos60 = placarAte(gols, 60);
  const noStop = liquidar(gols, 60, 80);
  return {
    frio: semGolEntre(gols, 55, 65) ? liquidar(gols, 65, 80) : null,
    empate: empateAlvo(aos60) ? noStop : null,
    aberto: desempatado(aos60) ? noStop : null,
    marca: `${aos60.casa}x${aos60.fora}`
  };
}

function livroVazio() {
  return { entradas: 0, greens: 0, stops: 0, lucro: 0 };
}

function somar(livro, resultado) {
  if (!resultado) return;
  livro.entradas += 1;
  livro.lucro += resultado.lucro;
  if (resultado.green) livro.greens += 1;
  else livro.stops += 1;
}

function metricas(livro) {
  const apostado = livro.entradas * STAKE;
  const taxa = livro.entradas ? (livro.greens / livro.entradas) * 100 : null;
  const roi = apostado ? (livro.lucro / apostado) * 100 : null;
  return { ...livro, lucro: Number(livro.lucro.toFixed(2)), taxa, roi };
}

function auditar(jogos) {
  const livros = {
    frio: livroVazio(),
    empate: livroVazio(),
    clube: livroVazio(),
    selecao: livroVazio(),
    aberto: livroVazio(),
    '0x0': livroVazio(),
    '1x1': livroVazio(),
    '2x2': livroVazio(),
    '1x0': livroVazio(),
    '0x1': livroVazio()
  };
  let qualificados = 0;
  for (const jogo of jogos) {
    if (!volumeOfensivo(jogo.estatisticas) || !Array.isArray(jogo.gols)) continue;
    qualificados += 1;
    const resultado = simularJogo(jogo.gols);
    somar(livros.frio, resultado.frio);
    somar(livros.empate, resultado.empate);
    somar(livros.aberto, resultado.aberto);
    if (resultado.empate && grupoLiga(jogo) === 'clube') somar(livros.clube, resultado.empate);
    if (resultado.empate && grupoLiga(jogo) === 'selecao') somar(livros.selecao, resultado.empate);
    if (resultado.empate && livros[resultado.marca]) somar(livros[resultado.marca], resultado.empate);
    if (resultado.aberto && livros[resultado.marca]) somar(livros[resultado.marca], resultado.aberto);
  }
  return { qualificados, livros };
}

function dinheiro(valor) {
  const sinal = valor < 0 ? '-' : '';
  return `${sinal}US$ ${Math.abs(valor).toFixed(2).replace('.', ',')}`;
}

function pct(valor) {
  if (valor == null) return '    —';
  return `${valor.toFixed(1)}%`.padStart(6);
}

function linhaTabela(nome, livro) {
  const item = metricas(livro);
  return [
    nome.padEnd(52),
    String(item.entradas).padStart(8),
    String(item.greens).padStart(7),
    String(item.stops).padStart(11),
    pct(item.taxa).padStart(8),
    dinheiro(item.lucro).padStart(16),
    pct(item.roi).padStart(8)
  ].join(' ');
}

function cabecalhoTabela() {
  return [
    'Cenário'.padEnd(52),
    'Entradas'.padStart(8),
    'Greens'.padStart(7),
    'Reds/Stops'.padStart(11),
    'Acerto'.padStart(8),
    'Lucro líquido'.padStart(16),
    'ROI'.padStart(8)
  ].join(' ');
}

function amostra(cache) {
  const daOrdem = (cache.ordem || []).map((id) => cache.jogos[id]).filter(completo);
  if (daOrdem.length >= META) return daOrdem.slice(0, META);
  const ids = new Set(daOrdem.map((jogo) => jogo.id));
  const extras = Object.values(cache.jogos)
    .filter((jogo) => completo(jogo) && !ids.has(jogo.id) && grupoLiga(jogo) === 'clube')
    .sort((a, b) => rankClube(a) - rankClube(b) || String(b.data).localeCompare(String(a.data)));
  return daOrdem.concat(extras).slice(0, META);
}

function imprimirRelatorio(cache, execucao) {
  const jogos = amostra(cache);
  const auditoria = auditar(jogos);
  const mix = {};
  for (const jogo of jogos) {
    mix[jogo.liga || 'Sem liga'] = (mix[jogo.liga || 'Sem liga'] || 0) + 1;
  }
  const textoMix = Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([nome, qtd]) => `${nome} ${qtd}`).join(' | ');
  console.log('');
  console.log(`Completos na amostra: ${jogos.length}/${META} | Qualificados pelo volume final: ${auditoria.qualificados}`);
  console.log(`Requisições nesta execução: ${execucao?.n || 0}/${TETO_EXECUCAO} | Saldo visto: ${cache.remaining ?? '—'} | Parada: ${execucao?.parar || 'amostra pronta'}`);
  if (textoMix) console.log(`Composição: ${textoMix}`);
  console.log('Stake US$ 4,00 | Odd 1,52 | Green +US$ 2,08 | Sem gol até 80\' = −US$ 1,85');
  console.log('Volume = xG final >= 1,50 OU (finalizações >= 12 E no alvo >= 5). É o jogo inteiro, não o xG aos 60\'.');
  console.log('Clubes: LaLiga 2, Eredivisie, Premier League, Serie A, Bundesliga, Champions League, Brasileirão.');
  console.log('');
  const traco = '-'.repeat(114);
  console.log(traco);
  console.log(cabecalhoTabela());
  console.log(traco);
  console.log(linhaTabela('a Sem gol 55\'-65\' (sem filtro de placar)', auditoria.livros.frio));
  console.log(linhaTabela('b A/A+ empatado 0x0, 1x1 ou 2x2 aos 60\'', auditoria.livros.empate));
  console.log(linhaTabela('  0x0', auditoria.livros['0x0']));
  console.log(linhaTabela('  1x1', auditoria.livros['1x1']));
  console.log(linhaTabela('  2x2', auditoria.livros['2x2']));
  console.log(linhaTabela('c Clubes empatados aos 60\'', auditoria.livros.clube));
  console.log(linhaTabela('c Seleções (Nations League) empatadas aos 60\'', auditoria.livros.selecao));
  console.log(linhaTabela('d Desempatado 1x0 ou 0x1 aos 60\'', auditoria.livros.aberto));
  console.log(linhaTabela('  1x0', auditoria.livros['1x0']));
  console.log(linhaTabela('  0x1', auditoria.livros['0x1']));
  console.log(traco);

  const frio = metricas(auditoria.livros.frio);
  const empate = metricas(auditoria.livros.empate);
  const clube = metricas(auditoria.livros.clube);
  const selecao = metricas(auditoria.livros.selecao);
  const aberto = metricas(auditoria.livros.aberto);
  console.log('');
  const linhas = [
    ['Sem filtro de placar', frio],
    ['Empate aos 60\'', empate],
    ['Clubes empatados', clube],
    ['Nations League empatada', selecao]
  ].filter(([, item]) => item.entradas > 0);
  if (linhas.length) {
    const melhor = linhas.reduce((atual, item) => (item[1].lucro > atual[1].lucro ? item : atual));
    console.log(`Maior lucro entre as entradas permitidas: ${melhor[0]} (${dinheiro(melhor[1].lucro)}, ROI ${melhor[1].roi.toFixed(1)}%, ${melhor[1].entradas} entradas).`);
  }
  if (empate.entradas && aberto.entradas) {
    console.log(`Contraste: empate aos 60' ${dinheiro(empate.lucro)} (ROI ${empate.roi.toFixed(1)}%) contra 1x0/0x1 ${dinheiro(aberto.lucro)} (ROI ${aberto.roi.toFixed(1)}%).`);
  }
  if (clube.entradas || selecao.entradas) {
    console.log(`Clubes empatados: ${clube.entradas ? `${dinheiro(clube.lucro)} em ${clube.entradas}` : 'sem entrada'} | Nations League: ${selecao.entradas ? `${dinheiro(selecao.lucro)} em ${selecao.entradas}` : 'sem entrada'}.`);
  }
  if (execucao?.parar === 'saldo-baixo') {
    console.log('Coleta interrompida com saldo abaixo de 1000. O que já entrou no cache permanece.');
  } else if (jogos.length < META) {
    console.log(`A amostra ficou em ${jogos.length} jogos completos nesta execução.`);
  }
  console.log('');
}

function podePedir(cache, execucao) {
  if (execucao.n >= TETO_EXECUCAO) {
    execucao.parar = 'teto-120';
    return false;
  }
  if (cache.remaining != null && cache.remaining < PISO_SALDO) {
    execucao.parar = 'saldo-baixo';
    return false;
  }
  return true;
}

async function consultar(cache, caminho, chave, execucao) {
  if (!podePedir(cache, execucao)) return null;
  const resposta = await fetch(`${BASE}${caminho}`, {
    headers: { 'x-apisports-key': chave },
    signal: AbortSignal.timeout(20000)
  });
  execucao.n += 1;
  cache.requisicoes = (cache.requisicoes || 0) + 1;
  const remaining = Number(resposta.headers.get('x-ratelimit-requests-remaining'));
  const limit = resposta.headers.get('x-ratelimit-requests-limit');
  if (Number.isFinite(remaining)) cache.remaining = remaining;
  const corpo = await resposta.json().catch(() => null);
  console.log(`[backtest] ${caminho.split('?')[0]} | saldo ${Number.isFinite(remaining) ? remaining : '—'}/${limit || '—'} | uso ${execucao.n}/${TETO_EXECUCAO}`);
  if (resposta.status === 429) {
    execucao.parar = '429';
    gravarCache(cache);
    return null;
  }
  if (!resposta.ok) {
    console.warn(`[backtest] falha ${resposta.status} em ${caminho.split('?')[0]}`);
    return { falha: true };
  }
  const erros = corpo?.errors;
  const temErro = Array.isArray(erros) ? erros.length > 0 : Boolean(erros && typeof erros === 'object' && Object.keys(erros).length);
  if (temErro) {
    console.warn(`[backtest] resposta com erro em ${caminho.split('?')[0]}`);
    return { falha: true };
  }
  if (Number.isFinite(remaining) && remaining < PISO_SALDO) execucao.parar = 'saldo-baixo';
  return corpo;
}

async function preencher(cache, jogo, chave, execucao) {
  if (!jogo || completo(jogo) || execucao.parar) return;
  if (!jogo.estatisticas) {
    const corpo = await consultar(cache, `/fixtures/statistics?fixture=${jogo.id}`, chave, execucao);
    if (!corpo || corpo.falha) return;
    jogo.estatisticas = lerEstatisticas(corpo);
    gravarCache(cache);
    if (execucao.parar) return;
  }
  if (!Array.isArray(jogo.gols)) {
    const corpo = await consultar(cache, `/fixtures/events?fixture=${jogo.id}`, chave, execucao);
    if (!corpo || corpo.falha) return;
    jogo.gols = lerGols(corpo, jogo);
    gravarCache(cache);
  }
}

function normalizarFixture(item) {
  const id = item?.fixture?.id;
  if (!id) return null;
  return {
    id,
    data: item.fixture?.date || '',
    liga: item.league?.name || '',
    ligaId: item.league?.id ?? null,
    casa: item.teams?.home?.name || '',
    fora: item.teams?.away?.name || '',
    casaId: item.teams?.home?.id ?? null,
    foraId: item.teams?.away?.id ?? null,
    estatisticas: null,
    gols: null
  };
}

async function buscarLista(cache, liga, temporada, chave, execucao) {
  const corpo = await consultar(
    cache,
    `/fixtures?league=${liga.id}&season=${temporada}&status=FT&last=30`,
    chave,
    execucao
  );
  if (!corpo || corpo.falha) return [];
  return (corpo.response || []).map(normalizarFixture).filter(Boolean);
}

async function completar(cache, chave) {
  const execucao = { n: 0, parar: null };
  const pendentes = (cache.ordem || [])
    .map((id) => cache.jogos[id])
    .filter((jogo) => jogo && !completo(jogo))
    .sort((a, b) => rankClube(a) - rankClube(b) || String(b.data).localeCompare(String(a.data)));

  for (const jogo of pendentes) {
    if (execucao.parar) break;
    await preencher(cache, jogo, chave, execucao);
  }

  let prontos = (cache.ordem || []).filter((id) => completo(cache.jogos[id])).length;
  if (prontos < META && !execucao.parar) {
    const extras = Object.values(cache.jogos)
      .filter((jogo) => !completo(jogo) && grupoLiga(jogo) === 'clube' && !(cache.ordem || []).includes(jogo.id))
      .sort((a, b) => rankClube(a) - rankClube(b) || String(b.data).localeCompare(String(a.data)));
    for (const jogo of extras) {
      if (execucao.parar || prontos >= META) break;
      await preencher(cache, jogo, chave, execucao);
      if (completo(jogo) && !cache.ordem.includes(jogo.id)) cache.ordem.push(jogo.id);
      prontos = cache.ordem.filter((id) => completo(cache.jogos[id])).length;
    }
  }

  if (prontos < META && !execucao.parar && !cache.ligasConsultadas?.includes(71)) {
    const temporada = cache.temporada || 2026;
    const brasileirao = CLUBES.find((liga) => liga.id === 71);
    let jogos = await buscarLista(cache, brasileirao, temporada, chave, execucao);
    if (!jogos.length && !execucao.parar) jogos = await buscarLista(cache, brasileirao, temporada - 1, chave, execucao);
    cache.ligasConsultadas = [...(cache.ligasConsultadas || []), 71];
    for (const jogo of jogos) {
      if (!cache.jogos[jogo.id]) cache.jogos[jogo.id] = jogo;
    }
    gravarCache(cache);
    for (const jogo of jogos) {
      if (execucao.parar || prontos >= META) break;
      const salvo = cache.jogos[jogo.id];
      await preencher(cache, salvo, chave, execucao);
      if (completo(salvo) && !cache.ordem.includes(salvo.id)) cache.ordem.push(salvo.id);
      prontos = cache.ordem.filter((id) => completo(cache.jogos[id])).length;
    }
  }

  cache.fechado = true;
  cache.motivo = execucao.parar || (prontos >= META ? 'amostra-100' : 'incompleta');
  gravarCache(cache);
  return execucao;
}

function assert(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

function selfTest() {
  const gol = (minuto, lado) => ({ minuto, extra: 0, lado });
  const stats = { xg: 1.8, finalizacoes: 14, noAlvo: 6 };
  const jogo = (gols, ligaId) => ({ estatisticas: stats, gols, ligaId, liga: ligaId === 5 ? 'UEFA Nations League' : 'Premier League' });

  const base = auditar([jogo([gol(72, 'casa')], 39)]);
  assert(base.livros.frio.greens === 1 && base.livros.frio.lucro === 2.08, 'sem gol 55-65 e gol aos 72 é green');
  assert(base.livros.empate.greens === 1 && base.livros.clube.greens === 1, '0x0 de clube entra no A');
  assert(base.livros.selecao.entradas === 0, 'clube não conta como seleção');

  const cashout = auditar([jogo([], 5)]);
  assert(cashout.livros.frio.lucro === -1.85 && cashout.livros.selecao.stops === 1, '0x0 sem gol é cashout da Nations');

  const aos62 = auditar([jogo([gol(62, 'casa')], 39)]);
  assert(aos62.livros.frio.entradas === 0, 'gol aos 62 bloqueia a linha sem filtro');
  assert(aos62.livros.empate.greens === 1, '0x0 aos 60 com gol aos 62 paga o empate');

  const doisDois = auditar([jogo([gol(8, 'casa'), gol(15, 'fora'), gol(22, 'casa'), gol(30, 'fora'), gol(70, 'casa')], 78)]);
  assert(doisDois.livros['2x2'].greens === 1, '2x2 aos 60 entra no empate');

  const umUm = auditar([jogo([gol(12, 'casa'), gol(44, 'fora')], 2)]);
  assert(umUm.livros['1x1'].stops === 1 && umUm.livros.clube.stops === 1, '1x1 sem gol depois é cashout de clube');

  const lider = auditar([jogo([gol(18, 'fora')], 141)]);
  assert(lider.livros.empate.entradas === 0 && lider.livros['0x1'].stops === 1, '0x1 fica só no desempatado');
  assert(lider.livros.frio.stops === 1, '0x1 sem gol 55-65 ainda entra na linha sem filtro');

  const aos80 = auditar([jogo([gol(80, 'casa')], 39)]);
  assert(aos80.livros.empate.greens === 1, '80 inclusive é green');
  const aos81 = auditar([jogo([gol(81, 'casa')], 39)]);
  assert(aos81.livros.empate.stops === 1 && aos81.livros.frio.stops === 1, '81 estoura o stop');

  const baixo = auditar([{ estatisticas: { xg: 0.2, finalizacoes: 8, noAlvo: 2 }, gols: [], ligaId: 39 }]);
  assert(baixo.qualificados === 0, 'volume baixo fica de fora');

  console.log('self-test ok');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  if (!fs.existsSync(CACHE_PATH)) {
    console.error('Cache ausente. Nenhuma requisição foi feita.');
    process.exitCode = 1;
    return;
  }
  const cache = lerCache();
  const faltam = (cache.ordem || []).filter((id) => !completo(cache.jogos[id])).length;
  let execucao = { n: 0, parar: null };
  if (faltam > 0 || amostra(cache).length < META) {
    const chave = lerChave();
    if (!chave) {
      console.error('API_FOOTBALL_KEY ausente no .env. O cache não foi alterado.');
      process.exitCode = 1;
      return;
    }
    execucao = await completar(cache, chave);
  } else {
    console.log('[backtest] amostra já completa | 0 requisições');
  }
  imprimirRelatorio(cache, execucao);
}

const direto = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (direto) {
  main().catch((erro) => {
    console.error(erro?.message || 'Falha no backtest');
    process.exitCode = 1;
  });
}
