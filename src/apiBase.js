export { LIGAS_OFICIAIS, OPCOES_LIGA, grupoCompativel, grupoDaLiga } from '../ligasOficiais.js';

export function emLocal(host) {
  const nome = String(host ?? (typeof window !== 'undefined' ? window.location.hostname : '')).toLowerCase();
  return nome === 'localhost' || nome === '127.0.0.1';
}

export function apiUrl(caminho) {
  if (!emLocal()) return caminho;
  return `http://localhost:3001${caminho}`;
}

export function urlVarredura(shift) {
  const consulta = `shift=${encodeURIComponent(shift || 'europe')}`;
  if (!emLocal()) return `/api/fixtures?${consulta}`;
  return `http://localhost:3001/api/daily-opportunities?${consulta}`;
}
