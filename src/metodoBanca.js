export const BANCA_OPERACIONAL = 500;
export const STOP_LOSS_DIARIO = -15;
export const LIMITE_ENTRADAS_MIN = 3;
export const LIMITE_ENTRADAS_MAX = 4;

export const FASES_CDB = [
  { fase: 1, banca: 500, stake: 7.5, meta: 250 },
  { fase: 2, banca: 750, stake: 11.25, meta: 500 },
  { fase: 3, banca: 1000, stake: 15, meta: 1000 },
  { fase: 4, banca: 1500, stake: 22.5, meta: 1500 },
  { fase: 5, banca: 2000, stake: 30, meta: null }
];

export function lerSaldoCdb() {
  try {
    const salvo = Number(localStorage.getItem('sp_cdb_saldo'));
    if (Number.isFinite(salvo) && salvo >= 0) return Math.round(salvo * 100) / 100;
  } catch {
    /* o navegador pode bloquear o storage */
  }
  return 0;
}

export function faseAtual(saldoCdb) {
  const saldo = Math.max(0, Number(saldoCdb) || 0);
  let inicio = 0;
  for (const fase of FASES_CDB) {
    if (fase.meta == null) {
      return { ...fase, inicio, progresso: 1, noFase: Math.max(0, saldo - inicio) };
    }
    if (saldo < inicio + fase.meta) {
      const noFase = Math.max(0, saldo - inicio);
      return { ...fase, inicio, progresso: noFase / fase.meta, noFase };
    }
    inicio += fase.meta;
  }
  const ultima = FASES_CDB[FASES_CDB.length - 1];
  return { ...ultima, inicio, progresso: 1, noFase: Math.max(0, saldo - inicio) };
}

export function reais(valor, comSinal = false) {
  const numero = Number(valor) || 0;
  const absoluto = Math.abs(numero).toFixed(2).replace('.', ',');
  if (!comSinal) return `${numero < 0 ? '-' : ''}R$ ${absoluto}`;
  const sinal = numero > 0 ? '+' : numero < 0 ? '-' : '';
  return `${sinal}R$ ${absoluto}`;
}

export function textoResultadoStake(lucro, stake) {
  const ganho = Number(lucro) || 0;
  const base = Number(stake);
  const valor = reais(ganho, true);
  if (!(base > 0)) return valor;
  const percentual = (ganho / base) * 100;
  const texto = `${percentual > 0 ? '+' : ''}${percentual.toFixed(1).replace('.', ',')}%`;
  return `${valor} (${texto})`;
}

export function agruparDias(linhas, monthKey) {
  const mapa = new Map();
  (Array.isArray(linhas) ? linhas : []).forEach((linha) => {
    const dia = String(linha?.date || '');
    if (!dia.startsWith(`${monthKey}-`)) return;
    const atual = mapa.get(dia) || { lucro: 0, entradas: 0, fechadas: 0 };
    atual.entradas += 1;
    const status = String(linha.status || '').toUpperCase();
    if (status === 'GREEN' || status === 'RED' || status === 'CASHOUT') {
      atual.lucro = Math.round((atual.lucro + (Number(linha.lucro) || 0)) * 100) / 100;
      atual.fechadas += 1;
    }
    mapa.set(dia, atual);
  });
  return mapa;
}

export function resumoDoDia(linhas, dia) {
  const doDia = (Array.isArray(linhas) ? linhas : []).filter((linha) => linha.date === dia);
  const lucro = doDia.reduce((total, linha) => {
    const status = String(linha.status || '').toUpperCase();
    if (status !== 'GREEN' && status !== 'RED' && status !== 'CASHOUT') return total;
    return total + (Number(linha.lucro) || 0);
  }, 0);
  return {
    entradas: doDia.length,
    lucro: Math.round(lucro * 100) / 100,
    stop: lucro <= STOP_LOSS_DIARIO
  };
}
