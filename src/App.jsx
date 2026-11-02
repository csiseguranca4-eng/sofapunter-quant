import React, { useState, useEffect, useMemo, useRef } from 'react';

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
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">{titulo}</div>
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

function DetalheQuantExtra({ quant, home, away }) {
  if (!quant) return null;
  const h2h = Array.isArray(quant.h2h) ? quant.h2h : [];
  const cantos = quant.mercadosAdicionais?.cantos;
  const cartoes = quant.mercadosAdicionais?.cartoes;
  const ultimos = quant.ultimos10;
  const temMercado = Number(cantos?.mediaEsperada) > 0 || Number(cartoes?.mediaEsperada) > 0;
  if (!h2h.length && !temMercado && !ultimos?.mandante && !ultimos?.visitante) return null;
  return (
    <div className="mt-2.5 space-y-2">
      {(ultimos?.mandante || ultimos?.visitante) && (
        <div className="text-[10px] text-gray-400 leading-relaxed">
          {ultimos?.mandante && <div>Últimos 10 · {home}: Over 2.5 {ultimos.mandante.over25 ?? '—'}% · Ambas {ultimos.mandante.btts ?? '—'}%</div>}
          {ultimos?.visitante && <div>Últimos 10 · {away}: Over 2.5 {ultimos.visitante.over25 ?? '—'}% · Ambas {ultimos.visitante.btts ?? '—'}%</div>}
        </div>
      )}
      {h2h.length > 0 && (
        <details className="rounded-lg border border-gray-700 bg-[#0d1117] px-2.5 py-1.5">
          <summary className="text-[11px] font-bold text-gray-200 cursor-pointer">Histórico Recente (H2H)</summary>
          <div className="mt-1.5 space-y-1">
            {h2h.map((jogo, indice) => (
              <div key={`${jogo.data}-${indice}`} className="text-[11px] text-gray-300">
                {jogo.data}: {jogo.casa} {jogo.golsCasa}x{jogo.golsFora} {jogo.fora}
              </div>
            ))}
          </div>
        </details>
      )}
      {temMercado && (
        <div className="flex flex-wrap gap-2">
          <MercadoExtra titulo="Mercado de Escanteios" bloco={cantos} />
          <MercadoExtra titulo="Mercado de Cartões" bloco={cartoes} />
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('sheet'); // 'opps', 'sheet', 'markets'
  const [activeShift, setActiveShift] = useState(() => {
    return localStorage.getItem('sp_active_shift') || 'europe';
  });

  const [currentBankroll, setCurrentBankroll] = useState(335);
  const [sheetBets, setSheetBets] = useState([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // 1. CARREGAMENTO INICIAL: Lê do backend (arquivo bets_database.json no seu PC)
  useEffect(() => {
    const loadFromDisk = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/saved-data');
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
      await fetch('http://localhost:3001/api/save-data', {
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
  const [loadingAI, setLoadingAI] = useState({});

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
    try {
      const res = await fetch(`http://localhost:3001/api/daily-opportunities?shift=${shift}`);
      const data = await res.json();
      if (data.success && data.games) {
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
        setActiveTab('opps');
      } else {
        alert(data.message || 'Nenhum jogo retornado.');
      }
    } catch (err) {
      alert('Certifique-se de que o backend (node server.js) está em execução na porta 3001.');
    } finally {
      setLoading(false);
    }
  };

  // Análise de Scout com I.A Multimercado
  const handleAnalyzeWithAI = async (game) => {
    setLoadingAI(prev => ({ ...prev, [game.id]: true }));
    try {
      const res = await fetch('http://localhost:3001/api/ai-scout-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          homeTeam: game.home,
          awayTeam: game.away,
          league: game.league,
          score: game.score,
          odds: (game.markets || []).map(m => ({
            name: m.name,
            odd: customInputs[m.id]?.odd ?? m.defaultOdd ?? m.odd1win,
            fairOdd: m.fairOdd,
            evPercent: m.evPercent
          })),
          metrics: {
            score: game.score,
            time: game.time,
            dnbProb: game.dnbProb
          }
        })
      });
      const data = await res.json();
      const returned = String(data.tacticalReading || '').trim();
      const reading = returned && !/volume de ataque constante como mandante/i.test(returned)
        ? returned
        : `Leitura tática: ${game.home} tem tendência ofensiva clara diante de ${game.away}. A projeção aponta jogo vertical, com valor nas odds auditadas da 1win.`;
      const aiPicks = (Array.isArray(data.aiPicks) ? data.aiPicks : []).slice(0, 2).map((pick, index) => {
        const odd = Number(String(pick?.oddEstimated ?? '').replace(',', '.'));
        const market = String(pick?.market || '').trim();
        if (!market || !Number.isFinite(odd) || odd <= 1) return null;
        return {
          id: `ai_${game.id}_${index}`,
          market,
          oddEstimated: odd.toFixed(2)
        };
      }).filter(Boolean);
      setOpportunities(prev => prev.map(g => (
        g.id === game.id ? { ...g, tacticalReading: reading, aiPicks } : g
      )));
      if (aiPicks.length) {
        setCustomInputs(prev => {
          const next = { ...prev };
          aiPicks.forEach((pick) => {
            if (!next[pick.id]) next[pick.id] = { stake: recommendedStake, odd: Number(pick.oddEstimated) };
          });
          return next;
        });
      }
    } catch (e) {
      const reading = `Leitura tática: ${game.home} tem tendência ofensiva clara diante de ${game.away}. A projeção aponta jogo vertical, com valor nas odds auditadas da 1win.`;
      setOpportunities(prev => prev.map(g => (
        g.id === game.id ? { ...g, tacticalReading: reading, aiPicks: [] } : g
      )));
    } finally {
      setLoadingAI(prev => ({ ...prev, [game.id]: false }));
    }
  };

  // Auditoria 1win
  const handleAudit1Win = async (game) => {
    const linkOrId = onewinLinks[game.id] || '';
    if (!linkOrId.trim()) {
      alert('Cole o link do jogo na 1win ou digite o ID da partida!');
      return;
    }

    setLoading1win(prev => ({ ...prev, [game.id]: true }));
    try {
      const res = await fetch('http://localhost:3001/api/check-1win-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urlOrId: linkOrId,
          homeTeam: game.home,
          awayTeam: game.away,
          league: game.league,
          score: game.score,
          justification: game.justification
        })
      });
      const data = await res.json();
      if (data.success && data.markets) {
        setOnewinAudits(prev => ({ ...prev, [game.id]: data.markets }));
        setCustomInputs(prev => {
          const next = { ...prev };
          data.markets.forEach(m => {
            if (!next[m.id]) {
              next[m.id] = { stake: recommendedStake, odd: m.odd1win };
            }
          });
          return next;
        });
        setOnewinQuants(prev => ({ ...prev, [game.id]: data.quant || null }));
        const scout = String(data.tacticalReading || data.aiScout || '').trim();
        if (scout) {
          setOpportunities(prev => prev.map(g => (
            g.id === game.id ? { ...g, justification: scout, aiScout: scout, tacticalReading: scout } : g
          )));
        }
      } else {
        alert(data.message || 'Não foi possível obter as odds da 1win.');
      }
    } catch (e) {
      alert('Erro ao conectar com a rota de auditoria 1win.');
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
      marketType: market.marketType || 'Outro',
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
      const res = await fetch('http://localhost:3001/api/publish-telegram-tip', {
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

  const handleSetResult = (id, status) => {
    let nextBank = currentBankroll;

    const updated = sheetBets.map(b => {
      if (b.id !== id) return b;
      let cleanBank = revertBetFinance(b, currentBankroll);
      const stake = Number(Number(b.stake).toFixed(2)) || 0;
      const odd = Number(b.odd) || 0;

      if (b.status === status) {
        nextBank = cleanBank;
        return { ...b, status: 'PENDING', returnedAmount: 0, realProfit: 0 };
      }

      if (status === 'GREEN') {
        const profit = Number(((stake * odd) - stake).toFixed(2));
        nextBank = cleanBank + profit;
        return { ...b, status: 'GREEN', returnedAmount: stake * odd, realProfit: profit };
      } 
      
      if (status === 'RED') {
        nextBank = cleanBank - stake;
        return { ...b, status: 'RED', returnedAmount: 0, realProfit: -stake };
      }

      return b;
    });

    setCurrentBankroll(nextBank);
    setSheetBets(updated);
    persistToDisk(updated, nextBank);
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
      const res = await fetch('http://localhost:3001/api/telegram/send-daily-recap', {
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

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-100 font-sans pb-12">
      <header className="border-b border-gray-800 bg-[#161b22] sticky top-0 z-50 px-4 py-3">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="bg-[#00c853] text-black font-extrabold text-xs px-2 py-1 rounded">SINDICATO</span>
            <span className="font-bold text-lg tracking-wide text-white">SofaPunter Quant</span>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => handleFetchOpps('europe')} 
              disabled={loading}
              className={`text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 transition ${
                activeShift === 'europe' 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
              }`}
            >
              🇪🇺 {loading && activeShift === 'europe' ? 'Buscando...' : 'Europa (Dia Todo)'}
            </button>

            <button 
              onClick={() => handleFetchOpps('brazil')} 
              disabled={loading}
              className={`text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 transition ${
                activeShift === 'brazil' 
                  ? 'bg-[#00c853] text-black shadow-lg shadow-[#00c853]/20' 
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
              }`}
            >
              🇧🇷 {loading && activeShift === 'brazil' ? 'Buscando...' : 'Brasil (Dia Todo)'}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 mt-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

        <div className="flex border-b border-gray-800 mt-6 gap-6 text-sm font-semibold">
          <button 
            onClick={() => setActiveTab('opps')}
            className={`pb-2.5 transition ${activeTab === 'opps' ? 'text-[#00c853] border-b-2 border-[#00c853]' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Radar de Valor (+EV) ({opportunities.length})
          </button>
          <button 
            onClick={() => setActiveTab('sheet')}
            className={`pb-2.5 transition ${activeTab === 'sheet' ? 'text-[#00c853] border-b-2 border-[#00c853]' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Planilha Diária ({sheetBets.length})
          </button>
          <button 
            onClick={() => setActiveTab('markets')}
            className={`pb-2.5 transition ${activeTab === 'markets' ? 'text-[#00c853] border-b-2 border-[#00c853]' : 'text-gray-400 hover:text-gray-200'}`}
          >
            📊 Mercados & Win Rate ({marketPerformance.length})
          </button>
        </div>

        {/* ABA 1: OPORTUNIDADES + AUDITORIA 1WIN */}
        {activeTab === 'opps' && (
          <div className="mt-5 space-y-5">
            {opportunities.length === 0 ? (
              <div className="bg-[#161b22] border border-gray-800 rounded-xl p-8 text-center text-gray-400">
                Selecione acima se deseja varrer os jogos da <strong>🇪🇺 Europa (Dia Todo)</strong> ou do <strong>🇧🇷 Brasil (Dia Todo)</strong>.
              </div>
            ) : (
              opportunities.map(game => (
                <div key={game.id} className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
                  <div className="flex justify-between items-center text-xs text-gray-400 mb-1">
                    <span>{game.league} • {game.time}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAnalyzeWithAI(game)}
                        disabled={loadingAI[game.id]}
                        className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-2.5 py-1 rounded text-[11px] transition flex items-center gap-1 shadow-sm"
                      >
                        {loadingAI[game.id] ? 'Analisando com I.A...' : '🤖 Analisar com I.A'}
                      </button>
                      <span className="bg-[#00c853]/20 text-[#00c853] font-bold px-2 py-0.5 rounded text-[11px]">{game.score}% SCORE</span>
                    </div>
                  </div>

                  <h3 className="font-bold text-lg text-white mb-1.5">{game.home} vs {game.away}</h3>
                  <BarraClassificacao quant={onewinQuants[game.id]} home={game.home} away={game.away} />
                  {loadingAI[game.id] ? (
                    <p className="text-xs text-purple-300 italic mb-4">Analisando com I.A...</p>
                  ) : (
                    <p className="text-xs text-gray-300 italic mb-4">"{game.tacticalReading || game.justification}"</p>
                  )}

                  {!!game.aiPicks?.length && (
                    <div className="space-y-2 mb-4">
                      {game.aiPicks.map((pick) => {
                        const stakeValue = customInputs[pick.id]?.stake ?? recommendedStake;
                        const oddValue = Number(pick.oddEstimated);
                        const marketName = formatMarketName(pick.market, { home: game.home, away: game.away });
                        const market = {
                          id: pick.id,
                          name: marketName,
                          marketType: 'Sugestão I.A',
                          odd1win: oddValue,
                          defaultOdd: oddValue
                        };
                        return (
                          <div key={pick.id} className="p-2.5 rounded-lg bg-purple-950/30 border border-purple-500/50 text-gray-200">
                            <div className="text-xs font-bold flex items-center gap-2 flex-wrap">
                              <span>{marketName}</span>
                              <span className="bg-purple-600 text-white text-[9px] px-1.5 py-0.5 rounded font-extrabold">SUGESTÃO I.A</span>
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              Odd estimada: <strong className="text-white">{pick.oddEstimated}</strong>
                            </div>
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              <div className="relative w-24 shrink-0">
                                <span className="absolute left-2.5 top-1 text-xs text-gray-500 font-semibold">R$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={stakeValue}
                                  onChange={(e) => handleStakeChange(pick.id, e.target.value)}
                                  className="w-full bg-[#0d1117] border border-gray-700 text-white font-medium text-xs rounded pl-7 pr-2 py-1 outline-none"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => handleAddToSheet(game, market, oddValue)}
                                className="bg-[#1f2937] hover:bg-gray-700 text-gray-200 font-bold text-[11px] px-2.5 py-1 rounded transition whitespace-nowrap"
                              >
                                + Enviar para Planilha
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleMultipla(game, market, oddValue)}
                                className={`font-bold text-[11px] px-2.5 py-1 rounded transition whitespace-nowrap ${
                                  bilheteMultipla.some((item) => item.id === `${game.id}:${pick.id}`)
                                    ? 'bg-amber-400 text-black'
                                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                                }`}
                              >
                                {bilheteMultipla.some((item) => item.id === `${game.id}:${pick.id}`) ? 'Na múltipla' : '+ Múltipla'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePublishTelegram(game, market, {
                                  odd: oddValue,
                                  stake: customInputs[pick.id]?.stake ?? recommendedStake,
                                  tacticalReading: game.tacticalReading || ''
                                })}
                                disabled={!!publishingTip[pick.id]}
                                className="bg-[#229ED9] hover:bg-[#1b8ec4] disabled:opacity-60 text-white font-bold text-[11px] px-2.5 py-1 rounded transition whitespace-nowrap"
                              >
                                {publishingTip[pick.id] ? 'Publicando...' : publishedTip[pick.id] ? '✅ Publicado!' : '📢 Publicar no Telegram'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* BARRA DE AUDITORIA 1WIN */}
                  <div className="bg-[#0d1117] border border-blue-500/30 rounded-lg p-3 mb-4">
                    <div className="text-[11px] text-blue-400 font-bold mb-1 flex items-center gap-1.5">
                      <span>🎯 AUDITAR ESTE JOGO NA 1WIN (+EV):</span>
                    </div>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="Cole o link ou ID da 1win (ex: ...-41429096)"
                        value={onewinLinks[game.id] || ''}
                        onChange={(e) => setOnewinLinks({ ...onewinLinks, [game.id]: e.target.value })}
                        className="flex-1 bg-[#161b22] border border-gray-700 text-xs text-white rounded px-3 py-1.5 outline-none focus:border-blue-400"
                      />
                      <button 
                        onClick={() => handleAudit1Win(game)}
                        disabled={loading1win[game.id]}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-3 py-1.5 rounded transition whitespace-nowrap"
                      >
                        {loading1win[game.id] ? 'Auditando...' : '🔍 Auditar na 1win'}
                      </button>
                    </div>

                    {onewinQuants[game.id] && (
                      <div className="mt-3 rounded-lg border border-[#00c853]/35 bg-[#122319] p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#00c853] mb-2">SofaPunter Quant</div>
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
                    {onewinAudits[game.id] && (
                      <div className="mt-3 space-y-2 border-t border-gray-800 pt-3">
                        <div className="text-[11px] text-gray-400 font-semibold">Mercados Encontrados na 1win:</div>
                        {onewinAudits[game.id].map(m => {
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
                                {m.evPercent > 0 && <span className="bg-[#00c853] text-black text-[9px] px-1.5 py-0.5 rounded font-extrabold">+EV</span>}
                                {m.isTopEV && <span className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded font-extrabold">+EV TOP</span>}
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5">
                                Odd 1win: <strong className="text-white">{m.odd1win}</strong> | Odd Justa: <strong className="text-gray-300">{m.fairOdd}</strong> | <span className={m.evPercent > 0 ? 'text-[#00c853] font-bold' : 'text-red-400 font-bold'}>+EV: {m.evPercent}%</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              <div className="relative w-24 shrink-0">
                                <span className="absolute left-2.5 top-1 text-xs text-gray-500 font-semibold">R$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={stakeValue}
                                  onChange={(e) => handleStakeChange(m.id, e.target.value)}
                                  className="w-full bg-[#0d1117] border border-gray-700 text-white font-medium text-xs rounded pl-7 pr-2 py-1 outline-none"
                                />
                              </div>
                              <button 
                                onClick={() => handleAddToSheet(game, m, m.odd1win, onewinLinks[game.id] || '')}
                                className="bg-[#1f2937] hover:bg-gray-700 text-gray-200 font-bold text-[11px] px-2.5 py-1 rounded transition whitespace-nowrap"
                              >
                                + Enviar para Planilha
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleMultipla(game, m, m.odd1win, m.fairOdd)}
                                className={`font-bold text-[11px] px-2.5 py-1 rounded transition whitespace-nowrap ${
                                  bilheteMultipla.some((item) => item.id === `${game.id}:${m.id}`)
                                    ? 'bg-amber-400 text-black'
                                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                                }`}
                              >
                                {bilheteMultipla.some((item) => item.id === `${game.id}:${m.id}`) ? 'Na múltipla' : '+ Múltipla'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePublishTelegram(game, m, {
                                  odd: m.odd1win,
                                  stake: customInputs[m.id]?.stake ?? recommendedStake,
                                  directLink: onewinLinks[game.id] || '',
                                  tacticalReading: game.tacticalReading || ''
                                })}
                                disabled={!!publishingTip[m.id]}
                                className="bg-[#229ED9] hover:bg-[#1b8ec4] disabled:opacity-60 text-white font-bold text-[11px] px-2.5 py-1 rounded transition whitespace-nowrap"
                              >
                                {publishingTip[m.id] ? 'Publicando...' : publishedTip[m.id] ? '✅ Publicado!' : '📢 Publicar no Telegram'}
                              </button>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Mercados Gerais / IA — some depois da auditoria, que passa a listar os mercados reais */}
                  {!onewinAudits[game.id]?.length && (
                  <div className="space-y-3">
                    {game.markets?.map(m => {
                      const inputState = customInputs[m.id] || { stake: recommendedStake, odd: m.defaultOdd };

                      return (
                        <div 
                          key={m.id} 
                          className={`rounded-lg p-3 transition ${
                            m.isTopPick 
                              ? 'bg-[#122319] border border-[#00c853]' 
                              : 'bg-[#0d1117] border border-gray-800'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div>
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
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-400 font-bold">ODD:</span>
                              <input 
                                type="number" 
                                step="0.01"
                                value={inputState.odd}
                                onChange={(e) => handleOddChange(m.id, e.target.value)}
                                className="w-14 bg-[#161b22] border border-gray-700 text-[#00c853] font-bold text-xs rounded px-1.5 py-1 text-center outline-none"
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <span className="absolute left-2.5 top-1 text-xs text-gray-500 font-semibold">R$</span>
                              <input 
                                type="number"
                                step="0.5"
                                value={inputState.stake}
                                onChange={(e) => handleStakeChange(m.id, e.target.value)}
                                className="w-full bg-[#161b22] border border-gray-700 text-white font-medium text-xs rounded pl-7 pr-2 py-1 outline-none"
                              />
                            </div>
                            <button 
                              onClick={() => handleAddToSheet(game, m)}
                              className="bg-[#1f2937] hover:bg-gray-700 text-gray-200 font-bold text-xs px-3 py-1 rounded transition"
                            >
                              ✚ Enviar para Planilha
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleMultipla(game, m, inputState.odd, m.fairOdd)}
                              className={`font-bold text-xs px-3 py-1 rounded transition whitespace-nowrap ${
                                bilheteMultipla.some((item) => item.id === `${game.id}:${m.id}`)
                                  ? 'bg-amber-400 text-black'
                                  : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                              }`}
                            >
                              {bilheteMultipla.some((item) => item.id === `${game.id}:${m.id}`) ? 'Na múltipla' : '+ Múltipla'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePublishTelegram(game, m)}
                              disabled={!!publishingTip[m.id]}
                              className="bg-[#229ED9] hover:bg-[#1b8ec4] disabled:opacity-60 text-white font-bold text-xs px-3 py-1 rounded transition whitespace-nowrap"
                            >
                              {publishingTip[m.id] ? 'Publicando...' : publishedTip[m.id] ? '✅ Publicado!' : '📢 Publicar no Telegram'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              ))
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
                  className="bg-[#229ED9] hover:bg-[#1b8ec4] disabled:opacity-50 text-white font-bold text-xs px-3 py-2 rounded transition whitespace-nowrap"
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

                    <div className="flex items-center gap-1.5 self-end md:self-auto">
                      <button 
                        onClick={() => handleSetResult(b.id, 'GREEN')}
                        className={`text-xs px-2.5 py-1 rounded transition ${
                          b.status === 'GREEN' 
                            ? 'bg-[#00c853] text-black font-bold shadow-md' 
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700 font-semibold'
                        }`}
                      >
                        ✔ GREEN
                      </button>
                      <button 
                        onClick={() => handleCashoutPrompt(b.id)}
                        className={`text-xs px-2.5 py-1 rounded transition ${
                          b.status === 'CASHOUT' 
                            ? 'bg-yellow-500 text-black font-bold shadow-md' 
                            : 'bg-gray-800 text-yellow-400 hover:bg-gray-700 font-semibold'
                        }`}
                      >
                        ⏱ CASHOUT
                      </button>
                      <button 
                        onClick={() => handleSetResult(b.id, 'RED')}
                        className={`text-xs px-2.5 py-1 rounded transition ${
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