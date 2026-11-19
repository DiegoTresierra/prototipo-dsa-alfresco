# Ajustes previos al piloto: permisos por nodo y secuencias independientes

Este documento sustituye los apartados de preflight de carpeta y huellas históricas de `OFFICIAL_EMISSION_INTEGRATION.md`. Se mantiene la arquitectura REST, modelo desplegado, mutex, idempotencia y escrituras deshabilitadas por defecto. No se cambió `.env.local`, modelo, ACL ni documentos en DEV.

## Preflight por responsabilidad

`officialEmissionService.js` separa:

1. Actor real: identidad/grupos/capacidades verificados y permiso `create` en su Emitidos. Se consulta `allowableOperations` sin exigir que el emisor pueda administrar o inspeccionar la ACL de toda la carpeta.
2. Cuenta técnica: lectura necesaria para inventario/conciliación y `create` en la bandeja receptora para la asociación secundaria.
3. Nodo nuevo: creador, UUID, ubicación institucional y concesión de lectura al grupo receptor en los permisos efectivos devueltos del propio nodo. Se conservan verificaciones de denegación; no se infiere lectura desde la asociación ni se pide Consumer global sobre Emitidos.
4. Contenido: GET con el actor y SHA-256 exacto contra los bytes emitidos. La lectura con la sesión real del receptor se valida adicionalmente mediante el procedimiento de `READ_ACCESS_CHECKS.md`; una ACL grupal no sustituye esa prueba.

## Cuándo se necesita Consumer y cómo se recupera

La aplicación NO otorga permisos. Después de crear el PDF con su número e identidad, ANTES de añadir la asociación receptora, consulta los permisos del nuevo UUID. Si ya existe lectura institucional efectiva acreditada, continúa. Si falta, devuelve un parcial explícito `OFFICIAL_RECIPIENT_NODE_READ_REQUIRED`, con `emittedNodeId` y `uncertain:true`, conserva el número y bloquea nuevas emisiones de esa secuencia hasta conciliar.

Mecanismo previsto, sujeto a autorización humana antes de la primera prueba: verificar primero mediante GET el UUID, sus cuatro metadatos y el contenido frente al PDF acordado; después, un operador de Alfresco con facultad ya autorizada para administrar ese documento añade Consumer al grupo receptor SOLO en ese UUID, sin abrir la carpeta Emitidos ni quitar entradas existentes. Esto es una actuación manual externa al backend, no una operación ejecutada por el agente o un endpoint de concesión automática. No se realiza durante esta entrega.

Después se reenvía el mismo PDF, parámetros y clave: el backend encuentra la identidad ya registrada, comprueba el permiso del nodo, añade/verifica la asociación y realiza GET, sin otro PDF ni otro correlativo. Las pruebas simulan esa intervención en memoria y demuestran ausencia de PUT/PATCH/DELETE de ACL en el flujo.

Una denegación existente no se supera añadiendo una concesión: debe revisarse la política institucional antes de cualquier cambio manual. No retirar denegaciones ni elevar privilegios como parte de este procedimiento.

Si no se autoriza esa intervención y el nuevo nodo no recibe legítimamente el permiso por configuración institucional existente, la emisión no podrá completarse como distribución. No conviene activar una prueba esperando un éxito automático; debe aprobarse previamente el procedimiento de parcial y recuperación. También puede optar la institución por otra política, pero no se inventa ni aplica aquí.

La pantalla conserva UUID/clave y muestra el parcial. No se permite recuperar una emisión oficial mediante el endpoint histórico que ajustaba ACL. Un documento registrado parcialmente no se borra ni se renumera, y una asociación secundaria por sí sola nunca supera una denegación.

## Conciliación v2: identidad estable y contenido real

El candidato local se regeneró mediante GET con los mismos 12 UUID y aprobación vacía. No se excluyó ningún documento en operación. El esquema ahora es `version:2`, `fingerprintVersion:2`; los manifiestos v1 no se aceptan ni se convierten automáticamente en aprobaciones v2.

La huella contiene UUID, tipo de nodo, creador (ID), fecha de creación, padre primario, MIME/tamaño y los cuatro campos de numeración. Cada entrada incluye SHA-256 de los bytes de contenido; al usar una exclusión se descarga de nuevo y compara. Un GET fallido no equivale a coincidencia ni ausencia. Detecta sustitución del contenido incluso si el tamaño y los metadatos aparentes se conservan.

Quedan fuera de la huella: asignaciones/historial de atención, responsables y dependencias, `gd:estado`, auditoría de modificación y aspectos operativos. Cambios legítimos en esos datos NO invalidan la clasificación. Se conserva el bloqueo si cambia UUID, tipo, creador, creación, ubicación, contenido o datos de numeración. Un UUID aprobado nunca puede ocultar una emisión con código, ciclo o identidad oficial añadidos, aunque se apruebe otra huella.

Solo el lector de numeración usa estas exclusiones. Despacho, atención, referencias, visualización y PDF original conservan su funcionamiento; no se escribe en esos registros. Ya no es necesario congelar los cuatro encargos activos para conservar su clasificación administrativa.

Para aprobar DTI: revisar cada documento y su contenido, completar `approvedBy`, fecha ISO, referencia administrativa verificable y motivo por UUID en una COPIA del candidato v2; verificar por GET y fijar SHA-256 del archivo aprobado. Estos campos no son una firma criptográfica: la autorización se respalda por el proceso institucional y control de despliegue. Los dos registros vacíos siguen necesitando clasificación explícita, sin repararlos ni borrarlos.

## Independencia: carpeta, código y ciclo

El máximo se calcula únicamente dentro de la carpeta Emitidos resuelta para la dependencia y por código completo/ciclo. Los documentos cuyo código o ciclo declaran inequívocamente otra secuencia no se decodifican como antecedentes de la actual. Esto no certifica ni aprueba esos otros registros: su secuencia deberá validarlos cuando se consulte.

Un documento sin código/ciclo clasificable dentro de LA MISMA carpeta sí bloquea, porque podría haber consumido números de la secuencia solicitada. Solo una exclusión administrativa aprobada y comprobada puede resolver esa ambigüedad. Un número inválido de la propia secuencia también bloquea. No se infieren códigos desde nombres ni sufijos de archivos.

El manifiesto ya NO es obligatorio al arrancar un emisor cuya carpeta/secuencia no necesite exclusiones. Si se configura un archivo, se sigue exigiendo aprobación v2, destino/raíces exactos y SHA-256 fijado: un artefacto corrupto o aprobado para otro entorno constituye una inconsistencia de configuración y no se ignora.

El lookup por clave idempotente conserva GET de nombre técnico en ambas raíces Emitidos para evitar reutilizar la clave del mismo usuario si cambia de dependencia. NO enumera ni valida históricos de la otra Dirección para calcular el número. Un fallo en ese GET puede bloquear porque impide comprobar unicidad del intento; no equivale a un bloqueo por documentos históricos ajenos.

## Preflight GET independiente

```powershell
# Sin aprobar ni excluir los históricos de DTI:
node backend/scripts/verify-official-emission.mjs --dependency=DSA

# DTI debe seguir bloqueado mientras sus pruebas carezcan de aprobación:
node backend/scripts/verify-official-emission.mjs --dependency=DTI

# Después de aprobar un manifiesto v2, no antes:
node backend/scripts/verify-official-emission.mjs <manifiesto-aprobado-v2.json> --dependency=DTI
```

La prueba real GET de esta entrega confirmó DSA: Emitidos `0bbf2022-7bbb-40a9-bf20-227bbb00a929`, código DSA, ciclo 2026, cero registros, siguiente `"1"`, permiso técnico para asociación verificado. `numberingAndAssociationPreflightReady:true` NO significa acceso del usuario real validado, entrega completada o escrituras habilitadas. DTI devolvió `OFFICIAL_NUMBER_RECONCILIATION_REQUIRED`, conforme a sus propios históricos.

Por tanto, sí podemos preparar una primera emisión DSA sin aprobar previamente los 12 documentos de DTI. Antes de autorizarla siguen pendientes sesión real DSA_T/DTI_T, permiso de creación del actor, aprobación del procedimiento Consumer por nodo si hace falta, entorno/instancia única y autorización expresa de la prueba. La configuración real de escrituras permanece false. No se utilizó una aprobación ficticia para demostrar esta independencia.

Los códigos de unidad/persona siguen teniendo secuencias independientes en el módulo, pero no se habilitan nuevos emisores ni se infieren esos códigos: el servicio formal actual sigue restringido a Dirección y sus códigos DSA/DTI verificados.

## Sesiones reales

No hay sesiones DSA_T/DTI_T accesibles ni backend local disponible desde este entorno; no se pidieron credenciales. `READ_ACCESS_CHECKS.md` contiene un bloque de consola revisable que realiza solo GET, registra identidad resumida, metadatos/contenido HTTP, bytes, firma PDF y SHA-256 sin imprimir cookies, tokens o JSON completo de sesión. Incluye DSA leyendo un compartido, DTI uno propio y DSA como usuario sin autorización para el no compartido.

Las pruebas reales de esos usuarios quedan PENDIENTES. No deben rellenarse con resultados de `gd_distribucion` o mocks. Tampoco debe aprobarse el control negativo por un 401 de sesión caducada o un fallo de red.

## Validación y archivos

139 pruebas automatizadas aprobadas, cero fallos u omitidas; lint y build correctos. La prueba HTTP se amplió y repitió: 409 con código de lectura pendiente y UUID, intervención manual simulada y recuperación 201 del mismo UUID sin otra creación. Se cubren carpetas sin lectura global cruzada, permiso de nodo existente, asociación denegada, contenido sustituido, cambios operativos permitidos, códigos/ciclos ajenos, ambigüedad de la propia carpeta y DSA vacía sin manifiesto DTI. Los scripts pasan `node --check`.

Cambios: `src/officialEmissionService.js`, `src/emissionReconciliation.js`, `src/alfrescoNumbering.js`, `src/index.js`; `scripts/prepare-emission-reconciliation.mjs`, `scripts/verify-official-emission.mjs`; candidato v2; mensaje/UUID en `frontend/src/api/alfresco.js`; regresiones en los tests de conciliación, contrato, servicio y HTTP y su fixture. Documentación de lectura real en `READ_ACCESS_CHECKS.md` y referencias actualizadas en los informes anteriores.

Las únicas peticiones reales a Alfresco fueron GET. Permanecen los mismos 12 documentos sin modificaciones, aprobación humana vacía, escrituras false y ambos `.env.local` con sus hashes anteriores. No se creó infraestructura, modelo, ACL, carpeta ni copia documental; no hubo commit ni push y se conservan rama y cambios locales.
