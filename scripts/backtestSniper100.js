/**
 * Re-simulação do cache local. Não consulta a API-Football.
 *
 *   node scripts/backtestSniper100.js
 *   node scripts/backtestSniper100.js --self-test
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(PASTA, 'cache_backtest_100.json');

const STAKE = 4;
const LUCRO_A = 2.08;
const CASHOUT_80 = -1.85;
const ODD_B = 1.25;
const LUCRO_B = Number((STAKE * (ODD_B - 1)).toFixed(2));
const CASHOUT_45 = -0.8;

const XG_MIN = 1.5;
const FINALIZACOES_MIN = 12;
const NO_ALVO_MIN = 5;

function lerCache() {
  const salvo = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  return { ...salvo, jogos: salvo.jogos || {}, ordem: salvo.ordem || [] };
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

function empateBaixo(placar) {
  return (placar.casa === 0 && placar.fora === 0) || (placar.casa === 1 && placar.fora === 1);
}

function liderandoUm(placar) {
  return (placar.casa === 1 && placar.fora === 0) || (placar.casa === 0 && placar.fora === 1);
}

function mesmoPlacar(a, b) {
  return a.casa === b.casa && a.fora === b.fora;
}

function golDepois(gols, minimoExclusivo, maximo) {
  return (gols || []).some((gol) => gol.minuto > minimoExclusivo && gol.minuto <= maximo);
}

function liquidar(gols, minimoExclusivo, maximo, lucro, perda) {
  if (golDepois(gols, minimoExclusivo, maximo)) return { green: true, lucro };
  return { green: false, lucro: perda };
}

/**
 * A/A+ entra só se o 0x0 ou o 1x1 segurou dos 55' aos 60'.
 * O green é gol depois dos 60' até os 80'. Cashout −US$ 1,85.
 * B entra aos 35' em odd 1,25. Gol até os 45' (inclui 45+) paga US$ 1,00.
 * Sem gol no intervalo, cashout −US$ 0,80.
 */
function simularJogo(gols) {
  const aos55 = placarAte(gols, 55);
  const aos60 = placarAte(gols, 60);
  const empateSegurou = empateBaixo(aos55) && mesmoPlacar(aos55, aos60);
  const metodoA = empateSegurou ? liquidar(gols, 60, 80, LUCRO_A, CASHOUT_80) : null;
  const lider = liderandoUm(aos60) ? liquidar(gols, 60, 80, LUCRO_A, CASHOUT_80) : null;
  const metodoB = liquidar(gols, 35, 45, LUCRO_B, CASHOUT_45);
  let faixa = 'fora';
  if (empateSegurou && aos60.casa === 0) faixa = '0x0';
  else if (empateSegurou) faixa = '1x1';
  else if (aos60.casa === 1 && aos60.fora === 0) faixa = '1x0';
  else if (aos60.casa === 0 && aos60.fora === 1) faixa = '0x1';
  return { metodoA, metodoB, lider, faixa };
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
    a: livroVazio(),
    b: livroVazio(),
    lider: livroVazio(),
    '0x0': livroVazio(),
    '1x1': livroVazio(),
    '1x0': livroVazio(),
    '0x1': livroVazio()
  };
  let qualificados = 0;
  for (const jogo of jogos) {
    if (!volumeOfensivo(jogo.estatisticas) || !Array.isArray(jogo.gols)) continue;
    qualificados += 1;
    const resultado = simularJogo(jogo.gols);
    somar(livros.a, resultado.metodoA);
    somar(livros.b, resultado.metodoB);
    somar(livros.lider, resultado.lider);
    if (resultado.faixa === '0x0' || resultado.faixa === '1x1') somar(livros[resultado.faixa], resultado.metodoA);
    if (resultado.faixa === '1x0' || resultado.faixa === '0x1') somar(livros[resultado.faixa], resultado.lider);
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
  const m = metricas(livro);
  return [
    nome.padEnd(46),
    String(m.entradas).padStart(8),
    String(m.greens).padStart(7),
    String(m.stops).padStart(11),
    pct(m.taxa).padStart(8),
    dinheiro(m.lucro).padStart(16),
    pct(m.roi).padStart(8)
  ].join(' ');
}

function cabecalhoTabela() {
  return [
    'Cenário'.padEnd(46),
    'Entradas'.padStart(8),
    'Greens'.padStart(7),
    'Reds/Stops'.padStart(11),
    'Acerto'.padStart(8),
    'Lucro líquido'.padStart(16),
    'ROI'.padStart(8)
  ].join(' ');
}

function jogosDoCache(cache) {
  return (cache.ordem || []).map((id) => cache.jogos[id]).filter((jogo) => jogo?.estatisticas && Array.isArray(jogo.gols));
}

function imprimirRelatorio(cache, auditoria) {
  const jogos = jogosDoCache(cache);
  const mix = {};
  for (const jogo of jogos) {
    if (!volumeOfensivo(jogo.estatisticas)) continue;
    mix[jogo.liga || 'Sem liga'] = (mix[jogo.liga || 'Sem liga'] || 0) + 1;
  }
  const textoMix = Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([nome, qtd]) => `${nome} ${qtd}`).join(' | ');
  console.log('');
  console.log('[backtest] cache local | 0 requisições');
  console.log('Método A/A+ contra o placar que lidera aos 60\', e Método B no 1º tempo');
  console.log(`Jogos com events + statistics: ${jogos.length} | Qualificados: ${auditoria.qualificados}`);
  if (textoMix) console.log(`Composição: ${textoMix}`);
  console.log('A/A+: 0x0 ou 1x1 firme dos 55\' aos 60\' | odd 1,52 | green +US$ 2,08 | sem gol até 80\' = −US$ 1,85');
  console.log('B: entrada aos 35\' | odd 1,25 | green +US$ 1,00 até 45\' | sem gol no intervalo = −US$ 0,80');
  console.log('1x0/0x1 usa a mesma liquidação do Stop 80\' e fica de fora do Método A.');
  console.log('O volume (xG final ou chutes) é o retrato do jogo inteiro, não o xG ao vivo.');
  console.log('');
  const traco = '-'.repeat(108);
  console.log(traco);
  console.log(cabecalhoTabela());
  console.log(traco);
  console.log(linhaTabela('A/A+ empate 0x0 ou 1x1 (Stop 80\')', auditoria.livros.a));
  console.log(linhaTabela('  A/A+ só 0x0', auditoria.livros['0x0']));
  console.log(linhaTabela('  A/A+ só 1x1', auditoria.livros['1x1']));
  console.log(linhaTabela('B 1º tempo 22\'-35\' (Stop 45\')', auditoria.livros.b));
  console.log(traco);
  console.log(linhaTabela('Fora do A: 1x0 ou 0x1 aos 60\'', auditoria.livros.lider));
  console.log(linhaTabela('  1x0 aos 60\'', auditoria.livros['1x0']));
  console.log(linhaTabela('  0x1 aos 60\'', auditoria.livros['0x1']));
  console.log(traco);

  const a = metricas(auditoria.livros.a);
  const b = metricas(auditoria.livros.b);
  const lider = metricas(auditoria.livros.lider);
  console.log('');
  if (!a.entradas && !b.entradas) {
    console.log('Recomendação: o cache não tem jogo qualificado para simular.');
    console.log('');
    return;
  }
  if (a.entradas) {
    const sinalA = a.lucro > 0 ? 'fecha positivo' : a.lucro < 0 ? 'ainda fecha negativo' : 'empata';
    console.log(`Método A/A+ ${sinalA}: ${dinheiro(a.lucro)} em ${a.entradas} entradas (acerto ${a.taxa.toFixed(1)}%, ROI ${a.roi.toFixed(1)}%).`);
  }
  if (lider.entradas) {
    console.log(`1x0/0x1 aos 60': ${dinheiro(lider.lucro)} em ${lider.entradas} entradas (ROI ${lider.roi.toFixed(1)}%). Esse é o prejuízo que o empate obrigatório tira do Método A.`);
  }
  if (a.entradas && lider.entradas) {
    const junto = Number((a.lucro + lider.lucro).toFixed(2));
    console.log(`Somando os dois livros o Stop 80' iria a ${dinheiro(junto)}. Sem o 1x0/0x1, fica ${dinheiro(a.lucro)}.`);
  }
  if (b.entradas) {
    console.log(`Método B: ${dinheiro(b.lucro)} em ${b.entradas} entradas (acerto ${b.taxa.toFixed(1)}%, ROI ${b.roi.toFixed(1)}%). Equilíbrio do B: mais de 44,4% de greens.`);
  }
  console.log('');
}

function assert(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

function selfTest() {
  const gol = (minuto, lado) => ({ minuto, extra: 0, lado });
  const stats = { xg: 1.8, finalizacoes: 14, noAlvo: 6 };
  const jogo = (gols) => ({ estatisticas: stats, gols });

  const zerZero = auditar([jogo([gol(72, 'casa')])]);
  assert(zerZero.livros.a.greens === 1 && zerZero.livros.a.lucro === 2.08, '0x0 com gol aos 72 é green do A');
  assert(zerZero.livros.lider.entradas === 0, '0x0 não entra no livro do líder');
  assert(zerZero.livros.b.stops === 1 && zerZero.livros.b.lucro === -0.8, 'sem gol até 45 o B toma cashout');

  const semGol = auditar([jogo([])]);
  assert(semGol.livros.a.stops === 1 && semGol.livros.a.lucro === -1.85, '0x0 sem gol até 80 é cashout do A');

  const aos80 = auditar([jogo([gol(80, 'fora')])]);
  assert(aos80.livros.a.greens === 1, 'gol aos 80 ainda é green');
  const aos81 = auditar([jogo([gol(81, 'fora')])]);
  assert(aos81.livros.a.stops === 1, 'gol aos 81 estoura o stop 80');

  const quebrou = auditar([jogo([gol(58, 'casa')])]);
  assert(quebrou.livros.a.entradas === 0, 'gol aos 58 desfaz o empate e bloqueia o A');
  assert(quebrou.livros['1x0'].entradas === 1, 'o 1x0 aos 60 vai para o livro excluído');

  const umUm = auditar([jogo([gol(10, 'casa'), gol(40, 'fora'), gol(70, 'casa')])]);
  assert(umUm.livros['1x1'].greens === 1, '1x1 firme dos 55 aos 60 entra no A');

  const virouUmUm = auditar([jogo([gol(57, 'casa'), gol(59, 'fora')])]);
  assert(virouUmUm.livros.a.entradas === 0, 'empate que só aparece dentro da janela não entra');

  const liderGreen = auditar([jogo([gol(20, 'casa'), gol(72, 'fora')])]);
  assert(liderGreen.livros.a.entradas === 0 && liderGreen.livros['1x0'].greens === 1, '1x0 com gol depois fica só no comparativo');

  const meio = auditar([jogo([gol(40, 'casa')])]);
  assert(meio.livros.b.greens === 1 && meio.livros.b.lucro === 1, 'gol aos 40 paga o B');
  const aos45 = auditar([jogo([{ minuto: 45, extra: 2, lado: 'casa' }])]);
  assert(aos45.livros.b.greens === 1, '45+2 ainda é 1º tempo');
  const aos46 = auditar([jogo([gol(46, 'casa')])]);
  assert(aos46.livros.b.stops === 1, 'gol aos 46 não paga o stop do intervalo');
  const aos35 = auditar([jogo([gol(35, 'casa')])]);
  assert(aos35.livros.b.stops === 1, 'gol aos 35 já aconteceu na entrada');

  const baixo = auditar([{ estatisticas: { xg: 0.4, finalizacoes: 8, noAlvo: 3 }, gols: [] }]);
  assert(baixo.qualificados === 0, 'volume baixo fica de fora');

  console.log('self-test ok');
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  if (!fs.existsSync(CACHE_PATH)) {
    console.error('Cache ausente em scripts/cache_backtest_100.json. Nenhuma requisição foi feita.');
    process.exitCode = 1;
    return;
  }
  const cache = lerCache();
  imprimirRelatorio(cache, auditar(jogosDoCache(cache)));
}

const direto = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (direto) main();
