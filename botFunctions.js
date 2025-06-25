const db = require('./database');
const logger = require('./logger');

async function adicionarJogador(nome, quemAdicionouId, tipoDesejado, chat, message, senderContact, porOutro = false) {
    try {
        const limits = await new Promise((resolve, reject) => {
            db.get('SELECT max_linha, max_goleiros FROM partida_info WHERE id = 1', (err, row) => {
                if (err || !row) return reject(err || new Error('Sem limites encontrados'));
                resolve(row);
            });
        });

        const TabelaVerificar = tipoDesejado === 'linha' ? 'linha' : 'goleiro';
        const LimiteVagas = tipoDesejado === 'linha' ? limits.max_linha : limits.max_goleiros;

        const row = await new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count FROM jogadores WHERE tipo_jogador = ?`, [TabelaVerificar], (err, result) => {
                if (err || !result) return reject(err || new Error('Erro ao contar jogadores'));
                resolve(result);
            });
        });

        let tipoFinal = tipoDesejado;
        let resposta;

        if (row.count >= LimiteVagas) {
            tipoFinal = 'reserva';
            resposta = `Atenção! A lista de ${TabelaVerificar}s está cheia. *${nome}* foi adicionado à *lista de reserva*.`;
        } else {
            resposta = `Boa! *${nome}* foi adicionado à lista de ${TabelaVerificar}s. 👍`;
        }

        if (porOutro) {
            const senderName = (senderContact.pushname || senderContact.name || 'Usuário').substring(0, 10);
            resposta = `${senderName} adicionou *${nome}* à lista de ${tipoFinal}s.`;
        }

        db.run(
            'INSERT INTO jogadores (nome_jogador, adicionado_por, tipo_jogador) VALUES (?, ?, ?)',
            [nome, quemAdicionouId, tipoFinal],
            async (err) => {
                if (err) {
                    logger.error(`Erro ao inserir jogador ${nome}: ${err.message}`);
                    return message.reply("Este nome já está na lista ou ocorreu um erro.");
                }

                try {
                    const contact = await message.getContact();
                    await message.reply(resposta, { mentions: [contact] });
                } catch (e) {
                    logger.warn(`Erro ao mencionar usuário: ${e.message}`);
                    await message.reply(resposta);
                }

                await enviarLista(chat);
            }
        );
    } catch (e) {
        logger.error(`Erro em adicionarJogador: ${e.message}`);
        message.reply("Erro ao processar sua entrada. Tente novamente ou chame o admin.");
    }
}

function promoverReserva(chat, client) {
    logger.info("Verificando se há reservas para promover...");
    db.get('SELECT * FROM jogadores WHERE tipo_jogador = "reserva" ORDER BY id ASC LIMIT 1', [], (err, reserva) => {
        if (err || !reserva) {
            logger.info("Nenhuma reserva para promover.");
            return enviarLista(chat);
        }

        db.get('SELECT max_linha FROM partida_info WHERE id = 1', (err, limits) => {
            if (err || !limits) return;

            db.get('SELECT COUNT(*) as count FROM jogadores WHERE tipo_jogador = "linha"', [], (err, rowLinha) => {
                if (err) return;

                if (rowLinha.count < limits.max_linha) {
                    db.run('UPDATE jogadores SET tipo_jogador = "linha" WHERE id = ?', [reserva.id], (err) => {
                        if (err) return;

                        client.getContactById(reserva.adicionado_por).then(contact => {
                            const nomeResponsavel = contact.pushname || contact.name || '';
                            let msg;
                            if (nomeResponsavel.toLowerCase() === reserva.nome_jogador.toLowerCase()) {
                                msg = `🎉 Parabéns, *@${contact.id.user}*! Você foi promovido da reserva para a lista principal!`;
                            } else {
                                msg = `📢 Atenção, *@${contact.id.user}*! O jogador *${reserva.nome_jogador}* foi promovido para a lista principal!`;
                            }
                            chat.sendMessage(msg, { mentions: [contact] }).then(() => {
                                enviarLista(chat);
                            });
                        }).catch(() => {
                            chat.sendMessage(`📢 Vaga liberada! O jogador *${reserva.nome_jogador}* foi promovido para a lista principal.`);
                            enviarLista(chat);
                        });
                    });
                } else {
                    client.getContactById(reserva.adicionado_por).then(contact => {
                        const nomeResponsavel = contact.pushname || contact.name || '';
                        let msg;
                        if (nomeResponsavel.toLowerCase() === reserva.nome_jogador.toLowerCase()) {
                            msg = `🔔 *@${contact.id.user}*, você é o próximo na reserva. Se não for jogar, digite \`!sair\`.`;
                        } else {
                            msg = `🔔 *@${contact.id.user}*, o jogador *${reserva.nome_jogador}* (adicionado por você) é o próximo da fila.`;
                        }
                        chat.sendMessage(msg, { mentions: [contact] });
                        enviarLista(chat);
                    }).catch(() => {
                        enviarLista(chat);
                    });
                }
            });
        });
    });
}

async function enviarLista(chat) {
    try {
        const [info, jogadoresLinha, goleiros, reservas] = await Promise.all([
            new Promise((resolve, reject) => db.get('SELECT titulo, data_hora, max_linha, max_goleiros FROM partida_info WHERE id = 1', [], (err, row) => err ? reject(err) : resolve(row))),
            new Promise((resolve, reject) => db.all('SELECT * FROM jogadores WHERE tipo_jogador = "linha" ORDER BY id', [], (err, rows) => err ? reject(err) : resolve(rows))),
            new Promise((resolve, reject) => db.all('SELECT * FROM jogadores WHERE tipo_jogador = "goleiro" ORDER BY id', [], (err, rows) => err ? reject(err) : resolve(rows))),
            new Promise((resolve, reject) => db.all('SELECT * FROM jogadores WHERE tipo_jogador = "reserva" ORDER BY id', [], (err, rows) => err ? reject(err) : resolve(rows))),
        ]);

        let texto = `⚽ *${info.titulo}*\n🗓️ *Data:* ${info.data_hora}\n\n`;

        texto += `*Jogadores de Linha (${jogadoresLinha.length}/${info.max_linha})*\n`;
        for (let i = 0; i < info.max_linha; i++) {
            if (i < jogadoresLinha.length) {
                const j = jogadoresLinha[i];
                texto += `${i + 1}. ${j.nome_jogador} - Pgto: ${j.status_pagamento === 1 ? '✅' : '...'}\n`;
            } else {
                texto += `${i + 1}. ...\n`;
            }
        }

        texto += `\n*Goleiros (${goleiros.length}/${info.max_goleiros})*\n`;
        for (let i = 0; i < info.max_goleiros; i++) {
            if (i < goleiros.length) {
                const g = goleiros[i];
                texto += `${i + 1}. ${g.nome_jogador} - Pgto: ${g.status_pagamento === 1 ? '✅' : '...'}\n`;
            } else {
                texto += `${i + 1}. ...\n`;
            }
        }

        if (reservas.length > 0) {
            texto += `\n*Lista de Reserva (${reservas.length})*\n`;
            reservas.forEach(r => {
                texto += `- ${r.nome_jogador} - Pgto: ${r.status_pagamento === 1 ? '✅' : '...'}\n`;
            });
        }

        await chat.sendMessage(texto);
    } catch (e) {
        logger.error(`Erro ao gerar a lista: ${e.stack || e.message}`);
        chat.sendMessage("Erro ao gerar a lista.");
    }
}

module.exports = {
    adicionarJogador,
    promoverReserva,
    enviarLista,
};
