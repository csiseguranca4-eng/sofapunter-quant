import React, { useEffect, useState, Component } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { assinarCanal, supabase } from './lib/supabaseClient.js';

function listaSegura(valor) {
  return Array.isArray(valor) ? valor.filter((item) => item && typeof item === 'object') : [];
}

function objetoSeguro(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
}

class RadarProtegido extends Component {
  constructor(props) {
    super(props);
    this.state = { falhou: false };
  }

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  componentDidCatch(erro) {
    console.error('Erro capturado na auditoria:', erro);
  }

  render() {
    if (this.state.falhou) {
      return (
        <div className="bg-[#0d1117] border border-gray-800 p-3 rounded-lg text-xs text-gray-400 mt-3 text-center">
          <span>Radar indisponível neste cartão. A planilha foi preservada.</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function RadarLive({ fixtureId, marketId, partida }) {
  const [timeline, setTimeline] = useState([]);
  const [ladder, setLadder] = useState(null);
  const odds = listaSegura(partida?.odds);
  const estatisticas = objetoSeguro(partida?.estatisticas);
  const serieBase = listaSegura(timeline);

  useEffect(() => {
    if (!fixtureId || !supabase) return undefined;
    let montado = true;

    supabase
      .from('match_timeline')
      .select('*')
      .eq('fixture_id', fixtureId)
      .order('minute', { ascending: true })
      .then(({ data }) => {
        if (!montado) return;
        setTimeline(listaSegura(data));
      })
      .catch(() => {
        if (montado) setTimeline([]);
      });

    const timeChannel = assinarCanal(
      supabase
        .channel(`timeline-${fixtureId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'match_timeline',
          filter: `fixture_id=eq.${fixtureId}`
        }, (payload) => {
          if (!montado || !payload?.new || typeof payload.new !== 'object') return;
          setTimeline((prev) => [...listaSegura(prev), payload.new]);
        })
    );

    return () => {
      montado = false;
      supabase.removeChannel(timeChannel);
    };
  }, [fixtureId]);

  useEffect(() => {
    if (!marketId || !supabase) return undefined;
    let montado = true;

    const ladderChannel = assinarCanal(
      supabase
        .channel(`ladder-${marketId}`)
        .on('broadcast', { event: 'LADDER_UPDATE' }, ({ payload } = {}) => {
          if (!montado) return;
          const mercado = objetoSeguro(payload?.market);
          setLadder(Object.keys(mercado).length ? mercado : null);
        })
    );

    return () => {
      montado = false;
      supabase.removeChannel(ladderChannel);
    };
  }, [marketId]);

  if (!fixtureId && !marketId) {
    return (
      <div className="bg-[#0d1117] border border-gray-800 p-3 rounded-lg text-xs text-gray-400 mt-3 text-center">
        <span>⏳ Aguardando auditoria ou início da partida para carregar o Radar Quant...</span>
      </div>
    );
  }

  const serie = serieBase.length ? serieBase : [];
  const precos = listaSegura(Array.isArray(ladder?.rawPrices) ? ladder.rawPrices.map((preco, indice) => ({ indice, preco })) : []);
  const preco = (indice) => {
    const item = precos[indice];
    const numero = Number(item?.preco);
    return numero > 0 ? (1 / numero).toFixed(2) : '-';
  };
  const liquidez = Number(ladder?.liquidity ?? estatisticas.liquidity);

  return (
    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-white space-y-3 mt-3" data-odds={odds.length}>
      <div className="flex justify-between items-center text-xs">
        <span className="text-orange-400 font-bold uppercase">Mandante (Pressão ↑)</span>
        <span className="text-slate-400 font-mono">Radar Quant ao Vivo (Sem Stream)</span>
        <span className="text-blue-400 font-bold uppercase">Visitante (Pressão ↓)</span>
      </div>

      <div className="w-full h-[140px] min-w-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={Array.isArray(serie) ? serie : []}>
          <XAxis dataKey="minute" stroke="#64748b" tickFormatter={(m) => `${m}'`} />
          <YAxis stroke="#64748b" domain={[-25, 25]} />
          <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b', borderRadius: '8px' }} />
          <Area type="monotone" dataKey="relative_pressure" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.35} />
        </AreaChart>
      </ResponsiveContainer>
      </div>

      <div className="p-2.5 bg-slate-900 rounded-lg flex justify-between items-center text-xs font-mono border border-slate-800">
        <div>
          <span className="text-slate-400 block text-[10px]">LIQUIDEZ LAYBACK</span>
          <span className="text-emerald-400 font-bold text-sm">
            ${Number.isFinite(liquidez) ? liquidez.toFixed(2) : '0.00'}
          </span>
        </div>
        <div className="flex gap-2">
          <div className="bg-sky-950/80 border border-sky-800 px-3 py-1 rounded text-center">
            <span className="text-[10px] text-sky-400 block font-sans font-semibold">OVER 0.5 HT</span>
            <span className="text-sm font-bold text-sky-200">{preco(0)}</span>
          </div>
          <div className="bg-rose-950/80 border border-rose-800 px-3 py-1 rounded text-center">
            <span className="text-[10px] text-rose-400 block font-sans font-semibold">UNDER 0.5 HT</span>
            <span className="text-sm font-bold text-rose-200">{preco(1)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RadarAoVivo(props) {
  return (
    <RadarProtegido>
      <RadarLive {...props} />
    </RadarProtegido>
  );
}
