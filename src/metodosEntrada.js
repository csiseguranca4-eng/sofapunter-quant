export const METODOS_ENTRADA = [
  { id: 'A+', rotulo: 'Método A+ (1x1)', badge: 'A+' },
  { id: 'A', rotulo: 'Método A (0x0)', badge: 'A' },
  { id: 'B', rotulo: 'Método B (1T)', badge: 'B' },
  { id: 'F', rotulo: "Método F (75'-90')", badge: 'F' },
  { id: 'MANUAL', rotulo: 'Manual (Fora de Padrão)', badge: 'Manual' }
];

const IDS_METODO = new Set(METODOS_ENTRADA.map((item) => item.id));

export function normalizarMetodo(valor) {
  const texto = String(valor || '').trim().toUpperCase();
  return IDS_METODO.has(texto) ? texto : '';
}

export function metodoSeguro(principal, reserva) {
  return normalizarMetodo(principal) || normalizarMetodo(reserva) || '';
}

export function rotuloMetodo(valor) {
  const id = normalizarMetodo(valor);
  return METODOS_ENTRADA.find((item) => item.id === id)?.rotulo || 'Sem método';
}

export function badgeMetodo(valor) {
  const id = normalizarMetodo(valor);
  return METODOS_ENTRADA.find((item) => item.id === id)?.badge || 'Sem método';
}

export function classeBadgeMetodo(valor) {
  const id = normalizarMetodo(valor);
  if (id === 'A+') return 'bg-[#00c853]/15 text-[#00c853]';
  if (id === 'A') return 'bg-emerald-500/10 text-emerald-200';
  if (id === 'B') return 'bg-sky-500/15 text-sky-300';
  if (id === 'F') return 'bg-violet-500/15 text-violet-200';
  if (id === 'MANUAL') return 'bg-gray-800 text-gray-300';
  return 'bg-gray-800/80 text-gray-500';
}

function normalizarNome(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nomePresente(texto, nome) {
  if (!nome) return false;
  if (texto === nome) return true;
  let indice = texto.indexOf(nome);
  while (indice >= 0) {
    const antes = indice === 0 || texto[indice - 1] === ' ';
    const fim = indice + nome.length;
    const depois = fim === texto.length || texto[fim] === ' ';
    const resto = texto.slice(fim).trim();
    if (antes && depois && !/^[0-9]/.test(resto)) return true;
    indice = texto.indexOf(nome, indice + 1);
  }
  return false;
}

export function linhaDaLiga(nome, ranking) {
  const lista = Array.isArray(ranking) ? ranking : [];
  const alvo = normalizarNome(nome);
  if (!alvo) return null;
  const exata = lista.find((linha) => normalizarNome(linha?.liga) === alvo);
  if (exata) return exata;
  const contidas = lista.filter((linha) => nomePresente(alvo, normalizarNome(linha?.liga)));
  contidas.sort((a, b) => normalizarNome(b.liga).length - normalizarNome(a.liga).length);
  return contidas[0] || null;
}

export function casarLigaRanking(nome, ranking) {
  const linha = linhaDaLiga(nome, ranking);
  if (linha?.liga) return linha.liga;
  return String(nome || '').replace(/\s+/g, ' ').trim();
}

export function hojeSaoPaulo(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(agora);
  const ler = (tipo) => partes.find((parte) => parte.type === tipo)?.value || '';
  return `${ler('year')}-${ler('month')}-${ler('day')}`;
}

function inicioTresMeses(hoje) {
  const [ano, mes] = String(hoje || '').split('-').map(Number);
  if (!ano || !mes) return '0000-01-01';
  const data = new Date(Date.UTC(ano, mes - 1 - 2, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function diaAposta(aposta) {
  const texto = String(aposta?.date || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : '';
}

export function dentroDoPeriodo(aposta, periodo, hoje) {
  const dia = diaAposta(aposta);
  if (periodo === 'historico') return true;
  if (!dia || !hoje) return false;
  if (periodo === 'ano') return dia.slice(0, 4) === hoje.slice(0, 4);
  if (periodo === 'mes') return dia.slice(0, 7) === hoje.slice(0, 7);
  if (periodo === '3m') return dia >= inicioTresMeses(hoje) && dia <= hoje;
  return true;
}

function passaFiltroMetodo(aposta, filtro) {
  const metodo = normalizarMetodo(aposta?.metodo);
  if (filtro === 'validados') return metodo === 'A+' || metodo === 'A';
  if (filtro === 'manuais') return metodo === 'MANUAL';
  return true;
}

function finalizada(aposta) {
  return ['GREEN', 'RED', 'CASHOUT'].includes(String(aposta?.status || '').toUpperCase());
}

function acumular(linha, aposta) {
  const status = String(aposta?.status || '').toUpperCase();
  const stake = Number(aposta?.stake);
  const lucro = Number(aposta?.realProfit);
  linha.jogos += 1;
  linha.apostado += Number.isFinite(stake) ? stake : 0;
  linha.lucro += Number.isFinite(lucro) ? lucro : 0;
  if (status === 'GREEN') linha.greens += 1;
  else if (status === 'CASHOUT') linha.stops += 1;
  else if (status === 'RED') linha.reds += 1;
}

function fechar(linha) {
  const apostado = Math.round(linha.apostado * 100) / 100;
  const lucro = Math.round(linha.lucro * 100) / 100;
  const taxaAcerto = linha.jogos ? Math.round((linha.greens / linha.jogos) * 1000) / 10 : null;
  const roiReal = apostado > 0 ? Math.round((lucro / apostado) * 1000) / 10 : null;
  return { ...linha, apostado, lucro, taxaAcerto, roiReal };
}

export function statusComparativo(roiReal, jogos, roiHist) {
  if (!(jogos >= 5) || roiReal == null) return 'Em Observação';
  if (roiReal >= 8) return 'Lucrativa';
  if (roiReal < 0) return 'Atenção';
  if (Number.isFinite(Number(roiHist)) && Number(roiHist) >= 15 && roiReal < 8) return 'Atenção';
  return 'Em Observação';
}

export function montarPerformance(apostas, ranking, { periodo = 'historico', filtro = 'todos', hoje = '' } = {}) {
  const base = (Array.isArray(apostas) ? apostas : []).filter((aposta) => (
    finalizada(aposta) && dentroDoPeriodo(aposta, periodo, hoje) && passaFiltroMetodo(aposta, filtro)
  ));
  const porMetodo = new Map();
  const porLiga = new Map();
  for (const aposta of base) {
    const metodo = normalizarMetodo(aposta?.metodo);
    if (!porMetodo.has(metodo)) {
      porMetodo.set(metodo, {
        id: metodo,
        nome: rotuloMetodo(metodo),
        jogos: 0,
        greens: 0,
        stops: 0,
        reds: 0,
        apostado: 0,
        lucro: 0
      });
    }
    acumular(porMetodo.get(metodo), aposta);
    const historico = linhaDaLiga(aposta?.league || aposta?.liga, ranking);
    const nome = historico?.liga || casarLigaRanking(aposta?.league || aposta?.liga, ranking) || 'Sem liga';
    if (!porLiga.has(nome)) {
      const roiHist = Number(historico?.roiPercentual);
      porLiga.set(nome, {
        nome,
        jogos: 0,
        greens: 0,
        stops: 0,
        reds: 0,
        apostado: 0,
        lucro: 0,
        roiHistorico: Number.isFinite(roiHist) ? roiHist : null
      });
    }
    acumular(porLiga.get(nome), aposta);
  }
  const ordem = ['A+', 'A', 'B', 'F', 'MANUAL', ''];
  const metodos = [...porMetodo.values()]
    .map(fechar)
    .sort((a, b) => ordem.indexOf(a.id) - ordem.indexOf(b.id));
  const ligas = [...porLiga.values()]
    .map((linha) => {
      const fechada = fechar(linha);
      return {
        ...fechada,
        status: statusComparativo(fechada.roiReal, fechada.jogos, fechada.roiHistorico)
      };
    })
    .sort((a, b) => {
      if (a.roiReal == null && b.roiReal == null) return a.nome.localeCompare(b.nome);
      if (a.roiReal == null) return 1;
      if (b.roiReal == null) return -1;
      return b.roiReal - a.roiReal || a.nome.localeCompare(b.nome);
    });
  return { metodos, ligas };
}
