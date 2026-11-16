/**
 * Pesquisa da zebra vencendo por 1 gol aos 60'.
 *
 *   node --env-file=.env scripts/backtestZebra100.js
 *   node scripts/backtestZebra100.js --self-test
 *
 * Reusa scripts/cache_backtest_100.json e grava scripts/cache_backtest_zebra.json.
 * Não repete events, odds nem estatísticas já salvos. Teto de 250 requisições
 * nesta execução. Para se x-ratelimit-requests-remaining ficar abaixo de 1500.
 * Uma reexecução com o cache fechado não chama a API.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(PASTA, 'cache_backtest_zebra.json');
const CACHE_BASE = path.join(PASTA, 'cache_backtest_100.json');
const ENV_PATH = path.resolve(PASTA, '../.env');
const BASE = 'https://v3.football.api-sports.io';

const META = 100;
const TETO_EXECUCAO = 250;
const PISO_SALDO = 1500;
const STAKE = 4;
const LUCRO_GREEN = 2.08;
const CASHOUT_80 = -1.85;

const LIGAS = [
  { id: 39, nome: 'Premier League' },
  { id: 140, nome: 'LaLiga' },
  { id: 141, nome: 'LaLiga 2' },
  { id: 135, nome: 'Serie A' },
  { id: 78, nome: 'Bundesliga' },
  { id: 88, nome: 'Eredivisie' },
  { id: 2, nome: 'Champions League' },
  { id: 71, nome: 'Brasileirão' }
];
const IDS_CLUBES = new Set(LIGAS.map((liga) => liga.id));

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

function cacheVazio() {
  return {
    requisicoes: 0,
    remaining: null,
    fechado: false,
    motivo: null,
    temporada: 2026,
    listas: [],
    jogos: {}
  };
}

function lerJson(arquivo) {
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

function lerCache() {
  if (!fs.existsSync(CACHE_PATH)) return cacheVazio();
  const salvo = lerJson(CACHE_PATH);
  return { ...cacheVazio(), ...salvo, jogos: salvo.jogos || {} };
}

function gravarCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
}

function numero(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(String(valor).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
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

function umGol(placar) {
  return (placar.casa === 0 && placar.fora === 1) || (placar.casa === 1 && placar.fora === 0);
}

function favoritoDe(odds) {
  const casa = numero(odds?.casa);
  const fora = numero(odds?.fora);
  if (casa == null || fora == null || casa === fora) return null;
  return casa < fora ? 'casa' : 'fora';
}

function favoritoPorTabela(jogo, tabelas) {
  const tabela = tabelas?.[jogo?.ligaId] || tabelas?.[String(jogo?.ligaId)];
  if (!tabela) return null;
  const casa = tabela[jogo.casaId] || tabela[String(jogo.casaId)];
  const fora = tabela[jogo.foraId] || tabela[String(jogo.foraId)];
  if (!casa || !fora) return null;
  if (casa.pontos != null && fora.pontos != null && casa.pontos !== fora.pontos) {
    return casa.pontos > fora.pontos ? 'casa' : 'fora';
  }
  if (casa.rank != null && fora.rank != null && casa.rank !== fora.rank) {
    return casa.rank < fora.rank ? 'casa' : 'fora';
  }
  return null;
}

function ladoFavorito(jogo, tabelas) {
  return favoritoDe(jogo?.odds) || favoritoPorTabela(jogo, tabelas);
}

function tipoZebra(jogo, tabelas) {
  if (!Array.isArray(jogo?.gols)) return null;
  const placar = placarAte(jogo.gols, 60);
  const favorito = ladoFavorito(jogo, tabelas);
  if (favorito === 'casa' && placar.casa === 0 && placar.fora === 1) return 'z2';
  if (favorito === 'fora' && placar.casa === 1 && placar.fora === 0) return 'z3';
  return null;
}

function pressaoDoFavorito(jogo, tipo) {
  const lado = tipo === 'z2' ? jogo.lados?.casa : jogo.lados?.fora;
  if (!lado || lado.posse == null || lado.noAlvo == null) return false;
  return lado.posse >= 55 && lado.noAlvo >= 5;
}

function golDepois(gols, minimoExclusivo, maximo) {
  return (gols || []).some((gol) => gol.minuto > minimoExclusivo && gol.minuto <= maximo);
}

function liquidar(gols) {
  if (golDepois(gols, 60, 80)) return { green: true, lucro: LUCRO_GREEN };
  return { green: false, lucro: CASHOUT_80 };
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

function zebras(cache) {
  const tabelas = cache.tabelas || {};
  return Object.values(cache.jogos)
    .map((jogo) => ({ jogo, tipo: tipoZebra(jogo, tabelas) }))
    .filter((item) => item.tipo)
    .sort((a, b) => String(b.jogo.data).localeCompare(String(a.jogo.data)));
}

function auditar(lista) {
  const livros = { z1: livroVazio(), z2: livroVazio(), z3: livroVazio(), z4: livroVazio() };
  for (const item of lista) {
    const resultado = liquidar(item.jogo.gols);
    somar(livros.z1, resultado);
    somar(livros[item.tipo], resultado);
    if (pressaoDoFavorito(item.jogo, item.tipo)) somar(livros.z4, resultado);
  }
  return livros;
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
    nome.padEnd(54),
    String(item.entradas).padStart(8),
    String(item.greens).padStart(7),
    String(item.stops).padStart(6),
    pct(item.taxa).padStart(8),
    dinheiro(item.lucro).padStart(16),
    pct(item.roi).padStart(8)
  ].join(' ');
}

function imprimirRelatorio(cache, execucao) {
  const lista = zebras(cache).slice(0, META);
  const livros = auditar(lista);
  const mix = {};
  for (const item of lista) {
    mix[item.jogo.liga || 'Sem liga'] = (mix[item.jogo.liga || 'Sem liga'] || 0) + 1;
  }
  const textoMix = Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([nome, qtd]) => `${nome} ${qtd}`).join(' | ');
  const comPosse = lista.filter((item) => pressaoDoFavorito(item.jogo, item.tipo) || item.jogo.lados).length;
  console.log('');
  console.log(execucao?.n ? `[backtest] coleta zebra | ${execucao.n} requisições` : '[backtest] cache zebra | 0 requisições');
  console.log(`Zebras aos 60' reunidas: ${lista.length}/${META} | Saldo visto: ${cache.remaining ?? '—'} | Parada: ${execucao?.parar || cache.motivo || 'amostra pronta'}`);
  if (textoMix) console.log(`Composição: ${textoMix}`);
  console.log('Favorito = menor odd pré-jogo no 1X2. Sem odd na API, vale quem tem mais pontos na tabela atual. Zebra = o outro time, vencendo por exatamente 1 gol aos 60\'.');
  console.log('Stake US$ 4,00 | Odd 1,52 | Gol de 61\' a 80\' = +US$ 2,08 | Sem gol até 80\' = −US$ 1,85');
  console.log('Z4 usa posse e chutes no alvo do favorito que está perdendo. O retrato é o do jogo inteiro, não o dos 60\'.');
  console.log('');
  const traco = '-'.repeat(112);
  console.log(traco);
  console.log([
    'Cenário'.padEnd(54),
    'Entradas'.padStart(8),
    'Greens'.padStart(7),
    'Stops'.padStart(6),
    'Acerto'.padStart(8),
    'Lucro líquido'.padStart(16),
    'ROI'.padStart(8)
  ].join(' '));
  console.log(traco);
  console.log(linhaTabela('Z1 Zebra vencendo por 1 gol (Stop 80\')', livros.z1));
  console.log(linhaTabela('Z2 Favorito mandante perdendo de 0x1', livros.z2));
  console.log(linhaTabela('Z3 Favorito visitante perdendo de 1x0', livros.z3));
  console.log(linhaTabela('Z4 Favorito perdendo com posse >= 55% e >= 5 no alvo', livros.z4));
  console.log(traco);

  const z1 = metricas(livros.z1);
  const z4 = metricas(livros.z4);
  const recortes = [
    ['Z1', metricas(livros.z1)],
    ['Z2', metricas(livros.z2)],
    ['Z3', metricas(livros.z3)],
    ['Z4', metricas(livros.z4)]
  ].filter(([, item]) => item.entradas > 0);
  console.log('');
  if (!z1.entradas) {
    console.log('Veredito: descartar o Método C. Esta execução não fechou nenhuma zebra com odd pré-jogo.');
  } else if (z1.lucro > 0 && z1.entradas >= 30) {
    const melhor = recortes.reduce((atual, item) => (item[1].lucro > atual[1].lucro ? item : atual));
    console.log(`Veredito: o Método C tem sinal positivo. ${melhor[0]} maximiza o lucro (${dinheiro(melhor[1].lucro)}, ROI ${melhor[1].roi.toFixed(1)}%, ${melhor[1].entradas} entradas).`);
  } else if (z1.lucro > 0) {
    console.log(`Veredito: o ROI de Z1 é positivo (${dinheiro(z1.lucro)}, ${z1.roi.toFixed(1)}% em ${z1.entradas} entradas), mas a amostra não sustenta criar o Método C.`);
  } else {
    console.log(`Veredito: descartar o Método C. Z1 fecha em ${dinheiro(z1.lucro)} (ROI ${z1.roi.toFixed(1)}%, acerto ${z1.taxa.toFixed(1)}% em ${z1.entradas} entradas).`);
  }
  if (z4.entradas && z1.entradas) {
    console.log(`Com pressão do favorito (Z4): ${dinheiro(z4.lucro)} em ${z4.entradas} entradas, ROI ${z4.roi.toFixed(1)}%.`);
  } else if (lista.length && comPosse < lista.length) {
    console.log('Parte das zebras ainda não tem posse e chutes por time, então Z4 só entra com o retrato completo.');
  }
  console.log('Equilíbrio do Stop 80\': mais de 47,1% de greens.');
  if (lista.length < META) {
    console.log(`A meta de ${META} zebras não coube no teto de ${TETO_EXECUCAO} requisições. O cache guarda o que já foi lido.`);
  }
  console.log('');
}

function podePedir(cache, execucao) {
  if (execucao.n >= TETO_EXECUCAO) {
    execucao.parar = 'teto-250';
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
  if (resposta.status === 429 || !resposta.ok) {
    if (resposta.status === 429) execucao.parar = '429';
    else console.warn(`[backtest] falha ${resposta.status} em ${caminho.split('?')[0]}`);
    gravarCache(cache);
    return null;
  }
  const erros = corpo?.errors;
  const temErro = Array.isArray(erros) ? erros.length > 0 : Boolean(erros && typeof erros === 'object' && Object.keys(erros).length);
  if (temErro) {
    console.warn(`[backtest] resposta com erro em ${caminho.split('?')[0]}`);
    return null;
  }
  if (Number.isFinite(remaining) && remaining < PISO_SALDO) execucao.parar = 'saldo-baixo';
  return corpo;
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

function lerOdds(corpo) {
  const livros = Array.isArray(corpo?.response?.[0]?.bookmakers) ? corpo.response[0].bookmakers : [];
  for (const livro of livros) {
    const apostas = Array.isArray(livro?.bets) ? livro.bets : [];
    const mercado = apostas.find((aposta) => /match winner|vencedor do jogo|^1x2$/i.test(String(aposta?.name || '')));
    if (!mercado) continue;
    const valores = Array.isArray(mercado.values) ? mercado.values : [];
    const ler = (...nomes) => {
      const item = valores.find((valor) => nomes.includes(String(valor?.value || '').toLowerCase()));
      const odd = Number(item?.odd);
      return odd > 1 ? odd : null;
    };
    const casa = ler('home', '1');
    const fora = ler('away', '2');
    if (casa && fora) return { casa, fora, empate: ler('draw', 'x') };
  }
  return { casa: null, fora: null, empate: null };
}

function lerStat(lista, nomes) {
  const alvo = new Set(nomes.map((nome) => nome.toLowerCase()));
  const item = (lista || []).find((stat) => alvo.has(String(stat?.type || '').toLowerCase()));
  return item ? numero(item.value) : null;
}

function lerLados(corpo, jogo) {
  const lados = {
    casa: { posse: null, noAlvo: null },
    fora: { posse: null, noAlvo: null }
  };
  for (const time of corpo?.response || []) {
    const id = time?.team?.id;
    const lado = id === jogo.casaId ? 'casa' : id === jogo.foraId ? 'fora' : null;
    if (!lado) continue;
    const stats = time.statistics || [];
    lados[lado] = {
      posse: lerStat(stats, ['Ball Possession', 'Ball possession']),
      noAlvo: lerStat(stats, ['Shots on Goal', 'Shots on Target'])
    };
  }
  return lados;
}

function normalizarFixture(item) {
  const id = item?.fixture?.id;
  if (!id || !IDS_CLUBES.has(Number(item?.league?.id))) return null;
  return {
    id,
    data: item.fixture?.date || '',
    liga: item.league?.name || '',
    ligaId: item.league?.id ?? null,
    casa: item.teams?.home?.name || '',
    fora: item.teams?.away?.name || '',
    casaId: item.teams?.home?.id ?? null,
    foraId: item.teams?.away?.id ?? null,
    gols: null,
    odds: null,
    lados: null
  };
}

function incorporar(cache, jogo) {
  const id = String(jogo.id);
  if (!cache.jogos[id]) cache.jogos[id] = { ...jogo, id: jogo.id };
  return cache.jogos[id];
}

function semear(cache) {
  if (!fs.existsSync(CACHE_BASE)) return;
  const base = lerJson(CACHE_BASE);
  for (const jogo of Object.values(base.jogos || {})) {
    if (!IDS_CLUBES.has(Number(jogo.ligaId))) continue;
    const salvo = incorporar(cache, jogo);
    if (Array.isArray(jogo.gols) && !Array.isArray(salvo.gols)) salvo.gols = jogo.gols;
    if (jogo.casaId && !salvo.casaId) salvo.casaId = jogo.casaId;
    if (jogo.foraId && !salvo.foraId) salvo.foraId = jogo.foraId;
  }
}

function lerTabela(corpo) {
  const mapa = {};
  const grupos = corpo?.response?.[0]?.league?.standings || [];
  for (const grupo of grupos) {
    for (const linha of grupo || []) {
      const id = linha?.team?.id;
      if (id == null) continue;
      mapa[String(id)] = { rank: numero(linha.rank), pontos: numero(linha.points) };
    }
  }
  return mapa;
}

async function garantirTabela(cache, ligaId, chave, execucao) {
  cache.tabelas = cache.tabelas || {};
  if (cache.tabelas[ligaId] || cache.tabelas[String(ligaId)] || execucao.parar) return;
  let corpo = await consultar(cache, `/standings?league=${ligaId}&season=2026`, chave, execucao);
  let mapa = corpo ? lerTabela(corpo) : {};
  if (!Object.keys(mapa).length && !execucao.parar) {
    corpo = await consultar(cache, `/standings?league=${ligaId}&season=2025`, chave, execucao);
    mapa = corpo ? lerTabela(corpo) : {};
  }
  cache.tabelas[String(ligaId)] = mapa;
  gravarCache(cache);
}

async function completarPressao(cache, jogo, chave, execucao) {
  if (execucao.parar || !tipoZebra(jogo, cache.tabelas) || jogo.lados) return;
  const corpo = await consultar(cache, `/fixtures/statistics?fixture=${jogo.id}`, chave, execucao);
  if (!corpo) return;
  jogo.lados = lerLados(corpo, jogo);
  gravarCache(cache);
}

async function completarJogo(cache, jogo, chave, execucao) {
  if (execucao.parar || zebras(cache).length >= META) return;
  if (!Array.isArray(jogo.gols)) {
    const corpo = await consultar(cache, `/fixtures/events?fixture=${jogo.id}`, chave, execucao);
    if (!corpo) return;
    jogo.gols = lerGols(corpo, jogo);
    gravarCache(cache);
    if (execucao.parar) return;
  }
  await completarPressao(cache, jogo, chave, execucao);
}

async function listarLiga(cache, liga, chave, execucao) {
  const chaveLista = `${liga.id}-2026`;
  if (cache.listas.includes(chaveLista) || execucao.parar) return;
  const caminho = `/fixtures?league=${liga.id}&season=2026&status=FT&from=2026-01-01&to=2026-11-16`;
  const corpo = await consultar(cache, caminho, chave, execucao);
  cache.listas.push(chaveLista);
  if (!corpo) {
    gravarCache(cache);
    return;
  }
  for (const item of corpo.response || []) {
    const jogo = normalizarFixture(item);
    if (jogo) incorporar(cache, jogo);
  }
  gravarCache(cache);
}

function fila(cache, filtro) {
  return Object.values(cache.jogos)
    .filter(filtro)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
}

async function completar(cache, chave) {
  const execucao = { n: 0, parar: null };
  cache.tabelas = cache.tabelas || {};
  semear(cache);
  gravarCache(cache);

  const ligasPresentes = [...new Set(Object.values(cache.jogos).map((jogo) => Number(jogo.ligaId)).filter((id) => IDS_CLUBES.has(id)))];
  for (const ligaId of ligasPresentes) {
    if (execucao.parar) break;
    await garantirTabela(cache, ligaId, chave, execucao);
  }

  for (const jogo of fila(cache, (item) => tipoZebra(item, cache.tabelas) && !item.lados)) {
    if (execucao.parar || zebras(cache).length >= META) break;
    await completarPressao(cache, jogo, chave, execucao);
  }

  for (const jogo of fila(cache, (item) => !Array.isArray(item.gols))) {
    if (execucao.parar || zebras(cache).length >= META) break;
    await completarJogo(cache, jogo, chave, execucao);
  }

  for (const liga of LIGAS) {
    if (execucao.parar || zebras(cache).length >= META) break;
    if (cache.listas.includes(`${liga.id}-2026`)) continue;
    await garantirTabela(cache, liga.id, chave, execucao);
    await listarLiga(cache, liga, chave, execucao);
    for (const jogo of fila(cache, (item) => !Array.isArray(item.gols))) {
      if (execucao.parar || zebras(cache).length >= META) break;
      await completarJogo(cache, jogo, chave, execucao);
    }
  }

  cache.fechado = true;
  cache.fonte = 'tabela';
  cache.motivo = execucao.parar || (zebras(cache).length >= META ? 'amostra-100' : 'pool-esgotado');
  gravarCache(cache);
  return execucao;
}

function assert(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

function selfTest() {
  const gol = (minuto, lado) => ({ minuto, extra: 0, lado });
  const jogo = (parcial) => ({
    id: parcial.id,
    gols: parcial.gols,
    odds: parcial.odds,
    lados: parcial.lados || null,
    liga: 'Premier League'
  });
  const cache = {
    remaining: 5000,
    motivo: 'teste',
    jogos: {
      1: jogo({ id: 1, gols: [gol(22, 'fora'), gol(72, 'fora')], odds: { casa: 1.4, fora: 6 }, lados: { casa: { posse: 60, noAlvo: 6 }, fora: { posse: 40, noAlvo: 2 } } }),
      2: jogo({ id: 2, gols: [gol(20, 'casa')], odds: { casa: 4.5, fora: 1.7 }, lados: { casa: { posse: 42, noAlvo: 3 }, fora: { posse: 58, noAlvo: 7 } } }),
      3: jogo({ id: 3, gols: [gol(15, 'casa')], odds: { casa: 1.5, fora: 5 } }),
      4: jogo({ id: 4, gols: [gol(12, 'casa'), gol(30, 'casa')], odds: { casa: 1.3, fora: 8 } }),
      5: jogo({ id: 5, gols: [gol(18, 'fora')], odds: { casa: 2.1, fora: 2.1 } }),
      6: jogo({ id: 6, gols: [gol(25, 'fora'), gol(81, 'casa')], odds: { casa: 1.6, fora: 4.2 }, lados: { casa: { posse: 54, noAlvo: 8 }, fora: { posse: 46, noAlvo: 1 } } })
    }
  };
  const lista = zebras(cache);
  assert(lista.length === 3, 'só as três zebras entram');
  const livros = auditar(lista);
  assert(livros.z2.entradas === 2 && livros.z2.greens === 1 && livros.z2.stops === 1, 'Z2 tem um green e um stop');
  assert(livros.z3.entradas === 1 && livros.z3.stops === 1, 'Z3 é o favorito visitante sem gol depois');
  assert(livros.z1.entradas === 3, 'Z1 soma Z2 e Z3');
  assert(metricas(livros.z1).lucro === Number((2.08 - 1.85 - 1.85).toFixed(2)), 'lucro 2,08 menos dois stops');
  assert(livros.z4.entradas === 2 && livros.z4.greens === 1 && livros.z4.stops === 1, 'Z4 exige 55% e 5 no alvo do favorito');
  assert(tipoZebra(cache.jogos[3]) === null, 'favorito vencendo não é zebra');
  assert(tipoZebra(cache.jogos[4]) === null, 'dois gols de diferença ficam de fora');
  assert(tipoZebra(cache.jogos[5]) === null, 'odd igual não define favorito');
  const soTabela = {
    gols: [gol(10, 'fora')],
    odds: { casa: null, fora: null, empate: null },
    ligaId: 39,
    casaId: 10,
    foraId: 20
  };
  assert(tipoZebra(soTabela, { 39: { 10: { rank: 2, pontos: 30 }, 20: { rank: 8, pontos: 18 } } }) === 'z2', 'tabela define o mandante favorito');
  const no80 = liquidar([gol(80, 'casa')]);
  const no81 = liquidar([gol(81, 'casa')]);
  assert(no80.green && no81.green === false, '80 inclusive é green e 81 é stop');
  console.log('self-test ok');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const cache = lerCache();
  let execucao = { n: 0, parar: null };
  if (!(cache.fechado && cache.fonte === 'tabela')) {
    const chave = lerChave();
    if (!chave) {
      console.error('API_FOOTBALL_KEY ausente no .env. Nenhuma requisição foi feita.');
      process.exitCode = 1;
      return;
    }
    execucao = await completar(cache, chave);
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
