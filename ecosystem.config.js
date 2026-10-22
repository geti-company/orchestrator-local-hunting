const fs = require('fs');
const path = require('path');

/**
 * Uso: pm2 start ecosystem.config.js (en el host de las VMs, igual que orchestrator-local-deliverycategory).
 * launch.js queda corriendo y ejecuta un ciclo cada LOOP_INTERVAL_MINUTES. Las variables sensibles salen del
 * .env del repo (ver .env.example) o, si no está ahí, del entorno de la máquina; nunca se escriben aquí.
 */

// .env del repo: así cualquier `pm2 start` toma las variables, sin cargarlas antes en la terminal
const readEnvFile = () => {
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return {};
    return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
            const index = line.indexOf('=');
            const value = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
            return [line.slice(0, index).trim(), value];
        })
        .filter(([, value]) => value !== ''));
};

const fileEnv = readEnvFile();
const pick = key => fileEnv[key] ?? process.env[key];

module.exports = {
    apps: [{
        name: 'orchestrator-local-hunting',
        script: 'launch.js',
        cwd: __dirname,
        autorestart: true,
        // pm2 stop/restart espera a que termine el ciclo en curso (solo lanza y consulta, es corto)
        kill_timeout: 5 * 60 * 1000,
        env: {
            API_HUNTING_URL: pick('API_HUNTING_URL'),
            API_HUNTING_KEY: pick('API_HUNTING_KEY'),
            VM_GUEST_PASSWORD_FILE: pick('VM_GUEST_PASSWORD_FILE'),
            VM_GUEST_USER: pick('VM_GUEST_USER'),
            LOCAL_VM_EXEC_TEMPLATE: pick('LOCAL_VM_EXEC_TEMPLATE'),
            HUNTING_CLIENT_ID: pick('HUNTING_CLIENT_ID'),
            END_TIME: pick('END_TIME'),
            LOOP_INTERVAL_MINUTES: '10',
        },
    }],
};
