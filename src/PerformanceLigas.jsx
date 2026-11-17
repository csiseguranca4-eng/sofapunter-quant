import { useMemo, useState } from 'react';
import { LIGAS_RANKING } from './rankingLigas.js';
import { hojeSaoPaulo, montarPerformance } from './metodosEntrada.js';

const PERIODOS = [
  ['mes', 'Mês Atual'],
  ['3m', 'Últimos 3 Meses'],
  ['ano', 'Ano Completo'],
  ['historico', 'Todo o Histórico']
];

const FILTROS = [
  ['todos', 'Todos os Métodos'],
  ['validados', 'Métodos Validados (A+ e A)'],
  ['manuais', 'Entradas Manuais']
];

function dinheiro(valor) {
  const n = Number(valor) || 0;
  const sinal = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sinal}US$ ${Math.abs(n).toFixed(2).replace('.', ',')}`;
}

function percentual(valor) {
  if (valor == null || !Number.isFinite(Number(valor))) return '—';
  const n = Number(valor);
  const sinal = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sinal}${Math.abs(n).toFixed(1).replace('.', ',')}%`;
}

function classeStatus(status) {
  if (status === 'Lucrativa') return 'bg-[#00c853]/15 text-[#00c853]';
  if (status === 'Atenção') return 'bg-red-500/15 text-red-300';
  return 'bg-yellow-500/15 text-yellow-200';
}

function classeRoi(valor) {
  if (valor == null || !Number.isFinite(Number(valor))) return 'text-gray-400';
  return Number(valor) >= 0 ? 'text-[#00c853]' : 'text-red-400';
}

export default function PerformanceLigas({ apostas }) {
  const [periodo, setPeriodo] = useState('mes');
  const [filtro, setFiltro] = useState('todos');
  const hoje = hojeSaoPaulo();
  const painel = useMemo(
    () => montarPerformance(apostas, LIGAS_RANKING, { periodo, filtro, hoje }),
    [apostas, periodo, filtro, hoje]
  );

  return (
    <div className="mt-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-white">Performance & Ligas</h3>
        <p className="text-xs text-gray-400 mt-1">
          Entradas finalizadas da planilha, comparadas com o ROI histórico do backtest 56'–80'.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODOS.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPeriodo(id)}
            className={`min-h-[42px] rounded-lg px-3 text-xs font-bold ${periodo === id ? 'bg-[#00c853] text-black' : 'bg-[#161b22] text-gray-300 border border-gray-800'}`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTROS.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFiltro(id)}
            className={`min-h-[42px] rounded-lg px-3 text-xs font-bold ${filtro === id ? 'bg-[#00c853] text-black' : 'bg-[#161b22] text-gray-300 border border-gray-800'}`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <section className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
        <h4 className="text-sm font-bold text-white">Desempenho real por método</h4>
        {painel.metodos.length === 0 ? (
          <p className="text-xs text-gray-500 mt-4">Nenhuma entrada finalizada neste período.</p>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left text-xs min-w-[760px]">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="pb-2 pr-3 font-medium">Método</th>
                  <th className="pb-2 pr-3 font-medium text-right">Jogos</th>
                  <th className="pb-2 pr-3 font-medium text-right">Greens</th>
                  <th className="pb-2 pr-3 font-medium text-right">Cashouts/Stops</th>
                  <th className="pb-2 pr-3 font-medium text-right">Reds</th>
                  <th className="pb-2 pr-3 font-medium text-right">Acerto</th>
                  <th className="pb-2 pr-3 font-medium text-right">Apostado</th>
                  <th className="pb-2 pr-3 font-medium text-right">Lucro líquido</th>
                  <th className="pb-2 font-medium text-right">ROI real</th>
                </tr>
              </thead>
              <tbody>
                {painel.metodos.map((linha) => (
                  <tr key={linha.id || 'sem'} className="border-b border-gray-800/70 text-gray-200">
                    <td className="py-2.5 pr-3 font-semibold text-white">{linha.nome}</td>
                    <td className="py-2.5 pr-3 text-right">{linha.jogos}</td>
                    <td className="py-2.5 pr-3 text-right text-[#00c853]">{linha.greens}</td>
                    <td className="py-2.5 pr-3 text-right text-yellow-300">{linha.stops}</td>
                    <td className="py-2.5 pr-3 text-right text-red-300">{linha.reds}</td>
                    <td className="py-2.5 pr-3 text-right">{linha.taxaAcerto == null ? '—' : `${linha.taxaAcerto.toFixed(1).replace('.', ',')}%`}</td>
                    <td className="py-2.5 pr-3 text-right">US$ {linha.apostado.toFixed(2).replace('.', ',')}</td>
                    <td className={`py-2.5 pr-3 text-right font-semibold ${classeRoi(linha.lucro)}`}>{dinheiro(linha.lucro)}</td>
                    <td className={`py-2.5 text-right font-semibold ${classeRoi(linha.roiReal)}`}>{percentual(linha.roiReal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
        <h4 className="text-sm font-bold text-white">Desempenho real por liga</h4>
        <p className="text-[11px] text-gray-500 mt-1">
          Lucrativa: 5 jogos ou mais e ROI real de pelo menos 8%. Atenção: ROI real negativo, ou liga aprovada no backtest que ainda não chegou a 8% no livro real.
        </p>
        {painel.ligas.length === 0 ? (
          <p className="text-xs text-gray-500 mt-4">Nenhuma liga com entrada finalizada neste período.</p>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="pb-2 pr-3 font-medium">Liga</th>
                  <th className="pb-2 pr-3 font-medium text-right">Jogos reais</th>
                  <th className="pb-2 pr-3 font-medium text-right">Greens</th>
                  <th className="pb-2 pr-3 font-medium text-right">Stops/Reds</th>
                  <th className="pb-2 pr-3 font-medium text-right">Lucro real</th>
                  <th className="pb-2 pr-3 font-medium text-right">ROI real</th>
                  <th className="pb-2 pr-3 font-medium text-right">ROI histórico</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {painel.ligas.map((linha) => (
                  <tr key={linha.nome} className="border-b border-gray-800/70 text-gray-200">
                    <td className="py-2.5 pr-3 font-semibold text-white">{linha.nome}</td>
                    <td className="py-2.5 pr-3 text-right">{linha.jogos}</td>
                    <td className="py-2.5 pr-3 text-right text-[#00c853]">{linha.greens}</td>
                    <td className="py-2.5 pr-3 text-right">{linha.stops + linha.reds}</td>
                    <td className={`py-2.5 pr-3 text-right font-semibold ${classeRoi(linha.lucro)}`}>{dinheiro(linha.lucro)}</td>
                    <td className={`py-2.5 pr-3 text-right font-semibold ${classeRoi(linha.roiReal)}`}>{percentual(linha.roiReal)}</td>
                    <td className="py-2.5 pr-3 text-right text-gray-300">{percentual(linha.roiHistorico)}</td>
                    <td className="py-2.5">
                      <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-bold ${classeStatus(linha.status)}`}>{linha.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
