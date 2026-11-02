import WebSocket from 'ws';

/**
 * Conecta ao push-server-v2 da 1win e busca todos os mercados de um jogo por matchId
 * @param {string|number} matchId ID numérico da partida (ex: 41735149)
 * @returns {Promise<Array>} Lista de todos os mercados com odds reais
 */
function fetch1WinMatchOdds(matchId) {
  return new Promise((resolve, reject) => {
    const wsUrl = 'wss://api-gateway.top-parser.com/push-server-v2/?Language=pt-BR&externalPartnerId=44ba10e5-7df2-47ab-a44d-dc93803c7a6e&EIO=4&transport=websocket';

    const ws = new WebSocket(wsUrl, {
      headers: {
        'Origin': 'https://1win.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('Timeout ao aguardar resposta do WebSocket da 1win'));
    }, 10000);

    ws.on('open', () => {
      // Handshake inicial do Engine.IO / Socket.IO
      ws.send('40');
    });

    ws.on('message', (data) => {
      const msg = data.toString();

      // Quando o servidor aceita a conexão inicial (começa com 40)
      if (msg.startsWith('40')) {
        // Envia a subscrição exata das odds do jogo
        const subscribePayload = `42["subscribe",{"messageType":"subscribe-match-odds","data":{"matchIds":[${matchId}],"isBaseOddsGroups":false}}]`;
        ws.send(subscribePayload);
        return;
      }

      // Se o servidor pedir ping/heartbeat (pacote 2), responde pong (pacote 3)
      if (msg === '2') {
        ws.send('3');
        return;
      }

      // Verifica mensagens de dados (prefixo 42)
      if (msg.startsWith('42')) {
        try {
          const jsonContent = JSON.parse(msg.substring(2));
          const [event, payload] = jsonContent;

          if (event === 'u' && payload?.messageType === 'match-odds-snapshot') {
            clearTimeout(timeout);
            ws.close();

            const parsedMarkets = parseOddsGroups(payload.data?.oddsGroups || []);
            resolve(parsedMarkets);
          }
        } catch (err) {
          // Ignora mensagens que não sejam o snapshot principal
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Mapeia a árvore de oddsGroups para uma lista plana e limpa de mercados
 */
function parseOddsGroups(oddsGroups) {
  const result = [];

  for (const group of oddsGroups) {
    const marketName = group.name; // Ex: "Handicap", "Resultado do tempo regulamentar", "Ambos os times marcarão"
    const oddsList = group.oddsList || [];

    for (const odd of oddsList) {
      if (odd.status === 1 && odd.cf) {
        result.push({
          market: marketName,
          selection: odd.name,      // Ex: "Fluminense FC 0", "SC Internacional 0"
          odd: parseFloat(odd.cf),  // Ex: 1.36
          outcome: odd.outcome,     // "1", "2", "X"
          id: odd.id
        });
      }
    }
  }

  return result;
}

export { fetch1WinMatchOdds };