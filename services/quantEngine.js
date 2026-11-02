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

module.exports = { calcularOddsQuant };

if (require.main === module) {
    console.log("=== TESTE DO MOTOR SOFAPUNTER QUANT ===");
    const teste = calcularOddsQuant(1.65, 1.20);
    console.log(JSON.stringify(teste, null, 2));
}
