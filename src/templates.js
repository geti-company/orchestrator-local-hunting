/**
 * Procesos que vigilar por pivote local, indexados por `launchs.retail_name` de la plantilla
 * `local-*` del pivote. Los lanza crons (repo `crons`, crontab de la VM): este orquestador no
 * lanza nada, solo lee su estado en pm2. `process` es el `name` de la app en el config de crons.
 *
 * Paris: crons corre position y add position con CLIENT_ID=412, RETAIL=paris y LOCAL=main
 * (retail 40, el de las categorías del pivote), sin CATEGORIES: toman las categorías del 412
 * vigentes ese día. La info extendida de Paris también la corre crons (product/paris.config.js).
 */
module.exports = {
    paris: {
        vm: '009.1',
        POSITION: {process: 'robot-position-paris-to-hunting'},
        PRICING: {process: 'add-position-external-paris-main-to-hunting'},
    },
};
