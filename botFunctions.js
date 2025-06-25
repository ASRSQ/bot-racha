// botFunctions.js
const db = require('./database');
const logger = require('./logger');

function adicionarJogador(nome, quemAdicionouId, tipoDesejado, chat, message, senderContact, porOutro = false) {
    db.get('SELECT max_linha, max_goleiros FROM partida_info WHERE id = 1', (err, limits) => {
        if (err || !limits) {
            logger.error(`Não foi possível buscar os limites de vagas: ${err ? err.message : 'Nenhum limite encontrado'}`);
            return message.reply("Erro: Não foi possível verificar as vagas. Avise o admin.", { mentions: [senderContact] });
        }
        const TabelaVerificar = tipoDesejado === 'linha' ? 'linha' : 'goleiro';
        const LimiteVagas = tipoDesejado === 'linha' ? limits.max_linha : limits.max_goleiros;
        db.get(`SELECT COUNT(*) as count FROM jogadores WHERE tipo_jogador = ?`, [TabelaVerificar], (err, row) => {
            if (err) { logger.error(err.message); return; }
            if (typeof row === 'undefined' || typeof row.count === 'undefined') { logger.error(`Resultado inesperado da contagem: ${row}`); return; }
            
            let tipoFinal = tipoDesejado;
            let resposta;
            if (row.count >= LimiteVagas) {
                tipoFinal = 'reserva';
                resposta = `Atenção! A lista de ${TabelaVerificar}s está cheia. *${nome}* foi adicionado à *lista de reserva*.`;
            } else {
                resposta = `Boa! *${nome}* foi adicionado à lista de ${TabelaVerificar}s. 👍`;
            }
            if(porOutro) {
                const senderName = (senderContact.pushname || senderContact.name).substring(0, 10);
                resposta = `${senderName} adicionou *${nome}* à lista de ${tipoFinal}s.`
            }

            db.run('INSERT INTO jogadores (nome_jogador, adicionado_por, tipo_jogador) VALUES (?, ?, ?)', [nome, quemAdicionouId, tipoFinal], (err) => {
                if (err) {
                    logger.error(`Erro ao inserir jogador ${nome}: ${err.message}`);
                    return message.reply("Este nome já está na lista ou ocorreu um erro.", { mentions: [senderContact] });
                }
                message.reply(resposta, { mentions: [senderContact] }).then(() => {
                    enviarLista(chat);
                });
            });
        });
    });
}

function promoverReserva(chat, client) {
    logger.info("Verificando se há reservas para promover...");
    db.get('SELECT * FROM jogadores WHERE tipo_jogador = "reserva" ORDER BY id ASC LIMIT 1', [], (err, reserva) => {
        if (err) { logger.error(`Erro ao buscar reserva: ${err.message}`); return; }
        if (!reserva) {
            logger.info("Nenhum jogador na lista de reserva para promover.");
            return enviarLista(chat);
        }
        db.get('SELECT max_linha FROM partida_info WHERE id = 1', (err, limits) => {
            if (err || !limits) { logger.error(`Erro ao buscar limites para promoção: ${err ? err.message : 'Nenhum limite encontrado'}`); return; }
            db.get('SELECT COUNT(*) as count FROM jogadores WHERE tipo_jogador = "linha"', [], (err, rowLinha) => {
                if (err) { logger.error(`Erro ao contar jogadores de linha para promoção: ${err.message}`); return; }
                if (rowLinha.count < limits.max_linha) {
                    db.run('UPDATE jogadores SET tipo_jogador = "linha" WHERE id = ?', [reserva.id], (err) => {
                        if (err) { logger.error(`Erro ao promover ${reserva.nome_jogador}: ${err.message}`); return; }
                        logger.info(`Jogador ${reserva.nome_jogador} promovido para a lista principal.`);
                        const responsavelId = reserva.adicionado_por;
                        client.getContactById(responsavelId).then(contact => {
                            const nomeResponsavel = contact.pushname || contact.name;
                            let promotionMessage;
                            if (nomeResponsavel.toLowerCase() === reserva.nome_jogador.toLowerCase()) {
                                promotionMessage = `🎉 Parabéns, *@${contact.id.user}*! Você foi promovido da reserva para a lista principal! Prepare a chuteira!`;
                            } else {
                                promotionMessage = `📢 Atenção, *@${contact.id.user}*! O jogador *${reserva.nome_jogador}* (adicionado por você) foi promovido para a lista principal!`;
                            }
                            chat.sendMessage(promotionMessage, { mentions: [contact] }).then(() => {
                                enviarLista(chat);
                            });
                        }).catch(e => {
                            logger.error(`Não foi possível buscar o contato para a notificação de promoção: ${e.message}`);
                            chat.sendMessage(`📢 Vaga liberada! O jogador *${reserva.nome_jogador}* foi promovido da reserva para a lista principal!`);
                            enviarLista(chat);
                        });
                    });
                } else {
                    logger.info(`Nenhuma vaga disponível. Notificando o próximo da reserva: ${reserva.nome_jogador}`);
                    const responsavelId = reserva.adicionado_por;
                    client.getContactById(responsavelId).then(contact => {
                        const nomeResponsavel = contact.pushname || contact.name;
                        let notificacao;
                        if (nomeResponsavel.toLowerCase() === reserva.nome_jogador.toLowerCase()) {
                            notificacao = `🔔 Atenção, *@${contact.id.user}*! Você é o próximo na lista de reserva. Se não for mais jogar, digite \`!sair\` para liberar seu lugar na fila.`;
                        } else {
                            notificacao = `🔔 Atenção, *@${contact.id.user}*! O jogador *${reserva.nome_jogador}* (adicionado por você) é o próximo da fila.\n\nCaso ele não vá mais, use o comando \`!remover ${reserva.nome_jogador}\` para liberar o lugar.`;
                        }
                        chat.sendMessage(notificacao, { mentions: [contact] });
                    }).catch(e => logger.error(`Não foi possível buscar o contato ${responsavelId} para notificar. Erro: ${e.message}`));
                    enviarLista(chat);
                }
            });
        });
    });
}

async function enviarLista(chat) {
    try {
        const getInfo = new Promise((resolve, reject) => { db.get('SELECT titulo, data_hora, max_linha, max_goleiros FROM partida_info WHERE id = 1', [], (err, row) => { if (err) return reject(err); resolve(row || { titulo: 'Racha', data_hora: 'A definir', max_linha: 22, max_goleiros: 2 }); }); });
        const getLinha = new Promise((resolve, reject) => { db.all('SELECT * FROM jogadores WHERE tipo_jogador = "linha" ORDER BY id', [], (err, rows) => { if (err) reject(err); else resolve(rows); }); });
        const getGoleiros = new Promise((resolve, reject) => { db.all('SELECT * FROM jogadores WHERE tipo_jogador = "goleiro" ORDER BY id', [], (err, rows) => { if (err) reject(err); else resolve(rows); }); });
        const getReservas = new Promise((resolve, reject) => { db.all('SELECT * FROM jogadores WHERE tipo_jogador = "reserva" ORDER BY id', [], (err, rows) => { if (err) reject(err); else resolve(rows); }); });
        
        const [info, jogadoresLinha, goleiros, reservas] = await Promise.all([ getInfo, getLinha, getGoleiros, getReservas ]);
        let listaFormatada = `⚽ *${info.titulo}*\n🗓️ *Data:* ${info.data_hora}\n\n`;
        listaFormatada += `*Jogadores de Linha (${jogadoresLinha.length}/${info.max_linha})*\n`;
        for (let i = 0; i < info.max_linha; i++) {
            if (i < jogadoresLinha.length) {
                const jogador = jogadoresLinha[i];
                const pago = jogador.status_pagamento === 1 ? '✅' : '...';
                listaFormatada += `${i + 1}. ${jogador.nome_jogador} - Pgto: ${pago}\n`;
            } else { listaFormatada += `${i + 1}. ...\n`; }
        }
        listaFormatada += `\n*Goleiros (${goleiros.length}/${info.max_goleiros})*\n`;
        for (let i = 0; i < info.max_goleiros; i++) {
            if (i < goleiros.length) {
                const goleiro = goleiros[i];
                const pago = goleiro.status_pagamento === 1 ? '✅' : '...';
                listaFormatada += `${i + 1}. ${goleiro.nome_jogador} - Pgto: ${pago}\n`;
            } else { listaFormatada += `${i + 1}. ...\n`; }
        }
        if (reservas.length > 0) {
            listaFormatada += `\n*Lista de Reserva (${reservas.length})*\n`;
            reservas.forEach(reserva => {
                const pago = reserva.status_pagamento === 1 ? '✅' : '...';
                listaFormatada += `- ${reserva.nome_jogador} - Pgto: ${pago}\n`;
            });
        }
        await chat.sendMessage(listaFormatada);
    } catch (err) {
        logger.error(`Erro ao gerar a lista: ${err.stack || err.message}`);
        chat.sendMessage("Ocorreu um erro ao tentar gerar a lista.");
    }
}

module.exports = {
    adicionarJogador,
    promoverReserva,
    enviarLista,
};