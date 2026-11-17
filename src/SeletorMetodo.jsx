import { METODOS_ENTRADA } from './metodosEntrada.js';
import { LIGAS_RANKING } from './rankingLigas.js';

const CAMPO = 'mt-1 w-full min-h-[42px] bg-[#0d1117] border border-gray-700 rounded-lg px-3 text-sm text-white outline-none';

export function SeletorMetodo({ valor, onChange, className = CAMPO, incluirVazio = false }) {
  return (
    <select aria-label="Método" value={valor || (incluirVazio ? '' : 'MANUAL')} onChange={(event) => onChange(event.target.value)} className={className}>
      {incluirVazio ? <option value="">Sem método</option> : null}
      {METODOS_ENTRADA.map((item) => (
        <option key={item.id} value={item.id}>{item.rotulo}</option>
      ))}
    </select>
  );
}

export function SeletorLiga({ valor, onChange, className = CAMPO }) {
  const atual = String(valor || '').trim();
  const conhecida = LIGAS_RANKING.some((linha) => linha.liga === atual);
  return (
    <select aria-label="Liga" value={atual} onChange={(event) => onChange(event.target.value)} className={className}>
      <option value="">Selecione a liga</option>
      {atual && !conhecida ? <option value={atual}>{atual}</option> : null}
      {LIGAS_RANKING.map((linha) => (
        <option key={linha.ligaId} value={linha.liga}>{linha.liga}</option>
      ))}
    </select>
  );
}
