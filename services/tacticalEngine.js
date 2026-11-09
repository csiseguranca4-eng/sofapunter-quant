/**
 * Índice de ritmo e prompt tático para o Gemini.
 * Não consulta rede: só calcula a pontuação e monta o texto.
 */

function validarMedia(nome, valor) {
  const media = Number(valor);
  if (!Number.isFinite(media) || media < 0) {
    throw new Error(`${nome} deve ser uma média numérica maior ou igual a zero.`);
  }
  return media;
}

function arredondar(valor, casas) {
  return Number(valor.toFixed(casas));
}

function classificarRitmo(pontuacao) {
  if (pontuacao >= 22) {
    return {
      classificacao: 'Jogo Aberto / Alta Frequência',
      icone: '🔥',
      selo: 'ritmo intenso'
    };
  }
  if (pontuacao >= 15) {
    return {
      classificacao: 'Ritmo Moderado',
      icone: '⚖️',
      selo: 'equilibrado'
    };
  }
  return {
    classificacao: 'Jogo Travado / Linhas Baixas',
    icone: '🛡️',
    selo: 'truncado'
  };
}

function calcularIndiceRitmo(estatisticas) {
  if (!estatisticas || typeof estatisticas !== 'object') {
    throw new Error('estatisticas deve trazer escanteiosTotais, chutesNoAlvo e posseTercoFinal.');
  }

  const escanteiosTotais = validarMedia('escanteiosTotais', estatisticas.escanteiosTotais);
  const chutesNoAlvo = validarMedia('chutesNoAlvo', estatisticas.chutesNoAlvo);
  const posseTercoFinal = validarMedia('posseTercoFinal', estatisticas.posseTercoFinal);
  const pontuacao = arredondar(
    (escanteiosTotais * 1.2) + (chutesNoAlvo * 1.5) + (posseTercoFinal * 0.1),
    1
  );
  const faixa = classificarRitmo(pontuacao);

  return {
    pontuacao,
    classificacao: faixa.classificacao,
    icone: faixa.icone,
    selo: faixa.selo
  };
}

function textoTatico(valor) {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (!valor || typeof valor !== 'object') return '';
  return Object.values(valor).filter((item) => typeof item === 'string' && item.trim()).join('; ');
}

function resumirEntradas(analiseEV) {
  const lista = Array.isArray(analiseEV && analiseEV.melhoresEntradas)
    ? analiseEV.melhoresEntradas
    : [];
  if (!lista.length) return { linhas: '- Nenhuma seleção com EV positivo.', principal: null };

  const linhas = lista.map((entrada, indice) => {
    const marca = indice === 0 ? 'PRINCIPAL' : 'alternativa';
    const nome = entrada.nome || entrada.mercado || 'Mercado';
    return `- [${marca}] ${nome}: odd casa ${entrada.oddCasa} | odd justa ${entrada.oddJusta} | probabilidade ${entrada.probabilidadeModelo} | margem ${entrada.margemEV} | ${entrada.selo}`;
  }).join('\n');

  return { linhas, principal: lista[0] };
}

function gerarPromptTaticoQuant(dadosJogo, analiseEV) {
  const jogo = dadosJogo && typeof dadosJogo === 'object' ? dadosJogo : {};
  const analise = analiseEV && typeof analiseEV === 'object' ? analiseEV : {};
  const mandante = jogo.mandante || jogo.casa || 'Mandante';
  const visitante = jogo.visitante || jogo.fora || 'Visitante';
  const liga = jogo.liga || jogo.campeonato || 'Liga não informada';
  const estatisticas = jogo.estatisticas
    || (jogo.escanteiosTotais != null ? jogo : null);
  const ritmo = jogo.ritmo || (estatisticas ? calcularIndiceRitmo(estatisticas) : null);
  const { linhas, principal } = resumirEntradas(analise);
  const taticaMandante = textoTatico(jogo.taticaMandante || jogo.mandanteTatico);
  const taticaVisitante = textoTatico(jogo.taticaVisitante || jogo.visitanteTatico);
  const modelo = analise.entradas
    ? `Modelo Poisson: lambda mandante ${analise.entradas.lambdaMandante} | mu visitante ${analise.entradas.muVisitante}`
    : null;
  const nomePrincipal = principal ? (principal.nome || principal.mercado) : 'inexistente';

  return [
    'Você é o Analista Tático Esportivo Quantitativo do SofaPunter.',
    'Responda apenas com um JSON válido. Sem markdown, sem comentários e sem texto fora do JSON.',
    '',
    `Confronto: ${mandante} x ${visitante} | ${liga}`,
    ritmo
      ? `Ritmo combinado: ${ritmo.pontuacao} | ${ritmo.classificacao} ${ritmo.icone} (${ritmo.selo})`
      : 'Ritmo combinado: não informado.',
    estatisticas
      ? `Médias por jogo dos dois times: escanteios ${estatisticas.escanteiosTotais} | chutes no alvo ${estatisticas.chutesNoAlvo} | posse no terço final ${estatisticas.posseTercoFinal}`
      : 'Médias táticas: não informadas.',
    taticaMandante ? `${mandante}: ${taticaMandante}` : null,
    taticaVisitante ? `${visitante}: ${taticaVisitante}` : null,
    modelo,
    '',
    'Seleções +EV já calculadas pelo motor quantitativo. Não recalcule odds nem probabilidades:',
    linhas,
    `Entrada principal: ${nomePrincipal}.`,
    '',
    'Devolva exatamente este JSON:',
    '{"estiloConfronto":"","validacaoTatica":"","scoreConfianca":0,"resumoVisual":""}',
    'estiloConfronto: resumo do casamento de estilos em no máximo 8 palavras.',
    'validacaoTatica: diga se esse casamento apoia ou desaconselha a entrada +EV principal.',
    'scoreConfianca: inteiro de 0 a 100, juntando os dados quantitativos e o contexto tático.',
    'resumoVisual: uma única frase, pronta para badge de card no dashboard.'
  ].filter((linha) => linha != null).join('\n');
}

const MODELOS_GEMINI = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

function cabecalhosGemini(token) {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': String(token || '').trim()
  };
}

module.exports = {
  MODELOS_GEMINI,
  cabecalhosGemini,
  calcularIndiceRitmo,
  gerarPromptTaticoQuant
};

if (require.main === module) {
    console.log("=== TESTE PASSO 3: MOTOR TÁTICO SOFAPUNTER QUANT ===");
    const statsExemplo = {
        escanteiosTotais: 11.2,
        chutesNoAlvo: 9.8,
        posseTercoFinal: 48
    };
    const ritmo = calcularIndiceRitmo(statsExemplo);
    console.log("Ritmo:", ritmo);
}
