/**
 * Uso: pm2 start ecosystem.config.js (en el host de las VMs, igual que orchestrator-local-deliverycategory).
 * launch.js queda corriendo y ejecuta un ciclo cada LOOP_INTERVAL_MINUTES. Las variables sensibles se toman
 * del entorno de la máquina (ver .env.example); nunca se escriben en este archivo.
 */
module.exports = {
    apps: [{
        name: 'orchestrator-local-hunting',
        script: 'launch.js',
        cwd: __dirname,
        autorestart: true,
        // pm2 stop/restart espera a que termine el ciclo en curso (solo lanza y consulta, es corto)
        kill_timeout: 5 * 60 * 1000,
        env: {
            API_HUNTING_URL: process.env.API_HUNTING_URL,
            API_HUNTING_KEY: process.env.API_HUNTING_KEY,
            VM_GUEST_PASSWORD_FILE: process.env.VM_GUEST_PASSWORD_FILE,
            VM_GUEST_USER: process.env.VM_GUEST_USER,
            LOCAL_VM_EXEC_TEMPLATE: process.env.LOCAL_VM_EXEC_TEMPLATE,
            HUNTING_CLIENT_ID: process.env.HUNTING_CLIENT_ID,
            END_TIME: process.env.END_TIME,
            LOOP_INTERVAL_MINUTES: '10',
        },
    }],
};
