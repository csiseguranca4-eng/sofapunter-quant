/**
 * Descarta categorias de base e ligas regionais sem scout ao vivo.
 * A comparação ignora acentos, maiúsculas e separadores (espaço ou hífen).
 */

const TERMOS_PROIBIDOS = [
  'u19', 'u20', 'u21', 'u23', 'sub-19', 'sub-20', 'sub-21', 'sub-23', 'sub 19', 'sub 20', 'sub 21',
  'youth', 'juniors', 'reserves', 'reserva', 'primavera', 'torneo proyeccion',
  'southern league', 'isthmian', 'northern premier', 'regional division',
  'oberliga', 'landesliga', 'tercera federacion', 'tercera rfef', 'eccellenza'
];

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compactar(valor) {
  return normalizarTexto(valor).replace(/[^a-z0-9]/g, '');
}

const TERMOS_NORMAIS = TERMOS_PROIBIDOS.map((termo) => ({
  texto: normalizarTexto(termo),
  compacto: compactar(termo)
}));

function deveIgnorarPartida(ligaNome, timeCasa, timeFora) {
  const campos = [ligaNome, timeCasa, timeFora].map(normalizarTexto).filter(Boolean);
  return campos.some((campo) => {
    const compacto = compactar(campo);
    return TERMOS_NORMAIS.some((termo) => (
      (termo.texto && campo.includes(termo.texto))
      || (termo.compacto && compacto.includes(termo.compacto))
    ));
  });
}

module.exports = {
  TERMOS_PROIBIDOS,
  deveIgnorarPartida
};
