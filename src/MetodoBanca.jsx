import { useMemo, useState } from 'react';
import CardAporteBlindado from './CardAporteBlindado.jsx';
import { BANCA_OPERACIONAL, STOP_LOSS_DIARIO, agruparDias, reais, resumoDoDia, textoResultadoStake } from './metodoBanca.js';
import { contarCliquesMes } from './utils/gestaoSniperEngine.js';

const SEMANA = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

function chaveMes(data) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

function deslocarMes(monthKey, delta) {
  const [ano, mes] = String(monthKey).split('-').map(Number);
  return chaveMes(new Date(ano, mes - 1 + delta, 1));
}

function rotuloMes(monthKey) {
  const [ano, mes] = String(monthKey).split('-');
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${nomes[Number(mes) - 1] || mes} ${ano}`;
}

export function CalendarioMes({ linhas, hoje, dataSelecionada, onSelectDate }) {
  const [mes, setMes] = useState(() => String(hoje || chaveMes(new Date())).slice(0, 7));
  const dias = useMemo(() => agruparDias(linhas, mes), [linhas, mes]);
  const [ano, numeroMes] = mes.split('-').map(Number);
  const total = new Date(ano, numeroMes, 0).getDate();
  const primeiraSemana = (new Date(ano, numeroMes - 1, 1).getDay() + 6) % 7;
  const celulas = [
    ...Array.from({ length: primeiraSemana }, () => null),
    ...Array.from({ length: total }, (_, indice) => indice + 1)
  ];

  return (
    <section className="bg-[#161b22] border border-gray-800 rounded-xl p-3 sm:p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-white">Calendário do mês</h3>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMes((atual) => deslocarMes(atual, -1))} className="min-h-[42px] min-w-[42px] rounded bg-gray-800 text-gray-200 font-bold" aria-label="Mês anterior">‹</button>
          <span className="text-xs font-semibold text-gray-200 px-2 min-w-[8.5rem] text-center">{rotuloMes(mes)}</span>
          <button type="button" onClick={() => setMes((atual) => deslocarMes(atual, 1))} className="min-h-[42px] min-w-[42px] rounded bg-gray-800 text-gray-200 font-bold" aria-label="Mês seguinte">›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-gray-500 mb-1">
        {SEMANA.map((dia, indice) => <span key={`${dia}-${indice}`}>{dia}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {celulas.map((dia, indice) => {
          if (!dia) return <div key={`vazio-${indice}`} className="min-h-[52px]" />;
          const iso = `${mes}-${String(dia).padStart(2, '0')}`;
          const info = dias.get(iso);
          const positivo = info && info.fechadas > 0 && info.lucro > 0;
          const negativo = info && info.fechadas > 0 && info.lucro < 0;
          const stop = info && info.lucro <= STOP_LOSS_DIARIO;
          const selecionado = dataSelecionada === iso;
          const tom = positivo
            ? 'border-[#00c853]/70 bg-[#00c853]/10 text-[#00c853]'
            : negativo
              ? 'border-red-500/70 bg-red-500/10 text-red-300'
              : 'border-gray-800 bg-[#0d1117] text-gray-300';
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(iso)}
              className={`min-h-[52px] rounded-lg border px-0.5 py-1 text-left ${tom} ${selecionado ? 'ring-2 ring-white/70' : ''} ${stop ? 'ring-2 ring-red-400' : ''}`}
            >
              <div className="text-[11px] font-bold leading-none">{dia}</div>
              {info ? (
                <>
                  <div className="text-[9px] leading-tight mt-1">{info.entradas} ent.</div>
                  <div className="text-[9px] leading-tight font-semibold">{reais(info.lucro, true)}</div>
                  {stop ? <div className="text-[8px] font-bold text-red-200 leading-tight">Stop -US$ 15</div> : null}
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function leituraDoMes(linhas, hoje) {
  const mes = String(hoje || '').slice(0, 7);
  const lucros = new Map();
  const cliquesUsados = contarCliquesMes(linhas, mes);
  (Array.isArray(linhas) ? linhas : []).forEach((linha) => {
    const chave = String(linha?.date || '').slice(0, 7);
    const status = String(linha?.status || '').toUpperCase();
    if (!['GREEN', 'RED', 'CASHOUT'].includes(status) || !/^\d{4}-\d{2}$/.test(chave)) return;
    lucros.set(chave, (lucros.get(chave) || 0) + (Number(linha.lucro) || 0));
  });
  let bancaInicialMes = BANCA_OPERACIONAL;
  [...lucros.keys()].filter((chave) => chave < mes).sort().forEach((chave) => {
    bancaInicialMes = Math.round((bancaInicialMes + lucros.get(chave)) * 100) / 100;
  });
  const lucroMes = Math.round((lucros.get(mes) || 0) * 100) / 100;
  return {
    bancaInicialMes,
    bancaAtual: Math.round((bancaInicialMes + lucroMes) * 100) / 100,
    cliquesUsados
  };
}

export function PainelMetodo({ linhas, hoje, protocolo, onRegistrarAporte }) {
  const aporte = useMemo(() => leituraDoMes(linhas, hoje), [linhas, hoje]);
  const leitura = protocolo || aporte;
  const hojeResumo = resumoDoDia(linhas, hoje);
  const acimaDoLimite = hojeResumo.entradas > 4;

  return (
    <div className="space-y-3">
      <CardAporteBlindado
        mes={leitura.mes}
        bancaInicialMes={leitura.bancaInicialMes}
        bancaAtual={leitura.bancaAtual}
        lucroMes={leitura.lucroMes}
        fase={leitura.fase}
        stakeCongelada={leitura.stake}
        risco80={leitura.risco80}
        cliquesUsados={leitura.cliquesUsados}
        limiteCliques={leitura.limiteCliques || 10}
        aportes={leitura.aportes || []}
        onRegistrarAporte={onRegistrarAporte}
      />
      <section className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white">Status do dia</h3>
        <p className="text-[11px] text-gray-400 mt-1">Limite recomendado: 3 a 4 entradas. Stop diário: {reais(STOP_LOSS_DIARIO)}.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          <div className="bg-[#0d1117] rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-400">Entradas hoje</div>
            <div className={`text-lg font-bold ${acimaDoLimite ? 'text-red-400' : 'text-white'}`}>{hojeResumo.entradas}</div>
            <div className="text-[10px] text-gray-500">{acimaDoLimite ? 'Acima de 4 entradas' : 'Recomendado: 3 a 4'}</div>
          </div>
          <div className="bg-[#0d1117] rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-400">Resultado do dia</div>
            <div className={`text-lg font-bold ${hojeResumo.lucro >= 0 ? 'text-[#00c853]' : 'text-red-400'}`}>{reais(hojeResumo.lucro, true)}</div>
          </div>
          <div className={`rounded-lg px-3 py-2 ${hojeResumo.stop ? 'bg-red-500/15 border border-red-500/50' : 'bg-[#0d1117]'}`}>
            <div className="text-[10px] text-gray-400">Stop diário</div>
            <div className={`text-sm font-bold ${hojeResumo.stop ? 'text-red-300' : 'text-[#00c853]'}`}>
              {hojeResumo.stop ? 'Atingido: encerrar o dia' : 'Livre'}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ResultadoAposta({ lucro, stake, status }) {
  const texto = textoResultadoStake(lucro, stake);
  if (status === 'GREEN') return <span className="bg-[#00c853] text-black font-bold px-2 py-0.5 rounded">{texto}</span>;
  if (status === 'RED') return <span className="bg-red-600 text-white font-bold px-2 py-0.5 rounded">{texto}</span>;
  if (status === 'CASHOUT') return <span className="font-bold text-yellow-400">{texto}</span>;
  return <span className="font-semibold text-gray-500">Pendente</span>;
}
