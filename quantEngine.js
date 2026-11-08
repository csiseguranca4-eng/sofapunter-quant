/**
 * Motor quantitativo independente (Poisson / xG).
 * A matriz cobre placares de 0x0 a 5x5 e é renormalizada para somar 1.
 * Odd justa = 1 / probabilidade.
 */

const LIGAS_OFICIAIS = require('./ligasOficiais.json');

function validarIntensidade(nome, valor) {
  const intensidade = Number(valor);
  if (!Number.isFinite(intensidade) || intensidade < 0) {
    throw new Error(`${nome} deve ser um número finito maior ou igual a zero.`);
  }
  return intensidade;
}

function pmfPoisson(k, lambda) {
  let probabilidade = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) {
    probabilidade *= lambda / i;
  }
  return probabilidade;
}

function arredondar(valor, casas) {
  return Number(valor.toFixed(casas));
}

function cotacao(probabilidade) {
  if (!(probabilidade > 0)) {
    return { probabilidade: 0, oddJusta: null };
  }
  return {
    probabilidade: arredondar(probabilidade, 6),
    oddJusta: arredondar(1 / probabilidade, 3)
  };
}

function calcularOddsQuant(lambdaMandante, muVisitante) {
  const lambda = validarIntensidade('lambdaMandante', lambdaMandante);
  const mu = validarIntensidade('muVisitante', muVisitante);

  const bruto = [];
  for (let golsCasa = 0; golsCasa <= 5; golsCasa += 1) {
    const chanceCasa = pmfPoisson(golsCasa, lambda);
    const linha = [];
    for (let golsFora = 0; golsFora <= 5; golsFora += 1) {
      linha.push(chanceCasa * pmfPoisson(golsFora, mu));
    }
    bruto.push(linha);
  }

  let massa = 0;
  for (const linha of bruto) {
    for (const chance of linha) massa += chance;
  }
  if (!(massa > 0)) {
    throw new Error('A matriz de Poisson ficou sem massa de probabilidade.');
  }

  const matriz = bruto.map((linha) => linha.map((chance) => chance / massa));

  let casa = 0;
  let empate = 0;
  let fora = 0;
  let over15 = 0;
  let under15 = 0;
  let over25 = 0;
  let under25 = 0;
  let bttsSim = 0;
  let bttsNao = 0;

  for (let golsCasa = 0; golsCasa <= 5; golsCasa += 1) {
    for (let golsFora = 0; golsFora <= 5; golsFora += 1) {
      const chance = matriz[golsCasa][golsFora];
      if (golsCasa > golsFora) casa += chance;
      else if (golsCasa < golsFora) fora += chance;
      else empate += chance;

      const gols = golsCasa + golsFora;
      if (gols >= 2) over15 += chance;
      else under15 += chance;
      if (gols >= 3) over25 += chance;
      else under25 += chance;

      if (golsCasa > 0 && golsFora > 0) bttsSim += chance;
      else bttsNao += chance;
    }
  }

  const decisivos = casa + fora;
  const dnbMandante = decisivos > 0 ? casa / decisivos : 0;
  const dnbVisitante = decisivos > 0 ? fora / decisivos : 0;

  return {
    entradas: {
      lambdaMandante: lambda,
      muVisitante: mu
    },
    matriz: matriz.map((linha) => linha.map((chance) => arredondar(chance, 6))),
    somaMatriz: arredondar(matriz.flat().reduce((total, chance) => total + chance, 0), 6),
    matchOdds: {
      casa: cotacao(casa),
      empate: cotacao(empate),
      fora: cotacao(fora)
    },
    empateAnula: {
      mandante: cotacao(dnbMandante),
      visitante: cotacao(dnbVisitante)
    },
    gols: {
      over15: cotacao(over15),
      under15: cotacao(under15),
      over25: cotacao(over25),
      under25: cotacao(under25)
    },
    btts: {
      sim: cotacao(bttsSim),
      nao: cotacao(bttsNao)
    }
  };
}

const MARGEM_MINIMA_EV = 0.03;
const LIMIAR_RISCO_ELEVADO = -0.20;

const MERCADOS_QUANT = [
  { id: 'casa', nome: 'Casa', ler: (modelo) => modelo.matchOdds.casa },
  { id: 'empate', nome: 'Empate', ler: (modelo) => modelo.matchOdds.empate },
  { id: 'fora', nome: 'Fora', ler: (modelo) => modelo.matchOdds.fora },
  { id: 'dnbMandante', nome: 'DNB Mandante', ler: (modelo) => modelo.empateAnula.mandante },
  { id: 'dnbVisitante', nome: 'DNB Visitante', ler: (modelo) => modelo.empateAnula.visitante },
  { id: 'over15', nome: 'Over 1.5', ler: (modelo) => modelo.gols.over15 },
  { id: 'under15', nome: 'Under 1.5', ler: (modelo) => modelo.gols.under15 },
  { id: 'over25', nome: 'Over 2.5', ler: (modelo) => modelo.gols.over25 },
  { id: 'under25', nome: 'Under 2.5', ler: (modelo) => modelo.gols.under25 },
  { id: 'bttsSim', nome: 'Ambas Marcam: Sim', ler: (modelo) => modelo.btts.sim },
  { id: 'bttsNao', nome: 'Ambas Marcam: Não', ler: (modelo) => modelo.btts.nao }
];

function formatarMargem(ev) {
  const pontos = ev * 100;
  const absoluto = Math.abs(pontos).toFixed(1);
  if (pontos > 0) return `+${absoluto}%`;
  if (pontos < 0) return `-${absoluto}%`;
  return '0.0%';
}

function classificarSelo(ev, temValor) {
  if (temValor) return '+EV Confirmado';
  if (ev <= LIMIAR_RISCO_ELEVADO) return 'Risco Elevado';
  return 'Sem Valor';
}

function calcularEV(oddCasa, probabilidadeModelo) {
  const odd = Number(oddCasa);
  const probabilidade = Number(probabilidadeModelo);
  if (!Number.isFinite(odd) || odd <= 1) {
    throw new Error('oddCasa deve ser uma cotação decimal maior que 1.');
  }
  if (!Number.isFinite(probabilidade) || probabilidade < 0 || probabilidade > 1) {
    throw new Error('probabilidadeModelo deve estar entre 0 e 1.');
  }

  const valor = (odd * probabilidade) - 1;
  return {
    valor: arredondar(valor, 6),
    percentual: formatarMargem(valor),
    temValor: valor >= MARGEM_MINIMA_EV
  };
}

function percentualPoisson(probabilidade) {
  const valor = Number(probabilidade);
  if (!Number.isFinite(valor)) return '0.0%';
  return `${(valor * 100).toFixed(1)}%`;
}

function probabilidadesPoisson(lambdaMandante, muVisitante) {
  const modelo = calcularOddsQuant(lambdaMandante, muVisitante);
  return {
    homeWin: percentualPoisson(modelo.matchOdds.casa.probabilidade),
    draw: percentualPoisson(modelo.matchOdds.empate.probabilidade),
    awayWin: percentualPoisson(modelo.matchOdds.fora.probabilidade),
    over15: percentualPoisson(modelo.gols.over15.probabilidade),
    over25: percentualPoisson(modelo.gols.over25.probabilidade),
    btts: percentualPoisson(modelo.btts.sim.probabilidade)
  };
}

function oddCurtaDeFavorito(odd) {
  return odd > 1 && odd <= 1.8;
}

function favoritoDoConfronto(oddsMercado, modelo) {
  const casa = Number(oddsMercado?.casa);
  const fora = Number(oddsMercado?.fora);
  if (oddCurtaDeFavorito(fora) && (!(casa > 1) || fora < casa)) return 'fora';
  if (oddCurtaDeFavorito(casa) && (!(fora > 1) || casa < fora)) return 'casa';
  const pCasa = Number(modelo?.matchOdds?.casa?.probabilidade) || 0;
  const pFora = Number(modelo?.matchOdds?.fora?.probabilidade) || 0;
  if (pFora > pCasa && oddCurtaDeFavorito(fora)) return 'fora';
  if (pCasa > pFora && oddCurtaDeFavorito(casa)) return 'casa';
  return null;
}

function confrontoDeGols(modelo) {
  const over15 = Number(modelo?.gols?.over15?.probabilidade);
  const over25 = Number(modelo?.gols?.over25?.probabilidade);
  const percentual = (valor) => Number((valor * 100).toFixed(1));
  return percentual(over15) >= 75 || percentual(over25) >= 50;
}

function analisarOportunidadesQuant(lambdaMandante, muVisitante, oddsMercado) {
  if (!oddsMercado || typeof oddsMercado !== 'object') {
    throw new Error('oddsMercado deve ser um objeto com as cotações da casa.');
  }

  const modelo = calcularOddsQuant(lambdaMandante, muVisitante);
  const mercados = [];
  const favorito = favoritoDoConfronto(oddsMercado, modelo);
  const jogoAberto = confrontoDeGols(modelo);

  MERCADOS_QUANT.forEach((mercado) => {
    if (!Object.prototype.hasOwnProperty.call(oddsMercado, mercado.id)) return;
    const oddCasa = Number(oddsMercado[mercado.id]);
    if (!Number.isFinite(oddCasa) || oddCasa <= 1) return;

    const referencia = mercado.ler(modelo);
    const ev = calcularEV(oddCasa, referencia.probabilidade);
    const linhaDeGols = jogoAberto && (mercado.id === 'over15' || mercado.id === 'over25' || mercado.id === 'bttsSim');
    const underEmJogoAberto = jogoAberto && (mercado.id === 'under15' || mercado.id === 'under25');
    mercados.push({
      mercado: mercado.id,
      nome: mercado.nome,
      oddCasa,
      oddJusta: referencia.oddJusta,
      probabilidadeModelo: `${(referencia.probabilidade * 100).toFixed(1)}%`,
      margemEV: ev.percentual,
      ev: ev.valor,
      temValor: ev.temValor,
      selo: classificarSelo(ev.valor, ev.temValor),
      tag: mercado.id === favorito ? 'FAVORITO' : null,
      exibirSempre: mercado.id === favorito || linhaDeGols,
      ocultar: underEmJogoAberto
    });
  });

  const melhoresEntradas = mercados
    .filter((entrada) => {
      if (entrada.ocultar) return false;
      if (entrada.exibirSempre) return true;
      return entrada.ev > 0;
    })
    .sort((a, b) => {
      if (a.tag === 'FAVORITO') return -1;
      if (b.tag === 'FAVORITO') return 1;
      return b.ev - a.ev;
    });

  return {
    entradas: modelo.entradas,
    mercados,
    melhoresEntradas
  };
}

function probabilidadeAte(media, maximo) {
  const intensidade = validarIntensidade('media', media);
  let termo = Math.exp(-intensidade);
  let soma = termo;
  for (let k = 1; k <= maximo; k += 1) {
    termo *= intensidade / k;
    soma += termo;
  }
  return Math.min(1, Math.max(0, soma));
}

function linhasDeContagem(media, linhas, rotulo) {
  if (!(media > 0)) return [];
  return linhas.flatMap((linha) => {
    const under = probabilidadeAte(media, Math.floor(linha));
    const over = Math.max(0, 1 - under);
    return [
      { nome: `${rotulo} Over ${linha}`, ...cotacao(over) },
      { nome: `${rotulo} Under ${linha}`, ...cotacao(under) }
    ];
  });
}

function aplicarCotacaoCasa(linha, oddCasa) {
  const base = {
    nome: linha.nome,
    oddJusta: linha.oddJusta,
    probabilidade: linha.probabilidade,
    probabilidadeModelo: linha.probabilidade > 0 ? `${(linha.probabilidade * 100).toFixed(1)}%` : null,
    oddCasa: oddCasa > 1 ? oddCasa : null,
    margemEV: null,
    ev: null,
    temValor: false,
    selo: 'Sem Valor'
  };
  if (!(oddCasa > 1) || !(linha.probabilidade > 0)) return base;
  const ev = calcularEV(oddCasa, linha.probabilidade);
  return {
    ...base,
    margemEV: ev.percentual,
    ev: ev.valor,
    temValor: ev.temValor,
    selo: classificarSelo(ev.valor, ev.temValor)
  };
}

function mediaDisponivel(...valores) {
  const numeros = valores.filter((item) => Number.isFinite(Number(item))).map(Number);
  if (!numeros.length) return null;
  return numeros.reduce((total, item) => total + item, 0) / numeros.length;
}

function expectativaCantos(mandante, visitante) {
  const casa = mediaDisponivel(mandante?.cantosAFavorCasa, visitante?.cantosContraFora);
  const fora = mediaDisponivel(visitante?.cantosAFavorFora, mandante?.cantosContraCasa);
  if (casa != null && fora != null) return arredondar(casa + fora, 2);
  if (Number.isFinite(mandante?.cantosPorJogo) && Number.isFinite(visitante?.cantosPorJogo)) {
    return arredondar(mandante.cantosPorJogo + visitante.cantosPorJogo, 2);
  }
  return null;
}

function expectativaCartoes(mandante, visitante) {
  if (!Number.isFinite(mandante?.cartoesPorJogo) || !Number.isFinite(visitante?.cartoesPorJogo)) return null;
  return arredondar(mandante.cartoesPorJogo + visitante.cartoesPorJogo, 2);
}

function calibrarLambdasH2H(lambdaMandante, muVisitante, confrontos) {
  const lambda = validarIntensidade('lambdaMandante', lambdaMandante);
  const mu = validarIntensidade('muVisitante', muVisitante);
  const jogos = (Array.isArray(confrontos) ? confrontos : []).filter((jogo) => Number.isFinite(Number(jogo?.totalGols)));
  if (jogos.length < 3) return { lambda, mu, fator: 1, motivo: null };

  const taxaOver = jogos.filter((jogo) => Number(jogo.totalGols) >= 3).length / jogos.length;
  let fator = 1;
  let motivo = null;
  if (taxaOver >= 0.8) {
    fator = 1.08;
    motivo = 'H2H fortemente Over';
  } else if (taxaOver >= 0.65) {
    fator = 1.05;
    motivo = 'H2H Over';
  } else if (taxaOver <= 0.2) {
    fator = 0.92;
    motivo = 'H2H fortemente Under';
  } else if (taxaOver <= 0.35) {
    fator = 0.95;
    motivo = 'H2H Under';
  }

  return {
    lambda: arredondar(lambda * fator, 2),
    mu: arredondar(mu * fator, 2),
    fator,
    motivo
  };
}

function probabilidadeImplicita(oddCasa, oddEmpate, oddFora) {
  if (!(oddCasa > 1) || !(oddFora > 1)) return null;
  const bruto = [1 / oddCasa, oddEmpate > 1 ? 1 / oddEmpate : 0, 1 / oddFora];
  const soma = bruto[0] + bruto[1] + bruto[2];
  if (!(soma > 0)) return null;
  return { casa: bruto[0] / soma, empate: bruto[1] / soma, fora: bruto[2] / soma };
}

function distanciaAbsurda(oddJusta, oddMercado) {
  if (!(oddJusta > 1) || !(oddMercado > 1)) return false;
  const maior = Math.max(oddJusta, oddMercado);
  const menor = Math.min(oddJusta, oddMercado);
  return (maior / menor) - 1 > 1;
}

function limitarLado(probabilidade, odd) {
  let valor = probabilidade;
  if (odd > 3.5) valor = Math.min(valor, 0.30);
  if (odd >= 5.5) valor = Math.min(0.18, Math.max(0.14, valor));
  if (odd < 1.8 && odd > 1) valor = Math.max(valor, 0.55);
  if (odd <= 1.6 && odd > 1) valor = Math.min(0.68, Math.max(0.62, valor));
  return valor;
}

function ancorarNoMercado(modelo, odds) {
  const casa = Number(modelo?.casa);
  const fora = Number(modelo?.fora);
  const oddCasa = Number(odds?.casa);
  const oddFora = Number(odds?.fora);
  const implicita = probabilidadeImplicita(oddCasa, odds?.empate, oddFora);
  if (!implicita || !(casa > 0) || !(fora > 0)) {
    return { casa, fora, ancorou: false, motivo: null };
  }
  const oddJustaCasa = 1 / casa;
  const oddJustaFora = 1 / fora;
  const mandanteZebra = oddCasa > 3.5 && oddFora < 1.8;
  const visitanteZebra = oddFora > 3.5 && oddCasa < 1.8;
  const casaEstourou = mandanteZebra && casa > 0.30;
  const foraEstourou = visitanteZebra && fora > 0.30;
  const absurdo = distanciaAbsurda(oddJustaCasa, oddCasa) || distanciaAbsurda(oddJustaFora, oddFora);
  if (!mandanteZebra && !visitanteZebra && !absurdo && !casaEstourou && !foraEstourou) {
    return { casa, fora, ancorou: false, motivo: null };
  }
  return {
    casa: limitarLado(implicita.casa, oddCasa),
    fora: limitarLado(implicita.fora, oddFora),
    ancorou: true,
    motivo: absurdo ? 'odd justa reancorada na 1win' : 'favorito da 1win preservado'
  };
}

function montarMercadosAdicionais(mandante, visitante, oddsPorNome = {}) {
  const cantosEsperados = expectativaCantos(mandante, visitante);
  const cartoesEsperados = expectativaCartoes(mandante, visitante);
  const cotar = (linhas) => linhas.map((linha) => aplicarCotacaoCasa(linha, Number(oddsPorNome?.[linha.nome])));
  return {
    cantos: {
      mediaEsperada: cantosEsperados,
      linhas: cotar(linhasDeContagem(cantosEsperados, [8.5, 9.5, 10.5], 'Cantos'))
    },
    cartoes: {
      mediaEsperada: cartoesEsperados,
      linhas: cotar(linhasDeContagem(cartoesEsperados, [3.5, 4.5], 'Cartões'))
    }
  };
}

module.exports = {
  LIGAS_OFICIAIS,
  calcularOddsQuant,
  calcularEV,
  analisarOportunidadesQuant,
  calibrarLambdasH2H,
  montarMercadosAdicionais,
  probabilidadesPoisson,
  ancorarNoMercado,
  distanciaAbsurda,
  favoritoDoConfronto,
  confrontoDeGols
};

if (require.main === module) {
    console.log("=== TESTE PASSO 2: ANÁLISE +EV SOFAPUNTER QUANT ===");
    const oddsExemplo = {
        casa: 2.30,        // Modelo deu 2.101 -> deve acusar +EV
        empate: 3.50,      // Modelo deu 4.077 -> sem valor
        fora: 3.30,        // Modelo deu 3.586 -> sem valor
        dnbMandante: 1.70, // Modelo deu 1.586 -> deve acusar +EV
        over25: 1.95,      // Modelo deu 1.857 -> deve acusar +EV
        bttsSim: 1.72      // Modelo deu 1.775 -> sem valor
    };
    const resultado = analisarOportunidadesQuant(1.65, 1.20, oddsExemplo);
    console.log(JSON.stringify(resultado, null, 2));
}
