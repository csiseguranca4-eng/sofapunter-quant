import { useMemo } from 'react';

const FAIXAS_ODD = [
  { id: 'baixa', nome: '1.20 a 1.60', cabe: (odd) => odd >= 1.20 && odd <= 1.60 },
  { id: 'media', nome: '1.61 a 2.20', cabe: (odd) => odd >= 1.61 && odd <= 2.20 },
  { id: 'alta', nome: '2.21 a 3.00', cabe: (odd) => odd >= 2.21 && odd <= 3 },
  { id: 'longa', nome: 'Acima de 3.00', cabe: (odd) => odd > 3 }
];

function statusFinal(aposta) {
  const status = String(aposta?.status || '').toUpperCase();
  if (status === 'GREEN' || status === 'GREEN_TOTAL') return 'GREEN';
  if (status === 'RED') return 'RED';
  if (status === 'CASHOUT') return 'CASHOUT';
  return '';
}

function lucroFinal(aposta, status) {
  const stake = Number(Number(aposta?.stake).toFixed(2)) || 0;
  const odd = Number(aposta?.odd) || 0;
  if (status === 'GREEN') return Number((stake * (odd - 1)).toFixed(2));
  if (status === 'RED') return Number((-stake).toFixed(2));
  const returned = Number(aposta?.returnedAmount);
  if (Number.isFinite(returned)) {
    const net = Number((returned - stake).toFixed(2));
    return Math.abs(net) < 0.005 ? 0 : net;
  }
  const stored = Number(aposta?.realProfit);
  return Number.isFinite(stored) ? Number(stored.toFixed(2)) : 0;
}

function textoBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function estrategiaDaEntrada(aposta) {
  const texto = textoBusca(`${aposta?.market || ''} ${aposta?.marketType || ''}`);
  if (/lay/.test(texto) && /zebra/.test(texto)) return 'Lay Zebra';
  if (/back/.test(texto) && /favorit/.test(texto)) return 'Back Favorito';
  if (/\blay\b/.test(texto)) return 'Lay';
  if (/\bback\b/.test(texto)) return 'Back';
  if (/canto|escanteio|corner/.test(texto)) return 'Cantos';
  if (/cartao|card/.test(texto)) return 'Cartões';
  if (/ambas|ambos|btts/.test(texto)) return 'Ambas Marcam';
  if (/handicap|\bdnb\b|empate anula/.test(texto)) return 'Handicap';
  if (/under|abaixo/.test(texto)) return 'Under Gols';
  if (/gol|\bover\b|acima de/.test(texto)) return 'Over Gols';
  const nome = String(aposta?.market || '').trim();
  return nome || 'Sem mercado';
}

function ligaDaEntrada(aposta) {
  const nome = String(aposta?.league || aposta?.liga || '').trim();
  return nome || 'Sem liga';
}

function linhaVazia(nome, id) {
  return { id, nome, qtd: 0, acertos: 0, reds: 0, apostado: 0, lucro: 0 };
}

function somar(linha, aposta, status) {
  const stake = Number(Number(aposta?.stake).toFixed(2)) || 0;
  linha.qtd += 1;
  linha.apostado += stake;
  linha.lucro += lucroFinal(aposta, status);
  if (status === 'RED') linha.reds += 1;
  else linha.acertos += 1;
}

function fechar(linha) {
  const lucro = Number(linha.lucro.toFixed(2));
  const apostado = Number(linha.apostado.toFixed(2));
  return {
    ...linha,
    apostado,
    lucro,
    taxa: linha.qtd > 0 ? (linha.acertos / linha.qtd) * 100 : null,
    roi: apostado > 0 ? (lucro / apostado) * 100 : null
  };
}

export function auditarLucro(apostas) {
  const finalizadas = (Array.isArray(apostas) ? apostas : [])
    .map((aposta) => ({ aposta, status: statusFinal(aposta) }))
    .filter((item) => item.status);

  const faixas = FAIXAS_ODD.map((faixa) => linhaVazia(faixa.nome, faixa.id));
  const mercados = new Map();
  const ligas = new Map();

  finalizadas.forEach(({ aposta, status }) => {
    const odd = Number(aposta?.odd);
    const faixa = FAIXAS_ODD.find((item) => item.cabe(odd));
    if (faixa) somar(faixas.find((item) => item.id === faixa.id), aposta, status);

    const mercado = estrategiaDaEntrada(aposta);
    if (!mercados.has(mercado)) mercados.set(mercado, linhaVazia(mercado, mercado));
    somar(mercados.get(mercado), aposta, status);

    const liga = ligaDaEntrada(aposta);
    if (!ligas.has(liga)) ligas.set(liga, linhaVazia(liga, liga));
    somar(ligas.get(liga), aposta, status);
  });

  const faixasFechadas = faixas.map(fechar);
  const comDados = faixasFechadas.filter((faixa) => faixa.qtd > 0);
  const maiorLucro = comDados.reduce((maximo, faixa) => Math.max(maximo, faixa.lucro), 0);
  const maiorPrejuizo = comDados.reduce((minimo, faixa) => Math.min(minimo, faixa.lucro), 0);

  const ligasFechadas = [...ligas.values()].map(fechar);
  return {
    total: finalizadas.length,
    faixas: faixasFechadas.map((faixa) => ({
      ...faixa,
      destaque: faixa.qtd > 0 && faixa.lucro > 0 && faixa.lucro === maiorLucro
        ? 'lucro'
        : faixa.qtd > 0 && faixa.lucro < 0 && faixa.lucro === maiorPrejuizo
          ? 'prejuizo'
          : ''
    })),
    mercados: [...mercados.values()].map(fechar).sort((a, b) => b.lucro - a.lucro || b.qtd - a.qtd),
    ligasLucrativas: ligasFechadas.filter((liga) => liga.lucro > 0).sort((a, b) => b.lucro - a.lucro).slice(0, 5),
    ligasViloes: ligasFechadas.filter((liga) => liga.lucro < 0).sort((a, b) => a.lucro - b.lucro).slice(0, 5)
  };
}

function dinheiro(valor) {
  const numero = Number(valor) || 0;
  const sinal = numero > 0 ? '+' : numero < 0 ? '-' : '';
  return `${sinal}US$ ${Math.abs(numero).toFixed(2)}`;
}

function percentual(valor) {
  if (valor == null || !Number.isFinite(valor)) return '—';
  const sinal = valor > 0 ? '+' : '';
  return `${sinal}${valor.toFixed(1)}%`;
}

function tomDinheiro(valor) {
  if (valor > 0) return 'text-[#00c853]';
  if (valor < 0) return 'text-red-400';
  return 'text-gray-300';
}

export default function AuditoriaRoi({ apostas }) {
  const auditoria = useMemo(() => auditarLucro(apostas), [apostas]);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-white">Auditoria de Lucro (ROI)</h3>
        <p className="text-xs text-gray-400 mt-1">
          {auditoria.total} aposta(s) finalizada(s): Green, Cashout e Red. Pendentes ficam de fora.
        </p>
      </div>

      <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3 sm:p-4">
        <h4 className="text-sm font-bold text-white mb-3">Performance por Faixa de Odd</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="py-2 pr-3 font-semibold">Faixa</th>
                <th className="py-2 pr-3 font-semibold text-right">Qtd. Entradas</th>
                <th className="py-2 pr-3 font-semibold text-right">Acertos</th>
                <th className="py-2 pr-3 font-semibold text-right">Reds</th>
                <th className="py-2 pr-3 font-semibold text-right">Taxa de Acerto</th>
                <th className="py-2 pr-3 font-semibold text-right">Lucro Líquido</th>
                <th className="py-2 font-semibold text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {auditoria.faixas.map((faixa) => {
                const fundo = faixa.destaque === 'lucro'
                  ? 'bg-[#00c853]/15'
                  : faixa.destaque === 'prejuizo'
                    ? 'bg-red-500/15'
                    : '';
                return (
                  <tr key={faixa.id} className={`border-b border-gray-800/80 ${fundo}`}>
                    <td className="py-3 pr-3 font-semibold text-white">
                      {faixa.nome}
                      {faixa.destaque === 'lucro' ? <span className="ml-2 text-[10px] text-[#00c853]">Maior lucro</span> : null}
                      {faixa.destaque === 'prejuizo' ? <span className="ml-2 text-[10px] text-red-400">Maior prejuízo</span> : null}
                    </td>
                    <td className="py-3 pr-3 text-right text-gray-200">{faixa.qtd}</td>
                    <td className="py-3 pr-3 text-right text-[#00c853]">{faixa.acertos}</td>
                    <td className="py-3 pr-3 text-right text-red-400">{faixa.reds}</td>
                    <td className="py-3 pr-3 text-right text-gray-200">{faixa.taxa == null ? '—' : `${faixa.taxa.toFixed(1)}%`}</td>
                    <td className={`py-3 pr-3 text-right font-bold ${tomDinheiro(faixa.lucro)}`}>{dinheiro(faixa.lucro)}</td>
                    <td className={`py-3 text-right font-bold ${tomDinheiro(faixa.roi || 0)}`}>{percentual(faixa.roi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-bold text-white mb-3">Onde Mais Ganhei vs. Onde Mais Perdi</h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3 sm:p-4">
            <h5 className="text-sm font-bold text-white mb-3">🏆 Top Mercados / Estratégias</h5>
            {auditoria.mercados.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhuma aposta finalizada para agrupar.</p>
            ) : (
              <ul className="space-y-2">
                {auditoria.mercados.map((mercado) => (
                  <li key={mercado.id} className="bg-[#0d1117] border border-gray-800 rounded-lg px-3 py-2">
                    <div className="text-sm font-semibold text-white">{mercado.nome}</div>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <div className="text-gray-500">Entradas</div>
                        <div className="font-bold text-gray-200">{mercado.qtd}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Lucro Líquido</div>
                        <div className={`font-bold ${tomDinheiro(mercado.lucro)}`}>{dinheiro(mercado.lucro)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">ROI</div>
                        <div className={`font-bold ${tomDinheiro(mercado.roi || 0)}`}>{percentual(mercado.roi)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3 sm:p-4">
            <h5 className="text-sm font-bold text-white mb-3">🌍 Top Ligas Lucrativas & Ligas Vilãs</h5>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold text-[#00c853] mb-2">Maior lucro</div>
                {auditoria.ligasLucrativas.length === 0 ? (
                  <p className="text-xs text-gray-500">Nenhuma liga no lucro.</p>
                ) : (
                  <ol className="space-y-2">
                    {auditoria.ligasLucrativas.map((liga, indice) => (
                      <li key={liga.id} className="bg-[#0d1117] border border-[#00c853]/30 rounded-lg px-2.5 py-2">
                        <div className="text-[11px] text-gray-400">{indice + 1}º</div>
                        <div className="text-xs font-semibold text-white">{liga.nome}</div>
                        <div className="text-[11px] font-bold text-[#00c853] mt-0.5">{dinheiro(liga.lucro)} · {liga.qtd} ent.</div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div>
                <div className="text-[11px] font-bold text-red-400 mb-2">Maior prejuízo</div>
                {auditoria.ligasViloes.length === 0 ? (
                  <p className="text-xs text-gray-500">Nenhuma liga no prejuízo.</p>
                ) : (
                  <ol className="space-y-2">
                    {auditoria.ligasViloes.map((liga, indice) => (
                      <li key={liga.id} className="bg-[#0d1117] border border-red-500/30 rounded-lg px-2.5 py-2">
                        <div className="text-[11px] text-gray-400">{indice + 1}º</div>
                        <div className="text-xs font-semibold text-white">{liga.nome}</div>
                        <div className="text-[11px] font-bold text-red-400 mt-0.5">{dinheiro(liga.lucro)} · {liga.qtd} ent.</div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
