# Propuestas de respuesta y revisiones

## Estado y arquitectura

El circuito está preparado y probado con mocks. No hay rutas mutables productivas de propuestas ni habilitación de escritura real. La barrera del adaptador exige transporte inyectado, simulationOnly, destino reservado .invalid y mutex compartido.

El original conserva su UUID. Cada propuesta es otro cm:content PDF en Borradores institucional, con cm:versionable, cm:referencing y cm:references hacia el original. El oficial posterior tiene un tercer UUID y permanece en Emitidos.

Las carpetas no se crean automáticamente. proposalFolderNodeIds es un contrato interno no conectado a config.js ni a una variable de entorno operativa. Antes de habilitar, resolver IDs institucionales verificados y política de lectura/edición.

## Sobre compatible

gd:asignaciones conserva schemaVersion:1, revision, documentId, dispatches, history y responses opcional. reviewProcesses y reviewOperations son colecciones opcionales y estrictamente validadas; los sobres antiguos siguen siendo legibles.

Cada proceso v1 contiene id, originalDocumentId, proposalDocumentId, authorUserId, authorRole, dependency, assignmentId, revision, state, snapshot, events, approval y emissionDocumentId, además de schemaVersion.

El snapshot fija versionId, contentSha256 y metadataSha256. La huella de metadatos incluye título, descripción, tipo documental y dependencia de origen, excluyendo fechas de auditoría. El PDF no se guarda en el JSON.

assignmentId nulo solo corresponde a Dirección; en otros casos se valida la asignación del autor, rol y dependencia. La revisión del proceso cuenta operaciones confirmadas y no equivale a la etiqueta de versión Alfresco.

El parser reproduce el historial y compara su proyección actual. La consistencia estructural no certifica por sí sola decisiones escritas por terceros. El sobre completo tiene límite aplicativo de 256 KiB UTF-8; nunca se trunca para hacer espacio.

## Lectura autorizada

- GET /api/documents/response-proposals?documentId=...
- GET /api/documents/proposal-version-content?documentId=...&processId=...&versionId=...

Ambos requieren sesión, identidad institucional vigente, autorización del original y ACL del actor. El UUID de propuesta no se acepta como selector arbitrario. Se comprueban asociación, paginación, versión histórica, metadatos y contenido firmado %PDF-, no vacío y con SHA-256 coincidente; descarga limitada a 25 MiB.

Se distingue AVAILABLE, INACCESSIBLE, INVALID_VERSION, INCONSISTENT y UNAVAILABLE. Las denegadas no revelan UUID, autor ni metadatos. Un fallo del original no se convierte en lista vacía. Una operación pendiente no se presenta como aprobación disponible.

Si Alfresco no entrega propiedades históricas suficientes, se bloquea como inconsistente. No se sustituyen por metadatos actuales. La existencia de cm:versionable no demuestra que una versión contenga PDF válido.

## Creación y revisión internas

alfrescoProposalAdapter.js revalida persona/grupos y usa credenciales del actor. Exige ámbito institucional y update sobre original para el sobre, create en Borradores y update sobre propuesta cuando corresponde. No supera ACL con la cuenta técnica.

CREATE construye origen institucional en backend y aplica aspectos estándar. REVISE permite solo al autor vigente editar en BORRADOR u OBSERVADA. En esta etapa cambia únicamente contenido: se rechazan cambios simultáneos de metadatos o PDF idéntico. Se exige versionado efectivo y se conservan versiones previas.

La creación todavía no acepta tipo documental de negocio. No se inventa uno durante emisión: su clasificación legítima previa a aprobación es un bloqueo pendiente.

## Diario e idempotencia

reviewOperations v1 identifica actor, dependencia, proceso, acción, requestKey, payloadHash, expectedRevision, propuesta, versiones previas, fase, fecha y snapshot. Las emisiones añaden parámetros y recibo validados. No guarda credenciales ni PDF.

La cola por original debe ser exactamente la compartida con despacho y atención. Cubre autorización, GET, intención, contenido, relación y persistencia final. No se crea otra cola aislada para simular exclusión.

CREATE/REVISE avanzan por PREPARED, PDF_VERIFIED, RELATED y COMMITTED. La intención se persiste antes de crear/actualizar el PDF, con nombre determinista y sin autoRename. Se verifican contenido actual/histórico, huellas, versiones previas y cm:references.

Ante timeout se intenta guardar UNCERTAIN. Un PREPARED durable también exige conciliación. No repetir ciegamente POST/PUT: si no hay nodo o versión verificable tras reinicio, se bloquea para revisión administrativa. No existe cancelación automática del diario.

La clave vincula actor/original y payload. Un reintento compatible no duplica nodos/eventos; una clave incompatible produce conflicto. Una operación incompleta bloquea otras sobre el original. Se reserva margen antes de mutar el PDF y se verifica el sobre mediante GET final.

Los mutex y lease no previenen escritores externos ni aportan transacción multinodo o CAS. Conservar una instancia y escritor exclusivo. Los errores inciertos no son estados documentales confirmados.

## Decisiones y emisión

BORRADOR, EN_REVISION_JEFATURA, OBSERVADA, EN_REVISION_DIRECCION, APROBADA y EMITIDA pertenecen al proceso, no a gd:estado del original.

Una revisión posterior invalida la aprobación vigente y conserva su historia. El adaptador no abre edición de APROBADA; cualquier ampliación de esa política exige decisión institucional.

La atención individual no cambia al preparar, presentar, aprobar o emitir. El JSON de organización no resuelve supervisores ni concede permisos.

Las reglas completas están en [decisiones](REVIEW_DECISIONS.md) y [emisión aprobada](APPROVED_RESPONSE_EMISSION.md). Permanecen pendientes proveedor real, política de autoaprobación/reasignación, ACL de sesiones finales, versión histórica y conciliación de fallos reales.
