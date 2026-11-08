/**
 * Monitor ao vivo do Over Carpina 2.5.
 * Só consulta a API-Football nos marcos 46, 48 (se o intervalo atrasar), 55, 57, 59, 61, 63 e 65.
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { supabase as supabaseApostas } from './lib/supabase.js';
import { createClient } from '@supabase/supabase-js';
const getLaybackMarketData = async () => null;

const TABELA_APOSTAS = 'apostas';
const ARQUIVO_LIVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public', 'live_status.json');
const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

async function fetchSupabase(url, opcoes) {
  try {
    return await fetch(url, opcoes);
  } catch (erro) {
    const causa = erro?.cause?.message || erro?.message || 'fetch failed';
    console.log('[Monitor 2.5] Supabase sem rede:', causa);
    return new Response(JSON.stringify({ message: causa, code: 'fetch_failed' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

const supabase = (supabaseUrl.startsWith('http') && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchSupabase }
    })
  : null;

function clienteApostas() {
  return supabase || supabaseApostas;
}

function falhaDeRede(mensagem) {
  return /ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|fetch failed|fetch_failed|getaddrinfo|sem rede/i.test(String(mensagem || ''));
}

function gravarEstadoLocal(watch, snapshot, marco, decisao) {
  const casa = Number(snapshot?.golsCasa) || 0;
  const fora = Number(snapshot?.golsFora) || 0;
  const status = decisao?.statusMonitoramento || (MARCOS_2T.includes(marco) ? `MONITORANDO_${marco}` : 'MONITORANDO');
  const metricas = metricasDoSnapshot(snapshot);
  let atual = { jogos: [] };
  try {
    atual = JSON.parse(fs.readFileSync(ARQUIVO_LIVE, 'utf8'));
  } catch (_) { /* o ficheiro nasce na primeira falha de rede */ }
  const jogos = Array.isArray(atual.jogos) ? atual.jogos : [];
  const linha = {
    id: watch.nuvemId ?? null,
    partida: watch.match,
    fixture_id: watch.fixtureId ?? null,
    minuto_atual: marco,
    placar: `${casa}-${fora}`,
    status_monitoramento: status,
    metricas_resumo: metricas,
    updated_at: new Date().toISOString()
  };
  const indice = jogos.findIndex((item) => (
    (linha.fixture_id != null && String(item.fixture_id) === String(linha.fixture_id))
    || item.partida === linha.partida
  ));
  if (indice >= 0) jogos[indice] = linha;
  else jogos.push(linha);
  fs.mkdirSync(path.dirname(ARQUIVO_LIVE), { recursive: true });
  fs.writeFileSync(ARQUIVO_LIVE, JSON.stringify({ updated_at: linha.updated_at, jogos }, null, 2));
  console.log(`[Monitor 2.5] Supabase indisponível. Estado local gravado para ${watch.match}.`);
}

const MARCOS_1T = [20, 25];
const MARCOS_HT = [46, 48];
const MARCOS_2T = [55, 57, 59, 61, 63, 65];
const MARCOS_ATIVOS = MARCOS_2T;
const INTERVALO_HT_MIN = 15;

export function ehEntradaOver25(aposta) {
  const texto = `${aposta?.market || ''} ${aposta?.marketType || ''}`;
  return /acima de 2[.,]5|over\s*2[.,]5/i.test(texto);
}

export function partidaDaAposta(aposta) {
  const partes = String(aposta?.match || '').split(/\s+x\s+/i);
  if (partes.length < 2) return null;
  return { home: partes[0].trim(), away: partes.slice(1).join(' x ').trim() };
}

function normalizarNome(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|as)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nomesCompativeis(a, b) {
  const esquerda = normalizarNome(a);
  const direita = normalizarNome(b);
  if (!esquerda || !direita) return false;
  return esquerda === direita || esquerda.includes(direita) || direita.includes(esquerda);
}

export function minutoPeloKickoff(kickoffMs, agoraMs) {
  const minuto = (agoraMs - kickoffMs) / 60000;
  if (!Number.isFinite(minuto)) return null;
  if (minuto < 47) return minuto;
  if (minuto < 47 + INTERVALO_HT_MIN) return 45;
  return 45 + (minuto - (47 + INTERVALO_HT_MIN));
}

export function minutoDoAcompanhamento(watch, agoraMs) {
  if (watch?.ancora?.em && Number.isFinite(watch.ancora.elapsed)) {
    const desde = (agoraMs - watch.ancora.em) / 60000;
    if (watch.ancora.status === 'HT') {
      if (desde < INTERVALO_HT_MIN) return 45;
      return 45 + (desde - INTERVALO_HT_MIN);
    }
    return watch.ancora.elapsed + Math.max(0, desde);
  }
  if (!watch?.kickoff) return null;
  return minutoPeloKickoff(new Date(watch.kickoff).getTime(), agoraMs);
}

export function fixtureEncerrado(status) {
  const texto = String(status || '').toUpperCase();
  if (!texto) return false;
  if (texto.includes('MATCH FINISHED')) return true;
  return /(^|[^A-Z])(FT|AET|PEN)([^A-Z]|$)/.test(texto);
}

export function acompanhamentoEncerrado(minuto, elapsed) {
  if (Number.isFinite(minuto) && minuto >= 66) return true;
  if (Number.isFinite(Number(elapsed)) && Number(elapsed) > 65) return true;
  return false;
}

function diaEmSaoPaulo(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

export function diaDaAposta(aposta, watch) {
  const kickoff = watch?.kickoff ? Date.parse(watch.kickoff) : NaN;
  if (Number.isFinite(kickoff)) return diaEmSaoPaulo(kickoff);
  const local = String(aposta?.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(local)) return local;
  const criado = Date.parse(aposta?.createdAt || aposta?.created_at || '');
  if (Number.isFinite(criado)) return diaEmSaoPaulo(criado);
  return null;
}

export function apostaAnteriorAHoje(aposta, watch, hoje) {
  const dia = diaDaAposta(aposta, watch);
  return Boolean(dia && hoje && dia < hoje);
}

export function marcoDevido(minuto, feitos, precisaRetry48) {
  if (!Number.isFinite(minuto) || minuto >= 66) return null;
  const feitosSet = feitos instanceof Set ? feitos : new Set(feitos || []);
  if (minuto < MARCOS_HT[0]) {
    for (const marco of MARCOS_1T) {
      if (minuto >= marco && minuto < marco + 2 && !feitosSet.has(marco)) return marco;
    }
    return null;
  }
  if (minuto < 48) return feitosSet.has(46) ? null : 46;
  if (minuto < 55) {
    if (precisaRetry48 && minuto >= 48 && minuto < 50 && !feitosSet.has(48)) return 48;
    return null;
  }
  for (const marco of MARCOS_ATIVOS) {
    if (minuto >= marco && minuto < marco + 2 && !feitosSet.has(marco)) return marco;
  }
  return null;
}

function textoIntervalo(totalXg, totalShotsOnTarget) {
  return `🚨 OVER CARPINA 2.5 [INTERVALO]: Jogo Frio identificado (0x0, xG: ${totalXg}, Chutes no Gol: ${totalShotsOnTarget}). Recomendado CASH OUT imediato no intervalo.`;
}

export function decidirCarpina(snapshot, marco) {
  const golsCasa = Number(snapshot?.golsCasa);
  const golsFora = Number(snapshot?.golsFora);
  const casa = Number.isFinite(golsCasa) ? golsCasa : 0;
  const fora = Number.isFinite(golsFora) ? golsFora : 0;
  const totalGols = casa + fora;
  const elapsed = Number(snapshot?.elapsed);
  const minuto = Number.isFinite(elapsed) ? elapsed : marco;
  const status = String(snapshot?.status || '');

  if (totalGols >= 3) {
    return { acao: 'green', encerrar: true, statusMonitoramento: 'GREEN_TOTAL', mensagem: '✅ GREEN CONFIRMADO NO OVER 2.5!' };
  }

  if (MARCOS_1T.includes(marco)) {
    return decidirPrimeiroTempo(snapshot, casa, fora, totalGols);
  }

  const auditoriaIntervalo = marco === 46 || marco === 48;
  if (auditoriaIntervalo && status !== 'HT') {
    return { acao: 'retry-intervalo', encerrar: false, mensagem: null };
  }

  if (auditoriaIntervalo && status === 'HT') {
    if (casa === 0 && fora === 0) {
      const homeXg = Number(snapshot?.homeXg);
      const awayXg = Number(snapshot?.awayXg);
      const homeShots = Number(snapshot?.homeShotsOnTarget);
      const awayShots = Number(snapshot?.awayShotsOnTarget);
      const dadosCompletos = [homeXg, awayXg, homeShots, awayShots].every(Number.isFinite);
      if (dadosCompletos) {
        const totalXg = Number((homeXg + awayXg).toFixed(2));
        const totalShotsOnTarget = homeShots + awayShots;
        if (totalXg < 0.8 && totalShotsOnTarget <= 2) {
          return { acao: 'cashout-intervalo', encerrar: true, statusMonitoramento: 'STOP_LOSS_RECOMENDADO', mensagem: textoIntervalo(totalXg, totalShotsOnTarget) };
        }
      }
    }
    return { acao: 'manter', encerrar: false, mensagem: null };
  }

  if (minuto >= 60 && casa === 0 && fora === 0) {
    return {
      acao: 'stop-60',
      encerrar: true,
      statusMonitoramento: 'STOP_LOSS_RECOMENDADO',
      mensagem: '🛑 OVER CARPINA 2.5 [60 MINUTOS]: Partida segue 0x0. SAÍDA MANDATÓRIA (Stop-Loss). Encerrar aposta agora para resgatar valor residual.'
    };
  }

  if (minuto >= 65 && totalGols === 1 && ((casa === 1 && fora === 0) || (casa === 0 && fora === 1))) {
    return {
      acao: 'stop-65',
      encerrar: true,
      statusMonitoramento: 'STOP_LOSS_RECOMENDADO',
      mensagem: '💰 OVER CARPINA 2.5 [65 MINUTOS - LIMITE MÁXIMO]: Placar 1 gol no minuto 65. SAÍDA MANDATÓRIA. Momento de maior liquidez para resgate (35% a 45% da stake). Não segurar além deste minuto!'
    };
  }

  if (minuto >= 65) return { acao: 'encerrar', encerrar: true, statusMonitoramento: 'ENCERRADO_65', mensagem: null };
  return {
    acao: 'seguir',
    encerrar: false,
    mensagem: null,
    statusMonitoramento: MARCOS_2T.includes(marco) ? `MONITORANDO_${marco}` : 'MONITORANDO'
  };
}

function decidirPrimeiroTempo(snapshot, casa, fora, totalGols) {
  const homeXg = Number(snapshot?.homeXg);
  const awayXg = Number(snapshot?.awayXg);
  const homeShots = Number(snapshot?.homeShotsOnTarget);
  const awayShots = Number(snapshot?.awayShotsOnTarget);
  const xgTotal = [homeXg, awayXg].every(Number.isFinite) ? homeXg + awayXg : null;
  const chutes = [homeShots, awayShots].every(Number.isFinite) ? homeShots + awayShots : null;
  if (totalGols >= 1) {
    return {
      acao: 'take-profit-1t',
      encerrar: false,
      statusMonitoramento: 'TAKE_PROFIT_PRONTO',
      mensagem: 'Gol no 1T! Sugestão: Cashout defensivo (+20% a +30%) ou manter se xG > 1.2'
    };
  }
  if (casa === 0 && fora === 0 && xgTotal != null && xgTotal < 0.35 && chutes != null && chutes <= 1) {
    return {
      acao: 'stop-loss-1t',
      encerrar: false,
      statusMonitoramento: 'STOP_LOSS_RECOMENDADO',
      mensagem: "Ritmo baixo aos 20'-25' (0x0, xG baixo). Encerrar posição (-20% a -25% de perda controlada)."
    };
  }
  return {
    acao: 'pressao-1t',
    encerrar: false,
    statusMonitoramento: 'PRESSAO_ALTA_1T',
    mensagem: "0x0 com volume alto. Manter posição até 30'."
  };
}

function metricasDoSnapshot(snapshot) {
  const homeXg = Number(snapshot?.homeXg);
  const awayXg = Number(snapshot?.awayXg);
  const homeShots = Number(snapshot?.homeShotsOnTarget);
  const awayShots = Number(snapshot?.awayShotsOnTarget);
  const xg = [homeXg, awayXg].every(Number.isFinite) ? Number((homeXg + awayXg).toFixed(2)) : null;
  const chutes = [homeShots, awayShots].every(Number.isFinite) ? homeShots + awayShots : null;
  const pressaoCasa = calcularIndicePressao({ rematesAlvo: Number.isFinite(homeShots) ? homeShots : 0, cantos: Number(snapshot?.homeCorners) || 0 });
  const pressaoFora = calcularIndicePressao({ rematesAlvo: Number.isFinite(awayShots) ? awayShots : 0, cantos: Number(snapshot?.awayCorners) || 0 });
  return { xg, chutes_alvo: chutes, pressao_relativa: Number((pressaoCasa - pressaoFora).toFixed(2)) };
}

function normalizarApostaNuvem(linha) {
  if (!linha) return null;
  return {
    id: String(linha.id),
    nuvemId: linha.id,
    localBetId: null,
    match: linha.partida || '',
    market: linha.mercado || '',
    odd: Number(linha.odd),
    stake: Number(linha.stake),
    status: String(linha.status || '').toUpperCase(),
    fixtureId: linha.fixture_id || null,
    createdAt: linha.created_at || null
  };
}

async function listarPendentesOver25(ehOver25) {
  const cliente = clienteApostas();
  if (!cliente) throw new Error('Supabase indisponível.');
  const { data, error } = await cliente
    .from(TABELA_APOSTAS)
    .select('id, fixture_id, partida, mercado, odd, stake, lucro, status, created_at, updated_at')
    .eq('status', 'PENDENTE');
  if (error) throw new Error(error.message);
  return (data || []).map(normalizarApostaNuvem).filter((aposta) => aposta && ehOver25(aposta));
}

async function garantirApostaPendente(aposta) {
  const cliente = clienteApostas();
  if (!cliente) throw new Error('Supabase indisponível.');
  const agora = new Date().toISOString();
  const fixture = Number(aposta.fixtureId || aposta.fixture_id);
  const { data, error } = await cliente.from(TABELA_APOSTAS).insert({
    fixture_id: Number.isFinite(fixture) ? fixture : null,
    partida: aposta.match,
    mercado: aposta.market,
    odd: Number(aposta.odd) || null,
    stake: Number(aposta.stake) || null,
    lucro: null,
    status: 'PENDENTE',
    created_at: agora,
    updated_at: agora
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function gravarFixture(id, fixtureId) {
  const cliente = clienteApostas();
  if (!cliente) return;
  const { error } = await cliente.from(TABELA_APOSTAS).update({
    fixture_id: fixtureId,
    updated_at: new Date().toISOString()
  }).eq('id', String(id));
  if (error) throw new Error(error.message);
}

async function encerrarApostaNuvem(id, { status, lucro }) {
  const cliente = clienteApostas();
  if (!cliente) return;
  const payload = { status, updated_at: new Date().toISOString() };
  if (status === 'PENDENTE') payload.lucro = null;
  else if (Number.isFinite(Number(lucro))) payload.lucro = Number(Number(lucro).toFixed(2));
  const { error } = await cliente.from(TABELA_APOSTAS).update(payload).eq('id', String(id));
  if (error) throw new Error(error.message);
}

async function gravarMarcoNoSupabase(watch, snapshot, marco, decisao) {
  const cliente = clienteApostas();
  if (!cliente) {
    gravarEstadoLocal(watch, snapshot, marco, decisao);
    return;
  }
  const casa = Number(snapshot?.golsCasa) || 0;
  const fora = Number(snapshot?.golsFora) || 0;
  const status = decisao?.statusMonitoramento || (MARCOS_2T.includes(marco) ? `MONITORANDO_${marco}` : 'MONITORANDO');
  const metricas = metricasDoSnapshot(snapshot);
  const agoraIso = new Date().toISOString();
  const linha = {
    fixture_id: watch.fixtureId,
    minute: marco,
    minuto_atual: marco,
    placar: `${casa}-${fora}`,
    status_monitoramento: status,
    metricas_resumo: metricas,
    relative_pressure: metricas.pressao_relativa,
    home_shots_on_target: Number(snapshot?.homeShotsOnTarget) || 0,
    away_shots_on_target: Number(snapshot?.awayShotsOnTarget) || 0,
    updated_at: agoraIso
  };
  let gravou = false;
  const { error } = await cliente.from('match_timeline').upsert(linha, { onConflict: 'fixture_id,minute' });
  if (error) {
    const inserido = await cliente.from('match_timeline').insert(linha);
    if (inserido.error) console.log('[Monitor 2.5] match_timeline não gravou:', inserido.error.message);
    else gravou = true;
  } else {
    gravou = true;
  }
  const patch = {
    minuto_atual: marco,
    placar: `${casa}-${fora}`,
    status_monitoramento: status,
    metricas_resumo: metricas,
    updated_at: agoraIso
  };
  const consulta = watch.nuvemId != null
    ? cliente.from(TABELA_APOSTAS).update(patch).eq('id', String(watch.nuvemId))
    : cliente.from(TABELA_APOSTAS).update(patch).eq('partida', watch.match).eq('status', 'PENDENTE');
  const atualizado = await consulta;
  if (atualizado.error) console.log('[Monitor 2.5] apostas não atualizou:', atualizado.error.message);
  else gravou = true;
  if (gravou) console.log("📡 [Monitor 2.5] Marco " + marco + "' atualizado no Supabase.");
  else if (falhaDeRede(atualizado.error?.message) || falhaDeRede(error?.message)) {
    gravarEstadoLocal(watch, snapshot, marco, decisao);
  }
}

function lerJson(arquivo, fallback) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function gravarJson(arquivo, dados) {
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
}

function lucroGreen(aposta) {
  const stake = Number(Number(aposta.stake).toFixed(2)) || 0;
  const odd = Number(aposta.odd) || 0;
  const profit = Number(((stake * odd) - stake).toFixed(2));
  return { stake, odd, profit, returnedAmount: stake * odd };
}

export function iniciarMonitorCarpina(opcoes) {
  const arquivoBets = opcoes.arquivoBets;
  const arquivoEstado = opcoes.arquivoEstado || path.resolve(path.dirname(arquivoBets), 'carpina_monitor.json');
  const consultarFixture = opcoes.consultarFixture;
  const listarDia = opcoes.listarDia;
  const enviarTelegram = opcoes.enviarTelegram;
  const agora = opcoes.agora || (() => Date.now());
  const intervaloMs = opcoes.intervaloMs || 15000;
  const watches = new Map();
  const fixturesBloqueados = new Set();
  let ultimoVinculo = 0;
  let timer = null;
  let cicloEmAndamento = false;

  const persistir = () => {
    const saida = {};
    for (const [id, watch] of watches) {
      saida[id] = { ...watch, feitos: [...(watch.feitos || [])] };
    }
    gravarJson(arquivoEstado, { fixturesBloqueados: [...fixturesBloqueados], watches: saida });
  };

  const carregarEstado = () => {
    const salvo = lerJson(arquivoEstado, { watches: {} });
    for (const id of salvo.fixturesBloqueados || []) fixturesBloqueados.add(String(id));
    for (const [id, watch] of Object.entries(salvo.watches || {})) {
      const atual = { ...watch, feitos: new Set(watch.feitos || []) };
      if (atual.encerrado && atual.fixtureId != null) fixturesBloqueados.add(String(atual.fixtureId));
      watches.set(id, atual);
    }
  };

  const bloquearFixture = (watch) => {
    if (watch?.fixtureId == null) return;
    fixturesBloqueados.add(String(watch.fixtureId));
  };

  const gravarGreenLocal = (betId, financeiro) => {
    const banco = lerJson(arquivoBets, { bets: [], bankroll: 335 });
    const aposta = (banco.bets || []).find((item) => item.id === betId);
    if (!aposta || String(aposta.status).toUpperCase() !== 'PENDING') return false;
    aposta.status = 'GREEN';
    aposta.returnedAmount = financeiro.returnedAmount;
    aposta.realProfit = financeiro.profit;
    banco.bankroll = Number((Number(banco.bankroll || 0) + financeiro.profit).toFixed(2));
    gravarJson(arquivoBets, banco);
    return true;
  };

  const registrarGreen = async (watch) => {
    const financeiro = lucroGreen({ stake: watch.stake, odd: watch.odd });
    if (watch.nuvemId != null) {
      await encerrarApostaNuvem(watch.nuvemId, { status: 'GREEN', lucro: financeiro.profit });
    }
    if (watch.betId) gravarGreenLocal(watch.betId, financeiro);
  };

  const registrarStopLoss = async (watch) => {
    if (watch.nuvemId == null) return;
    await encerrarApostaNuvem(watch.nuvemId, { status: 'STOP_LOSS', lucro: null });
  };

  const encerrar = (watch, motivo) => {
    watch.encerrado = true;
    watch.motivo = motivo;
    console.log(`📴 [CARPINA] ${watch.match} encerrado (${motivo}).`);
  };

  const sincronizar = async () => {
    const banco = lerJson(arquivoBets, { bets: [] });
    const locais = (banco.bets || []).filter((aposta) => String(aposta.status).toUpperCase() === 'PENDING' && ehEntradaOver25(aposta));
    let pendentes = [];
    let nuvemOk = false;
    try {
      pendentes = await listarPendentesOver25(ehEntradaOver25);
      nuvemOk = true;
    } catch (erro) {
      console.log('[CARPINA] Leitura no Supabase indisponível:', erro.message);
      pendentes = locais.map((aposta) => ({
        id: String(aposta.id),
        nuvemId: null,
        localBetId: String(aposta.id),
        match: aposta.match,
        market: aposta.market,
        date: aposta.date || null,
        odd: Number(aposta.odd),
        stake: Number(aposta.stake),
        status: 'PENDENTE',
        fixtureId: null
      }));
    }
    if (nuvemOk) {
      const chavePartida = (aposta) => `${String(aposta.match || '').trim().toLowerCase()}|${String(aposta.market || '').trim().toLowerCase()}`;
      const fechadas = (banco.bets || []).filter((aposta) => {
        const status = String(aposta.status || '').toUpperCase();
        return ehEntradaOver25(aposta) && (status === 'GREEN' || status === 'RED' || status === 'CASHOUT');
      });
      const aindaPendentes = [];
      for (const aposta of pendentes) {
        const local = fechadas.find((item) => chavePartida(item) === chavePartida(aposta));
        if (!local) {
          aindaPendentes.push(aposta);
          continue;
        }
        try {
          await encerrarApostaNuvem(aposta.nuvemId ?? aposta.id, {
            status: String(local.status).toUpperCase(),
            lucro: Number(local.realProfit)
          });
          const watch = watches.get(aposta.id);
          if (watch && !watch.encerrado) encerrar(watch, String(local.status).toLowerCase());
          bloquearFixture(watch);
          console.log(`[CARPINA] ${aposta.match} saiu da fila: ${local.status} já está na planilha.`);
        } catch (erro) {
          console.log('[CARPINA] Não foi possível gravar o status da planilha no Supabase:', erro.message);
          aindaPendentes.push(aposta);
        }
      }
      pendentes = aindaPendentes;
      for (const aposta of locais) {
        const ja = pendentes.find((item) => chavePartida(item) === chavePartida({ match: aposta.match, market: aposta.market }));
        if (ja) {
          ja.localBetId = String(aposta.id);
          if (aposta.date) ja.date = aposta.date;
          continue;
        }
        try {
          const novoId = await garantirApostaPendente(aposta);
          pendentes.push({
            id: String(novoId),
            nuvemId: novoId,
            localBetId: String(aposta.id),
            match: aposta.match,
            market: aposta.market,
            date: aposta.date || null,
            odd: Number(aposta.odd),
            stake: Number(aposta.stake),
            status: 'PENDENTE',
            fixtureId: null
          });
        } catch (erro) {
          console.log('[CARPINA] INSERT no Supabase recusado:', erro.message);
          pendentes.push({
            id: String(aposta.id),
            nuvemId: null,
            localBetId: String(aposta.id),
            match: aposta.match,
            market: aposta.market,
            date: aposta.date || null,
            odd: Number(aposta.odd),
            stake: Number(aposta.stake),
            status: 'PENDENTE',
            fixtureId: null
          });
        }
      }
    }
    const hoje = diaEmSaoPaulo(agora());
    pendentes = pendentes.filter((aposta) => {
      const watch = watches.get(aposta.id);
      if (!apostaAnteriorAHoje(aposta, watch, hoje)) return true;
      if (watch && !watch.encerrado) encerrar(watch, 'data-anterior');
      bloquearFixture(watch);
      return false;
    });
    const idsPendentes = new Set(pendentes.map((aposta) => aposta.id));

    for (const [id, watch] of watches) {
      if (!idsPendentes.has(id) && watch && !watch.encerrado) encerrar(watch, 'encerrada');
    }

    const semVinculo = pendentes.filter((aposta) => {
      const watch = watches.get(aposta.id);
      return !watch?.fixtureId && !watch?.encerrado;
    });
    let fixturesDoDia = null;
    if (semVinculo.length && agora() - ultimoVinculo > 30 * 60 * 1000) {
      ultimoVinculo = agora();
      try {
        const data = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Sao_Paulo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date(agora()));
        fixturesDoDia = await listarDia(data);
      } catch (erro) {
        console.log('[CARPINA] Erro na API-Football ao listar os jogos do dia:', erro.message);
        fixturesDoDia = [];
      }
    }

    for (const aposta of pendentes) {
      const times = partidaDaAposta(aposta);
      if (!times) continue;
      const atual = watches.get(aposta.id) || {
        betId: aposta.localBetId || null,
        nuvemId: aposta.nuvemId ?? null,
        match: aposta.match,
        fixtureId: aposta.fixtureId || null,
        stake: Number(aposta.stake) || 0,
        odd: Number(aposta.odd) || 0,
        kickoff: null,
        feitos: new Set(),
        precisaRetry48: false,
        encerrado: false,
        ancora: null
      };
      atual.betId = aposta.localBetId || atual.betId || null;
      atual.nuvemId = aposta.nuvemId ?? atual.nuvemId ?? null;
      atual.match = aposta.match;
      atual.stake = Number(aposta.stake) || atual.stake || 0;
      atual.odd = Number(aposta.odd) || atual.odd || 0;
      if (!atual.fixtureId && aposta.fixtureId && !fixturesBloqueados.has(String(aposta.fixtureId))) {
        atual.fixtureId = aposta.fixtureId;
      }
      if (!atual.fixtureId && fixturesDoDia) {
        const jogo = fixturesDoDia.find((item) => nomesCompativeis(item.home, times.home) && nomesCompativeis(item.away, times.away));
        if (jogo && !fixturesBloqueados.has(String(jogo.fixtureId))) {
          atual.fixtureId = jogo.fixtureId;
          atual.kickoff = jogo.kickoff;
          if (aposta.nuvemId != null) {
            gravarFixture(aposta.nuvemId, jogo.fixtureId).catch((erro) => {
              console.log('[CARPINA] fixture_id não gravado na nuvem:', erro.message);
            });
          }
          console.log(`🔗 [CARPINA] ${aposta.match} vinculado ao fixture ${jogo.fixtureId}.`);
        }
      }
      const minuto = minutoDoAcompanhamento(atual, agora());
      const estourouMinuto = acompanhamentoEncerrado(minuto, atual.ancora?.elapsed);
      const fixtureBloqueado = atual.fixtureId != null && fixturesBloqueados.has(String(atual.fixtureId));
      if (estourouMinuto || fixtureBloqueado) {
        if (!atual.encerrado) encerrar(atual, estourouMinuto ? 'apos-65' : 'fixture-encerrado');
        bloquearFixture(atual);
      }
      watches.set(aposta.id, atual);
    }
    const ativos = pendentes.filter((aposta) => {
      const watch = watches.get(aposta.id);
      return watch && !watch.encerrado;
    });
    console.log(`Consultando Supabase... ${ativos.length} apostas PENDENTES encontradas.`);
    for (const aposta of ativos) {
      const watch = watches.get(aposta.id);
      const minuto = minutoDoAcompanhamento(watch, agora());
      const minutoTexto = Number.isFinite(minuto) ? String(Math.floor(minuto)) : '—';
      const status = minuto != null && minuto >= 46 ? 'Em andamento' : "Silêncio até 46'";
      console.log(`Monitorando jogo: ${aposta.match} | Minuto atual na API: ${minutoTexto} | Status: ${status}`);
    }
    persistir();
  };

  const processarWatch = async (watch) => {
    if (watch.encerrado) return;
    if (watch.fixtureId != null && fixturesBloqueados.has(String(watch.fixtureId))) {
      encerrar(watch, 'fixture-encerrado');
      return;
    }
    const minuto = minutoDoAcompanhamento(watch, agora());
    if (acompanhamentoEncerrado(minuto, watch.ancora?.elapsed)) {
      bloquearFixture(watch);
      encerrar(watch, 'apos-65');
      return;
    }
    if (!watch.fixtureId || minuto == null) return;
    const marco = marcoDevido(minuto, watch.feitos, watch.precisaRetry48);
    if (marco == null) return;

    watch.feitos.add(marco);
    let snapshot;
    try {
      snapshot = await consultarFixture(watch.fixtureId);
    } catch (erro) {
      watch.feitos.delete(marco);
      console.log(`[CARPINA] Erro na API-Football ao consultar o fixture ${watch.fixtureId}:`, erro.message);
      return;
    }
    if (!snapshot) {
      console.log(`[CARPINA] Erro na API-Football: o fixture ${watch.fixtureId} não foi devolvido.`);
      return;
    }
    if (fixtureEncerrado(snapshot.status)) {
      bloquearFixture(watch);
      const gols = (Number(snapshot.golsCasa) || 0) + (Number(snapshot.golsFora) || 0);
      if (gols >= 3) {
        try {
          await enviarTelegram(`${watch.match}\n✅ GREEN CONFIRMADO NO OVER 2.5!`);
          await registrarGreen(watch);
        } catch (erro) {
          console.log('[CARPINA] Jogo finalizado sem gravar o GREEN:', erro.message);
        }
      }
      encerrar(watch, 'ft');
      return;
    }
    if (acompanhamentoEncerrado(snapshot.elapsed, snapshot.elapsed)) bloquearFixture(watch);
    watch.kickoff = watch.kickoff || snapshot.kickoff;
    watch.ancora = {
      elapsed: Number.isFinite(snapshot.elapsed) ? snapshot.elapsed : marco,
      status: snapshot.status,
      em: agora()
    };
    const decisao = decidirCarpina(snapshot, marco);
    try {
      await gravarMarcoNoSupabase(watch, snapshot, marco, decisao);
    } catch (erro) {
      console.log('[Monitor 2.5] Falha ao gravar o marco:', erro.message);
    }
    if (marco === 46 && snapshot.status !== 'HT') watch.precisaRetry48 = true;
    if (decisao.mensagem) {
      const texto = `${watch.match}\n${decisao.mensagem}`;
      try {
        await enviarTelegram(texto);
        console.log(`📣 [CARPINA] ${watch.match}: ${decisao.acao}`);
      } catch (erro) {
        console.log('[CARPINA] Telegram não enviado:', erro.message);
      }
    }
    try {
      if (decisao.acao === 'green') await registrarGreen(watch);
      if (decisao.acao === 'cashout-intervalo' || decisao.acao === 'stop-60' || decisao.acao === 'stop-65') {
        await registrarStopLoss(watch);
      }
    } catch (erro) {
      console.log('[CARPINA] Gravação no Supabase falhou:', erro.message);
    }
    if (decisao.encerrar) {
      bloquearFixture(watch);
      encerrar(watch, decisao.acao);
    }
  };

  const ciclo = async () => {
    if (cicloEmAndamento) return;
    cicloEmAndamento = true;
    try {
      await sincronizar();
      for (const watch of watches.values()) {
        await processarWatch(watch);
      }
      persistir();
    } catch (erro) {
      console.log('[CARPINA] Ciclo interrompido:', erro.message);
    } finally {
      cicloEmAndamento = false;
    }
  };

  carregarEstado();
  timer = setInterval(() => {
    ciclo();
  }, intervaloMs);
  ciclo();
  console.log('🟢 [CARPINA] Monitor Over 2.5 ativo. Consultas em 20, 25, 46, 48 e 55–65.');

  return {
    parar() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    sincronizar,
    watches
  };
}

/**
 * Módulo Quant: Cálculo do Índice de Pressão (PI)
 */
function calcularIndicePressao(stats) {
  const rematesAlvo = stats.rematesAlvo || 0;
  const rematesFora = stats.rematesFora || 0;
  const cantos = stats.cantos || 0;
  const ataquesPerigosos = stats.ataquesPerigosos || 0;

  return (rematesAlvo * 3.0) + (rematesFora * 1.5) + (cantos * 2.0) + (ataquesPerigosos * 0.4);
}

/**
 * Grava o minuto ao vivo na tabela match_timeline para alimentar o gráfico
 */
export async function registarMinutoLive(fixtureId, minuto, dadosCasa, dadosFora) {
  try {
    const piCasa = calcularIndicePressao(dadosCasa);
    const piFora = calcularIndicePressao(dadosFora);
    const pressaoRelativa = piCasa - piFora;

    const { error } = await supabase.from('match_timeline').insert({
      fixture_id: fixtureId,
      minute: minuto,
      home_pressure: piCasa,
      away_pressure: piFora,
      relative_pressure: pressaoRelativa,
      home_shots_on_target: dadosCasa.rematesAlvo || 0,
      away_shots_on_target: dadosFora.rematesAlvo || 0,
      home_corners: dadosCasa.cantos || 0,
      away_corners: dadosFora.cantos || 0,
      home_possession: dadosCasa.posse || 50,
      away_possession: dadosFora.posse || 50
    });

    if (error) console.error('[Supabase Timeline Error]:', error.message);
  } catch (err) {
    console.error('[Erro registarMinutoLive]:', err.message);
  }
}

/**
 * Auditoria da Layback para Over 0.5 HT
 */
export async function auditarLaybackOverHT(fixtureId, marketId, minuto, placar) {
  if (minuto < 12 || minuto > 26 || placar !== '0-0') return;

  const dadosMercado = await getLaybackMarketData(marketId);
  if (!dadosMercado) return;

  const oddOver = dadosMercado.overOdd;
  if (oddOver && oddOver >= 1.65 && oddOver <= 1.98) {
    console.log(`🎯 [SINAL OVER 0.5 HT] Minuto: ${minuto}' | Odd: ${oddOver} | Liq: $${dadosMercado.liquidity}`);
    
    await supabase.from('trade_signals').insert({
      fixture_id: fixtureId,
      market_type: 'OVER_05_HT',
      minute_triggered: minuto,
      price_triggered: oddOver,
      liquidity_available: dadosMercado.liquidity,
      trigger_reason: 'Assimetria Over 0.5 HT detectada sem stream'
    });
  }
}

const executadoDiretamente = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (executadoDiretamente) {
  const require = createRequire(import.meta.url);
  const { obterFixtureAoVivo, listarFixturesDoDia } = require('./services/apiFootball.js');
  const arquivoBets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'bets_database.json');
  iniciarMonitorCarpina({
    arquivoBets,
    consultarFixture: obterFixtureAoVivo,
    listarDia: listarFixturesDoDia,
    enviarTelegram: async (texto) => {
      console.log(`[CARPINA] ${texto}`);
    }
  });
}