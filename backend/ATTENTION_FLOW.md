# Atención individual y respuestas documentales

## Identidad documental

El emisor original, creador en Alfresco y actor del despacho son conceptos diferentes. El origen institucional procede de metadatos verificados, no de cm:author, nombres de usuario o dependencia del último despacho. Cuando falta, se informa como no registrado sin rellenar históricos automáticamente.

Emitidos se consulta desde Alfresco y no desde confirmaciones del navegador. Un documento recibido por asociación secundaria conserva el UUID y no se convierte en emisión propia del receptor.

## Atención

POST /api/documents/assignments/attend requiere sesión, CSRF e identidad vigente. Recibe documentId, assignmentId, requestKey y responseDocumentId opcional.

Solo el titular institucional de una asignación activa puede atenderla. La operación cambia únicamente esa asignación a ATENDIDO y registra actor, fecha e historial. Otra Jefatura no puede atender una obligación ajena aunque lea el PDF.

La repetición con la misma clave compatible no duplica eventos. Una respuesta referenciada debe estar vinculada y verificada; no basta suministrar su UUID.

El resumen distingue pendientes, atendidas y anuladas. readyForClosureReview no es cierre formal; formalClosureAllowed sigue false. No se sincroniza automáticamente gd:estado.

## Respuestas emitidas y propuestas

Una respuesta emitida es otro PDF, con UUID propio, vinculado al original mediante cm:references y el registro persistente correspondiente. No es una copia del PDF original.

- GET /api/documents/response-candidates: emisiones propias candidatas para Dirección.
- POST /api/documents/assignments/response: vinculación autorizada, con assignmentId opcional para respuesta documental de Dirección.
- GET /api/documents/assignment-responses: vínculos y disponibilidad verificable.
- GET /api/documents/response-content: exige original autorizado, vínculo persistido, asociación y ACL del actor.

La respuesta candidata debe ser cm:content PDF, emisión propia del usuario, ubicada en Emitidos institucional y con origen compatible. La cuenta técnica no concede acceso al actor. Si la asociación se creó pero falló el sobre, se conserva el UUID y se concilia el vínculo; no se vuelve a emitir.

Para originales con procesos de revisión, las nuevas respuestas deben proceder de una emisión registrada por el circuito aprobado. Los reintentos históricos legítimos conservan su validación; no se eliminan vínculos anteriores.

Propuesta, aprobación y emisión son estados distintos. Preparar, observar, elevar, aprobar, emitir o vincular una respuesta no atiende automáticamente ninguna asignación. La atención final sigue siendo explícita e individual.

El circuito nuevo permanece interno y bloqueado para escrituras reales. Véanse [propuestas](RESPONSE_PROPOSALS.md), [decisiones](REVIEW_DECISIONS.md) e [integración aprobada](APPROVED_RESPONSE_EMISSION.md).
