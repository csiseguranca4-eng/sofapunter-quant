/**
 * Audita 100 jogos FT empatados aos 55' (0x0 ou 1x1, xG >= 1,50 e >= 5 no alvo).
 *
 *   node scripts/backtest_100_empatados.js
 *   node scripts/backtest_100_empatados.js --self-test
 *
 * Lê o cache local antes de qualquer chamada. Usa services/apiFootball.js
 * (piso de segurança: saldo abaixo de 400). Para ao completar 100 qualificados
 * ou quando o saldo diário fica abaixo de 450.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CACHES_LOCAIS = [
  path.join(PASTA, 'cache_backtest_100.json'),
  path.join(PASTA, 'cache_backtest_zebra.json'),
  path.join(PASTA, 'cache_backtest_empatados.json')
];
const CACHE_PROPRIO = CACHES_LOCAIS[2];

const META = 100;
const PISO_SALDO = 450;
const STAKE = 4;
const LUCRO_GREEN = 2;
const STOP_80 = -1.8;
const XG_MIN = 1.5;
const NO_ALVO_MIN = 5;
const TEMPORADA = 2026;

const LIGAS = [
  { id: 39, nome: 'Premier League', grupo: 'top5' },
  { id: 140, nome: 'La Liga', grupo: 'top5' },
  { id: 135, nome: 'Serie A', grupo: 'top5' },
  { id: 78, nome: 'Bundesliga', grupo: 'top5' },
  { id: 61, nome: 'Ligue 1', grupo: 'top5' },
  { id: 2, nome: 'Champions League', grupo: 'champions' },
  { id: 71, nome: 'Brasileirão', grupo: 'brasil' }
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
    if (timeId != null && timeId === casaId) lado = 'casa';
    else if (timeId != null && timeId === foraId) lado = 'fora';
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

function marcaEmpate(placar) {
  if (!placar) return null;
  if (placar.casa === 0 && placar.fora === 0) return 'A';
  if (placar.casa === 1 && placar.fora === 1) return 'A+';
  return null;
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
  const metodo = marcaEmpate(placarAte55(jogo.gols));
  const { xg, noAlvo } = volume(jogo);
  if (!metodo || xg == null || noAlvo == null || xg < XG_MIN || noAlvo < NO_ALVO_MIN) return null;
  const green = golEntre56e80(jogo.gols);
  return {
    id: jogo.id,
    data: jogo.data || '',
    ligaId: Number(jogo.ligaId),
    grupo: POR_ID.get(Number(jogo.ligaId)).grupo,
    metodo,
    green,
    lucro: green ? LUCRO_GREEN : STOP_80
  };
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
  const eventosConfiaveis = Array.isArray(item.events) && (
    ((numero(item.goals?.home) || 0) + (numero(item.goals?.away) || 0)) === 0
    || golsDeEventos(item.events, casaId, foraId).length > 0
  );
  return {
    id,
    data: item.fixture?.date || '',
    liga: item.league?.name || POR_ID.get(ligaId).nome,
    ligaId,
    casa: item.teams?.home?.name || '',
    fora: item.teams?.away?.name || '',
    casaId,
    foraId,
    gols: eventosConfiaveis ? golsDeEventos(item.events, casaId, foraId) : null,
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
}

function lerCaches() {
  const mapa = new Map();
  for (const arquivo of CACHES_LOCAIS) {
    const json = lerJson(arquivo);
    for (const jogo of Object.values(json?.jogos || {})) mesclar(mapa, jogo);
  }
  return mapa;
}

function gravarProprio(mapa) {
  const jogos = {};
  for (const [id, jogo] of mapa) jogos[id] = jogo;
  fs.writeFileSync(CACHE_PROPRIO, JSON.stringify({ jogos, temporada: TEMPORADA }));
}

function livroVazio() {
  return { entradas: 0, greens: 0, stops: 0, lucro: 0 };
}

function somar(livro, item) {
  livro.entradas += 1;
  livro.lucro += item.lucro;
  if (item.green) livro.greens += 1;
  else livro.stops += 1;
}

function metricas(livro) {
  const apostado = livro.entradas * STAKE;
  return {
    ...livro,
    lucro: Number(livro.lucro.toFixed(2)),
    taxa: livro.entradas ? (livro.greens / livro.entradas) * 100 : null,
    roi: apostado ? (livro.lucro / apostado) * 100 : null
  };
}

function dinheiro(valor) {
  const n = Number(valor) || 0;
  const sinal = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sinal}US$ ${Math.abs(n).toFixed(2).replace('.', ',')}`;
}

function pct(valor) {
  if (valor == null) return '—';
  const sinal = valor > 0 ? '+' : '';
  return `${sinal}${valor.toFixed(1).replace('.', ',')}%`;
}

function imprimirLivro(titulo, livro) {
  const m = metricas(livro);
  console.log(titulo);
  console.log(`  Jogos: ${m.entradas} | Greens: ${m.greens} | Stops: ${m.stops}`);
  console.log(`  Taxa de acerto: ${m.taxa == null ? '—' : `${m.taxa.toFixed(1).replace('.', ',')}%`} | Lucro líquido: ${dinheiro(m.lucro)} | ROI: ${pct(m.roi)}`);
}

function relatorio(amostra, extra) {
  const geral = livroVazio();
  const a = livroVazio();
  const aMais = livroVazio();
  const top5 = livroVazio();
  const brasil = livroVazio();
  const champions = livroVazio();
  for (const item of amostra) {
    somar(geral, item);
    somar(item.metodo === 'A+' ? aMais : a, item);
    if (item.grupo === 'top5') somar(top5, item);
    else if (item.grupo === 'brasil') somar(brasil, item);
    else somar(champions, item);
  }
  console.log('');
  console.log(`Método A/A+ — ${amostra.length} jogos empatados aos 55'`);
  console.log('Stake US$ 4,00 | Odd est. 1,50 | GREEN +US$ 2,00 se gol entre 56\' e 80\' | STOP 80\' -US$ 1,80');
  console.log('xG e chutes no alvo são o agregado da partida (a API não devolve o recorte dos 55\').');
  console.log('');
  imprimirLivro('Total geral', geral);
  console.log('');
  imprimirLivro('Método A+ (1x1 aos 55\')', aMais);
  imprimirLivro('Método A (0x0 aos 55\')', a);
  console.log('');
  imprimirLivro('Top 5 Europa', top5);
  imprimirLivro('Brasileirão', brasil);
  imprimirLivro('Champions League', champions);
  console.log('');
  console.log(`Requisições nesta execução: ${extra.requisicoes} | Motivo: ${extra.motivo}`);
  if (extra.saldo) console.log(`Saldo diário ao encerrar: ${extra.saldo.remaining}/${extra.saldo.limit}`);
}

function qualificadosDe(mapa) {
  return [...mapa.values()]
    .map(qualifica)
    .filter(Boolean)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || Number(b.id) - Number(a.id));
}

function criarConsulta(pedir) {
  const estado = { requisicoes: 0, saldo: null, motivo: null, pedidos: new Set() };
  const logOriginal = console.log;
  console.log = (...args) => {
    const texto = args.map((item) => String(item)).join(' ');
    const achado = texto.match(/Saldo real: (\d+)\/(\d+)/);
    if (achado) estado.saldo = { remaining: Number(achado[1]), limit: Number(achado[2]) };
    logOriginal(...args);
  };
  async function consultar(caminho) {
    if (estado.motivo) return null;
    if (estado.saldo && estado.saldo.remaining < PISO_SALDO) {
      estado.motivo = 'saldo-proximo-do-piso';
      return null;
    }
    if (estado.pedidos.has(caminho)) return null;
    estado.pedidos.add(caminho);
    try {
      const corpo = await pedir(caminho);
      estado.requisicoes += 1;
      if (estado.saldo && estado.saldo.remaining < PISO_SALDO) estado.motivo = 'saldo-proximo-do-piso';
      return corpo;
    } catch (erro) {
      if (/pausada até o reset|saldo abaixo de 400|429/i.test(String(erro?.message || erro))) {
        estado.motivo = 'saldo-abaixo-de-400';
        return null;
      }
      logOriginal(`Falha em ${caminho}: ${erro?.message || erro}`);
      return null;
    }
  }
  return { estado, consultar, restaurarLog: () => { console.log = logOriginal; } };
}

function jogosDaLista(corpo) {
  return (Array.isArray(corpo?.response) ? corpo.response : [])
    .map(normalizarFixture)
    .filter(Boolean)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
}

async function listarRecentes(liga, consultar, quantidade) {
  const corpo = await consultar(`/fixtures?league=${liga.id}&season=${TEMPORADA}&last=${quantidade}`);
  return jogosDaLista(corpo);
}

function janelasAntigas() {
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

function intercalar(listas) {
  const cursores = listas.map(() => 0);
  const saida = [];
  let avançou = true;
  while (avançou) {
    avançou = false;
    for (let i = 0; i < listas.length; i += 1) {
      if (cursores[i] < listas[i].length) {
        saida.push(listas[i][cursores[i]]);
        cursores[i] += 1;
        avançou = true;
      }
    }
  }
  return saida;
}

async function completar(jogo, consultar, estado) {
  if (!Array.isArray(jogo.gols) && !estado.motivo) {
    const corpo = await consultar(`/fixtures?id=${jogo.id}`);
    const item = corpo?.response?.[0];
    if (item) {
      const cheio = normalizarFixture(item);
      if (cheio?.gols) jogo.gols = cheio.gols;
      if (cheio?.estatisticas) jogo.estatisticas = cheio.estatisticas;
    }
  }
  const metodo = Array.isArray(jogo.gols) ? marcaEmpate(placarAte55(jogo.gols)) : null;
  const { xg, noAlvo } = volume(jogo);
  if (metodo && (xg == null || noAlvo == null) && !estado.motivo) {
    const corpo = await consultar(`/fixtures/statistics?fixture=${jogo.id}`);
    const stats = estatisticasDe(corpo);
    if (stats) jogo.estatisticas = { ...(jogo.estatisticas || {}), ...stats };
  }
  return jogo;
}

async function main() {
  const mapa = lerCaches();
  let amostra = qualificadosDe(mapa).slice(0, META);
  console.log(`Cache local qualificado nas ligas do protocolo: ${qualificadosDe(mapa).length}`);
  if (amostra.length >= META) {
    relatorio(amostra, { requisicoes: 0, motivo: 'cache-100', saldo: null });
    return;
  }
  const { pedir } = require('../services/apiFootball.js');

  const { estado, consultar, restaurarLog } = criarConsulta(pedir);
  try {
    const visitar = async (candidato) => {
      if (estado.motivo || qualificadosDe(mapa).length >= META) return;
      const chave = String(candidato.id);
      if (!mapa.has(chave)) mapa.set(chave, candidato);
      const jogo = mapa.get(chave);
      if (!jogo.data && candidato.data) jogo.data = candidato.data;
      if (!Array.isArray(jogo.gols) && Array.isArray(candidato.gols)) jogo.gols = candidato.gols;
      const vol = volume(jogo);
      const jaResolvido = Array.isArray(jogo.gols) && (
        marcaEmpate(placarAte55(jogo.gols)) == null || (vol.xg != null && vol.noAlvo != null)
      );
      if (!jaResolvido) await completar(jogo, consultar, estado);
    };
    const listas = [];
    for (const liga of LIGAS) {
      if (estado.motivo || qualificadosDe(mapa).length >= META) break;
      listas.push(await listarRecentes(liga, consultar, 99));
    }
    for (const candidato of intercalar(listas)) await visitar(candidato);
    if (qualificadosDe(mapa).length < META && !estado.motivo) {
      for (const [de, ate] of janelasAntigas()) {
        if (estado.motivo || qualificadosDe(mapa).length >= META) break;
        const fatias = [];
        for (const liga of LIGAS) {
          if (estado.motivo) break;
          const corpo = await consultar(`/fixtures?league=${liga.id}&season=${TEMPORADA}&from=${de}&to=${ate}&status=FT`);
          fatias.push(jogosDaLista(corpo));
        }
        for (const candidato of intercalar(fatias)) await visitar(candidato);
      }
    }
    gravarProprio(mapa);
    amostra = qualificadosDe(mapa).slice(0, META);
    relatorio(amostra, {
      requisicoes: estado.requisicoes,
      motivo: amostra.length >= META ? 'amostra-100' : (estado.motivo || 'sem-mais-jogos'),
      saldo: estado.saldo
    });
  } finally {
    restaurarLog();
  }
}

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

function testar() {
  const jogo = (parcial) => ({
    id: 1,
    ligaId: 39,
    data: '2026-11-01T15:00:00Z',
    gols: [],
    estatisticas: { xg: 1.5, noAlvo: 5 },
    ...parcial
  });
  const gol = (minuto, lado) => ({ minuto, extra: 0, lado });
  assert(qualifica(jogo({ gols: [gol(60, 'casa')] }))?.metodo === 'A', '0x0 aos 55 entra como A');
  assert(qualifica(jogo({ gols: [gol(60, 'casa')] }))?.green === true, 'gol aos 60 é green');
  assert(qualifica(jogo({ gols: [gol(60, 'casa')] }))?.lucro === 2, 'green paga 2');
  assert(qualifica(jogo({ gols: [gol(20, 'casa'), gol(40, 'fora'), gol(81, 'casa')] }))?.metodo === 'A+', '1x1 aos 55 é A+');
  assert(qualifica(jogo({ gols: [gol(20, 'casa'), gol(40, 'fora'), gol(81, 'casa')] }))?.lucro === -1.8, 'sem gol até 80 é stop');
  assert(qualifica(jogo({ gols: [gol(80, 'fora')] }))?.green === true, 'gol aos 80 entra');
  assert(qualifica(jogo({ gols: [gol(55, 'casa')] })) == null, 'gol aos 55 tira o 0x0');
  assert(qualifica(jogo({ gols: [gol(56, 'casa')], estatisticas: { xg: 1.49, noAlvo: 6 } })) == null, 'xg curto');
  assert(qualifica(jogo({ gols: [], estatisticas: { xg: 2, noAlvo: 4 } })) == null, 'alvo curto');
  assert(qualifica(jogo({ ligaId: 5, gols: [] })) == null, 'fora das ligas do protocolo');
  const eventos = golsDeEventos([
    { type: 'Goal', detail: 'Normal Goal', time: { elapsed: 12 }, team: { id: 1 } },
    { type: 'Goal', detail: 'Missed Penalty', time: { elapsed: 30 }, team: { id: 2 } },
    { type: 'Goal', detail: 'Own Goal', time: { elapsed: 70 }, team: { id: 1 } }
  ], 1, 2);
  assert(eventos.length === 2, 'pênalti perdido não é gol');
  assert(eventos[1].lado === 'fora', 'gol contra conta para o adversário');
  assert(placarAte55(eventos)?.casa === 1 && placarAte55(eventos)?.fora === 0, 'placar aos 55 ignora o gol dos 70');
  const livro = livroVazio();
  somar(livro, { green: true, lucro: 2 });
  somar(livro, { green: false, lucro: -1.8 });
  const m = metricas(livro);
  assert(m.lucro === 0.2 && Number(m.roi.toFixed(1)) === 2.5, 'roi sobre stake 4');
  console.log('backtest empatados ok');
}

if (process.argv.includes('--self-test')) testar();
else main().catch((erro) => {
  console.error(`Auditoria interrompida: ${erro?.message || erro}`);
  process.exitCode = 1;
});
