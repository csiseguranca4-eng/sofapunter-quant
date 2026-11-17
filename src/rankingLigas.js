import arquivo from '../data/ranking_ligas.json';

export const LIGAS_RANKING = Array.isArray(arquivo?.ranking) ? arquivo.ranking : [];
