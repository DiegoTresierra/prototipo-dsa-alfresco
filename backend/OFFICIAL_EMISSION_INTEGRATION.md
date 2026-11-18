# Emisión oficial Alfresco: integración implementada, DEV deshabilitado

Actualización vigente: [OFFICIAL_EMISSION_PILOT_ADJUSTMENTS.md](OFFICIAL_EMISSION_PILOT_ADJUSTMENTS.md) sustituye el requisito de lectura del receptor sobre Emitidos, la obligatoriedad global del manifiesto y la huella que incluía metadatos de atención. Usar el preflight por dependencia y la conciliación v2 descritos allí; los apartados siguientes se conservan como historial de la integración anterior.

## Estado comprobado

Se conserva `feature/jerarquia-despacho-interno` y todos los cambios anteriores. No se ejecutaron emisiones reales, borrados, cambios de ACL, modelo o `.env.local`. No hay base adicional ni contador independiente.

GET real confirmó el modelo activo, las tres propiedades nuevas desplegadas y `gd:numero` texto singular. El inventario directo de Emitidos identificó los mismos 12 documentos de prueba candidatos: ninguno tiene un registro oficial completo. El borrador `alfresco-model/emission-reconciliation.dev.candidate.json` conserva UUID y huella de cada uno, con aprobación/fecha/referencia/motivos VACÍOS. No es una aprobación y no habilita exclusiones.

GET de ACL de ambas carpetas Emitidos no mostró ninguna entrada para el grupo institucional de la otra Dirección (`GROUP_GD_DSA` en Emitidos DTI, `GROUP_GD_DTI` en Emitidos DSA). Esto no demuestra todos los permisos efectivos de cada usuario receptor, pero el nuevo flujo no puede acreditar su requisito de lectura institucional explícita y lo bloquea antes de crear. No se añadieron permisos. No se usaron credenciales de Dirección ni administrativas para probar escrituras reales.

`OFFICIAL_EMISSION_WRITES_ENABLED` permanece false. Tener `modelReady:true` no habilita emisiones.

## Archivos de esta integración

- `src/officialEmissionService.js`: emisor REST, autorización real, huella, distribución, conciliación e integración de la cola.
- `src/alfrescoNumbering.js`: cola compartida con contexto por solicitud, finalización y GET bajo el mismo bloqueo; enumeración con filtro `where=(assocType='cm:contains')` y comprobación del tipo de asociación devuelto. El parámetro suelto `assocType` no se utiliza como filtro de children en este módulo.
- `src/emissionReconciliation.js`: contrato del manifiesto administrativo, JSON canónico y huellas de exclusión.
- `src/config.js`, `src/index.js`: configuración independiente deshabilitada por defecto, endpoint formal, protección contra inyección de metadata por rutas antiguas y cierre seguro del lease.
- `scripts/prepare-emission-reconciliation.mjs`, `scripts/verify-official-emission.mjs`: preparación y verificación de conciliación mediante GET exclusivamente.
- `alfresco-model/emission-reconciliation.dev.candidate.json`: borrador real, SIN aprobar; no define contadores ni modifica el modelo.
- `frontend/src/api/alfresco.js`, `App.jsx`, `components/DocumentForm.jsx`: envío formal con una sola petición, sin reserva separada, clave conservada ante incertidumbre y presentación del ciclo/correlativo confirmados. `documentStore.js` continúa siendo únicamente caché de metadata confirmada, sin generar números.
- Pruebas: `officialEmissionService.test.js`, `officialEmission.integration.test.js`, `emissionReconciliation.test.js`, fixture `testFixtures/officialEmission.js`; ajustes en mocks de `alfrescoNumbering.test.js`, `officialEmissionContract.test.js`, `documentNumberAudit.test.js` para comprobar asociaciones. Verificador Edge ampliado en `frontend/scripts/verify-dispatch-browser.mjs`.

## Contrato de emisión

`POST /api/documents/official-emissions`, sesión y CSRF obligatorios. Multipart de entrada:

- `filedata`: PDF con firma `%PDF-`, máximo 20 MiB.
- `requestKey`: clave estable por usuario e intento, conservada al reintentar.
- `title`, `description`, `documentType`, `documentPeriod`, `priority`.
- `recipientDependency`, `receiptCategory`: validados contra dependencias/bandejas configuradas. No constituyen autoridad documental.

Se rechazan campos extra o duplicados, incluidos carpeta, código, ciclo, rol y `gd:numero` enviados por frontend. El backend vuelve a consultar `/people/-me-` y grupos de la identidad real, exige Dirección activa, dependencia única DTI/DSA y capacidades de lectura/escritura. El código de una Dirección es su dependencia institucional verificada. No deriva código de nombre de usuario, firma personal o unidad inventada. No habilita emisión formal de Jefatura/Especialista. La cola genérica mantiene independencia para códigos completos de unidad/persona, pero autorizar emisores de esos códigos requerirá un resolvedor institucional aprobado; no se abre esa facultad en esta entrega.

Solo se registra como numeración:

- `gd:numero`: texto decimal canónico positivo, generado en backend a partir del máximo NUMÉRICO.
- `gd:codigoDocumental`: código completo verificado.
- `gd:cicloDocumental`: inicio del ciclo 2 de enero–1 de enero siguiente, America/Lima.
- `gd:identidadEmision`: JSON v1, actor real, clave y huella.

No se crea un correlativo separado ni se persiste un identificador compuesto. La vista compone el formato previo con los valores confirmados, sin recalcular el entero ni usar el año calendario como ciclo después de la confirmación.

## Flujo bajo control de una sola instancia

1. Antes de admitir escrituras: validar destino DEV, confirmación explícita, manifiesto aprobado con SHA-256 fijado y configuración del piloto existente; adquirir lease exclusivo local. Preproducción no se habilita con estas confirmaciones DEV.
2. Por solicitud: verificar usuario efectivo/grupos, PDF, parámetros y autoridad. Comprobar permiso `create` del actor en su Emitidos, lectura explícita del grupo receptor en la configuración heredable y permiso `create` de la cuenta técnica en la bandeja receptora. Si no puede acreditarse, rechazar antes de crear. Nunca ajustar ACL.
3. Serializar reintentos por identidad técnica del usuario/clave. Resolver por GET directo el nombre determinista en AMBAS carpetas Emitidos configuradas; así un cambio posterior de dependencia no permite reutilizar la clave del mismo usuario para otro documento.
4. Si existe el intento, comprobar usuario, código y huella, conservar su ciclo original y entrar en la cola de ese código/ciclo. Si no existe y todos los GET fueron concluyentes, usar el ciclo actual. Un GET fallido no equivale a ausencia.
5. Bajo la cola por código/ciclo: conciliar otra vez, enumerar nodos directamente por children paginados y GET de propiedades, deduplicar UUIDs secundarios, validar contrato o exclusión administrativa exacta. Calcular máximo numérico incluyendo anulados; siguiente = máximo + 1, empezando en 1.
6. Crear con el actor real en un único `POST /nodes/{emitidos}/children?autoRename=false`, usando `filedata`, `nodeType=cm:content`, **`aspectnames=gd:identificacion`** (minúsculas para multipart), las cuatro propiedades y título/descripción. `overwrite=false`, `autoRename=false`. No hay PUT posterior para registrar el número.
7. Verificar actor, ubicación primaria nueva y acceso documental. Añadir/verificar solamente la asociación secundaria `cm:contains` a la bandeja receptora con la cuenta técnica existente; no duplicar PDF ni actualizar ACL. Si ya existe, comprobarla mediante GET de children.
8. GET del UUID, comparar metadata/identidad, verificar pertenencia visible a Emitidos y hacer GET del contenido con el actor para comprobar SHA-256 de los bytes. Confirmar visibilidad del registro por enumeración directa antes de completar la cola. La cola libera su exclusión en `finally` incluso si falla, manteniendo cuarentena lógica del código/ciclo incierto.

La API oficial soporta campos de propiedades en el mismo multipart de creación; no se presupone una transacción distribuida entre creación y asociación secundaria. Un parcial de distribución se concilia sobre el UUID existente. Contrato primario consultado: [OpenAPI oficial Alfresco Core](https://github.com/Alfresco/rest-api-explorer/blob/master/src/main/webapp/definitions/alfresco-core.yaml), creación de hijos, multipart `aspectnames`, `relativePath` GET y filtro `where` de asociaciones.

## Endpoints Alfresco utilizados

GET `/people/-me-`, `/people/{id}/groups` paginado; GET `/alfresco/service/api/classes/gd_identificacion`; GET `/nodes/{emitidos}?include=permissions,allowableOperations`; GET `/nodes/{bandeja}?include=allowableOperations`; GET `/nodes/{emitidos}?relativePath={nombre}`; GET `/nodes/{id}?include=properties` y lectura de permisos; GET `/nodes/{folder}/children?where=(assocType='cm:contains')&include=association&skipCount=...&maxItems=100`; GET `/nodes/{id}/content`.

Únicas escrituras del NUEVO flujo: POST `/nodes/{emitidos}/children` y POST `/nodes/{bandeja}/secondary-children` con el mismo UUID y `assocType:cm:contains`. No hace PUT/PATCH/DELETE de nodos, ACL ni modelos. Las herramientas de preparación/verificación ejecutadas durante la entrega solo usaron GET.

## Idempotencia, fallos y reinicios

La huella v1 es SHA-256 del JSON canónico con claves ordenadas: versión, actor, código verificado, título y descripción con trim, tipo, período académico, prioridad, dependencia/categoría receptora y SHA-256 de los bytes PDF. El nombre original no altera los bytes ni la emisión y no forma parte de la identidad. El nombre técnico es `emission-<SHA256(JSON canónico actorId/requestKey)>.pdf`: no depende del número, fecha o índice. No se usa `overwrite` ni autorrenombrado; 409 solo permite recuperar/verificar el mismo intento.

Misma clave/actor y misma huella devuelve el UUID existente tras verificación. Cambiar contenido o parámetros produce conflicto 409. La comprobación atraviesa ciclos conservando el ciclo ya almacenado. Un 404 explícito de relativePath puede significar que aún no está registrado, pero NO permite saltarse una cuarentena previa por timeout.

Antes de la llamada de creación se marca el intento en memoria. Si el resultado es incierto o la verificación falla, la secuencia queda bloqueada; un reintento del mismo usuario/clave puede recuperar por GET el PDF ya registrado y completar distribución/GET, sin crear otro. Se rechazan nuevas emisiones de esa secuencia mientras siga pendiente. Un error definitivo de escritura también se trata conservadoramente hasta revisión si no se recupera un UUID.

El lease `official-emission.lock` contiene solo PID/entorno/fecha operativa, no números ni un registro de emisiones. Si hay una petición activa o una incertidumbre, NO se elimina al cerrar. Una caída brusca también lo conserva: otro backend no puede arrancar como escritor oficial sobre el mismo archivo hasta conciliación administrativa. No borrar automáticamente un lock «viejo» por PID/tiempo ni reiniciar con otra ruta para saltarlo. Tras verificar en Alfresco que ninguna escritura puede seguir en curso y resolver los intentos pendientes, el operador puede autorizar la retirada del lock y el reinicio. Esto requiere intervención explícita, no un contador local ni garantía distribuida.

El lease y mutex protegen un único proceso con almacenamiento local compartido y estable. No protegen otros servidores, instancias con otra ruta, pérdida del volumen local, administradores o escritores externos. Sin ese control operativo no habilitar el piloto.

## Conciliación administrativa de los documentos de prueba

1. Regenerar el inventario, exclusivamente GET: `node backend/scripts/prepare-emission-reconciliation.mjs`. No ejecuta limpieza ni aprueba nada. Su salida contiene `manifestCandidate`; guardar SOLO ese objeto en un archivo distinto tras revisión (los mensajes dotenv de consola no son JSON del manifiesto).
2. Revisar institucionalmente cada UUID y su contenido con acceso autorizado. No basta que el archivo se llame TEST ni la afirmación genérica de que todos son pruebas. Documentar para cada entrada el motivo de exclusión y la decisión/ticket administrativo. Si no puede distinguirse un documento real, mantener el bloqueo.
3. El borrador real está en `alfresco-model/emission-reconciliation.dev.candidate.json`. Crear una copia revisada, por ejemplo `emission-reconciliation.dev.approved.json`; completar `approvedBy`, fecha ISO `approvedAt`, `decisionReference` verificable y `reason` de cada exclusión. Estos campos no son una firma criptográfica: la autorización se acredita mediante el procedimiento externo y el acceso de operador al despliegue. La huella de archivo fijada impide aceptar cambios inadvertidos de ese artefacto aprobado.
4. El manifiesto solo puede excluir UUIDs de prueba sin ninguna de las tres nuevas propiedades oficiales. La huella SHA-256 incluye UUID, tipo, creación, modificación/actor, content (metadatos del contenido), aspectos si se devuelven y TODAS las propiedades retornadas. No es una huella de los bytes PDF: el operador debe revisar el contenido; una actualización normal de contenido cambia la auditoría de modificación e invalida la exclusión. Un cambio de metadata invalida la exclusión y requiere nueva revisión. Un documento con metadata oficial completa o parcial nunca puede excluirse con este mecanismo, aunque se intente aprobar una huella nueva.
5. Verificar sin escrituras: `node backend/scripts/verify-official-emission.mjs <ruta-del-manifiesto-aprobado>`. Valida modelo, aprobación/destino/raíces y huellas; enumera los registros oficiales sin omitir errores, muestra exclusiones, aprobaciones obsoletas y prerequisitos de lectura de las Direcciones. Devuelve error si hay pendientes. `actorCreationVerified:false` recuerda que esta cuenta de consulta no prueba los permisos del usuario real.
6. Fijar el SHA-256 del archivo aprobado en la configuración de habilitación. No modificarlo silenciosamente, cambiar destino o reaprovechar el manifiesto DEV en otro entorno. No se crea una lista hardcodeada de emisores ni un registro separado de números: se trata de una decisión excepcional para excluir pruebas concretas y comprobables.

## Pasos exactos antes de autorizar una primera emisión real

No ejecutarlos como parte de esta entrega. Primero revisar esta implementación y aprobar una prueba real separada con Dirección, PDF y destino concretos.

1. Modelo ya verificado: `node backend/scripts/verify-emission-model.mjs --require-present`. `--audit-existing` seguirá mostrando las pruebas históricas porque ese inventario general NO aplica exclusiones; no confundirlo con el preflight del manifiesto.
2. Completar la revisión administrativa anterior y conseguir resultado satisfactorio de `verify-official-emission.mjs`. Hoy falta esa aprobación y el requisito de lectura explícita de la otra Dirección. Si la lectura legítima viene por otra jerarquía de grupos no evaluada, se requiere validar esa evidencia y adaptar el preflight; no se concede acceso ni se infieren permisos. Cualquier revisión administrativa de ACL es externa a esta entrega y necesita autorización propia.
3. Verificar que no hay otra instancia ni otro emisor externo, que ambas raíces son las institucionales correctas y que el volumen del lease es estable. Comprobar con la sesión real de Dirección su identidad, grupos y permiso efectivo create en Emitidos, sin solicitar nuevas credenciales ni utilizar administrador en la aplicación.
4. Con backend detenido y sin incertidumbres, configurar explícitamente en el entorno del proceso (no se modificaron `.env.local`):

```powershell
$approvedPath = (Resolve-Path .\backend\alfresco-model\emission-reconciliation.dev.approved.json).Path
$approval = Get-Content -Raw -LiteralPath $approvedPath | ConvertFrom-Json
$env:OFFICIAL_EMISSION_RECONCILIATION_FILE = $approvedPath
$env:OFFICIAL_EMISSION_RECONCILIATION_SHA256 = (Get-FileHash -LiteralPath $approvedPath -Algorithm SHA256).Hash.ToLowerInvariant()
$env:OFFICIAL_EMISSION_EXPECTED_TARGET = $approval.target
$env:OFFICIAL_EMISSION_ACK = 'single-instance-exclusive-writer-official-emission-dev'
$env:OFFICIAL_EMISSION_WRITES_ENABLED = 'true'
$env:WEB_CONCURRENCY = '1'
```

El piloto existente también debe estar validado: `DISPATCH_PILOT_ENVIRONMENT=dev`, destino exacto confirmado, su acknowledgement institucional y `DISPATCH_ALFRESCO_WRITES_ENABLED=true`. No habilitar esos controles por arrastre si aún no estaban autorizados. `OFFICIAL_EMISSION_LEASE_PATH` es opcional; usar una única ruta estable, distinta del lease de despachos, y no cambiarla para eludir una incertidumbre. No habilitar preproducción cambiando ALFRESCO_TARGET: este emisor requiere confirmación DEV y rechaza preprod.

5. Reiniciar una sola instancia, cargar el frontend actualizado e iniciar sesión como la Dirección autorizada. Elegir el PDF y datos acordados y confirmar UNA vez. La UI no pide ni reserva número previamente. Conservar `requestKey` y UUID de respuesta. Si hay error, conciliar con esa misma clave/PDF/datos; tras recarga, volver a seleccionar el mismo contenido y parámetros. No usar el endpoint antiguo de retry por UUID para una emisión oficial.
6. Comprobar GET de las cuatro propiedades, contenido, creador y asociaciones, y lectura legítima desde la dependencia receptora. Verificar mismo UUID en ambas bandejas, correlativo esperado y ausencia de duplicados. Una respuesta conserva UUID propio; vincularla al original no atiende encargos automáticamente.
7. Deshabilitar la variable de escritura al terminar la prueba autorizada y cerrar normalmente. Con incertidumbre, no retirar el lock ni iniciar otra emisión hasta resolverla.

## Regresión y límites funcionales

El endpoint antiguo de distribución y sus reintentos históricos permanecen para su flujo existente. Al habilitar el emisor oficial se rechaza la creación nueva por `send-to-director`; solo se admite el endpoint formal. Cargas antiguas/proxy no pueden introducir las cuatro propiedades oficiales. Un PDF que ya tiene identidad de emisión no se reintenta por la ruta histórica que ajustaba ACL: debe utilizar la misma clave en el endpoint formal. Las asociaciones secundarias existentes y la lectura institucional no se alteran.

La emisión sirve como operación reutilizable al aprobar una respuesta: crea UUID propio y después puede usarse el enlace `cm:references` existente al original. No se implementó el circuito completo de aprobación/versionado de respuesta; no se confunde la emisión con aprobación automática ni atención. Jefatura/Especialista siguen sin emisión formal. No se actualiza `gd:estado` ni se extinguen asignaciones.

## Validación final ejecutada

- Suite completa: 133 pruebas aprobadas, cero fallos u omitidas. Incluye primer/segundo número, máximo numérico, códigos independientes, ciclo del 2 de enero, dos usuarios del mismo código en concurrencia, reintento idéntico e incompatible, timeout tras crear, GET y hash del contenido, anulados, exclusiones aprobadas/incompatibles, roles, ACL, CSRF, campos frontend falsificados y regresión DTI–DSA. Tras ampliar la prueba a dos usuarios distintos, las siete pruebas del adaptador/HTTP también se repitieron correctamente.
- `npm run lint` y `npm run build`: correctos en la versión final. Los dos scripts nuevos de conciliación pasan `node --check`.
- Edge headless con bundle de producción y API LOCAL simulada: dos peticiones formales, UNA creación simulada; timeout seguido de la misma clave/contenido, enlace de respuesta sin atención automática, controles de Jefatura/Especialista, historial y bandejas. La restauración de clave/parámetros tras recarga y período académico anterior también tiene prueba de render del componente real. Los datos locales no son una sesión DEV.
- GET reales: modelo desplegado compatible, 12 candidatos históricos sin aprobar, ausencia de entrada explícita del grupo receptor en ambas ACL de Emitidos y escrituras oficiales deshabilitadas. No se ejecutó el verificador de manifiesto con una aprobación ficticia; la firma administrativa sigue pendiente.
- `git diff --check` correcto. Ambos `.env.local` conservan sus hashes iniciales. Rama conservada, sin commit, push, merge ni rebase. No se realizaron emisiones reales, escrituras de contenido/modelo, cambios de ACL ni borrados en DEV.

Las pruebas no sustituyen la primera prueba real autorizada ni demuestran garantías frente a escritores externos. La exclusión y la confirmación del operador se basan en un artefacto de despliegue confiable, no en una firma criptográfica o una ACL nueva. El runtime probado es Node 26.13.0; la integración requiere las APIs nativas fetch, FormData, Blob y Response.formData del backend.
