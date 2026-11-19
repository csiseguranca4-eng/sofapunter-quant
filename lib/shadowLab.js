import fs from 'fs';
import { supabase } from './supabase.js';

export const TABELA_SHADOW = 'shadow_lab';
export const MERCADO_SENTINELA = '__shadow_lab__';
const ARQUIVO_SHADOW = 'logs/shadow_audit.json';

let tabelaAusente = false;
let avisoTabela = false;

export function entradaValida(item) {
  return Boolean(item && (item.metodo === 'F' || item.metodo === 'B' || item.metodo === 'U') && item.id);
}

export const STAKE_U = 4;
export const ODD_FALLBACK_U = 1.28;
export const PERDA_U = -2;

export function ligaBloqueadaShadowU(liga) {
  const nome = String(liga || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (nome === 'cup' || nome === 'cups') return true;
  if (nome.includes('tercera division rfef')) return true;
  if (/\bserie d\b/.test(nome)) return true;
  if (/\biii liga\b/.test(nome)) return true;
  return false;
}

export function oddEntradaShadowU(valor) {
  const odd = Number(valor);
  if (!Number.isFinite(odd) || odd < 1.15 || odd > 1.8) return ODD_FALLBACK_U;
  return Number(odd.toFixed(2));
}

export function lucroGreenShadowU(odd) {
  return Number((STAKE_U * (oddEntradaShadowU(odd) - 1)).toFixed(2));
}

export function qualificaShadowU(jogo, pressao) {
  const minuto = Number(jogo?.minuto);
  const status = String(jogo?.status || '').toUpperCase();
  if (status !== '1H' || (minuto !== 35 && minuto !== 36)) return false;
  if (Number(jogo?.golsCasa) !== 0 || Number(jogo?.golsFora) !== 0) return false;
  if (ligaBloqueadaShadowU(jogo?.liga)) return false;
  const xg = Number(pressao?.xgTotal);
  const noAlvo = Number(pressao?.chutesTotal);
  if (!Number.isFinite(xg) || !Number.isFinite(noAlvo)) return false;
  return (xg > 0 || noAlvo > 0) && xg <= 0.45 && noAlvo <= 1;
}

export function resultadoShadowU(_golsEntrada, golsCasa, golsFora, odd) {
  const zerado = Number(golsCasa) === 0 && Number(golsFora) === 0;
  const usada = oddEntradaShadowU(odd);
  return {
    status: zerado ? 'green' : 'red',
    lucro: zerado ? lucroGreenShadowU(usada) : PERDA_U,
    odd: usada
  };
}

export function entradaUCalibrada(item) {
  if (!item || item.metodo !== 'U') return false;
  const minuto = Number(item.minuto);
  if (minuto !== 35 && minuto !== 36) return false;
  if (String(item.placar || '').replace(/\s/g, '').toLowerCase() !== '0x0') return false;
  if (ligaBloqueadaShadowU(item.liga)) return false;
  const xg = Number(item.xg);
  const noAlvo = Number(item.noAlvo);
  if (!Number.isFinite(xg) || !Number.isFinite(noAlvo)) return false;
  if (!((xg > 0 || noAlvo > 0) && xg <= 0.45 && noAlvo <= 1)) return false;
  const odd = Number(item.odd);
  if (!Number.isFinite(odd) || odd < 1.15 || odd > 1.8) return false;
  if (item.status === 'green') return Math.abs(Number(item.lucro) - lucroGreenShadowU(odd)) < 0.001;
  if (item.status === 'red') return Number(item.lucro) === PERDA_U;
  return !item.status || item.status === 'aberta';
}

export function semAmostraAntigaU(entradas) {
  return (entradas || []).filter((item) => item?.metodo !== 'U' || entradaUCalibrada(item));
}

export function mesclarEntradas(listas) {
  const mapa = new Map();
  for (const lista of listas) {
    for (const item of lista || []) {
      if (!entradaValida(item)) continue;
      const anterior = mapa.get(String(item.id));
      if (!anterior) {
        mapa.set(String(item.id), item);
        continue;
      }
      const anteriorFechado = anterior.status && anterior.status !== 'aberta';
      const novoAberto = !item.status || item.status === 'aberta';
      if (anteriorFechado && novoAberto) continue;
      mapa.set(String(item.id), { ...anterior, ...item, em: anterior.em || item.em });
    }
  }
  return [...mapa.values()];
}

function lerArquivo() {
  try {
    const livro = JSON.parse(fs.readFileSync(ARQUIVO_SHADOW, 'utf8'));
    return semAmostraAntigaU(Array.isArray(livro?.entradas) ? livro.entradas.filter(entradaValida) : []);
  } catch {
    return [];
  }
}

function entradaDaLinha(row) {
  const base = row?.entrada && typeof row.entrada === 'object' ? row.entrada : {};
  return {
    ...base,
    id: base.id || row.id,
    metodo: base.metodo || row.metodo,
    fixtureId: base.fixtureId ?? row.fixture_id,
    liga: base.liga || row.liga || '',
    casa: base.casa || row.casa || '',
    fora: base.fora || row.fora || '',
    minuto: base.minuto ?? row.minuto,
    placar: base.placar || row.placar || '',
    gols: base.gols ?? row.gols,
    xg: base.xg ?? row.xg,
    noAlvo: base.noAlvo ?? row.no_alvo,
    stake: base.stake ?? row.stake,
    odd: base.odd ?? row.odd,
    status: base.status || row.status || 'aberta',
    lucro: base.lucro ?? row.lucro,
    placarFinal: base.placarFinal || row.placar_final || null,
    golIntervalo: base.golIntervalo ?? row.gol_intervalo,
    placarIntervalo: base.placarIntervalo || row.placar_intervalo || null,
    em: base.em || row.em
  };
}

function linhaDaEntrada(item) {
  return {
    id: String(item.id),
    metodo: item.metodo,
    fixture_id: Number(item.fixtureId) || null,
    liga: item.liga || null,
    casa: item.casa || null,
    fora: item.fora || null,
    minuto: item.minuto ?? null,
    placar: item.placar || null,
    gols: item.gols ?? null,
    xg: item.xg ?? null,
    no_alvo: item.noAlvo ?? null,
    stake: item.stake ?? null,
    odd: item.odd ?? null,
    status: item.status || 'aberta',
    lucro: item.lucro ?? null,
    placar_final: item.placarFinal || null,
    gol_intervalo: item.golIntervalo ?? null,
    placar_intervalo: item.placarIntervalo || null,
    entrada: item,
    em: item.em || new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  };
}

function tabelaFaltando(error) {
  const texto = `${error?.code || ''} ${error?.message || ''}`;
  return error?.code === 'PGRST205' || /could not find the table|schema cache/i.test(texto);
}

async function lerTabela() {
  if (tabelaAusente) return [];
  const { data, error } = await supabase.from(TABELA_SHADOW).select('*').limit(2000);
  if (error) {
    if (tabelaFaltando(error)) {
      tabelaAusente = true;
      if (!avisoTabela) {
        avisoTabela = true;
        console.warn('[SHADOW] tabela shadow_lab ausente. Rode supabase/shadow_lab.sql no SQL Editor. A auditoria segue em apostas (__shadow_lab__) até a tabela existir.');
      }
    } else {
      console.warn(`[SHADOW] leitura: ${error.message}`);
    }
    return [];
  }
  return (data || []).map(entradaDaLinha).filter(entradaValida);
}

async function lerSentinela() {
  const { data, error } = await supabase
    .from('apostas')
    .select('metricas_resumo')
    .eq('mercado', MERCADO_SENTINELA)
    .limit(1);
  if (error) {
    console.warn(`[SHADOW] sentinela: ${error.message}`);
    return [];
  }
  const bruto = data?.[0]?.metricas_resumo;
  let pacote = bruto;
  if (typeof bruto === 'string') {
    try { pacote = JSON.parse(bruto); } catch { return []; }
  }
  return Array.isArray(pacote?.entradas) ? pacote.entradas.filter(entradaValida) : [];
}

let avisoRls = false;

async function gravarTabela(entradas) {
  if (tabelaAusente || !entradas.length) return tabelaAusente ? false : true;
  const { error } = await supabase.from(TABELA_SHADOW).upsert(entradas.map(linhaDaEntrada), { onConflict: 'id' });
  if (!error) return true;
  if (tabelaFaltando(error)) {
    tabelaAusente = true;
    if (!avisoTabela) {
      avisoTabela = true;
      console.warn('[SHADOW] tabela shadow_lab ausente. Rode supabase/shadow_lab.sql no SQL Editor. A auditoria segue em apostas (__shadow_lab__) até a tabela existir.');
    }
    return false;
  }
  if (error.code === '42501') {
    if (!avisoRls) {
      avisoRls = true;
      console.warn('[SHADOW] shadow_lab recusou a gravação (RLS). O livro segue na sentinela __shadow_lab__, a mesma origem lida pelo card.');
    }
    return false;
  }
  console.warn(`[SHADOW] upsert: ${error.message}`);
  return false;
}

async function gravarSentinela(entradas) {
  const metricas = { entradas };
  const existente = await supabase.from('apostas').select('id').eq('mercado', MERCADO_SENTINELA).limit(1);
  if (existente.error) throw new Error(existente.error.message);
  if (existente.data?.[0]?.id != null) {
    const atualizado = await supabase
      .from('apostas')
      .update({ metricas_resumo: metricas, updated_at: new Date().toISOString() })
      .eq('id', existente.data[0].id);
    if (atualizado.error) throw new Error(atualizado.error.message);
    return;
  }
  const corpo = {
    jogo: MERCADO_SENTINELA,
    mercado: MERCADO_SENTINELA,
    status: 'PENDENTE',
    metricas_resumo: metricas
  };
  let ultimo = 'Não foi possível gravar a auditoria shadow.';
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const criado = await supabase.from('apostas').insert(corpo);
    if (!criado.error) return;
    ultimo = criado.error.message || ultimo;
    const citada = String(ultimo).match(/'([^']+)'/);
    const coluna = citada ? citada[1] : '';
    if (!coluna || !Object.prototype.hasOwnProperty.call(corpo, coluna)) break;
    delete corpo[coluna];
  }
  throw new Error(ultimo);
}

export function ehSentinelaShadow(linha) {
  const mercado = String(linha?.mercado || linha?.market || linha?.marketType || '');
  const jogo = String(linha?.jogo || linha?.match || '');
  return mercado === MERCADO_SENTINELA || jogo === MERCADO_SENTINELA;
}

export async function lerEntradasShadow() {
  const [nuvem, sentinela] = await Promise.all([lerTabela(), lerSentinela()]);
  const disco = lerArquivo();
  const bruto = mesclarEntradas([disco, sentinela, nuvem]);
  const entradas = semAmostraAntigaU(bruto);
  const sentinelaSuja = sentinela.some((item) => item?.metodo === 'U' && !entradaUCalibrada(item));
  if (sentinelaSuja || entradas.length !== bruto.length) await salvarEntradasShadow(entradas);
  return entradas;
}

export async function salvarEntradasShadow(entradas) {
  const lista = semAmostraAntigaU(mesclarEntradas([entradas]));
  const naTabela = await gravarTabela(lista);
  try {
    await gravarSentinela(lista);
  } catch (erro) {
    if (!naTabela) throw erro;
    console.warn(`[SHADOW] sentinela: ${erro.message}`);
  }
  return lista;
}
