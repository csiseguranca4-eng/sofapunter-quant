export const BANCA_OPERACIONAL = 69.16;
export const STAKE_PADRAO = 4;
export const INICIO_METODO = '2026-11-14';
export const CORTE_REGISTRO_MS = Date.parse('2026-11-14T15:00:00.000Z');
export const STOP_LOSS_DIARIO = -15;
export const LIMITE_ENTRADAS_MIN = 3;
export const LIMITE_ENTRADAS_MAX = 4;

export const FASES_CDB = [
  { fase: 1, banca: 69.16, stake: 4, meta: 34.58 },
  { fase: 2, banca: 103.74, stake: 4.5, meta: 69.16 },
  { fase: 3, banca: 138.32, stake: 6, meta: 138.32 },
  { fase: 4, banca: 207.48, stake: 9, meta: 207.48 },
  { fase: 5, banca: 276.64, stake: 12, meta: null }
];

export function lerSaldoCdb() {
  try {
    if (localStorage.getItem('sp_cdb_corte') !== INICIO_METODO) {
      localStorage.setItem('sp_cdb_saldo', '0');
      localStorage.setItem('sp_cdb_corte', INICIO_METODO);
      return 0;
    }
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
  if (!comSinal) return `${numero < 0 ? '-' : ''}US$ ${absoluto}`;
  const sinal = numero > 0 ? '+' : numero < 0 ? '-' : '';
  return `${sinal}US$ ${absoluto}`;
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
