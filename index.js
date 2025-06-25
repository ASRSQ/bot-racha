// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const logger = require('./logger');
require('./database'); // Importa para garantir que o banco de dados conecte
const { handleCommand } = require('./commandHandler');

logger.info('Iniciando o bot...');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', //--no-sandbox and --disable-gpu are the most important
            '--disable-gpu'
        ],
    }
});

client.on('qr', qr => {
    logger.info('QR Code recebido, escaneie com seu celular!');
    const qrcode = require('qrcode-terminal');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    logger.info('✅ Bot conectado e pronto para receber comandos!');
});

client.on('disconnected', (reason) => {
    logger.warn(`Bot desconectado: ${reason}`);
});

// Delega todo o processamento de mensagens para o commandHandler
client.on('message_create', (message) => {
    handleCommand(client, message);
});

client.initialize();