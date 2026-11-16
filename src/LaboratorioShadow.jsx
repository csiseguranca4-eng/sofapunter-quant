import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from './apiBase.js';

const META_JOGOS = 30;
const ROI_VALIDACAO = 12;
const VAZIO = {
  metodoF: { total: 0, pendentes: 0, greens: 0, reds: 0, taxaAcerto: 0, lucroVirtual: 0, roiPercentual: 0 },
  metodoB: { total: 0, pendentes: 0, greens: 0, semGol: 0, taxaAcerto: 0 },
  entradas: []
};

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function dinheiro(valor) {
  const n = numero(valor);
  const sinal = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sinal}US$ ${Math.abs(n).toFixed(2).replace('.', ',')}`;
}

function percentual(valor, comSinal) {
  const n = numero(valor);
  const sinal = comSinal && n > 0 ? '+' : comSinal && n < 0 ? '-' : '';
  return `${sinal}${Math.abs(n).toFixed(1).replace('.', ',')}%`;
}

function dataHora(valor) {
  const instante = Date.parse(String(valor || ''));
  if (!Number.isFinite(instante)) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(instante));
}

function snapshot(item) {
  const minuto = item?.minutoEntrada == null ? '—' : `${item.minutoEntrada}'`;
  const placar = item?.placarEntrada || '—';
  const xg = item?.xgEntrada == null ? '—' : Number(item.xgEntrada).toFixed(2).replace('.', ',');
  const alvos = item?.chutesAlvoEntrada == null ? '—' : item.chutesAlvoEntrada;
  return `${minuto} • ${placar} • xG ${xg} • ${alvos} no alvo`;
}

export function badgeShadow(item) {
  if (item?.status === 'aberta') return { texto: 'EM ANDAMENTO', classe: 'bg-amber-500/15 text-amber-300' };
  if (item?.metodo === 'F' && item?.status === 'green') return { texto: 'GREEN +US$ 5,20', classe: 'bg-[#00c853]/20 text-[#00c853]' };
  if (item?.metodo === 'F' && item?.status === 'red') return { texto: 'RED -US$ 4,00', classe: 'bg-red-500/20 text-red-400' };
  if (item?.metodo === 'B' && item?.status === 'green') return { texto: 'GREEN', classe: 'bg-[#00c853]/20 text-[#00c853]' };
  if (item?.status === 'sem-gol') return { texto: 'SEM GOL NO HT', classe: 'bg-gray-800 text-gray-300' };
  return { texto: 'EM ANDAMENTO', classe: 'bg-amber-500/15 text-amber-300' };
}

export function validacaoMetodoF(metodoF) {
  const fechados = numero(metodoF?.greens) + numero(metodoF?.reds);
  const roi = numero(metodoF?.roiPercentual);
  return {
    fechados,
    progresso: Math.min(100, (fechados / META_JOGOS) * 100),
    validado: fechados >= META_JOGOS && roi >= ROI_VALIDACAO
  };
}

export default function LaboratorioShadow() {
  const [auditoria, setAuditoria] = useState(VAZIO);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const atualizar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const resp = await fetch(apiUrl('/api/shadow-audit'), { cache: 'no-store' });
      const dados = await resp.json().catch(() => null);
      if (!resp.ok || !dados || typeof dados !== 'object') throw new Error('sem auditoria');
      setAuditoria({
        metodoF: { ...VAZIO.metodoF, ...(dados.metodoF || {}) },
        metodoB: { ...VAZIO.metodoB, ...(dados.metodoB || {}) },
        entradas: Array.isArray(dados.entradas) ? dados.entradas : []
      });
    } catch {
      setErro('Não foi possível ler a auditoria shadow.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    atualizar();
  }, [atualizar]);

  const f = auditoria.metodoF;
  const b = auditoria.metodoB;
  const validacao = validacaoMetodoF(f);
  const lucroPositivo = numero(f.lucroVirtual) >= 0;
  const roiPositivo = numero(f.roiPercentual) >= 0;

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Laboratório Shadow</h3>
          <p className="text-xs text-gray-400 mt-1">Auditoria silenciosa. Nenhum alerta extra sai no Telegram.</p>
        </div>
        <button
          type="button"
          onClick={atualizar}
          disabled={carregando}
          className="min-h-[42px] shrink-0 bg-[#161b22] border border-gray-700 hover:border-[#00c853] disabled:opacity-60 text-white font-bold text-xs px-3 rounded"
        >
          {carregando ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {erro && (
        <div className="bg-[#161b22] border border-amber-500/40 rounded-xl px-3 py-2 text-xs text-amber-300">{erro}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={`bg-[#161b22] border rounded-xl p-3.5 ${validacao.validado ? 'border-[#00c853]/50' : 'border-gray-800'}`}>
          <div className="text-sm font-bold text-white">Método F — Tiro Curto 75'–90'+ (0x0 / 1x1 • Stake Virtual US$ 4,00)</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-[11px]">
            <div>
              <div className="text-gray-500">Entradas</div>
              <div className="font-bold text-white">{numero(f.total)}</div>
            </div>
            <div>
              <div className="text-gray-500">Greens</div>
              <div className="font-bold text-[#00c853]">{numero(f.greens)}</div>
            </div>
            <div>
              <div className="text-gray-500">Reds</div>
              <div className="font-bold text-red-400">{numero(f.reds)}</div>
            </div>
            <div>
              <div className="text-gray-500">Taxa de Acerto</div>
              <div className="font-bold text-white">{percentual(f.taxaAcerto, false)}</div>
            </div>
            <div>
              <div className="text-gray-500">Lucro Virtual</div>
              <div className={`font-bold ${lucroPositivo ? 'text-[#00c853]' : 'text-red-400'}`}>{dinheiro(f.lucroVirtual)}</div>
            </div>
            <div>
              <div className="text-gray-500">ROI</div>
              <div className={`font-bold ${roiPositivo ? 'text-[#00c853]' : 'text-red-400'}`}>{percentual(f.roiPercentual, true)}</div>
            </div>
          </div>
          <div className="text-[11px] text-gray-300 mt-3">{validacao.fechados} / {META_JOGOS} jogos para validação</div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1.5">
            <div className={`h-full ${validacao.validado ? 'bg-[#00c853]' : 'bg-amber-400'}`} style={{ width: `${validacao.progresso}%` }} />
          </div>
          {validacao.validado && (
            <div className="mt-2 text-[11px] font-bold text-[#00c853]">VALIDADO PARA OPERAR</div>
          )}
        </div>

        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3.5">
          <div className="text-sm font-bold text-white">Método B — 1º Tempo 22'–35' (Conferência HT)</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-[11px]">
            <div>
              <div className="text-gray-500">Alertas Disparados</div>
              <div className="font-bold text-white">{numero(b.total)}</div>
            </div>
            <div>
              <div className="text-gray-500">Gols até o Intervalo (HT)</div>
              <div className="font-bold text-[#00c853]">{numero(b.greens)}</div>
            </div>
            <div>
              <div className="text-gray-500">Sem Gol no HT</div>
              <div className="font-bold text-gray-200">{numero(b.semGol)}</div>
            </div>
            <div>
              <div className="text-gray-500">Taxa de Conversão</div>
              <div className="font-bold text-white">{percentual(b.taxaAcerto, false)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
        {auditoria.entradas.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-xs">Nenhum jogo auditado em silêncio ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="pb-2 pr-3">Data/Hora</th>
                  <th className="pb-2 pr-3">Método</th>
                  <th className="pb-2 pr-3">Jogo</th>
                  <th className="pb-2 pr-3">Snapshot na Entrada</th>
                  <th className="pb-2 pr-3">Placar Final/Atual</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {auditoria.entradas.map((item, indice) => {
                  const badge = badgeShadow(item);
                  return (
                    <tr key={`${item.metodo}-${item.jogo}-${item.registradoEm || indice}`} className="hover:bg-gray-800/20">
                      <td className="py-3 pr-3 whitespace-nowrap text-gray-300">{dataHora(item.registradoEm)}</td>
                      <td className="py-3 pr-3 font-bold text-white">{item.metodo === 'B' ? 'B' : 'F'}</td>
                      <td className="py-3 pr-3 text-white">
                        <div>{item.jogo || '—'}</div>
                        {item.liga ? <div className="text-[10px] text-gray-500">{item.liga}</div> : null}
                      </td>
                      <td className="py-3 pr-3 text-gray-300 whitespace-nowrap">{snapshot(item)}</td>
                      <td className="py-3 pr-3 text-gray-200">{item.placarFinal || '—'}</td>
                      <td className="py-3">
                        <span className={`font-bold px-2 py-0.5 rounded text-[10px] whitespace-nowrap ${badge.classe}`}>{badge.texto}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
