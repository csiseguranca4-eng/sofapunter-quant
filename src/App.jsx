import React, { useState, useEffect, useMemo, useRef } from 'react';
import { apiUrl, urlVarredura } from './apiBase.js';

const ESPELH0_1WIN_BRASIL = 'https://1win.com';

function base1win() {
  const configurado = String(import.meta.env.VITE_1WIN_BASE_URL || '').trim();
  return (configurado || ESPELH0_1WIN_BRASIL)
    .replace(/\/+$/, '')
    .replace(/\/pt(?:\/betting)?$/i, '');
}

function AcoesMercado({ stake, onStake, onSheet, onMultipla, naMultipla, onTelegram, telegramLabel, telegramDisabled, inputClass }) {
  return (
    <div className="mt-2 space-y-2 min-w-0">
      <div className="grid grid-cols-2 gap-2">
        <div className="relative min-w-0">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-semibold">R$</span>
          <input
            type="number"
            step="0.01"
            value={stake}
            onChange={(e) => onStake(e.target.value)}
            className={`w-full min-h-[42px] border border-gray-700 text-white font-medium text-xs rounded pl-7 pr-2 outline-none ${inputClass}`}
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
              : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
          }`}
        >
          {naMultipla ? 'Na múltipla' : '+ Múltipla'}
        </button>
        <button
          type="button"
          onClick={onTelegram}
          disabled={telegramDisabled}
          className="min-h-[42px] min-w-0 w-full bg-[#229ED9] hover:bg-[#1b8ec4] disabled:opacity-60 text-white font-bold text-xs px-2 rounded leading-tight"
        >
          {telegramLabel}
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

function linhasOperacionaisQuant(quant, gameId) {
  const blocos = [
    ['Cantos', quant?.mercadosAdicionais?.cantos],
    ['Cartões', quant?.mercadosAdicionais?.cartoes]
  ];
  const saida = [];
  blocos.forEach(([categoria, bloco]) => {
    (bloco?.linhas || []).forEach((linha) => {
      const evPercent = evPercentualLinha(linha);
      const odd1win = Number(linha?.oddCasa);
      if (!(evPercent > 0) || !(odd1win > 1)) return;
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
  return `${n >= 0 ? '+' : '-'}R$ ${Math.abs(n).toFixed(2)}`;
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

const PRIMARY_BANKROLL = 335;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
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
          {nome} {valor || '—'}
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
  if (Array.isArray(quant?.h2hList) && quant.h2hList.length) {
    return quant.h2hList.map((jogo) => ({
      chave: `${jogo.date}-${jogo.home}-${jogo.away}`,
      texto: `${jogo.date}: ${jogo.home} ${jogo.score} ${jogo.away}`
    }));
  }
  const legado = Array.isArray(quant?.h2h) ? quant.h2h : [];
  return legado.map((jogo, indice) => ({
    chave: `${jogo.data}-${indice}`,
    texto: `${jogo.data}: ${jogo.casa} ${jogo.golsCasa} x ${jogo.golsFora} ${jogo.fora}`
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

  const [currentBankroll, setCurrentBankroll] = useState(335);
  const [sheetBets, setSheetBets] = useState([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  useEffect(() => {
    gravarAba(activeTab);
  }, [activeTab]);

  // 1. CARREGAMENTO INICIAL: Lê do backend (arquivo bets_database.json no seu PC)
  useEffect(() => {
    const loadFromDisk = async () => {
      try {
        const res = await fetch(apiUrl('/api/saved-data'));
        const data = await res.json();
        if (data.success) {
          if (Array.isArray(data.bets)) setSheetBets(data.bets);
          if (data.bankroll && !isNaN(Number(data.bankroll))) {
            setCurrentBankroll(Number(data.bankroll));
          }
        }
      } catch (err) {
        console.warn('⚠️ Backend não conectado ainda, buscando do localStorage...');
        const localBets = localStorage.getItem('sp_sheet_bets');
        if (localBets) setSheetBets(JSON.parse(localBets));
      } finally {
        setIsDataLoaded(true);
      }
    };
    loadFromDisk();
  }, []);

  // 2. SALVAMENTO AUTOMÁTICO EM DISCO (Só salva depois de carregar do PC)
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

  const recommendedStake = useMemo(() => {
    return Number((currentBankroll * 0.015).toFixed(2));
  }, [currentBankroll]);

  // Persistência de Inputs Customizados (Odd/Stake de cada card)
  const [customInputs, setCustomInputs] = useState(() => {
    try {
      const saved = localStorage.getItem('sp_custom_inputs');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Persistência das Oportunidades Escaneadas
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

  // Persistência para URLs e Mercados da 1win
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
  const [publishingTip, setPublishingTip] = useState({});
  const [publishedTip, setPublishedTip] = useState({});
  const [recapPreview, setRecapPreview] = useState(null);
  const [sendingRecap, setSendingRecap] = useState(false);
  const [bilheteMultipla, setBilheteMultipla] = useState([]);
  const [multiplaOddText, setMultiplaOddText] = useState('');
  const [multiplaStakeText, setMultiplaStakeText] = useState('');
  const [multiplaOddEdited, setMultiplaOddEdited] = useState(false);

  const normalizeDate = (dStr) => {
    if (!dStr) return '';
    if (dStr.includes('T')) return dStr.split('T')[0];
    if (dStr.includes('/')) {
      const parts = dStr.split('/');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
    return dStr.trim();
  };

  const getTodayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const [selectedDate, setSelectedDate] = useState(() => getTodayLocal());
  const [profitPeriod, setProfitPeriod] = useState(() => {
    const saved = localStorage.getItem('sp_profit_period');
    if (saved === 'ALL' || saved === 'CURRENT' || /^\d{4}-\d{2}$/.test(saved || '')) return saved;
    return 'CURRENT';
  });
  const followTodayRef = useRef(true);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!followTodayRef.current) return;
      const today = getTodayLocal();
      setSelectedDate((prev) => (prev === today ? prev : today));
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isDataLoaded) return;
    localStorage.setItem('sp_opportunities', JSON.stringify(opportunities));
    localStorage.setItem('sp_onewin_links', JSON.stringify(onewinLinks));
    localStorage.setItem('sp_onewin_audits', JSON.stringify(onewinAudits));
    localStorage.setItem('sp_onewin_quants', JSON.stringify(onewinQuants));
    localStorage.setItem('sp_custom_inputs', JSON.stringify(customInputs));
    localStorage.setItem('sp_active_shift', activeShift);
  }, [opportunities, onewinLinks, onewinAudits, onewinQuants, customInputs, activeShift, isDataLoaded]);

  // Busca calibrada por região
  const handleFetchOpps = async (shift = 'europe') => {
    setLoading(true);
    setActiveShift(shift);
    setSelectedLeague('all');
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
      localStorage.setItem('sp_opportunities', JSON.stringify(data.games));
      setOpportunities(data.games);
      const initialInputs = { ...customInputs };
      data.games.forEach(g => {
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

    setErroAuditoria(prev => ({ ...prev, [game.id]: '' }));
    setLoading1win(prev => ({ ...prev, [game.id]: true }));
    try {
      const res = await fetch(apiUrl('/api/check-1win-match'), {
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
      const texto = await res.text();
      let data = null;
      try {
        data = JSON.parse(texto);
      } catch {
        data = null;
      }
      if (!res.ok || !data?.success || !Array.isArray(data.markets)) {
        const aviso = data?.message || 'A auditoria não respondeu. O deep scan ficou só no console.';
        console.warn(aviso);
        setErroAuditoria(prev => ({ ...prev, [game.id]: aviso }));
        return;
      }
      const leitura = String(data.tacticalReading || data.aiScout || '').trim();
      setOnewinAudits(prev => ({ ...prev, [game.id]: data.markets }));
      setCustomInputs(prev => {
        const next = { ...prev };
        data.markets.forEach((m) => {
          const stake = Number(m.stakeSugerida);
          next[m.id] = {
            stake: Number.isFinite(stake) && stake > 0 ? stake : recommendedStake,
            odd: m.odd1win
          };
        });
        return next;
      });
      setOnewinQuants(prev => ({ ...prev, [game.id]: data.quant || null }));
      setOpportunities(prev => prev.map(g => (
        g.id === game.id
          ? {
              ...g,
              auditado: true,
              tacticalReading: leitura || g.tacticalReading,
              justification: leitura || g.justification,
              mensagemTelegram: data.mensagemTelegram || ''
            }
          : g
      )));
      setErroAuditoria(prev => ({
        ...prev,
        [game.id]: data.markets.length ? '' : 'Nenhuma linha com vantagem matemática real (+EV) neste confronto.'
      }));
    } catch (e) {
      console.warn('Erro ao conectar com a rota de auditoria 1win.', e?.message || e);
      setErroAuditoria(prev => ({ ...prev, [game.id]: 'A auditoria não respondeu. O detalhe ficou no console.' }));
    } finally {
      setLoading1win(prev => ({ ...prev, [game.id]: false }));
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
      [marketId]: { ...prev[marketId], odd: Number(value) }
    }));
  };

  const handleAddToSheet = (game, market, originOdd = null, gameLink = '') => {
    const currentInput = customInputs[market.id] || { stake: recommendedStake, odd: market.defaultOdd || market.odd1win };
    const finalOdd = originOdd || Number(currentInput.odd) || market.defaultOdd || market.odd1win;
    const typedStake = currentInput.stake;
    const parsedStake = Number(Number(
      typedStake === undefined || typedStake === null || typedStake === '' ? recommendedStake : typedStake
    ).toFixed(2));
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
      evPercent: Number(market.evPercent) || 0,
      isTopPick: !!(market.isTopPick || market.isTopEV),
      odd: Number(finalOdd) || 1.40,
      stake: parsedStake,
      status: 'PENDING',
      returnedAmount: 0,
      realProfit: 0,
      date: getTodayLocal(),
      timestamp: Date.now(),
      ...(savedLink ? { gameLink: savedLink } : {}),
      ...(cardReading ? { tacticalReading: cardReading } : {})
    };

    const updated = [newBet, ...sheetBets];
    setSheetBets(updated);
    persistToDisk(updated, currentBankroll);
    alert(`Aposta "${formattedName}" enviada e salva no computador!`);
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

  const handleSaveMultipla = () => {
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
    const updated = [newBet, ...sheetBets];
    setSheetBets(updated);
    persistToDisk(updated, currentBankroll);
    clearMultipla();
    alert('Múltipla gravada na planilha.');
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
          photoUrl: 'https://i.imgur.com/8QZzG8v.jpeg',
          ...(directLink ? { directLink } : {})
        })
      });
      const data = await res.json();
      if (data.success) {
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

    setCurrentBankroll(nextBank);
    setSheetBets(updated);
    persistToDisk(updated, nextBank);
    if (resultadoNuvem) sincronizarResultadoNuvem(resultadoNuvem);
  };

  const handleCashoutPrompt = (id) => {
    const bet = sheetBets.find(b => b.id === id);
    if (!bet) return;

    const inputVal = prompt(
      `Jogo: ${bet.match}\nStake apostada: R$ ${Number(bet.stake).toFixed(2)}\n\nQuanto a casa devolveu no Saque/Cashout? (Ex: 2.31):`,
      bet.returnedAmount > 0 ? bet.returnedAmount.toString() : ''
    );

    if (inputVal === null || inputVal.trim() === '') return;

    const returned = Number(inputVal.replace(',', '.'));
    if (isNaN(returned) || returned < 0) {
      alert('Por favor, informe um valor numérico válido.');
      return;
    }

    const netProfit = Number((returned - (Number(bet.stake) || 0)).toFixed(2));
    const cleanBank = revertBetFinance(bet, currentBankroll);
    const nextBank = cleanBank + netProfit;

    setCurrentBankroll(nextBank);

    const updated = sheetBets.map(b => {
      if (b.id !== id) return b;
      return {
        ...b,
        status: 'CASHOUT',
        returnedAmount: returned,
        realProfit: netProfit
      };
    });

    setSheetBets(updated);
    persistToDisk(updated, nextBank);
    const gravada = updated.find((b) => b.id === id);
    if (gravada) sincronizarResultadoNuvem(gravada);
  };

  const handleDeleteBet = (id) => {
    const bet = sheetBets.find(b => b.id === id);
    if (!bet) return;

    const cleanBank = revertBetFinance(bet, currentBankroll);
    const updated = sheetBets.filter(b => b.id !== id);

    setCurrentBankroll(cleanBank);
    setSheetBets(updated);
    persistToDisk(updated, cleanBank);
  };

  // Estatísticas calculadas
  const dayStats = useMemo(() => {
    const target = selectedDate === 'ALL' ? 'ALL' : normalizeDate(selectedDate);
    const filtered = target === 'ALL'
      ? sheetBets
      : sheetBets.filter(b => normalizeDate(b.date) === target);

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
      if (bet.status !== 'GREEN' && bet.status !== 'RED' && bet.status !== 'CASHOUT') return;
      const key = normalizeDate(bet.date).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      profits.set(key, (profits.get(key) || 0) + entryNetProfit(bet));
    });
    if (/^\d{4}-\d{2}$/.test(currentMonthKey)) {
      profits.set(currentMonthKey, profits.get(currentMonthKey) || 0);
    }

    const months = {};
    let running = PRIMARY_BANKROLL;
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

    const totalProfit = roundMoney(running - PRIMARY_BANKROLL);
    return {
      months,
      totalProfit,
      primary: PRIMARY_BANKROLL,
      current: roundMoney(running),
      historicalGrowth: growthPercent(totalProfit, PRIMARY_BANKROLL)
    };
  }, [sheetBets, currentMonthKey]);

  const selectedMonthKey = profitSelectValue === 'CURRENT' ? currentMonthKey : profitSelectValue;
  const selectedMonth = monthLedger.months[selectedMonthKey];
  const profitCard = profitSelectValue === 'ALL'
    ? {
        netProfit: monthLedger.totalProfit,
        growth: monthLedger.historicalGrowth,
        subtitle: `Banca Inicial: R$ ${monthLedger.primary.toFixed(2)} ➔ Atual: R$ ${monthLedger.current.toFixed(2)}`
      }
    : {
        netProfit: selectedMonth?.profit || 0,
        growth: selectedMonth?.growth || 0,
        subtitle: profitSelectValue === 'CURRENT'
          ? `Banca Inicial do Mês: R$ ${(selectedMonth?.initial ?? PRIMARY_BANKROLL).toFixed(2)}`
          : `Banca Base: R$ ${(selectedMonth?.initial ?? PRIMARY_BANKROLL).toFixed(2)} ➔ Final: R$ ${(selectedMonth?.final ?? PRIMARY_BANKROLL).toFixed(2)}`
      };

  const periodTitle = profitSelectValue === 'CURRENT' ? 'Lucro Mensal' : 'Lucro';
  const growthLabel = profitSelectValue === 'CURRENT'
    ? 'Crescimento Mensal'
    : profitSelectValue === 'ALL'
      ? 'Crescimento Histórico'
      : 'Fechamento do Mês';

  const recapDate = selectedDate === 'ALL' ? getTodayLocal() : normalizeDate(selectedDate);

  const dailyRecap = useMemo(() => {
    const rows = sheetBets.filter(b => normalizeDate(b.date) === recapDate);
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

  // Agrupamento por Mercado
  const marketPerformance = useMemo(() => {
    const map = {};

    sheetBets.forEach(b => {
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

    sheetBets.forEach((aposta) => {
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

  const displayedGames = selectedLeague === 'all'
    ? opportunities
    : opportunities.filter((game) => game.leagueGroup === selectedLeague);

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-100 font-sans pb-12">
      <header className="border-b border-gray-800 bg-[#161b22] sticky top-0 z-50 px-4 py-3">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="bg-[#00c853] text-black font-extrabold text-xs px-2 py-1 rounded">SINDICATO</span>
            <span className="font-bold text-lg tracking-wide text-white">SofaPunter Quant</span>
          </div>
          
          <div className="w-full min-w-0 sm:flex-1 flex flex-col gap-2">
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              className="w-full min-w-0 min-h-[42px] bg-[#0d1117] border border-gray-700 text-xs text-gray-200 rounded-lg px-2 outline-none"
            >
              <option value="all">Todas as Ligas</option>
              <option value="uefa_cups">🏆 UEFA Champions / Europa League</option>
              <option value="national_cups">🏆 Copas Nacionais</option>
              <option value="premier_league">🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League</option>
              <option value="laliga">🇪🇸 LaLiga / LaLiga 2</option>
              <option value="serie_a">🇮🇹 Serie A</option>
              <option value="ligue_1">🇫🇷 Ligue 1 (França)</option>
              <option value="portugal">🇵🇹 Liga Portugal</option>
              <option value="turkey">🇹🇷 Turquia (Süper Lig)</option>
              <option value="greece">🇬🇷 Grécia (Super League)</option>
              <option value="brazil">🇧🇷 Brasil</option>
              <option value="argentina">🇦🇷 Argentina</option>
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
              🇪🇺 {loading && activeShift === 'europe' ? 'Buscando...' : 'Europa (Dia Todo)'}
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
              🇧🇷 {loading && activeShift === 'brazil' ? 'Buscando...' : 'Brasil (Dia Todo)'}
            </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 mt-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3.5">
            <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">Banca Atual</div>
            <div className="text-xl font-bold text-white mt-1">R$ {currentBankroll.toFixed(2)}</div>
            <div className="text-[10px] text-[#00c853] font-semibold mt-0.5">Stake 1.5%: R$ {recommendedStake.toFixed(2)}</div>
          </div>

          <div className="bg-[#161b22] border border-[#00c853]/30 rounded-xl p-3.5 bg-gradient-to-br from-[#161b22] to-[#122319]">
            <div className="text-[11px] text-[#00c853] font-bold uppercase tracking-wider">
              {selectedDate === 'ALL' ? 'Total Apostado' : 'Apostado no Dia'}
            </div>
            <div className="text-xl font-bold text-white mt-1">R$ {dayStats.totalInvested.toFixed(2)}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{dayStats.bets.length} entradas ({dayStats.pendings} ativas)</div>
          </div>

          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3.5">
            <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">
              {selectedDate === 'ALL' ? 'Lucro Total' : 'Resultado do Dia'}
            </div>
            <div className={`text-xl font-bold mt-1 ${dayStats.netProfit >= 0 ? 'text-[#00c853]' : 'text-red-500'}`}>
              {dayStats.netProfit >= 0 ? '+' : ''}R$ {dayStats.netProfit.toFixed(2)}
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
              {profitCard.netProfit >= 0 ? '+' : ''}R$ {profitCard.netProfit.toFixed(2)}
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
            Planilha Diária ({sheetBets.length})
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

        {/* ABA 1: OPORTUNIDADES + AUDITORIA 1WIN */}
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
                return (
                <div key={game.id} className="bg-[#161b22] border border-gray-800 rounded-xl p-4 min-w-0 overflow-hidden">
                  <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-gray-400 mb-1 min-w-0">
                    <span className="min-w-0 break-words">{game.league} • {game.time}</span>
                    <span className="bg-[#00c853]/20 text-[#00c853] font-bold px-2 py-0.5 rounded text-[11px]">{game.score}% SCORE</span>
                  </div>

                  <h3 className="font-bold text-lg text-white mb-1.5">{game.home} vs {game.away}</h3>
                  {loading1win[game.id] ? (
                    <p className="text-xs text-blue-300 italic mb-4">Executando Deep Scan + Auditoria IA...</p>
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
                        {loading1win[game.id] ? 'Auditando...' : 'Auditar na 1win'}
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
                      <p className="text-xs text-blue-300">Executando Deep Scan + Auditoria IA...</p>
                    )}
                    {!!erroAuditoria[game.id] && !loading1win[game.id] && (
                      <p className="text-xs text-amber-300 mt-1">{erroAuditoria[game.id]}</p>
                    )}

                    {onewinQuants[game.id] && (
                      <div className="mt-3 rounded-lg border border-[#00c853]/35 bg-[#122319] p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#00c853] mb-2">SofaPunter Quant</div>
                        <GradeProbabilidades probabilities={onewinQuants[game.id].probabilities} home={game.home} away={game.away} />
                        <BlocoClassificacaoMomento quant={onewinQuants[game.id]} home={game.home} away={game.away} />
                        <BarraClassificacao quant={onewinQuants[game.id]} home={game.home} away={game.away} />
                        <div className="flex flex-wrap items-center gap-2">
                          {onewinQuants[game.id].ritmo && (
                            <span className="text-[11px] font-bold text-white bg-[#0d1117] border border-gray-700 px-2.5 py-1 rounded-full">
                              {onewinQuants[game.id].ritmo.icone} {onewinQuants[game.id].ritmo.classificacao} ({Number(onewinQuants[game.id].ritmo.pontuacao).toFixed(1)} pts)
                            </span>
                          )}
                          {onewinQuants[game.id].tatica?.scoreConfianca != null && (
                            <span className="text-[11px] font-bold text-[#00c853] bg-[#0d1117] border border-[#00c853]/40 px-2.5 py-1 rounded-full">
                              🎯 {onewinQuants[game.id].tatica.scoreConfianca}/100
                            </span>
                          )}
                        </div>
                        {onewinQuants[game.id].tatica?.resumoVisual && (
                          <p className="text-sm font-semibold text-white mt-2 leading-snug">
                            {onewinQuants[game.id].tatica.resumoVisual}
                          </p>
                        )}
                        {Array.isArray(onewinQuants[game.id].melhoresEntradas) && onewinQuants[game.id].melhoresEntradas.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2.5">
                            {onewinQuants[game.id].melhoresEntradas.map((entrada) => {
                              const oddCasa = Number(entrada.oddCasa);
                              const oddJusta = Number(entrada.oddJusta);
                              const margem = String(entrada.margemEV || '').trim();
                              return (
                                <div
                                  key={`${game.id}-${entrada.mercado}`}
                                  className="rounded-lg border border-[#00c853]/45 bg-[#0d1117] px-2.5 py-1.5"
                                >
                                  <div className="text-[11px] font-bold text-[#00c853]">{entrada.nome || entrada.mercado}</div>
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
                    {(onewinAudits[game.id] || linhasOperacionaisQuant(onewinQuants[game.id], game.id).length > 0) && (
                      <div className="mt-3 space-y-2 border-t border-gray-800 pt-3">
                        <div className="text-[11px] text-gray-400 font-semibold">Mercados Encontrados na 1win:</div>
                        {[...(onewinAudits[game.id] || []), ...linhasOperacionaisQuant(onewinQuants[game.id], game.id)].map(m => {
                          const stakeValue = customInputs[m.id]?.stake ?? recommendedStake;
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
                                <span>{formatMarketName(m.name, { home: game.home, away: game.away })}</span>
                                {m.tag === 'FAVORITO' && <span className="bg-amber-400 text-black text-[9px] px-1.5 py-0.5 rounded font-extrabold">FAVORITO</span>}
                                {m.evPercent > 0 && <span className="bg-[#00c853] text-black text-[9px] px-1.5 py-0.5 rounded font-extrabold">+EV</span>}
                                {m.isTopEV && <span className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded font-extrabold">+EV TOP</span>}
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5">
                                Odd 1win: <strong className="text-white">{m.odd1win}</strong> | Odd Justa: <strong className="text-gray-300">{m.fairOdd}</strong> | <span className={m.evPercent > 0 ? 'text-[#00c853] font-bold' : 'text-red-400 font-bold'}>+EV: {m.evPercent}%</span>
                              </div>
                            </div>
                            <AcoesMercado
                              stake={stakeValue}
                              onStake={(valor) => handleStakeChange(m.id, valor)}
                              onSheet={() => handleAddToSheet(game, m, m.odd1win, linkDireto)}
                              onMultipla={() => toggleMultipla(game, m, m.odd1win, m.fairOdd)}
                              naMultipla={bilheteMultipla.some((item) => item.id === `${game.id}:${m.id}`)}
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
                  {!game.auditado && !onewinAudits[game.id]?.length && (
                  <div className="space-y-3">
                    {game.markets?.map(m => {
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
                    Ver todas ({sheetBets.length})
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
              <div className="text-xs text-gray-400">
                Taxa de Acerto: <strong className="text-white">{dayStats.winRate}%</strong> | ROI: <strong className={Number(dayStats.roi) >= 0 ? 'text-[#00c853]' : 'text-red-500'}>{dayStats.roi}%</strong>
              </div>
            </div>

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
              {dayStats.bets.length === 0 ? (
                <div className="bg-[#161b22] border border-gray-800 rounded-xl p-8 text-center text-gray-400">
                  Nenhuma entrada para este filtro.
                  {sheetBets.length > 0 && selectedDate !== 'ALL' && (
                    <div className="mt-2 text-xs text-[#00c853]">
                      Você possui {sheetBets.length} entrada(s) salvas no computador. Clique em <strong>"Ver todas"</strong> acima.
                    </div>
                  )}
                </div>
              ) : (
                dayStats.bets.map(b => (
                  <div key={b.id} className="bg-[#161b22] border border-gray-800 rounded-xl p-3.5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-white">{b.match}</h4>
                        <span className="text-[10px] bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded font-semibold">{b.marketType}</span>
                        <span className="text-[10px] text-gray-500">({normalizeDate(b.date)})</span>
                      </div>
                      <div className="text-xs text-[#00c853] font-medium mt-0.5">{b.market} (Odd: {b.odd})</div>
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
                        <span>Participação: R$ {Number(b.stake).toFixed(2)}</span>
                        {b.status === 'GREEN' && (
                          <span className="bg-[#00c853] text-black font-bold px-2 py-0.5 rounded">
                            + R$ {Number(b.realProfit).toFixed(2)}
                          </span>
                        )}
                        {b.status === 'RED' && (
                          <span className="bg-red-600 text-white font-bold px-2 py-0.5 rounded">
                            - R$ {Number(b.stake).toFixed(2)}
                          </span>
                        )}
                        {b.status === 'CASHOUT' && (
                          <span className="font-bold text-yellow-400">
                            Devolvido: R$ {Number(b.returnedAmount).toFixed(2)} | Real: {Number(b.realProfit) < 0 ? '-' : '+'} R$ {Math.abs(Number(b.realProfit)).toFixed(2)}
                          </span>
                        )}
                        {b.status !== 'GREEN' && b.status !== 'RED' && b.status !== 'CASHOUT' && (
                          <span className="font-semibold text-gray-500">Pendente</span>
                        )}
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
                  {sendingRecap ? 'Enviando...' : 'Confirmar envio'}
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
                          <td className="py-3 text-right text-gray-300">R$ {m.invested.toFixed(2)}</td>
                          <td className={`py-3 text-right font-bold ${m.profit >= 0 ? 'text-[#00c853]' : 'text-red-500'}`}>
                            {m.profit >= 0 ? '+' : ''}R$ {m.profit.toFixed(2)}
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
                Stake (R$)
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