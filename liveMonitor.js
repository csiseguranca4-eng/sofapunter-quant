/**
 * Monitor ao vivo de Over 1.5 e Over 2.5.
 * 1º tempo: 20, 30, 35 e 40 (±1 min). 2º tempo: 46, 48 (se o intervalo atrasar), 55, 57, 59, 61, 63 e 65.
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
dns.setDefaultResultOrder('ipv4first');

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { supabase as supabaseApostas } from './lib/supabase.js';
import { createClient } from '@supabase/supabase-js';
const getLaybackMarketData = async () => null;
const { deveIgnorarPartida } = createRequire(import.meta.url)('./services/filtroLigas.js');

const TABELA_APOSTAS = 'apostas';
const ARQUIVO_LIVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public', 'live_status.json');
const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

let supabaseIndisponivelAte = 0;

function pausarSupabase() {
  supabaseIndisponivelAte = Date.now() + 60000;
}

async function fetchSupabase(entrada, opcoes = {}) {
  if (Date.now() < supabaseIndisponivelAte) {
    return new Response(JSON.stringify({ message: 'ETIMEDOUT', code: 'fetch_failed' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), 4000);
  if (opcoes.signal) {
    if (opcoes.signal.aborted) controlador.abort();
    else opcoes.signal.addEventListener('abort', () => controlador.abort(), { once: true });
  }
  try {
    return await fetch(entrada, { ...opcoes, signal: controlador.signal });
  } catch (erro) {
    pausarSupabase();
    const causa = erro?.name === 'AbortError' ? 'ETIMEDOUT' : (erro?.cause?.message || erro?.message || 'fetch failed');
    return new Response(JSON.stringify({ message: causa, code: 'fetch_failed' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    clearTimeout(timer);
  }
}

const supabase = (supabaseUrl.startsWith('http') && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchSupabase }
    })
  : null;

function clienteApostas() {
  if (Date.now() < supabaseIndisponivelAte) return null;
  return supabase || supabaseApostas;
}

function falhaDeRede(mensagem) {
  return /ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|fetch failed|fetch_failed|getaddrinfo|sem rede/i.test(String(mensagem || ''));
}

function gravarEstadoLocal(watch, snapshot, marco, decisao) {
  const casa = Number(snapshot?.golsCasa) || 0;
  const fora = Number(snapshot?.golsFora) || 0;
  const status = watch.flag_jogo_esfriou
    ? 'JOGO_ESFRIOU'
    : (decisao?.statusMonitoramento || (MARCOS_2T.includes(marco) ? `MONITORANDO_${marco}` : 'MONITORANDO'));
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
    pontosPressao: Array.isArray(watch.pontosPressao) ? watch.pontosPressao : [],
    flag_jogo_esfriou: watch.flag_jogo_esfriou === true,
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
}

const MARCOS_1T = [20, 30, 35, 40];
const MARCOS_HT = [46, 48];
const MARCOS_2T = [55, 57, 59, 61, 63, 65];
const MARCOS_ATIVOS = MARCOS_2T;
const INTERVALO_HT_MIN = 15;

function textoMercado(aposta) {
  return `${aposta?.market || ''} ${aposta?.marketType || ''} ${aposta?.tipo || ''} ${aposta?.mercado || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function linhaDeGols(aposta, linha) {
  const texto = textoMercado(aposta).toLowerCase();
  const numero = String(linha).replace('.', '[.,]');
  return new RegExp(`(?:over|acima\\s+de|acima)\\s*${numero}(?!\\d)`, 'i').test(texto);
}

export function ehEntradaOver15(aposta) {
  return linhaDeGols(aposta, '1.5');
}

export function ehEntradaOver25(aposta) {
  return linhaDeGols(aposta, '2.5');
}

export function ehEntradaMonitorada(aposta) {
  return ehEntradaOver15(aposta) || ehEntradaOver25(aposta);
}

export function rotuloMercadoMonitorado(aposta) {
  if (ehEntradaOver25(aposta)) return 'Over 2.5';
  if (ehEntradaOver15(aposta)) return 'Over 1.5';
  return 'Over';
}

export function partidaDaAposta(aposta) {
  const partes = String(aposta?.match || '').split(/\s+x\s+/i);
  if (partes.length < 2) return null;
  return { home: partes[0].trim(), away: partes.slice(1).join(' x ').trim() };
}

function partidaIgnorada(aposta) {
  const times = partidaDaAposta(aposta);
  return deveIgnorarPartida(
    aposta?.league || aposta?.liga || '',
    times?.home || aposta?.home || '',
    times?.away || aposta?.away || ''
  );
}

function confrontoIgnorado(jogo) {
  return deveIgnorarPartida(jogo?.league || jogo?.liga || '', jogo?.home, jogo?.away);
}

function normalizarNome(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(fc|cf|sc|ac|as|ec|cd|ud|fk|sk|afc|cfc)\b/g, '')
    .replace(/\b(women|woman|feminino|feminina|ladies|lady|femenino|femenina|frau|frauen)\b/g, '')
    .replace(/\bcologne\b/g, 'koln')
    .replace(/\bcolonia\b/g, 'koln')
    .replace(/\bkoeln\b/g, 'koln')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nomesCompativeis(a, b) {
  const esquerda = normalizarNome(a);
  const direita = normalizarNome(b);
  if (!esquerda || !direita) return false;
  if (esquerda === direita || esquerda.includes(direita) || direita.includes(esquerda)) return true;
  const chaves = (nome) => nome.split(' ').filter((parte) => parte.length >= 4);
  const tokensA = chaves(esquerda);
  const tokensB = chaves(direita);
  if (!tokensA.length || !tokensB.length) return false;
  return tokensA.some((token) => tokensB.some((outro) => outro.includes(token) || token.includes(outro)));
}

export function fixtureValido(id) {
  return fixtureIdParaColuna(id) != null;
}

export function idLinhaSupabase(id) {
  const texto = String(id ?? '').trim();
  if (!/^\d+$/.test(texto)) return null;
  const numero = Number(texto);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

export function fixtureIdParaColuna(valor) {
  if (typeof valor === 'number') {
    return Number.isSafeInteger(valor) && valor > 0 ? valor : null;
  }
  const texto = String(valor ?? '').trim();
  if (!texto || /[a-z]/i.test(texto)) return null;
  const digitos = texto.replace(/\D/g, '');
  if (!digitos || digitos !== texto) return null;
  const numero = Number(digitos);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

const cacheFixturesDia = new Map();
const CACHE_DIA_MS = 5 * 60 * 1000;

export function dataConsultaFixture(aposta, agoraMs = Date.now()) {
  const local = String(aposta?.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(local)) return local;
  const criado = Date.parse(aposta?.createdAt || aposta?.created_at || '');
  if (Number.isFinite(criado)) return diaEmSaoPaulo(criado);
  return diaEmSaoPaulo(agoraMs);
}

export async function listarFixturesComCache(data, listarDia, agoraMs = Date.now(), opcoes = {}) {
  const chave = String(data || '');
  const salvo = cacheFixturesDia.get(chave);
  if (!opcoes.ignorarCache && salvo && agoraMs - salvo.em < CACHE_DIA_MS) return salvo.jogos;
  const jogos = await listarDia(chave);
  const lista = Array.isArray(jogos) ? jogos : [];
  cacheFixturesDia.set(chave, { em: agoraMs, jogos: lista });
  return lista;
}

export function localizarFixture(jogos, mandante, visitante) {
  const candidatos = (Array.isArray(jogos) ? jogos : []).filter((jogo) => (
    nomesCompativeis(jogo?.home, mandante) && nomesCompativeis(jogo?.away, visitante)
  ));
  return candidatos.find((jogo) => !fixtureEncerrado(jogo?.status)) || candidatos[0] || null;
}

export async function garantirFixtureId(aposta, dependencias) {
  const times = partidaDaAposta(aposta);
  if (deveIgnorarPartida(aposta?.league || aposta?.liga || '', times?.home || '', times?.away || '')) return null;
  const fixtureInformado = fixtureIdParaColuna(aposta?.fixtureId || aposta?.fixture_id);
  if (fixtureInformado != null) {
    return { fixtureId: fixtureInformado, kickoff: aposta.kickoff || null };
  }
  const listarDia = dependencias?.listarDia;
  if (!times || typeof listarDia !== 'function') return null;
  const agoraMs = dependencias.agora ? dependencias.agora() : Date.now();
  const datas = [dataConsultaFixture(aposta, agoraMs)];
  const hoje = diaEmSaoPaulo(agoraMs);
  if (!datas.includes(hoje)) datas.push(hoje);
  let jogo = null;
  for (const data of datas) {
    let jogos = [];
    try {
      jogos = (await listarFixturesComCache(data, listarDia, agoraMs)).filter((jogo) => !confrontoIgnorado(jogo));
    } catch (erro) {
      console.log('[CARPINA] Erro na API-Football ao listar os jogos do dia:', erro.message);
      continue;
    }
    jogo = localizarFixture(jogos, times.home, times.away);
    if (jogo && preJogoAtrasado(jogo, agoraMs)) {
      try {
        const frescos = (await listarFixturesComCache(data, listarDia, agoraMs, { ignorarCache: true })).filter((item) => !confrontoIgnorado(item));
        jogo = localizarFixture(frescos, times.home, times.away) || jogo;
      } catch (erro) {
        console.log('[CARPINA] Erro na API-Football ao atualizar o jogo atrasado:', erro.message);
      }
    }
    if (jogo && statusEmAndamento(jogo)) break;
  }
  if (!statusEmAndamento(jogo) && typeof dependencias.listarAoVivo === 'function') {
    try {
      const aoVivo = (await dependencias.listarAoVivo()).filter((item) => !confrontoIgnorado(item));
      const fresco = localizarFixture(aoVivo, times.home, times.away);
      if (fresco && statusEmAndamento(fresco)) jogo = fresco;
    } catch (erro) {
      console.log('[CARPINA] Erro na API-Football ao listar os jogos ao vivo:', erro.message);
    }
  }
  if (!fixtureValido(jogo?.fixtureId)) return null;
  const idNuvem = idLinhaSupabase(aposta.nuvemId ?? aposta.id);
  if (idNuvem != null && typeof dependencias.gravarFixture === 'function') {
    await dependencias.gravarFixture(idNuvem, jogo.fixtureId);
  }
  console.log(`[CARPINA AUTO-LINK] Jogo "${times.home} x ${times.away}" vinculado com sucesso ao fixture ID ${jogo.fixtureId}`);
  return { fixtureId: Number(jogo.fixtureId), kickoff: jogo.kickoff || null };
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
  if (Number.isFinite(minuto) && minuto >= 72) return true;
  if (Number.isFinite(Number(elapsed)) && Number(elapsed) > 71) return true;
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

export function statusCurto(snapshot) {
  const direto = String(snapshot?.statusShort || '').trim().toUpperCase();
  if (direto) return direto;
  return String(snapshot?.status || '').trim().toUpperCase().split(/\s+/)[0] || '';
}

export function horaDoKickoff(iso) {
  const data = new Date(iso || '');
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  });
}

const STATUS_EM_ANDAMENTO = new Set(['1H', '2H', 'HT', 'LIVE', 'ET', 'BT', 'INT', 'P']);

export function statusEmAndamento(snapshot) {
  return STATUS_EM_ANDAMENTO.has(statusCurto(snapshot));
}

function timestampInicioApi(snapshot) {
  const bruto = Number(snapshot?.timestamp ?? snapshot?.fixture?.timestamp);
  if (Number.isFinite(bruto) && bruto > 0) return bruto > 1e12 ? bruto : bruto * 1000;
  const iso = Date.parse(snapshot?.kickoff || '');
  return Number.isFinite(iso) ? iso : null;
}

export function preJogoAtrasado(snapshot, agoraMs = Date.now()) {
  const curto = statusCurto(snapshot);
  if (curto && curto !== 'NS' && curto !== 'TBD') return false;
  const kickoff = Date.parse(snapshot?.kickoff || '');
  return Number.isFinite(kickoff) && agoraMs >= kickoff;
}

export function snapshotDoFeed1win(jogo, agoraMs = Date.now()) {
  if (!jogo?.aoVivo) return null;
  const kickoffMs = Date.parse(jogo.kickoff || '');
  if (!Number.isFinite(kickoffMs) || agoraMs < kickoffMs) return null;
  const minutoBruto = (agoraMs - kickoffMs) / 60000;
  let statusShort = '1H';
  let elapsed = minutoBruto;
  if (minutoBruto >= 47 && minutoBruto < 47 + INTERVALO_HT_MIN) {
    statusShort = 'HT';
    elapsed = 45;
  } else if (minutoBruto >= 47 + INTERVALO_HT_MIN) {
    statusShort = '2H';
    elapsed = 45 + (minutoBruto - (47 + INTERVALO_HT_MIN));
  }
  return {
    fixtureId: null,
    status: statusShort,
    statusShort,
    elapsed: Math.floor(elapsed),
    kickoff: new Date(kickoffMs).toISOString(),
    home: jogo.home || '',
    away: jogo.away || '',
    homeAttacks1win: jogo.homeAttacks ?? null,
    awayAttacks1win: jogo.awayAttacks ?? null,
    homeDangerousAttacks: jogo.homeDangerous ?? null,
    awayDangerousAttacks: jogo.awayDangerous ?? null,
    homeMomentum: jogo.homeMomentum ?? null,
    awayMomentum: jogo.awayMomentum ?? null,
    golsCasa: null,
    golsFora: null,
    placarConhecido: false,
    fonte: '1win'
  };
}

export function linhaRelogio(match, snapshot) {
  const curto = statusCurto(snapshot);
  const hora = horaDoKickoff(snapshot?.kickoff);
  if (curto === 'NS' && hora) {
    return `Monitorando jogo: ${match} | Minuto atual na API: Pré-jogo (Inicia às ${hora}) | Status: Silêncio até 20'`;
  }
  if (['1H', 'HT', '2H', 'ET', 'BT', 'LIVE', 'INT', 'P'].includes(curto)) {
    const minuto = Number(snapshot?.elapsed);
    const texto = Number.isFinite(minuto) ? `${minuto}'` : 'sem cronômetro';
    return `Monitorando jogo: ${match} | Minuto atual na API: ${texto} | Status: Em andamento`;
  }
  return `Monitorando jogo: ${match} | Minuto atual na API: Pré-jogo | Status: Aguardando Início (NS)`;
}

const MARCOS_RELOGIO = new Set([20, 30, 35, 40, 46, 55, 60]);

export function apostaAnteriorAHoje(aposta, watch, hoje) {
  const dia = diaDaAposta(aposta, watch);
  return Boolean(dia && hoje && dia < hoje);
}

export function marcoDevido(minuto, feitos, precisaRetry48) {
  if (!Number.isFinite(minuto) || minuto >= 72) return null;
  const feitosSet = feitos instanceof Set ? feitos : new Set(feitos || []);
  if (minuto < MARCOS_HT[0]) {
    for (const marco of MARCOS_1T) {
      if (minuto >= marco - 1 && minuto < marco + 2 && !feitosSet.has(marco)) return marco;
    }
    return null;
  }
  if (minuto < 48) return feitosSet.has(46) ? null : 46;
  if (minuto < 55) {
    if (minuto >= 48 && minuto < 50 && !feitosSet.has(48)) return 48;
    if (precisaRetry48 && minuto >= 48 && minuto < 50 && !feitosSet.has(48)) return 48;
    return null;
  }
  for (const marco of MARCOS_ATIVOS) {
    if (minuto >= marco && minuto < marco + 2 && !feitosSet.has(marco)) return marco;
  }
  if (minuto >= 70 && minuto < 72 && !feitosSet.has(70)) return 70;
  return null;
}

function textoIntervalo(totalXg, totalShotsOnTarget) {
  return `🚨 OVER CARPINA 2.5 [INTERVALO]: Jogo Frio identificado (0x0, xG: ${totalXg}, Chutes no Gol: ${totalShotsOnTarget}). Recomendado CASH OUT imediato no intervalo.`;
}

export function decidirCarpina(snapshot, marco, mercado) {
  const golsCasa = Number(snapshot?.golsCasa);
  const golsFora = Number(snapshot?.golsFora);
  const casa = Number.isFinite(golsCasa) ? golsCasa : 0;
  const fora = Number.isFinite(golsFora) ? golsFora : 0;
  const totalGols = casa + fora;
  const elapsed = Number(snapshot?.elapsed);
  const minuto = Number.isFinite(elapsed) ? elapsed : marco;
  const status = String(snapshot?.status || '');
  const over15 = ehEntradaOver15({ market: mercado }) && !ehEntradaOver25({ market: mercado });

  if (over15 && totalGols >= 2) {
    return { acao: 'green', encerrar: true, statusMonitoramento: 'GREEN_TOTAL', mensagem: '✅ GREEN CONFIRMADO NO OVER 1.5!' };
  }

  if (totalGols >= 3) {
    return { acao: 'green', encerrar: true, statusMonitoramento: 'GREEN_TOTAL', mensagem: '✅ GREEN CONFIRMADO NO OVER 2.5!' };
  }

  if (MARCOS_1T.includes(marco)) {
    return decidirPrimeiroTempo(snapshot, casa, fora, totalGols, marco);
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
          const mensagem = over15
            ? `🚨 OVER CARPINA 1.5 [INTERVALO]: Jogo Frio identificado (0x0, xG: ${totalXg}, Chutes no Gol: ${totalShotsOnTarget}). Recomendado CASH OUT imediato no intervalo.`
            : textoIntervalo(totalXg, totalShotsOnTarget);
          return { acao: 'cashout-intervalo', encerrar: true, statusMonitoramento: 'STOP_LOSS_RECOMENDADO', mensagem };
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
      mensagem: over15
        ? '🛑 OVER CARPINA 1.5 [60 MINUTOS]: Partida segue 0x0. SAÍDA MANDATÓRIA (Stop-Loss). Encerrar aposta agora para resgatar valor residual.'
        : '🛑 OVER CARPINA 2.5 [60 MINUTOS]: Partida segue 0x0. SAÍDA MANDATÓRIA (Stop-Loss). Encerrar aposta agora para resgatar valor residual.'
    };
  }

  if (minuto >= 65 && totalGols === 1 && ((casa === 1 && fora === 0) || (casa === 0 && fora === 1))) {
    return {
      acao: 'stop-65',
      encerrar: true,
      statusMonitoramento: 'STOP_LOSS_RECOMENDADO',
      mensagem: over15
        ? '💰 OVER CARPINA 1.5 [65 MINUTOS - LIMITE MÁXIMO]: Placar 1 gol no minuto 65. SAÍDA MANDATÓRIA. Momento de maior liquidez para resgate (35% a 45% da stake). Não segurar além deste minuto!'
        : '💰 OVER CARPINA 2.5 [65 MINUTOS - LIMITE MÁXIMO]: Placar 1 gol no minuto 65. SAÍDA MANDATÓRIA. Momento de maior liquidez para resgate (35% a 45% da stake). Não segurar além deste minuto!'
    };
  }

  if (marco === 70 || minuto >= 70) {
    return { acao: 'encerrar-70', encerrar: true, statusMonitoramento: 'ENCERRADO_70', mensagem: null };
  }
  return {
    acao: 'seguir',
    encerrar: false,
    mensagem: null,
    statusMonitoramento: MARCOS_2T.includes(marco) ? `MONITORANDO_${marco}` : 'MONITORANDO'
  };
}

function decidirPrimeiroTempo(snapshot, casa, fora, totalGols, marco) {
  const homeXg = Number(snapshot?.homeXg);
  const awayXg = Number(snapshot?.awayXg);
  const homeShots = Number(snapshot?.homeShotsOnTarget);
  const awayShots = Number(snapshot?.awayShotsOnTarget);
  const xgTotal = [homeXg, awayXg].every(Number.isFinite) ? homeXg + awayXg : null;
  const chutes = [homeShots, awayShots].every(Number.isFinite) ? homeShots + awayShots : null;
  const risco_stoploss = marco === 20 && riscoStopLossPrecoce(snapshot, minutoParaRisco(snapshot, marco));
  if (risco_stoploss) {
    return {
      acao: 'stop-loss-1t',
      encerrar: false,
      risco_stoploss: true,
      statusMonitoramento: 'STOP_LOSS_RECOMENDADO',
      mensagem: "Ritmo baixo aos 20'-25' (0x0, xG baixo). Encerrar posição (-20% a -25% de perda controlada)."
    };
  }
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
  const cantosCasa = Number(snapshot?.homeCorners);
  const cantosFora = Number(snapshot?.awayCorners);
  const cantos = [cantosCasa, cantosFora].every(Number.isFinite) ? cantosCasa + cantosFora : null;
  const pressaoCasa = calcularIndicePressao({ rematesAlvo: Number.isFinite(homeShots) ? homeShots : 0, cantos: Number.isFinite(cantosCasa) ? cantosCasa : 0 });
  const pressaoFora = calcularIndicePressao({ rematesAlvo: Number.isFinite(awayShots) ? awayShots : 0, cantos: Number.isFinite(cantosFora) ? cantosFora : 0 });
  return { xg, chutes_alvo: chutes, cantos, pressao_relativa: Number((pressaoCasa - pressaoFora).toFixed(2)) };
}

function valorOuTraco(valor, casas) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';
  return casas == null ? String(numero) : numero.toFixed(casas);
}

function classificacaoRitmo(decisao) {
  if (decisao?.acao === 'green' || decisao?.statusMonitoramento === 'GREEN_TOTAL') return 'GREEN';
  if (decisao?.acao === 'take-profit-1t') return 'Gol no jogo — pressão ofensiva';
  if (decisao?.acao === 'stop-loss-1t') return 'Ritmo baixo';
  if (decisao?.acao === 'pressao-1t') return 'Pressão alta';
  return 'Em leitura';
}

export function mensagemRadar1T({ minuto, mandante, visitante, golsCasa, golsFora, mercado, snapshot, decisao }) {
  const xgCasa = Number(snapshot?.homeXg);
  const xgFora = Number(snapshot?.awayXg);
  const xgTotal = [xgCasa, xgFora].every(Number.isFinite) ? (xgCasa + xgFora).toFixed(2) : '—';
  return [
    `📊 RADAR SOFAPUNTER [MINUTO ${minuto}']`,
    `⚽ Partida: ${mandante} ${golsCasa} x ${golsFora} ${visitante}`,
    `🎯 Mercado Monitorado: ${mercado}`,
    `📈 xG Acumulado: ${xgTotal} (${valorOuTraco(xgCasa, 2)} vs ${valorOuTraco(xgFora, 2)})`,
    `🎯 Chutes no Alvo: ${valorOuTraco(snapshot?.homeShotsOnTarget)} vs ${valorOuTraco(snapshot?.awayShotsOnTarget)}`,
    `🚩 Escanteios: ${valorOuTraco(snapshot?.homeCorners)} vs ${valorOuTraco(snapshot?.awayCorners)}`,
    `⚡ Ritmo/Pressão: ${classificacaoRitmo(decisao)}`
  ].join('\n');
}

function chaveNotificacao(fixtureId, minuto) {
  return `notified_${fixtureId}_${minuto}`;
}

const notificacoesServidor = new Set();

export function reservarAvisoUnico(fixtureId, minuto, partida = '') {
  const idNumerico = fixtureId != null && String(fixtureId).trim() !== '' && String(fixtureId) !== 'null'
    ? String(fixtureId)
    : (normalizarNome(partida) || 'sem-fixture');
  const chave = chaveNotificacao(idNumerico, minuto);
  if (notificacoesServidor.has(chave)) return false;
  notificacoesServidor.add(chave);
  return true;
}

function bloquearTelegram(watch, motivo) {
  if (!(watch.bloqueiosTelegram instanceof Set)) watch.bloqueiosTelegram = new Set();
  if (watch.bloqueiosTelegram.has(motivo)) return;
  watch.bloqueiosTelegram.add(motivo);
  console.log(`[CARPINA] Telegram bloqueado: ${watch.match || 'partida'} — ${motivo}`);
}

export function riscoStopLossPrecoce(snapshot, minuto) {
  const minutoNum = Number(minuto);
  if (!Number.isFinite(minutoNum) || minutoNum < 20 || minutoNum > 25) return false;
  const casa = Number(snapshot?.golsCasa) || 0;
  const fora = Number(snapshot?.golsFora) || 0;
  if ((casa + fora) !== 0) return false;
  const homeXg = Number(snapshot?.homeXg);
  const awayXg = Number(snapshot?.awayXg);
  const homeShots = Number(snapshot?.homeShotsOnTarget);
  const awayShots = Number(snapshot?.awayShotsOnTarget);
  if (![homeXg, awayXg, homeShots, awayShots].every(Number.isFinite)) return false;
  const xG_total = homeXg + awayXg;
  const chutesNoAlvoTotal = homeShots + awayShots;
  return xG_total < 0.40 && chutesNoAlvoTotal <= 1;
}

export function minutoParaRisco(snapshot, marco) {
  const elapsed = Number(snapshot?.elapsed);
  if (marco === 20) {
    if (!Number.isFinite(elapsed)) return 20;
    if (elapsed >= 19 && elapsed < 20) return 20;
    return elapsed;
  }
  return Number.isFinite(elapsed) ? elapsed : marco;
}

function totaisOfensivos(snapshot) {
  const homeXg = Number(snapshot?.homeXg);
  const awayXg = Number(snapshot?.awayXg);
  const homeShots = Number(snapshot?.homeShotsOnTarget);
  const awayShots = Number(snapshot?.awayShotsOnTarget);
  return {
    xG_total: [homeXg, awayXg].every(Number.isFinite) ? (homeXg + awayXg).toFixed(2) : '—',
    chutesAlvoTotal: [homeShots, awayShots].every(Number.isFinite) ? String(homeShots + awayShots) : '—'
  };
}

const PARECER_STOP_LOCAL = [
  'O Over 1.5 e o Over 2.5 correm risco real de não bater neste volume.',
  'Stop-loss preventivo recomendado para encerrar e salvar a banca residual.'
].join('\n');

export function mensagemStopLoss20({ mandante, visitante, mercado, xG_total, chutesAlvoTotal, parecerGeminiStopLoss }) {
  return [
    "⚠️ ALERTA STOP-LOSS PREVENTIVO [MINUTO 20']",
    `⚽ Partida: ${mandante} 0 x 0 ${visitante}`,
    `🎯 Mercado: ${mercado}`,
    `📉 xG Acumulado: ${xG_total} | Chutes no Alvo: ${chutesAlvoTotal}`,
    `🚨 Parecer da I.A.: ${parecerGeminiStopLoss}`,
    "🔴 Recomendação Carpina: Saída defensiva sugerida se não houver finalização até os 30'."
  ].join('\n');
}

function dataDoRegistro(item) {
  const dataRegistro = item?.data || item?.created_at || new Date().toISOString();
  return dataRegistro;
}

function normalizarApostaNuvem(linha) {
  if (!linha) return null;
  const dataRegistro = dataDoRegistro(linha);
  const dia = String(dataRegistro).slice(0, 10);
  return {
    id: String(linha.id),
    nuvemId: linha.id,
    localBetId: null,
    match: linha.jogo || linha.partida || linha.evento || '',
    market: linha.mercado || '',
    odd: Number(linha.odd),
    stake: Number(linha.stake),
    status: String(linha.status || '').toUpperCase(),
    fixtureId: linha.fixture_id || null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null,
    createdAt: dataRegistro
  };
}

const COLUNAS_APOSTAS = 'id, jogo, mercado, odd, status, lucro, created_at';

function colunaAusente(erro) {
  const mensagem = String(erro?.message || erro || '');
  return /column .+ does not exist/i.test(mensagem)
    || /could not find the '.+' column/i.test(mensagem);
}

function erroColunaLucro(erro) {
  return colunaAusente(erro) && /lucro/i.test(String(erro?.message || erro || ''));
}

function statusSemLucro(status) {
  const normal = String(status || '').trim().toUpperCase();
  if (normal === 'GREEN') return 'green';
  if (normal === 'RED') return 'red';
  return String(status || '').trim();
}

async function consultarApostas(cliente, aplicarFiltro) {
  const tentar = async (colunas, ordenar) => {
    let consulta = aplicarFiltro(cliente.from(TABELA_APOSTAS).select(colunas));
    if (ordenar) consulta = consulta.order(ordenar, { ascending: false });
    return consulta;
  };

  let resultado = await tentar(COLUNAS_APOSTAS, 'created_at');
  if (resultado.error && colunaAusente(resultado.error) && /created_at/i.test(resultado.error.message)) {
    resultado = await tentar(COLUNAS_APOSTAS, 'id');
  }
  if (resultado.error && colunaAusente(resultado.error)) {
    console.log('[CARPINA] Coluna ausente na consulta; a ler todas as colunas:', resultado.error.message);
    resultado = await tentar('*', 'id');
    if (resultado.error && colunaAusente(resultado.error)) {
      resultado = await tentar('*', null);
    }
  }
  return resultado;
}

async function listarPendentesOver25(ehOver25) {
  const cliente = clienteApostas();
  if (!cliente) throw new Error('Supabase indisponível.');
  const { data, error } = await consultarApostas(
    cliente,
    (consulta) => consulta.eq('status', 'PENDENTE')
  );
  if (error) throw new Error(error.message);
  return (data || [])
    .map(normalizarApostaNuvem)
    .filter((aposta) => aposta && String(aposta.status || '').toUpperCase() === 'PENDENTE' && ehOver25(aposta));
}

async function garantirApostaPendente(aposta) {
  const cliente = clienteApostas();
  if (!cliente) throw new Error('Supabase indisponível.');
  const { data, error } = await cliente.from(TABELA_APOSTAS).insert({
    jogo: aposta.match,
    mercado: aposta.market,
    odd: Number(aposta.odd) || null,
    status: 'PENDENTE'
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function gravarFixture(id, fixtureId) {
  const cliente = clienteApostas();
  if (!cliente) return;
  const idLinha = idLinhaSupabase(id);
  const fixture = fixtureIdParaColuna(fixtureId);
  if (idLinha == null) {
    console.log(`[CARPINA] fixture_id não gravado: "${id}" não é a chave bigint de apostas.`);
    return;
  }
  if (fixture == null) {
    console.log(`[CARPINA] fixture_id ignorado (id sintético ou inválido): ${fixtureId}`);
    return;
  }
  let resultado = await cliente.from(TABELA_APOSTAS).update({
    fixture_id: fixture,
    updated_at: new Date().toISOString()
  }).eq('id', idLinha);
  if (resultado.error && colunaAusente(resultado.error)) {
    resultado = await cliente.from(TABELA_APOSTAS).update({ fixture_id: fixture }).eq('id', idLinha);
  }
  if (resultado.error) throw new Error(resultado.error.message);
}

async function encerrarApostaNuvem(id, { status, lucro }) {
  const cliente = clienteApostas();
  if (!cliente) return;
  const idLinha = idLinhaSupabase(id);
  const lucroNumero = Number(lucro);
  const lucroValido = Number.isFinite(lucroNumero) ? Number(lucroNumero.toFixed(2)) : null;
  if (idLinha == null) {
    console.log(`[CARPINA] Encerramento não enviado: "${id}" não é a chave bigint de apostas. Lucro local: ${lucroValido ?? 'n/d'}.`);
    return;
  }
  const payload = { status, updated_at: new Date().toISOString() };
  if (String(status).toUpperCase() === 'PENDENTE') payload.lucro = null;
  else if (lucroValido != null) payload.lucro = lucroValido;
  let resultado = await cliente.from(TABELA_APOSTAS).update(payload).eq('id', idLinha);
  if (resultado.error && (erroColunaLucro(resultado.error) || (payload.lucro !== undefined && colunaAusente(resultado.error)))) {
    const statusEnvio = statusSemLucro(status);
    console.log(`[CARPINA] Coluna lucro ausente em apostas. Lucro ${lucroValido ?? 'n/d'} registado só no log. Status enviado: ${statusEnvio}.`);
    resultado = await cliente.from(TABELA_APOSTAS).update({ status: statusEnvio }).eq('id', idLinha);
  }
  if (resultado.error) throw new Error(resultado.error.message);
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
  const fixtureNumerico = fixtureIdParaColuna(watch.fixtureId);
  const linha = {
    fixture_id: fixtureNumerico,
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
  if (fixtureNumerico != null) {
    const { error } = await cliente.from('match_timeline').upsert(linha, { onConflict: 'fixture_id,minute' });
    if (error && falhaDeRede(error.message)) {
      pausarSupabase();
      gravarEstadoLocal(watch, snapshot, marco, decisao);
      return;
    }
    if (error) {
      const inserido = await cliente.from('match_timeline').insert(linha);
      if (inserido.error && falhaDeRede(inserido.error.message)) {
        pausarSupabase();
        gravarEstadoLocal(watch, snapshot, marco, decisao);
        return;
      }
      if (!inserido.error) gravou = true;
    } else {
      gravou = true;
    }
  }
  const patch = {
    minuto_atual: marco,
    placar: `${casa}-${fora}`,
    status_monitoramento: status,
    metricas_resumo: metricas,
    updated_at: agoraIso
  };
  const idLinha = idLinhaSupabase(watch.nuvemId);
  const consulta = idLinha != null
    ? cliente.from(TABELA_APOSTAS).update(patch).eq('id', idLinha)
    : cliente.from(TABELA_APOSTAS).update(patch).eq('jogo', watch.match).eq('status', 'PENDENTE');
  const atualizado = await consulta;
  if (atualizado.error && falhaDeRede(atualizado.error.message)) {
    pausarSupabase();
    gravarEstadoLocal(watch, snapshot, marco, decisao);
    return;
  }
  if (atualizado.error) console.log('[Monitor 2.5] apostas não atualizou:', atualizado.error.message);
  else gravou = true;
  if (gravou) console.log("📡 [Monitor 2.5] Marco " + marco + "' atualizado no Supabase.");
}

async function gravarStatusAoVivo(watch, snapshot) {
  if (!statusEmAndamento(snapshot)) return;
  const minuto = Number(snapshot.elapsed);
  const casa = Number(snapshot.golsCasa);
  const fora = Number(snapshot.golsFora);
  const placarConhecido = snapshot.placarConhecido !== false && Number.isFinite(casa) && Number.isFinite(fora);
  const curto = statusCurto(snapshot);
  const assinatura = `${curto}|${Number.isFinite(minuto) ? Math.floor(minuto) : ''}|${placarConhecido ? `${casa}-${fora}` : ''}`;
  if (watch.ultimaAssinaturaNuvem === assinatura) return;
  const patch = {
    minuto_atual: Number.isFinite(minuto) ? Math.floor(minuto) : null,
    status_monitoramento: curto
  };
  if (placarConhecido) patch.placar = `${casa}-${fora}`;
  const cliente = clienteApostas();
  if (!cliente) {
    watch.ultimaAssinaturaNuvem = assinatura;
    return;
  }
  const idLinha = idLinhaSupabase(watch.nuvemId);
  const consulta = idLinha != null
    ? cliente.from(TABELA_APOSTAS).update(patch).eq('id', idLinha)
    : cliente.from(TABELA_APOSTAS).update(patch).eq('jogo', watch.match).eq('status', 'PENDENTE');
  const atualizado = await consulta;
  if (atualizado.error && falhaDeRede(atualizado.error.message)) pausarSupabase();
  else if (atualizado.error) console.log('[CARPINA] Status ao vivo não gravou:', atualizado.error.message);
  watch.ultimaAssinaturaNuvem = assinatura;
  const textoMinuto = Number.isFinite(minuto) ? `${Math.floor(minuto)}'` : 'sem cronômetro';
  console.log(`[CARPINA] ${watch.match} em andamento: ${curto} ${textoMinuto}`);
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
  const resolverFixture = opcoes.garantirFixtureId || garantirFixtureId;
  const enviarTelegram = opcoes.enviarTelegram;
  const pedirParecerStopLoss = opcoes.pedirParecerStopLoss;
  const agora = opcoes.agora || (() => Date.now());
  const intervaloMs = opcoes.intervaloMs || 15000;
  const listarAoVivo = opcoes.listarAoVivo;
  const consultar1winAoVivo = opcoes.consultar1winAoVivo;
  const watches = new Map();
  const fixturesBloqueados = new Set();
  let timer = null;
  let cicloEmAndamento = false;
  let cacheAoVivoCiclo = null;
  let cache1winCiclo = null;

  const lerAoVivo = async () => {
    if (cacheAoVivoCiclo) return cacheAoVivoCiclo;
    if (typeof listarAoVivo !== 'function') return [];
    try {
      const lista = await listarAoVivo();
      cacheAoVivoCiclo = Array.isArray(lista) ? lista : [];
    } catch (erro) {
      cacheAoVivoCiclo = [];
      throw erro;
    }
    return cacheAoVivoCiclo;
  };

  const ler1win = async () => {
    if (cache1winCiclo) return cache1winCiclo;
    if (typeof consultar1winAoVivo !== 'function') return [];
    try {
      const lista = await consultar1winAoVivo();
      cache1winCiclo = Array.isArray(lista) ? lista : [];
    } catch (erro) {
      cache1winCiclo = [];
      throw erro;
    }
    return cache1winCiclo;
  };

  const persistir = () => {
    const saida = {};
    for (const [id, watch] of watches) {
      saida[id] = {
        ...watch,
        feitos: [...(watch.feitos || [])],
        notificados: [...(watch.notificados || [])]
      };
    }
    gravarJson(arquivoEstado, { fixturesBloqueados: [...fixturesBloqueados], watches: saida });
  };

  const carregarEstado = () => {
    const salvo = lerJson(arquivoEstado, { watches: {} });
    for (const id of salvo.fixturesBloqueados || []) fixturesBloqueados.add(String(id));
    for (const [id, watch] of Object.entries(salvo.watches || {})) {
      const atual = {
        ...watch,
        feitos: new Set(watch.feitos || []),
        notificados: new Set(watch.notificados || [])
      };
      for (const chave of atual.notificados) notificacoesServidor.add(chave);
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
    const locais = (banco.bets || []).filter((aposta) => String(aposta.status).toUpperCase() === 'PENDING' && ehEntradaMonitorada(aposta));
    let pendentes = [];
    let nuvemOk = false;
    try {
      pendentes = await listarPendentesOver25(ehEntradaMonitorada);
      nuvemOk = true;
    } catch (erro) {
      if (!falhaDeRede(erro.message) && !/indisponível/i.test(erro.message)) {
        console.log('[CARPINA] Leitura no Supabase indisponível:', erro.message);
      }
      pausarSupabase();
      pendentes = locais.map((aposta) => ({
        id: String(aposta.id),
        nuvemId: null,
        localBetId: String(aposta.id),
        match: aposta.match,
        market: aposta.market,
        league: aposta.league || null,
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
        return ehEntradaMonitorada(aposta) && (status === 'GREEN' || status === 'RED' || status === 'CASHOUT');
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
          ja.league = ja.league || aposta.league || null;
          ja.gameLink = ja.gameLink || aposta.gameLink || null;
          if (aposta.date) ja.date = aposta.date;
          continue;
        }
        if (partidaIgnorada(aposta)) {
          console.log(`[CARPINA] Partida ignorada (base ou liga sem scout): ${aposta.match}`);
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
            league: aposta.league || null,
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
            league: aposta.league || null,
            date: aposta.date || null,
            odd: Number(aposta.odd),
            stake: Number(aposta.stake),
            status: 'PENDENTE',
            fixtureId: null
          });
        }
      }
    }
    pendentes = pendentes.filter((aposta) => {
      if (!partidaIgnorada(aposta)) return true;
      const watch = watches.get(aposta.id);
      if (watch && !watch.encerrado) encerrar(watch, 'liga-ignorada');
      console.log(`[CARPINA] Partida ignorada (base ou liga sem scout): ${aposta.match}`);
      return false;
    });
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

    for (const aposta of pendentes) {
      const times = partidaDaAposta(aposta);
      if (!times) continue;
      const atual = watches.get(aposta.id) || {
        betId: aposta.localBetId || null,
        nuvemId: aposta.nuvemId ?? null,
        match: aposta.match,
        market: aposta.market || '',
        fixtureId: aposta.fixtureId || null,
        stake: Number(aposta.stake) || 0,
        odd: Number(aposta.odd) || 0,
        kickoff: null,
        feitos: new Set(),
        precisaRetry48: false,
        encerrado: false,
        ancora: null,
        notificados: new Set()
      };
      atual.betId = aposta.localBetId || atual.betId || null;
      atual.nuvemId = aposta.nuvemId ?? atual.nuvemId ?? null;
      atual.match = aposta.match;
      atual.market = aposta.market || atual.market || '';
      atual.league = aposta.league || atual.league || null;
      if (!(atual.notificados instanceof Set)) atual.notificados = new Set(atual.notificados || []);
      atual.stake = Number(aposta.stake) || atual.stake || 0;
      atual.odd = Number(aposta.odd) || atual.odd || 0;
      atual.gameLink = aposta.gameLink || atual.gameLink || null;
      if (!fixtureValido(atual.fixtureId) && fixtureValido(aposta.fixtureId) && !fixturesBloqueados.has(String(aposta.fixtureId))) {
        atual.fixtureId = Number(aposta.fixtureId);
      }
      if (!fixtureValido(atual.fixtureId)) {
        try {
          const vinculo = await resolverFixture(
            { ...aposta, fixtureId: atual.fixtureId },
            { listarDia, listarAoVivo: lerAoVivo, gravarFixture, agora }
          );
          if (vinculo && !fixturesBloqueados.has(String(vinculo.fixtureId))) {
            atual.fixtureId = vinculo.fixtureId;
            atual.kickoff = atual.kickoff || vinculo.kickoff;
          }
        } catch (erro) {
          console.log('[CARPINA] fixture_id não gravado na nuvem:', erro.message);
        }
      }
      const minuto = minutoDoAcompanhamento(atual, agora());
      const estourouMinuto = acompanhamentoEncerrado(minuto, atual.ancora?.elapsed);
      const fixtureBloqueado = atual.fixtureId != null && fixturesBloqueados.has(String(atual.fixtureId));
      if (estourouMinuto || fixtureBloqueado) {
        if (!atual.encerrado) encerrar(atual, estourouMinuto ? 'apos-70' : 'fixture-encerrado');
        bloquearFixture(atual);
      }
      watches.set(aposta.id, atual);
    }
    const ativos = pendentes.filter((aposta) => {
      const watch = watches.get(aposta.id);
      return watch && !watch.encerrado;
    });
    console.log(`Consultando Supabase... ${ativos.length} apostas PENDENTES encontradas.`);
    persistir();
  };

  const processarWatch = async (watch) => {
    if (watch.encerrado) return;
    const times = partidaDaAposta({ match: watch.match });
    if (deveIgnorarPartida(watch.league, times?.home, times?.away)) {
      bloquearTelegram(watch, 'liga ou categoria bloqueada pelo filtro de base/amador');
      encerrar(watch, 'liga-ignorada');
      console.log(`[CARPINA] Partida ignorada (base ou liga sem scout): ${watch.match}`);
      return;
    }
    if (watch.fixtureId != null && fixturesBloqueados.has(String(watch.fixtureId))) {
      bloquearTelegram(watch, `fixture ${watch.fixtureId} bloqueado (já encerrado)`);
      encerrar(watch, 'fixture-encerrado');
      return;
    }
    const agoraMs = agora();
    const inicioCacheMs = Number(watch.inicioTimestampMs);
    if (fixtureValido(watch.fixtureId) && Number.isFinite(inicioCacheMs) && agoraMs < inicioCacheMs - (5 * 60 * 1000)) {
      console.log(linhaRelogio(watch.match, { statusShort: 'NS', kickoff: new Date(inicioCacheMs).toISOString() }));
      return;
    }
    let snapshot = null;
    if (fixtureValido(watch.fixtureId)) {
      try {
        snapshot = await consultarFixture(watch.fixtureId);
      } catch (erro) {
        console.log(`[CARPINA] Erro na API-Football ao consultar o fixture ${watch.fixtureId}:`, erro.message);
      }
    }
    const referenciaKickoff = snapshot?.kickoff || watch.kickoff;
    const atrasado = preJogoAtrasado({ kickoff: referenciaKickoff, statusShort: statusCurto(snapshot) }, agoraMs);
    const buscarAgora = !fixtureValido(watch.fixtureId) || !snapshot || atrasado;
    if (buscarAgora) {
      try {
        const lista = (await lerAoVivo()).filter((jogo) => !confrontoIgnorado(jogo));
        const porId = fixtureValido(watch.fixtureId)
          ? lista.find((jogo) => Number(jogo.fixtureId) === Number(watch.fixtureId))
          : null;
        const porNome = times ? localizarFixture(lista, times.home, times.away) : null;
        const fresco = (porId && statusEmAndamento(porId) ? porId : null)
          || (porNome && statusEmAndamento(porNome) ? porNome : null);
        if (fresco && !fixturesBloqueados.has(String(fresco.fixtureId))) {
          snapshot = { ...fresco, placarConhecido: true };
          watch.fixtureId = fresco.fixtureId;
          watch.kickoff = watch.kickoff || fresco.kickoff;
          if (watch.nuvemId != null) {
            try {
              await gravarFixture(watch.nuvemId, fresco.fixtureId);
            } catch (erro) {
              console.log('[CARPINA] fixture_id não gravado na nuvem:', erro.message);
            }
          }
        }
      } catch (erro) {
        console.log('[CARPINA] Erro na API-Football ao listar os jogos ao vivo:', erro.message);
      }
    }
    if (buscarAgora && !statusEmAndamento(snapshot)) {
      try {
        const jogos = (await ler1win()).filter((jogo) => !confrontoIgnorado(jogo));
        const idLink = String(watch.gameLink || '').match(/(\d{5,})/)?.[1];
        const porId = idLink ? jogos.find((jogo) => String(jogo.id) === idLink) : null;
        const porNome = times
          ? jogos.find((jogo) => nomesCompativeis(jogo.home, times.home) && nomesCompativeis(jogo.away, times.away))
          : null;
        const feed = snapshotDoFeed1win(porId || porNome, agoraMs);
        if (feed) {
          const casa = Number(snapshot?.golsCasa);
          const fora = Number(snapshot?.golsFora);
          snapshot = {
            ...(snapshot || {}),
            ...feed,
            fixtureId: snapshot?.fixtureId || watch.fixtureId || null,
            golsCasa: Number.isFinite(casa) ? casa : null,
            golsFora: Number.isFinite(fora) ? fora : null,
            placarConhecido: false,
            fonte: '1win'
          };
          watch.kickoff = feed.kickoff;
        }
      } catch (erro) {
        console.log('[CARPINA] Feed ao vivo da 1win indisponível:', erro.message);
      }
    }
    if (!snapshot) {
      console.log(linhaRelogio(watch.match, null));
      bloquearTelegram(watch, 'sem snapshot da API-Football nem do feed ao vivo');
      return;
    }
    console.log(linhaRelogio(watch.match, snapshot));
    const curto = statusCurto(snapshot);
    if (curto === 'NS' || curto === 'TBD' || curto === 'PST') {
      watch.kickoff = watch.kickoff || snapshot.kickoff;
      if (curto === 'NS') {
        const inicio = timestampInicioApi(snapshot);
        if (Number.isFinite(inicio)) watch.inicioTimestampMs = inicio;
      }
      bloquearTelegram(watch, `status ${curto}: partida ainda não começou`);
      return;
    }
    watch.inicioTimestampMs = null;
    if (fixtureEncerrado(snapshot.status)) {
      bloquearFixture(watch);
      const gols = (Number(snapshot.golsCasa) || 0) + (Number(snapshot.golsFora) || 0);
      const limiteGreen = ehEntradaOver15({ market: watch.market }) && !ehEntradaOver25({ market: watch.market }) ? 2 : 3;
      const textoGreen = limiteGreen === 2
        ? '✅ GREEN CONFIRMADO NO OVER 1.5!'
        : '✅ GREEN CONFIRMADO NO OVER 2.5!';
      if (gols >= limiteGreen) {
        try {
          await enviarTelegram(`${watch.match}\n${textoGreen}`);
          await registrarGreen(watch);
        } catch (erro) {
          console.log('[CARPINA] Jogo finalizado sem gravar o GREEN:', erro.message);
        }
      } else {
        bloquearTelegram(watch, `jogo encerrado com ${gols} golo(s), abaixo do limite do mercado`);
      }
      encerrar(watch, 'ft');
      return;
    }
    watch.kickoff = watch.kickoff || snapshot.kickoff;
    let minuto = Number(snapshot.elapsed);
    if (curto === 'HT' && !(minuto >= 46)) minuto = 46;
    if (!Number.isFinite(minuto)) minuto = minutoDoAcompanhamento(watch, agora());
    if (acompanhamentoEncerrado(minuto, snapshot.elapsed)) {
      bloquearTelegram(watch, `minuto ${Number.isFinite(minuto) ? Math.floor(minuto) : '—'} passou de 70; monitoramento encerrado`);
      bloquearFixture(watch);
      encerrar(watch, 'apos-70');
      return;
    }
    if (!(watch.feitos instanceof Set)) watch.feitos = new Set(watch.feitos || []);
    const marcoJanela = marcoDevido(minuto, watch.feitos, watch.precisaRetry48);
    const minutoInteiro = Number.isFinite(Number(snapshot.elapsed)) ? Math.floor(Number(snapshot.elapsed)) : null;
    const marcoRelogio = minutoInteiro != null && MARCOS_RELOGIO.has(minutoInteiro) && !watch.feitos.has(minutoInteiro)
      ? minutoInteiro
      : null;
    const marco = marcoJanela ?? marcoRelogio;
    watch.ancora = {
      elapsed: Number.isFinite(snapshot.elapsed) ? snapshot.elapsed : minuto,
      status: snapshot.status,
      em: agora()
    };
    if (statusEmAndamento(snapshot)) {
      try {
        await gravarStatusAoVivo(watch, snapshot);
      } catch (erro) {
        console.log('[CARPINA] Status ao vivo não gravou:', erro.message);
      }
    }
    if (statusEmAndamento(snapshot) && scoutVazio(snapshot)) {
      try {
        const jogos = (await ler1win()).filter((jogo) => !confrontoIgnorado(jogo));
        const idLink = String(watch.gameLink || '').match(/(\d{5,})/)?.[1];
        const porId = idLink ? jogos.find((jogo) => String(jogo.id) === idLink) : null;
        const porNome = times
          ? jogos.find((jogo) => nomesCompativeis(jogo.home, times.home) && nomesCompativeis(jogo.away, times.away))
          : null;
        snapshot = aplicarFallback1win(snapshot, porId || porNome);
      } catch (erro) {
        console.log('[CARPINA] Fallback de pressão da 1win indisponível:', erro.message);
      }
    }
    if (Number.isFinite(minuto) && snapshot.placarConhecido !== false) {
      registrarPontoPressao(watch, snapshot, minuto);
      const minutoGrafico = Math.floor(minuto);
      gravarEstadoLocal(watch, snapshot, minutoGrafico, null);
      if (!watch.flag_jogo_esfriou && jogoEsfriou(watch.amostras, minuto)) {
        watch.flag_jogo_esfriou = true;
        const nomes = times || partidaDaAposta({ match: watch.match });
        const textoFrio = mensagemJogoEsfriou({
          minuto: minutoGrafico,
          timeCasa: nomes?.home || snapshot.home || 'Mandante',
          golsCasa: Number(snapshot.golsCasa) || 0,
          golsFora: Number(snapshot.golsFora) || 0,
          timeFora: nomes?.away || snapshot.away || 'Visitante',
          mercado: rotuloMercadoMonitorado({ market: watch.market })
        });
        try {
          await enviarTelegram(textoFrio);
          console.log(`📣 [CARPINA] ${watch.match}: jogo esfriou ${minutoGrafico}'`);
        } catch (erro) {
          watch.flag_jogo_esfriou = false;
          console.log('[CARPINA] Alerta de jogo esfriado não enviado:', erro.message);
        }
        gravarEstadoLocal(watch, snapshot, minutoGrafico, { statusMonitoramento: 'JOGO_ESFRIOU' });
      }
    }
    const placarDesconhecido = snapshot.placarConhecido === false;
    if (marco == null) {
      const textoMinuto = Number.isFinite(minuto) ? `${Math.floor(minuto)}'` : 'sem cronômetro';
      bloquearTelegram(watch, `minuto ${textoMinuto} fora das janelas 20/30/35/40 ou marco já processado`);
      return;
    }
    if (placarDesconhecido && !MARCOS_1T.includes(marco)) {
      bloquearTelegram(watch, `placar desconhecido no marco ${marco}; o radar de 1T é o único aviso sem placar`);
      return;
    }
    watch.feitos.add(marco);
    if (marcoRelogio != null) watch.feitos.add(marcoRelogio);
    const decisao = placarDesconhecido
      ? { acao: 'seguir', encerrar: false, mensagem: null, statusMonitoramento: 'MONITORANDO' }
      : decidirCarpina(snapshot, marco, watch.market);
    if (placarDesconhecido) {
      console.log(`[CARPINA] ${watch.match}: placar desconhecido aos ${marco}'. Radar de 1T segue sem inventar 0x0.`);
    } else {
      try {
        await gravarMarcoNoSupabase(watch, snapshot, marco, decisao);
      } catch (erro) {
        console.log('[Monitor 2.5] Falha ao gravar o marco:', erro.message);
      }
    }
    if (marco === 46 && snapshot.status !== 'HT') watch.precisaRetry48 = true;
    if (!(watch.notificados instanceof Set)) watch.notificados = new Set(watch.notificados || []);
    const chaveAviso = chaveNotificacao(watch.fixtureId, marco);
    const aviso1T = MARCOS_1T.includes(marco);
    if (aviso1T) {
      const primeiraVez = reservarAvisoUnico(watch.fixtureId, marco, watch.match);
      watch.notificados.add(chaveAviso);
      if (!primeiraVez) {
        bloquearTelegram(watch, `aviso dos ${marco}' já reservado para ${watch.fixtureId || watch.match}`);
      }
      if (primeiraVez) {
        const times = partidaDaAposta({ match: watch.match });
        const mandante = times?.home || snapshot.home || 'Mandante';
        const visitante = times?.away || snapshot.away || 'Visitante';
        const mercado = rotuloMercadoMonitorado({ market: watch.market });
        let texto;
        if (decisao.risco_stoploss) {
          const totais = totaisOfensivos(snapshot);
          let parecerGeminiStopLoss = PARECER_STOP_LOCAL;
          if (typeof pedirParecerStopLoss === 'function') {
            try {
              const parecer = await pedirParecerStopLoss({ xG: totais.xG_total, chutes: totais.chutesAlvoTotal });
              if (String(parecer || '').trim()) parecerGeminiStopLoss = String(parecer).trim();
            } catch (erro) {
              console.log('[CARPINA] Parecer de stop-loss indisponível:', erro.message);
            }
          }
          texto = mensagemStopLoss20({
            mandante,
            visitante,
            mercado,
            xG_total: totais.xG_total,
            chutesAlvoTotal: totais.chutesAlvoTotal,
            parecerGeminiStopLoss
          });
        } else {
          texto = mensagemRadar1T({
            minuto: marco,
            mandante,
            visitante,
            golsCasa: placarDesconhecido ? '—' : (Number(snapshot.golsCasa) || 0),
            golsFora: placarDesconhecido ? '—' : (Number(snapshot.golsFora) || 0),
            mercado,
            snapshot,
            decisao
          });
        }
        try {
          await enviarTelegram(texto);
          console.log(`📣 [CARPINA] ${watch.match}: ${decisao.risco_stoploss ? 'stop-loss 20' : 'radar'} ${marco}'`);
        } catch (erro) {
          console.log('[CARPINA] Telegram não enviado:', erro.message);
        }
      }
    } else if (!aviso1T && decisao.mensagem) {
      const texto = `${watch.match}\n${decisao.mensagem}`;
      try {
        await enviarTelegram(texto);
        console.log(`📣 [CARPINA] ${watch.match}: ${decisao.acao}`);
      } catch (erro) {
        console.log('[CARPINA] Telegram não enviado:', erro.message);
      }
    } else if (!aviso1T && MARCOS_TERMOMETRO.has(marco)) {
      const nomes = times || partidaDaAposta({ match: watch.match });
      const favoravel = termometroFavoravel(snapshot, watch.amostras, marco, watch.market);
      const texto = mensagemTermometro({
        minuto: marco,
        timeCasa: nomes?.home || snapshot.home || 'Mandante',
        golsCasa: Number(snapshot.golsCasa) || 0,
        golsFora: Number(snapshot.golsFora) || 0,
        timeFora: nomes?.away || snapshot.away || 'Visitante',
        mercado: rotuloMercadoMonitorado({ market: watch.market }),
        favoravel
      });
      try {
        await enviarTelegram(texto);
        console.log(`📣 [CARPINA] ${watch.match}: termômetro ${marco}'`);
      } catch (erro) {
        console.log('[CARPINA] Termômetro não enviado:', erro.message);
      }
    } else {
      bloquearTelegram(watch, `marco ${marco} sem mensagem de radar, cashout ou termômetro`);
    }
    try {
      if (!placarDesconhecido && decisao.acao === 'green') await registrarGreen(watch);
      if (!placarDesconhecido && (decisao.acao === 'cashout-intervalo' || decisao.acao === 'stop-60' || decisao.acao === 'stop-65')) {
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
    cacheAoVivoCiclo = null;
    cache1winCiclo = null;
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
  console.log('🟢 [CARPINA] Monitor Over 1.5 e Over 2.5 ativo. Consultas em 20, 30, 35, 40, 46, 48 e 55–65.');

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

function numeroFinito(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function somaFinita(esquerda, direita) {
  if (esquerda == null && direita == null) return null;
  return (esquerda || 0) + (direita || 0);
}

export function indicePressaoLado(snapshot, lado) {
  const casa = lado === 'casa';
  const rematesAlvo = numeroFinito(casa ? snapshot?.homeShotsOnTarget : snapshot?.awayShotsOnTarget);
  const rematesFora = numeroFinito(casa ? snapshot?.homeShotsOffTarget : snapshot?.awayShotsOffTarget);
  const cantos = numeroFinito(casa ? snapshot?.homeCorners : snapshot?.awayCorners);
  const ataques = numeroFinito(casa ? snapshot?.homeDangerousAttacks : snapshot?.awayDangerousAttacks);
  const posse = numeroFinito(casa ? snapshot?.homePossession : snapshot?.awayPossession);
  const xg = numeroFinito(casa ? snapshot?.homeXg : snapshot?.awayXg);
  const ataques1win = numeroFinito(casa ? snapshot?.homeAttacks1win : snapshot?.awayAttacks1win);
  const momentum = numeroFinito(casa ? snapshot?.homeMomentum : snapshot?.awayMomentum);
  const temScout = [rematesAlvo, rematesFora, cantos, ataques, posse, xg].some((valor) => valor != null);
  if (!temScout) {
    if (ataques1win == null && momentum == null) return null;
    return Math.round((ataques1win || 0) * 0.4 + (momentum || 0));
  }
  const base = calcularIndicePressao({
    rematesAlvo: rematesAlvo || 0,
    rematesFora: rematesFora || 0,
    cantos: cantos || 0,
    ataquesPerigosos: ataques || 0
  });
  return Math.round(base + (posse || 0) * 0.2 + (xg || 0) * 10);
}

export function registrarPontoPressao(watch, snapshot, minuto) {
  const minutoInteiro = Math.floor(Number(minuto));
  if (!Number.isFinite(minutoInteiro) || minutoInteiro < 0) return Array.isArray(watch.pontosPressao) ? watch.pontosPressao : [];
  const chutes = somaFinita(numeroFinito(snapshot?.homeShotsOnTarget), numeroFinito(snapshot?.awayShotsOnTarget));
  const xgCasa = numeroFinito(snapshot?.homeXg);
  const xgFora = numeroFinito(snapshot?.awayXg);
  const xg = somaFinita(xgCasa, xgFora);
  const cantos = somaFinita(numeroFinito(snapshot?.homeCorners), numeroFinito(snapshot?.awayCorners));
  const casaAcum = indicePressaoLado(snapshot, 'casa');
  const foraAcum = indicePressaoLado(snapshot, 'fora');
  if (!Array.isArray(watch.amostras)) watch.amostras = [];
  const anterior = [...watch.amostras].reverse().find((item) => item.minuto < minutoInteiro) || null;
  const taxa = (atual, chave) => {
    if (atual == null || !anterior || anterior[chave] == null) return 0;
    return Math.max(0, Math.round(atual - anterior[chave]));
  };
  const amostra = {
    minuto: minutoInteiro,
    chutes,
    xg,
    cantos,
    casaAcum,
    foraAcum,
    casa: taxa(casaAcum, 'casaAcum'),
    fora: taxa(foraAcum, 'foraAcum')
  };
  const indice = watch.amostras.findIndex((item) => item.minuto === minutoInteiro);
  if (indice >= 0) watch.amostras[indice] = amostra;
  else watch.amostras.push(amostra);
  watch.amostras.sort((a, b) => a.minuto - b.minuto);
  if (watch.amostras.length > 100) watch.amostras = watch.amostras.slice(-100);
  watch.pontosPressao = watch.amostras.map((item) => ({ minuto: item.minuto, casa: item.casa, fora: item.fora }));
  return watch.pontosPressao;
}

export function jogoEsfriou(amostras, minutoAtual) {
  const minuto = Math.floor(Number(minutoAtual));
  if (!(minuto >= 46 && minuto <= 65)) return false;
  const serie = (Array.isArray(amostras) ? amostras : [])
    .filter((item) => item && minuto - item.minuto <= 12 && item.minuto <= minuto)
    .sort((a, b) => a.minuto - b.minuto);
  if (serie.length < 2) return false;
  const fim = serie[serie.length - 1];
  const inicio = serie.find((item) => fim.minuto - item.minuto >= 10) || null;
  if (!inicio) return false;
  const campos = [inicio.chutes, fim.chutes, inicio.xg, fim.xg, inicio.cantos, fim.cantos];
  if (!campos.every((valor) => Number.isFinite(Number(valor)))) return false;
  const deltaChutes = Number(fim.chutes) - Number(inicio.chutes);
  const deltaXg = Number(fim.xg) - Number(inicio.xg);
  const deltaCantos = Number(fim.cantos) - Number(inicio.cantos);
  return deltaChutes <= 0 && deltaXg < 0.08 && deltaCantos <= 0;
}

export function termometroFavoravel(snapshot, amostras, minuto, mercado) {
  if (jogoEsfriou(amostras, minuto)) return false;
  const serie = (Array.isArray(amostras) ? amostras : [])
    .filter((item) => item && minuto - item.minuto <= 12 && item.minuto <= minuto)
    .sort((a, b) => a.minuto - b.minuto);
  if (serie.length >= 2) {
    const fim = serie[serie.length - 1];
    const inicio = serie[0];
    if ([inicio.chutes, fim.chutes, inicio.xg, fim.xg, inicio.cantos, fim.cantos].every((valor) => Number.isFinite(Number(valor)))) {
      const deltaChutes = Number(fim.chutes) - Number(inicio.chutes);
      const deltaXg = Number(fim.xg) - Number(inicio.xg);
      const deltaCantos = Number(fim.cantos) - Number(inicio.cantos);
      return deltaChutes > 0 || deltaXg >= 0.08 || deltaCantos > 0;
    }
  }
  const gols = (Number(snapshot?.golsCasa) || 0) + (Number(snapshot?.golsFora) || 0);
  const over15 = ehEntradaOver15({ market: mercado }) && !ehEntradaOver25({ market: mercado });
  return over15 ? gols >= 1 : gols >= 2;
}

export function mensagemJogoEsfriou({ minuto, timeCasa, golsCasa, golsFora, timeFora, mercado }) {
  return [
    `⚠️ ALERTA DE SAÍDA / CASHOUT - JOGO ESFRIOU! [Minuto ${minuto}']`,
    `⚽ Partida: ${timeCasa} ${golsCasa} x ${golsFora} ${timeFora}`,
    `🎯 Mercado: ${mercado}`,
    '📉 Motivo: O ritmo despencou. Equipes administrando o placar, sem finalizações recentes e xG travado.',
    '🚨 RECOMENDAÇÃO: Realizar Cashout / Encerrar aposta agora para proteger o saldo residual da banca!'
  ].join('\n');
}

export function mensagemTermometro({ minuto, timeCasa, golsCasa, golsFora, timeFora, mercado, favoravel }) {
  const selo = favoravel ? '🟢 Favorável' : '🔴 Desfavorável';
  const linhas = [
    `📊 OVER CARPINA [${minuto}'] ${selo}`,
    `⚽ Partida: ${timeCasa} ${golsCasa} x ${golsFora} ${timeFora}`,
    `🎯 Mercado: ${mercado}`,
    `🌡️ Termômetro: ${selo}`
  ];
  if (minuto === 65) {
    linhas.push('🔒 Fechamento da posição aos 65 minutos. Encerre a leitura e proteja o saldo residual.');
  }
  if (minuto === 70) {
    linhas.push('🔒 Monitoramento encerrado aos 70 minutos.');
  }
  return linhas.join('\n');
}

const MARCOS_TERMOMETRO = new Set([48, 55, 60, 65, 70]);

function scoutVazio(snapshot) {
  return [
    snapshot?.homeShotsOnTarget,
    snapshot?.awayShotsOnTarget,
    snapshot?.homeXg,
    snapshot?.awayXg,
    snapshot?.homeCorners,
    snapshot?.awayCorners
  ].every((valor) => !Number.isFinite(Number(valor)));
}

function aplicarFallback1win(snapshot, jogo) {
  if (!snapshot || !jogo) return snapshot;
  return {
    ...snapshot,
    homeAttacks1win: snapshot.homeAttacks1win ?? jogo.homeAttacks ?? null,
    awayAttacks1win: snapshot.awayAttacks1win ?? jogo.awayAttacks ?? null,
    homeDangerousAttacks: snapshot.homeDangerousAttacks ?? jogo.homeDangerous ?? null,
    awayDangerousAttacks: snapshot.awayDangerousAttacks ?? jogo.awayDangerous ?? null,
    homeMomentum: snapshot.homeMomentum ?? jogo.homeMomentum ?? null,
    awayMomentum: snapshot.awayMomentum ?? jogo.awayMomentum ?? null
  };
}

/**
 * Grava o minuto ao vivo na tabela match_timeline para alimentar o gráfico
 */
export async function registarMinutoLive(fixtureId, minuto, dadosCasa, dadosFora) {
  const fixture = fixtureIdParaColuna(fixtureId);
  if (fixture == null) return;
  try {
    const piCasa = calcularIndicePressao(dadosCasa);
    const piFora = calcularIndicePressao(dadosFora);
    const pressaoRelativa = piCasa - piFora;

    const { error } = await supabase.from('match_timeline').insert({
      fixture_id: fixture,
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
  const fixture = fixtureIdParaColuna(fixtureId);
  if (fixture == null || minuto < 12 || minuto > 26 || placar !== '0-0') return;

  const dadosMercado = await getLaybackMarketData(marketId);
  if (!dadosMercado) return;

  const oddOver = dadosMercado.overOdd;
  if (oddOver && oddOver >= 1.65 && oddOver <= 1.98) {
    console.log(`🎯 [SINAL OVER 0.5 HT] Minuto: ${minuto}' | Odd: ${oddOver} | Liq: $${dadosMercado.liquidity}`);
    
    await supabase.from('trade_signals').insert({
      fixture_id: fixture,
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
  const { obterFixtureAoVivo, listarFixturesAoVivo, listarFixturesDoDia } = require('./services/apiFootball.js');
  const arquivoBets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'bets_database.json');
  iniciarMonitorCarpina({
    arquivoBets,
    consultarFixture: obterFixtureAoVivo,
    listarAoVivo: listarFixturesAoVivo,
    listarDia: listarFixturesDoDia,
    enviarTelegram: async (texto) => {
      console.log(`[CARPINA] ${texto}`);
    }
  });
}

/**
 * Sniper xG: varredura isolada da sobra da API-Football.
 * Não grava na tabela apostas e não altera o monitor principal.
 */
const alertasSniperEnviados = new Set();
const cooldownEstatisticaSniper = new Map();
const TETO_SNIPER_DIA = 3750;
const COOLDOWN_ESTATISTICA_MS = 120000;
const MAX_ESTATISTICAS_POR_CICLO = 6;
const consumoSniper = { dia: '', total: 0 };
let avisoTetoSniper = false;
let sniperEmCurso = false;
let tokenTelegramSniper = '';

function diaSniper() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const ler = (tipo) => partes.find((parte) => parte.type === tipo)?.value || '';
  return `${ler('year')}-${ler('month')}-${ler('day')}`;
}

function chaveApiFootballSniper() {
  if (process.env.API_FOOTBALL_KEY) return process.env.API_FOOTBALL_KEY;
  try {
    createRequire(import.meta.url)('./services/apiFootball.js');
  } catch (_) { /* a chave pode já estar no ambiente */ }
  return process.env.API_FOOTBALL_KEY || '';
}

function tokenDoTelegramSniper() {
  if (tokenTelegramSniper) return tokenTelegramSniper;
  try {
    const texto = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'server.js'), 'utf8');
    const achado = texto.match(/TELEGRAM_BOT_TOKEN\s*=\s*'([^']+)'/);
    tokenTelegramSniper = achado ? achado[1] : '';
  } catch (_) {
    tokenTelegramSniper = '';
  }
  return tokenTelegramSniper;
}

function placarAbertoSniper(casa, fora) {
  return (casa === 0 && fora === 0)
    || (casa === 1 && fora === 0)
    || (casa === 0 && fora === 1)
    || (casa === 1 && fora === 1);
}

function tempoSniper(status, minuto) {
  const curto = String(status || '').toUpperCase();
  if (curto === '1H' && minuto >= 20 && minuto <= 38) return '1T';
  if (curto === '2H' && minuto >= 55 && minuto <= 75) return '2T';
  return null;
}

function mercadoSniper(tempo, gols, xg) {
  if (tempo === '1T' && gols === 0 && xg >= 1.15) return 'Over 0.5 HT';
  if (tempo === '1T' && gols === 1 && xg >= 1.80) return 'Over 1.5 HT / FT';
  if (tempo === '2T' && gols <= 1 && xg >= 2.10) return 'Over 1.5 FT';
  if (tempo === '2T' && gols === 2 && xg >= 2.85) return 'Over 2.5 FT';
  return null;
}

function lerNumeroSniper(lista, nomes) {
  const alvos = new Set(nomes.map((nome) => nome.toLowerCase()));
  const item = (Array.isArray(lista) ? lista : []).find((linha) => alvos.has(String(linha?.type || '').toLowerCase()));
  const valor = Number(String(item?.value ?? '').replace('%', '').replace(',', '.').trim());
  return Number.isFinite(valor) ? valor : null;
}

async function pedirApiSniper(caminho) {
  const dia = diaSniper();
  if (consumoSniper.dia !== dia) {
    consumoSniper.dia = dia;
    consumoSniper.total = 0;
    avisoTetoSniper = false;
  }
  if (consumoSniper.total >= TETO_SNIPER_DIA) {
    if (!avisoTetoSniper) {
      avisoTetoSniper = true;
      console.warn('[SNIPER] Pausa até amanhã: a varredura chegou a 50% da cota diária.');
    }
    return null;
  }
  const chave = chaveApiFootballSniper();
  if (!chave) throw new Error('API-Football sem chave.');
  consumoSniper.total += 1;
  const resposta = await fetch(`https://v3.football.api-sports.io${caminho}`, {
    headers: { 'x-apisports-key': chave },
    signal: AbortSignal.timeout(15000)
  });
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) throw new Error(`API-Football ${resposta.status}`);
  const erros = corpo?.errors;
  const temErro = Array.isArray(erros) ? erros.length > 0 : erros && typeof erros === 'object' && Object.keys(erros).length > 0;
  if (temErro) throw new Error('API-Football recusou a consulta.');
  return corpo;
}

async function enviarTelegramSniper(texto) {
  const token = tokenDoTelegramSniper();
  if (!token) throw new Error('Telegram sem token.');
  const resposta = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: '@FutStatsLatamOficial',
      text: String(texto || '').slice(0, 4096)
    }),
    signal: AbortSignal.timeout(15000)
  });
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok || corpo?.ok === false) {
    throw new Error(corpo?.description || `Telegram ${resposta.status}`);
  }
}

function textoSniper(jogo, xg, chutes, mercado) {
  return [
    '🔥 SNIPER xG AO VIVO',
    '',
    `🏆 Liga: ${jogo.liga}`,
    `⚽ Times: ${jogo.casa} x ${jogo.fora}`,
    `📊 Placar: ${jogo.golsCasa} x ${jogo.golsFora} | Minuto: ${jogo.minuto}'`,
    `🎯 xG Total: ${xg.toFixed(2)}`,
    `🥅 Chutes no alvo: ${chutes}`,
    `💡 Mercado sugerido: ${mercado}`,
    '',
    'Stake R$ 7,50 | Máx. 3-4 entradas/dia'
  ].join('\n');
}

async function cicloSniperXG() {
  if (sniperEmCurso) return;
  sniperEmCurso = true;
  let qtdFiltrados = 0;
  try {
    const aoVivo = await pedirApiSniper('/fixtures?live=all');
    const jogos = Array.isArray(aoVivo?.response) ? aoVivo.response : [];
    const agora = Date.now();
    const quentes = [];
    for (const jogo of jogos) {
      const id = Number(jogo?.fixture?.id);
      const minuto = Number(jogo?.fixture?.status?.elapsed);
      const golsCasa = Number(jogo?.goals?.home);
      const golsFora = Number(jogo?.goals?.away);
      const tempo = tempoSniper(jogo?.fixture?.status?.short, minuto);
      if (!Number.isFinite(id) || !tempo || !placarAbertoSniper(golsCasa, golsFora)) continue;
      qtdFiltrados += 1;
      const casa = jogo?.teams?.home?.name || '';
      const fora = jogo?.teams?.away?.name || '';
      const liga = jogo?.league?.name || '';
      if (deveIgnorarPartida(liga, casa, fora)) continue;
      if (alertasSniperEnviados.has(`${id}_${tempo}`)) continue;
      const ultimo = cooldownEstatisticaSniper.get(id) || 0;
      if (agora - ultimo < COOLDOWN_ESTATISTICA_MS) continue;
      quentes.push({ id, minuto, golsCasa, golsFora, tempo, casa, fora, liga, gols: golsCasa + golsFora });
    }
    for (const jogo of quentes.slice(0, MAX_ESTATISTICAS_POR_CICLO)) {
      try {
        cooldownEstatisticaSniper.set(jogo.id, Date.now());
        const corpo = await pedirApiSniper(`/fixtures/statistics?fixture=${jogo.id}`);
        if (!corpo) break;
        const times = Array.isArray(corpo.response) ? corpo.response : [];
        const blocos = times.map((time) => (Array.isArray(time?.statistics) ? time.statistics : []));
        const xgPartes = blocos.map((bloco) => lerNumeroSniper(bloco, ['expected_goals', 'Expected Goals']));
        if (!xgPartes.some((valor) => valor != null)) continue;
        const xg = xgPartes.reduce((total, valor) => total + (valor || 0), 0);
        const chutes = blocos.reduce((total, bloco) => total + (lerNumeroSniper(bloco, ['Shots on Goal', 'Shots on Target']) || 0), 0);
        const mercado = chutes >= 4 ? mercadoSniper(jogo.tempo, jogo.gols, xg) : null;
        if (!mercado) continue;
        const chave = `${jogo.id}_${jogo.tempo}`;
        if (alertasSniperEnviados.has(chave)) continue;
        alertasSniperEnviados.add(chave);
        await enviarTelegramSniper(textoSniper(jogo, xg, chutes, mercado));
        console.log(`[SNIPER] ${jogo.casa} x ${jogo.fora} ${jogo.minuto}' ${mercado}`);
      } catch (erro) {
        alertasSniperEnviados.delete(`${jogo.id}_${jogo.tempo}`);
        console.warn(`[SNIPER] ${jogo.casa} x ${jogo.fora}: ${erro?.message || erro}`);
      }
    }
  } catch (erro) {
    console.warn(`[SNIPER] ciclo ignorado: ${erro?.message || erro}`);
  } finally {
    sniperEmCurso = false;
    console.log(`🎯 [SNIPER xG] Varredura concluída | Jogos na janela quente: ${qtdFiltrados} | Cota Sniper hoje: ${consumoSniper.total}/3750`);
  }
}

const timerSniperXG = setInterval(() => {
  cicloSniperXG().catch((erro) => {
    console.warn(`[SNIPER] ciclo ignorado: ${erro?.message || erro}`);
  });
}, 60000);
if (typeof timerSniperXG.unref === 'function') timerSniperXG.unref();