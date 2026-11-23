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

- GET /api/documents/response-candidates: emisiones oficiales propias verificadas para Dirección, Jefatura y Especialista. Reutiliza la consulta de Emitidos y rechaza cobertura parcial; un borrador o un registro sin identidad oficial no es candidato.
- POST /api/documents/assignments/response: vinculación autorizada. Dirección conserva la competencia documental de su ámbito. Jefatura y Especialista requieren una asignación propia vigente; si solo se envía el UUID original se resuelve únicamente una asignación inequívoca desde Alfresco. Varias obligaciones propias requieren selección explícita, nunca un responsable elegido arbitrariamente.
- GET /api/documents/assignment-responses: vínculos y disponibilidad verificable.
- GET /api/documents/assignment-responses?documentId=...&direction=originals: consulta inversa desde una emisión oficial. Comprueba ACL del actor en ambos nodos y la relación registrada en el sobre original. Una asociación aislada o inaccesible no se presenta como respuesta confirmada. `direction` no admite anexos ni antecedentes.
- GET /api/documents/response-content: exige original autorizado, vínculo persistido, asociación y ACL del actor.

La respuesta candidata debe ser cm:content PDF, emisión propia del usuario, ubicada en Emitidos institucional y con origen compatible. Se valida el contrato de código, ciclo, `gd:numero`, identidad idempotente, autoría y fecha de emisión; el contenido debe ser un PDF no vacío. Antes de las escrituras se revalida la identidad institucional y se compara la huella del documento reutilizado. No se modifica su número, identidad, autoría, fecha de emisión ni contenido/versiones. La cuenta técnica no concede acceso al actor. Si la asociación se creó pero falló el sobre, se conserva el UUID y se concilia el vínculo; no se vuelve a emitir.

El cliente conserva únicamente la clave idempotente pendiente entre recargas, no una fuente documental. El sobre original y la asociación Alfresco son la evidencia operativa. El mutex de ambos UUID se adquiere en orden estable; la revisión y la lectura previa del sobre detectan cambios observables. No existe CAS distribuido: el piloto mantiene la restricción de un backend/escritor coordinado, y no se certifican escrituras reales ni protección frente a modificaciones externas. Una operación parcial no concede un permiso ni completa una obligación.

Para originales con procesos de revisión, las nuevas respuestas deben proceder de una emisión registrada por el circuito aprobado. Los reintentos históricos legítimos conservan su validación; no se eliminan vínculos anteriores.

Propuesta, aprobación y emisión son estados distintos. Preparar, observar, elevar, aprobar, emitir o vincular una respuesta no atiende automáticamente ninguna asignación. La atención final sigue siendo explícita e individual.

El circuito nuevo permanece interno y bloqueado para escrituras reales. Véanse [propuestas](RESPONSE_PROPOSALS.md), [decisiones](REVIEW_DECISIONS.md) e [integración aprobada](APPROVED_RESPONSE_EMISSION.md).
