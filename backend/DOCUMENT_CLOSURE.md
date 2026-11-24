# Cierre documental V0.1

Guía principal del evaluador, evidencias, motor simulado y adaptador Alfresco. La política
funcional es preliminar; la aprobación institucional está pendiente.

## Estado operativo

- Hay endpoint de evaluación e interfaz Dirección; los POST de cierre y conciliación
  están preparados, pero deshabilitados por defecto e independientemente del despacho.
- No hay operaciones de anulación, confirmación de conocimiento, archivo ni reapertura.
- Evaluar MET no autoriza ni ejecuta cierre. Todos los resultados del evaluador
  mantienen formalClosureAllowed, canRequestFormalClosure y writesEnabled en false.
- El motor simulado conserva V1/SIMULATED. El adaptador Alfresco usa exclusivamente
  V2/ALFRESCO. Se rechaza promover registros simulados; no se proyecta gd:estado.
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

## Restricciones después del cierre

Los controles por ámbito se incorporan antes de los efectos en:

- createDispatch, attendAssignment y linkResponse del repositorio documental.
- execute CREATE/REVISE y reviewTransaction del adaptador de propuestas; mediante
  este último, decisiones de revisión y emisión de respuesta aprobada.
- issue/issueReviewed del servicio oficial, diferenciando nuevas operaciones de
  recuperación de emisiones legítimas ya iniciadas.
- El proxy ya rechaza mutaciones de nodos existentes; solo permite creación genérica
  controlada y lectura. No se amplía esa allowlist. El reintento de distribución
  comprueba la intervención destinataria, sin bloquear automáticamente otro ámbito.

La guarda de preservación se complementa con closedInterventionPolicy: solo una
decisión V2/ALFRESCO bloquea su dependencia; SIMULATED no concede ese efecto. Antes
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

## Hito 6: autoridad y persistencia preparada, habilitación pendiente

createClosureAuthority exige identidad real habilitada mediante people/-me-, grupos
personales paginados, rol Dirección y dependencia exacta, revisión del sobre y ACL
del documento. La competencia es la intersección del grupo funcional configurado
con el grupo de dependencia; nunca el grupo funcional por sí solo. Las consultas
GET realizadas confirmaron una función compartida y dependencias distintas en la
API clásica; v1 de miembros mostró omisiones. La consulta de grupos personales con
la cuenta técnica fue denegada: no sustituye la comprobación de la sesión del actor.
No se incluyen identidades personales, UUID ni evidencias DEV en esta guía.

Se preserva el resolvedor general: pertenencias ambiguas, incluidas múltiples
dependencias sin contexto institucional resuelto, siguen rechazadas. No se amplían
privilegios ni se interpreta organization.json como autoridad. El proveedor de cierre
ordinario no acredita retrospectivamente anulaciones o confirmaciones: esa prueba
histórica sigue pendiente y los casos incompletos continúan bloqueados.

createAlfrescoClosureStore conserva el mismo JSON y mutex del repositorio documental.
Lee con el actor y reautoriza antes de cada escritura. La identidad técnica debe
coincidir con la configurada, estar habilitada y ser no administrativa, con update
efectivo sobre el nodo. El PUT solo incluye gd:asignaciones. Compara el origen completo,
respeta 256 KiB, conserva decisiones y extensiones, verifica mediante GET y no toca
aspectos, ACL, PDF ni proyecciones. Se mantienen IDs, revisiones e idempotencia del motor.

Los elementos de closureProcesses/closureOperations aceptan dos pares versionados:
V1/SIMULATED y V2/ALFRESCO. Proceso y operación deben coincidir. Nunca se permite al
adaptador REST guardar SIMULATED ni leerlo como cierre real. La revisión del sobre
base permanece en schemaVersion 1; no hay CMM nuevo ni conversión automática.

Endpoints protegidos:

- GET /api/documents/closure?documentId=...: preflight y autoridad vigentes; expone
  canClose solo con permisos, requisitos, ausencia de pendientes y habilitación completa.
- POST /api/documents/closure: confirmación explícita. Entrada exacta: documentId,
  expectedEnvelopeRevision, requestKey y reason. Dependencia y actor salen de sesión.
- POST /api/documents/closure/reconcile: conciliación explícita con la misma entrada.

Los POST exigen sesión, CSRF y guardas independientes. La UI de Dirección consulta
requisitos y oculta la acción hasta canClose. Exige constancia, conserva clave en el
intento y recupera los datos del diario pendiente en una nueva consulta. No decide
por visibilidad del botón ni acepta respuesta incompleta como cierre confirmado.

Variables nuevas, NO configuradas automáticamente ni en .env.local:

- DOCUMENT_CLOSURE_WRITES_ENABLED=false por defecto.
- DOCUMENT_CLOSURE_ENVIRONMENT: solo se admite dev; el piloto también debe ser dev.
- DOCUMENT_CLOSURE_EXPECTED_TARGET: coincidencia exacta e independiente con el destino.
- DOCUMENT_CLOSURE_ACKNOWLEDGEMENT: requiere la confirmación explícita de operador
  single-instance-exclusive-writer-dev-closure. No habilitarla antes de revisión.

También se exige piloto validado y lease de instancia única realmente adquirido en
este proceso. Cambiar ALFRESCO_TARGET no basta. Preproducción no está habilitada.
La exclusión local no protege de otra máquina, otro lease o escritores externos.

La validación final añadió CLOSURE_REAL_READINESS_BLOCKED: aun con variables y lease
correctos, los destinos reales NO pueden escribir hasta implementar y verificar el
protocolo duradero de envío y la exclusividad. Solo los transportes de fixtures .invalid
continúan ejercitando PUT simulados. No quitar esta guarda para realizar la prueba.

Una escritura incierta se verifica por GET y nunca se repite ciegamente. Si el diario
PREPARED/COMMITTED existe, puede conciliarse tras recrear los servicios desde Alfresco;
se prueba con mocks. Si no se confirmó ni el primer diario, la instancia activa bloquea
otro PUT mediante un registro volátil de incertidumbre. No hay prueba de ausencia de
una petición tardía tras reinicio: se requiere detener escrituras y conciliación humana
antes de reactivar. Esta limitación y la ausencia de compare-and-swap/transacción
distribuida impiden declarar la habilitación real segura sin el procedimiento operativo.

Estado de validación: implementación y PUT/GET, HTTP, concurrencia, recuperación y UI
probados con mocks. En DEV solo se hicieron GET de grupos e identidades; no hay cierre
real ni prueba de sesiones finales o update del actor/documento concreto.

Antes del primer PUT autorizado debe presentarse un PDF de prueba expresamente
designado en una bandeja institucional existente, su preflight MET, la sesión Dirección
y sus grupos/ACL reales. Operaciones previstas: dos PUT del sobre (PREPARED y COMMITTED)
y GET de verificación, sin mover PDF ni cambiar gd:estado. Conservar clave y registro;
ante timeout detener otros cierres, leer/conciliar, nunca borrar la decisión ni
reutilizar SIMULATED. No se ha elegido ni alterado un documento institucional para ello.
No habilitar mientras estos controles o la conciliación del entorno no estén resueltos.

## Evaluación final de preparación y recuperación

No se dispone de una sesión real de Dirección accesible al proceso de validación;
las sesiones del BFF son memoria de su proceso y no se importan desde la cuenta técnica.
La prueba con actor requiere abrir la aplicación y verificar people/-me-, membresías,
documento y GET /api/documents/closure en esa misma sesión, sin exportar cookies ni tokens.
La cuenta técnica de lectura no acredita al actor. Pertenecer a varias dependencias
continúa siendo ambiguo para el resolvedor general: se rechaza, no se infiere competencia
global. Esa política de sesión múltiple necesita un contrato posterior explícito.

El PDF de prueba seleccionado se identifica solo en la comunicación privada del trabajo,
no en esta guía pública. Antes de proponer un cierre debe estar atendida su obligación
vigente mediante el flujo legítimo y una evaluación nueva debe alcanzar MET. No se ha
modificado su asignación ni autorizado esa atención como parte de esta validación.

### Clasificación diagnóstica

closureRecoveryAssessment.assessClosureRecovery es puro y no ejecuta ni autoriza
escrituras. Solo recibe un sobre validado y una intención vinculada a documento,
dependencia, ID de operación, huella de intención/origen y revisión esperada:

| Resultado | Evidencia mínima |
| --- | --- |
| NOT_EXECUTED | Prueba positiva de transporte nunca enviado, vinculada a la intención y procedente de un diario duradero verificado; escritores anteriores detenidos |
| APPLIED | Operación V2/ALFRESCO COMMITTED y proceso/evento estrictamente válidos, vinculados a la intención |
| PENDING | PREPARED comprobado y origen/revisión coincidentes |
| UNCERTAIN | No hay registro y no existe prueba positiva de no envío, aunque el documento parezca idéntico |
| CONFLICT | Identidad/huella distintas, contrato inválido o modificación no atribuible |

Todas devuelven mayAutomaticallyWrite e institutionalDecision en false. APPLIED es
un diagnóstico del recibo, no una nueva decisión ni prueba criptográfica de autoría.
La entrada dispatchProof del caso NOT_EXECUTED es un contrato para un lector de
transporte futuro: schemaVersion 1, source durable-dispatch-journal, verified true,
state NEVER_DISPATCHED, allPriorWritersStopped true, reference, documentId, operationId
y payloadHash coincidentes. No existe todavía un lector que produzca esa prueba real;
las pruebas positivas son sintéticas. Un flag del cliente no puede levantar la guarda.

### Solución propuesta para la incertidumbre sin primer diario

1. Antes de aceptar escrituras, aislar todos los escritores del UUID y conservar el
   mismo mutex. Confirmar que no hay otros backends, herramientas administrativas o
   clientes con update actuando sobre ese sobre. Un lease local no prueba esto.
2. Preparar un diario operativo privado duradero, separado del repositorio público,
   con identidad de instancia/arranque, destino, UUID, clave/ID estable, huellas,
   revisión esperada e intento. No almacena tokens ni funciona como autoridad documental.
   Es una propuesta pendiente; no se creó otro almacén ni base de datos en esta entrega.
3. Persistir y sincronizar INTENT_DURABLE antes de cualquier red. Persistir y sincronizar
   SEND_STARTED_DURABLE inmediatamente ANTES de enviar el PUT. Si no se puede garantizar
   esa secuencia o recuperar el diario, no enviar ni reintentar.
4. Tras respuesta, leer y validar en Alfresco y registrar el recibo. Un COMMITTED
   vinculado se recupera sin otra decisión. Un PREPARED coincide con una preparación
   observada; solo continúa mediante conciliación explícita y autoridad vigente.
5. Si hubo SEND_STARTED sin registro visible, mantener UNCERTAIN, no NOT_EXECUTED.
   Un timeout, varios GET iguales o una espera arbitraria no prueban ausencia. Exigir
   evidencia de terminación/cancelación del intento en el repositorio o un mecanismo
   de exclusión/idempotencia del repositorio que haga imposible una aplicación tardía.
6. Al reiniciar, cargar todos los intentos sin recibo antes de aceptar mutaciones;
   congelar los UUID afectados, conservar claves y evidencias y conciliar. No limpiar
   automáticamente intentos ni iniciar otra clave para resolver una incertidumbre.

El diario propuesto evita perder conocimiento del envío, pero NO añade compare-and-swap,
transacciones distribuidas ni protección frente a un escritor externo. Si no es posible
demostrar exclusividad y terminar/frenar intentos tardíos, se necesita un mecanismo
atómico del repositorio, sujeto a diseño y autorización separados. No se implementa
una extensión Alfresco ni se supone que un GET previo equivale a ese mecanismo.

### Escritores y puntos de protección

El repositorio de despacho/atención/respuestas y las rutas de cierre y recuperación
de distribución comparten withDocument del repositorio. El adaptador de propuestas
recibe esa misma cola y permanece restringido a mocks. La emisión oficial tiene su
cola de numeración; no escribe el sobre original directamente y la integración de
respuesta revisada entra por reviewTransaction. El proxy prohíbe PUT/DELETE de nodos
existentes y propiedades privilegiadas en creación. Estos controles son del BFF.

gd:asignaciones no es una propiedad protegida en el modelo consultado. Un cliente REST
con update puede eludir el BFF; no se realizó una escritura para demostrarlo ni se
cambiaron ACL. El control de otros escritores, las ACL de la sesión elegida, el origen
de evidencia histórica y la recuperación duradera siguen siendo condiciones bloqueantes.

### Procedimiento reservado para una futura primera prueba

Después de resolver los bloqueos: confirmar PDF/ámbito y usuario mediante GET con su
sesión, comprobar MET y autoridad, conservar en privado revisión y huella de origen,
y aprobar expresamente el intento. La petición contendrá documentId,
expectedEnvelopeRevision obtenido del GET actual, requestKey estable y constancia.
El backend añadirá actor, dependencia, fecha, pruebas y procesos; no se envía autoridad
desde el navegador. Se prevén solo PUT de PREPARED y COMMITTED y GET de verificación.
Verificar mismo UUID/PDF, gd:estado y asignaciones inalterados y recibo de cierre propio,
con otro ámbito intacto. Reinicio y repetición de la misma clave deben recuperar el
recibo sin incrementar decisiones. Ante cualquier incertidumbre, detener escrituras
y conservar evidencia privada; no borrar registros, cambiar clave o atender obligaciones
para forzar MET. La ejecución real sigue sin autorizarse.

### Ventana coordinada y precondición de escritura

La coordinación con otros desarrolladores reduce el riesgo, pero no impide escrituras
de otros clientes, otra instancia o la misma cuenta técnica. No se registra como
exclusividad global y no levanta CLOSURE_REAL_READINESS_BLOCKED. No se incorpora otro
contador, base de datos ni fuente documental local; el diario de transporte anterior
sigue siendo una propuesta operativa no implementada, no una autoridad documental.

La inspección GET separa ETag de metadatos y de contenido. Un ETag en /content no prueba
que proteja PUT /nodes/{id} ni cambios a gd:asignaciones. cm:versionable y versionLabel
permiten identificar versiones, pero no prueban una precondición de actualización.
Tampoco se interpreta la transacción interna de un PUT como una comparación atómica
con el GET anterior del cliente. No se añade If-Match sin soporte demostrado.

Fuentes primarias consultadas, fijadas a un commit público (no se ha certificado que
sea el código exacto del despliegue DEV):

- [Actualización de propiedades](https://github.com/Alfresco/alfresco-community-repo/blob/43453686d21f25d0ef33bf060c693d3c9be272ad/remote-api/src/main/java/org/alfresco/rest/api/impl/NodesImpl.java#L2756).
- [Recurso de actualización de nodos](https://github.com/Alfresco/alfresco-community-repo/blob/43453686d21f25d0ef33bf060c693d3c9be272ad/remote-api/src/main/java/org/alfresco/rest/api/nodes/NodesEntityResource.java).
- [Despacho PUT del framework](https://github.com/Alfresco/alfresco-community-repo/blob/43453686d21f25d0ef33bf060c693d3c9be272ad/remote-api/src/main/java/org/alfresco/rest/framework/webscripts/ResourceWebScriptPut.java).

En ese recorrido no se encontró validación If-Match o de versión esperada del sobre.
No constituye prueba universal de ausencia: podría existir una personalización del
despliegue. La condición pendiente es una precondición atómica, documentada y comprobada
para las propiedades de este nodo, que rechace una escritura obsoleta sin alterar nada.
Debe cubrir la carrera entre GET/PUT y los PUT tardíos tras timeout. La idempotencia
del comando y su recibo deben conservarse frente a esos casos, no solo el estado final
cuando todas las peticiones terminan normalmente. Un ensayo de escritura para comprobar
este soporte necesitaría una autorización separada y no se realiza en esta etapa.

Preparación de la ventana, todavía sin horario ni primera escritura autorizados:

1. Acordar inicio/fin, operadores y compromiso de no escritura con el compañero;
   mantener un único backend. Registrar expresamente los clientes que no se pueden
   bloquear. El lease local no modifica esas limitaciones.
2. Utilizar un PDF designado exclusivamente de ensayo. Confirmar mediante GET que
   no quedan obligaciones exigibles pendientes ni operaciones inciertas. No atender,
   anular o reclasificar obligaciones automáticamente para conseguir MET.
3. Abrir una sesión auténtica de Dirección; verificar /api/auth/me y, con las mismas
   credenciales del actor, identidad, grupos, lectura del nodo y contenido PDF no vacío.
   No copiar cookies o tokens al informe. La cuenta técnica no sustituye al actor.
4. Consultar GET /api/documents/closure?documentId=... en esa sesión y conservar en
   privado ámbito, revisión y resultado. La carpeta primaria no reemplaza la prueba
   de cm:contains institucional, incluidas asociaciones secundarias.
5. Mantener escrituras deshabilitadas si falta el mecanismo atómico anterior o si no
   puede verificarse la sesión, la integridad o el documento. La aceptación de riesgo
   de una ventana coordinada no demuestra soporte de If-Match ni resuelve un PUT tardío.
6. Solo después de resolver los bloqueos y obtener autorización específica: conservar
   clave estable, constancia, huella/revisión inicial y ejecutar un único flujo de cierre
   (PREPARED, COMMITTED y GET posteriores), sin alterar PDF, ACL o gd:estado.
7. Ante timeout, detener los nuevos intentos del UUID; comprobar recibos y clasificar
   PENDING/APPLIED/UNCERTAIN/CONFLICT. Un GET sin registro nunca prueba NOT_EXECUTED.
   No usar otra clave ni reiniciar para borrar la incertidumbre. Conservar evidencia
   privada y coordinar con los operadores antes de reactivar.

Conclusión operativa: la prueba real sigue bloqueada hasta demostrar la precondición
o un mecanismo equivalente del repositorio, y completar sesión y elegibilidad del PDF.

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
