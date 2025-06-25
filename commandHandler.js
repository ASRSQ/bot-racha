const db = require('./database');
const logger = require('./logger');
const config = require('./config');
const { adicionarJogador, promoverReserva, enviarLista } = require('./botFunctions');

async function handleCommand(client, message) {
    const chat = await message.getChat();
    if (!chat.isGroup) return;

    const body = message.body.trim();
    const command = body.toLowerCase();
    const sender = await message.getContact();

    const senderId = sender?.id?._serialized || null;
    const senderName = sender?.pushname || sender?.name || 'Desconhecido';
    const isSenderAdmin = senderId && config.ADMINS.includes(senderId);

    let replyOptions = {};
    try {
        const validContact = await client.getContactById(senderId);
        replyOptions.mentions = [validContact];
    } catch (e) {
        logger.warn(`Contato inválido para menção: ${e.message}`);
    }

    logger.info(`[FILA: PROCESSANDO] [GRUPO: ${chat.name}] [USER: ${senderName}] Mensagem: "${body}"`);

    try {
        if (command.startsWith('!entrar')) {
            const nomeParaAdicionar = senderName.substring(0, 10);
            if ((sender.pushname || sender.name).length > 10) {
                await message.reply(`Seu nome de perfil é muito longo. Você será adicionado como *${nomeParaAdicionar}*.`, replyOptions);
            }
            const tipoDesejado = command.includes('goleiro') ? 'goleiro' : 'linha';
            db.get('SELECT 1 FROM jogadores WHERE nome_jogador = ?', [nomeParaAdicionar], (err, row) => {
                if (err) return message.reply("Erro ao consultar o banco de dados.", replyOptions);
                if (row) return message.reply(`${nomeParaAdicionar}, você já está na lista! 😉`, replyOptions);
                adicionarJogador(nomeParaAdicionar, senderId, tipoDesejado, chat, message, sender);
            });
        }

        else if (command === '!sair') {
            const nomeFormatado = senderName.substring(0, 10);
            db.get('SELECT tipo_jogador FROM jogadores WHERE nome_jogador = ?', [nomeFormatado], (err, row) => {
                if (err) return message.reply("Erro ao consultar o banco de dados.", replyOptions);
                if (!row) return message.reply(`${senderName}, você não estava na lista.`, replyOptions);
                const eraVagaPrincipal = row.tipo_jogador === 'linha' || row.tipo_jogador === 'goleiro';

                db.run('DELETE FROM jogadores WHERE nome_jogador = ?', [nomeFormatado], function(err) {
                    if (err) return message.reply("Erro ao tentar te remover da lista.", replyOptions);
                    message.reply(`Ok, ${senderName}, você foi removido(a) da lista.`, replyOptions);
                    if (eraVagaPrincipal) {
                        promoverReserva(chat, client);
                    } else {
                        enviarLista(chat);
                    }
                });
            });
        }

        else if (command.startsWith('!remover')) {
            const nomeRemover = body.substring(9).trim();
            if (!nomeRemover) return message.reply('Uso correto: `!remover <nome do jogador>`', replyOptions);

            db.get('SELECT adicionado_por, tipo_jogador FROM jogadores WHERE nome_jogador LIKE ?', [`%${nomeRemover}%`], (err, row) => {
                if (err) return message.reply("Erro ao consultar o banco de dados.", replyOptions);
                if (!row) return message.reply(`Jogador "${nomeRemover}" não encontrado na lista.`, replyOptions);

                const permitidoRemover = isSenderAdmin || row.adicionado_por === senderId;
                if (!permitidoRemover) {
                    return message.reply(`❌ Você não pode remover *${nomeRemover}*. Peça ao responsável ou a um admin.`, replyOptions);
                }

                const eraVagaPrincipal = row.tipo_jogador === 'linha' || row.tipo_jogador === 'goleiro';
                db.run('DELETE FROM jogadores WHERE nome_jogador LIKE ?', [`%${nomeRemover}%`], function(err) {
                    if (err) return message.reply("Erro ao remover jogador.", replyOptions);
                    message.reply(`Ok, o jogador *${nomeRemover}* foi removido da lista por ${senderName}.`, replyOptions);
                    if (eraVagaPrincipal) {
                        promoverReserva(chat, client);
                    } else {
                        enviarLista(chat);
                    }
                });
            });
        }

        else if (command.startsWith('!add')) {
            const args = body.split(' ').slice(1);
            let tipoJogadorAvulso = 'linha';
            let nomeJogadorAvulso;

            if (args.length > 1 && args[args.length - 1].toLowerCase() === 'goleiro') {
                tipoJogadorAvulso = 'goleiro';
                nomeJogadorAvulso = args.slice(0, -1).join(' ');
            } else {
                nomeJogadorAvulso = args.join(' ');
            }

            if (!nomeJogadorAvulso) return message.reply('Nome inválido. Uso: `!add <nome> [goleiro]`', replyOptions);
            if (nomeJogadorAvulso.length > 10) return message.reply(`❌ Nome muito longo. Use até 10 caracteres.`, replyOptions);

            db.get('SELECT 1 FROM jogadores WHERE nome_jogador = ?', [nomeJogadorAvulso], (err, row) => {
                if (err) return message.reply("Erro ao consultar o banco de dados.", replyOptions);
                if (row) return message.reply(`${nomeJogadorAvulso} já está na lista!`, replyOptions);
                adicionarJogador(nomeJogadorAvulso, senderId, tipoJogadorAvulso, chat, message, sender, true);
            });
        }

        else if (command === '!lista') {
            await enviarLista(chat);
        }

        else if (command === '!pix' || command === '!pagar') {
            const pixMessage = `*💸 Dados para Pagamento do Racha 💸*\n\n*Valor:* R$ ${config.PIX_VALUE}\n\n*Chave PIX:*\n\`${config.PIX_KEY}\`\n\n_Após pagar, avise um admin para confirmar sua presença na lista!_ ✅`;
            await message.reply(pixMessage, replyOptions);
        }

        else if (command === '!ajuda' || command === '!comandos') {
            let helpMessage = `*🤖 Comandos do Bot do Racha 🤖*\n\n`;
            helpMessage += `*!entrar [goleiro]* – Entra na lista principal ou como goleiro\n`;
            helpMessage += `*!sair* – Remove seu nome da lista\n`;
            helpMessage += `*!add <nome> [goleiro]* – Adiciona um amigo\n`;
            helpMessage += `*!remover <nome>* – Remove alguém que você adicionou\n`;
            helpMessage += `*!lista* – Mostra a lista atual\n`;
            helpMessage += `*!pix* – Dados do pagamento\n`;

            if (isSenderAdmin) {
                helpMessage += `\n*👑 Comandos de Admin:*\n`;
                helpMessage += `!pagou <nome | número>\n!setvagas <linha> <goleiros>\n!settitulo <texto>\n!setdata <texto>\n!limpar\n`;
            }

            await message.reply(helpMessage);
        }

        // ADMIN ONLY
        else if (['!pagou', '!setdata', '!settitulo', '!limpar', '!setvagas'].some(cmd => command.startsWith(cmd))) {
            if (!isSenderAdmin) return message.reply('❌ Apenas administradores podem usar este comando.', replyOptions);

            if (command.startsWith('!pagou')) {
                const identificador = body.substring(7).trim();
                const numero = parseInt(identificador, 10);

                if (!identificador) return message.reply('Uso: `!pagou <nome ou número>`', replyOptions);

                if (!isNaN(numero)) {
                    db.all('SELECT id, nome_jogador FROM jogadores WHERE tipo_jogador = "linha" ORDER BY id', [], (err, rows) => {
                        if (err) return message.reply("Erro ao consultar a lista.");
                        const jogador = rows[numero - 1];
                        if (!jogador) return message.reply(`Número inválido. Máximo: ${rows.length}`);
                        db.run('UPDATE jogadores SET status_pagamento = 1 WHERE id = ?', [jogador.id], (err) => {
                            if (err) return message.reply("Erro ao confirmar pagamento.");
                            message.reply(`Pagamento de *${jogador.nome_jogador}* confirmado! ✅`);
                            enviarLista(chat);
                        });
                    });
                } else {
                    db.run('UPDATE jogadores SET status_pagamento = 1 WHERE nome_jogador LIKE ?', [`%${identificador}%`], function(err) {
                        if (err || this.changes === 0) return message.reply(`Não encontrei o jogador "${identificador}".`);
                        message.reply(`Pagamento de *${identificador}* confirmado! ✅`);
                        enviarLista(chat);
                    });
                }
            }

            else if (command.startsWith('!setvagas')) {
                const [linha, goleiros] = body.split(' ').slice(1).map(Number);
                if (isNaN(linha) || isNaN(goleiros)) return message.reply('Uso: `!setvagas <linha> <goleiros>`', replyOptions);
                db.run('UPDATE partida_info SET max_linha = ?, max_goleiros = ? WHERE id = 1', [linha, goleiros], (err) => {
                    if (err) return message.reply('Erro ao atualizar vagas.', replyOptions);
                    message.reply(`✅ Vagas atualizadas!\n*Linha:* ${linha}\n*Goleiros:* ${goleiros}`, replyOptions);
                    enviarLista(chat);
                });
            }

            else if (command.startsWith('!settitulo')) {
                const titulo = body.substring(11).trim();
                db.run('UPDATE partida_info SET titulo = ? WHERE id = 1', [titulo], (err) => {
                    if (err) return message.reply('Erro ao definir título.', replyOptions);
                    message.reply(`Título atualizado para: *${titulo}*`, replyOptions);
                    enviarLista(chat);
                });
            }

            else if (command.startsWith('!setdata')) {
                const data = body.substring(9).trim();
                db.run('UPDATE partida_info SET data_hora = ? WHERE id = 1', [data], (err) => {
                    if (err) return message.reply('Erro ao definir data.', replyOptions);
                    message.reply(`Data atualizada para: *${data}*`, replyOptions);
                    enviarLista(chat);
                });
            }

            else if (command === '!limpar') {
                db.run('DELETE FROM jogadores', [], (err) => {
                    if (err) return message.reply('Erro ao limpar lista.', replyOptions);
                    message.reply('Lista de jogadores zerada! 🧹', replyOptions);
                    enviarLista(chat);
                });
            }
        }

    } catch (err) {
        logger.error(`Erro fatal no processamento da mensagem: ${err.stack || err.message}`);
        await message.reply("Erro interno ao processar comando. Avise o admin.", replyOptions);
    }
}

module.exports = { handleCommand };
