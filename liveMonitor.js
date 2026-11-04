/**
 * Monitor ao vivo do Over Carpina 2.5.
 * Só consulta a API-Football nos marcos 46, 48 (se o intervalo atrasar), 55, 57, 59, 61, 63 e 65.
 */

import fs from 'fs';
import path from 'path';
import { encerrarApostaNuvem, garantirApostaPendente, gravarFixture, listarPendentesOver25 } from './lib/apostasSupabase.js';

const MARCOS_ATIVOS = [55, 57, 59, 61, 63, 65];
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
  if (!Number.isFinite(minuto) || minuto < 46 || minuto >= 66) return null;
  const feitosSet = feitos instanceof Set ? feitos : new Set(feitos || []);
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
    return { acao: 'green', encerrar: true, mensagem: '✅ GREEN CONFIRMADO NO OVER 2.5!' };
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
          return { acao: 'cashout-intervalo', encerrar: true, mensagem: textoIntervalo(totalXg, totalShotsOnTarget) };
        }
      }
    }
    return { acao: 'manter', encerrar: false, mensagem: null };
  }

  if (minuto >= 60 && casa === 0 && fora === 0) {
    return {
      acao: 'stop-60',
      encerrar: true,
      mensagem: '🛑 OVER CARPINA 2.5 [60 MINUTOS]: Partida segue 0x0. SAÍDA MANDATÓRIA (Stop-Loss). Encerrar aposta agora para resgatar valor residual.'
    };
  }

  if (minuto >= 65 && totalGols === 1 && ((casa === 1 && fora === 0) || (casa === 0 && fora === 1))) {
    return {
      acao: 'stop-65',
      encerrar: true,
      mensagem: '💰 OVER CARPINA 2.5 [65 MINUTOS - LIMITE MÁXIMO]: Placar 1 gol no minuto 65. SAÍDA MANDATÓRIA. Momento de maior liquidez para resgate (35% a 45% da stake). Não segurar além deste minuto!'
    };
  }

  if (minuto >= 65) return { acao: 'encerrar', encerrar: true, mensagem: null };
  return { acao: 'seguir', encerrar: false, mensagem: null };
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
  timer = setInterval(ciclo, intervaloMs);
  if (typeof timer.unref === 'function') timer.unref();
  ciclo();
  console.log('🟢 [CARPINA] Monitor Over 2.5 ativo. Silêncio até os 46 minutos.');

  return {
    parar() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    sincronizar,
    watches
  };
}
