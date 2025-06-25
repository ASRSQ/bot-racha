// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const logger = require('./logger');
require('./database'); // Importa para garantir que o banco de dados conecte
const { handleCommand } = require('./commandHandler');

logger.info('Iniciando o bot...');

// ---- NOVO: SISTEMA DE FILA DE MENSAGENS ----
const messageQueue = [];
let isProcessing = false;

async function processQueue(client) {
    if (isProcessing || messageQueue.length === 0) {
        return;
    }
    isProcessing = true;
    const message = messageQueue.shift(); 

    try {
        await handleCommand(client, message);
    } catch (e) {
        logger.error(`Erro não capturado ao processar a mensagem da fila: ${e.stack || e.message}`);
    } finally {
        isProcessing = false;
        processQueue(client);
    }
}
// ---- FIM DO SISTEMA DE FILA ----


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
            '--single-process',
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

client.on('message_create', (message) => {
    if (message.body.startsWith('!')) {
        messageQueue.push(message);
        processQueue(client);
    }
});

client.initialize();