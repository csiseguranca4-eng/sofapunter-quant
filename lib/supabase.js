import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function lerEnvLocal() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) return;
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
  try {
    const texto = fs.readFileSync(envPath, 'utf8');
    for (const linha of texto.split(/\r?\n/)) {
      const corte = linha.indexOf('=');
      if (corte <= 0) continue;
      const chave = linha.slice(0, corte).trim();
      const valor = linha.slice(corte + 1).trim().replace(/^['"]|['"]$/g, '');
      if (chave && valor && !process.env[chave]) process.env[chave] = valor;
    }
  } catch (_) { /* o processo pode receber as variáveis pelo ambiente */ }
}

lerEnvLocal();

const url = process.env.SUPABASE_URL;
const chave = process.env.SUPABASE_KEY;

if (!url || !chave) {
  throw new Error('SUPABASE_URL e SUPABASE_KEY são obrigatórias no .env.');
}

export const TABELA_APOSTAS = 'apostas_futebol';

export const supabase = createClient(url, chave, {
  auth: { persistSession: false, autoRefreshToken: false }
});
