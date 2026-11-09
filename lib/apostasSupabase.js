import { supabase, TABELA_APOSTAS } from './supabase.js';

function dataDoRegistro(item) {
  const dataRegistro = item?.data || item?.created_at || new Date().toISOString();
  return dataRegistro;
}

function normalizar(linha) {
  if (!linha) return null;
  const dataRegistro = dataDoRegistro(linha);
  const dia = String(dataRegistro).slice(0, 10);
  return {
    id: String(linha.id),
    nuvemId: linha.id,
    localBetId: null,
    match: linha.jogo || linha.partida || linha.evento || '',
    market: linha.mercado || '',
    odd: Number(linha.odd),
    stake: Number(linha.stake),
    status: String(linha.status || '').toUpperCase(),
    fixtureId: linha.fixture_id || null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null,
    createdAt: dataRegistro
  };
}

const COLUNAS_APOSTAS = 'id, jogo, mercado, odd, status, lucro, created_at';

function colunaAusente(erro) {
  const mensagem = String(erro?.message || erro || '');
  return /column .+ does not exist/i.test(mensagem)
    || /could not find the '.+' column/i.test(mensagem);
}

function erroColunaLucro(erro) {
  return colunaAusente(erro) && /lucro/i.test(String(erro?.message || erro || ''));
}

function idLinhaSupabase(id) {
  const texto = String(id ?? '').trim();
  if (!/^\d+$/.test(texto)) return null;
  const numero = Number(texto);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function fixtureIdParaColuna(valor) {
  if (typeof valor === 'number') {
    return Number.isSafeInteger(valor) && valor > 0 ? valor : null;
  }
  const texto = String(valor ?? '').trim();
  if (!texto || /[a-z]/i.test(texto)) return null;
  const digitos = texto.replace(/\D/g, '');
  if (!digitos || digitos !== texto) return null;
  const numero = Number(digitos);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function statusSemLucro(status) {
  const normal = String(status || '').trim().toUpperCase();
  if (normal === 'GREEN') return 'green';
  if (normal === 'RED') return 'red';
  return String(status || '').trim();
}

async function consultarApostas(aplicarFiltro) {
  const tentar = async (colunas, ordenar) => {
    let consulta = aplicarFiltro(supabase.from(TABELA_APOSTAS).select(colunas));
    if (ordenar) consulta = consulta.order(ordenar, { ascending: false });
    return consulta;
  };

  let resultado = await tentar(COLUNAS_APOSTAS, 'created_at');
  if (resultado.error && colunaAusente(resultado.error) && /created_at/i.test(resultado.error.message)) {
    resultado = await tentar(COLUNAS_APOSTAS, 'id');
  }
  if (resultado.error && colunaAusente(resultado.error)) {
    console.log('[CARPINA] Coluna ausente na consulta; a ler todas as colunas:', resultado.error.message);
    resultado = await tentar('*', 'id');
    if (resultado.error && colunaAusente(resultado.error)) {
      resultado = await tentar('*', null);
    }
  }
  return resultado;
}

export async function listarPendentesOver25(ehOver25) {
  const { data, error } = await consultarApostas((consulta) => consulta.eq('status', 'PENDENTE'));
  if (error) throw new Error(error.message);
  return (data || [])
    .map(normalizar)
    .filter((aposta) => aposta && String(aposta.status || '').toUpperCase() === 'PENDENTE' && ehOver25(aposta));
}

export async function garantirApostaPendente(aposta) {
  const { data, error } = await supabase.from(TABELA_APOSTAS).insert({
    jogo: aposta.match,
    mercado: aposta.market,
    odd: Number(aposta.odd) || null,
    status: 'PENDENTE'
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function gravarFixture(id, fixtureId) {
  const idLinha = idLinhaSupabase(id);
  const fixture = fixtureIdParaColuna(fixtureId);
  if (idLinha == null) {
    console.log(`[CARPINA] fixture_id não gravado: "${id}" não é a chave bigint de apostas.`);
    return;
  }
  if (fixture == null) {
    console.log(`[CARPINA] fixture_id ignorado (id sintético ou inválido): ${fixtureId}`);
    return;
  }
  let resultado = await supabase.from(TABELA_APOSTAS).update({
    fixture_id: fixture,
    updated_at: new Date().toISOString()
  }).eq('id', idLinha);
  if (resultado.error && colunaAusente(resultado.error)) {
    resultado = await supabase.from(TABELA_APOSTAS).update({ fixture_id: fixture }).eq('id', idLinha);
  }
  if (resultado.error) throw new Error(resultado.error.message);
}

export async function encerrarApostaNuvem(id, { status, lucro }) {
  const idLinha = idLinhaSupabase(id);
  const lucroNumero = Number(lucro);
  const lucroValido = Number.isFinite(lucroNumero) ? Number(lucroNumero.toFixed(2)) : null;
  if (idLinha == null) {
    console.log(`[CARPINA] Encerramento não enviado: "${id}" não é a chave bigint de apostas. Lucro local: ${lucroValido ?? 'n/d'}.`);
    return;
  }
  const payload = {
    status,
    updated_at: new Date().toISOString()
  };
  if (String(status).toUpperCase() === 'PENDENTE') payload.lucro = null;
  else if (lucroValido != null) payload.lucro = lucroValido;
  let resultado = await supabase.from(TABELA_APOSTAS).update(payload).eq('id', idLinha);
  if (resultado.error && (erroColunaLucro(resultado.error) || (payload.lucro !== undefined && colunaAusente(resultado.error)))) {
    const statusEnvio = statusSemLucro(status);
    console.log(`[CARPINA] Coluna lucro ausente em apostas. Lucro ${lucroValido ?? 'n/d'} registado só no log. Status enviado: ${statusEnvio}.`);
    resultado = await supabase.from(TABELA_APOSTAS).update({ status: statusEnvio }).eq('id', idLinha);
  }
  if (resultado.error) throw new Error(resultado.error.message);
}

export async function registrarResultadoNaNuvem({ partida, mercado, status, lucro }) {
  const statusNuvem = String(status || '').toUpperCase() === 'PENDING' ? 'PENDENTE' : String(status || '').toUpperCase();
  let { data, error } = await supabase
    .from(TABELA_APOSTAS)
    .select('id, jogo, mercado, odd, status, lucro, created_at')
    .eq('jogo', partida)
    .eq('mercado', mercado)
    .order('created_at', { ascending: false });
  if (error && colunaAusente(error) && /created_at/i.test(error.message)) {
    ({ data, error } = await supabase
      .from(TABELA_APOSTAS)
      .select('id, jogo, mercado, odd, status, lucro, created_at')
      .eq('jogo', partida)
      .eq('mercado', mercado)
      .order('id', { ascending: false }));
  }
  if (error && colunaAusente(error)) {
    console.log('[CARPINA] Coluna ausente na consulta; a ler todas as colunas:', error.message);
    ({ data, error } = await supabase.from(TABELA_APOSTAS).select('*'));
    if (!error) {
      data = (data || []).filter((linha) => {
        const jogo = String(linha.jogo || linha.partida || linha.evento || '').trim();
        const mercadoLinha = String(linha.mercado || linha.market || '').trim();
        return jogo === partida && mercadoLinha === mercado;
      });
    }
  }
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
