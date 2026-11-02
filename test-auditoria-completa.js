/**
 * Auditoria integral do bloco Quant.
 * Usa a função real montarBlocoQuant do server.js.
 * As odds da casa são simuladas; tabela, H2H, últimos jogos, cantos e cartões vêm da API-Football.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const api = require('./services/apiFootball.js');
const confrontoOriginal = api.calcularMediasConfronto;
let confrontoReal = null;

api.calcularMediasConfronto = async (...args) => {
  const resultado = await confrontoOriginal(...args);
  confrontoReal = resultado;
  return resultado;
};

const { montarBlocoQuant } = await import('./server.js');

function cotacao(market, selection, odd, outcome) {
  return { market, selection, odd, outcome, id: `${market}:${selection}` };
}

const homeTeam = 'Flamengo';
const awayTeam = 'Palmeiras';
const oddsSimuladas = [
  cotacao('Resultado do tempo regulamentar', 'Flamengo', 1.72, '1'),
  cotacao('Resultado do tempo regulamentar', 'Empate', 3.60, 'X'),
  cotacao('Resultado do tempo regulamentar', 'Palmeiras', 4.80, '2'),
  cotacao('Handicap', 'Flamengo 0', 1.28, '1'),
  cotacao('Handicap', 'Palmeiras 0', 3.40, '2'),
  cotacao('Total', 'Acima de 2.5', 1.95, '1'),
  cotacao('Total', 'Abaixo de 2.5', 1.85, '2'),
  cotacao('Ambos os times marcarão', 'Sim', 1.90, '1'),
  cotacao('Total de escanteios', 'Acima de 8.5', 1.70, '1'),
  cotacao('Total de escanteios', 'Abaixo de 8.5', 2.10, '2'),
  cotacao('Total de escanteios', 'Acima de 9.5', 2.05, '1'),
  cotacao('Total de escanteios', 'Abaixo de 9.5', 1.75, '2'),
  cotacao('Total de escanteios', 'Acima de 10.5', 2.60, '1'),
  cotacao('Total de escanteios', 'Abaixo de 10.5', 1.48, '2'),
  cotacao('Total de cartões', 'Acima de 3.5', 1.65, '1'),
  cotacao('Total de cartões', 'Abaixo de 3.5', 2.20, '2'),
  cotacao('Total de cartões', 'Acima de 4.5', 2.10, '1'),
  cotacao('Total de cartões', 'Abaixo de 4.5', 1.72, '2')
];

function resumoTime(stats) {
  if (!stats) return null;
  return {
    teamId: stats.teamId,
    leagueId: stats.leagueId,
    season: stats.season,
    jogos: stats.jogos,
    cantosAFavorCasa: stats.cantosAFavorCasa,
    cantosAFavorFora: stats.cantosAFavorFora,
    cantosContraCasa: stats.cantosContraCasa,
    cantosContraFora: stats.cantosContraFora,
    cantosPorJogo: stats.cantosPorJogo,
    cartoesPorJogo: stats.cartoesPorJogo
  };
}

function resumirLado(lado) {
  if (!lado) return null;
  return {
    jogos: Array.isArray(lado.jogos) ? lado.jogos.length : 0,
    over25: lado.over25,
    btts: lado.btts
  };
}

function linhaMercado(item) {
  return {
    nome: item.nome,
    odd1win: item.oddCasa,
    oddJusta: item.oddJusta,
    probabilidade: item.probabilidadeModelo,
    ev: item.margemEV,
    temValor: item.temValor,
    selo: item.selo
  };
}

function coletarVazios(valor, caminho, saida) {
  if (valor === null || valor === undefined) {
    saida.push(`${caminho}: ${String(valor)}`);
    return;
  }
  if (Array.isArray(valor)) {
    valor.forEach((item, indice) => coletarVazios(item, `${caminho}[${indice}]`, saida));
    return;
  }
  if (typeof valor === 'object') {
    Object.entries(valor).forEach(([chave, item]) => {
      coletarVazios(item, caminho ? `${caminho}.${chave}` : chave, saida);
    });
  }
}

const logs = [];
const logOriginal = console.log;
console.log = (...args) => {
  logs.push(args.map((item) => String(item)).join(' '));
  logOriginal(...args);
};

const quant = await montarBlocoQuant({
  allMarkets: oddsSimuladas,
  homeTeam,
  awayTeam,
  league: 'Brasileirão',
  justification: ''
});

console.log = logOriginal;

const linhaQuant = logs.find((linha) => linha.includes('[QUANT]')) || '';
const lambda = linhaQuant.match(/λ\s+([0-9.]+)/)?.[1] ?? null;
const mu = linhaQuant.match(/μ\s+([0-9.]+)/)?.[1] ?? null;
const mercadoCantos = {
  amostra: 'últimos 8 jogos encerrados na liga',
  mandante: resumoTime(confrontoReal?.mandante),
  visitante: resumoTime(confrontoReal?.visitante),
  mediaEsperada: quant?.mercadosAdicionais?.cantos?.mediaEsperada ?? null,
  linhas: (quant?.mercadosAdicionais?.cantos?.linhas || []).map(linhaMercado)
};
const mercadoCartoes = {
  mandantePorJogo: confrontoReal?.mandante?.cartoesPorJogo ?? null,
  visitantePorJogo: confrontoReal?.visitante?.cartoesPorJogo ?? null,
  mediaEsperada: quant?.mercadosAdicionais?.cartoes?.mediaEsperada ?? null,
  linhas: (quant?.mercadosAdicionais?.cartoes?.linhas || []).map(linhaMercado)
};

const payload = {
  fonteDados: quant?.fonteDados ?? null,
  lambda: lambda == null ? null : Number(lambda),
  mu: mu == null ? null : Number(mu),
  ajusteH2H: quant?.ajusteH2H ?? null,
  tabela: quant?.tabela ?? null,
  h2h: quant?.h2h ?? null,
  ultimos10: {
    mandante: resumirLado(quant?.ultimos10?.mandante),
    visitante: resumirLado(quant?.ultimos10?.visitante)
  },
  mercadoCantos,
  mercadoCartoes,
  quant: {
    lambda: lambda == null ? null : Number(lambda),
    mu: mu == null ? null : Number(mu),
    ritmo: quant?.ritmo ?? null,
    tatica: quant?.tatica ?? null,
    mercados: (quant?.mercadosAuditados || []).map(linhaMercado),
    chipsEV: (quant?.melhoresEntradas || []).map(linhaMercado)
  }
};

const vazios = [];
coletarVazios(payload, '', vazios);
const opcionais = new Set([
  'ajusteH2H',
  'quant.tatica'
]);
const problemas = vazios.filter((item) => !opcionais.has(item.split(':')[0]));

logOriginal('\n================ PAYLOAD FINAL =================');
logOriginal(JSON.stringify(payload, null, 2));
logOriginal('\n================ CAMPOS VAZIOS =================');
if (!vazios.length) {
  logOriginal('Nenhum campo null ou undefined.');
} else {
  vazios.forEach((item) => logOriginal(`- ${item}`));
}
logOriginal('\n================ VEREDITO =================');
logOriginal(`fonteDados: ${payload.fonteDados}`);
logOriginal(`fallback sintético: ${payload.fonteDados === 'Sintético (Odds 1win)' ? 'SIM' : 'NÃO'}`);
logOriginal(`vazios fora do opcional (ajusteH2H sem viés e tática Gemini): ${problemas.length}`);
if (problemas.length) {
  problemas.forEach((item) => logOriginal(`  * ${item}`));
  process.exitCode = 1;
}
