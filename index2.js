// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const sqlite3 = require('sqlite3').verbose();
const logger = require('./logger');

// ####################################################################
// ##                  CONFIGURAÇÕES PRINCIPAIS                      ##
// ####################################################################
const ADMINS = ['558896091894@c.us']; 
const MAX_JOGADORES_LINHA = 4;
const MAX_GOLEIROS = 4;
// NOVAS CONFIGURAÇÕES DE PAGAMENTO
const PIX_KEY = '88996091894';
const PIX_VALUE = '6,00';
// ####################################################################

const db = new sqlite3.Database('./racha.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) return logger.error(`Erro ao abrir o banco de dados: ${err.message}`);
    
    logger.info('Conectado ao banco de dados SQLite.');
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS jogadores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome_jogador TEXT NOT NULL UNIQUE,
            status_pagamento INTEGER DEFAULT 0,
            tipo_jogador TEXT NOT NULL,
            adicionado_por TEXT NOT NULL 
        )`, (err) => {
            if (err) logger.error(`Erro ao criar tabela de jogadores: ${err.message}`);
            else logger.info("Tabela 'jogadores' pronta.");
        });

        db.run(`CREATE TABLE IF NOT EXISTS partida_info (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            titulo TEXT DEFAULT 'Racha dos Crias',
            data_hora TEXT DEFAULT 'A definir'
        )`, (err) => {
            if (err) return logger.error(`Erro ao criar tabela da partida: ${err.message}`);
            db.run(`INSERT OR IGNORE INTO partida_info (id) VALUES (1)`);
            logger.info("Tabela 'partida_info' pronta.");
        });
    });
});

const client = new Client({ authStrategy: new LocalAuth() });

logger.info('Iniciando o bot, aguarde...');
client.on('qr', qr => { logger.info('QR Code recebido...'); qrcode.generate(qr, { small: true }); });
client.on('ready', () => logger.info('✅ Bot conectado e pronto para receber comandos!'));
client.on('disconnected', (reason) => logger.warn(`Bot desconectado: ${reason}`));

client.on('message_create', async (message) => {
    const chat = await message.getChat();
    if (!chat.isGroup) return; 
    
    const body = message.body.trim();
    const command = body.toLowerCase();
    const sender = await message.getContact();
    const senderId = sender.id._serialized;
    const senderName = sender.pushname || sender.name;
    const isSenderAdmin = ADMINS.includes(senderId);

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
                        if (eraVagaPrincipal) {
                            promoverReserva(chat, client);
                        } else {
                            enviarLista(chat);
                        }
                    }
                });
            });
        }
        else if (command.startsWith('!remover')) {
            const nomeRemover = body.substring(9).trim();
            if (!nomeRemover) return message.reply('Uso correto: `!remover <nome do jogador>`');

            db.get('SELECT adicionado_por, tipo_jogador FROM jogadores WHERE nome_jogador LIKE ?', [`%${nomeRemover}%`], (err, row) => {
                if (err) { logger.error(err.message); return message.reply("Erro ao consultar o banco de dados."); }
                if (!row) return message.reply(`Jogador "${nomeRemover}" não encontrado na lista.`);

                if (isSenderAdmin || row.adicionado_por === senderId) {
                    const eraVagaPrincipal = (row.tipo_jogador === 'linha' || row.tipo_jogador === 'goleiro');
                    db.run('DELETE FROM jogadores WHERE nome_jogador LIKE ?', [`%${nomeRemover}%`], function(err) {
                        if (err) { logger.error(err.message); return message.reply("Erro ao remover jogador."); }
                        if (this.changes > 0) {
                            message.reply(`Ok, o jogador *${nomeRemover}* foi removido da lista por ${senderName}.`);
                            logger.info(`Usuário ${senderName} removeu ${nomeRemover} da lista.`);
                            if (eraVagaPrincipal) {
                               promoverReserva(chat, client);
                            } else {
                                enviarLista(chat);
                            }
                        }
                    });
                } else {
                    message.reply(`❌ Você não pode remover *${nomeRemover}*, pois ele não foi adicionado por você. Peça ao responsável ou a um admin.`);
                    logger.warn(`Usuário ${senderName} tentou remover ${nomeRemover} sem permissão.`);
                }
            });
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
        // NOVO COMANDO !PIX
        else if (command === '!pix' || command === '!pagar') {
            logger.info(`Usuário ${senderName} pediu informações do PIX.`);
            
            const pixMessage = `*💸 Dados para Pagamento do Racha 💸*\n\n` +
                               `*Valor:* R$ ${PIX_VALUE}\n\n` +
                               `*Chave PIX (Celular):*\n` +
                               `\`${PIX_KEY}\`\n\n` + // As crases ` criam o efeito de "copiar ao tocar" no WhatsApp
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
            helpMessage += `*!pix* ou *!pagar*\n_Mostra os dados para o pagamento._\n\n`; // Adicionado aqui
            helpMessage += `*!lista*\n_Mostra a lista atualizada._`;

            if (isSenderAdmin) {
                helpMessage += `\n\n\n*👑 Comandos para Administradores 👑*\n`;
                helpMessage += `------------------------------------\n`;
                helpMessage += `*!pagou <nome>*\n_Confirma o pagamento de um jogador._\n\n`;
                helpMessage += `*!remover <nome>*\n_Remove *qualquer* jogador (override)._\n\n`;
                helpMessage += `*!settitulo <texto>*\n_Altera o título do racha._\n\n`;
                helpMessage += `*!setdata <texto>*\n_Altera a data/hora. Ex: !setdata 25/12 17:00_\n\n`;
                helpMessage += `*!limpar*\n_Zera a lista de jogadores._`;
            }
            await message.reply(helpMessage);
        }
        else if (['!pagou', '!settitulo', '!setdata', '!limpar'].some(adminCmd => command.startsWith(adminCmd))) {
            if (!isSenderAdmin) return message.reply('❌ Apenas administradores podem usar este comando.');

            if (command.startsWith('!pagou')) {
                const nome = body.substring(7).trim();
                if (!nome) return message.reply('Uso: !pagou <nome>');
                logger.info(`Admin ${senderName} confirmando pagamento para '${nome}'`);
                db.run('UPDATE jogadores SET status_pagamento = 1 WHERE nome_jogador LIKE ?', [`%${nome}%`], function(err) {
                    if(err) { logger.error(err.message); return message.reply("Erro ao atualizar pagamento."); }
                    if (this.changes > 0) {
                        message.reply(`Pagamento de ${nome} confirmado! ✅`);
                        enviarLista(chat);
                    } else { message.reply(`Não encontrei o jogador "${nome}" na lista.`); }
                });
            }
            else if (command.startsWith('!settitulo')) {
                const novoTitulo = body.substring(11).trim();
                if (!novoTitulo) return message.reply('Uso: !settitulo <Título do Racha>');
                logger.info(`Admin ${senderName} alterando título para '${novoTitulo}'`);
                db.run(`UPDATE partida_info SET titulo = ? WHERE id = 1`, [novoTitulo], (err) => {
                    if(err) { logger.error(err.message); return message.reply("Erro ao atualizar título."); }
                    message.reply(`📝 Título do racha atualizado para: *${novoTitulo}*`);
                    enviarLista(chat);
                });
            }
            else if (command.startsWith('!setdata')) {
                const novaData = body.substring(9).trim();
                if (!novaData) return message.reply('Uso: !setdata DD/MM/AAAA HH:MM');
                logger.info(`Admin ${senderName} alterando data para '${novaData}'`);
                db.run(`UPDATE partida_info SET data_hora = ? WHERE id = 1`, [novaData], (err) => {
                    if(err) { logger.error(err.message); return message.reply("Erro ao atualizar data."); }
                    message.reply(`🗓️ Data do racha atualizada para: *${novaData}*`);
                    enviarLista(chat);
                });
            }
            else if (command === '!limpar') {
                logger.info(`Admin ${senderName} limpando a lista de jogadores.`);
                db.run('DELETE FROM jogadores', [], (err) => {
                    if(err) { logger.error(err.message); return message.reply("Erro ao limpar a lista."); }
                    message.reply('🧹 Lista de jogadores zerada! Tudo pronto para o próximo racha.');
                    enviarLista(chat);
                });
            }
        }
        
    } catch (e) { 
        logger.error(`Erro fatal no processamento da mensagem: ${e.stack || e.message}`);
        message.reply("Ocorreu um erro interno. Avise o admin!");
    }
});

function adicionarJogador(nome, quemAdicionouId, tipoDesejado, chat, message, senderName, porOutro = false) {
    const TabelaVerificar = tipoDesejado === 'linha' ? 'linha' : 'goleiro';
    const LimiteVagas = tipoDesejado === 'linha' ? MAX_JOGADORES_LINHA : MAX_GOLEIROS;

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
            resposta = `${senderName} adicionou *${nome}* à lista de ${tipoFinal}s.`
        }

        db.run('INSERT INTO jogadores (nome_jogador, adicionado_por, tipo_jogador) VALUES (?, ?, ?)', [nome, quemAdicionouId, tipoFinal], (err) => {
            if (err) {
                logger.error(`Erro ao inserir jogador ${nome}: ${err.message}`);
                return message.reply("Este nome já está na lista ou ocorreu um erro.");
            }
            enviarLista(chat);
        });
        message.reply(resposta);
    });
}

// SUBSTITUA A SUA FUNÇÃO ANTIGA POR ESTA
// SUBSTITUA A SUA FUNÇÃO ANTIGA POR ESTA VERSÃO COMPLETA
function promoverReserva(chat, client) {
    logger.info("Verificando se há reservas para promover...");
    db.get('SELECT * FROM jogadores WHERE tipo_jogador = "reserva" ORDER BY id ASC LIMIT 1', [], (err, reserva) => {
        if (err) { logger.error(`Erro ao buscar reserva: ${err.message}`); return; }

        // Se não houver ninguém na reserva, apenas atualiza a lista e encerra.
        if (!reserva) {
            logger.info("Nenhum jogador na lista de reserva para promover.");
            return enviarLista(chat);
        }

        // Se encontrou um reserva, verifica se há vaga na lista de linha.
        db.get('SELECT COUNT(*) as count FROM jogadores WHERE tipo_jogador = "linha"', [], (err, rowLinha) => {
            if (err) { logger.error(`Erro ao contar jogadores de linha para promoção: ${err.message}`); return; }

            // CENÁRIO 1: HÁ VAGA! VAMOS PROMOVER E NOTIFICAR DIRETAMENTE.
            if (rowLinha.count < MAX_JOGADORES_LINHA) {
                db.run('UPDATE jogadores SET tipo_jogador = "linha" WHERE id = ?', [reserva.id], (err) => {
                    if (err) { logger.error(`Erro ao promover ${reserva.nome_jogador}: ${err.message}`); return; }
                    
                    logger.info(`Jogador ${reserva.nome_jogador} promovido para a lista principal.`);
                    
                    const responsavelId = reserva.adicionado_por;
                    // Busca o contato do responsável para poder marcá-lo (@)
                    client.getContactById(responsavelId).then(contact => {
                        const nomeResponsavel = contact.pushname || contact.name;
                        let promotionMessage;

                        // Mensagem personalizada se o próprio jogador se inscreveu
                        if (nomeResponsavel.toLowerCase() === reserva.nome_jogador.toLowerCase()) {
                            promotionMessage = `🎉 Parabéns, *@${contact.id.user}*! Você foi promovido da reserva para a lista principal! Prepare a chuteira! Se não for mais jogar, digite \`!sair\` para liberar seu lugar na fila.`;
                        } else {
                        // Mensagem para o "padrinho" que adicionou o jogador
                            promotionMessage = `📢 Atenção, *@${contact.id.user}*! O jogador *${reserva.nome_jogador}* (adicionado por você) foi promovido para a lista principal!\n\nCaso ele não vá mais, use o comando \`!remover ${reserva.nome_jogador}\` para liberar o lugar.`;
                        }
                        
                        // Envia a notificação de promoção e, SÓ DEPOIS, envia a lista atualizada
                        chat.sendMessage(promotionMessage, { mentions: [contact] }).then(() => {
                            enviarLista(chat);
                        });

                    }).catch(e => {
                        // Se não conseguir encontrar o contato, manda a mensagem genérica antiga
                        logger.error(`Não foi possível buscar o contato para a notificação de promoção: ${e.message}`);
                        chat.sendMessage(`📢 Vaga liberada! O jogador *${reserva.nome_jogador}* foi promovido da reserva para a lista principal!`);
                        enviarLista(chat);
                    });
                });
            } else {
                // CENÁRIO 2: NÃO HÁ VAGA! A LÓGICA DE AVISO QUE JÁ TINHAMOS.
                logger.info(`Nenhuma vaga disponível. Notificando o responsável pelo próximo da reserva: ${reserva.nome_jogador}`);
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
}
async function enviarLista(chat) {
    try {
        const getInfo = new Promise((resolve, reject) => {
            db.get('SELECT titulo, data_hora FROM partida_info WHERE id = 1', [], (err, row) => {
                if (err) return reject(err);
                resolve(row || { titulo: 'Racha', data_hora: 'A definir' });
            });
        });

        const getLinha = new Promise((resolve, reject) => {
            db.all('SELECT * FROM jogadores WHERE tipo_jogador = "linha" ORDER BY id', [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });

        const getGoleiros = new Promise((resolve, reject) => {
            db.all('SELECT * FROM jogadores WHERE tipo_jogador = "goleiro" ORDER BY id', [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });

        const getReservas = new Promise((resolve, reject) => {
            db.all('SELECT * FROM jogadores WHERE tipo_jogador = "reserva" ORDER BY id', [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });

        const [info, jogadoresLinha, goleiros, reservas] = await Promise.all([
            getInfo,
            getLinha,
            getGoleiros,
            getReservas
        ]);

        let listaFormatada = `⚽ *${info.titulo}*\n🗓️ *Data:* ${info.data_hora}\n\n`;
        listaFormatada += `*Jogadores de Linha (${jogadoresLinha.length}/${MAX_JOGADORES_LINHA})*\n`;
        for (let i = 0; i < MAX_JOGADORES_LINHA; i++) {
            if (i < jogadoresLinha.length) {
                const jogador = jogadoresLinha[i];
                const pago = jogador.status_pagamento === 1 ? '✅' : '...';
                listaFormatada += `${i + 1}. ${jogador.nome_jogador} - Pgto: ${pago}\n`;
            } else {
                listaFormatada += `${i + 1}. ...\n`;
            }
        }
        listaFormatada += `\n*Goleiros (${goleiros.length}/${MAX_GOLEIROS})*\n`;
        for (let i = 0; i < MAX_GOLEIROS; i++) {
                if (i < goleiros.length) {
                const goleiro = goleiros[i];
                const pago = goleiro.status_pagamento === 1 ? '✅' : '...';
                listaFormatada += `${i + 1}. ${goleiro.nome_jogador} - Pgto: ${pago}\n`;
            } else {
                listaFormatada += `${i + 1}. ...\n`;
            }
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

client.initialize();