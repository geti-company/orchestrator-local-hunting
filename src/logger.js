// Logger mínimo por consola (cron/pm2 guardan la salida). Sin dependencias.
const log = level => (...args) => console.log(`[${new Date().toISOString()}] [${level}]`, ...args);

module.exports = {
    info: log('INFO'),
    warn: log('WARN'),
    error: log('ERROR'),
};
