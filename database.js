// database.js
const sqlite3 = require('sqlite3').verbose();
const logger = require('./logger');
const config = require('./config');

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
            data_hora TEXT DEFAULT 'A definir',
            valor TEXT DEFAULT '${config.DEFAULT_RACHA_VALUE}', 
            max_linha INTEGER DEFAULT ${config.DEFAULT_MAX_LINHA},
            max_goleiros INTEGER DEFAULT ${config.DEFAULT_MAX_GOLEIROS}
        )`, (err) => {
            if (err) return logger.error(`Erro ao criar tabela da partida: ${err.message}`);
            db.run(`ALTER TABLE partida_info ADD COLUMN valor TEXT DEFAULT '${config.DEFAULT_RACHA_VALUE}'`, (alterErr) => {
                if (alterErr && !alterErr.message.includes('duplicate column name')) {
                     logger.error(`Erro ao adicionar coluna 'valor': ${alterErr.message}`);
                }
            });
            db.run(`INSERT OR IGNORE INTO partida_info (id) VALUES (1)`);
            logger.info("Tabela 'partida_info' pronta.");
        });
    });
});

module.exports = db;