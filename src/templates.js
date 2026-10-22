/**
 * Plantillas de los robots por pivote local, indexadas por `launchs.retail_name` de la plantilla
 * `local-*` del pivote. CLIENT_ID, FROM_HOURS y CATEGORIES los agrega el ciclo.
 *
 * Paris: mismos valores que las corridas diarias de Paris de crons
 * (position-addpos/paris/paris-group1-position y addpos-paris-main-group): con LOCAL=main el robot
 * resuelve el retail `paris`, que es el de las categorías del pivote. LOCAL=2_complete o sellers
 * resuelven otros retails y no encontrarían esas categorías.
 * La info extendida de Paris no va aquí: ya la corre crons cada hora (product/paris.config.js).
 * [VERIFICAR] VM 009.1 para las corridas de hunting, pendiente de confirmar con operación.
 */
module.exports = {
    paris: {
        vm: '009.1',
        POSITION: {
            args: '3',
            env: {
                RETAIL: 'paris',
                LOCAL: 'main',
                SKIP_CATEGORY_ERRORS: 'true',
                MAX_ATTEMPTS: '7',
                PAGE_CONCURRENCY: '1',
                HEADLESS: 'true',
            },
        },
        PRICING: {
            args: '2',
            env: {
                RETAIL: 'paris',
                LOCAL: 'main',
                LAUNCH_TYPE: 'ADD_POSITION_EXTERNAL',
                RETAIL_ID: '40',
                MAX_ATTEMPTS: '3',
                CONCURRENCY: '1',
                PAGE_CONCURRENCY: '1',
            },
        },
    },
};
