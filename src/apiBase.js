export { LIGAS_OFICIAIS, OPCOES_LIGA, grupoCompativel, grupoDaLiga } from '../ligasOficiais.js';

export function emLocal(host) {
  const nome = String(host ?? (typeof window !== 'undefined' ? window.location.hostname : '')).toLowerCase();
  return nome === 'localhost' || nome === '127.0.0.1';
}

export const API_BASE = String(import.meta.env.VITE_API_URL || 'https://sofapunter-backend.onrender.com').replace(/\/$/, '');

export function baseApi() {
  if (emLocal() && !import.meta.env.VITE_API_URL) return 'http://localhost:3001';
  return API_BASE;
}

export function apiUrl(caminho) {
  const sufixo = caminho.startsWith('/') ? caminho : `/${caminho}`;
  return `${baseApi()}${sufixo}`;
}

export function urlVarredura(shift) {
  const consulta = `shift=${encodeURIComponent(shift || 'europe')}`;
  const caminho = emLocal() && !import.meta.env.VITE_API_URL
    ? `/api/daily-opportunities?${consulta}`
    : `/api/fixtures?${consulta}`;
  return `${baseApi()}${caminho}`;
}
