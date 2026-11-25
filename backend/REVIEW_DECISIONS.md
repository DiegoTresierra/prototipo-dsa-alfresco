# Motor de decisiones documentales — etapa 3

Etapa 4: [APPROVED_RESPONSE_EMISSION.md](APPROVED_RESPONSE_EMISSION.md) reutiliza
la comprobación de aprobación para preparar emisión y conciliación internas.
Las validaciones y cifras de este documento describen la etapa 3.

## Alcance efectivo

`responseReviewDecisions.js` coordina SUBMIT, OBSERVE, ELEVATE, RETURN y APPROVE.
Reutiliza el motor puro, el sobre `reviewProcesses` y diario `reviewOperations`,
lector, transporte, revalidación institucional y mutex por original. No modifica
el servicio de emisión ni el módulo de jerarquía del compañero. No hay endpoints
mutables nuevos, flags productivos, nueva base de datos ni propiedades CMM.

El adaptador mantiene su barrera: transporte inyectado para mocks, destino `.invalid`
y simulationOnly. La nueva capacidad interna reviewTransaction está sujeta al mismo
bloqueo; no se conecta al arranque del servidor. No se realizaron peticiones a DEV.

## Transiciones y permisos

| Acción | Origen → destino | Autoridad necesaria |
| --- | --- | --- |
| SUBMIT especialista | BORRADOR → EN_REVISION_JEFATURA | Autor vigente y Jefatura resuelta institucionalmente |
| SUBMIT Jefatura/Dirección | BORRADOR → EN_REVISION_DIRECCION | Autor vigente y Dirección revisora verificada |
| OBSERVE | EN_REVISION_JEFATURA → OBSERVADA | Jefatura asignada y supervisión vigente |
| ELEVATE | EN_REVISION_JEFATURA → EN_REVISION_DIRECCION | Jefatura asignada y Dirección destinataria verificadas |
| RETURN | EN_REVISION_DIRECCION → OBSERVADA | Dirección asignada y autor destinatario vigente |
| APPROVE | EN_REVISION_DIRECCION → APROBADA | Dirección asignada; nunca aprobación propia por defecto |

OBSERVADA necesita nueva revisión mediante el adaptador anterior antes de presentar
nuevamente. Las rutas iniciadas por Jefatura o Dirección no pasan por una revisión
artificial de Jefatura. No se permite actuar a cualquier Jefatura o Dirección por
compartir dependencia: debe coincidir con el destinatario registrado y con la
resolución institucional actual. Un cambio de revisor requiere decisión de reasignación
futura; esta entrega lo bloquea, no lo sustituye automáticamente.

El motor puro invalida una aprobación al registrar una revisión posterior y conserva
el evento previo. El adaptador de edición sigue limitado a BORRADOR/OBSERVADA; no
se abre edición de APROBADA en esta etapa. Una modificación externa provoca bloqueo
de integridad, no una autorización automática para volver a editar o emitir.

## Proveedor institucional pendiente

Interfaz interna de solo lectura:

```
provider.resolveReviewers({
  processId, documentId, authorUserId, authorRole, dependency,
  stage: 'jefatura' | 'direccion'
}) -> { verified: true, reviewers: [{ userId, groupIds }] }
```

Debe implementar resolución viva de supervisión/competencia mediante relaciones
reales de Alfresco. La pertenencia a un grupo funcional no demuestra por sí sola
supervisión: esa comprobación es obligación del proveedor institucional confiable.
El servicio exige un único resultado, evidencia de IDs GROUP_ y vuelve a consultar
usuario habilitado y grupos paginados para comprobar IDs exactos, rol, dependencia
y pertenencia a los grupos declarados. No confía en nombres, sufijos ni datos React.

El proveedor institucional consulta las relaciones activas en Alfresco y las membresías vigentes. La ausencia de proveedor, las relaciones ambiguas y la auditoría pendiente bloquean la resolución. Las rutas mutables de decisión siguen desconectadas.

## Integridad de eventos

Los eventos nuevos conservan los campos anteriores y añaden `review` opcional:

```
{ schemaVersion: 1, processId, affectedRevision,
  snapshot: { versionId, contentSha256, metadataSha256 },
  recipient: { userId, functionalRole, dependency } | null }
```

Actor, rol, dependencia, fecha backend, acción, motivo, clave y revisión esperada
permanecen en el evento. El UUID de propuesta y original pertenecen al proceso.
La aprobación conserva la huella/version aprobada y referencia al evento que
identifica al aprobador. Observaciones no sustituyen eventos anteriores.

El parser reproduce el historial y valida snapshot, destinatario, revisión afectada
y correspondencia entre actor decisor y revisor previamente asignado. Los eventos
antiguos sin `review` siguen siendo legibles. Para decidir sobre una revisión antigua
sin enrutamiento institucional registrado se exige conciliación; no se inventa revisor.
La validación estructural del historial no certifica decisiones escritas por terceros.

Antes de decidir se confirma ACL y pertenencia institucional del original. El actor
debe poder modificar el original para persistir el sobre. La propuesta y la versión
se consultan con sus credenciales, comprobando asociación, metadatos históricos,
versión actual, firma PDF y SHA-256; además se compara el contenido actual.
Estos checks se repiten antes del commit junto con la revalidación del actor y la
resolución del destinatario. Una ACL de escritura no concede autoridad de aprobación.

## Idempotencia, concurrencia y conciliación

La entrada interna acepta exclusivamente documentId, processId, action, requestKey,
expectedRevision, expectedVersionId y reason. No acepta actor, rol, approved ni
otros campos privilegiados. Las huellas provienen del proceso verificado en Alfresco.

El diario existente admite las cinco acciones de decisión. PREPARED se persiste
antes del evento; COMMITTED se guarda junto al nuevo proceso en el mismo PUT del
sobre. Se hace GET de comprobación y verificación final de la propuesta. Todo ello
está dentro de la cola compartida con propuestas, atención y despacho.

La clave se vincula a actor/original, acción, proceso, revisión, versión, motivo,
snapshot y destinatario. Un reintento idéntico devuelve `repeated: true` y el proceso
actual; no revierte decisiones posteriores. Una clave reutilizada con datos distintos
se rechaza. El estado anterior se reconstruye para verificar recibos históricos.

Si un PUT o comprobación final falla, se intenta dejar UNCERTAIN, incluso si el
evento llegó a persistir. No se borra ni duplica la decisión. El lector devuelve
UNAVAILABLE mientras el proceso tenga operaciones pendientes, evitando presentar
una aprobación pendiente de conciliación como disponible. La lectura interna del
contenido continúa verificándose para permitir la conciliación.

`reconcile` exige mismo actor habilitado, payload, competencia y contenido verificado;
relee el sobre antes de continuar y confirma el evento existente o completa el pendiente.
Una operación pendiente bloquea otras sobre el original. Si también falla el diario,
PREPARED puede ser el último registro durable. Un fallo previo al PUT de intención no
produce decisión. No se promete transacción distribuida ni prevención absoluta de
carreras con escritores externos entre GET y PUT. Sigue vigente el límite total
de 256 KiB y la restricción de instancia/escritor exclusivos.

## Errores y respuestas

| Situación | Código |
| --- | --- |
| Proveedor pendiente | REVIEW_INSTITUTIONAL_PROVIDER_PENDING |
| Revisor no acreditado / ambiguo / indisponible | REVIEW_REVIEWER_NOT_VERIFIED / REVIEW_REVIEWER_AMBIGUOUS / REVIEW_REVIEWER_UNAVAILABLE |
| Revisor cambiado / enrutamiento histórico ausente | REVIEW_REVIEWER_CHANGED / REVIEW_ROUTING_REQUIRED |
| Estado incorrecto / falta revisión tras observación | REVIEW_INVALID_STATE / REVIEW_NEW_REVISION_REQUIRED |
| Revisión / versión obsoleta | REVIEW_STALE_REVISION / REVIEW_STALE_VERSION |
| Contenido o metadatos alterados | REVIEW_CONTENT_OR_METADATA_CHANGED |
| Permisos insuficientes / dependencia ajena | REVIEW_PERMISSION_INSUFFICIENT / REVIEW_DEPENDENCY_MISMATCH |
| Repetición válida / clave incompatible | repeated:true / REVIEW_IDEMPOTENCY_CONFLICT |
| Resultado incierto / conciliación pendiente | REVIEW_RESULT_UNCERTAIN / REVIEW_RECONCILIATION_REQUIRED |
| Autoaprobación sin política | REVIEW_SELF_APPROVAL_POLICY_PENDING |

Los errores de revocación de identidad conservan los códigos del resolvedor
institucional. No se expone al cliente el error upstream crudo ni credenciales.
No hay rutas que publiquen estas operaciones en esta etapa.

## Validación y habilitación futura

Las pruebas usan transporte REST y proveedor simulados. Incluyen circuito completo,
inicios directos, observaciones, revisión posterior, actor/revisor incorrectos,
dependencia ajena, revocación, ACL denegada, alteraciones, idempotencia, carreras,
timeouts, reinicio, conciliación, límites y parser compatible. Se conservan
asignaciones, atención, historial anterior, responsabilidades y gd:estado.

Para habilitar se necesita autorización expresa, proveedor real validado, permisos
de las sesiones finales y política de autoaprobación/reasignación. También deben
resolverse las verificaciones reales del adaptador de la etapa 2: metadatos históricos,
versionado, permisos y recuperación. No se heredan como prueba de estas escrituras
los GET previos hechos con la cuenta técnica.

Debe comprobarse con las sesiones finales el acceso del revisor destinatario al
original y a la propuesta. Resolver al destinatario no concede ACL. Las rutas de
lectura actuales conservan su política; si la revisión institucional legítima exige
una lectura adicional del revisor, deberá integrarse específicamente y con pruebas,
sin abrir acceso general por UUID ni sustituirlo por el JSON del organigrama.

El servicio de emisión no consume aprobaciones todavía y permanece sin cambios.
No se implementa cierre, atención automática ni despacho Jefatura → Especialista.

## Validación reproducible

Ejecutar la suite, lint, build y regresión descritos en el [README](../README.md). Las pruebas usan fixtures y no acreditan jerarquía, permisos ni escrituras reales en Alfresco.
