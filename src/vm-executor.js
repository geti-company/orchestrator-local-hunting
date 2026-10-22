const {exec} = require('child_process');
const config = require('./config');
const logger = require('./logger');

/**
 * Ejecución en las VMs con pm2. Adaptado de orchestrator-local-deliverycategory
 * (orchestrator/pm2-executor.js): mismo VBoxManage guestcontrol, mismo control de que el comando
 * corre dentro de una VM y misma regla de no lanzar encima de una extracción igual.
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

const buildEnvPrefix = env => Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ');

// getilaunch: 3 = position, 2 = pricing (igual que los configs de ~/crons)
const start = async (vm, template, name, extraEnv) => {
    const envPrefix = buildEnvPrefix({CONFIRM: 'true', ...template.env, ...extraEnv});
    logger.info(`lanzando ${name} en la vm ${vm}`);
    await runInVm(vm, `${envPrefix} pm2 start getilaunch --name ${shellQuote(name)} --no-autorestart --update-env --interpreter /bin/bash -- ${template.args}`);
};

const EXTRACTION_KEYS = ['RETAIL', 'LOCAL', 'LAUNCH_TYPE'];
const getProcEnv = (proc, key) => proc.pm2_env?.env?.[key] ?? proc.pm2_env?.[key];

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
        args: [].concat(proc.pm2_env?.args ?? []).join(' '),
        env: Object.fromEntries(EXTRACTION_KEYS.map(key => [key, getProcEnv(proc, key)])),
        // categorías con las que se lanzó position: al terminar se marcan solo esas
        categories: getProcEnv(proc, 'CATEGORIES'),
    }]));
};

const procStatus = proc => {
    if (!proc) return 'NOT_FOUND';
    if (proc.status === 'errored') return 'FAILED';
    if (proc.status === 'stopped') return proc.exitCode === 0 ? 'OK' : 'FAILED';
    return 'RUNNING';
};

// status: 'OK' | 'FAILED' | 'RUNNING' | 'NOT_FOUND'; categories: CATEGORIES con que se lanzó (si tiene)
const getProcess = async (vm, name) => {
    const proc = (await getVmProcesses(vm)).get(name);
    const categories = proc?.categories ? `${proc.categories}`.split(',').map(id => id.trim()).filter(Boolean) : undefined;
    return {status: procStatus(proc), categories};
};

// nombre de un proceso que ya corre la misma extracción (lo haya lanzado quien sea); undefined si no hay
const findRunningExtraction = async (vm, template) => {
    const keys = EXTRACTION_KEYS.filter(key => template.env?.[key] !== undefined);
    for (const [name, proc] of await getVmProcesses(vm)) {
        const same = proc.args === `${template.args}` && keys.every(key => `${proc.env[key]}` === `${template.env[key]}`);
        if (same && procStatus(proc) === 'RUNNING') return name;
    }
    return undefined;
};

module.exports = {start, getProcess, findRunningExtraction};
