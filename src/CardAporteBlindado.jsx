import { useMemo, useState } from 'react';
import { reais } from './metodoBanca.js';
import { avaliarStatusMensal, calcularProtocoloMensal, formatarCota, simularTrajetoria5k } from './utils/gestaoSniperEngine.js';

function percentualFase(percentual) {
  return `${(Number(percentual) * 100).toFixed(1).replace('.', ',')}%`;
}

export default function CardAporteBlindado({
  mes = '',
  bancaInicialMes = 69.16,
  bancaAtual = 69.16,
  lucroMes = null,
  cliquesUsados = 0,
  aportes = [],
  onRegistrarAporte
}) {
  const [comAporte, setComAporte] = useState(true);
  const inicial = Number(bancaInicialMes) || 0;
  const lucro = Number.isFinite(Number(lucroMes)) ? Number(lucroMes) : (Number(bancaAtual) || 0) - inicial;
  const protocolo = calcularProtocoloMensal(inicial);
  const jaRegistrado = aportes.some((item) => item.mes === mes);
  const status = avaliarStatusMensal({
    bancaInicialMes: inicial,
    bancaAtual: inicial + lucro,
    cliquesUsados,
    aporteJaRealizadoNoMes: jaRegistrado
  });
  const trajetoria = useMemo(
    () => simularTrajetoria5k(bancaAtual, comAporte),
    [bancaAtual, comAporte]
  );
  const progresso = status.lucroAlvo > 0
    ? Math.max(0, Math.min(1, status.lucroMes / status.lucroAlvo))
    : 0;

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <article className="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white">Aporte Condicionado (CDB Liquidez Diária Inter)</h3>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            O aporte de US$ 35,00 entra na banca quando o mês fecha +8% sobre a banca do dia 1º.
          </p>
          <div className="mt-3 flex justify-between gap-3 text-[11px]">
            <span className="text-slate-300">Meta {reais(status.lucroAlvo)} · lucro {reais(status.lucroMes, true)}</span>
            <span className={status.metaBatida ? 'text-emerald-300 font-bold' : 'text-amber-300 font-bold'}>
              {status.metaBatida ? 'Meta batida' : `Faltam ${reais(status.faltaParaMeta)}`}
            </span>
          </div>
          <div className="h-2 mt-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-emerald-400" style={{ width: `${progresso * 100}%` }} />
          </div>
          <button
            type="button"
            disabled={!status.podeAportar}
            onClick={onRegistrarAporte}
            className={`mt-3 min-h-[42px] w-full rounded-lg text-sm font-bold ${status.podeAportar ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
          >
            Confirmar Aporte CDB (+US$ 35,00)
          </button>
          {jaRegistrado ? <p className="text-[11px] text-emerald-300 mt-2">Aporte de US$ 35,00 já somado à banca neste mês.</p> : null}
        </article>

        <article className="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white">Trava Anti-Tilt & Risco Real</h3>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-2">
              <div className="text-[10px] text-slate-400">Cliques</div>
              <div className={`text-sm font-bold ${status.bloqueadoPorCliques ? 'text-rose-300' : 'text-white'}`}>{formatarCota(cliquesUsados)} / 30</div>
              <div className="text-[10px] text-slate-400">{formatarCota(status.cliquesRestantes)} restantes</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-2">
              <div className="text-[10px] text-slate-400">Stake congelada</div>
              <div className="text-sm font-bold text-emerald-300">{reais(protocolo.stakeCongelada)}</div>
              <div className="text-[10px] text-slate-400">Fase {protocolo.fase} • {percentualFase(protocolo.percentual)}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-2">
              <div className="text-[10px] text-slate-400">Corte aos 80'</div>
              <div className="text-sm font-bold text-amber-300">-{reais(protocolo.riscoRealCorte80)}</div>
              <div className="text-[10px] text-slate-400">Meia stake</div>
            </div>
          </div>
          <p className="text-[11px] text-slate-300 mt-3 leading-relaxed">
            55'–67' • xG &gt;= 1.50 • Odd 1.50–1.70 • Stop 80'
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            Risco real no corte: {protocolo.riscoRealPctBanca.toFixed(1).replace('.', ',')}% da banca do dia 1º.
          </p>
        </article>
      </div>

      <article className="bg-slate-950 border border-slate-800 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white">
              Simulador Rumo aos US$ 5.000
              {trajetoria.totalMeses > 0 ? ` · ${trajetoria.totalMeses} meses` : ''}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Juros de +8% ao mês a partir da banca atual.</p>
          </div>
          <div className="flex rounded-lg border border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setComAporte(true)}
              className={`min-h-[42px] px-3 text-xs font-bold ${comAporte ? 'bg-emerald-400 text-slate-950' : 'bg-slate-900 text-slate-300'}`}
            >
              Com Aporte (+US$ 35/mês)
            </button>
            <button
              type="button"
              onClick={() => setComAporte(false)}
              className={`min-h-[42px] px-3 text-xs font-bold ${comAporte ? 'bg-slate-900 text-slate-300' : 'bg-sky-400 text-slate-950'}`}
            >
              Sem Aporte (US$ 0/mês)
            </button>
          </div>
        </div>
        {trajetoria.totalMeses == null ? (
          <p className="text-xs text-slate-400 mt-3">Sem banca positiva para projetar.</p>
        ) : trajetoria.totalMeses === 0 ? (
          <p className="text-xs text-emerald-300 mt-3">A banca já passou de US$ 5.000.</p>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-3 font-semibold">Marco</th>
                  <th className="py-2 pr-3 font-semibold text-right">Banca Projetada</th>
                  <th className="py-2 pr-3 font-semibold text-right">Stake do mês</th>
                  <th className="py-2 font-semibold text-right">Lucro +8%</th>
                </tr>
              </thead>
              <tbody>
                {trajetoria.marcos.map((linha) => {
                  const final = linha.mes === trajetoria.totalMeses;
                  return (
                    <tr key={linha.mes} className={`border-b border-slate-800/80 ${final ? 'bg-emerald-500/10' : ''}`}>
                      <td className="py-2.5 pr-3 font-semibold text-white">{linha.marco}{final ? ' · Meta' : ''}</td>
                      <td className="py-2.5 pr-3 text-right text-emerald-300 font-bold">{reais(linha.banca)}</td>
                      <td className="py-2.5 pr-3 text-right text-sky-300">{reais(linha.stake)}</td>
                      <td className="py-2.5 text-right text-slate-200">{reais(linha.lucroMensal, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
