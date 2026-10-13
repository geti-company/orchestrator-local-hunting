/**
 * Plantillas de los robots por pivote local, indexadas por `launchs.retail_name` de la plantilla
 * `local-*` del pivote. CLIENT_ID, FROM_HOURS y CATEGORIES los agrega el ciclo.
 *
 * Paris: copiado de orchestrator-local-deliverycategory (position-paris2_complete.js y
 * pricing-paris2_complete.js), que hoy corre Paris para otro cliente en la VM 009.1.
 * [VERIFICAR] VM y LOCAL para las corridas de hunting (cliente 412), y que robot-pricing-2 con
 * RETAIL=paris2 tome los productos que robot-position dejó con RETAIL=paris.
 */
module.exports = {
    paris: {
        vm: '009.1',
        POSITION: {
            args: '3',
            env: {
                RETAIL: 'paris',
                LOCAL: '2_complete',
                SKIP_CATEGORY_ERRORS: 'true',
                MAX_ATTEMPTS: '10',
                PAGE_CONCURRENCY: '1',
            },
        },
        PRICING: {
            args: '2',
            env: {
                RETAIL: 'paris2',
                LOCAL: 'complete',
                LAUNCH_TYPE: 'ADD_POSITION_EXTERNAL',
                MAX_ATTEMPTS: '4',
                CONCURRENCY: '5',
                PAGE_CONCURRENCY: '1',
                execute_cf: 'n',
            },
        },
    },
};
