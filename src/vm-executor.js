const {exec} = require('child_process');
const config = require('./config');

/**
 * Lectura del estado de pm2 en las VMs. Adaptado de orchestrator-local-deliverycategory
 * (orchestrator/pm2-executor.js): mismo VBoxManage guestcontrol y mismo control de que el comando
 * corre dentro de una VM. Solo lee (`pm2 jlist`); no lanza ni detiene procesos.
 */

const shellQuote = value => `'${`${value}`.replace(/'/g, `'\\''`)}'`;

// código de salida con el que aborta un comando que no quedó corriendo dentro de una VM
const NOT_IN_VM_EXIT_CODE = 97;

// primera línea de todo comando: si terminó corriendo en el host, aborta sin hacer nada
const VM_GUARD = 'if ! grep -qi virtualbox /sys/class/dmi/id/product_name 2>/dev/null '
    + '&& [ "$(systemd-detect-virt 2>/dev/null)" != "oracle" ]; then '
    + 'echo "[orchestrator-local-hunting] abortado: no está corriendo dentro de una VM de VirtualBox ($(hostname))" >&2; '
    + `exit ${NOT_IN_VM_EXIT_CODE}; fi`;

const runInVm = (vm, command, timeout = config.vmExecTimeout) => new Promise((resolve, reject) => {
    const template = config.vmExecTemplate;
    if (!template) {
        return reject(new Error('sin comando para ejecutar en las VMs: configurar VM_GUEST_PASSWORD_FILE (o LOCAL_VM_EXEC_TEMPLATE)'));
    }
    if (!template.includes('{vm}') || !template.includes('{cmd}')) {
        return reject(new Error('LOCAL_VM_EXEC_TEMPLATE debe incluir {vm} y {cmd}'));
    }
    const encoded = Buffer.from(`${VM_GUARD}\n${command}`).toString('base64');
    const fullCommand = template.replaceAll('{vm}', vm).replaceAll('{cmd}', `echo ${encoded} | base64 -d | bash -l`);
    // VBoxManage guestcontrol no escribe en los sockets que Node da como stdout/stderr: se pasan por pipes reales
    const seconds = Math.ceil(timeout / 1000);
    const timedCommand = `timeout -k 10 ${seconds} bash -c ${shellQuote(fullCommand)}`;
    const shellCommand = `set -o pipefail; { ${timedCommand} 2>&1 1>&3 | cat >&2; } 3>&1 | cat`;

    exec(shellCommand, {shell: '/bin/bash', timeout: timeout + 30000, maxBuffer: 50 * 1024 * 1024}, (err, stdout, stderr) => {
        if (err) {
            const tail = text => `${text ?? ''}`.trim().split('\n').slice(-8).join(' | ').slice(-700);
            const reason = err.killed || err.code === 124 ? `timeout tras ${seconds} s` : `exit ${err.code ?? err.signal}`;
            return reject(new Error(`vm ${vm}: ${reason}; stderr: ${tail(stderr) || '(vacío)'}; stdout: ${tail(stdout) || '(vacío)'}`));
        }
        resolve(stdout);
    });
});

// `pm2 jlist` de la VM; si pm2 tuvo que levantar otro daemon (HOME/usuario incorrecto), la lista no es confiable
const getVmProcesses = async vm => {
    const output = await runInVm(vm, 'pm2 jlist');
    if (output.includes('Spawning PM2 daemon')) {
        throw new Error(`pm2 daemon no estaba corriendo en la vm ${vm} (¿HOME o usuario incorrecto?)`);
    }
    const json = output.split('\n').find(line => /^\s*\[\s*[{\]]/.test(line));
    if (!json) throw new Error(`pm2 jlist sin JSON en la vm ${vm}`);

    return new Map(JSON.parse(json).map(proc => [proc.name, {
        status: proc.pm2_env?.status,
        exitCode: proc.pm2_env?.exit_code,
        // inicio del proceso en pm2 (ms); los crontabs hacen `pm2 delete all` cada noche
        startedAt: proc.pm2_env?.pm_uptime,
    }]));
};

const procStatus = proc => {
    if (!proc) return 'NOT_FOUND';
    if (proc.status === 'errored') return 'FAILED';
    if (proc.status === 'stopped') return proc.exitCode === 0 ? 'OK' : 'FAILED';
    return 'RUNNING';
};

// status: 'OK' | 'FAILED' | 'RUNNING' | 'NOT_FOUND'; startedAt: inicio en ms (undefined si no existe)
const getProcess = async (vm, name) => {
    const proc = (await getVmProcesses(vm)).get(name);
    return {status: procStatus(proc), startedAt: proc?.startedAt};
};

module.exports = {getProcess};
