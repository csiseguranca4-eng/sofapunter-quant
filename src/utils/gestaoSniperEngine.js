const META_BANCA = 5000;
const APORTE_MENSAL = 35;
const TAXA_MENSAL = 0.08;
const LIMITE_CLIQUES = 10;
const MARCOS = [1, 6, 12, 24, 32, 36, 48, 55];
export const DATA_INICIO_CICLO_OFICIAL = '2026-11-15';

export const MODOS_ENTRADA = {
  SNIPER_2T: {
    id: 'SNIPER_2T',
    nome: 'Sniper Principal (2T • Stop 80\' • 1.0 clique)',
    janela: '55\'–67\'',
    oddMin: 1.5,
    oddMax: 1.7,
    riscoPct: 0.45,
    cliques: 1
  },
  TATICO_1T: {
    id: 'TATICO_1T',
    nome: 'Tático 1º Tempo (Over FT • Stop 45\' • 0.5 clique)',
    janela: '22\'–35\'',
    oddMin: 1.18,
    oddMax: 1.32,
    riscoPct: 0.2,
    cliques: 0.5
  }
};

const CHAVE_MODOS = 'sp_protocolo_modos';

export function modoEntrada(id) {
  return MODOS_ENTRADA[id] || MODOS_ENTRADA.SNIPER_2T;
}

export function pesoClique(entrada) {
  return modoEntrada(entrada?.modo || entrada?.modoProtocolo).cliques;
}

export function formatarCota(valor) {
  const numero = Math.round((Number(valor) || 0) * 10) / 10;
  const [inteiro, decimal] = numero.toFixed(1).split('.');
  return `${inteiro.padStart(2, '0')}.${decimal}`;
}

export function avisoStop(modoId, stake) {
  const modo = modoEntrada(modoId);
  const risco = (Math.round((Number(stake) || 0) * modo.riscoPct * 100) / 100).toFixed(2).replace('.', ',');
  if (modo.id === 'TATICO_1T') {
    return `Cashout obrigatório no intervalo 45' — não voltar no 2T (Risco est. -US$ ${risco})`;
  }
  return `Stop obrigatório aos 80' (Risco est. -US$ ${risco})`;
}

export function cabeModo(cliquesUsados, modoId) {
  const usados = Math.round((Number(cliquesUsados) || 0) * 10);
  return usados + Math.round(modoEntrada(modoId).cliques * 10) <= LIMITE_CLIQUES * 10;
}

export function lerModosProtocolo() {
  try {
    const mapa = JSON.parse(localStorage.getItem(CHAVE_MODOS) || '{}');
    if (!mapa || typeof mapa !== 'object') return {};
    return Object.fromEntries(
      Object.entries(mapa).filter(([, modo]) => MODOS_ENTRADA[modo]).map(([id, modo]) => [String(id), modo])
    );
  } catch {
    return {};
  }
}

export function gravarModoProtocolo(ids, modoId) {
  const mapa = lerModosProtocolo();
  const modo = modoEntrada(modoId).id;
  (Array.isArray(ids) ? ids : [ids]).forEach((id) => {
    if (id) mapa[String(id)] = modo;
  });
  localStorage.setItem(CHAVE_MODOS, JSON.stringify(mapa));
  return mapa;
}

export function contarCliquesMes(entradas, mes) {
  const chave = String(mes || '');
  const decimos = (Array.isArray(entradas) ? entradas : []).reduce((total, entrada) => {
    const dia = String(entrada?.date || entrada?.data || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return total;
    if (chave && !dia.startsWith(chave)) return total;
    if (dia < DATA_INICIO_CICLO_OFICIAL) return total;
    return total + Math.round(pesoClique(entrada) * 10);
  }, 0);
  return decimos / 10;
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
  const usados = Math.max(0, Math.round((Number(cliquesUsados) || 0) * 10) / 10);
  const restantes = Math.max(0, Math.round((LIMITE_CLIQUES - usados) * 10) / 10);
  return {
    lucroMes,
    crescimentoPct,
    lucroAlvo,
    faltaParaMeta,
    metaBatida,
    podeAportar: metaBatida && aporteJaRealizadoNoMes !== true,
    cliquesRestantes: restantes,
    bloqueadoPorCliques: usados >= LIMITE_CLIQUES,
    textoCliques: `Cliques no Mês: ${formatarCota(usados)} / ${LIMITE_CLIQUES} (${formatarCota(restantes)} restantes)`
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
