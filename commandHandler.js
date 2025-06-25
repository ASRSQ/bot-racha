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
    
    // Lógica de segurança para garantir que o sender existe
    const senderId = sender ? sender.id._serialized : null;
    const senderName = sender ? (sender.pushname || sender.name) : 'Desconhecido';
    const isSenderAdmin = senderId ? config.ADMINS.includes(senderId) : false;

    // Objeto de opções para resposta, criado de forma segura
    const replyOptions = {};
    if (sender) {
        replyOptions.mentions = [sender];
    }

    logger.info(`[FILA: PROCESSANDO] [GRUPO: ${chat.name}] [USER: ${senderName}] Mensagem: "${body}"`);

    try {
        if (command.startsWith('!entrar')) {
            let nomeParaAdicionar = senderName.substring(0, 10);
            if ((sender.pushname || sender.name).length > 10) {
                await message.reply(`Seu nome de perfil é muito longo. Você será adicionado como *${nomeParaAdicionar}*.`, replyOptions);
            }
            const tipoDesejado = command.includes('goleiro') ? 'goleiro' : 'linha';
            db.get('SELECT 1 FROM jogadores WHERE nome_jogador = ?', [nomeParaAdicionar], (err, row) => {
                if (err) { logger.error(err.message); return message.reply("Erro ao consultar o banco de dados.", replyOptions); }
                if (row) return message.reply(`${nomeParaAdicionar}, você já está na lista! 😉`, replyOptions);
                adicionarJogador(nomeParaAdicionar, senderId, tipoDesejado, chat, message, sender);
            });
        }
        else if (command === '!sair') {
            const nomeFormatado = senderName.substring(0, 10);
            logger.info(`Usuário ${senderName} tentando sair da lista como ${nomeFormatado}.`);
            db.get('SELECT tipo_jogador FROM jogadores WHERE nome_jogador = ?', [nomeFormatado], (err, row) => {
                if (err) { logger.error(err.message); return message.reply("Erro ao consultar o banco de dados.", replyOptions); }
                if (!row) return message.reply(`${senderName}, você não estava na lista.`, replyOptions);
                
                const eraVagaPrincipal = (row.tipo_jogador === 'linha' || row.tipo_jogador === 'goleiro');
                
                db.run('DELETE FROM jogadores WHERE nome_jogador = ?', [nomeFormatado], function(err) {
                    if (err) { logger.error(err.message); return message.reply("Erro ao tentar te remover da lista.", replyOptions); }
                    if (this.changes > 0) {
                        message.reply(`Ok, ${senderName}, você foi removido(a) da lista.`, replyOptions);
                        logger.info(`Usuário ${senderName} saiu da lista.`);
                        if (eraVagaPrincipal) { promoverReserva(chat, client); } 
                        else { enviarLista(chat); }
                    }
                });
            });
        }
        else if (command.startsWith('!remover')) {
            const nomeRemover = body.substring(9).trim();
            if (!nomeRemover) return message.reply('Uso correto: `!remover <nome do jogador>`', replyOptions);
            db.get('SELECT adicionado_por, tipo_jogador FROM jogadores WHERE nome_jogador LIKE ?', [`%${nomeRemover}%`], (err, row) => {
                if (err) { logger.error(err.message); return message.reply("Erro ao consultar o banco de dados.", replyOptions); }
                if (!row) return message.reply(`Jogador "${nomeRemover}" não encontrado na lista.`, replyOptions);
                if (isSenderAdmin || row.adicionado_por === senderId) {
                    const eraVagaPrincipal = (row.tipo_jogador === 'linha' || row.tipo_jogador === 'goleiro');
                    db.run('DELETE FROM jogadores WHERE nome_jogador LIKE ?', [`%${nomeRemover}%`], function(err) {
                        if (err) { logger.error(err.message); return message.reply("Erro ao remover jogador.", replyOptions); }
                        if (this.changes > 0) {
                            message.reply(`Ok, o jogador *${nomeRemover}* foi removido da lista por ${senderName}.`, replyOptions);
                            logger.info(`Usuário ${senderName} removeu ${nomeRemover} da lista.`);
                            if (eraVagaPrincipal) { promoverReserva(chat, client); } 
                            else { enviarLista(chat); }
                        }
                    });
                } else {
                    message.reply(`❌ Você não pode remover *${nomeRemover}*, pois ele não foi adicionado por você. Peça ao responsável ou a um admin.`, replyOptions);
                    logger.warn(`Usuário ${senderName} tentou remover ${nomeRemover} sem permissão.`);
                }
            });
        }
        else if (command.startsWith('!add')) {
            let nomeJogadorAvulso, tipoJogadorAvulso = 'linha';
            const args = body.split(' ').slice(1);
            if (args.length === 0) return message.reply('Uso: `!add <nome> [goleiro]`', replyOptions);
            if (args.length > 1 && args[args.length - 1].toLowerCase() === 'goleiro') {
                nomeJogadorAvulso = args.slice(0, -1).join(' ');
                tipoJogadorAvulso = 'goleiro';
            } else { nomeJogadorAvulso = args.join(' '); }
            if (!nomeJogadorAvulso) return message.reply('Nome inválido. Forneça um nome para adicionar.', replyOptions);
            if (nomeJogadorAvulso.length > 10) {
                return message.reply(`❌ O nome "${nomeJogadorAvulso}" é muito longo. Use um apelido de até 10 caracteres.`, replyOptions);
            }
            logger.info(`Usuário ${senderName} usando comando !add para '${nomeJogadorAvulso}' como '${tipoJogadorAvulso}'`);
            db.get('SELECT 1 FROM jogadores WHERE nome_jogador = ?', [nomeJogadorAvulso], (err, row) => {
                if (err) { logger.error(err.message); return message.reply("Erro ao consultar o banco de dados.", replyOptions); }
                if (row) return message.reply(`${nomeJogadorAvulso} já está na lista!`, replyOptions);
                adicionarJogador(nomeJogadorAvulso, senderId, tipoJogadorAvulso, chat, message, sender, true);
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
            await message.reply(pixMessage, replyOptions);
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
                helpMessage += `*!pagou <nome | número>*\n_Confirma o pagamento._\n\n`;
                helpMessage += `*!remover <nome>*\n_Remove *qualquer* jogador._\n\n`;
                helpMessage += `*!setvagas <linha> <goleiros>*\n_Define o nº de vagas. Ex: !setvagas 20 2_\n\n`;
                helpMessage += `*!settitulo <texto>*\n_Altera o título do racha._\n\n`;
                helpMessage += `*!setdata <texto>*\n_Altera a data/hora. Ex: !setdata 25/12 17:00_\n\n`;
                helpMessage += `*!limpar*\n_Zera a lista de jogadores._`;
            }
            await message.reply(helpMessage); // Ajuda não precisa de menção
        }
        else if (['!pagou', '!settitulo', '!setdata', '!limpar', '!setvagas'].some(adminCmd => command.startsWith(adminCmd))) {
            if (!isSenderAdmin) return message.reply('❌ Apenas administradores podem usar este comando.', replyOptions);

            if (command.startsWith('!pagou')) {
                const identificador = body.substring(7).trim();
                if (!identificador) return message.reply('Uso: `!pagou <nome>` ou `!pagou <número>`', replyOptions);
                const numeroNaLista = parseInt(identificador, 10);
                if (!isNaN(numeroNaLista) && numeroNaLista > 0) {
                    logger.info(`Admin ${senderName} tentando pagar por número da lista: ${numeroNaLista}`);
                    db.all('SELECT id, nome_jogador FROM jogadores WHERE tipo_jogador = "linha" ORDER BY id', [], (err, jogadoresLinha) => {
                        if (err) { logger.error(err.message); return message.reply("Erro ao consultar a lista.", replyOptions); }
                        if (numeroNaLista <= jogadoresLinha.length) {
                            const jogadorAlvo = jogadoresLinha[numeroNaLista - 1];
                            db.run('UPDATE jogadores SET status_pagamento = 1 WHERE id = ?', [jogadorAlvo.id], function(err) {
                                if(err) { logger.error(err.message); return message.reply("Erro ao atualizar pagamento.", replyOptions); }
                                if (this.changes > 0) { message.reply(`Pagamento do Nº${numeroNaLista} (*${jogadorAlvo.nome_jogador}*) confirmado! ✅`, replyOptions); enviarLista(chat); } 
                                else { message.reply(`Não foi possível atualizar o pagamento para o Nº${numeroNaLista}.`, replyOptions); }
                            });
                        } else { message.reply(`Número inválido. Existem apenas ${jogadoresLinha.length} jogadores na lista de linha.`, replyOptions); }
                    });
                } else {
                    const nome = identificador;
                    logger.info(`Admin ${senderName} confirmando pagamento para '${nome}'`);
                    db.run('UPDATE jogadores SET status_pagamento = 1 WHERE nome_jogador LIKE ?', [`%${nome}%`], function(err) {
                        if(err) { logger.error(err.message); return message.reply("Erro ao atualizar pagamento.", replyOptions); }
                        if (this.changes > 0) { message.reply(`Pagamento de *${nome}* confirmado! ✅`, replyOptions); enviarLista(chat); } 
                        else { message.reply(`Não encontrei o jogador "${nome}" na lista.`, replyOptions); }
                    });
                }
            } else if (command.startsWith('!settitulo')) {
                const novoTitulo = body.substring(11).trim();
                if (!novoTitulo) return message.reply('Uso: `!settitulo <Título do Racha>`', replyOptions);
                logger.info(`Admin ${senderName} alterando título para '${novoTitulo}'`);
                db.run(`UPDATE partida_info SET titulo = ? WHERE id = 1`, [novoTitulo], (err) => {
                    if(err) { logger.error(err.message); return message.reply("Erro ao atualizar título.", replyOptions); }
                    message.reply(`📝 Título do racha atualizado para: *${novoTitulo}*`, replyOptions);
                    enviarLista(chat);
                });
            } else if (command.startsWith('!setdata')) {
                const novaData = body.substring(9).trim();
                if (!novaData) return message.reply('Uso: `!setdata DD/MM/AAAA HH:MM`', replyOptions);
                logger.info(`Admin ${senderName} alterando data para '${novaData}'`);
                db.run(`UPDATE partida_info SET data_hora = ? WHERE id = 1`, [novaData], (err) => {
                    if(err) { logger.error(err.message); return message.reply("Erro ao atualizar data.", replyOptions); }
                    message.reply(`🗓️ Data do racha atualizada para: *${novaData}*`, replyOptions);
                    enviarLista(chat);
                });
            } else if (command === '!limpar') {
                logger.info(`Admin ${senderName} limpando a lista de jogadores.`);
                db.run('DELETE FROM jogadores', [], (err) => {
                    if(err) { logger.error(err.message); return message.reply("Erro ao limpar a lista.", replyOptions); }
                    message.reply('🧹 Lista de jogadores zerada! Tudo pronto para o próximo racha.', replyOptions);
                    enviarLista(chat);
                });
            } else if (command.startsWith('!setvagas')) {
                const args = body.split(' ').slice(1);
                if (args.length !== 2) return message.reply('Uso incorreto. Exemplo: `!setvagas 20 2`', replyOptions);
                const novasVagasLinha = parseInt(args[0], 10);
                const novasVagasGoleiro = parseInt(args[1], 10);
                if (isNaN(novasVagasLinha) || isNaN(novasVagasGoleiro) || novasVagasLinha < 0 || novasVagasGoleiro < 0) {
                    return message.reply('Valores inválidos. Use apenas números positivos.', replyOptions);
                }
                db.run('UPDATE partida_info SET max_linha = ?, max_goleiros = ? WHERE id = 1', [novasVagasLinha, novasVagasGoleiro], (err) => {
                    if (err) { logger.error(`Erro ao atualizar vagas: ${err.message}`); return message.reply('Ocorreu um erro ao atualizar as vagas.', replyOptions); }
                    logger.info(`Admin ${senderName} atualizou as vagas para Linha: ${novasVagasLinha}, Goleiros: ${novasVagasGoleiro}`);
                    message.reply(`✅ Vagas atualizadas!\n*Linha:* ${novasVagasLinha} vagas\n*Goleiros:* ${novasVagasGoleiro} vagas`, replyOptions);
                    enviarLista(chat);
                });
            }
        }
    } catch (e) { 
        logger.error(`Erro fatal no processamento da mensagem: ${e.stack || e.message}`);
        if(sender) await message.reply("Ocorreu um erro interno. Avise o admin!", replyOptions);
    }
}

module.exports = { handleCommand };