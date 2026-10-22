const {randomUUID} = require('crypto');
const config = require('./config');
const logger = require('./logger');
const api = require('./hunting-api');
const vm = require('./vm-executor');
const templates = require('./templates');

const STATUS_KEY = {POSITION: 'position_status', PRICING: 'pricing_status'};

// hora de Chile en formato HH:MM, independiente de la zona del equipo
const chileTime = () => new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

const isAfterEndTime = () => chileTime() >= config.endTime;

/**
 * Marca el paso como OK en las categorías RUNNING de cada load que la corrida cubrió:
 * - position: solo las categorías con que se lanzó (CATEGORIES del proceso). Un load creado
 *   mientras corría no queda marcado y se procesa en una corrida siguiente.
 * - pricing: no filtra por categoría (procesa todo lo extraído ese día), así que solo las que ya
 *   tenían position OK.
 * orchestrator-hunting no escribe `categories` mientras espera a un pivote local: no se pisan.
 */
const markStepOk = async (loads, step, launchedCategories) => {
    const covered = (id, entry) => step === 'POSITION'
        ? (launchedCategories ?? []).includes(`${id}`)
        : entry.position_status === 'OK';

    for (const load of loads) {
        const categories = {...(load.categories ?? {})};
        let changed = false;
        for (const [id, entry] of Object.entries(categories)) {
            if (entry?.status === 'RUNNING' && entry[STATUS_KEY[step]] !== 'OK' && covered(id, entry)) {
                categories[id] = {...entry, [STATUS_KEY[step]]: 'OK'};
                changed = true;
            }
        }
        if (changed) {
            await api.updateLoadCategories(load.load_id, categories);
            logger.info(`load ${load.load_id}: ${STATUS_KEY[step]} = OK`);
        }
    }
};

/**
 * Revisa el pod pendiente del paso. Si terminó bien: pod success y el paso OK en los loads.
 * Si falló o desapareció: pod error, y en el ciclo siguiente se relanza.
 */
const checkPendingPod = async (template, pod, step, loads) => {
    const {status, categories} = await vm.getProcess(template.vm, pod.name);
    if (status === 'RUNNING') {
        logger.info(`${pod.name} sigue corriendo`);
        return;
    }
    const result = status === 'OK' ? 'success' : 'error';
    await api.updatePod(pod.id, {status: result, active: false});
    logger.info(`${pod.name} terminó (${status}) -> pod ${result}`);
    if (result === 'success') await markStepOk(loads, step, categories);
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
    // pricing primero: tiene que correr el mismo día que el position que ya terminó
    const needsPricing = running.some(([, entry]) => entry.position_status === 'OK' && entry.pricing_status !== 'OK');
    const needsPosition = running.some(([, entry]) => entry.position_status !== 'OK');
    const step = needsPricing ? 'PRICING' : needsPosition ? 'POSITION' : null;
    if (!step) return;

    const pod = await api.getPendingPod(pivotRetailId, step);
    if (pod) {
        await checkPendingPod(template, pod, step, loads);
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
