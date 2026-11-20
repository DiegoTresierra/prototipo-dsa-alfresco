# Integración de aprobación con emisión oficial — etapa 4

## Estado de la entrega

Servicio interno `createApprovedResponseEmission`, con operaciones `emit` y
`reconcile`, integrado en `responseProposalOperations` como `emitApproved` y
`reconcileEmission`. No se importa en index.js ni se crea una ruta mutable nueva.
El adaptador sigue limitado a transporte inyectado de fixtures y destino `.invalid`.
No se habilitó el emisor oficial ni se cambiaron variables de entorno.

El transporte REST, el motor de revisión y el emisor oficial existentes se ejercitan
juntos con mocks. No se introdujo otro contador, emisor ni almacenamiento local.

## Entrada y aprobación

La entrada acepta exactamente documentId, processId, requestKey, expectedRevision
y expectedVersionId. No admite PDF, actor, rol, metadatos, approved ni destinatario
enviado por React como prueba de aprobación.

Dentro de la cola compartida del original se comprueba:

- Identidad habilitada y rol/dependencia vigentes en Alfresco.
- ACL de lectura y update del original, pertenencia institucional comprobada.
- Proceso APROBADA, o EMITIDA únicamente para recuperar una operación existente.
- Evento de aprobación presente, vigente y ligado al mismo proceso, propuesta,
  revisión, versión y huellas; no autoaprobación.
- Aprobador habilitado con rol Dirección y revisor institucional actual verificado.
  En este piloto el solicitante debe coincidir con esa Dirección revisora; no se
  habilita delegación de emisión a otro actor sin política institucional.
- ACL del actor sobre propuesta y versión, relación cm:references al original,
  versión actual coincidente, PDF no vacío, firma PDF y SHA-256 histórico/actual.
- Coincidencia de título, descripción, tipo documental y dependencia de origen,
  que constituyen el contrato actual de huella de metadatos.
- Ausencia de operaciones pendientes ajenas a la conciliación solicitada.

El proveedor real de competencia institucional sigue pendiente. No se utiliza el
organigrama JSON ni se consideran suficientes los permisos de escritura.

El contenido se descarga desde la versión aprobada en Alfresco y se entrega al
emisor existente. El UUID del original, el de la propuesta y el del PDF oficial
son distintos. No se cambia el contenido aprobado para estampar números o firmas.
La aprobación no equivale a firma digital ni se implementa firma en esta entrega.

## Emisor reutilizado y metadatos

`officialEmissionService.issueReviewed` es una capacidad interna que recibe una
función de autorización del servidor; no acepta un flag JSON. Revalida el vínculo
antes de crear y durante las verificaciones posteriores. La identidad idempotente
incluye en su payloadHash la vinculación de proceso/propuesta/aprobación/versión/huellas.

Se conserva el único emisor `createAlfrescoNumberedIssuer`, mutex por código/ciclo,
máximo numérico directo de Emitidos, ciclo del 2 de enero en America/Lima,
conciliación histórica existente, fecha formal e identidad idempotente. No se usa
el índice de búsqueda ni un contador separado. Los códigos disponibles siguen
siendo los que autoriza el emisor actual; no se inventan códigos de unidades.

La clave oficial es determinista por original/proceso/evento de aprobación. La
clave de operación del cliente identifica el diario, pero no permite obtener
otra emisión cambiando de clave después de empezar a emitir ese proceso.

Título, descripción y tipo se obtienen del nodo aprobado, conservando exactamente
la semántica de la huella. Datos sin tipo o con formatos que el emisor normalizaría
de forma distinta quedan bloqueados. La creación de propuestas de la etapa 2 todavía
no acepta tipo documental: su incorporación legítima antes de aprobar requiere una
etapa posterior; no se inventa un tipo para permitir emisión. Los tests siembran
explícitamente un PDF tipificado antes de revisar, y también prueban el bloqueo sin tipo.

Destino, categoría, período y prioridad proceden de un resolvedor interno de política
institucional, nunca del payload de este servicio. Se persisten sus parámetros en
el diario para que el reintento no cambie el destino. El contrato real del resolvedor
debe aprobarse antes de habilitar. El emisor actual solo distribuye a la otra Dirección.

Período académico y prioridad siguen sin ser propiedades documentales verificadas;
se conservan como parámetros del hash y se mantienen las advertencias existentes.
Código, ciclo, correlativo e identidad usan gd:codigoDocumental, gd:cicloDocumental,
gd:numero y gd:identidadEmision. No se añaden propiedades CMM.

## Recibo y conciliación

El diario reviewOperations admite EMIT con emissionOptions y recibo emission.
El recibo enlaza original, propuesta, proceso, aprobación, versión y huellas con
el registro oficial: UUID, código, ciclo, correlativo, actor, requestKey y payloadHash.

1. PREPARED persistido y verificado antes de invocar al emisor. Se reserva margen
   de 8 KiB para recibo/evento/vínculo, manteniendo el límite total de 256 KiB.
2. El emisor crea o recupera la identidad oficial y verifica contenido, metadatos,
   número y distribución secundaria mediante las APIs existentes.
3. El coordinador vuelve a consultar el nodo oficial. Verifica identidad, carpeta
   primaria Emitidos, autor, PDF, metadatos y distribución antes de EMISSION_FOUND.
4. Confirma cm:references desde el oficial al original. Añade cm:referencing si falta,
   únicamente con update efectivo del actor; no modifica contenido ni ACL del oficial.
5. Persiste juntos evento EMIT, proceso EMITIDA, recibo COMMITTED y vínculo de respuesta
   en el original. Conserva las demás colecciones y no atiende asignaciones.
6. Hace GET final de conciliación. Un HTTP 2xx incompleto nunca basta para confirmar.

La verificación independiente de distribución confirma por GET pertenencia efectiva
cm:contains en la bandeja destinataria. La ACL de lectura del actor sobre el PDF
oficial se exige siempre; para descubrir esa asociación se usa solo la identidad
de distribución existente, habilitada y no administrativa. No se exige al emisor
lectura de toda la bandeja de la Dirección receptora. No se concede Consumer.

Si falla la operación después de la creación, se busca el nombre determinista y se
conserva un recibo parcial de identidad verificada (UUID y correlativo), aunque aún
no exista distribución. Ese recibo solo puede figurar en una operación pendiente;
no certifica entrega ni autoriza EMITIDA. La fase queda UNCERTAIN siempre que el
guardado sea posible. PREPARED/EMISSION_FOUND siguen bloqueando si también falla el diario.

La primera identidad verificada se conserva. Una alteración externa del UUID,
correlativo o ciclo no reemplaza el recibo histórico durante un catch/reintento.
Se bloquea la conciliación y se requiere intervención humana; no se crea otro PDF.

Después de reiniciar, `reconcile` usa el emisor oficial con existingOnly: puede
recuperar distribución y registro, pero no crear una emisión ausente. Si no se puede
probar que se creó, queda pendiente de conciliación administrativa. Un nuevo
requestKey no libera la operación ni obtiene otro número. Un registro del original
ya escrito se reconoce por su evento, evitando duplicar historial y respuestas.

## Protección de los caminos anteriores

El endpoint genérico existente conserva su allowlist y no recibe la nueva capacidad.
Se rechazan indicadores de revisión y PDFs con huellas de propuestas conocidas.
Cambiar bytes no demuestra que un PDF sea ajeno al circuito: ante procesos o diarios
de revisión en el ámbito inspeccionado, una nueva emisión genérica no clasificada
se bloquea con OFFICIAL_REVIEW_CLASSIFICATION_REQUIRED. No existe un flag del cliente
para eludir este bloqueo.

Esta decisión conservadora puede bloquear un documento independiente mientras haya
procesos en ese ámbito: antes de habilitar ambos caminos deberá aprobarse una forma
de acreditar en backend su independencia. No se promete clasificación semántica de
PDFs ni cobertura de escritores externos. La inspección usa GET de bandejas configuradas,
deduplica asociaciones secundarias y exige paginación completa y consistente.

Las emisiones genéricas previamente iniciadas siguen recuperándose por identidad
determinista antes de esa clasificación. Sin procesos de revisión, el flujo genérico
legítimo mantiene su comportamiento. Para originales con revisión, la vinculación
de nuevas respuestas exige una emisión registrada por el circuito; no se borran
vínculos históricos ni se cambia su visualización/atención.

Los diarios EMIT incompletos bloquean nuevas asignaciones de número si no pertenecen
a una solicitud viva en esta instancia. El mapa de solicitudes activas es solo control
de ejecución; la verdad durable continúa en Alfresco y tras reinicio prevalece el diario.

## Límites y requisitos de habilitación

- No hay transacción distribuida entre original, propuesta y oficial. Los mutex y
  lease existentes cubren una instancia; no garantizan exclusión de otros hosts.
- Se exige escritor exclusivo. Los GET previos no impiden una carrera de un escritor
  externo después de comprobar la aprobación. Los cambios verificables bloquean la
  operación; no se afirma prevención absoluta ni inmutabilidad administrativa.
- Deben comprobarse con sesiones finales los permisos del original/propuesta/oficial
  y las ACL de lectura del destinatario, sin otorgarlas automáticamente.
- Siguen pendientes proveedor institucional real, política de emisión/destino,
  clasificación previa de propuestas, metadatos históricos, versionado y recuperación
  del adaptador. Las políticas de autoaprobación y reasignación no se resuelven aquí.
- La habilitación requerirá autorización separada, revisión del wiring y de las
  confirmaciones del entorno. Cambiar flags actuales no publica esta ruta interna.

## Evidencia de validación

Todas las escrituras de las pruebas son mocks. Se ejercitan el emisor real del código,
su numeración y la integración REST simulada, no emisiones reales de Alfresco.
El preflight anterior GET-only no acredita estas operaciones de escritura ni los
permisos de usuarios finales. En esta etapa no se hacen nuevas peticiones a DEV.

La validación reproducible está en el [README](../README.md). La regresión de navegador usa API local simulada; no prueba una ruta productiva nueva porque esa ruta no existe.
