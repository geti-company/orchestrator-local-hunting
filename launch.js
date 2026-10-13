const config = require('./src/config');
const logger = require('./src/logger');
const {runCycle} = require('./src/cycle');

/**
 * Con cron: RUN_ONCE=true ejecuta un ciclo y termina (ver README, usar flock para no superponer).
 * Con pm2: queda corriendo y ejecuta un ciclo cada LOOP_INTERVAL_MINUTES, sin superponerse.
 */
let stopping = false;
let wakeUp = () => {};
const stop = signal => {
    logger.info(`${signal} recibido, se termina después del ciclo en curso`);
    stopping = true;
    wakeUp();
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

const sleep = ms => new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    wakeUp = () => {
        clearTimeout(timer);
        resolve();
    };
});

const loop = async () => {
    while (!stopping) {
        const startedAt = Date.now();
        logger.info('inicio de ciclo');
        await runCycle().catch(err => logger.error(`ciclo: ${err.message}`));
        logger.info('fin de ciclo');
        if (config.runOnce) break;

        const wait = Math.max(0, config.intervalMs - (Date.now() - startedAt));
        if (!stopping) await sleep(wait);
    }
};

loop()
    .then(() => process.exit(0))
    .catch(err => {
        logger.error(err);
        process.exit(1);
    });
