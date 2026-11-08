import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { createClient } from '@supabase/supabase-js';

// Inicialização com fallback para evitar que a falta de chaves no .env quebre a tela
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ldfrc...supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOi...';
const supabase = createClient(supabaseUrl, supabaseKey);

export default function RadarLive({ fixtureId, marketId }) {
  const [timeline, setTimeline] = useState([]);
  const [ladder, setLadder] = useState(null);

  // 1. Todos os hooks são executados PRIMEIRO
  useEffect(() => {
    if (!fixtureId) return;

    supabase
      .from('match_timeline')
      .select('*')
      .eq('fixture_id', fixtureId)
      .order('minute', { ascending: true })
      .then(({ data }) => {
        if (data && Array.isArray(data)) setTimeline(data);
      });

    const timeChannel = supabase
      .channel(`timeline-${fixtureId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'match_timeline', 
        filter: `fixture_id=eq.${fixtureId}` 
      }, (payload) => {
        setTimeline((prev) => [...prev, payload.new]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(timeChannel);
    };
  }, [fixtureId]);

  useEffect(() => {
    if (!marketId) return;

    const ladderChannel = supabase
      .channel(`ladder-${marketId}`)
      .on('broadcast', { event: 'LADDER_UPDATE' }, ({ payload }) => {
        if (payload?.market) setLadder(payload.market);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ladderChannel);
    };
  }, [marketId]);

  // 2. A verificação condicional fica AQUI, após os hooks
  if (!fixtureId && !marketId) {
    return (
      <div className="bg-[#0d1117] border border-gray-800 p-3 rounded-lg text-xs text-gray-400 mt-3 text-center">
        ⏳ Aguardando auditoria ou início da partida para carregar o Radar Quant...
      </div>
    );
  }

  return (
    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-white space-y-3 mt-3">
      <div className="flex justify-between items-center text-xs">
        <span className="text-orange-400 font-bold uppercase">Mandante (Pressão ↑)</span>
        <span className="text-slate-400 font-mono">Radar Quant ao Vivo (Sem Stream)</span>
        <span className="text-blue-400 font-bold uppercase">Visitante (Pressão ↓)</span>
      </div>

      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={timeline}>
          <XAxis dataKey="minute" stroke="#64748b" tickFormatter={(m) => `${m}'`} />
          <YAxis stroke="#64748b" domain={[-25, 25]} />
          <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b', borderRadius: '8px' }} />
          <Area type="monotone" dataKey="relative_pressure" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.35} />
        </AreaChart>
      </ResponsiveContainer>

      <div className="p-2.5 bg-slate-900 rounded-lg flex justify-between items-center text-xs font-mono border border-slate-800">
        <div>
          <span className="text-slate-400 block text-[10px]">LIQUIDEZ LAYBACK</span>
          <span className="text-emerald-400 font-bold text-sm">
            ${ladder?.liquidity ? Number(ladder.liquidity).toFixed(2) : '0.00'}
          </span>
        </div>
        <div className="flex gap-2">
          <div className="bg-sky-950/80 border border-sky-800 px-3 py-1 rounded text-center">
            <span className="text-[10px] text-sky-400 block font-sans font-semibold">OVER 0.5 HT</span>
            <span className="text-sm font-bold text-sky-200">
              {ladder?.rawPrices ? (1 / parseFloat(ladder.rawPrices[0])).toFixed(2) : '-'}
            </span>
          </div>
          <div className="bg-rose-950/80 border border-rose-800 px-3 py-1 rounded text-center">
            <span className="text-[10px] text-rose-400 block font-sans font-semibold">UNDER 0.5 HT</span>
            <span className="text-sm font-bold text-rose-200">
              {ladder?.rawPrices ? (1 / parseFloat(ladder.rawPrices[1])).toFixed(2) : '-'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}