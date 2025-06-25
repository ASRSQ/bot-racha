const winston = require('winston');

// Define o formato do log
const logFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

const logger = winston.createLogger({
  level: 'info', // Nível mínimo de log para registrar
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    // Transporte para salvar todos os logs de erro em um arquivo separado
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    // Transporte para salvar todos os logs (info, warn, error) em um arquivo combinado
    new winston.transports.File({ filename: 'combined.log' }),
    // Transporte para mostrar os logs no console com cores
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        logFormat
      )
    })
  ],
});

module.exports = logger;