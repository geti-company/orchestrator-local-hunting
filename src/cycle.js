const {randomUUID} = require('crypto');
const config = require('./config');
const logger = require('./logger');
const api = require('./hunting-api');
const vm = require('./vm-executor');
const templates = require('./templates');

const STEPS = ['POSITION', 'PRICING'];
const STATUS_KEY = {POSITION: 'position_status', PRICING: 'pricing_status'};

// hora de Chile en formato HH:MM, independiente de la zona del equipo
const chileTime = () => new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

const isAfterEndTime = () => chileTime() >= config.endTime;

/**
 * Revisa el pod pendiente del paso: si ya terminó, informa success/error a api-hunting.
 * orchestrator-hunting lee ese estado y marca position_status/pricing_status del load.
 */
const checkPendingPod = async (template, pod) => {
    const status = await vm.getStatus(template.vm, pod.name);
    if (status === 'RUNNING') {
        logger.info(`${pod.name} sigue corriendo`);
        return;
    }
    const result = status === 'OK' ? 'success' : 'error';
    await api.updatePod(pod.id, {status: result, active: false});
    logger.info(`${pod.name} terminó (${status}) -> pod ${result}`);
};

const launchStep = async (pivotRetailId, launch, template, step, categoryIds) => {
    if (isAfterEndTime()) {
        logger.info(`retail ${pivotRetailId}: después de ${config.endTime} (Chile) no se lanza ${step}`);
        return;
    }
    // robot-pricing-2 (ADD_POSITION_EXTERNAL) procesa solo lo extraído ese mismo día.
    // TODO: si position terminó otro día, pricing no encontrará nada; definir cómo rehacer position (ver README).

    const running = await vm.findRunningExtraction(template.vm, template[step]);
    if (running) {
        logger.info(`retail ${pivotRetailId}: ya corre ${running} con la misma extracción, se espera`);
        return;
    }

    const name = `orch-hunt-${step.toLowerCase()}-${launch.retail_name}-${randomUUID().slice(0, 8)}`;
    // se registra antes de lanzar: si el lanzamiento falla, el pod queda en error y se reintenta en el ciclo siguiente
    const registered = await api.registerPod({
        code: randomUUID(),
        retail_id: pivotRetailId,
        name,
        active: true,
        cluster: `local-${template.vm}`,
        zone: null,
        namespace: 'pm2',
        status: 'pending',
        launch_type: step,
    });
    const podId = registered?.data?.id ?? registered?.id;

    const extraEnv = {
        CLIENT_ID: config.huntingClientId,
        FROM_HOURS: '00',
        ...(step === 'POSITION' ? {CATEGORIES: categoryIds.join(',')} : {}),
    };
    try {
        await vm.start(template.vm, template[step], name, extraEnv);
    } catch (err) {
        logger.error(`no se pudo lanzar ${name}: ${err.message}`);
        if (podId) await api.updatePod(podId, {status: 'error', active: false});
    }
};

/**
 * Un pivote local puede tener varios loads pendientes: se corre una sola extracción por paso, con la
 * unión de sus categorías (mismo criterio que el flujo GCP: un pod por retail y tipo).
 */
const processPivot = async (pivotRetailId, loads) => {
    const launch = await api.getLaunch(pivotRetailId, 'POSITION');
    // sin plantilla o plantilla GCP: lo maneja orchestrator-hunting
    if (!launch?.cluster?.startsWith('local-')) return;

    const template = templates[launch.retail_name];
    if (!template) {
        logger.warn(`retail ${pivotRetailId}: no hay plantilla local para '${launch.retail_name}' en src/templates.js`);
        return;
    }

    const running = loads.flatMap(load => Object.entries(load.categories ?? {}))
        .filter(([, entry]) => entry?.status === 'RUNNING');
    const step = STEPS.find(s => running.some(([, entry]) => entry[STATUS_KEY[s]] !== 'OK'));
    if (!step) return;

    const pod = await api.getPendingPod(pivotRetailId, step);
    if (pod) {
        await checkPendingPod(template, pod);
        return;
    }

    const categoryIds = [...new Set(running.filter(([, entry]) => entry[STATUS_KEY[step]] !== 'OK').map(([id]) => id))];
    await launchStep(pivotRetailId, launch, template, step, categoryIds);
};

const runCycle = async () => {
    const loads = await api.getLoadsPendingExtraction();
    const byPivot = new Map();
    for (const load of loads) {
        if (load.pivot_retail_id == null) continue;
        byPivot.set(load.pivot_retail_id, [...(byPivot.get(load.pivot_retail_id) ?? []), load]);
    }

    for (const [pivotRetailId, pivotLoads] of byPivot) {
        await processPivot(pivotRetailId, pivotLoads)
            .catch(err => logger.error(`retail ${pivotRetailId}: ${err.message}`));
    }
};

module.exports = {runCycle};
