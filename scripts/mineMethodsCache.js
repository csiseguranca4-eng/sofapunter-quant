/**
 * Minera hipóteses em cima dos caches locais.
 * Não faz nenhuma chamada HTTP.
 *
 *   node scripts/mineMethodsCache.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const CACHE_100 = path.join(PASTA, 'cache_backtest_100.json');
const CACHE_ZEBRA = path.join(PASTA, 'cache_backtest_zebra.json');

const STAKE = 4;
const STAKE_F = 2;
const GREEN_C = 2.4;
const STOP_80 = -1.85;
const RED_FT = -4;
const GREEN_D = 2.2;
const GREEN_E = 1.8;
const GREEN_F = 2.6;
const RED_F = -2;
const AMOSTRA_RELEVANTE = 20;

function lerJogos(arquivo) {
  if (!fs.existsSync(arquivo)) return [];
  const salvo = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return Object.values(salvo.jogos || {});
}

function unir(atual, novo) {
  if (!atual) return { ...novo };
  const gols = Array.isArray(novo?.gols) ? novo.gols : atual.gols;
  const statsAtual = atual.estatisticas;
  const statsNovo = novo?.estatisticas;
  const estatisticas = statsAtual?.xg != null || statsAtual?.noAlvo != null
    ? statsAtual
    : (statsNovo || statsAtual || null);
  return {
    ...atual,
    ...novo,
    id: atual.id || novo.id,
    gols: Array.isArray(gols) ? gols : null,
    estatisticas,
    lados: atual.lados || novo?.lados || null,
    cartoes: atual.cartoes || novo?.cartoes || null
  };
}

function unificar() {
  const mapa = new Map();
  for (const jogo of [...lerJogos(CACHE_100), ...lerJogos(CACHE_ZEBRA)]) {
    const id = String(jogo?.id || '');
    if (!id) continue;
    mapa.set(id, unir(mapa.get(id), jogo));
  }
  return [...mapa.values()];
}

function placarAte(gols, minuto) {
  let casa = 0;
  let fora = 0;
  let semLado = 0;
  for (const gol of gols || []) {
    if (gol.minuto > minuto) continue;
    if (gol.lado === 'casa') casa += 1;
    else if (gol.lado === 'fora') fora += 1;
    else semLado += 1;
  }
  return { casa, fora, total: casa + fora + semLado, semLado };
}

function golsNoIntervalo(gols, inicio, fim) {
  return (gols || []).filter((gol) => gol.minuto >= inicio && gol.minuto <= fim);
}

function teveGolDepois(gols, minimoExclusivo, maximo) {
  return (gols || []).some((gol) => gol.minuto > minimoExclusivo && (maximo == null || gol.minuto <= maximo));
}

function volume(jogo) {
  let noAlvo = jogo.estatisticas?.noAlvo ?? null;
  if (noAlvo == null && jogo.lados?.casa && jogo.lados?.fora) {
    const casa = jogo.lados.casa.noAlvo;
    const fora = jogo.lados.fora.noAlvo;
    if (casa != null && fora != null) noAlvo = casa + fora;
  }
  return { xg: jogo.estatisticas?.xg ?? null, noAlvo };
}

function volumeAlto(jogo) {
  const item = volume(jogo);
  return (item.xg != null && item.xg >= 1.5) || (item.noAlvo != null && item.noAlvo >= 5);
}

function volumeBaixo(jogo) {
  const item = volume(jogo);
  return item.xg != null && item.noAlvo != null && item.noAlvo <= 4 && item.xg < 1.3;
}

function vermelhos(jogo) {
  const lista = []
    .concat(jogo.cartoes || [])
    .concat(jogo.eventos || [])
    .concat(jogo.events || []);
  return lista.filter((evento) => {
    const tipo = String(evento?.type || evento?.tipo || '');
    const detalhe = String(evento?.detail || evento?.detalhe || '');
    const minuto = Number(evento?.minuto ?? evento?.time?.elapsed);
    return /card/i.test(tipo) && /red/i.test(detalhe) && Number.isFinite(minuto);
  }).map((evento) => ({ minuto: Number(evento.minuto ?? evento.time?.elapsed) }));
}

function livroVazio() {
  return { entradas: 0, greens: 0, stops: 0, lucro: 0, stake: STAKE };
}

function somar(livro, green, lucro) {
  livro.entradas += 1;
  livro.lucro += lucro;
  if (green) livro.greens += 1;
  else livro.stops += 1;
}

function metricas(livro) {
  const apostado = livro.entradas * livro.stake;
  const taxa = livro.entradas ? (livro.greens / livro.entradas) * 100 : null;
  const roi = apostado ? (livro.lucro / apostado) * 100 : null;
  return { ...livro, lucro: Number(livro.lucro.toFixed(2)), taxa, roi };
}

function simular(jogos) {
  const livros = {
    c80: { ...livroVazio() },
    cft: { ...livroVazio() },
    d: { ...livroVazio() },
    e: { ...livroVazio() },
    f: { ...livroVazio(), stake: STAKE_F }
  };
  let comGols = 0;
  let comCartao = 0;
  for (const jogo of jogos) {
    if (!Array.isArray(jogo.gols)) continue;
    comGols += 1;
    const cartoes = vermelhos(jogo).filter((cartao) => cartao.minuto >= 35 && cartao.minuto <= 70);
    if (cartoes.length) comCartao += 1;
    const cartao = cartoes.find((item) => {
      const placar = placarAte(jogo.gols, item.minuto);
      return placar.semLado === 0 && Math.abs(placar.casa - placar.fora) <= 1;
    });
    if (cartao) {
      const green80 = teveGolDepois(jogo.gols, cartao.minuto, 80);
      const greenFt = teveGolDepois(jogo.gols, cartao.minuto, null);
      somar(livros.c80, green80, green80 ? GREEN_C : STOP_80);
      somar(livros.cft, greenFt, greenFt ? GREEN_C : RED_FT);
    }

    const cedo = golsNoIntervalo(jogo.gols, 1, 30);
    const seca = golsNoIntervalo(jogo.gols, 31, 60);
    const aos60 = placarAte(jogo.gols, 60);
    const umAZero = (aos60.casa === 1 && aos60.fora === 0) || (aos60.casa === 0 && aos60.fora === 1);
    if (cedo.length === 1 && seca.length === 0 && umAZero && aos60.semLado === 0 && volumeAlto(jogo)) {
      const green = teveGolDepois(jogo.gols, 60, 80);
      somar(livros.d, green, green ? GREEN_D : STOP_80);
    }

    if (aos60.casa === 0 && aos60.fora === 0 && aos60.semLado === 0 && volumeBaixo(jogo)) {
      const final = placarAte(jogo.gols, 130);
      const green = final.total <= 1;
      somar(livros.e, green, green ? GREEN_E : RED_FT);
    }

    const aos75 = placarAte(jogo.gols, 75);
    const empateCurto = aos75.semLado === 0 && (
      (aos75.casa === 0 && aos75.fora === 0) || (aos75.casa === 1 && aos75.fora === 1)
    );
    if (empateCurto && volumeAlto(jogo)) {
      const green = teveGolDepois(jogo.gols, 75, null);
      somar(livros.f, green, green ? GREEN_F : RED_F);
    }
  }
  return { livros, comGols, comCartao };
}

function dinheiro(valor) {
  const sinal = valor < 0 ? '-' : '';
  return `${sinal}US$ ${Math.abs(valor).toFixed(2).replace('.', ',')}`;
}

function pct(valor) {
  if (valor == null) return '    —';
  return `${valor.toFixed(1)}%`.padStart(6);
}

function linha(nome, livro) {
  const item = metricas(livro);
  return [
    nome.padEnd(42),
    String(item.entradas).padStart(8),
    String(item.greens).padStart(7),
    String(item.stops).padStart(11),
    pct(item.taxa).padStart(8),
    dinheiro(item.lucro).padStart(16),
    pct(item.roi).padStart(8)
  ].join(' ');
}

function imprimir(jogos, resultado) {
  const { livros, comGols, comCartao } = resultado;
  console.log('');
  console.log('[mineração] caches locais | 0 requisições');
  console.log(`Jogos únicos: ${jogos.length} | Com events de gol: ${comGols} | Com cartão vermelho gravado: ${comCartao}`);
  console.log('C: odd 1,60 na stake 4 → green +US$ 2,40. D: odd 1,55 → +US$ 2,20. E: odd 1,45 → +US$ 1,80. F: meia stake US$ 2,00 na odd 2,30 → +US$ 2,60.');
  console.log('xG e chutes no alvo são o retrato do jogo inteiro. O filtro enxerga o que aconteceu depois da entrada.');
  console.log('');
  const traco = '-'.repeat(104);
  console.log(traco);
  console.log([
    'Método'.padEnd(42),
    'Entradas'.padStart(8),
    'Greens'.padStart(7),
    'Stops/Reds'.padStart(11),
    'Acerto'.padStart(8),
    'Lucro líquido'.padStart(16),
    'ROI'.padStart(8)
  ].join(' '));
  console.log(traco);
  console.log(linha('C Cartão vermelho • Stop 80\'', livros.c80));
  console.log(linha('C Cartão vermelho • Full time 90\'+', livros.cft));
  console.log(linha('D Gol cedo + seca até 60\' • Stop 80\'', livros.d));
  console.log(linha('E Under 1.5 no 0x0 morno', livros.e));
  console.log(linha('F Over 75\'–90\'+ no 0x0/1x1 • meia stake', livros.f));
  console.log(traco);
  if (!comCartao) {
    console.log('Método C não tem amostra: os caches guardaram só gols, não o evento Card / Red Card.');
  }
  console.log('');
  const candidatos = [
    ['C Stop 80\'', livros.c80],
    ['C Full time', livros.cft],
    ['D Gol cedo', livros.d],
    ['E Under 1.5', livros.e],
    ['F Tiro curto', livros.f]
  ];
  const prontos = candidatos.filter(([, livro]) => {
    const item = metricas(livro);
    return item.entradas >= AMOSTRA_RELEVANTE && item.roi != null && item.roi > 5;
  });
  if (!prontos.length) {
    console.log(`Nenhum método junta ROI acima de +5% e pelo menos ${AMOSTRA_RELEVANTE} entradas. Não há base para acrescentar regra no liveMonitor.js.`);
  } else {
    for (const [nome, livro] of prontos) {
      const item = metricas(livro);
      console.log(`${nome}: ROI ${item.roi.toFixed(1)}% em ${item.entradas} entradas (${dinheiro(item.lucro)}). Candidato a uma validação ao vivo, ainda com o volume do jogo inteiro.`);
    }
  }
  const finos = candidatos.filter(([, livro]) => {
    const item = metricas(livro);
    return item.entradas > 0 && item.entradas < AMOSTRA_RELEVANTE && item.roi != null && item.roi > 5;
  });
  for (const [nome, livro] of finos) {
    const item = metricas(livro);
    console.log(`${nome} passa de +5% (${item.roi.toFixed(1)}%), mas só tem ${item.entradas} entradas.`);
  }
  console.log('');
}

const jogos = unificar();
imprimir(jogos, simular(jogos));
