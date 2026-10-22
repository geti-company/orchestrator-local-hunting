const env = process.env;
const VM_GUEST_USER = env.VM_GUEST_USER || 'extractor';

// Mismo mecanismo que orchestrator-local-deliverycategory: VBoxManage guestcontrol desde el host, sin SSH.
// HOME se fija al del usuario de la VM porque pm2 busca su daemon en $HOME/.pm2.
const vboxExecTemplate = () => env.VM_GUEST_PASSWORD_FILE
    ? `VBoxManage guestcontrol "Extractor-{vm}" run --exe /bin/bash --username ${VM_GUEST_USER} --passwordfile '${env.VM_GUEST_PASSWORD_FILE}' --wait-stdout --wait-stderr -- -c "export HOME=~${VM_GUEST_USER}; {cmd}"`
    : undefined;

module.exports = {
    apiHunting: {
        url: env.API_HUNTING_URL,
        key: env.API_HUNTING_KEY,
    },
    huntingClientId: env.HUNTING_CLIENT_ID || '412',
    vmExecTemplate: env.LOCAL_VM_EXEC_TEMPLATE || vboxExecTemplate(),
    vmExecTimeout: 120000,
    endTime: env.END_TIME || '19:59',
    timezone: 'America/Santiago',
    runOnce: env.RUN_ONCE === 'true',
    intervalMs: Number(env.LOOP_INTERVAL_MINUTES || 10) * 60 * 1000,
};
