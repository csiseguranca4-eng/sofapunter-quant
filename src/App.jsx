import React, { useState, useEffect, useMemo, useRef } from 'react';
import livroLocal from '../bets_database.json';
import { API_BASE, apiUrl, emLocal, grupoCompativel, grupoDaLiga, OPCOES_LIGA, urlVarredura } from './apiBase.js';
import { assinarCanal, supabase as supabaseMonitor } from './lib/supabaseClient.js';
import RadarLive from './RadarLive.jsx';
import { CalendarioMes, PainelMetodo, ResultadoAposta } from './MetodoBanca.jsx';
import { BANCA_OPERACIONAL, CORTE_REGISTRO_MS, INICIO_METODO, STAKE_PADRAO, lerSaldoCdb } from './metodoBanca.js';

function nomesIguais(a, b) {
  const limpar = (valor) => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const esquerda = limpar(a);
  const direita = limpar(b);
  if (!esquerda || !direita) return false;
  return esquerda === direita || esquerda.includes(direita) || direita.includes(esquerda);
}

function aplicarMonitorNaAposta(aposta, linha) {
  if (!linha) return aposta;
  const mesmoId = linha.id != null && String(aposta.nuvemId || aposta.id) === String(linha.id);
  const mesmoJogo = nomesIguais(aposta.match, linha.jogo || linha.partida || linha.match);
  const mesmoFixture = linha.fixture_id != null && aposta.fixtureId != null && String(aposta.fixtureId) === String(linha.fixture_id);
  if (!mesmoId && !mesmoJogo && !mesmoFixture) return aposta;
  return {
    ...aposta,
    fixtureId: linha.fixture_id || aposta.fixtureId || null,
    placarAoVivo: linha.placar || aposta.placarAoVivo || null,
    minutoAtual: linha.minuto_atual ?? linha.minute ?? aposta.minutoAtual ?? null,
    statusMonitoramento: linha.status_monitoramento || aposta.statusMonitoramento || null,
    metricasResumo: linha.metricas_resumo || aposta.metricasResumo || null,
    pontosPressao: Array.isArray(linha.pontosPressao) ? linha.pontosPressao : (Array.isArray(aposta.pontosPressao) ? aposta.pontosPressao : []),
    flagJogoEsfriou: linha.flag_jogo_esfriou === true || aposta.flagJogoEsfriou === true
  };
}

function placarOficial(aposta) {
  const partes = String(aposta?.match || '').split(/\s+x\s+/i);
  const casa = partes[0]?.trim();
  const fora = partes.slice(1).join(' x ').trim();
  const gols = String(aposta?.placarAoVivo || '').match(/(\d+)\s*[-xX]\s*(\d+)/);
  if (!casa || !fora || !gols) return null;
  return `${casa} ${gols[1]} - ${gols[2]} ${fora}`;
}

function textoTatico(aposta) {
  const status = aposta?.statusMonitoramento;
  if (status === 'STOP_LOSS_RECOMENDADO') return 'Stop Loss';
  if (status === 'TAKE_PROFIT_PRONTO') return 'Take Profit';
  if (status === 'GREEN_TOTAL') return 'Green';
  if (status === 'PRESSAO_ALTA_1T') return 'Pressão alta';
  const minuto = Number(aposta?.minutoAtual);
  if (Number.isFinite(minuto) && minuto < 46) return "Silêncio até 46'";
  return null;
}

function BadgeMonitor({ aposta }) {
  const status = aposta.statusMonitoramento;
  const minuto = aposta.minutoAtual;
  if (status === 'STOP_LOSS_RECOMENDADO') {
    return <span className="bg-orange-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">⚠️ STOP LOSS SUGERIDO (-20%)</span>;
  }
  if (status === 'TAKE_PROFIT_PRONTO') {
    return <span className="bg-[#00c853] text-black text-[10px] font-bold px-2 py-0.5 rounded">💰 TAKE PROFIT DISPONÍVEL</span>;
  }
  if (status === 'GREEN_TOTAL') {
    return <span className="bg-[#00c853] text-black text-[10px] font-bold px-2 py-0.5 rounded">✅ GREEN</span>;
  }
  if (status === 'JOGO_ESFRIOU' || aposta.flagJogoEsfriou) {
    return <span className="bg-orange-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">⚠️ JOGO ESFRIOU</span>;
  }
  if (status === 'PRESSAO_ALTA_1T' || String(status || '').startsWith('MONITORANDO')) {
    return <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded animate-pulse">📡 AO VIVO (Minuto {minuto ?? '—'}')</span>;
  }
  return null;
}

const ESPELH0_1WIN_BRASIL = 'https://1win.com';

function base1win() {
  const configurado = String(import.meta.env.VITE_1WIN_BASE_URL || '').trim();
  return (configurado || ESPELH0_1WIN_BRASIL)
    .replace(/\/+$/, '')
    .replace(/\/pt(?:\/betting)?$/i, '');
}

function AcoesMercado({ stake, onStake, onSheet, onMultipla, naMultipla, destaqueMultipla, onTelegram, telegramLabel, telegramDisabled, inputClass }) {
  return (
    <div className="mt-2 space-y-2 min-w-0">
      <div className="grid grid-cols-2 gap-2">
        <div className="relative min-w-0">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-semibold">US$</span>
          <input
            type="number"
            step="0.01"
            value={stake}
            onChange={(e) => onStake(e.target.value)}
            className={`w-full min-h-[42px] border border-gray-700 text-white font-medium text-xs rounded pl-10 pr-2 outline-none ${inputClass}`}
          />
        </div>
        <button
          type="button"
          onClick={onSheet}
          className="min-h-[42px] min-w-0 w-full bg-[#1f2937] hover:bg-gray-700 text-gray-200 font-bold text-xs px-2 rounded leading-tight"
        >
          Enviar para Planilha
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onMultipla}
          className={`min-h-[42px] min-w-0 w-full font-bold text-xs px-2 rounded leading-tight ${
            naMultipla
              ? 'bg-amber-400 text-black'
              : destaqueMultipla
                ? 'bg-amber-400 text-black ring-2 ring-amber-200'
                : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
          }`}
        >
          <span>{naMultipla ? 'Na múltipla' : '+ Múltipla'}</span>
        </button>
        <button
          type="button"
          onClick={onTelegram}
          disabled={telegramDisabled}
          className="min-h-[42px] min-w-0 w-full bg-[#229ED9] hover:bg-[#1b8ec4] disabled:opacity-60 text-white font-bold text-xs px-2 rounded leading-tight"
        >
          <span>{telegramLabel}</span>
        </button>
      </div>
    </div>
  );
}

function formatSignedLine(raw) {
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return String(raw);
  if (n === 0) return '0';
  const sign = n > 0 ? '+' : '-';
  const abs = Math.abs(n);
  const text = Number.isInteger(abs) ? abs.toFixed(1) : String(abs);
  return `${sign}${text}`;
}

function formatMarketName(rawName, teams = {}) {
  const original = String(rawName || '').replace(/\s+/g, ' ').trim();
  if (!original) return original;
  if (/^handicap(?:\s+asi[aá]tico)?\s+0\s*:/i.test(original)) return original;
  if (/^handicap\s*:/i.test(original)) return original;

  const asZero = (team) => {
    const clean = String(team || '').replace(/^[:\-–\s]+|[:\-–\s]+$/g, '').trim();
    return clean ? `Handicap 0: ${clean}` : 'Handicap 0';
  };
  const asLine = (team, line) => {
    const clean = String(team || '').replace(/^[:\-–\s]+|[:\-–\s]+$/g, '').trim();
    if (!clean) return original;
    if (Number(String(line).replace(',', '.')) === 0) return `Handicap 0: ${clean}`;
    return `Handicap: ${clean} ${formatSignedLine(line)}`;
  };

  const paren = original.match(/^(.*?)\s*\(\s*([+-]?\d+(?:[.,]\d+)?)\s*\)$/);
  if (paren && paren[1].trim()) return asLine(paren[1], paren[2]);

  const tail = original.match(/^(.*?)\s+([+-]?\d+(?:[.,]\d+)?)$/);
  if (tail && tail[1].trim()) {
    const line = Number(tail[2].replace(',', '.'));
    if (line === 0 || /^[+-]/.test(tail[2])) return asLine(tail[1], tail[2]);
  }

  const teamFirst = original.match(/^(.*?)\s+(?:empate anula(?:\s*\(\s*dnb\s*\))?|dnb|draw no bet)$/i);
  if (teamFirst && teamFirst[1].trim()) return asZero(teamFirst[1]);

  const labelFirst = original.match(/^(?:empate anula(?:\s*\(\s*dnb\s*\))?|dnb|draw no bet)(?:\s*[:\-–]\s*(.+))?$/i);
  if (labelFirst) return asZero(labelFirst[1] || teams.team || teams.favorite || '');

  return original;
}

const CATEGORIAS_MONITORADAS = ['Over/Under Gols', 'Ambas Marcam', 'Cantos', 'Cartões', 'Handicap'];

function categoriaMercado(nome, tipo) {
  const texto = `${nome || ''} ${tipo || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/canto|escanteio|corner/.test(texto)) return 'Cantos';
  if (/cartao|card/.test(texto)) return 'Cartões';
  if (/ambas|ambos|btts/.test(texto)) return 'Ambas Marcam';
  if (/handicap|empate anula|\bdnb\b/.test(texto)) return 'Handicap';
  if (/gol|\bover\b|\bunder\b|acima de|abaixo de/.test(texto)) return 'Over/Under Gols';
  return '';
}

function evPercentualLinha(linha) {
  const texto = String(linha?.margemEV || '').trim().replace('%', '').replace(',', '.');
  const daMargem = Number(texto);
  if (Number.isFinite(daMargem)) return Number(daMargem.toFixed(1));
  const bruto = Number(linha?.ev);
  if (Number.isFinite(bruto)) return Number((bruto * 100).toFixed(1));
  return 0;
}

function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mercadoDaSugestao(texto, mercados) {
  const alvo = normalizarBusca(texto);
  if (!alvo) return null;
  return (Array.isArray(mercados) ? mercados : []).find((item) => {
    const nome = normalizarBusca(item.tipo || item.name);
    return nome && (nome === alvo || nome.includes(alvo) || alvo.includes(nome));
  }) || null;
}

function linhasOperacionaisQuant(quant, gameId) {
  const blocos = [
    ['Cantos', quant?.mercadosAdicionais?.cantos],
    ['Cartões', quant?.mercadosAdicionais?.cartoes]
  ];
  const saida = [];
  blocos.forEach(([categoria, bloco]) => {
    (Array.isArray(bloco?.linhas) ? bloco.linhas : []).forEach((linha) => {
      const evPercent = evPercentualLinha(linha);
      const odd1win = Number(linha?.oddCasa);
      if (!(odd1win > 1)) return;
      const lado = /under/i.test(linha?.nome || '') ? 'Under' : 'Over';
      const linhaNum = String(linha?.nome || '').match(/(\d+(?:\.\d+)?)/)?.[1] || '';
      const slug = `${categoria}-${lado}-${linhaNum}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9.]+/g, '-');
      saida.push({
        id: `quant_${gameId}_${slug}`,
        name: `${categoria}: ${lado} ${linhaNum}`.trim(),
        marketType: categoria,
        odd1win: Number(odd1win.toFixed(2)),
        fairOdd: Number(linha?.oddJusta) > 1 ? Number(Number(linha.oddJusta).toFixed(2)) : 0,
        evPercent,
        isTopEV: evPercent > 8
      });
    });
  });
  return saida;
}

function entryNetProfit(bet) {
  const stake = Number(Number(bet?.stake).toFixed(2)) || 0;
  const odd = Number(bet?.odd) || 0;
  if (bet?.status === 'GREEN') return Number((stake * (odd - 1)).toFixed(2));
  if (bet?.status === 'RED') return Number((-stake).toFixed(2));
  if (bet?.status === 'CASHOUT') {
    const returned = Number(bet?.returnedAmount);
    if (Number.isFinite(returned)) {
      const net = Number((returned - stake).toFixed(2));
      return Math.abs(net) < 0.005 ? 0 : net;
    }
    const stored = Number(bet?.realProfit);
    return Number.isFinite(stored) ? Number(stored.toFixed(2)) : 0;
  }
  return 0;
}

function formatRecapDate(value) {
  const iso = String(value || '').trim().slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso || '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function signedMoney(value) {
  const n = Number(value) || 0;
  return `${n >= 0 ? '+' : '-'}US$ ${Math.abs(n).toFixed(2)}`;
}

function signedUnits(value) {
  const n = Number(value) || 0;
  return `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}`;
}

const MONTH_NAMES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey || '').split('-');
  const name = MONTH_NAMES_PT[Number(month) - 1] || month;
  return `${name} ${year}`;
}

function growthPercent(profit, base) {
  const gain = Number(profit) || 0;
  const start = Number(base) || 0;
  if (!(start > 0)) return 0;
  return (gain / start) * 100;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function textoVisivel(valor) {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

const FUSO_PLANILHA = 'America/Sao_Paulo';

function diaNoFuso(instante) {
  const data = new Date(instante);
  if (Number.isNaN(data.getTime())) return '';
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_PLANILHA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(data);
  const ler = (tipo) => partes.find((parte) => parte.type === tipo)?.value || '';
  return `${ler('year')}-${ler('month')}-${ler('day')}`;
}

function dataCalendarioLocal(dStr) {
  const texto = String(dStr ?? '').trim();
  if (!texto) return '';
  const barra = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (barra) return `${barra[3]}-${barra[2].padStart(2, '0')}-${barra[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const instante = Date.parse(texto);
  if (Number.isFinite(instante) && (texto.includes('T') || texto.includes(':'))) return diaNoFuso(instante);
  const iso = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : texto.slice(0, 10);
}

function listaDeApostas(valor) {
  if (Array.isArray(valor)) return valor.filter((item) => item && typeof item === 'object');
  if (Array.isArray(valor?.bets)) return valor.bets.filter((item) => item && typeof item === 'object');
  return [];
}

function apostaDaNuvem(linha) {
  if (!linha || typeof linha !== 'object') return null;
  const statusBruto = String(linha.status || 'PENDING').toUpperCase();
  const status = statusBruto === 'PENDENTE' ? 'PENDING' : statusBruto;
  const odd = Number(linha.odd);
  const stake = Number(linha.stake);
  const lucro = Number(linha.lucro ?? linha.realProfit);
  const data = dataCalendarioLocal(linha.date || linha.created_at || '');
  return {
    id: linha.id != null ? String(linha.id) : '',
    match: linha.jogo || linha.partida || linha.match || '',
    league: linha.league || linha.liga || '',
    market: linha.mercado || linha.market || '',
    marketType: linha.marketType || linha.mercado || linha.market || '',
    odd: Number.isFinite(odd) ? odd : 0,
    stake: Number.isFinite(stake) ? stake : 0,
    status,
    realProfit: Number.isFinite(lucro) ? lucro : 0,
    returnedAmount: linha.returnedAmount,
    date: data,
    timestamp: Date.parse(linha.created_at || '') || Number(linha.timestamp) || 0,
    fixtureId: linha.fixture_id || linha.fixtureId || null
  };
}

function identidadeAposta(aposta) {
  const confronto = normalizarBusca(aposta?.match || aposta?.jogo || aposta?.partida).replace(/\s+vs\.?\s+/g, ' x ');
  return `${confronto}|${normalizarBusca(aposta?.market || aposta?.mercado)}`;
}

function unirAposta(atual, nova) {
  const resolvido = (status) => ['GREEN', 'RED', 'CASHOUT'].includes(String(status || '').toUpperCase());
  const status = resolvido(atual.status) ? atual.status : (resolvido(nova.status) ? nova.status : (atual.status || nova.status));
  const odd = Number(atual.odd) > 1 ? atual.odd : nova.odd;
  const stake = Number(atual.stake) > 0 ? atual.stake : nova.stake;
  return {
    ...nova,
    ...atual,
    id: atual.id || nova.id,
    match: atual.match || nova.match,
    market: atual.market || nova.market,
    status,
    odd,
    stake,
    returnedAmount: atual.returnedAmount ?? nova.returnedAmount,
    realProfit: atual.realProfit ?? nova.realProfit,
    date: atual.date || nova.date
  };
}

function mesclarApostas(listas) {
  const mapa = new Map();
  listas.flat().forEach((bruta) => {
    const aposta = bruta?.match || bruta?.market ? bruta : apostaDaNuvem(bruta);
    if (!aposta || (!aposta.match && !aposta.market)) return;
    const id = String(aposta.id || '');
    let chave = '';
    if (id.startsWith('bet_')) chave = id;
    else {
      const alvo = identidadeAposta(aposta);
      const encontradas = [...mapa.entries()].filter(([, item]) => identidadeAposta(item) === alvo);
      if (encontradas.length === 1) chave = encontradas[0][0];
    }
    if (!chave) chave = id || `${identidadeAposta(aposta)}|${String(aposta.date || '').slice(0, 10)}|${mapa.size}`;
    const anterior = mapa.get(chave);
    mapa.set(chave, anterior ? unirAposta(anterior, aposta) : { ...aposta, id: aposta.id || chave });
  });
  return [...mapa.values()];
}

function apostaDoMetodo(aposta) {
  const dia = dataCalendarioLocal(aposta?.date);
  if (!dia || dia < INICIO_METODO) return false;
  const marco = Number(aposta?.timestamp);
  return !Number.isFinite(marco) || marco <= 0 || marco >= CORTE_REGISTRO_MS;
}

function bancaConsolidada(apostas) {
  const lucro = (Array.isArray(apostas) ? apostas : [])
    .filter(apostaDoMetodo)
    .reduce((total, aposta) => total + entryNetProfit(aposta), 0);
  return roundMoney(BANCA_OPERACIONAL + lucro);
}

function signedGrowth(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const oneDecimal = Math.round(abs * 10) / 10;
  const twoDecimals = Math.floor(abs * 100 + 1e-8) / 100;
  const keepTwo = abs < 2 && Math.abs(oneDecimal - twoDecimals) >= 0.04;
  const shown = keepTwo ? twoDecimals : oneDecimal;
  return `${n >= 0 ? '+' : '-'}${shown.toFixed(keepTwo ? 2 : 1)}%`;
}

function buildDailyRecapText({ date, entries, greens, reds, cashouts, balance, units }) {
  const lines = (Array.isArray(entries) ? entries : []).map((entry) => {
    const match = String(entry.match || 'Jogo').trim();
    const market = String(entry.market || 'Mercado').trim();
    const status = String(entry.status || '').toUpperCase();
    const odd = Number(entry.odd);
    const oddLabel = Number.isFinite(odd) ? odd.toFixed(2) : '—';
    if (status === 'GREEN') return `✅ ${match} — ${market} (Odd ${oddLabel})`;
    if (status === 'RED') return `❌ ${match} — ${market} (Odd ${oddLabel})`;
    if (status === 'CASHOUT') return `🟡 ${match} — ${market} (Cash Out / Reembolso)`;
    return '';
  }).filter(Boolean);

  return [
    '📊 FECHAMENTO DIÁRIO | BOT FUTSTATS',
    `🗓 Data: ${formatRecapDate(date)}`,
    '',
    lines.join('\n'),
    '',
    '📈 Resumo do Dia:',
    `🟢 Greens: ${Number(greens) || 0}`,
    `🔴 Reds: ${Number(reds) || 0}`,
    `🟡 Cashouts: ${Number(cashouts) || 0}`,
    `💰 Saldo do Dia: ${Number(units) >= 0 ? '+' : ''}${Number(units || 0).toFixed(2)} Unidades`,
    '',
    'Gestão de banca e consistência com o método +EV! 🎯🚀'
  ].join('\n');
}

function rotuloTabela(nome, linha) {
  if (!linha || !Number.isFinite(Number(linha.pos))) return nome;
  const pts = Number.isFinite(Number(linha.pts)) ? ` (${linha.pts} pts)` : '';
  return `${linha.pos}º ${nome}${pts}`;
}

function BadgeForma({ forma }) {
  const letras = String(forma || '-----').slice(0, 5).padEnd(5, '-').split('');
  return (
    <span className="inline-flex gap-1">
      {letras.map((letra, indice) => {
        const codigo = String(letra || '').toUpperCase();
        const rotulo = codigo === 'W' || codigo === 'V' ? 'V' : codigo === 'L' ? 'D' : codigo === 'D' || codigo === 'E' ? 'E' : '–';
        const cor = rotulo === 'V'
          ? 'bg-[#00c853] text-black'
          : rotulo === 'D'
            ? 'bg-red-500 text-white'
            : 'bg-gray-600 text-gray-200';
        return (
          <span key={`${rotulo}-${indice}`} className={`w-4 h-4 rounded text-[9px] font-bold inline-flex items-center justify-center ${cor}`}>
            {rotulo}
          </span>
        );
      })}
    </span>
  );
}

function lerProbabilidade(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor > 1 ? valor / 100 : valor;
  const texto = String(valor ?? '').trim().replace('%', '').replace(',', '.');
  if (!texto) return null;
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return null;
  return numero > 1 ? numero / 100 : numero;
}

function probabilidadeOver25DoJogo(game, quant) {
  const candidatos = [
    game?.over25_prob,
    quant?.probabilities?.over25,
    game?.apiData?.probabilities?.over25,
    game?.probabilities?.over25,
    game?.over25
  ];
  for (const candidato of candidatos) {
    const valor = lerProbabilidade(candidato);
    if (valor != null) return valor;
  }
  const mercados = quant?.mercadosAuditados || quant?.mercados || [];
  const linha = mercados.find((item) => (
    item?.mercado === 'over25'
    || /over\s*2[.,]5|acima de 2[.,]5/i.test(`${item?.nome || ''} ${item?.tipo || ''}`)
  ));
  return lerProbabilidade(linha?.probabilidade ?? linha?.probabilidadeModelo);
}

function estimarOverPorMedia(media) {
  const intensidade = Number(media);
  if (!(intensidade > 0)) return null;
  const base = Math.exp(-intensidade);
  const under = base * (1 + intensidade + (intensidade * intensidade) / 2);
  return Math.min(0.97, Math.max(0, 1 - under));
}

function mediaGolsDoJogo(game, quant) {
  const pares = [
    [quant?.lambda, quant?.mu],
    [game?.lambda, game?.mu],
    [game?.homeXg, game?.awayXg],
    [game?.xgCasa, game?.xgFora],
    [quant?.perfilTimes?.mandante?.mediaGolsMarcados, quant?.perfilTimes?.visitante?.mediaGolsMarcados],
    [game?.apiData?.perfil?.mandante?.mediaGolsMarcados, game?.apiData?.perfil?.visitante?.mediaGolsMarcados]
  ];
  for (const [casa, fora] of pares) {
    const mandante = Number(casa);
    const visitante = Number(fora);
    if (mandante > 0 && visitante > 0) return mandante + visitante;
  }
  const diretos = [game?.mediaGols, game?.xg, game?.expectedGoals, quant?.totalGols, game?.golsEsperados];
  for (const item of diretos) {
    const numero = Number(item);
    if (numero > 0) return numero;
  }
  return null;
}

function ligaPrincipal(game) {
  const nome = String(game?.league || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\bpremier league\b/.test(nome)) return true;
  if (/\b(la liga|laliga)\b/.test(nome) && !/\b(2|ii|segunda)\b/.test(nome)) return true;
  if (/\bserie a\b/.test(nome) && !/\b(brasil|brazil|brasileir)/.test(nome)) return true;
  if (/\bbundesliga\b/.test(nome) && !/\b(2|ii|segunda)\b/.test(nome)) return true;
  return /brasileir/.test(nome) && /\bserie [ab]\b/.test(nome);
}

function leituraOver25(game, quant) {
  const explicita = probabilidadeOver25DoJogo(game, quant);
  if (explicita != null) return { probabilidade: explicita, conhecida: true };
  const pelaMedia = estimarOverPorMedia(mediaGolsDoJogo(game, quant));
  if (pelaMedia != null) return { probabilidade: pelaMedia, conhecida: true };
  const score = Number(game?.score);
  if (score >= 100) {
    return { probabilidade: Math.min(0.72, 0.58 + (score - 100) / 250), conhecida: true };
  }
  return { probabilidade: null, conhecida: false };
}

function jogoVisivelNoRadar(game, quant) {
  const leitura = leituraOver25(game, quant);
  if (!leitura.conhecida) return true;
  if (leitura.probabilidade >= 0.58) return true;
  if (Number(game?.score) >= 100) return true;
  const media = mediaGolsDoJogo(game, quant);
  return ligaPrincipal(game) && media != null && media >= 2.2;
}

function probabilidadeOver15DoJogo(game, quant) {
  const candidatos = [
    game?.over15_prob,
    quant?.probabilities?.over15,
    game?.apiData?.probabilities?.over15,
    game?.probabilities?.over15,
    game?.over15
  ];
  for (const candidato of candidatos) {
    const valor = lerProbabilidade(candidato);
    if (valor != null) return valor;
  }
  const mercados = quant?.mercadosAuditados || quant?.mercados || [];
  const linha = mercados.find((item) => (
    item?.mercado === 'over15'
    || /over\s*1[.,]5|acima de 1[.,]5/i.test(`${item?.nome || ''} ${item?.tipo || ''}`)
  ));
  return lerProbabilidade(linha?.probabilidade ?? linha?.probabilidadeModelo);
}

function estimarOver15PorMedia(media) {
  const intensidade = Number(media);
  if (!(intensidade > 0)) return null;
  const under = Math.exp(-intensidade) * (1 + intensidade);
  return Math.min(0.97, Math.max(0, 1 - under));
}

function altaProbabilidadeOver(game, quant) {
  const media = mediaGolsDoJogo(game, quant);
  const over25 = probabilidadeOver25DoJogo(game, quant) ?? estimarOverPorMedia(media);
  const over15 = probabilidadeOver15DoJogo(game, quant) ?? estimarOver15PorMedia(media);
  return (over25 != null && over25 >= 0.60) || (over15 != null && over15 >= 0.78);
}

function rotuloJogoDia(game, quant) {
  const prefixo = altaProbabilidadeOver(game, quant) ? '⭐ ALTA PROBABILIDADE (Over 1.5 / 2.5) ' : '';
  return `${prefixo}[${game.league}] ${game.home} vs ${game.away} - ${game.time}`;
}

function SeletorLigas({ value, onChange, className }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={className}>
      {OPCOES_LIGA.map((opcao) => (
        <option key={opcao.value} value={opcao.value}>{opcao.label}</option>
      ))}
    </select>
  );
}

function textoTagOver25(game, quant) {
  const leitura = leituraOver25(game, quant);
  if (!leitura.conhecida) return 'Prob. Over 2.5: Em análise';
  return `Prob. Over 2.5: ${(leitura.probabilidade * 100).toFixed(1)}%`;
}

function GradeProbabilidades({ probabilities, home, away }) {
  if (!probabilities) return null;
  const itens = [
    [home || 'Casa', probabilities.homeWin],
    ['Empate', probabilities.draw],
    [away || 'Fora', probabilities.awayWin],
    ['Over 2.5', probabilities.over25],
    ['BTTS', probabilities.btts]
  ];
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {itens.map(([nome, valor]) => (
        <span key={nome} className="text-[10px] font-bold text-gray-100 bg-[#0d1117] border border-gray-700 rounded px-2 py-1">
          {nome} {textoVisivel(valor) || '—'}
        </span>
      ))}
    </div>
  );
}

function standingsDoQuant(quant) {
  if (quant?.standings?.home || quant?.standings?.away) return quant.standings;
  const tabela = quant?.tabela;
  if (!tabela?.mandante && !tabela?.visitante) return null;
  const lado = (linha) => ({
    rank: Number.isFinite(Number(linha?.pos)) ? Number(linha.pos) : '-',
    points: Number.isFinite(Number(linha?.pts)) ? Number(linha.pts) : '-',
    form: linha?.forma || '-----',
    goalsDiff: Number.isFinite(Number(linha?.sg)) ? Number(linha.sg) : 0
  });
  return { home: lado(tabela?.mandante), away: lado(tabela?.visitante) };
}

function LadoClassificacao({ titulo, linha }) {
  const temTabela = linha && linha.rank !== '-' && linha.rank != null && linha.points !== '-' && linha.points != null;
  return (
    <div className="flex-1 min-w-[150px] rounded-lg border border-gray-800 bg-[#0d1117] p-2">
      <div className="text-[10px] text-gray-400 font-bold mb-1">{titulo}</div>
      {temTabela && (
        <div className="text-[11px] text-gray-200 mb-1">{linha.rank}º Lugar | {linha.points} pts</div>
      )}
      <BadgeForma forma={linha?.form} />
    </div>
  );
}

function BlocoClassificacaoMomento({ quant, home, away }) {
  const standings = standingsDoQuant(quant);
  if (!standings) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      <LadoClassificacao titulo={home} linha={standings.home} />
      <LadoClassificacao titulo={away} linha={standings.away} />
    </div>
  );
}

function ProjecaoEstatistica({ stats }) {
  const cantos = Number(stats?.expectedCorners);
  const cartoes = Number(stats?.expectedCards);
  const temCantos = Number.isFinite(cantos);
  const temCartoes = Number.isFinite(cartoes);
  if (!temCantos && !temCartoes) return null;
  return (
    <div className="text-[11px] text-gray-200">
      {temCantos && <span>⛳ Cantos Projetados: {cantos.toFixed(1)}</span>}
      {temCantos && temCartoes && <span> | </span>}
      {temCartoes && <span>🟨 Cartões Projetados: {cartoes.toFixed(1)}</span>}
    </div>
  );
}

function BarraClassificacao({ quant, home, away }) {
  const tabela = quant?.tabela;
  if (!tabela?.mandante && !tabela?.visitante) return null;
  return (
    <div className="text-[11px] font-semibold text-gray-200 bg-[#0d1117] border border-gray-800 rounded-lg px-2.5 py-1.5 mb-2">
      [ {rotuloTabela(home, tabela.mandante)} vs {rotuloTabela(away, tabela.visitante)} ]
    </div>
  );
}

function MercadoExtra({ titulo, bloco }) {
  if (!bloco || !(Number(bloco.mediaEsperada) > 0)) return null;
  const linhas = Array.isArray(bloco.linhas) ? bloco.linhas : [];
  const valiosos = linhas.filter((linha) => linha.temValor);
  const referencia = linhas.find((linha) => /Over/.test(linha.nome || '') && linha.oddJusta);
  return (
    <div className="rounded-lg border border-gray-700 bg-[#0d1117] p-2.5 flex-1 min-w-[180px]">
      <div className="text-[10px] tracking-wide text-gray-400 font-bold">{titulo}</div>
      <div className="text-sm font-bold text-white mt-1">Média {Number(bloco.mediaEsperada).toFixed(1)}</div>
      {referencia && !valiosos.length && (
        <div className="text-[10px] text-gray-400 mt-1">
          {referencia.nome}: justa {Number(referencia.oddJusta).toFixed(2)}
        </div>
      )}
      {valiosos.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {valiosos.map((linha) => (
            <span key={linha.nome} className="text-[10px] font-bold text-black bg-[#00c853] rounded px-1.5 py-0.5">
              {linha.nome} {linha.margemEV}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function jogosH2H(quant) {
  const recentes = (Array.isArray(quant?.h2hList) ? quant.h2hList : []).filter((jogo) => jogo && typeof jogo === 'object');
  if (recentes.length) {
    return recentes.map((jogo, indice) => ({
      chave: `${jogo.date || indice}-${jogo.home || ''}-${jogo.away || ''}`,
      texto: `${textoVisivel(jogo.date)}: ${textoVisivel(jogo.home)} ${textoVisivel(jogo.score)} ${textoVisivel(jogo.away)}`
    }));
  }
  const legado = (Array.isArray(quant?.h2h) ? quant.h2h : []).filter((jogo) => jogo && typeof jogo === 'object');
  return legado.map((jogo, indice) => ({
    chave: `${jogo.data || indice}-${indice}`,
    texto: `${textoVisivel(jogo.data)}: ${textoVisivel(jogo.casa)} ${textoVisivel(jogo.golsCasa)} x ${textoVisivel(jogo.golsFora)} ${textoVisivel(jogo.fora)}`
  }));
}

function DetalheQuantExtra({ quant, home, away }) {
  if (!quant) return null;
  const h2h = jogosH2H(quant);
  const cantos = quant.mercadosAdicionais?.cantos;
  const cartoes = quant.mercadosAdicionais?.cartoes;
  const ultimos = quant.ultimos10;
  const temMercado = Number(cantos?.mediaEsperada) > 0 || Number(cartoes?.mediaEsperada) > 0;
  const projecao = quant.statsProjection || {
    expectedCorners: cantos?.mediaEsperada,
    expectedCards: cartoes?.mediaEsperada
  };
  return (
    <div className="mt-2.5 space-y-2">
      {(ultimos?.mandante || ultimos?.visitante) && (
        <div className="text-[10px] text-gray-400 leading-relaxed">
          {ultimos?.mandante && <div>Últimos 10 · {home}: Over 2.5 {ultimos.mandante.over25 ?? '—'}% · Ambas {ultimos.mandante.btts ?? '—'}%</div>}
          {ultimos?.visitante && <div>Últimos 10 · {away}: Over 2.5 {ultimos.visitante.over25 ?? '—'}% · Ambas {ultimos.visitante.btts ?? '—'}%</div>}
        </div>
      )}
      <ProjecaoEstatistica stats={projecao} />
      <details open className="rounded-lg border border-gray-700 bg-[#0d1117] px-2.5 py-1.5">
        <summary className="text-[11px] font-bold text-gray-200 cursor-pointer list-none [&::-webkit-details-marker]:hidden">▶ Histórico Recente (H2H)</summary>
        <div className="mt-1.5 space-y-1">
          {h2h.length > 0 ? h2h.map((jogo) => (
            <div key={jogo.chave} className="text-[11px] text-gray-300">
              {jogo.texto}
            </div>
          )) : (
            <div className="text-[11px] text-gray-400">Sem registros prévios no H2H</div>
          )}
        </div>
      </details>
      {temMercado && (
        <div className="flex flex-wrap gap-2">
          <MercadoExtra titulo="MERCADO DE ESCANTEIOS" bloco={cantos} />
          <MercadoExtra titulo={"MERCADO DE CART\u00d5ES"} bloco={cartoes} />
        </div>
      )}
    </div>
  );
}

const ABAS_VALIDAS = ['opps', 'sheet', 'markets', 'desempenho'];

function lerAbaSalva() {
  try {
    const parametro = new URLSearchParams(window.location.search).get('tab');
    if (ABAS_VALIDAS.includes(parametro)) return parametro;
    const salva = localStorage.getItem('sp_active_tab');
    if (ABAS_VALIDAS.includes(salva)) return salva;
  } catch {
    /* o navegador pode bloquear o storage */
  }
  return 'sheet';
}

function gravarAba(aba) {
  try {
    localStorage.setItem('sp_active_tab', aba);
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === aba) return;
    url.searchParams.set('tab', aba);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* o navegador pode bloquear o storage */
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState(lerAbaSalva);
  const [activeShift, setActiveShift] = useState(() => {
    return localStorage.getItem('sp_active_shift') || 'europe';
  });
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [ligaPlanilha, setLigaPlanilha] = useState('all');
  const [jogoFocado, setJogoFocado] = useState('');

  const [currentBankroll, setCurrentBankroll] = useState(BANCA_OPERACIONAL);
  const [sheetBets, setSheetBets] = useState([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  useEffect(() => {
    gravarAba(activeTab);
  }, [activeTab]);

  useEffect(() => {
    let ativo = true;
    let remotoAplicado = false;
    const aplicar = (apostas, remoto) => {
      if (!ativo) return;
      const lista = (Array.isArray(apostas) ? apostas : []).map((aposta) => ({
        ...aposta,
        date: dataCalendarioLocal(aposta.date || aposta.created_at)
      }));
      lista.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
      setSheetBets(lista);
      setCurrentBankroll(bancaConsolidada(lista));
      const hoje = getTodayLocal();
      const temHoje = lista.some((aposta) => dataCalendarioLocal(aposta.date) === hoje);
      if (remoto && followTodayRef.current && temHoje) setSelectedDate(hoje);
      else if (remoto && !temHoje && lista.length) setSelectedDate('ALL');
    };
    const fallbackLocal = () => {
      try {
        const salvo = localStorage.getItem('sp_sheet_bets');
        if (salvo) return listaDeApostas(JSON.parse(salvo));
      } catch (err) {
        console.warn('Histórico do navegador indisponível:', err?.message || err);
      }
      return listaDeApostas(livroLocal);
    };
    const espera = setTimeout(() => {
      if (!ativo || remotoAplicado) return;
      aplicar(fallbackLocal(), false);
      setIsDataLoaded(true);
    }, 8000);
    const carregarHistorico = async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/saved-data`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(25000)
        });
        const data = await resp.json();
        if (!resp.ok || !data || !(data.success || data.sucesso || Array.isArray(data.bets))) {
          throw new Error(data?.message || 'Resposta inválida da planilha.');
        }
        const remotas = listaDeApostas(data);
        remotoAplicado = true;
        aplicar(remotas, true);
        try {
          localStorage.setItem('sp_sheet_bets', JSON.stringify(remotas));
        } catch (_) { /* o navegador pode bloquear o storage */ }
      } catch (err) {
        console.warn('Histórico do backend indisponível, usando o livro local:', err?.message || err);
        if (!remotoAplicado) aplicar(fallbackLocal(), false);
      } finally {
        clearTimeout(espera);
        if (ativo) setIsDataLoaded(true);
      }
    };
    carregarHistorico();
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, []);

  const gravarApostaNaNuvem = async (aposta) => {
    const destinos = [`${API_BASE}/api/apostas/registrar`];
    if (emLocal() && !import.meta.env.VITE_API_URL) destinos.push(apiUrl('/api/apostas/registrar'));
    const corpo = JSON.stringify({
      jogo: aposta.match,
      mercado: aposta.market,
      odd: aposta.odd,
      stake: aposta.stake,
      status: aposta.status === 'PENDING' ? 'PENDENTE' : (aposta.status || 'PENDENTE'),
      lucro: aposta.realProfit,
      returnedAmount: aposta.returnedAmount,
      semApi: aposta.semApi === true,
      fixtureId: aposta.semApi ? null : (aposta.fixtureId || null),
      league: aposta.league || ''
    });
    for (const destino of destinos) {
      try {
        const resp = await fetch(destino, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: corpo
        });
        const data = await resp.json().catch(() => null);
        if (resp.ok && data?.success && data.aposta) {
          return {
            ...aposta,
            ...data.aposta,
            id: data.aposta.id != null ? String(data.aposta.id) : aposta.id,
            status: aposta.status,
            realProfit: aposta.realProfit,
            returnedAmount: aposta.returnedAmount,
            semApi: aposta.semApi === true || data.aposta.semApi === true,
            league: aposta.league || data.aposta.league || '',
            marketType: aposta.marketType || data.aposta.marketType,
            gameLink: aposta.gameLink || data.aposta.gameLink || '',
            date: dataCalendarioLocal(data.aposta.date || data.aposta.created_at || aposta.date)
          };
        }
      } catch (erro) {
        console.warn('Planilha na nuvem:', erro?.message || erro);
      }
    }
    return null;
  };

  const persistToDisk = async (newBets, newBank) => {
    try {
      localStorage.setItem('sp_sheet_bets', JSON.stringify(newBets));
      localStorage.setItem('sp_current_bank', newBank.toString());
      await fetch(apiUrl('/api/save-data'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bets: newBets, bankroll: newBank })
      });
    } catch (e) {
      console.error('Erro ao gravar no disco:', e);
    }
  };

  const [saldoCdb, setSaldoCdb] = useState(lerSaldoCdb);
  const [vistaPlanilha, setVistaPlanilha] = useState('entradas');
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const recommendedStake = STAKE_PADRAO;
  const gravarSaldoCdb = (valor) => {
    const saldo = roundMoney(Math.max(0, Number(valor) || 0));
    try {
      localStorage.setItem('sp_cdb_saldo', String(saldo));
    } catch {
      /* o navegador pode bloquear o storage */
    }
    setSaldoCdb(saldo);
  };

  const [customInputs, setCustomInputs] = useState(() => {
    try {
      const saved = localStorage.getItem('sp_custom_inputs');
      const atual = saved ? JSON.parse(saved) : {};
      if (localStorage.getItem('sp_operacao') === INICIO_METODO) {
        if (localStorage.getItem('sp_stake_padrao') === String(STAKE_PADRAO)) return atual;
        const ajustadas = {};
        Object.entries(atual).forEach(([id, valor]) => {
          const stake = Number(valor?.stake);
          ajustadas[id] = stake === 3
            ? { ...(valor && typeof valor === 'object' ? valor : {}), stake: STAKE_PADRAO }
            : valor;
        });
        localStorage.setItem('sp_custom_inputs', JSON.stringify(ajustadas));
        localStorage.setItem('sp_stake_padrao', String(STAKE_PADRAO));
        return ajustadas;
      }
      const limpas = {};
      Object.entries(atual).forEach(([id, valor]) => {
        limpas[id] = { ...(valor && typeof valor === 'object' ? valor : {}), stake: STAKE_PADRAO };
      });
      localStorage.setItem('sp_custom_inputs', JSON.stringify(limpas));
      localStorage.setItem('sp_operacao', INICIO_METODO);
      localStorage.setItem('sp_stake_padrao', String(STAKE_PADRAO));
      localStorage.removeItem('sp_sheet_bets');
      return limpas;
    } catch {
      return {};
    }
  });

  const [opportunities, setOpportunities] = useState(() => {
    try {
      const saved = localStorage.getItem('sp_opportunities');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [loading, setLoading] = useState(false);
  const [erroVarredura, setErroVarredura] = useState('');
  const [erroAuditoria, setErroAuditoria] = useState({});

  const [onewinLinks, setOnewinLinks] = useState(() => {
    try {
      const saved = localStorage.getItem('sp_onewin_links');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [onewinAudits, setOnewinAudits] = useState(() => {
    try {
      const saved = localStorage.getItem('sp_onewin_audits');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [onewinQuants, setOnewinQuants] = useState(() => {
    try {
      const saved = localStorage.getItem('sp_onewin_quants');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [loading1win, setLoading1win] = useState({});
  const [loadingIa, setLoadingIa] = useState({});
  const [erroIa, setErroIa] = useState({});
  const [analiseIa, setAnaliseIa] = useState({});
  const [publishingTip, setPublishingTip] = useState({});
  const [publishedTip, setPublishedTip] = useState({});
  const [recapPreview, setRecapPreview] = useState(null);
  const [sendingRecap, setSendingRecap] = useState(false);
  const [bilheteMultipla, setBilheteMultipla] = useState([]);
  const [multiplaOddText, setMultiplaOddText] = useState('');
  const [multiplaStakeText, setMultiplaStakeText] = useState('');
  const [multiplaOddEdited, setMultiplaOddEdited] = useState(false);
  const [radarPlanilhaAberto, setRadarPlanilhaAberto] = useState({});
  const entradaManualVazia = () => ({
    jogo: '',
    mercado: '',
    odd: '',
    stake: recommendedStake.toFixed(2),
    status: 'PENDENTE',
    devolvido: '',
    semApi: true,
    erro: '',
    salvando: false
  });
  const [entradaManualAberta, setEntradaManualAberta] = useState(false);
  const [entradaManual, setEntradaManual] = useState(entradaManualVazia);

  const normalizeDate = dataCalendarioLocal;

  const getTodayLocal = () => diaNoFuso(Date.now());

  const [selectedDate, setSelectedDate] = useState(() => getTodayLocal());
  const [profitPeriod, setProfitPeriod] = useState(() => {
    const saved = localStorage.getItem('sp_profit_period');
    if (saved === 'ALL' || saved === 'CURRENT' || /^\d{4}-\d{2}$/.test(saved || '')) return saved;
    return 'CURRENT';
  });
  const followTodayRef = useRef(true);

  useEffect(() => {
    if (!supabaseMonitor) return undefined;
    let montado = true;
    const receber = (payload) => {
      if (!montado) return;
      const linha = payload?.new;
      if (!linha || typeof linha !== 'object') return;
      const inclusao = String(payload?.eventType || payload?.event || '').toUpperCase() === 'INSERT'
        && (linha.jogo || linha.mercado || linha.match || linha.market);
      if (!inclusao) {
        setSheetBets((atual) => (Array.isArray(atual) ? atual : []).map((aposta) => aplicarMonitorNaAposta(aposta, linha)));
        return;
      }
      const nova = apostaDaNuvem(linha);
      if (!nova?.match && !nova?.market) return;
      setSheetBets((atual) => {
        const lista = Array.isArray(atual) ? atual : [];
        const chave = identidadeAposta(nova);
        if (lista.some((item) => String(item.id) === String(nova.id) || identidadeAposta(item) === chave)) {
          return lista.map((aposta) => aplicarMonitorNaAposta(aposta, linha));
        }
        return [nova, ...lista];
      });
    };
    const channel = assinarCanal(
      supabaseMonitor
        .channel('monitor-over-25')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'apostas' }, receber)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'apostas' }, receber)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'match_timeline' }, receber)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_timeline' }, receber)
    );
    return () => {
      montado = false;
      supabaseMonitor.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let ativo = true;
    const lerEstadoLocal = async () => {
      try {
        const resposta = await fetch(`/live_status.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!resposta.ok) return;
        const dados = await resposta.json();
        const jogos = Array.isArray(dados?.jogos) ? dados.jogos : [];
        if (!jogos.length || !ativo) return;
        setSheetBets((atual) => (Array.isArray(atual) ? atual : []).map((aposta) => {
          const linha = jogos.find((item) => (
            nomesIguais(aposta.match, item.partida || item.match)
            || (item.id != null && String(aposta.nuvemId || aposta.id) === String(item.id))
            || (item.fixture_id != null && aposta.fixtureId != null && String(aposta.fixtureId) === String(item.fixture_id))
          ));
          return linha ? aplicarMonitorNaAposta(aposta, linha) : aposta;
        }));
      } catch (_) { /* o monitor ainda não gravou o fallback */ }
    };
    lerEstadoLocal();
    const timer = setInterval(lerEstadoLocal, 4000);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!followTodayRef.current) return;
      const today = getTodayLocal();
      setSelectedDate((prev) => (prev === today ? prev : today));
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isDataLoaded || activeTab !== 'sheet') return undefined;
    let ativo = true;
    const buscarNovas = async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/saved-data`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(20000)
        });
        const data = await resp.json();
        if (!ativo || !resp.ok || !Array.isArray(data?.bets)) return;
        const remotas = listaDeApostas(data).map((aposta) => ({
          ...aposta,
          date: dataCalendarioLocal(aposta.date || aposta.created_at)
        }));
        setSheetBets((atual) => {
          const lista = Array.isArray(atual) ? atual : [];
          const ids = new Set(lista.map((item) => String(item.id)));
          const chaves = new Set(lista.map(identidadeAposta));
          const novas = remotas.filter((item) => item && !ids.has(String(item.id)) && !chaves.has(identidadeAposta(item)));
          if (!novas.length) return lista;
          return [...novas, ...lista].sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
        });
      } catch (_) { /* a próxima leitura tenta de novo */ }
    };
    const timer = setInterval(buscarNovas, 20000);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, [isDataLoaded, activeTab]);

  useEffect(() => {
    if (!isDataLoaded) return;
    localStorage.setItem('sp_opportunities', JSON.stringify(opportunities));
    localStorage.setItem('sp_onewin_links', JSON.stringify(onewinLinks));
    localStorage.setItem('sp_onewin_audits', JSON.stringify(onewinAudits));
    localStorage.setItem('sp_onewin_quants', JSON.stringify(onewinQuants));
    localStorage.setItem('sp_custom_inputs', JSON.stringify(customInputs));
    localStorage.setItem('sp_active_shift', activeShift);
  }, [opportunities, onewinLinks, onewinAudits, onewinQuants, customInputs, activeShift, isDataLoaded]);

  const handleFetchOpps = async (shift = 'europe') => {
    setLoading(true);
    setActiveShift(shift);
    setErroVarredura('');
    setActiveTab('opps');
    try {
      const res = await fetch(urlVarredura(shift));
      const texto = await res.text();
      let data = null;
      try {
        data = JSON.parse(texto);
      } catch {
        data = null;
      }
      if (!res.ok || !data?.success || !Array.isArray(data.games)) {
        setErroVarredura(data?.message || 'Não foi possível buscar os jogos do dia.');
        return;
      }
      const ehBrasil = (jogo) => jogo?.regiao === 'Brasil' || jogo?.leagueGroup === 'brazil';
      const jogosDaRegiao = data.games.map((jogo) => ({
        ...jogo,
        isBrazil: ehBrasil(jogo)
      }));
      setOpportunities((atual) => {
        const mantidos = atual.filter((jogo) => (shift === 'brazil' ? !ehBrasil(jogo) : ehBrasil(jogo)));
        const idsNovos = new Set(jogosDaRegiao.map((jogo) => String(jogo.id)));
        const mescla = [
          ...jogosDaRegiao,
          ...mantidos.filter((jogo) => !idsNovos.has(String(jogo.id)))
        ];
        localStorage.setItem('sp_opportunities', JSON.stringify(mescla));
        return mescla;
      });
      setSelectedLeague(shift === 'brazil' ? 'brazil' : 'all');
      const initialInputs = { ...customInputs };
      jogosDaRegiao.forEach(g => {
        g.markets?.forEach(m => {
          if (!initialInputs[m.id]) {
            initialInputs[m.id] = {
              stake: recommendedStake,
              odd: m.defaultOdd
            };
          }
        });
      });
      setCustomInputs(initialInputs);
    } catch {
      setErroVarredura('Não foi possível buscar os jogos do dia.');
    } finally {
      setLoading(false);
    }
  };

  const handleAudit1Win = async (game) => {
    const linkOrId = String(onewinLinks[game.id] || '').trim();
    if (!linkOrId) {
      setErroAuditoria(prev => ({ ...prev, [game.id]: 'Cole o link ou o ID da partida na 1win.' }));
      return;
    }

    setErroAuditoria(prev => ({ ...(prev && typeof prev === 'object' ? prev : {}), [game.id]: '' }));
    setLoading1win(prev => ({ ...(prev && typeof prev === 'object' ? prev : {}), [game.id]: true }));

    try {
      const resp = await fetch(apiUrl('/api/check-1win-match'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urlOrId: linkOrId,
          homeTeam: game.home,
          awayTeam: game.away,
          league: game.league,
          score: game.score,
          justification: game.justification,
          stakeBase: recommendedStake
        })
      });
      const data = await resp.json().catch(() => null);
      const sucesso = Boolean(data?.success ?? data?.sucesso);
      const fonteAprovada = Array.isArray(data?.markets) ? data.markets : (Array.isArray(data?.odds) ? data.odds : null);
      if (!data || !sucesso || !Array.isArray(fonteAprovada)) {
        console.warn('Auditoria 1win não retornou dados válidos:', data);
        setErroAuditoria(prev => ({ ...(prev && typeof prev === 'object' ? prev : {}), [game.id]: 'A auditoria não respondeu. O detalhe ficou no console.' }));
        return;
      }
      const aprovados = fonteAprovada.map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const edge = Number(item?.edge ?? item?.evPercent);
        const odd1win = Number(item.odd1win);
        return {
          ...item,
          id: item.id || `aprovado_${index}`,
          name: item.tipo || item.name || 'Mercado',
          marketType: item.mercado || item.marketType || 'Resultado',
          odd1win: Number.isFinite(odd1win) ? odd1win : 0,
          fairOdd: Number(item.oddJusta ?? item.fairOdd) || 0,
          evPercent: Number.isFinite(edge) ? edge : 0,
          tag: item.tag || null,
          badge: item.badge || null,
          aptoMultipla: item.aptoMultipla === true || item.tag === 'FAVORITO' || item.tag === 'BASE MULTIPLA'
        };
      }).filter(Boolean);
      const quant = data.quant && typeof data.quant === 'object' && !Array.isArray(data.quant) ? data.quant : null;
      const apiData = data.apiData && typeof data.apiData === 'object' && !Array.isArray(data.apiData) ? data.apiData : null;
      setOnewinAudits(prev => ({ ...(prev && typeof prev === 'object' ? prev : {}), [game.id]: aprovados }));
      setCustomInputs(prev => {
        const next = { ...(prev && typeof prev === 'object' ? prev : {}) };
        aprovados.forEach((m) => {
          const stake = Number(m.stakeSugerida);
          next[m.id] = {
            stake: Number.isFinite(stake) && stake > 0 ? stake : recommendedStake,
            odd: m.odd1win
          };
        });
        return next;
      });
      setOnewinQuants(prev => ({ ...(prev && typeof prev === 'object' ? prev : {}), [game.id]: quant }));
      setOpportunities(prev => (Array.isArray(prev) ? prev : []).map(g => (
        g.id === game.id
          ? {
              ...g,
              auditado: true,
              oddsCapturadas: Array.isArray(data.oddsCapturadas) ? data.oddsCapturadas : [],
              apiData
            }
          : g
      )));
      setErroAuditoria(prev => ({
        ...prev,
        [game.id]: aprovados.length ? '' : 'A auditoria não devolveu odds da 1win.'
      }));
    } catch (err) {
      console.error('Erro capturado na auditoria:', err);
      setErroAuditoria(prev => ({ ...(prev && typeof prev === 'object' ? prev : {}), [game.id]: 'A auditoria não respondeu. O detalhe ficou no console.' }));
    } finally {
      setLoading1win(prev => ({ ...(prev && typeof prev === 'object' ? prev : {}), [game.id]: false }));
    }
  };

  const handleAnalisarIa = async (game) => {
    const mercados = Array.isArray(onewinAudits[game.id]) ? onewinAudits[game.id] : [];
    const oddsCapturadas = Array.isArray(game.oddsCapturadas) && game.oddsCapturadas.length
      ? game.oddsCapturadas
      : mercados.map((item) => ({
          tipo: item.tipo || item.name,
          mercado: item.mercado || item.marketType,
          odd1win: item.odd1win,
          oddJusta: item.fairOdd,
          edge: item.evPercent
        }));
    if (!oddsCapturadas.length) {
      setErroIa(prev => ({ ...prev, [game.id]: 'Audite as odds da 1win antes de pedir a leitura da I.A.' }));
      return;
    }
    setErroIa(prev => ({ ...prev, [game.id]: '' }));
    setLoadingIa(prev => ({ ...prev, [game.id]: true }));
    try {
      const res = await fetch(apiUrl('/api/analisar-ia'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          homeTeam: game.home,
          awayTeam: game.away,
          league: game.league,
          score: game.score,
          oddsCapturadas,
          apiData: game.apiData || {
            probabilities: onewinQuants[game.id]?.probabilities || null,
            lambda: onewinQuants[game.id]?.lambda ?? null,
            mu: onewinQuants[game.id]?.mu ?? null,
            fonteDados: onewinQuants[game.id]?.fonteDados || null,
            perfil: onewinQuants[game.id]?.perfilTimes || null,
            standings: onewinQuants[game.id]?.standings || null,
            h2h: onewinQuants[game.id]?.h2hList || []
          }
        })
      });
      const data = await res.json().catch(() => null);
      if (!data || !(data.success || data.sucesso)) {
        console.warn('Análise não retornou dados válidos:', data);
        setErroIa(prev => ({ ...(prev && typeof prev === 'object' ? prev : {}), [game.id]: 'A I.A. não respondeu.' }));
        return;
      }
      const textos = (valor) => (Array.isArray(valor) ? valor.map(textoVisivel).filter(Boolean) : []);
      const corpo = data.analise && typeof data.analise === 'object' ? data.analise : data;
      setAnaliseIa(prev => ({
        ...(prev && typeof prev === 'object' ? prev : {}),
        [game.id]: {
          diagnostico: textoVisivel(corpo.diagnostico),
          alertaRisco: textoVisivel(corpo.alertaRisco || corpo.alerta),
          sugestaoMultipla: textos(corpo.sugestaoMultipla),
          sugestaoValor: textos(corpo.sugestaoValor),
          modelo: textoVisivel(data.modelo)
        }
      }));
    } catch (e) {
      console.warn('Erro ao conectar com a análise da I.A.', e?.message || e);
      setErroIa(prev => ({ ...prev, [game.id]: 'A I.A. não respondeu. O detalhe ficou no console.' }));
    } finally {
      setLoadingIa(prev => ({ ...prev, [game.id]: false }));
    }
  };

  const handleStakeChange = (marketId, value) => {
    setCustomInputs(prev => ({
      ...prev,
      [marketId]: { ...prev[marketId], stake: Number(value) }
    }));
  };

  const handleOddChange = (marketId, value) => {
    setCustomInputs(prev => ({
      ...prev,
      [marketId]: { ...prev[marketId], odd: value }
    }));
  };

  const handleAddToSheet = async (game, market, originOdd = null, gameLink = '') => {
    const currentInput = customInputs[market.id] || { stake: recommendedStake, odd: market.defaultOdd || market.odd1win };
    const finalOdd = Number(originOdd) > 1
      ? Number(originOdd)
      : (Number(currentInput.odd) || Number(market.defaultOdd) || Number(market.odd1win));
    const typedStake = currentInput.stake;
    const parsedStake = Number(Number(
      typedStake === undefined || typedStake === null || typedStake === '' ? recommendedStake : typedStake
    ).toFixed(2));
    const oddSalva = Number(Number(finalOdd).toFixed(2));
    const justa = Number(market.fairOdd);
    const evSalvo = justa > 1 && oddSalva > 1
      ? Number((((oddSalva / justa) - 1) * 100).toFixed(1))
      : Number(market.evPercent) || 0;
    const savedLink = String(gameLink || '').trim();
    const cardReading = String(game.tacticalReading || '').trim();
    const formattedName = formatMarketName(market.name, { home: game.home, away: game.away });

    const newBet = {
      id: 'bet_' + Date.now() + Math.random().toString(36).substring(2, 5),
      match: `${game.home} x ${game.away}`,
      league: game.league,
      market: formattedName,
      marketType: categoriaMercado(formattedName, market.marketType) || market.marketType || 'Outro',
      fairOdd: Number(market.fairOdd) || 0,
      evPercent: evSalvo,
      isTopPick: !!(market.isTopPick || market.isTopEV),
      odd: oddSalva > 1 ? oddSalva : 1.40,
      stake: parsedStake,
      status: 'PENDING',
      returnedAmount: 0,
      realProfit: 0,
      date: getTodayLocal(),
      timestamp: Date.now(),
      ...(savedLink ? { gameLink: savedLink } : {}),
      ...(cardReading ? { tacticalReading: cardReading } : {}),
      ...(game.apiData?.fixture?.id ? { fixtureId: game.apiData.fixture.id } : {})
    };

    const gravada = await gravarApostaNaNuvem(newBet);
    const salva = gravada
      ? { ...newBet, ...gravada, gameLink: newBet.gameLink, league: newBet.league || gravada.league, marketType: newBet.marketType }
      : newBet;
    const updated = [salva, ...sheetBets.filter((item) => identidadeAposta(item) !== identidadeAposta(salva))];
    setSheetBets(updated);
    persistToDisk(updated, currentBankroll);
    alert(gravada
      ? `Aposta "${formattedName}" enviada para a Planilha Diária.`
      : `Aposta "${formattedName}" ficou nesta planilha, mas a tabela apostas ainda não confirmou a gravação.`);
  };

  const abrirEntradaManual = () => {
    setEntradaManual(entradaManualVazia());
    setEntradaManualAberta(true);
  };

  const salvarEntradaManual = async (event) => {
    event.preventDefault();
    const jogo = String(entradaManual.jogo || '').trim();
    const mercado = String(entradaManual.mercado || '').trim();
    const odd = Number(String(entradaManual.odd || '').replace(',', '.'));
    const stake = Number(String(entradaManual.stake || '').replace(',', '.'));
    const status = entradaManual.status || 'PENDENTE';
    if (!jogo || !mercado) {
      setEntradaManual((atual) => ({ ...atual, erro: 'Informe o jogo e o mercado.' }));
      return;
    }
    if (!(odd > 1)) {
      setEntradaManual((atual) => ({ ...atual, erro: 'A odd precisa ser maior que 1.' }));
      return;
    }
    if (!(stake > 0)) {
      setEntradaManual((atual) => ({ ...atual, erro: 'Informe a stake em US$.' }));
      return;
    }
    let returnedAmount = 0;
    if (status === 'CASHOUT') {
      returnedAmount = Number(String(entradaManual.devolvido || '').replace(',', '.'));
      if (!Number.isFinite(returnedAmount) || returnedAmount < 0) {
        setEntradaManual((atual) => ({ ...atual, erro: 'Informe quanto a LayBack devolveu no cashout.' }));
        return;
      }
    }
    const statusLocal = status === 'PENDENTE' ? 'PENDING' : status;
    const rascunho = { status: statusLocal, stake, odd, returnedAmount };
    const realProfit = entryNetProfit(rascunho);
    const newBet = {
      id: `bet_${Date.now()}${Math.random().toString(36).substring(2, 5)}`,
      match: jogo.replace(/\s+vs\.?\s+/gi, ' x '),
      league: '',
      market: mercado,
      marketType: categoriaMercado(mercado) || 'Outro',
      odd: Number(odd.toFixed(2)),
      stake: Number(stake.toFixed(2)),
      status: statusLocal,
      returnedAmount,
      realProfit,
      date: getTodayLocal(),
      timestamp: Date.now(),
      semApi: entradaManual.semApi === true
    };
    setEntradaManual((atual) => ({ ...atual, salvando: true, erro: '' }));
    const gravada = await gravarApostaNaNuvem(newBet);
    const salva = gravada
      ? { ...newBet, ...gravada, status: newBet.status, realProfit: newBet.realProfit, returnedAmount: newBet.returnedAmount, semApi: newBet.semApi }
      : newBet;
    const updated = [salva, ...sheetBets.filter((item) => identidadeAposta(item) !== identidadeAposta(salva))];
    const banco = bancaConsolidada(updated);
    setSheetBets(updated);
    setCurrentBankroll(banco);
    persistToDisk(updated, banco);
    if (!gravada) {
      setEntradaManual((atual) => ({
        ...atual,
        salvando: false,
        erro: 'A entrada ficou nesta planilha, mas a tabela apostas ainda não confirmou a gravação.'
      }));
      return;
    }
    setEntradaManualAberta(false);
  };

  const selectionProbability = (fairOdd, odd) => {
    const base = Number(fairOdd) > 1 ? Number(fairOdd) : Number(odd);
    if (!(base > 1)) return 0;
    return 1 / base;
  };

  const toggleMultipla = (game, market, odd, fairOdd) => {
    const id = `${game.id}:${market.id}`;
    const numericOdd = Number(odd);
    if (!Number.isFinite(numericOdd) || numericOdd <= 1) {
      alert('Informe uma odd maior que 1 para montar a múltipla.');
      return;
    }
    setBilheteMultipla((prev) => {
      if (prev.some((item) => item.id === id)) return prev.filter((item) => item.id !== id);
      return [...prev, {
        id,
        match: `${game.home} x ${game.away}`,
        market: formatMarketName(market.name, { home: game.home, away: game.away }),
        odd: numericOdd,
        probability: selectionProbability(fairOdd, numericOdd)
      }];
    });
    setMultiplaOddEdited(false);
    setMultiplaStakeText((current) => current === '' ? recommendedStake.toFixed(2) : current);
  };

  const removeMultiplaLeg = (id) => {
    setBilheteMultipla((prev) => prev.filter((item) => item.id !== id));
    setMultiplaOddEdited(false);
  };

  const clearMultipla = () => {
    setBilheteMultipla([]);
    setMultiplaOddText('');
    setMultiplaStakeText('');
    setMultiplaOddEdited(false);
  };

  const multiplaOddProduct = bilheteMultipla.reduce((acc, leg) => acc * (Number(leg.odd) || 1), bilheteMultipla.length ? 1 : 0);
  const multiplaFairProb = bilheteMultipla.reduce((acc, leg) => acc * (Number(leg.probability) || 0), bilheteMultipla.length ? 1 : 0);

  useEffect(() => {
    if (multiplaOddEdited) return;
    if (!bilheteMultipla.length) {
      setMultiplaOddText('');
      return;
    }
    setMultiplaOddText(multiplaOddProduct.toFixed(2));
  }, [bilheteMultipla, multiplaOddEdited, multiplaOddProduct]);

  const handleSaveMultipla = async () => {
    if (bilheteMultipla.length < 2) return;
    const odd = Number(String(multiplaOddText).replace(',', '.'));
    const stake = Number(String(multiplaStakeText).replace(',', '.'));
    if (!Number.isFinite(odd) || odd <= 1) {
      alert('Informe uma odd total maior que 1.');
      return;
    }
    if (!Number.isFinite(stake) || stake <= 0) {
      alert('Informe uma stake maior que zero.');
      return;
    }
    const match = `MÚLTIPLA: ${bilheteMultipla.map((leg) => `${leg.match} (${leg.market})`).join(' + ')}`;
    const newBet = {
      id: 'bet_' + Date.now() + Math.random().toString(36).substring(2, 5),
      match,
      league: 'Múltipla',
      market: bilheteMultipla.map((leg) => leg.market).join(' + '),
      marketType: 'Múltipla',
      fairOdd: multiplaFairProb > 0 ? Number((1 / multiplaFairProb).toFixed(2)) : 0,
      evPercent: 0,
      isTopPick: false,
      odd: Number(odd.toFixed(2)),
      stake: Number(stake.toFixed(2)),
      status: 'PENDING',
      returnedAmount: 0,
      realProfit: 0,
      date: getTodayLocal(),
      timestamp: Date.now()
    };
    const gravada = await gravarApostaNaNuvem(newBet);
    const salva = gravada ? { ...newBet, ...gravada, league: newBet.league, marketType: newBet.marketType } : newBet;
    const updated = [salva, ...sheetBets.filter((item) => identidadeAposta(item) !== identidadeAposta(salva))];
    setSheetBets(updated);
    persistToDisk(updated, currentBankroll);
    clearMultipla();
    alert('Múltipla gravada na Planilha Diária.');
  };

  const handlePublishTelegram = async (game, market, source = null) => {
    const tipKey = market.id;
    if (publishingTip[tipKey]) return;

    const currentInput = customInputs[market.id] || { stake: recommendedStake, odd: market.defaultOdd || market.odd1win };
    const directLink = String(source?.directLink || '').trim();
    setPublishingTip(prev => ({ ...prev, [tipKey]: true }));

    try {
      const res = await fetch(apiUrl('/api/publish-telegram-tip'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league: game.league,
          match: `${game.home} vs ${game.away}`,
          tacticalReading: source?.tacticalReading ?? game.tacticalReading ?? '',
          market: formatMarketName(market.name, { home: game.home, away: game.away }),
          odd: source?.odd ?? (Number(currentInput.odd) || market.defaultOdd || market.odd1win),
          stake: source?.stake ?? (currentInput.stake ?? recommendedStake),
          fixtureId: game.apiData?.fixture?.id || null,
          photoUrl: 'https://i.imgur.com/8QZzG8v.jpeg',
          ...(directLink ? { directLink } : {})
        })
      });
      const data = await res.json();
      if (data.success) {
        if (data.aposta?.match || data.aposta?.market) {
          const nova = {
            ...data.aposta,
            id: data.aposta.id != null ? String(data.aposta.id) : `bet_${Date.now()}`,
            date: dataCalendarioLocal(data.aposta.date || data.aposta.created_at || getTodayLocal()),
            league: data.aposta.league || game.league || '',
            status: 'PENDING'
          };
          setSheetBets((atual) => {
            const lista = Array.isArray(atual) ? atual : [];
            if (lista.some((item) => identidadeAposta(item) === identidadeAposta(nova))) return lista;
            return [nova, ...lista];
          });
        }
        setPublishedTip(prev => ({ ...prev, [tipKey]: true }));
        setTimeout(() => {
          setPublishedTip(prev => ({ ...prev, [tipKey]: false }));
        }, 3000);
      } else {
        alert(data.message || 'Falha ao publicar no Telegram.');
      }
    } catch (e) {
      alert('Erro ao conectar com a rota de publicação do Telegram.');
    } finally {
      setPublishingTip(prev => ({ ...prev, [tipKey]: false }));
    }
  };

  const revertBetFinance = (b, currentBank) => {
    let adj = currentBank;
    const stake = Number(Number(b.stake).toFixed(2)) || 0;
    const odd = Number(b.odd) || 0;
    const realProfit = Number(b.realProfit) || 0;

    if (b.status === 'GREEN') adj -= (stake * odd - stake);
    if (b.status === 'RED') adj += stake;
    if (b.status === 'CASHOUT') adj -= realProfit;
    return adj;
  };

  const sincronizarResultadoNuvem = (bet) => {
    if (!bet?.match || !bet?.market) return;
    const status = String(bet.status || '').toUpperCase();
    fetch(apiUrl('/api/apostas-futebol/resultado'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partida: bet.match,
        mercado: bet.market,
        status,
        lucro: status === 'PENDING' ? null : Number(bet.realProfit)
      })
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        console.error('Supabase não atualizou a aposta:', data.message || res.status);
      }
    }).catch((erro) => {
      console.error('Supabase não atualizou a aposta:', erro.message);
    });
  };

  const handleSetResult = (id, status) => {
    let nextBank = currentBankroll;
    let resultadoNuvem = null;

    const updated = sheetBets.map(b => {
      if (b.id !== id) return b;
      let cleanBank = revertBetFinance(b, currentBankroll);
      const stake = Number(Number(b.stake).toFixed(2)) || 0;
      const odd = Number(b.odd) || 0;

      if (b.status === status) {
        nextBank = cleanBank;
        resultadoNuvem = { ...b, status: 'PENDING', returnedAmount: 0, realProfit: 0 };
        return resultadoNuvem;
      }

      if (status === 'GREEN') {
        const profit = Number(((stake * odd) - stake).toFixed(2));
        nextBank = cleanBank + profit;
        resultadoNuvem = { ...b, status: 'GREEN', returnedAmount: stake * odd, realProfit: profit };
        return resultadoNuvem;
      } 
      
      if (status === 'RED') {
        nextBank = cleanBank - stake;
        resultadoNuvem = { ...b, status: 'RED', returnedAmount: 0, realProfit: -stake };
        return resultadoNuvem;
      }

      return b;
    });

    const bancoMetodo = bancaConsolidada(updated);
    setCurrentBankroll(bancoMetodo);
    setSheetBets(updated);
    persistToDisk(updated, bancoMetodo);
    if (resultadoNuvem) sincronizarResultadoNuvem(resultadoNuvem);
  };

  const handleCashoutPrompt = (id) => {
    const bet = sheetBets.find(b => b.id === id);
    if (!bet) return;

    const inputVal = prompt(
      `Jogo: ${bet.match}\nStake apostada: US$ ${Number(bet.stake).toFixed(2)}\n\nQuanto a casa devolveu no Saque/Cashout? (Ex: 2.31):`,
      bet.returnedAmount > 0 ? bet.returnedAmount.toString() : ''
    );

    if (inputVal === null || inputVal.trim() === '') return;

    const returned = Number(inputVal.replace(',', '.'));
    if (isNaN(returned) || returned < 0) {
      alert('Por favor, informe um valor numérico válido.');
      return;
    }

    const netProfit = Number((returned - (Number(bet.stake) || 0)).toFixed(2));

    const updated = sheetBets.map(b => {
      if (b.id !== id) return b;
      return {
        ...b,
        status: 'CASHOUT',
        returnedAmount: returned,
        realProfit: netProfit
      };
    });
    const bancoMetodo = bancaConsolidada(updated);

    setCurrentBankroll(bancoMetodo);
    setSheetBets(updated);
    persistToDisk(updated, bancoMetodo);
    const gravada = updated.find((b) => b.id === id);
    if (gravada) sincronizarResultadoNuvem(gravada);
  };

  const handleDeleteBet = (id) => {
    const bet = sheetBets.find(b => b.id === id);
    if (!bet) return;

    const updated = sheetBets.filter(b => b.id !== id);
    const bancoMetodo = bancaConsolidada(updated);

    setCurrentBankroll(bancoMetodo);
    setSheetBets(updated);
    persistToDisk(updated, bancoMetodo);
  };

  const dayStats = useMemo(() => {
    const doMetodo = sheetBets.filter(apostaDoMetodo);
    const target = selectedDate === 'ALL' ? 'ALL' : normalizeDate(selectedDate);
    const filtered = target === 'ALL'
      ? doMetodo
      : doMetodo.filter(b => normalizeDate(b.date) === target);

    let totalInvested = 0;
    let netProfit = 0;
    let greens = 0;
    let reds = 0;
    let cashouts = 0;
    let pendings = 0;

    filtered.forEach(b => {
      const stake = Number(Number(b.stake).toFixed(2)) || 0;
      totalInvested += stake;

      if (b.status === 'GREEN') {
        greens++;
        netProfit += entryNetProfit(b);
      } else if (b.status === 'RED') {
        reds++;
        netProfit += entryNetProfit(b);
      } else if (b.status === 'CASHOUT') {
        cashouts++;
        netProfit += entryNetProfit(b);
      } else {
        pendings++;
      }
    });

    const finished = greens + reds + cashouts;
    const winRate = finished > 0 ? (((greens + (cashouts * 0.5)) / finished) * 100).toFixed(1) : '0.0';
    const roi = finished > 0 && totalInvested > 0 ? ((netProfit / totalInvested) * 100).toFixed(1) : '0.0';

    return { 
      bets: filtered, 
      totalInvested: Number(totalInvested.toFixed(2)), 
      netProfit: Number(netProfit.toFixed(2)), 
      greens, 
      reds, 
      cashouts, 
      pendings, 
      winRate, 
      roi 
    };
  }, [sheetBets, selectedDate]);

  const linhasFinanceiras = useMemo(() => sheetBets.filter(apostaDoMetodo).map((aposta) => ({
    date: normalizeDate(aposta.date),
    status: String(aposta.status || '').toUpperCase(),
    lucro: entryNetProfit(aposta),
    stake: Number(aposta.stake) || 0
  })), [sheetBets]);
  const lucroLivro = useMemo(
    () => roundMoney(linhasFinanceiras.reduce((total, linha) => total + linha.lucro, 0)),
    [linhasFinanceiras]
  );

  const currentMonthKey = getTodayLocal().slice(0, 7);

  const profitPeriodOptions = useMemo(() => {
    const keys = new Set([currentMonthKey]);
    sheetBets.forEach((bet) => {
      const key = normalizeDate(bet.date).slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(key)) keys.add(key);
    });
    if (/^\d{4}-\d{2}$/.test(profitPeriod || '')) keys.add(profitPeriod);
    const months = [...keys].sort((a, b) => b.localeCompare(a)).map((key) => ({
      value: key === currentMonthKey ? 'CURRENT' : key,
      label: key === currentMonthKey ? `Mês Atual (${formatMonthLabel(key)})` : formatMonthLabel(key)
    }));
    return [...months, { value: 'ALL', label: 'Geral (Todo o Período)' }];
  }, [sheetBets, currentMonthKey, profitPeriod]);

  const profitSelectValue = profitPeriod === 'ALL'
    ? 'ALL'
    : (profitPeriod === 'CURRENT' || profitPeriod === currentMonthKey ? 'CURRENT' : profitPeriod);

  const monthLedger = useMemo(() => {
    const profits = new Map();
    sheetBets.forEach((bet) => {
      if (!apostaDoMetodo(bet)) return;
      if (bet.status !== 'GREEN' && bet.status !== 'RED' && bet.status !== 'CASHOUT') return;
      const key = normalizeDate(bet.date).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      profits.set(key, (profits.get(key) || 0) + entryNetProfit(bet));
    });
    if (/^\d{4}-\d{2}$/.test(currentMonthKey)) {
      profits.set(currentMonthKey, profits.get(currentMonthKey) || 0);
    }

    const months = {};
    let running = BANCA_OPERACIONAL;
    [...profits.keys()].sort().forEach((key) => {
      const profit = roundMoney(profits.get(key) || 0);
      const initial = roundMoney(running);
      const finalBank = roundMoney(initial + profit);
      months[key] = {
        initial,
        profit,
        final: finalBank,
        growth: growthPercent(profit, initial)
      };
      running = finalBank;
    });

    const totalProfit = roundMoney(running - BANCA_OPERACIONAL);
    return {
      months,
      totalProfit,
      primary: BANCA_OPERACIONAL,
      current: roundMoney(running),
      historicalGrowth: growthPercent(totalProfit, BANCA_OPERACIONAL)
    };
  }, [sheetBets, currentMonthKey]);

  const selectedMonthKey = profitSelectValue === 'CURRENT' ? currentMonthKey : profitSelectValue;
  const selectedMonth = monthLedger.months[selectedMonthKey];
  const profitCard = profitSelectValue === 'ALL'
    ? {
        netProfit: monthLedger.totalProfit,
        growth: monthLedger.historicalGrowth,
        subtitle: `Banca Inicial: US$ ${monthLedger.primary.toFixed(2).replace('.', ',')} ➔ Atual: US$ ${monthLedger.current.toFixed(2).replace('.', ',')}`
      }
    : {
        netProfit: selectedMonth?.profit || 0,
        growth: selectedMonth?.growth || 0,
        subtitle: profitSelectValue === 'CURRENT'
          ? `Banca Inicial do Mês: US$ ${(selectedMonth?.initial ?? BANCA_OPERACIONAL).toFixed(2).replace('.', ',')}`
          : `Banca Base: US$ ${(selectedMonth?.initial ?? BANCA_OPERACIONAL).toFixed(2).replace('.', ',')} ➔ Final: US$ ${(selectedMonth?.final ?? BANCA_OPERACIONAL).toFixed(2).replace('.', ',')}`
      };

  const periodTitle = profitSelectValue === 'CURRENT' ? 'Lucro Mensal' : 'Lucro';
  const growthLabel = profitSelectValue === 'CURRENT'
    ? 'Crescimento Mensal'
    : profitSelectValue === 'ALL'
      ? 'Crescimento Histórico'
      : 'Fechamento do Mês';

  const recapDate = selectedDate === 'ALL' ? getTodayLocal() : normalizeDate(selectedDate);

  const dailyRecap = useMemo(() => {
    const rows = sheetBets.filter((b) => apostaDoMetodo(b) && normalizeDate(b.date) === recapDate);
    let greens = 0;
    let reds = 0;
    let cashouts = 0;
    let pendings = 0;
    let netProfit = 0;
    let units = 0;
    const finished = [];

    rows.forEach((bet) => {
      if (bet.status === 'GREEN') greens += 1;
      else if (bet.status === 'RED') reds += 1;
      else if (bet.status === 'CASHOUT') cashouts += 1;
      else {
        pendings += 1;
        return;
      }
      const profit = entryNetProfit(bet);
      const stake = Number(bet.stake) || 0;
      netProfit += profit;
      if (stake > 0) units += profit / stake;
      finished.push(bet);
    });

    const settled = greens + reds + cashouts;
    const winRate = settled > 0 ? (((greens + (cashouts * 0.5)) / settled) * 100).toFixed(1) : '0.0';
    const balance = Number(netProfit.toFixed(2));
    const unitBalance = Number(units.toFixed(2));
    const payload = {
      date: recapDate,
      entries: finished.map((bet) => ({
        match: bet.match,
        market: bet.market,
        odd: Number(bet.odd) || 0,
        status: bet.status
      })),
      greens,
      reds,
      cashouts,
      balance,
      units: unitBalance
    };

    return {
      ...payload,
      pendings,
      winRate,
      text: buildDailyRecapText(payload)
    };
  }, [sheetBets, recapDate]);

  const openRecapPreview = () => {
    if (!dailyRecap.entries.length) return;
    setRecapPreview({
      text: dailyRecap.text,
      payload: {
        date: dailyRecap.date,
        entries: dailyRecap.entries,
        greens: dailyRecap.greens,
        reds: dailyRecap.reds,
        cashouts: dailyRecap.cashouts,
        balance: dailyRecap.balance,
        units: dailyRecap.units
      }
    });
  };

  const confirmSendRecap = async () => {
    if (!recapPreview?.payload || sendingRecap) return;
    setSendingRecap(true);
    try {
      const res = await fetch(apiUrl('/api/telegram/send-daily-recap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recapPreview.payload)
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.message || 'Falha ao enviar o resumo para o Telegram.');
        return;
      }
      setRecapPreview(null);
      alert('Resumo do dia publicado no Telegram.');
    } catch (error) {
      alert('Erro ao conectar com a rota de resumo do Telegram.');
    } finally {
      setSendingRecap(false);
    }
  };

  const marketPerformance = useMemo(() => {
    const map = {};

    sheetBets.filter(apostaDoMetodo).forEach(b => {
      const type = b.marketType || 'Outro';
      if (!map[type]) {
        map[type] = {
          marketType: type,
          totalBets: 0,
          greens: 0,
          reds: 0,
          cashouts: 0,
          pendings: 0,
          invested: 0,
          profit: 0
        };
      }

      map[type].totalBets++;
      const stake = Number(Number(b.stake).toFixed(2)) || 0;
      const profit = Number(b.realProfit) || 0;

      if (b.status === 'GREEN') {
        map[type].greens++;
        map[type].invested += stake;
        map[type].profit += profit;
      } else if (b.status === 'RED') {
        map[type].reds++;
        map[type].invested += stake;
        map[type].profit += profit;
      } else if (b.status === 'CASHOUT') {
        map[type].cashouts++;
        map[type].invested += stake;
        map[type].profit += profit;
      } else {
        map[type].pendings++;
      }
    });

    return Object.values(map).map(m => {
      const finished = m.greens + m.reds + m.cashouts;
      const winRate = finished > 0 ? (((m.greens + (m.cashouts * 0.5)) / finished) * 100).toFixed(1) : '0.0';
      const roi = finished > 0 && m.invested > 0 ? ((m.profit / m.invested) * 100).toFixed(1) : '0.0';
      return { ...m, finished, winRate: Number(winRate), roi: Number(roi) };
    }).sort((a, b) => b.profit - a.profit);
  }, [sheetBets]);

  const desempenhoPorMercado = useMemo(() => {
    const mapa = Object.fromEntries(CATEGORIAS_MONITORADAS.map((categoria) => [categoria, {
      categoria,
      entradas: 0,
      greens: 0,
      reds: 0,
      cashouts: 0,
      pendentes: 0,
      apostado: 0,
      lucro: 0
    }]));

    sheetBets.filter(apostaDoMetodo).forEach((aposta) => {
      const tipo = String(aposta?.marketType || '');
      const jogo = String(aposta?.match || '');
      if (tipo === 'Múltipla' || jogo.startsWith('MÚLTIPLA')) return;
      const categoria = categoriaMercado(aposta?.market, aposta?.marketType);
      const linha = mapa[categoria];
      if (!linha) return;
      linha.entradas += 1;
      const lucro = entryNetProfit(aposta);
      if (aposta.status === 'GREEN') {
        linha.greens += 1;
        linha.apostado += Number(aposta.stake) || 0;
        linha.lucro += lucro;
      } else if (aposta.status === 'RED') {
        linha.reds += 1;
        linha.apostado += Number(aposta.stake) || 0;
        linha.lucro += lucro;
      } else if (aposta.status === 'CASHOUT') {
        linha.cashouts += 1;
        linha.apostado += Number(aposta.stake) || 0;
        linha.lucro += lucro;
      } else {
        linha.pendentes += 1;
      }
    });

    return CATEGORIAS_MONITORADAS.map((categoria) => {
      const linha = mapa[categoria];
      const decididos = linha.greens + linha.reds;
      const winRate = decididos > 0 ? (linha.greens / decididos) * 100 : null;
      const roi = linha.apostado > 0 ? (linha.lucro / linha.apostado) * 100 : null;
      let viabilidade = { tom: 'cinza', texto: 'Amostra em andamento' };
      if (linha.entradas < 30) viabilidade = { tom: 'amarelo', texto: 'Amostra Insuficiente' };
      else if (linha.entradas >= 100 && roi != null && roi < 0) viabilidade = { tom: 'vermelho', texto: 'Descartar Mercado' };
      else if (roi != null && roi > 0) viabilidade = { tom: 'verde', texto: 'Lucrativo' };
      return {
        ...linha,
        lucro: Number(linha.lucro.toFixed(2)),
        apostado: Number(linha.apostado.toFixed(2)),
        winRate: winRate == null ? null : Number(winRate.toFixed(1)),
        roi: roi == null ? null : Number(roi.toFixed(1)),
        progresso: Math.min(100, (linha.entradas / 100) * 100),
        viabilidade
      };
    });
  }, [sheetBets]);

  const jogosDaLiga = opportunities.filter((game) => grupoCompativel(selectedLeague, game.leagueGroup));
  const displayedGames = jogosDaLiga.filter((game) => jogoVisivelNoRadar(game, onewinQuants[game.id]));
  const jogosDoDia = [...opportunities].sort((a, b) => String(a.time).localeCompare(String(b.time)) || String(a.home).localeCompare(String(b.home)));
  const apostasDaPlanilha = dayStats.bets.filter((aposta) => grupoCompativel(ligaPlanilha, grupoDaLiga(`${aposta.league || ''} ${aposta.match || ''}`)));

  useEffect(() => {
    if (!jogoFocado || activeTab !== 'opps') return;
    const alvo = document.getElementById(`jogo-${jogoFocado}`);
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [jogoFocado, selectedLeague, activeTab, displayedGames.length]);

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-100 font-sans pb-12">
      <header className="border-b border-gray-800 bg-[#161b22] sticky top-0 z-50 px-4 py-3">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="bg-[#00c853] text-black font-extrabold text-xs px-2 py-1 rounded">SINDICATO</span>
            <span className="font-bold text-lg tracking-wide text-white">SofaPunter Quant</span>
          </div>
          
          <div className="w-full min-w-0 sm:flex-1 flex flex-col gap-2">
            <SeletorLigas
              value={selectedLeague}
              onChange={setSelectedLeague}
              className="w-full min-w-0 min-h-[42px] bg-[#0d1117] border border-gray-700 text-xs text-gray-200 rounded-lg px-2 outline-none"
            />
            <select
              value={jogoFocado}
              onChange={(event) => {
                const id = event.target.value;
                setJogoFocado(id);
                if (!id) return;
                const jogo = opportunities.find((item) => String(item.id) === String(id));
                if (jogo && !grupoCompativel(selectedLeague, jogo.leagueGroup)) setSelectedLeague('all');
                setActiveTab('opps');
              }}
              className="w-full min-w-0 min-h-[42px] bg-[#0d1117] border border-gray-700 text-xs text-gray-200 rounded-lg px-2 outline-none"
            >
              <option value="">Jogos do dia</option>
              {jogosDoDia.map((game) => (
                <option key={game.id} value={game.id}>
                  {rotuloJogoDia(game, onewinQuants[game.id])}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleFetchOpps('europe')} 
              disabled={loading}
              className={`min-h-[42px] w-full text-xs font-bold px-3 rounded-lg flex items-center justify-center gap-1.5 transition ${
                activeShift === 'europe' 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
              }`}
            >
              <span>🇪🇺 {loading && activeShift === 'europe' ? 'Buscando...' : 'Europa (Dia Todo)'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleFetchOpps('brazil')} 
              disabled={loading}
              className={`min-h-[42px] w-full text-xs font-bold px-3 rounded-lg flex items-center justify-center gap-1.5 transition ${
                activeShift === 'brazil' 
                  ? 'bg-[#00c853] text-black shadow-lg shadow-[#00c853]/20' 
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
              }`}
            >
              <span>🇧🇷 {loading && activeShift === 'brazil' ? 'Buscando...' : 'Brasil (Dia Todo)'}</span>
            </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 mt-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3.5">
            <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">Banca Atual</div>
            <div className="text-xl font-bold text-white mt-1">US$ {currentBankroll.toFixed(2).replace('.', ',')}</div>
            <div className="text-[10px] text-[#00c853] font-semibold mt-0.5">Banca inicial: US$ {BANCA_OPERACIONAL.toFixed(2).replace('.', ',')} · Stake padrão: US$ {recommendedStake.toFixed(2).replace('.', ',')}</div>
          </div>

          <div className="bg-[#161b22] border border-[#00c853]/30 rounded-xl p-3.5 bg-gradient-to-br from-[#161b22] to-[#122319]">
            <div className="text-[11px] text-[#00c853] font-bold uppercase tracking-wider">
              {selectedDate === 'ALL' ? 'Total Apostado' : 'Apostado no Dia'}
            </div>
            <div className="text-xl font-bold text-white mt-1">US$ {dayStats.totalInvested.toFixed(2)}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{dayStats.bets.length} entradas ({dayStats.greens}G | {dayStats.cashouts}C | {dayStats.reds}R)</div>
          </div>

          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3.5">
            <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">
              {selectedDate === 'ALL' ? 'Lucro Total' : 'Resultado do Dia'}
            </div>
            <div className={`text-xl font-bold mt-1 ${dayStats.netProfit >= 0 ? 'text-[#00c853]' : 'text-red-500'}`}>
              {dayStats.netProfit > 0 ? '+' : dayStats.netProfit < 0 ? '-' : ''}US$ {Math.abs(dayStats.netProfit).toFixed(2)}
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              Acertos: <strong className="text-[#00c853]">{dayStats.greens}G</strong> | <strong className="text-yellow-400">{dayStats.cashouts}C</strong> | <strong className="text-red-500">{dayStats.reds}R</strong>
            </div>
          </div>

          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3.5">
            <select
              value={profitSelectValue}
              onChange={(e) => {
                const value = e.target.value;
                setProfitPeriod(value);
                localStorage.setItem('sp_profit_period', value);
              }}
              className="w-full bg-[#0d1117] border border-gray-700 text-[10px] text-gray-200 rounded px-1.5 py-1 mb-2 outline-none"
            >
              {profitPeriodOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">{periodTitle}</div>
            <div className={`text-xl font-bold mt-1 ${profitCard.netProfit >= 0 ? 'text-[#00c853]' : 'text-red-500'}`}>
              {profitCard.netProfit >= 0 ? '+' : ''}US$ {profitCard.netProfit.toFixed(2)}
            </div>
            <div className={`text-[10px] mt-0.5 font-semibold ${profitCard.growth >= 0 ? 'text-[#00c853]' : 'text-red-400'}`}>
              {growthLabel}: {signedGrowth(profitCard.growth)}
            </div>
            <div className="text-[10px] mt-1.5 font-semibold text-gray-300">
              {profitCard.subtitle}
            </div>
          </div>
        </div>

        <div className="flex border-b border-gray-800 mt-6 gap-x-6 text-sm font-semibold overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setActiveTab('opps')}
            className={`shrink-0 whitespace-nowrap min-h-[42px] inline-flex items-center transition ${activeTab === 'opps' ? 'text-[#00c853] border-b-2 border-[#00c853]' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Radar de Valor (+EV) ({displayedGames.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sheet')}
            className={`shrink-0 whitespace-nowrap min-h-[42px] inline-flex items-center transition ${activeTab === 'sheet' ? 'text-[#00c853] border-b-2 border-[#00c853]' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Planilha Diária ({linhasFinanceiras.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('markets')}
            className={`shrink-0 whitespace-nowrap min-h-[42px] inline-flex items-center transition ${activeTab === 'markets' ? 'text-[#00c853] border-b-2 border-[#00c853]' : 'text-gray-400 hover:text-gray-200'}`}
          >
            📊 Mercados & Win Rate ({marketPerformance.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('desempenho')}
            className={`shrink-0 whitespace-nowrap min-h-[42px] inline-flex items-center transition ${activeTab === 'desempenho' ? 'text-[#00c853] border-b-2 border-[#00c853]' : 'text-gray-400 hover:text-gray-200'}`}
          >
            📊 Desempenho por Mercado
          </button>
        </div>

        {/* ABA 1: OPORTUNIDADES + AUDITORIA 1WIN + RADAR LIVE */}
        {activeTab === 'opps' && (
          <div className="mt-5 space-y-5">
            {erroVarredura ? (
              <div className="bg-[#161b22] border border-gray-800 rounded-xl p-8 text-center text-gray-300">
                {erroVarredura}
              </div>
            ) : opportunities.length === 0 ? (
              <div className="bg-[#161b22] border border-gray-800 rounded-xl p-8 text-center text-gray-400">
                Selecione acima se deseja varrer os jogos da <strong>🇪🇺 Europa (Dia Todo)</strong> ou do <strong>🇧🇷 Brasil (Dia Todo)</strong>.
              </div>
            ) : displayedGames.length === 0 ? (
              <div className="bg-[#161b22] border border-gray-800 rounded-xl p-8 text-center text-gray-400">
                Nenhum jogo desta liga na varredura atual.
              </div>
            ) : (
              displayedGames.map(game => {
                const linkColado = String(onewinLinks[game.id] || '').trim();
                const linkDireto = /^https?:\/\//i.test(linkColado) ? linkColado : `${base1win()}/pt/betting`;
                const auditoria = (Array.isArray(onewinAudits[game.id]) ? onewinAudits[game.id] : []).filter((item) => item && typeof item === 'object');
                const mercadosDoCartao = auditoria.length ? auditoria : linhasOperacionaisQuant(onewinQuants[game.id], game.id);
                const entradasQuant = (Array.isArray(onewinQuants[game.id]?.melhoresEntradas) ? onewinQuants[game.id].melhoresEntradas : []).filter((item) => item && typeof item === 'object');
                const textoOver25 = textoTagOver25(game, onewinQuants[game.id]);
                const alta = altaProbabilidadeOver(game, onewinQuants[game.id]);
                const focado = String(jogoFocado) === String(game.id);
                return (
                <div id={`jogo-${game.id}`} key={game.id} className={`scroll-mt-28 bg-[#161b22] rounded-xl p-4 min-w-0 overflow-hidden border ${alta ? 'border-[#EAB308] shadow-[inset_0_4px_0_#FACC15]' : 'border-gray-800'} ${focado ? 'ring-2 ring-[#FACC15]' : ''}`}>
                  {alta && (
                    <div className="mb-2">
                      <span className="bg-[#FACC15] text-black font-bold px-2 py-0.5 rounded text-[11px]">⭐ ALTA PROBABILIDADE (Over 1.5 / 2.5)</span>
                    </div>
                  )}
                  <div className="mb-2">
                    <span className="bg-[#00c853]/20 text-[#00c853] font-bold px-2 py-0.5 rounded text-[11px]">{textoOver25}</span>
                  </div>
                  <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-gray-400 mb-1 min-w-0">
                    <span className="min-w-0 break-words">{game.league} • {game.time}</span>
                    <span className="bg-[#00c853]/20 text-[#00c853] font-bold px-2 py-0.5 rounded text-[11px]">{game.score}% SCORE</span>
                  </div>

                  <h3 className="font-bold text-lg text-white mb-1.5">{game.home} vs {game.away}</h3>
                  {loading1win[game.id] ? (
                    <p className="text-xs text-blue-300 italic mb-4">Executando Deep Scan das odds...</p>
                  ) : (
                    <p className="text-xs text-gray-300 italic mb-4">"{game.tacticalReading || game.justification}"</p>
                  )}

                  <div className="bg-[#0d1117] border border-blue-500/30 rounded-lg p-3 mb-4 min-w-0">
                    <div className="text-[11px] text-blue-400 font-bold mb-2">
                      Auditar este jogo na 1win
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                      <input
                        type="text"
                        placeholder="Cole o link ou ID da 1win aqui..."
                        value={onewinLinks[game.id] || ''}
                        onChange={(e) => setOnewinLinks({ ...onewinLinks, [game.id]: e.target.value })}
                        className="w-full min-w-0 min-h-[42px] bg-[#161b22] border border-gray-700 text-xs text-white rounded px-3 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleAudit1Win(game)}
                        disabled={!!loading1win[game.id]}
                        className="min-h-[42px] w-full sm:w-auto shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold text-xs px-3 rounded"
                      >
                        <span>{loading1win[game.id] ? 'Auditando...' : 'Auditar na 1win'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAnalisarIa(game)}
                        disabled={!!loadingIa[game.id] || !auditoria.length}
                        className="min-h-[42px] w-full sm:w-auto shrink-0 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white font-bold text-xs px-3 rounded"
                      >
                        <span>{loadingIa[game.id] ? 'Analisando...' : 'Analisar com I.A.'}</span>
                      </button>
                    </div>
                    <a
                      href={`${base1win()}/pt/betting`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[42px] items-center text-sm font-bold text-blue-300 hover:text-white"
                    >
                      Abrir 1win ↗
                    </a>
                    {loading1win[game.id] && (
                      <p className="text-xs text-blue-300">Executando Deep Scan das odds...</p>
                    )}
                    {!!erroAuditoria[game.id] && !loading1win[game.id] && (
                      <p className="text-xs text-amber-300 mt-1">{erroAuditoria[game.id]}</p>
                    )}
                    {!!erroIa[game.id] && !loadingIa[game.id] && (
                      <p className="text-xs text-amber-300 mt-1">{erroIa[game.id]}</p>
                    )}
                    {(loadingIa[game.id] || analiseIa[game.id]) && (
                      <div className="mt-3 rounded-lg border border-purple-500/40 bg-purple-950/30 p-3">
                        <div className="text-[11px] font-bold text-purple-200 mb-2">Recomendações do Gemini / I.A.</div>
                        {loadingIa[game.id] ? (
                          <p className="text-xs text-purple-200">Lendo o confronto...</p>
                        ) : (
                          <>
                            {textoVisivel(analiseIa[game.id]?.diagnostico) && (
                              <p className="text-sm text-white leading-snug">{textoVisivel(analiseIa[game.id]?.diagnostico)}</p>
                            )}
                            {textoVisivel(analiseIa[game.id]?.alertaRisco) && (
                              <p className="text-xs text-amber-300 mt-2">Risco: {textoVisivel(analiseIa[game.id]?.alertaRisco)}</p>
                            )}
                            {[{ titulo: 'Múltipla', itens: analiseIa[game.id]?.sugestaoMultipla }, { titulo: 'Valor', itens: analiseIa[game.id]?.sugestaoValor }].map((bloco) => {
                              const itens = (Array.isArray(bloco.itens) ? bloco.itens : []).map(textoVisivel).filter(Boolean);
                              if (!itens.length) return null;
                              return (
                                <div key={bloco.titulo} className="mt-3">
                                  <div className="text-[10px] font-bold text-purple-300 mb-1.5">{bloco.titulo}</div>
                                  <div className="space-y-2">
                                    {itens.map((texto) => {
                                      const mercado = mercadoDaSugestao(texto, auditoria);
                                      return (
                                        <div key={`${bloco.titulo}-${texto}`} className="rounded-lg border border-purple-500/30 bg-[#0d1117] px-2.5 py-2">
                                          <div className="text-xs font-bold text-white">{mercado?.tipo || mercado?.name || texto}</div>
                                          {mercado && (
                                            <div className="text-[10px] text-gray-300 mt-0.5">
                                              Odd 1win: <strong className="text-white">{mercado.odd1win}</strong> | Odd Justa: <strong>{mercado.fairOdd}</strong>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}

                    {onewinQuants[game.id] && (
                      <div className="mt-3 rounded-lg border border-[#00c853]/35 bg-[#122319] p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#00c853] mb-2">SofaPunter Quant</div>
                        <GradeProbabilidades probabilities={onewinQuants[game.id].probabilities} home={game.home} away={game.away} />
                        <BlocoClassificacaoMomento quant={onewinQuants[game.id]} home={game.home} away={game.away} />
                        <BarraClassificacao quant={onewinQuants[game.id]} home={game.home} away={game.away} />
                        <div className="flex flex-wrap items-center gap-2">
                          {onewinQuants[game.id].ritmo && typeof onewinQuants[game.id].ritmo === 'object' && (
                            <span className="text-[11px] font-bold text-white bg-[#0d1117] border border-gray-700 px-2.5 py-1 rounded-full">
                              {textoVisivel(onewinQuants[game.id].ritmo.icone)} {textoVisivel(onewinQuants[game.id].ritmo.classificacao)} ({Number(onewinQuants[game.id].ritmo.pontuacao).toFixed(1)} pts)
                            </span>
                          )}
                          {Number.isFinite(Number(onewinQuants[game.id].tatica?.scoreConfianca)) && (
                            <span className="text-[11px] font-bold text-[#00c853] bg-[#0d1117] border border-[#00c853]/40 px-2.5 py-1 rounded-full">
                              🎯 {onewinQuants[game.id].tatica.scoreConfianca}/100
                            </span>
                          )}
                        </div>
                        {textoVisivel(onewinQuants[game.id].tatica?.resumoVisual) && (
                          <p className="text-sm font-semibold text-white mt-2 leading-snug">
                            {textoVisivel(onewinQuants[game.id].tatica.resumoVisual)}
                          </p>
                        )}
                        {entradasQuant.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2.5">
                            {entradasQuant.map((entrada) => {
                              const oddCasa = Number(entrada.oddCasa);
                              const oddJusta = Number(entrada.oddJusta);
                              const margem = String(entrada.margemEV || '').trim();
                              return (
                                <div
                                  key={`${game.id}-${entrada.mercado}`}
                                  className="rounded-lg border border-[#00c853]/45 bg-[#0d1117] px-2.5 py-1.5"
                                >
                                  <div className="text-[11px] font-bold text-[#00c853]">{textoVisivel(entrada.nome) || textoVisivel(entrada.mercado) || 'Mercado'}</div>
                                  <div className="text-[10px] text-gray-300 mt-0.5">
                                    1win: {Number.isFinite(oddCasa) ? oddCasa.toFixed(2) : '—'} | Justa: {Number.isFinite(oddJusta) ? oddJusta.toFixed(2) : '—'}
                                  </div>
                                  <div className="text-[10px] font-bold text-[#00c853] mt-0.5">
                                    {margem}{margem.toUpperCase().includes('EV') ? '' : ' EV'}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <DetalheQuantExtra quant={onewinQuants[game.id]} home={game.home} away={game.away} />
                      </div>
                    )}

                    {/* Mercados Auditados na 1win */}
                    {mercadosDoCartao.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-gray-800 pt-3">
                        <div className="text-[11px] text-gray-400 font-semibold">Mercados Encontrados na 1win:</div>
                        {mercadosDoCartao.filter((m) => m && typeof m === 'object').map(m => {
                          const stakeValue = customInputs[m.id]?.stake ?? recommendedStake;
                          const oddInformada = customInputs[m.id]?.odd ?? m.odd1win ?? m.defaultOdd ?? '';
                          const oddNumero = Number(oddInformada);
                          const retornoProjetado = oddNumero > 1 ? Number((Number(stakeValue) * (oddNumero - 1)).toFixed(2)) : null;
                          return (
                          <div 
                            key={m.id} 
                            className={`p-2.5 rounded-lg ${
                              m.isTopEV 
                                ? 'bg-blue-950/40 border border-blue-400 text-white' 
                                : 'bg-[#161b22] border border-gray-800 text-gray-300'
                            }`}
                          >
                            <div>
                              <div className="text-xs font-bold flex items-center gap-2 flex-wrap">
                                <span>{formatMarketName(m.tipo || m.name, { home: game.home, away: game.away })}</span>
                                {m.tag && (
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-extrabold ${
                                    m.tag === 'FAVORITO' || m.tag === 'BASE MULTIPLA'
                                      ? 'bg-amber-400 text-black'
                                      : m.tag === 'GOLS'
                                        ? 'bg-emerald-500 text-black'
                                        : 'bg-[#00c853] text-black'
                                  }`}>{m.tag}</span>
                                )}
                                {m.badge === '+EV' && m.tag !== 'VALOR' && <span className="bg-[#00c853] text-black text-[9px] px-1.5 py-0.5 rounded font-extrabold">+EV</span>}
                                {m.isTopEV && <span className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded font-extrabold">+EV TOP</span>}
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5 flex flex-wrap items-center gap-1">
                                <span>Odd:</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="1.01"
                                  value={oddInformada}
                                  onChange={(e) => handleOddChange(m.id, e.target.value)}
                                  className="w-16 bg-[#0d1117] border border-gray-700 text-white font-bold text-xs rounded px-1.5 py-0.5 text-center outline-none"
                                />
                                <span>| Odd Justa: <strong className="text-gray-300">{m.fairOdd}</strong></span>
                                <span className={(Number(m.fairOdd) > 1 && oddNumero > 1 ? ((oddNumero / Number(m.fairOdd)) - 1) : Number(m.evPercent)) > 0 ? 'text-[#00c853] font-bold' : 'text-red-400 font-bold'}>
                                  +EV: {(Number(m.fairOdd) > 1 && oddNumero > 1 ? ((oddNumero / Number(m.fairOdd)) - 1) * 100 : Number(m.evPercent) || 0).toFixed(1)}%
                                </span>
                                {retornoProjetado != null && <span className="text-[#00c853] font-bold">Retorno: +US$ {retornoProjetado.toFixed(2)}</span>}
                              </div>
                            </div>
                            <AcoesMercado
                              stake={stakeValue}
                              onStake={(valor) => handleStakeChange(m.id, valor)}
                              onSheet={() => handleAddToSheet(game, m, null, linkDireto)}
                              onMultipla={() => toggleMultipla(game, m, m.odd1win, m.fairOdd)}
                              naMultipla={bilheteMultipla.some((item) => item.id === `${game.id}:${m.id}`)}
                              destaqueMultipla={m.aptoMultipla === true || m.tag === 'FAVORITO' || m.tag === 'BASE MULTIPLA'}
                              onTelegram={() => handlePublishTelegram(game, m, {
                                odd: m.odd1win,
                                stake: customInputs[m.id]?.stake ?? recommendedStake,
                                directLink: linkDireto,
                                tacticalReading: m.mensagemTelegram || game.mensagemTelegram || game.tacticalReading || ''
                              })}
                              telegramDisabled={!!publishingTip[m.id]}
                              telegramLabel={publishingTip[m.id] ? 'Publicando...' : publishedTip[m.id] ? 'Publicado' : 'Publicar no Telegram'}
                              inputClass="bg-[#0d1117]"
                            />
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Mercados Gerais / IA — some depois da auditoria, que passa a listar os mercados reais */}
                  {!game.auditado && !auditoria.length && (
                  <div className="space-y-3">
                    {(Array.isArray(game.markets) ? game.markets : []).filter((m) => m && typeof m === 'object').map(m => {
                      const inputState = customInputs[m.id] || { stake: recommendedStake, odd: m.defaultOdd };

                      return (
                        <div 
                          key={m.id} 
                          className={`rounded-lg p-3 min-w-0 overflow-hidden transition ${
                            m.isTopPick 
                              ? 'bg-[#122319] border border-[#00c853]' 
                              : 'bg-[#0d1117] border border-gray-800'
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2 mb-2 min-w-0">
                            <div className="min-w-0">
                              <div className="font-semibold text-xs text-gray-100 flex items-center gap-2">
                                <span>{formatMarketName(m.name, { home: game.home, away: game.away })}</span>
                                {m.tag && (
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-extrabold ${
                                    m.tag.includes('IA') 
                                      ? 'bg-purple-600 text-white' 
                                      : 'bg-[#00c853] text-black'
                                  }`}>
                                    {m.tag}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5">
                                Odd Justa: <strong className="text-gray-200">{m.fairOdd}</strong> {m.evPercent > 0 && <span className="text-[#00c853] font-bold ml-1.5">+EV: +{m.evPercent}%</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] text-gray-400 font-bold">ODD:</span>
                              <input 
                                type="number" 
                                step="0.01"
                                value={inputState.odd}
                                onChange={(e) => handleOddChange(m.id, e.target.value)}
                                className="w-16 max-w-full bg-[#161b22] border border-gray-700 text-[#00c853] font-bold text-xs rounded px-1.5 py-1 text-center outline-none"
                              />
                            </div>
                          </div>

                          <AcoesMercado
                            stake={inputState.stake}
                            onStake={(valor) => handleStakeChange(m.id, valor)}
                            onSheet={() => handleAddToSheet(game, m, null, linkDireto)}
                            onMultipla={() => toggleMultipla(game, m, inputState.odd, m.fairOdd)}
                            naMultipla={bilheteMultipla.some((item) => item.id === `${game.id}:${m.id}`)}
                            onTelegram={() => handlePublishTelegram(game, m, { directLink: linkDireto })}
                            telegramDisabled={!!publishingTip[m.id]}
                            telegramLabel={publishingTip[m.id] ? 'Publicando...' : publishedTip[m.id] ? 'Publicado' : 'Publicar no Telegram'}
                            inputClass="bg-[#161b22]"
                          />
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
                );
              })
            )}
          </div>
        )}

        {/* ABA 2: PLANILHA DIÁRIA */}
        {activeTab === 'sheet' && (
          <div className="mt-5">
            <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div>
                  <span className="text-xs text-gray-400 block mb-1">Filtrar por Data:</span>
                  <input 
                    type="date" 
                    value={selectedDate === 'ALL' ? '' : selectedDate}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) {
                        followTodayRef.current = false;
                        setSelectedDate('ALL');
                        return;
                      }
                      followTodayRef.current = value === getTodayLocal();
                      setSelectedDate(value);
                    }}
                    className="bg-[#0d1117] border border-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:border-[#00c853]"
                  />
                </div>
                <div className="flex items-center gap-1.5 mt-4">
                  <button
                    onClick={() => {
                      followTodayRef.current = false;
                      setSelectedDate('ALL');
                    }}
                    className={`text-xs font-bold px-3 py-2 rounded transition ${
                      selectedDate === 'ALL' 
                        ? 'bg-[#00c853] text-black shadow-sm' 
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    Ver todas ({linhasFinanceiras.length})
                  </button>
                  <button
                    onClick={() => {
                      followTodayRef.current = true;
                      setSelectedDate(getTodayLocal());
                    }}
                    className={`text-xs font-bold px-3 py-2 rounded transition ${
                      selectedDate === getTodayLocal() 
                        ? 'bg-blue-600 text-white shadow-sm' 
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    Hoje
                  </button>
                </div>
              </div>
              <SeletorLigas
                value={ligaPlanilha}
                onChange={setLigaPlanilha}
                className="w-full sm:max-w-xs min-h-[42px] bg-[#0d1117] border border-gray-700 text-xs text-gray-200 rounded-lg px-2 outline-none"
              />
              <div className="text-xs text-gray-400">
                Taxa de Acerto: <strong className="text-white">{dayStats.winRate}%</strong> | ROI: <strong className={Number(dayStats.roi) >= 0 ? 'text-[#00c853]' : 'text-red-500'}>{dayStats.roi}%</strong>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                onClick={() => setVistaPlanilha('entradas')}
                className={`min-h-[42px] rounded-lg text-sm font-bold ${vistaPlanilha === 'entradas' ? 'bg-[#00c853] text-black' : 'bg-[#161b22] text-gray-300 border border-gray-800'}`}
              >
                Entradas
              </button>
              <button
                type="button"
                onClick={() => setVistaPlanilha('metodo')}
                className={`min-h-[42px] rounded-lg text-sm font-bold ${vistaPlanilha === 'metodo' ? 'bg-[#00c853] text-black' : 'bg-[#161b22] text-gray-300 border border-gray-800'}`}
              >
                Método & CDB
              </button>
            </div>

            {vistaPlanilha === 'metodo' ? (
              <PainelMetodo
                linhas={linhasFinanceiras}
                hoje={getTodayLocal()}
                saldoCdb={saldoCdb}
                onSaldo={gravarSaldoCdb}
                lucroLivro={lucroLivro}
              />
            ) : (
            <>
            <button
              type="button"
              onClick={abrirEntradaManual}
              className="mb-3 min-h-[42px] w-full sm:w-auto px-3 rounded-lg bg-[#00c853] text-black text-sm font-bold"
            >
              + Registrar Entrada Manual (Ao Vivo)
            </button>
            {entradaManualAberta && (
              <form onSubmit={salvarEntradaManual} className="mb-4 bg-[#161b22] border border-gray-800 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">Entrada manual ao vivo</h3>
                    <p className="text-[11px] text-gray-400 mt-1">Qualquer jogo alertado pelos radares, em US$.</p>
                  </div>
                  <button type="button" onClick={() => setEntradaManualAberta(false)} className="text-xs text-gray-400 hover:text-white">Fechar</button>
                </div>
                <label className="block text-[11px] text-gray-400">
                  Jogo
                  <input
                    value={entradaManual.jogo}
                    onChange={(event) => setEntradaManual((atual) => ({ ...atual, jogo: event.target.value }))}
                    placeholder="NAC Breda x Emmen"
                    className="mt-1 w-full min-h-[42px] bg-[#0d1117] border border-gray-700 rounded-lg px-3 text-sm text-white outline-none"
                  />
                </label>
                <label className="block text-[11px] text-gray-400">
                  Mercado
                  <input
                    value={entradaManual.mercado}
                    onChange={(event) => setEntradaManual((atual) => ({ ...atual, mercado: event.target.value }))}
                    placeholder="Back NAC Breda, Lay Emmen, Over 1.5 FT"
                    className="mt-1 w-full min-h-[42px] bg-[#0d1117] border border-gray-700 rounded-lg px-3 text-sm text-white outline-none"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[11px] text-gray-400">
                    Odd
                    <input
                      inputMode="decimal"
                      value={entradaManual.odd}
                      onChange={(event) => setEntradaManual((atual) => ({ ...atual, odd: event.target.value }))}
                      placeholder="2.94"
                      className="mt-1 w-full min-h-[42px] bg-[#0d1117] border border-gray-700 rounded-lg px-3 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="block text-[11px] text-gray-400">
                    Stake (US$)
                    <input
                      inputMode="decimal"
                      value={entradaManual.stake}
                      onChange={(event) => setEntradaManual((atual) => ({ ...atual, stake: event.target.value }))}
                      className="mt-1 w-full min-h-[42px] bg-[#0d1117] border border-gray-700 rounded-lg px-3 text-sm text-white outline-none"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    ['PENDENTE', 'Pendente'],
                    ['GREEN', 'Green'],
                    ['CASHOUT', 'Cashout'],
                    ['RED', 'Red']
                  ].map(([valor, rotulo]) => (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => setEntradaManual((atual) => ({ ...atual, status: valor }))}
                      className={`min-h-[42px] rounded-lg text-xs font-bold ${entradaManual.status === valor ? 'bg-[#00c853] text-black' : 'bg-[#0d1117] text-gray-300 border border-gray-700'}`}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
                {entradaManual.status === 'CASHOUT' && (
                  <label className="block text-[11px] text-gray-400">
                    Valor devolvido (US$)
                    <input
                      inputMode="decimal"
                      value={entradaManual.devolvido}
                      onChange={(event) => setEntradaManual((atual) => ({ ...atual, devolvido: event.target.value }))}
                      placeholder="2.31"
                      className="mt-1 w-full min-h-[42px] bg-[#0d1117] border border-gray-700 rounded-lg px-3 text-sm text-white outline-none"
                    />
                  </label>
                )}
                <label className="flex items-start gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={entradaManual.semApi}
                    onChange={(event) => setEntradaManual((atual) => ({ ...atual, semApi: event.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>Já estou acompanhando na LayBack (não consumir API-Football)</span>
                </label>
                {entradaManual.erro ? <p className="text-xs text-red-400">{entradaManual.erro}</p> : null}
                <button type="submit" disabled={entradaManual.salvando} className="min-h-[42px] w-full rounded-lg bg-[#00c853] text-black text-sm font-bold disabled:opacity-60">
                  {entradaManual.salvando ? 'Salvando...' : 'Salvar na planilha'}
                </button>
              </form>
            )}
            <button
              type="button"
              onClick={() => setCalendarioAberto((aberto) => !aberto)}
              aria-expanded={calendarioAberto}
              className="mb-4 min-h-[42px] w-full sm:w-auto px-3 rounded-lg border border-gray-800 bg-[#161b22] text-xs font-semibold text-gray-300 hover:text-white"
            >
              {calendarioAberto ? '📅 Ocultar Calendário do Mês' : '📅 Ver Calendário do Mês'}
            </button>
            {calendarioAberto && (
              <CalendarioMes
                linhas={linhasFinanceiras}
                hoje={getTodayLocal()}
                dataSelecionada={selectedDate}
                onSelectDate={(iso) => {
                  followTodayRef.current = iso === getTodayLocal();
                  setSelectedDate(iso);
                }}
              />
            )}

            <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">Resumo do dia</div>
                  <div className="text-sm font-bold text-white mt-1">{formatRecapDate(dailyRecap.date)}</div>
                </div>
                <button
                  type="button"
                  onClick={openRecapPreview}
                  disabled={!dailyRecap.entries.length || sendingRecap}
                  className="min-h-[42px] inline-flex items-center justify-center bg-[#229ED9] hover:bg-[#1b8ec4] disabled:opacity-50 text-white font-bold text-xs px-3 rounded transition whitespace-nowrap"
                >
                  📢 Enviar Resumo para o Telegram
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <div className="bg-[#0d1117] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-gray-400">Greens</div>
                  <div className="text-sm font-bold text-[#00c853]">✅ {dailyRecap.greens}</div>
                </div>
                <div className="bg-[#0d1117] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-gray-400">Reds</div>
                  <div className="text-sm font-bold text-red-400">❌ {dailyRecap.reds}</div>
                </div>
                <div className="bg-[#0d1117] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-gray-400">Cashouts</div>
                  <div className="text-sm font-bold text-yellow-400">🟡 {dailyRecap.cashouts}</div>
                </div>
                <div className="bg-[#0d1117] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-gray-400">Pendentes</div>
                  <div className="text-sm font-bold text-gray-200">⏳ {dailyRecap.pendings}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs">
                <span className={dailyRecap.balance >= 0 ? 'text-[#00c853] font-bold' : 'text-red-400 font-bold'}>
                  Saldo líquido: {signedMoney(dailyRecap.balance)}
                </span>
                <span className={dailyRecap.units >= 0 ? 'text-[#00c853] font-bold' : 'text-red-400 font-bold'}>
                  Unidades: {signedUnits(dailyRecap.units)} u
                </span>
                <span className="text-gray-300">Taxa de acerto: <strong className="text-white">{dailyRecap.winRate}%</strong></span>
              </div>
            </div>

            <div className="space-y-3">
              {apostasDaPlanilha.length === 0 ? (
                <div className="bg-[#161b22] border border-gray-800 rounded-xl p-8 text-center text-gray-400">
                  Nenhuma entrada para este filtro.
                  {linhasFinanceiras.length > 0 && selectedDate !== 'ALL' && (
                    <div className="mt-2 text-xs text-[#00c853]">
                      Há {linhasFinanceiras.length} entrada(s) a partir de 14/11/2026, nenhuma nesta data. Clique em <strong>"Ver todas"</strong> acima.
                    </div>
                  )}
                </div>
              ) : (
                apostasDaPlanilha.map(b => (
                  <div key={b.id} className="bg-[#161b22] border border-gray-800 rounded-xl p-3.5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-white">{b.match}</h4>
                        <span className="text-[10px] bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded font-semibold">{b.marketType}</span>
                        <span className="text-[10px] text-gray-500">({normalizeDate(b.date)})</span>
                      </div>
                      <div className="text-xs text-[#00c853] font-medium mt-0.5">{b.market} (Odd: {b.odd})</div>
                      <div className="mt-2 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {b.minutoAtual != null && (
                            <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded animate-pulse">📡 {b.minutoAtual}'</span>
                          )}
                          <BadgeMonitor aposta={b} />
                        </div>
                        {placarOficial(b) && (
                          <div className="text-sm font-bold text-white">{placarOficial(b)}</div>
                        )}
                        <div className="text-[10px] text-gray-400">
                          xG {b.metricasResumo?.xg ?? '—'} · chutes no alvo {b.metricasResumo?.chutes_alvo ?? '—'} · cantos {b.metricasResumo?.cantos ?? '—'}
                          {textoTatico(b) ? ` · ${textoTatico(b)}` : ''}
                        </div>
                        <button
                          type="button"
                          onClick={() => setRadarPlanilhaAberto((atual) => ({ ...atual, [b.id]: !atual[b.id] }))}
                          className="text-[11px] font-bold text-sky-300 hover:text-white"
                        >
                          {radarPlanilhaAberto[b.id] ? '📡 Ocultar Radar 2D' : '📡 Ver Radar 2D'}
                        </button>
                        {radarPlanilhaAberto[b.id] && (
                          <div className="w-full min-w-0">
                            <RadarLive
                              fixtureId={b.fixtureId || null}
                              marketId={b.marketId || null}
                              partida={{
                                odds: [],
                                estatisticas: b.metricasResumo && typeof b.metricasResumo === 'object' ? b.metricasResumo : {},
                                pontosPressao: Array.isArray(b.pontosPressao) ? b.pontosPressao : []
                              }}
                            />
                          </div>
                        )}
                      </div>
                      {b.gameLink && (
                        /^https?:\/\//i.test(b.gameLink) ? (
                          <a href={b.gameLink} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline mt-1 inline-block">
                            Abrir jogo na 1win
                          </a>
                        ) : (
                          <div className="text-[10px] text-blue-400 mt-1">Jogo: {b.gameLink}</div>
                        )
                      )}
                      <div className="text-[11px] text-gray-400 mt-1 flex flex-wrap items-center gap-2">
                        <span>Participação: US$ {Number(b.stake).toFixed(2).replace('.', ',')}</span>
                        <ResultadoAposta lucro={entryNetProfit(b)} stake={b.stake} status={b.status} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 self-stretch md:self-auto">
                      <button
                        type="button"
                        onClick={() => handleSetResult(b.id, 'GREEN')}
                        className={`min-h-[42px] text-xs px-3 rounded transition ${
                          b.status === 'GREEN' 
                            ? 'bg-[#00c853] text-black font-bold shadow-md' 
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700 font-semibold'
                        }`}
                      >
                        ✔ GREEN
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCashoutPrompt(b.id)}
                        className={`min-h-[42px] text-xs px-3 rounded transition ${
                          b.status === 'CASHOUT' 
                            ? 'bg-yellow-500 text-black font-bold shadow-md' 
                            : 'bg-gray-800 text-yellow-400 hover:bg-gray-700 font-semibold'
                        }`}
                      >
                        ⏱ CASHOUT
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetResult(b.id, 'RED')}
                        className={`min-h-[42px] text-xs px-3 rounded transition ${
                          b.status === 'RED' 
                            ? 'bg-red-600 text-white font-bold shadow-md' 
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700 font-semibold'
                        }`}
                      >
                        ✖ RED
                      </button>
                      <button 
                        onClick={() => handleDeleteBet(b.id)}
                        className="text-gray-500 hover:text-red-400 p-1 text-sm ml-1"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            </>
            )}
          </div>
        )}

        {recapPreview && (
          <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4">
            <div className="bg-[#161b22] border border-gray-700 rounded-xl max-w-lg w-full p-4 shadow-2xl">
              <h3 className="text-sm font-bold text-white mb-1">Pré-visualização do resumo</h3>
              <p className="text-[11px] text-gray-400 mb-3">A mensagem abaixo só vai para o Telegram se você confirmar.</p>
              <pre className="whitespace-pre-wrap text-xs text-gray-200 bg-[#0d1117] border border-gray-800 rounded-lg p-3 max-h-80 overflow-auto">{recapPreview.text}</pre>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setRecapPreview(null)}
                  disabled={sendingRecap}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold text-xs px-3 py-2 rounded transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmSendRecap}
                  disabled={sendingRecap}
                  className="bg-[#229ED9] hover:bg-[#1b8ec4] disabled:opacity-60 text-white font-bold text-xs px-3 py-2 rounded transition"
                >
                  <span>{sendingRecap ? 'Enviando...' : 'Confirmar envio'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ABA 3: PERFORMANCE POR MERCADO & WIN RATE */}
        {activeTab === 'markets' && (
          <div className="mt-5 space-y-4">
            <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-bold text-white mb-1">Diagnóstico de Lucratividade por Mercado</h3>
              <p className="text-xs text-gray-400 mb-4">
                Identifique onde estão os melhores retornos e elimine as linhas com Win Rate negativo.
              </p>

              {marketPerformance.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-xs">
                  Nenhuma aposta finalizada ainda para gerar estatísticas de mercado.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400">
                        <th className="pb-2">Mercado</th>
                        <th className="pb-2 text-center">Entradas</th>
                        <th className="pb-2 text-center">G / C / R</th>
                        <th className="pb-2 text-center">Win Rate</th>
                        <th className="pb-2 text-right">Investido</th>
                        <th className="pb-2 text-right">Lucro Real</th>
                        <th className="pb-2 text-right">ROI</th>
                        <th className="pb-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                      {marketPerformance.map(m => (
                        <tr key={m.marketType} className="hover:bg-gray-800/20">
                          <td className="py-3 font-semibold text-white">{m.marketType}</td>
                          <td className="py-3 text-center text-gray-300">{m.totalBets} ({m.pendings} ativas)</td>
                          <td className="py-3 text-center">
                            <span className="text-[#00c853] font-bold">{m.greens}G</span> •{' '}
                            <span className="text-yellow-400 font-bold">{m.cashouts}C</span> •{' '}
                            <span className="text-red-500 font-bold">{m.reds}R</span>
                          </td>
                          <td className="py-3 text-center font-bold">
                            <span className={m.winRate >= 60 ? 'text-[#00c853]' : m.winRate >= 50 ? 'text-yellow-400' : 'text-red-400'}>
                              {m.winRate}%
                            </span>
                          </td>
                          <td className="py-3 text-right text-gray-300">US$ {m.invested.toFixed(2)}</td>
                          <td className={`py-3 text-right font-bold ${m.profit >= 0 ? 'text-[#00c853]' : 'text-red-500'}`}>
                            {m.profit >= 0 ? '+' : ''}US$ {m.profit.toFixed(2)}
                          </td>
                          <td className={`py-3 text-right font-bold ${m.roi >= 0 ? 'text-[#00c853]' : 'text-red-500'}`}>
                            {m.roi >= 0 ? '+' : ''}{m.roi}%
                          </td>
                          <td className="py-3 text-center">
                            {m.profit > 0 && m.winRate >= 55 ? (
                              <span className="bg-[#00c853]/20 text-[#00c853] font-bold px-2 py-0.5 rounded text-[10px]">
                                🟢 LUCRATIVO
                              </span>
                            ) : m.profit < 0 ? (
                              <span className="bg-red-500/20 text-red-400 font-bold px-2 py-0.5 rounded text-[10px]">
                                🔴 EVITAR
                              </span>
                            ) : (
                              <span className="bg-gray-800 text-gray-300 font-bold px-2 py-0.5 rounded text-[10px]">
                                ⚪ NEUTRO
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'desempenho' && (
          <div className="mt-5 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-white">Desempenho por Mercado</h3>
              <p className="text-xs text-gray-400 mt-1">
                Amostra alvo de 100 apostas por categoria. A leitura agrega a planilha salva, sem regravar o histórico.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {desempenhoPorMercado.map((linha) => {
                const tom = linha.viabilidade.tom === 'verde'
                  ? 'bg-[#00c853]/15 text-[#00c853]'
                  : linha.viabilidade.tom === 'vermelho'
                    ? 'bg-red-500/15 text-red-400'
                    : linha.viabilidade.tom === 'amarelo'
                      ? 'bg-yellow-500/15 text-yellow-300'
                      : 'bg-gray-800 text-gray-300';
                const icone = linha.viabilidade.tom === 'verde' ? '🟢' : linha.viabilidade.tom === 'vermelho' ? '🔴' : linha.viabilidade.tom === 'amarelo' ? '🟡' : '⚪';
                return (
                  <div key={linha.categoria} className="bg-[#161b22] border border-gray-800 rounded-xl p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-bold text-white">{linha.categoria}</div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${tom}`}>{icone} {linha.viabilidade.texto}</span>
                    </div>
                    <div className="text-[11px] text-gray-300 mt-2">{linha.entradas} / 100 apostas</div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1.5">
                      <div className="h-full bg-[#00c853]" style={{ width: `${linha.progresso}%` }} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
                      <div>
                        <div className="text-gray-500">Acerto</div>
                        <div className="font-bold text-white">{linha.winRate == null ? '—' : `${linha.winRate}%`}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Líquido</div>
                        <div className={`font-bold ${linha.lucro >= 0 ? 'text-[#00c853]' : 'text-red-400'}`}>{signedMoney(linha.lucro)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">ROI</div>
                        <div className={`font-bold ${linha.roi == null ? 'text-gray-400' : linha.roi >= 0 ? 'text-[#00c853]' : 'text-red-400'}`}>
                          {linha.roi == null ? '—' : `${linha.roi > 0 ? '+' : ''}${linha.roi.toFixed(1)}%`}
                        </div>
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-2">
                      {linha.greens}G · {linha.reds}R · {linha.cashouts}C
                      {linha.pendentes > 0 ? ` · ${linha.pendentes} pendentes` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {bilheteMultipla.length >= 2 && (
        <div className="fixed bottom-0 inset-x-0 z-[70] px-3 pb-3">
          <div className="max-w-4xl mx-auto bg-[#161b22] border border-amber-500/40 rounded-xl p-3 shadow-2xl">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-bold text-amber-300">Múltipla · {bilheteMultipla.length} seleções</div>
              <button
                type="button"
                onClick={clearMultipla}
                className="text-[11px] font-bold text-gray-300 bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded"
              >
                Limpar
              </button>
            </div>
            <div className="space-y-1.5 max-h-28 overflow-auto mb-3">
              {bilheteMultipla.map((leg) => (
                <div key={leg.id} className="flex items-center justify-between gap-2 text-[11px] bg-[#0d1117] rounded px-2 py-1">
                  <span className="text-gray-200 truncate">{leg.match} — {leg.market} <span className="text-amber-300">@{Number(leg.odd).toFixed(2)}</span></span>
                  <button
                    type="button"
                    onClick={() => removeMultiplaLeg(leg.id)}
                    className="text-gray-400 hover:text-red-400 font-bold px-1"
                    aria-label="Remover seleção"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <label className="text-[10px] text-gray-400 flex-1">
                Odd total {multiplaOddEdited ? `(calculada ${multiplaOddProduct.toFixed(2)})` : '(automática)'}
                <input
                  type="number"
                  step="0.01"
                  value={multiplaOddText}
                  onChange={(e) => {
                    setMultiplaOddEdited(true);
                    setMultiplaOddText(e.target.value);
                  }}
                  className="mt-1 w-full bg-[#0d1117] border border-gray-700 text-white font-bold text-xs rounded px-2 py-1 outline-none"
                />
              </label>
              <label className="text-[10px] text-gray-400 w-full sm:w-28">
                Stake (US$)
                <input
                  type="number"
                  step="0.01"
                  value={multiplaStakeText}
                  onChange={(e) => setMultiplaStakeText(e.target.value)}
                  className="mt-1 w-full bg-[#0d1117] border border-gray-700 text-white font-bold text-xs rounded px-2 py-1 outline-none"
                />
              </label>
              <div className="text-[11px] text-gray-300 sm:pb-1">
                Prob. justa: <strong className="text-white">{(multiplaFairProb * 100).toFixed(2)}%</strong>
              </div>
              <button
                type="button"
                onClick={handleSaveMultipla}
                className="bg-[#00c853] hover:bg-[#00b248] text-black font-bold text-xs px-3 py-2 rounded whitespace-nowrap"
              >
                📋 Gravar Múltipla na Planilha
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}