# orchestrator-local-hunting

Orquestador local de **hunting** (PROJ-035). Corre robot-position y robot-pricing-2 en las VMs de la
oficina para las cargas de hunting cuyo **pivote no se puede scrapear desde GCP** (hoy Paris), y
reporta el estado de cada robot como pod en `db-hunting` vía `api-hunting`.

Diseño: PROJ-024 RN-P024-009, ADR-P024-011 y SEQ-P024-008 (repo `documentacion`).

## Cómo encaja

```
orchestrator-hunting (GCP)                      orchestrator-local-hunting (máquina local)
  - extiende la vigencia de las categorías        - toma los loads pendientes con pivote local-*
  - pivote con plantilla local-*: no lanza,       - lanza position y luego pricing en la VM (pm2)
    no escribe categories, espera la fecha        - registra/actualiza los pods en api-hunting
    límite (creación + 3 días hábiles)     <----  - al terminar cada robot, marca position_status /
  - con ambos OK: complete-extraction               pricing_status = OK en categories del load
```

`orchestrator-hunting` no lee el estado desde `pods`: `GET /orchestrator/pods` no filtra por fecha y
devolvería cualquier pod exitoso histórico del retail. Por eso el resultado se informa en `categories`.

Un **pivote local** es el que tiene su plantilla `POSITION` en `launchs` con `cluster` que empieza con
`local-`. Si la plantilla es de GCP o no existe, este orquestador no hace nada con ese pivote.

## Un ciclo

1. `GET /orchestrator/loads/pending-extraction` y agrupa los loads por `pivot_retail_id`.
2. Para cada pivote con plantilla `local-*` y plantilla definida en `src/templates.js`:
   - Paso pendiente: `PRICING` si alguna categoría `RUNNING` tiene position OK y pricing no (va primero
     porque tiene que correr el mismo día que position); si no, `POSITION` si alguna no tiene position OK.
   - Si hay un pod `pending` de ese paso: consulta `pm2 jlist` en la VM; si terminó, `PATCH` del pod a
     `success` o `error`. Si fue `success`, marca el paso `OK` en `categories` de los loads cubiertos
     (`PATCH /orchestrator/loads/:id/categories`): para position, solo las categorías con que se lanzó;
     para pricing, las que ya tenían position OK.
   - Si no hay pod: después de `END_TIME` (Chile) no lanza; si en la VM ya corre la misma extracción,
     espera; si no, registra el pod (`pending`) y lanza `getilaunch` con `CLIENT_ID`, `FROM_HOURS=00` y,
     para position, `CATEGORIES` con las categorías de los loads.

## Requisitos

- Node.js 18 o superior. **Sin dependencias** (`fetch` y `child_process` de Node).
- Correr en el **host de las VMs** (`VBoxManage guestcontrol` solo controla VMs locales), igual que
  `orchestrator-local-deliverycategory`.
- Variables de entorno: ver `.env.example`. Nunca commitear `.env`.

## Instalación (pm2 en el host, igual que delivery)

```bash
git clone https://github.com/geti-company/orchestrator-local-hunting.git
cd orchestrator-local-hunting
cp .env.example .env && chmod 600 .env   # completar
pm2 start ecosystem.config.js
```

`ecosystem.config.js` lee el `.env` del repo, así que no hace falta cargarlo antes en la terminal (si una
variable no está en el `.env`, se toma del entorno). `pm2 restart` **no** vuelve a leer el `.env`: después
de cambiarlo, `pm2 delete orchestrator-local-hunting && pm2 start ecosystem.config.js`.

`launch.js` queda corriendo y ejecuta un ciclo cada `LOOP_INTERVAL_MINUTES` (10); el siguiente ciclo parte
cuando termina el anterior. Logs: `pm2 logs orchestrator-local-hunting`.

**Arranque automático:** el crontab del host 009 en el repo `crons` (`z-crontabs/009.host`) revisa cada
10 minutos si la app está corriendo en pm2 y, si no (reinicio del equipo o detenida), la inicia desde
`~/Repositorios/orchestrator-local-hunting` cargando su `.env`. Por eso el repo tiene que estar clonado en esa ruta.

Probar un ciclo a mano antes de dejarlo corriendo (**no es en seco**: si hay un load pendiente con pivote
local, lanza el robot):

```bash
set -a; . ./.env; set +a; RUN_ONCE=true node launch.js
```

## Depende de (PROJ-024)

- **T-P024-O18:** `orchestrator-hunting` no lanza pods para plantillas `local-*` y lee su estado desde `categories`, que marca este orquestador.
- **T-P024-D06:** plantillas `POSITION` y `PRICING` de Paris en `launchs` con `cluster = local-paris`.
- **T-P024-P08 / O16:** extensión de la vigencia de las categorías del cliente 412.

Sin O18, `orchestrator-hunting` seguiría intentando lanzar en GCP.

## Por verificar antes de producción

- [x] **`RETAIL`/`LOCAL` de Paris:** `paris`/`main` en position y pricing (más `RETAIL_ID=40` en pricing), igual
      que las corridas diarias de Paris en crons; es el retail de las categorías del pivote.
- [ ] **VM:** `src/templates.js` usa la 009.1, pendiente de confirmar con operación.
- [x] **Info extendida de Paris:** no la lanza este orquestador; ya la corre crons cada hora en la VM 009.4
      (`product/paris.config.js`, `CLUSTER=local-paris`).
- [ ] **Mismo día:** si position termina después de `END_TIME` o pasada la medianoche, pricing correría otro
      día y no encontraría nada (`ADD_POSITION_EXTERNAL` usa la fecha de hoy). Hay que definir cómo rehacer
      position en ese caso (`src/cycle.js`, TODO).
- [ ] Forma exacta de la respuesta de `GET /orchestrator/pods` y `POST /orchestrator/pod-register`
      (`src/hunting-api.js` acepta `data` como arreglo u objeto).
- [ ] Convivencia con la corrida diaria de Paris de otro cliente en la VM 009.1: usa otro `LOCAL` (`2_complete`),
      así que la regla de no lanzar encima no las separa y pueden correr al mismo tiempo en la VM.
- [ ] Que el auto-relaunch de crons (host 009) no intente relanzar los procesos `orch-hunt-*`, que no
      vienen de un config de crons.
