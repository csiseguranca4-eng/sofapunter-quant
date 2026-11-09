import { createClient } from '@supabase/supabase-js';

const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

function credencialUtil(valor) {
  const texto = String(valor || '').trim();
  return texto.length > 20 && !texto.includes('...');
}

export const supabase = credencialUtil(url) && url.startsWith('http') && credencialUtil(key)
  ? createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: {
        params: { eventsPerSecond: 2 },
        reconnectAfterMs: (tentativas) => (tentativas > 2 ? 60000 : 2000)
      }
    })
  : null;

export function assinarCanal(canal) {
  return canal.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn('[Supabase Realtime] Canal indisponível, mantendo polling HTTP.');
    }
  });
}
