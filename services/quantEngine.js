/**
 * Motor quantitativo independente (Poisson / xG).
 * A matriz cobre placares de 0x0 a 5x5 e é renormalizada para somar 1.
 * Odd justa = 1 / probabilidade.
 */

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

function analisarOportunidadesQuant(lambdaMandante, muVisitante, oddsMercado) {
  if (!oddsMercado || typeof oddsMercado !== 'object') {
    throw new Error('oddsMercado deve ser um objeto com as cotações da casa.');
  }

  const modelo = calcularOddsQuant(lambdaMandante, muVisitante);
  const mercados = [];

  MERCADOS_QUANT.forEach((mercado) => {
    if (!Object.prototype.hasOwnProperty.call(oddsMercado, mercado.id)) return;
    const oddCasa = Number(oddsMercado[mercado.id]);
    if (!Number.isFinite(oddCasa) || oddCasa <= 1) return;

    const referencia = mercado.ler(modelo);
    const ev = calcularEV(oddCasa, referencia.probabilidade);
    mercados.push({
      mercado: mercado.id,
      nome: mercado.nome,
      oddCasa,
      oddJusta: referencia.oddJusta,
      probabilidadeModelo: `${(referencia.probabilidade * 100).toFixed(1)}%`,
      margemEV: ev.percentual,
      ev: ev.valor,
      temValor: ev.temValor,
      selo: classificarSelo(ev.valor, ev.temValor)
    });
  });

  const melhoresEntradas = mercados
    .filter((entrada) => entrada.ev > 0)
    .sort((a, b) => b.ev - a.ev);

  return {
    entradas: modelo.entradas,
    mercados,
    melhoresEntradas
  };
}

module.exports = {
  calcularOddsQuant,
  calcularEV,
  analisarOportunidadesQuant
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
