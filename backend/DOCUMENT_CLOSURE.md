# Cierre documental V0.1

Guía principal del evaluador, evidencias y motor interno simulado. La política
funcional es preliminar; la aprobación institucional está pendiente.

## Estado operativo

- No hay endpoints ni interfaz de cierre, anulación, conocimiento, archivo o reapertura.
- No hay escritor Alfresco de cierre ni bandera para habilitarlo en DEV.
- Evaluar MET no autoriza ni ejecuta cierre. Todos los resultados del evaluador
  mantienen formalClosureAllowed, canRequestFormalClosure y writesEnabled en false.
- El motor solo registra decisiones en memoria, con executionMode SIMULATED obligatorio.
  Nunca deben importarse como decisiones institucionales ni proyectarse a gd:estado.
- Se preservan UUID, PDF, ACL, ubicaciones, atención individual, respuestas y revisión.
- Cierre integral, reapertura, propuestas mutables, emisión y derivaciones restringidas
  no se habilitan por instalar, probar o publicar este hito.

## Política funcional preliminar

El cierre ordinario es una decisión explícita de Dirección competente sobre su
dependencia; no exige un circuito artificial SOLICITADA/EN_REVISION. Una obligación
válidamente ATENDIDO basta preliminarmente, sin exigir PDF universalmente. Cada
responsable conserva su obligación: atender una hija no atiende la de origen.
Una propuesta aprobada no equivale a emisión; emitir tampoco atiende una obligación.

Solo las anulaciones con motivo y autorización institucional acreditada dejan de
ser exigibles; todas anuladas válidamente pueden resultar MET. Falta de evidencia
es INDETERMINATE; obligaciones pendientes o inconsistencias verificadas bloquean.
Una reasignación no sustituye implícitamente otra obligación.

Conocimiento requiere clasificación verificable, padrón completo y confirmación
individual explícita. La carpeta solo es un indicio. No cambia atención ni otras
confirmaciones. Los casos exclusivamente para conocimiento no usan cierre ordinario.
En casos mixtos se evalúan ambas obligaciones. Sin asignaciones ni clasificación
verificable, el resultado es indeterminado.

Cerrar DSA no cierra DTI aunque compartan UUID. El cierre integral necesita política
y autoridad específicas y permanece bloqueado. Reabrir es excepcional; archivo y
conservación son posteriores e independientes. No hay movimientos, ACL, retención
ni eliminación automáticos.

## Evaluador y preflight

`evaluateClosure({envelope, scope, evidence, evaluatedAt})` es puro. Exige sobre
validado y ámbito exacto `{type:'dependency',dependency:'dsa'|'dti'}` o
`{type:'document'}`. El integral devuelve BLOCKED. Devuelve versión, UUID, ámbito,
revisión, resumen de obligaciones/conocimiento, MET/BLOCKED/INDETERMINATE, requisitos,
códigos de bloqueo, evidencias verificadas/faltantes, políticas pendientes y fecha.
MET no certifica suficiencia de respuesta ni competencia formal.

`createClosurePreflight(settings,{fetchImpl,clock,institutionalProvider})` expone
internamente `preflight({documentId,scope},session)`. Revalida sesión, persona habilitada,
grupos paginados e IDs exactos. Exige ACL del actor, PDF cm:content y pertenencia a
bandejas configuradas mediante cm:contains, incluidas asociaciones secundarias.
Aplica la política de lectura adicional de Jefatura/Especialista. Rechaza ámbito
integral y dependencia ajena. No usa cuenta técnica ni organization.json.

Valida sobre y proyecciones, consulta propuestas/versiones y referencias accesibles,
y llama al lector de evidencias. Un GET final detecta cambios de propiedades durante
el recorrido. No verifica una firma del PDF original ni un snapshot transaccional.
Una referencia cm:references no prueba suficiencia ni emisión oficial. Las propuestas
opcionales verificadas no exigen emisión; la evidencia inaccesible sigue siendo incompleta.

## Contrato closureEvidence V1

Extensión opcional estricta del sobre; exactamente:

```json
{"schemaVersion":1,"cancellations":[],"classifications":[],"confirmations":[],"events":[]}
```

Campos comunes de registro: id, documentId, dependency, actorUserId, at,
documentRevision, requestKey, eventId. Campos adicionales por sección:

| Sección | Campos | Acción |
| --- | --- | --- |
| cancellations | assignmentId, reason | CANCEL_ASSIGNMENT |
| classifications | exclusive, recipientUserIds | CLASSIFY_KNOWLEDGE |
| confirmations | classificationId, recipientUserId | ACKNOWLEDGE_KNOWLEDGE |

Cada evento contiene exactamente id, action, recordId, actorUserId, dependency,
at, documentRevision, requestKey, payloadHash. ID: SHA-256 de JSON
`[documentId,actorUserId,requestKey,action]`. La huella cubre el registro completo
con claves de objetos ordenadas recursivamente y orden de arrays conservado.
Debe coincidir en todos los campos comunes. La huella NO es firma de autoría.

Se rechazan campos extra, versiones desconocidas, IDs/claves repetidos, eventos
huérfanos, reutilizados o alterados. UUID y dependencia deben coincidir. Revisión
histórica positiva y no superior a la actual; fechas UTC ISO válidas; identificadores
hasta 250 caracteres; motivo no vacío hasta 2000. El futuro escritor generará fechas
en servidor. Reintentar debe recuperar el registro, no añadir una copia.

Cancelación: asignación existente, misma dependencia, ANULADO y fecha no anterior
a su creación. El estado no acredita autorización; tampoco permite modificar una
atención histórica. Clasificación: una por dependencia, padrón único, completo y no
vacío. V1 no permite reclasificar o sustituir padrones sin contrato posterior.
Confirmación: actor igual al destinatario, perteneciente al padrón, clasificación
previa de la misma dependencia; una confirmación por destinatario/clasificación.

## Lectura y competencia de evidencias

`readClosureEvidence` solo consume el contexto autorizado del preflight; no es una
ruta pública por UUID. Revalida personas y membresías con credenciales del actor.
Filtra dependencia antes de consultar actores/competencias ajenos. No expone UUID
ni detalles de pruebas inaccesibles. La validación estructural del sobre completo
puede rechazar inconsistencias de otra sección sin revelar su contenido.

El proveedor interno GET-only `verifyClosureEvidence` recibe documento, dependencia,
acción, actor, registro, evento, hash, revisión y autorización del actor. Debe obtener
prueba REAL de autoría/competencia y autorización histórica; no repetir la entrada.
Su respuesta exige verified true, source alfresco, referencia y coincidencia de
documento/dependencia/acción/actor/registro/evento/hash/revisión y authorizedAt con
la fecha histórica. Sus groupIds se contrastan con membresías vigentes. Cancelar
y clasificar requieren Dirección actual de la misma dependencia.

Para clasificación, el proveedor acredita exclusive y el padrón completo obtenido
de fuente institucional; se compara el conjunto, no un subconjunto del JSON.
Se comprueba cada destinatario habilitado. Cada confirmación exige también prueba
vinculada a actor/evento, sin exigir Dirección al destinatario. Identidad deshabilitada
o dependencia cambiada produce evidencia incompleta, sin inventar vigencia histórica.

El lector transforma pruebas en atestaciones internas para el evaluador:
schemaVersion, UUID, dependencia y envelopeRevision actual; cancelaciones con motivo,
fecha y autorización; conocimiento con clasificación, padrón y confirmaciones.
Cada atestación incluye verified, source y referencia. No se acepta desde React.
No existe proveedor real ni fallback: las respuestas positivas de pruebas son mocks.

## Validación y preservación del sobre

El sobre base conserva schemaVersion 1 y todas sus secciones. parseAssignments llama
a validadores independientes y versionados de las extensiones conocidas antes de
devolver datos a los consumidores. Ausencia de extensiones es compatible históricamente;
malformación o versión conocida no soportada rechaza lectura/escritura dependiente.
No se añadieron estados o acciones al historial general.

envelopeExtensions compara la unión de campos ajenos a escritores documentales e
impide añadir, borrar o modificar esos campos accidentalmente. Las extensiones
desconocidas se preservan opacas y no conceden autoridad. Se aplica en
alfrescoDispatchRepository.persistEnvelope y alfrescoProposalAdapter.save.
La validación temprana impide asociar respuestas o crear PDFs antes de detectar
evidencias malformadas. El sobre completo sigue limitado a 256 KiB UTF-8; no se trunca.

## Contrato de decisión simulada V1

closureProcesses y closureOperations son opcionales conjuntamente. Cada elemento
exige schemaVersion 1 y executionMode SIMULATED; campos exactos, sin extras.
Ausencia significa sin decisiones registradas, no apertura institucional certificada.

Proceso:

```text
schemaVersion, executionMode, id, documentId, dependency, state=CERRADA,
authority {userId, functionalRole=direccion, dependency, reference, groupIds},
at, reason, sourceEnvelopeRevision, committedEnvelopeRevision,
evidence {sourceHash, evaluationHash, assignmentIds},
events [{id, operationId, action=CLOSE_INTERVENTION, actorUserId, at,
         requestKey, payloadHash}]
```

Operación:

```text
schemaVersion, executionMode, id, processId, documentId, dependency,
actorUserId, requestKey, reason, expectedEnvelopeRevision,
phase=PREPARED|COMMITTED, at, payloadHash, sourceHash, evaluationHash
```

ordinaryClosureContract define IDs y huellas canónicas. Proceso: UUID/dependencia;
operación: acción/UUID/actor/clave. La intención incluye motivo y revisión esperada.
sourceHash cubre el sobre, evidencias e historial, excluyendo revisión y cierres.
evaluationHash excluye solo fecha y revisión. No duplica PDFs ni historiales ajenos.
Los assignmentIds deben pertenecer al ámbito. Se valida correspondencia entre
proceso/evento/operación, actor, motivo, fechas, revisiones y huellas. Una dependencia
solo puede tener un proceso CERRADA; no admite PREPARED posterior sobre ella.

## Motor, aislamiento y recuperación

createOrdinaryClosureEngine expone decide y reconcile con entrada exacta: documentId,
scope por dependencia, expectedEnvelopeRevision, requestKey y reason. No recibe
autoridad ni approved/MET del cliente. Exige almacén genuino sellado mediante WeakSet
y Object.freeze, transporte distinto de global fetch y hostname .invalid.
createClosureSimulationStore solo usa copias privadas en memoria: no tiene I/O.
snapshot/replaceFixtureNode son herramientas de pruebas, no rutas productivas.

El proveedor GET-only authorizeOrdinaryClosure debe acreditar acción CLOSE_INTERVENTION,
actor, UUID, dependencia y revisión, con referencia y grupos contrastados. No basta MET,
rol de sesión o permisos técnicos. Falta de proveedor bloquea. La misma cola withDocument
usada por los otros servicios debe cubrir toda la operación; el motor no crea otra.

Secuencia: validar autoridad y preflight vigente; comprobar clave/intención/revisión;
guardar PREPARED (revisión +1); revalidar identidad, competencia y preflight; comparar
huellas; guardar decisión y COMMITTED juntos (revisión +1); leer/verificar resultado.
El mutex se libera en errores. Decisiones anteriores son inmutables; la fase es una
proyección monotónica del diario. Una clave distinta no reabre ni sobrescribe cierre.

Timeout PREPARED exige reconcile explícito, sin repetir decide. Solo continúa si
origen, revisión, requisitos y autoridad siguen válidos. Timeout COMMITTED recupera
el resultado existente tras revalidar identidad, competencia y ACL. No se borra un
pendiente incompatible: abortarlo requiere contrato posterior. No hay éxito basado
solo en respuesta incompleta ni reserva automática después de resultado incierto.

Un proceso nuevo no conserva decisiones: restaurar un snapshot es una simulación
explícita de pruebas y mantiene SIMULATED. No hay durabilidad, reinicio operativo,
conversión a cierre real ni transacciones distribuidas. La cola protege una instancia;
GET sucesivos no protegen de escritores externos ni cambios posteriores.

## Restricciones futuras después del cierre (no habilitadas)

Los controles por ámbito deberán incorporarse antes de los efectos en:

- createDispatch, attendAssignment y linkResponse del repositorio documental.
- execute CREATE/REVISE y reviewTransaction del adaptador de propuestas; mediante
  este último, decisiones de revisión y emisión de respuesta aprobada.
- issue/issueReviewed del servicio oficial, diferenciando nuevas operaciones de
  recuperación de emisiones legítimas ya iniciadas.
- Mutaciones genéricas del proxy y distribución/reintento de asociaciones, cuando
  afecten una intervención cerrada, sin bloquear lecturas ni otras dependencias.

La guarda de preservación no es una política de bloqueo posterior al cierre. Antes
de habilitar: aprobar competencias, proveedor real, ACL, resolución de pendientes,
procedimiento excepcional y vínculo a versión/hash del PDF original. El contrato real
no debe aceptar decisiones SIMULATED como evidencia institucional.

## Validación y privacidad

La suite ejercita lectura y escritores con mocks, ACL, revocación, evidencias,
idempotencia, cola, tamaño, cambios, timeout, restauración y preservación. Edge usa
bundle compilado y APIs locales simuladas. No acredita permisos o autoridad reales.
Ejecutar los comandos del README: suite completa, lint, build, Edge y git diff --check.

No publicar .env.local, evidencias DEV, manifiestos, bloqueos o artefactos. Esta guía
no contiene inventarios ni identificadores operativos. El 502 anterior no tiene log
persistido suficiente para identificar su causa; no se atribuye a un origen supuesto
ni se oculta con reintentos automáticos.

### Seguimiento de la prueba HTTP de despacho

- Prueba: `HTTP hierarchical dispatch preserves one PDF, parent obligations,
  traceability and document authorization`, en `src/dispatch.integration.test.js`.
- Se observó intermitentemente HTTP 502 en lugar de 201 durante la suite completa,
  en el caso simulado de pertenencia institucional secundaria con `/parents` denegado.
- El diagnóstico disponible identifica la aserción afectada. Se añadió el campo
  `error` del backend al mensaje de aserción, sin credenciales; no hay todavía una
  captura del código de error que permita explicar el fallo observado.
- La ejecución aislada posterior pasó y la última suite completa aprobó 282/282.
  Lint, build y regresión Edge también pasaron. Estos resultados no descartan la
  intermitencia ni acreditan comportamiento real de Alfresco.
- Causa no determinada. Pendiente capturar el diagnóstico si vuelve a reproducirse,
  sin añadir reintentos ni cambios funcionales para ocultarlo.
