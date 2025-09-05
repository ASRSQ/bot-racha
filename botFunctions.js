// botFunctions.js
const db = require('./database');
const logger = require('./logger');

/**
 * Fila simples (concurrency = 1) sem dependências externas.
 * Executa as tarefas em série; erros são logados e a fila continua.
 */
class SimpleQueue {
  constructor() {
    this.chain = Promise.resolve();
  }
  add(taskFn) {
    this.chain = this.chain
      .then(() => taskFn())
      .catch(err => {
        logger.error(`Erro em tarefa da fila: ${err && err.stack ? err.stack : err}`);
      });
    return this.chain;
  }
}

const queue = new SimpleQueue();

async function addToQueue(taskFn) {
  return queue.add(taskFn);
}

/* =========================================================================
   ---------------------- FUNÇÕES INTERNAS (lógicas) -----------------------
   ========================================================================= */

/**
 * Adiciona um jogador como linha/goleiro ou manda para a reserva se cheio.
 * Se porOutro=true, ajusta a mensagem informando quem adicionou.
 */
function adicionarJogadorInterno(nome, quemAdicionouId, tipoDesejado, chat, message, senderName, porOutro = false) {
  db.get('SELECT max_linha, max_goleiros FROM partida_info WHERE id = 1', (err, limits) => {
    if (err || !limits) {
      logger.error(`Não foi possível buscar os limites de vagas: ${err ? err.message : 'Nenhum limite encontrado'}`);
      return message.reply("Erro: Não foi possível verificar as vagas. Avise o admin.");
    }

    const tabelaVerificar = (tipoDesejado === 'linha') ? 'linha' : 'goleiro';
    const limiteVagas = (tipoDesejado === 'linha') ? limits.max_linha : limits.max_goleiros;

    db.get(`SELECT COUNT(*) as count FROM jogadores WHERE tipo_jogador = ?`, [tabelaVerificar], (err2, row) => {
      if (err2) { logger.error(err2.message); return; }
      if (!row || typeof row.count === 'undefined') {
        logger.error(`Resultado inesperado da contagem: ${row}`);
        return;
      }

      let tipoFinal = tipoDesejado;
      let resposta;
      if (row.count >= limiteVagas) {
        tipoFinal = 'reserva';
        resposta = `Atenção! A lista de ${tabelaVerificar}s está cheia. *${nome}* foi adicionado à *lista de reserva*.`;
      } else {
        resposta = `Boa! *${nome}* foi adicionado à lista de ${tabelaVerificar}s. 👍`;
      }
      if (porOutro) {
        resposta = `${senderName} adicionou *${nome}* à lista de ${tipoFinal}s.`;
      }

      db.run(
        'INSERT INTO jogadores (nome_jogador, adicionado_por, tipo_jogador) VALUES (?, ?, ?)',
        [nome, quemAdicionouId, tipoFinal],
        (err3) => {
          if (err3) {
            logger.error(`Erro ao inserir jogador ${nome}: ${err3.message}`);
            return message.reply("Este nome já está na lista ou ocorreu um erro.");
          }
          // Atualiza lista dentro da mesma tarefa para manter ordem
          enviarListaInterno(chat);
        }
      );

      message.reply(resposta);
    });
  });
}

/**
 * Promove o primeiro reserva para a lista principal quando houver vaga
 * ou notifica o próximo da fila se ainda não houver.
 */
function promoverReservaInterno(chat, client) {
  logger.info("Verificando se há reservas para promover...");

  db.get('SELECT * FROM jogadores WHERE tipo_jogador = "reserva" ORDER BY id ASC LIMIT 1', [], (err, reserva) => {
    if (err) { logger.error(`Erro ao buscar reserva: ${err.message}`); return; }
    if (!reserva) {
      logger.info("Nenhum jogador na lista de reserva para promover.");
      return enviarListaInterno(chat);
    }

    db.get('SELECT max_linha FROM partida_info WHERE id = 1', (err2, limits) => {
      if (err2 || !limits) {
        logger.error(`Erro ao buscar limites para promoção: ${err2 ? err2.message : 'Nenhum limite encontrado'}`);
        return;
      }

      db.get('SELECT COUNT(*) as count FROM jogadores WHERE tipo_jogador = "linha"', [], (err3, rowLinha) => {
        if (err3) { logger.error(`Erro ao contar jogadores de linha: ${err3.message}`); return; }

        if (rowLinha.count < limits.max_linha) {
          // Promove o primeiro da reserva
          db.run('UPDATE jogadores SET tipo_jogador = "linha" WHERE id = ?', [reserva.id], (err4) => {
            if (err4) { logger.error(`Erro ao promover ${reserva.nome_jogador}: ${err4.message}`); return; }
            logger.info(`Jogador ${reserva.nome_jogador} promovido para a lista principal.`);

            const responsavelId = reserva.adicionado_por;
            client.getContactById(responsavelId).then(contact => {
              const nomeResponsavel = contact.pushname || contact.name || '';
              const mentionId = contact.id?._serialized; // ex: '558896091894@c.us'

              let promotionMessage;
              if ((nomeResponsavel || '').toLowerCase() === (reserva.nome_jogador || '').toLowerCase()) {
                promotionMessage = `🎉 Parabéns, *@${contact.id.user}*! Você foi promovido da reserva para a lista principal! Prepare a chuteira!`;
              } else {
                promotionMessage = `📢 Atenção, *@${contact.id.user}*! O jogador *${reserva.nome_jogador}* (adicionado por você) foi promovido para a lista principal!`;
              }

              if (mentionId) {
                chat.sendMessage(promotionMessage, { mentions: [mentionId] }).then(() => {
                  enviarListaInterno(chat);
                });
              } else {
                chat.sendMessage(promotionMessage).then(() => enviarListaInterno(chat));
              }
            }).catch(e => {
              logger.error(`Não foi possível buscar o contato para a notificação de promoção: ${e.message}`);
              chat.sendMessage(`📢 Vaga liberada! O jogador *${reserva.nome_jogador}* foi promovido da reserva para a lista principal!`);
              enviarListaInterno(chat);
            });
          });
        } else {
          // Sem vaga ainda: notifica o próximo da fila
          logger.info(`Nenhuma vaga disponível. Notificando o próximo da reserva: ${reserva.nome_jogador}`);
          const responsavelId = reserva.adicionado_por;

          client.getContactById(responsavelId).then(contact => {
            const nomeResponsavel = contact.pushname || contact.name || '';
            const mentionId = contact.id?._serialized; // ex: '558896091894@c.us'
            let notificacao;

            if ((nomeResponsavel || '').toLowerCase() === (reserva.nome_jogador || '').toLowerCase()) {
              notificacao = `🔔 Atenção, *@${contact.id.user}*! Você é o próximo na lista de reserva. Se não for mais jogar, digite \`!sair\` para liberar seu lugar na fila.`;
            } else {
              notificacao = `🔔 Atenção, *@${contact.id.user}*! O jogador *${reserva.nome_jogador}* (adicionado por você) é o próximo da fila.\n\nCaso ele não vá mais, use o comando \`!remover ${reserva.nome_jogador}\` para liberar o lugar.`;
            }

            if (mentionId) {
              chat.sendMessage(notificacao, { mentions: [mentionId] });
            } else {
              chat.sendMessage(notificacao);
            }
          }).catch(e => {
            logger.error(`Não foi possível buscar o contato ${responsavelId} para notificar. Erro: ${e.message}`);
          });

          enviarListaInterno(chat);
        }
      });
    });
  });
}

/**
 * Monta e envia a lista formatada de linha/goleiros/reservas.
 */
async function enviarListaInterno(chat) {
  try {
    const getInfo = new Promise((resolve, reject) => {
      db.get(
        'SELECT titulo, data_hora, max_linha, max_goleiros FROM partida_info WHERE id = 1',
        [],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || { titulo: 'Racha', data_hora: 'A definir', max_linha: 22, max_goleiros: 2 });
        }
      );
    });

    const getLinha = new Promise((resolve, reject) => {
      db.all('SELECT * FROM jogadores WHERE tipo_jogador = "linha" ORDER BY id', [], (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });

    const getGoleiros = new Promise((resolve, reject) => {
      db.all('SELECT * FROM jogadores WHERE tipo_jogador = "goleiro" ORDER BY id', [], (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });

    const getReservas = new Promise((resolve, reject) => {
      db.all('SELECT * FROM jogadores WHERE tipo_jogador = "reserva" ORDER BY id', [], (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });

    const [info, jogadoresLinha, goleiros, reservas] = await Promise.all([
      getInfo, getLinha, getGoleiros, getReservas
    ]);

    let listaFormatada = `⚽ *${info.titulo}*\n🗓️ *Data:* ${info.data_hora}\n\n`;

    listaFormatada += `*Jogadores de Linha (${jogadoresLinha.length}/${info.max_linha})*\n`;
    for (let i = 0; i < info.max_linha; i++) {
      if (i < jogadoresLinha.length) {
        const jogador = jogadoresLinha[i];
        const pago = jogador.status_pagamento === 1 ? '✅' : '...';
        const nomeExibido = jogador.nome_jogador.length > 10
          ? jogador.nome_jogador.slice(0, 10) + '…'
          : jogador.nome_jogador;
        listaFormatada += `${i + 1}. ${nomeExibido} - Pgto: ${pago}\n`;
      } else {
        listaFormatada += `${i + 1}. ...\n`;
      }
    }

    listaFormatada += `\n*Goleiros (${goleiros.length}/${info.max_goleiros})*\n`;
    for (let i = 0; i < info.max_goleiros; i++) {
      if (i < goleiros.length) {
        const goleiro = goleiros[i];
        const pago = goleiro.status_pagamento === 1 ? '✅' : '...';
        const nomeExibido = goleiro.nome_jogador.length > 10
          ? goleiro.nome_jogador.slice(0, 10) + '…'
          : goleiro.nome_jogador;
        listaFormatada += `${i + 1}. ${nomeExibido} - Pgto: ${pago}\n`;
      } else {
        listaFormatada += `${i + 1}. ...\n`;
      }
    }

    if (reservas.length > 0) {
      listaFormatada += `\n*Lista de Reserva (${reservas.length})*\n`;
      reservas.forEach(reserva => {
        const pago = reserva.status_pagamento === 1 ? '✅' : '...';
        const nomeExibido = reserva.nome_jogador.length > 10
          ? reserva.nome_jogador.slice(0, 10) + '…'
          : reserva.nome_jogador;
        listaFormatada += `- ${nomeExibido} - Pgto: ${pago}\n`;
      });
    }

    await chat.sendMessage(listaFormatada);
  } catch (err) {
    logger.error(`Erro ao gerar a lista: ${err.stack || err.message}`);
    chat.sendMessage("Ocorreu um erro ao tentar gerar a lista.");
  }
}

/* =========================================================================
   ------------------------ FUNÇÕES PÚBLICAS (API) -------------------------
   ========================================================================= */

function adicionarJogador(...args) {
  return addToQueue(() => Promise.resolve(adicionarJogadorInterno(...args)));
}
function promoverReserva(...args) {
  return addToQueue(() => Promise.resolve(promoverReservaInterno(...args)));
}
function enviarLista(...args) {
  return addToQueue(() => Promise.resolve(enviarListaInterno(...args)));
}

module.exports = {
  adicionarJogador,
  promoverReserva,
  enviarLista,
};
