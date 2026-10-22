const config = require('./config');

/**
 * Cliente de api-hunting. Mismas rutas y header (`x-api-key`) que usa orchestrator-hunting;
 * este repo nunca escribe directo en db-hunting (RNF-002).
 */
const request = async (method, path, {query, body} = {}) => {
    if (!config.apiHunting.url) throw new Error('falta API_HUNTING_URL');

    const url = new URL(`${config.apiHunting.url}${path}`);
    Object.entries(query ?? {})
        .filter(([, value]) => value !== undefined)
        .forEach(([key, value]) => url.searchParams.set(key, `${value}`));

    const response = await fetch(url, {
        method,
        headers: {
            'x-api-key': config.apiHunting.key ?? '',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`api-hunting ${method} ${path}: HTTP ${response.status} - ${text.slice(0, 300)}`);

    return text ? JSON.parse(text) : null;
};

// api-hunting devuelve `data: []` o `{}` cuando no hay resultado: se normaliza a null
const firstOrNull = data => {
    const item = Array.isArray(data) ? data[0] : data;
    return item && Object.keys(item).length > 0 ? item : null;
};

module.exports = {
    // loads en PENDING_OF_EXTRACTION con pivot_retail_id, categories y created
    getLoadsPendingExtraction: async () => {
        const response = await request('GET', '/orchestrator/loads/pending-extraction');
        return Array.isArray(response?.data) ? response.data : [];
    },

    // plantilla del pivote para POSITION o PRICING (incluye cluster: local-* = pivote local)
    getLaunch: async (retailId, launchType) =>
        firstOrNull((await request('GET', '/orchestrator/launch', {query: {retail_id: retailId, launch_type: launchType}}))?.data),

    // reemplaza el mapa `categories` completo del load (misma ruta que usa orchestrator-hunting)
    updateLoadCategories: (loadId, categories) =>
        request('PATCH', `/orchestrator/loads/${loadId}/categories`, {body: {categories}}),
};
