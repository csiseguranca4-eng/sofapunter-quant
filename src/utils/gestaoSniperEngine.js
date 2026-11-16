const META_BANCA = 5000;
const APORTE_MENSAL = 35;
const TAXA_MENSAL = 0.08;
const LIMITE_CLIQUES = 10;
const MARCOS = [1, 6, 12, 24, 32, 36, 48, 55];
export const DATA_INICIO_CICLO_OFICIAL = '2026-11-15';

export function contarCliquesMes(entradas, mes) {
  const chave = String(mes || '');
  return (Array.isArray(entradas) ? entradas : []).filter((entrada) => {
    const dia = String(entrada?.date || entrada?.data || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
    if (chave && !dia.startsWith(chave)) return false;
    return dia >= DATA_INICIO_CICLO_OFICIAL;
  }).length;
}

function doisDigitos(valor) {
  return String(Math.max(0, Number(valor) || 0)).padStart(2, '0');
}

function arredondar(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

export function calcularProtocoloMensal(bancaInicialMes) {
  const banca = Number(bancaInicialMes);
  const base = Number.isFinite(banca) && banca > 0 ? banca : 0;
  let fase = 1;
  let percentual = 0.055;
  if (base >= 2000) {
    fase = 3;
    percentual = 0.035;
  } else if (base >= 500) {
    fase = 2;
    percentual = 0.045;
  }
  const stakeCongelada = base > 0
    ? Math.max(0.5, Math.round((base * percentual) / 0.5) * 0.5)
    : 0;
  const riscoRealCorte80 = arredondar(stakeCongelada * 0.45);
  const riscoRealPctBanca = base > 0 ? arredondar((riscoRealCorte80 / base) * 100) : 0;
  return {
    fase,
    percentual,
    stakeCongelada: arredondar(stakeCongelada),
    riscoRealCorte80,
    riscoRealPctBanca
  };
}

export function avaliarStatusMensal({
  bancaInicialMes,
  bancaAtual,
  cliquesUsados,
  aporteJaRealizadoNoMes
} = {}) {
  const inicial = Number(bancaInicialMes) || 0;
  const atual = Number(bancaAtual) || 0;
  const lucroMes = arredondar(atual - inicial);
  const crescimentoPct = inicial > 0 ? (lucroMes / inicial) * 100 : 0;
  const lucroAlvo = arredondar(inicial * TAXA_MENSAL);
  const faltaParaMeta = Math.max(0, arredondar(lucroAlvo - lucroMes));
  const metaBatida = lucroAlvo > 0 && lucroMes >= lucroAlvo;
  const usados = Math.max(0, Number(cliquesUsados) || 0);
  return {
    lucroMes,
    crescimentoPct,
    lucroAlvo,
    faltaParaMeta,
    metaBatida,
    podeAportar: metaBatida && aporteJaRealizadoNoMes !== true,
    cliquesRestantes: Math.max(0, LIMITE_CLIQUES - usados),
    bloqueadoPorCliques: usados >= LIMITE_CLIQUES,
    textoCliques: `Cliques no Mês: ${doisDigitos(usados)} / ${doisDigitos(LIMITE_CLIQUES)} (${doisDigitos(Math.max(0, LIMITE_CLIQUES - usados))} restantes)`
  };
}

export function simularTrajetoria5k(bancaAtual, comAporte) {
  let banca = Number(bancaAtual) || 0;
  if (banca >= META_BANCA) return { totalMeses: 0, marcos: [] };
  if (!(banca > 0)) return { totalMeses: null, marcos: [] };

  const aporte = comAporte ? APORTE_MENSAL : 0;
  const historico = [];
  let mes = 0;
  while (banca < META_BANCA && mes < 600) {
    mes += 1;
    const protocolo = calcularProtocoloMensal(banca);
    const lucroMensal = banca * TAXA_MENSAL;
    banca += lucroMensal + aporte;
    historico.push({
      mes,
      marco: `Mês ${mes}`,
      banca: arredondar(banca),
      stake: protocolo.stakeCongelada,
      lucroMensal: arredondar(lucroMensal)
    });
  }

  const visiveis = new Set(MARCOS.filter((marco) => marco <= mes));
  visiveis.add(mes);
  return {
    totalMeses: mes,
    marcos: historico.filter((linha) => visiveis.has(linha.mes))
  };
}
