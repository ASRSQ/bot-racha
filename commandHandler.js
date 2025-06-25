// commandHandler.js
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
    const senderId = sender.id._serialized;
    const senderName = sender.pushname || sender.name;
    const isSenderAdmin = config.ADMINS.includes(senderId);
    

    logger.info(`[GRUPO: ${chat.name}] [USER: ${senderName}] Mensagem: "${body}"`);

    try {
        if (command.startsWith('!entrar')) {
            const tipoDesejado = command.includes('goleiro') ? 'goleiro' : 'linha';
            db.get('SELECT 1 FROM jogadores WHERE nome_jogador = ?', [senderName], (err, row) => {
                if (err) { logger.error(err.message); return message.reply("Erro ao consultar o banco de dados."); }
                if (row) return message.reply(`${senderName}, você já está na lista! 😉`);
                adicionarJogador(senderName, senderId, tipoDesejado, chat, message, senderName);
            });
        }
        else if (command === '!sair') {
            logger.info(`Usuário ${senderName} tentando sair da lista.`);
            db.get('SELECT tipo_jogador FROM jogadores WHERE nome_jogador = ?', [senderName], (err, row) => {
                if (err) { logger.error(err.message); return message.reply("Erro ao consultar o banco de dados."); }
                if (!row) return message.reply(`${senderName}, você não estava na lista.`);
                const eraVagaPrincipal = (row.tipo_jogador === 'linha' || row.tipo_jogador === 'goleiro');
                db.run('DELETE FROM jogadores WHERE nome_jogador = ?', [senderName], function(err) {
                    if (err) { logger.error(err.message); return message.reply("Erro ao tentar te remover da lista."); }
                    if (this.changes > 0) {
                        message.reply(`Ok, ${senderName}, você foi removido(a) da lista.`);
                        logger.info(`Usuário ${senderName} saiu da lista.`);
                        if (eraVagaPrincipal) { promoverReserva(chat, client); } 
                        else { enviarLista(chat); }
                    }
                });
            });
        }
       else if (command.startsWith('!remover')) {
    const argumento = body.substring(9).trim();
    if (!argumento) return message.reply('Uso correto: `!remover <nome|número> [goleiro]`');

    const partes = argumento.split(' ');
    const indiceOuNome = partes[0];
    const isGoleiro = partes.length > 1 && partes[1].toLowerCase() === 'goleiro';

    const numeroRemover = parseInt(indiceOuNome, 10);

    if (!isNaN(numeroRemover) && numeroRemover > 0) {
        // ✅ Remover por número
        const tipo = isGoleiro ? 'goleiro' : 'linha';
        db.all('SELECT * FROM jogadores WHERE tipo_jogador = ? ORDER BY id', [tipo], (err, jogadores) => {
            if (err) return message.reply("Erro ao consultar o banco de dados.");
            if (numeroRemover > jogadores.length) return message.reply(`Número inválido. Só existem ${jogadores.length} ${tipo === 'goleiro' ? 'goleiros' : 'jogadores'} na lista.`);

            const jogadorAlvo = jogadores[numeroRemover - 1];
            const podeRemover = isSenderAdmin || jogadorAlvo.adicionado_por === senderId;
            if (!podeRemover) return message.reply(`❌ Você não pode remover *${jogadorAlvo.nome_jogador}*.`);

            const eraVagaPrincipal = jogadorAlvo.tipo_jogador !== 'reserva';

            db.run('DELETE FROM jogadores WHERE id = ?', [jogadorAlvo.id], function (err) {
                if (err) return message.reply("Erro ao remover o jogador.");
                message.reply(`✅ *${jogadorAlvo.nome_jogador}* removido da lista por ${senderName}.`);
                if (eraVagaPrincipal && tipo === 'linha') promoverReserva(chat, client);
                else enviarLista(chat);
            });
        });

    } else {
        // ✅ Remover por nome (procura em todos)
        db.get('SELECT * FROM jogadores WHERE nome_jogador LIKE ?', [`%${argumento}%`], (err, row) => {
            if (err) return message.reply("Erro ao consultar o banco de dados.");
            if (!row) return message.reply(`Jogador "${argumento}" não encontrado na lista.`);

            const podeRemover = isSenderAdmin || row.adicionado_por === senderId;
            if (!podeRemover) return message.reply(`❌ Você não pode remover *${row.nome_jogador}*.`);

            const eraVagaPrincipal = row.tipo_jogador !== 'reserva';

            db.run('DELETE FROM jogadores WHERE id = ?', [row.id], function (err) {
                if (err) return message.reply("Erro ao remover o jogador.");
                message.reply(`✅ *${row.nome_jogador}* removido da lista por ${senderName}.`);
                if (eraVagaPrincipal && row.tipo_jogador === 'linha') promoverReserva(chat, client);
                else enviarLista(chat);
            });
        });
    }
}


        else if (command.startsWith('!add')) {
            const args = body.split(' ').slice(1);
            if (args.length === 0) return message.reply('Uso: `!add <nome> [goleiro]`');
            let nomeJogadorAvulso, tipoJogadorAvulso = 'linha';
            if (args.length > 1 && args[args.length - 1].toLowerCase() === 'goleiro') {
                nomeJogadorAvulso = args.slice(0, -1).join(' ');
                tipoJogadorAvulso = 'goleiro';
            } else { nomeJogadorAvulso = args.join(' '); }
            if (!nomeJogadorAvulso) return message.reply('Nome inválido.');
            logger.info(`Usuário ${senderName} usando comando !add para '${nomeJogadorAvulso}' como '${tipoJogadorAvulso}'`);
            db.get('SELECT 1 FROM jogadores WHERE nome_jogador = ?', [nomeJogadorAvulso], (err, row) => {
                if (err) { logger.error(err.message); return message.reply("Erro ao consultar o banco de dados."); }
                if (row) return message.reply(`${nomeJogadorAvulso} já está na lista!`);
                adicionarJogador(nomeJogadorAvulso, senderId, tipoJogadorAvulso, chat, message, senderName, true);
            });
        }
        else if (command === '!lista') {
            await enviarLista(chat);
        }
        else if (command === '!pix' || command === '!pagar') {
            logger.info(`Usuário ${senderName} pediu informações do PIX.`);
            const pixMessage = `*💸 Dados para Pagamento do Racha 💸*\n\n` +
                               `*Valor:* R$ ${config.PIX_VALUE}\n\n` +
                               `*Chave PIX (Celular):*\n` +
                               `\`${config.PIX_KEY}\`\n\n` +
                               `_Após pagar, avise um admin para confirmar sua presença na lista!_ ✅`;
            await message.reply(pixMessage);
        }
        else if (command === '!ajuda' || command === '!comandos') {
            let helpMessage = `*🤖 Comandos do Bot do Racha 🤖*\n\n`;
            helpMessage += `*!entrar*\n_Para se inscrever na lista._\n\n`;
            helpMessage += `*!entrar goleiro*\n_Para se inscrever como goleiro._\n\n`;
            helpMessage += `*!add <nome> [goleiro]*\n_Adiciona um amigo à lista._\n\n`;
            helpMessage += `*!sair*\n_Remove o seu próprio nome da lista._\n\n`;
            helpMessage += `*!remover <nome>*\n_Remove um jogador que você adicionou._\n\n`;
            helpMessage += `*!pix* ou *!pagar*\n_Mostra os dados para o pagamento._\n\n`;
            helpMessage += `*!lista*\n_Mostra a lista atualizada._`;
            if (isSenderAdmin) {
                helpMessage += `\n\n\n*👑 Comandos para Administradores 👑*\n`;
                helpMessage += `------------------------------------\n`;
                helpMessage += `*!pagou <nome>*\n_Confirma o pagamento._\n\n`;
                helpMessage += `*!remover <nome>*\n_Remove *qualquer* jogador._\n\n`;
                helpMessage += `*!setvagas <linha> <goleiros>*\n_Define o nº de vagas. Ex: !setvagas 20 2_\n\n`;
                helpMessage += `*!settitulo <texto>*\n_Altera o título._\n\n`;
                helpMessage += `*!setdata <texto>*\n_Altera a data/hora. Ex: !setdata 25/12 17:00_\n\n`;
                helpMessage += `*!limpar*\n_Zera a lista de jogadores._`;
            }
            await message.reply(helpMessage);
        }
        else if (['!pagou', '!settitulo', '!setdata', '!limpar', '!setvagas'].some(adminCmd => command.startsWith(adminCmd))) {
            if (!isSenderAdmin) return message.reply('❌ Apenas administradores podem usar este comando.');
            if (command.startsWith('!pagou')) {
                const nome = body.substring(7).trim();
                if (!nome) return message.reply('Uso: !pagou <nome> ou !pagou <número>');
                const numeroNaLista = parseInt(nome, 10);
                if (!isNaN(numeroNaLista) && numeroNaLista > 0) {
                    logger.info(`Admin ${senderName} tentando pagar por número da lista: ${numeroNaLista}`);
                    db.all('SELECT id, nome_jogador FROM jogadores WHERE tipo_jogador = "linha" ORDER BY id', [], (err, jogadoresLinha) => {
                        if (err) { logger.error(err.message); return message.reply("Erro ao consultar a lista."); }
                        if (numeroNaLista <= jogadoresLinha.length) {
                            const jogadorAlvo = jogadoresLinha[numeroNaLista - 1];
                            db.run('UPDATE jogadores SET status_pagamento = 1 WHERE id = ?', [jogadorAlvo.id], function(err) {
                                if(err) { logger.error(err.message); return message.reply("Erro ao atualizar pagamento."); }
                                if (this.changes > 0) { message.reply(`Pagamento do Nº${numeroNaLista} (*${jogadorAlvo.nome_jogador}*) confirmado! ✅`); enviarLista(chat); } 
                                else { message.reply(`Não foi possível atualizar o pagamento para o Nº${numeroNaLista}.`); }
                            });
                        } else { message.reply(`Número inválido. Existem apenas ${jogadoresLinha.length} jogadores na lista de linha.`); }
                    });
                } else {
                    logger.info(`Admin ${senderName} confirmando pagamento para '${nome}'`);
                    db.run('UPDATE jogadores SET status_pagamento = 1 WHERE nome_jogador LIKE ?', [`%${nome}%`], function(err) {
                        if(err) { logger.error(err.message); return message.reply("Erro ao atualizar pagamento."); }
                        if (this.changes > 0) { message.reply(`Pagamento de *${nome}* confirmado! ✅`); enviarLista(chat); } 
                        else { message.reply(`Não encontrei o jogador "${nome}" na lista.`); }
                    });
                }
            } else if (command.startsWith('!settitulo')) {
                const novoTitulo = body.substring(11).trim();
                if (!novoTitulo) return message.reply('Uso: !settitulo <Título do Racha>');
                logger.info(`Admin ${senderName} alterando título para '${novoTitulo}'`);
                db.run(`UPDATE partida_info SET titulo = ? WHERE id = 1`, [novoTitulo], (err) => {
                    if(err) { logger.error(err.message); return message.reply("Erro ao atualizar título."); }
                    message.reply(`📝 Título do racha atualizado para: *${novoTitulo}*`);
                    enviarLista(chat);
                });
            } else if (command.startsWith('!setdata')) {
                const novaData = body.substring(9).trim();
                if (!novaData) return message.reply('Uso: !setdata DD/MM/AAAA HH:MM');
                logger.info(`Admin ${senderName} alterando data para '${novaData}'`);
                db.run(`UPDATE partida_info SET data_hora = ? WHERE id = 1`, [novaData], (err) => {
                    if(err) { logger.error(err.message); return message.reply("Erro ao atualizar data."); }
                    message.reply(`🗓️ Data do racha atualizada para: *${novaData}*`);
                    enviarLista(chat);
                });
            } else if (command === '!limpar') {
                logger.info(`Admin ${senderName} limpando a lista de jogadores.`);
                db.run('DELETE FROM jogadores', [], (err) => {
                    if(err) { logger.error(err.message); return message.reply("Erro ao limpar a lista."); }
                    message.reply('🧹 Lista de jogadores zerada! Tudo pronto para o próximo racha.');
                    enviarLista(chat);
                });
            } else if (command.startsWith('!setvagas')) {
                const args = body.split(' ').slice(1);
                if (args.length !== 2) return message.reply('Uso incorreto. Exemplo: `!setvagas 20 2`');
                const novasVagasLinha = parseInt(args[0], 10);
                const novasVagasGoleiro = parseInt(args[1], 10);
                if (isNaN(novasVagasLinha) || isNaN(novasVagasGoleiro) || novasVagasLinha < 0 || novasVagasGoleiro < 0) {
                    return message.reply('Valores inválidos. Use apenas números positivos.');
                }
                db.run('UPDATE partida_info SET max_linha = ?, max_goleiros = ? WHERE id = 1', [novasVagasLinha, novasVagasGoleiro], (err) => {
                    if (err) { logger.error(`Erro ao atualizar vagas: ${err.message}`); return message.reply('Ocorreu um erro ao atualizar as vagas.'); }
                    logger.info(`Admin ${senderName} atualizou as vagas para Linha: ${novasVagasLinha}, Goleiros: ${novasVagasGoleiro}`);
                    message.reply(`✅ Vagas atualizadas!\n*Linha:* ${novasVagasLinha} vagas\n*Goleiros:* ${novasVagasGoleiro} vagas`);
                    enviarLista(chat);
                });
            }
        }
    } catch (e) { 
        logger.error(`Erro fatal no processamento da mensagem: ${e.stack || e.message}`);
        message.reply("Ocorreu um erro interno. Avise o admin!");
    }
}

module.exports = { handleCommand };