const config = require('./config');
const logger = require('./logger');
const api = require('./hunting-api');
const vm = require('./vm-executor');
const templates = require('./templates');

// fecha de Chile (YYYY-MM-DD) de un instante, independiente de la zona del equipo
const chileDate = ms => new Intl.DateTimeFormat('en-CA', {timeZone: config.timezone}).format(new Date(ms));

const ranToday = proc => proc.startedAt != null && chileDate(proc.startedAt) === chileDate(Date.now());

const hasRunningCategories = load => Object.values(load.categories ?? {}).some(entry => entry?.status === 'RUNNING');

/**
 * Marca `key` (position_status | pricing_status) en OK en las categorías RUNNING del load.
 * orchestrator-hunting no escribe `categories` mientras espera a un pivote local: no se pisan.
 */
const markOk = async (load, key) => {
    const categories = {...(load.categories ?? {})};
    let changed = false;
    for (const [id, entry] of Object.entries(categories)) {
        if (entry?.status === 'RUNNING' && entry[key] !== 'OK') {
            categories[id] = {...entry, [key]: 'OK'};
            changed = true;
        }
    }
    if (!changed) return;

    await api.updateLoadCategories(load.load_id, categories);
    load.categories = categories;
    logger.info(`load ${load.load_id}: ${key} = OK`);
};

// Si el proceso no está listo, deja el motivo en el log y devuelve false.
const isDone = (pivotRetailId, name, proc) => {
    if (proc.status === 'OK') return true;
    if (proc.status === 'FAILED') logger.warn(`retail ${pivotRetailId}: ${name} terminó con error hoy`);
    else if (proc.status === 'RUNNING') logger.info(`retail ${pivotRetailId}: ${name} sigue corriendo`);
    else logger.info(`retail ${pivotRetailId}: ${name} no ha corrido hoy`);
    return false;
};

/**
 * crons lanza una vez al día position y después add position (pricing) del pivote, sin CATEGORIES:
 * position toma las categorías del cliente genérico vigentes al arrancar. Por eso cubre los loads
 * creados antes de su inicio; uno creado después espera a la corrida del día siguiente.
 * Pricing (ADD_POSITION_EXTERNAL) procesa lo extraído ese día, así que tiene que haber arrancado
 * después que el position del mismo día.
 */
const processPivot = async (pivotRetailId, loads) => {
    const launch = await api.getLaunch(pivotRetailId, 'POSITION');
    // sin plantilla o plantilla GCP: lo maneja orchestrator-hunting
    if (!launch?.cluster?.startsWith('local-')) return;

    const template = templates[launch.retail_name];
    if (!template) {
        logger.warn(`retail ${pivotRetailId}: no hay procesos para '${launch.retail_name}' en src/templates.js`);
        return;
    }

    const position = await vm.getProcess(template.vm, template.POSITION.process);
    if (!ranToday(position)) position.status = 'NOT_FOUND';
    if (!isDone(pivotRetailId, template.POSITION.process, position)) return;

    const covered = loads.filter(load => hasRunningCategories(load) && new Date(load.created).getTime() < position.startedAt);
    if (covered.length === 0) {
        logger.info(`retail ${pivotRetailId}: ningún load pendiente es anterior al position de hoy`);
        return;
    }
    for (const load of covered) await markOk(load, 'position_status');

    const pricing = await vm.getProcess(template.vm, template.PRICING.process);
    if (!ranToday(pricing) || pricing.startedAt < position.startedAt) pricing.status = 'NOT_FOUND';
    if (!isDone(pivotRetailId, template.PRICING.process, pricing)) return;

    for (const load of covered) await markOk(load, 'pricing_status');
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
