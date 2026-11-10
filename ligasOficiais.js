/**
 * Ligas oficiais da API-Football usadas na varredura, no filtro e nos seletores.
 * Jogos fora desta lista, replays e futebol virtual não entram.
 */

const LIGAS_OFICIAIS = [
  { id: 39, nome: 'Premier League', pais: 'Inglaterra', regiao: 'Europa', grupo: 'premier_league' },
  { id: 140, nome: 'LaLiga', pais: 'Espanha', regiao: 'Europa', grupo: 'laliga' },
  { id: 141, nome: 'LaLiga 2', pais: 'Espanha', regiao: 'Europa', grupo: 'laliga' },
  { id: 135, nome: 'Serie A', pais: 'Itália', regiao: 'Europa', grupo: 'serie' },
  { id: 136, nome: 'Serie B', pais: 'Itália', regiao: 'Europa', grupo: 'serie' },
  { id: 78, nome: 'Bundesliga', pais: 'Alemanha', regiao: 'Europa', grupo: 'bundesliga' },
  { id: 79, nome: '2. Bundesliga', pais: 'Alemanha', regiao: 'Europa', grupo: 'bundesliga' },
  { id: 61, nome: 'Ligue 1', pais: 'França', regiao: 'Europa', grupo: 'ligue' },
  { id: 62, nome: 'Ligue 2', pais: 'França', regiao: 'Europa', grupo: 'ligue' },
  { id: 94, nome: 'Liga Portugal', pais: 'Portugal', regiao: 'Europa', grupo: 'portugal' },
  { id: 88, nome: 'Eredivisie', pais: 'Holanda', regiao: 'Europa', grupo: 'eredivisie' },
  { id: 203, nome: 'Süper Lig', pais: 'Turquia', regiao: 'Europa', grupo: 'turkey' },
  { id: 197, nome: 'Super League', pais: 'Grécia', regiao: 'Europa', grupo: 'greece' },
  { id: 2, nome: 'UEFA Champions League', pais: 'Europa', regiao: 'Europa', grupo: 'uefa_cups' },
  { id: 3, nome: 'UEFA Europa League', pais: 'Europa', regiao: 'Europa', grupo: 'uefa_cups' },
  { id: 848, nome: 'UEFA Conference League', pais: 'Europa', regiao: 'Europa', grupo: 'uefa_cups' },
  { id: 71, nome: 'Brasileirão Série A', pais: 'Brasil', regiao: 'Brasil', grupo: 'brazil' },
  { id: 72, nome: 'Brasileirão Série B', pais: 'Brasil', regiao: 'Brasil', grupo: 'brazil' },
  { id: 73, nome: 'Copa do Brasil', pais: 'Brasil', regiao: 'Brasil', grupo: 'brazil' },
  { id: 128, nome: 'Liga Profesional', pais: 'Argentina', regiao: 'Américas', grupo: 'argentina' },
  { id: 130, nome: 'Copa de la Liga', pais: 'Argentina', regiao: 'Américas', grupo: 'argentina' },
  { id: 239, nome: 'Primera A', pais: 'Colômbia', regiao: 'Américas', grupo: 'colombia' },
  { id: 253, nome: 'Major League Soccer (MLS)', pais: 'USA', regiao: 'Américas', grupo: 'mls' },
  { id: 262, nome: 'Liga MX', pais: 'México', regiao: 'Américas', grupo: 'ligamx' },
  { id: 265, nome: 'Primera División', pais: 'Chile', regiao: 'Américas', grupo: 'chile' },
  { id: 13, nome: 'Copa Libertadores', pais: 'América do Sul', regiao: 'Américas', grupo: 'libertadores' },
  { id: 11, nome: 'Copa Sudamericana', pais: 'América do Sul', regiao: 'Américas', grupo: 'libertadores' },
  { id: 143, nome: 'Copa del Rey', pais: 'Espanha', regiao: 'Europa', grupo: 'copas_nacionais' },
  { id: 45, nome: 'FA Cup', pais: 'Inglaterra', regiao: 'Europa', grupo: 'copas_nacionais' },
  { id: 48, nome: 'EFL Cup', pais: 'Inglaterra', regiao: 'Europa', grupo: 'copas_nacionais' },
  { id: 137, nome: 'Coppa Italia', pais: 'Itália', regiao: 'Europa', grupo: 'copas_nacionais' },
  { id: 529, nome: 'DFB Pokal', pais: 'Alemanha', regiao: 'Europa', grupo: 'copas_nacionais' },
  { id: 66, nome: 'Coupe de France', pais: 'França', regiao: 'Europa', grupo: 'copas_nacionais' },
  { id: 96, nome: 'Taça de Portugal', pais: 'Portugal', regiao: 'Europa', grupo: 'copas_nacionais' }
];

const OPCOES_LIGA = [
  { value: 'all', label: 'Todas as Ligas' },
  { value: 'uefa_cups', label: '🏆 Copas Europeias (Champions / Europa / Conference)' },
  { value: 'premier_league', label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League' },
  { value: 'laliga', label: '🇪🇸 LaLiga / LaLiga 2' },
  { value: 'serie', label: '🇮🇹 Serie A / Serie B' },
  { value: 'bundesliga', label: '🇩🇪 Bundesliga / 2. Bundesliga' },
  { value: 'ligue', label: '🇫🇷 Ligue 1 / Ligue 2' },
  { value: 'portugal', label: '🇵🇹 Liga Portugal' },
  { value: 'eredivisie', label: '🇳🇱 Eredivisie (Holanda)' },
  { value: 'turkey', label: '🇹🇷 Turquia (Süper Lig)' },
  { value: 'greece', label: '🇬🇷 Grécia (Super League)' },
  { value: 'brazil', label: '🇧🇷 Brasil (Série A, Série B, Copa do Brasil)' },
  { value: 'argentina', label: '🇦🇷 Argentina (Liga Profesional / Copa de la Liga)' },
  { value: 'colombia', label: '🇨🇴 Colômbia (Primera A)' },
  { value: 'mls', label: '🇺🇸 EUA (MLS)' },
  { value: 'ligamx', label: '🇲🇽 México (Liga MX)' },
  { value: 'chile', label: '🇨🇱 Chile (Primera División)' },
  { value: 'libertadores', label: '🌎 Libertadores / Sul-Americana' },
  { value: 'copas_nacionais', label: '🏆 Copas Nacionais (Copa del Rey, FA Cup, Copa do Brasil)' }
];

const GRUPOS_EQUIVALENTES = {
  laliga: ['laliga', 'laliga_2'],
  serie: ['serie', 'serie_a', 'serie_b'],
  bundesliga: ['bundesliga', 'bundesliga_2'],
  ligue: ['ligue', 'ligue_1', 'ligue_2'],
  libertadores: ['libertadores', 'sudamericana']
};

const TERMOS_VIRTUAIS_LIGA = ['(replays)', 'replays', 'cyber', 'fifa', 'virtual', 'volta', 'esoccer', 'e soccer', 'penalty', 'short football', 'simulated', 'srl'];
const TERMOS_VIRTUAIS_NOME = ['(replays)', 'replays', 'cyber', 'fifa', 'virtual', 'esoccer', 'e soccer', 'short football', 'simulated', 'srl'];

function semAcento(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contemTermo(texto, termos) {
  return termos.some((termo) => {
    const alvo = semAcento(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^| )${alvo}( |$)`).test(texto);
  });
}

function partidaVirtual(textoLiga, textoNome) {
  const liga = semAcento(textoLiga);
  const nome = semAcento(textoNome);
  if (liga && contemTermo(liga, TERMOS_VIRTUAIS_LIGA)) return true;
  if (nome && contemTermo(nome, TERMOS_VIRTUAIS_NOME)) return true;
  return false;
}

function porId(id) {
  return LIGAS_OFICIAIS.find((liga) => liga.id === Number(id)) || null;
}

function paisNoTexto(texto, nomes) {
  return nomes.some((nome) => new RegExp(`(^| )${semAcento(nome)}( |$)`).test(texto));
}

function ligaOficialPorTexto(textoBruto, leagueId) {
  const direta = porId(leagueId);
  if (direta) return direta;
  const texto = semAcento(textoBruto);
  if (!texto || partidaVirtual(texto, '')) return null;
  const tem = (...frases) => frases.some((frase) => {
    const alvo = semAcento(frase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^| )${alvo}( |$)`).test(texto);
  });
  const brasil = paisNoTexto(texto, ['brazil', 'brasil']) || tem('brasileirao', 'brasileiro');
  const italia = paisNoTexto(texto, ['italy', 'italia']);

  if (tem('conference league', 'liga conferencia')) return porId(848);
  if (tem('europa league', 'liga europa')) return porId(3);
  if (tem('champions league', 'liga dos campeoes', 'liga campeoes')) return porId(2);
  if (tem('copa de la liga')) return porId(130);
  if (tem('laliga 2', 'la liga 2', 'segunda division', 'segunda divisao', 'laliga2')) return porId(141);
  if (tem('laliga', 'la liga')) return porId(140);
  if (tem('2 bundesliga', 'ii bundesliga', 'bundesliga 2')) return porId(79);
  if (tem('bundesliga')) return porId(78);
  if (tem('ligue 2')) return porId(62);
  if (tem('ligue 1') || /(^| )league 1( |$)/.test(texto)) return porId(61);
  if (tem('liga portugal', 'primeira liga', 'liga betclic')) return porId(94);
  if (tem('eredivisie')) return porId(88);
  if (tem('copa libertadores') || tem('libertadores')) return porId(13);
  if (tem('sudamericana', 'sul americana', 'sulamericana')) return porId(11);
  if (tem('copa do brasil')) return porId(73);
  if (tem('major league soccer') || /(^| )mls( |$)/.test(texto)) return porId(253);
  if (tem('liga mx')) return porId(262);
  if (tem('liga profesional')) return porId(128);
  if (tem('primera a', 'liga betplay')) return porId(239);
  if (tem('premier league') && !paisNoTexto(texto, ['israel'])) return porId(39);
  if ((tem('super lig') || paisNoTexto(texto, ['turkey', 'turquia'])) && tem('super lig', 'turquia', 'turkey')) return porId(203);
  if (tem('super league', 'superleague') && paisNoTexto(texto, ['greece', 'grecia'])) return porId(197);
  if (tem('primera division') && paisNoTexto(texto, ['chile'])) return porId(265);
  if (tem('serie b')) {
    if (italia) return porId(136);
    if (brasil) return porId(72);
    return null;
  }
  if (tem('serie a') || tem('brasileirao')) {
    if (italia && !brasil) return porId(135);
    if (brasil) return porId(71);
    return null;
  }
  if (tem('copa del rey')) return porId(143);
  if (tem('fa cup')) return porId(45);
  if (tem('efl cup', 'carabao cup', 'carabao')) return porId(48);
  if (tem('coppa italia')) return porId(137);
  if (tem('dfb pokal')) return porId(529);
  if (tem('coupe de france')) return porId(66);
  if (tem('taca de portugal', 'taca portugal')) return porId(96);
  return null;
}

function grupoCompativel(filtro, grupo) {
  if (!filtro || filtro === 'all') return true;
  const aceitos = GRUPOS_EQUIVALENTES[filtro] || [filtro];
  return aceitos.includes(grupo);
}

function grupoDaLiga(texto, leagueId) {
  return ligaOficialPorTexto(texto, leagueId)?.grupo || null;
}

export {
  LIGAS_OFICIAIS,
  OPCOES_LIGA,
  partidaVirtual,
  ligaOficialPorTexto,
  grupoCompativel,
  grupoDaLiga
};
