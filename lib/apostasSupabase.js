import { supabase, TABELA_APOSTAS } from './supabase.js';

function normalizar(linha) {
  if (!linha) return null;
  return {
    id: String(linha.id),
    nuvemId: linha.id,
    localBetId: null,
    match: linha.partida || '',
    market: linha.mercado || '',
    odd: Number(linha.odd),
    stake: Number(linha.stake),
    status: String(linha.status || '').toUpperCase(),
    fixtureId: linha.fixture_id || null,
    createdAt: linha.created_at || null
  };
}

export async function listarPendentesOver25(ehOver25) {
  const { data, error } = await supabase
    .from(TABELA_APOSTAS)
    .select('id, fixture_id, partida, mercado, odd, stake, lucro, status, created_at, updated_at')
    .eq('status', 'PENDENTE');
  if (error) throw new Error(error.message);
  return (data || []).map(normalizar).filter((aposta) => aposta && ehOver25(aposta));
}

export async function garantirApostaPendente(aposta) {
  const agora = new Date().toISOString();
  const fixture = Number(aposta.fixtureId || aposta.fixture_id);
  const { data, error } = await supabase.from(TABELA_APOSTAS).insert({
    fixture_id: Number.isFinite(fixture) ? fixture : null,
    partida: aposta.match,
    mercado: aposta.market,
    odd: Number(aposta.odd) || null,
    stake: Number(aposta.stake) || null,
    lucro: null,
    status: 'PENDENTE',
    created_at: agora,
    updated_at: agora
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function gravarFixture(id, fixtureId) {
  const { error } = await supabase.from(TABELA_APOSTAS).update({
    fixture_id: fixtureId,
    updated_at: new Date().toISOString()
  }).eq('id', String(id));
  if (error) throw new Error(error.message);
}

export async function encerrarApostaNuvem(id, { status, lucro }) {
  const payload = {
    status,
    updated_at: new Date().toISOString()
  };
  if (status === 'PENDENTE') payload.lucro = null;
  else if (Number.isFinite(Number(lucro))) payload.lucro = Number(Number(lucro).toFixed(2));
  const { error } = await supabase.from(TABELA_APOSTAS).update(payload).eq('id', String(id));
  if (error) throw new Error(error.message);
}

export async function registrarResultadoNaNuvem({ partida, mercado, status, lucro }) {
  const statusNuvem = String(status || '').toUpperCase() === 'PENDING' ? 'PENDENTE' : String(status || '').toUpperCase();
  const { data, error } = await supabase
    .from(TABELA_APOSTAS)
    .select('id, status')
    .eq('partida', partida)
    .eq('mercado', mercado);
  if (error) throw new Error(error.message);
  const linhas = data || [];
  const aberta = linhas.find((linha) => String(linha.status || '').toUpperCase() === 'PENDENTE');
  const alvo = aberta || linhas.slice().sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!alvo) return { atualizado: false };
  await encerrarApostaNuvem(alvo.id, {
    status: statusNuvem,
    lucro: statusNuvem === 'PENDENTE' ? null : lucro
  });
  return { atualizado: true, id: alvo.id };
}
