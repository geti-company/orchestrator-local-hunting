# orchestrator-local-hunting

Orquestador local de **hunting** (PROJ-035), para las cargas cuyo **pivote no se puede scrapear desde
GCP** (hoy Paris). Los robots los lanza `crons` en las VMs de la oficina; este orquestador **no lanza
nada**: lee en pm2 si terminaron y, cuando terminan bien, marca `position_status`/`pricing_status = OK`
en `categories` de los loads cubiertos, vía `api-hunting`.

Diseño: PROJ-024 RN-P024-009, ADR-P024-011 y SEQ-P024-008 (repo `documentacion`).

## Cómo encaja

```
crons (VM 009.1, todos los días)       orchestrator-local-hunting (host)      orchestrator-hunting (GCP)
  03:30 position  CLIENT_ID=412   --->   lee pm2 de la VM                       - extiende la vigencia de
  06:30 add position (pricing)           si terminaron bien hoy, marca   --->     las categorías del load
        RETAIL=paris LOCAL=main          position/pricing_status = OK         - pivote local-*: no lanza,
        (sin CATEGORIES)                 en categories de los loads             espera esas marcas hasta
                                         cubiertos                              creación + 3 días hábiles
                                                                              - con ambos OK: complete-extraction
```

Sin `CATEGORIES`, position toma todas las categorías del 412 de ese retail **vigentes ese día**. Como
`orchestrator-hunting` extiende la vigencia de las categorías de cada load hasta su fecha límite, esas
son justamente las de los loads de hunting de ese pivote que siguen en plazo.

Un **pivote local** es el que tiene su plantilla `POSITION` en `launchs` con `cluster` que empieza con
`local-`. Si la plantilla es de GCP o no existe, este orquestador no hace nada con ese pivote.

## Un ciclo

1. `GET /orchestrator/loads/pending-extraction` y agrupa los loads por `pivot_retail_id`.
2. Para cada pivote con plantilla `local-*` y procesos definidos en `src/templates.js`:
   - Lee `pm2 jlist` en la VM. Si el proceso de position **de hoy** no terminó bien, no hace nada.
   - Loads cubiertos: los que tienen categorías `RUNNING` y se crearon **antes** de que arrancara ese
     position. Un load creado después espera a la corrida del día siguiente.
   - Marca `position_status = OK` en esos loads (`PATCH /orchestrator/loads/:id/categories`).
   - Si el add position de hoy arrancó después que el position y terminó bien, marca `pricing_status = OK`.

Los crontabs de las VMs hacen `pm2 delete all` cada noche; además se exige que el proceso haya
arrancado hoy (hora de Chile).

## Requisitos

- Node.js 18 o superior. **Sin dependencias** (`fetch` y `child_process` de Node).
- Correr en el **host de las VMs** (`VBoxManage guestcontrol` solo controla VMs locales), igual que
  `orchestrator-local-deliverycategory`.
- Los configs y el crontab de la VM en el repo `crons`
  (`position-addpos/paris/paris-to-hunting-*.config.js`, `z-crontabs/vms-009/009.1`). Los nombres de
  proceso de `src/templates.js` tienen que coincidir con el `name` de esos configs.
- Variables de entorno: ver `.env.example`. Nunca commitear `.env`.

## Instalación con cron

```bash
git clone https://github.com/geti-company/orchestrator-local-hunting.git
cd orchestrator-local-hunting
cp .env.example .env   # completar
```

Ejemplo de crontab (cada 15 minutos; `flock` evita que dos ciclos se superpongan):

```cron
*/15 * * * * cd /ruta/orchestrator-local-hunting && set -a && . ./.env && set +a && RUN_ONCE=true flock -n /tmp/orchestrator-local-hunting.lock node launch.js >> ~/orchestrator-local-hunting.log 2>&1
```

Probar un ciclo a mano (no lanza robots, pero **sí escribe** en `categories` si encuentra loads cubiertos):

```bash
set -a; . ./.env; set +a; RUN_ONCE=true node launch.js
```

## Depende de (PROJ-024)

- **T-P024-O18:** `orchestrator-hunting` no lanza pods para plantillas `local-*` y lee su estado desde
  `categories`, que marca este orquestador.
- **T-P024-D06:** plantillas `POSITION` y `PRICING` de Paris en `launchs` con `cluster = local-paris`.
- **T-P024-P08 / O16:** extensión de la vigencia de las categorías del cliente 412.

## Por verificar antes de producción

- [x] **`RETAIL`/`LOCAL` de Paris:** `paris`/`main`, igual que las corridas diarias de Paris en crons; es el
      retail de las categorías del pivote.
- [x] **Info extendida de Paris:** la corre crons cada hora en la VM 009.4 (`product/paris.config.js`).
- [ ] **VM 009.1** para position y add position de hunting, pendiente de confirmar con operación.
- [ ] **Pricing después de position:** se exige que el add position arranque después que el position, pero
      no se puede saber si arrancó antes de que el position terminara. Lo cubren las 3 h entre los dos
      crons; si position se atrasa, ese día pricing procesaría solo lo extraído hasta ese momento.
- [ ] Convivencia con la corrida diaria de Paris de otro cliente en la VM 009.1 (`LOCAL=2_complete`): pueden
      correr al mismo tiempo en la VM.
