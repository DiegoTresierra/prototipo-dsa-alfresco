# Atención individual, respuestas e identidad documental

Implementación en `feature/jerarquia-despacho-interno`. No se ejecutaron escrituras reales ni cambios de modelo, propiedades o ACL en DEV. Se conservaron los archivos de configuración local.

## Diagnóstico del emisor

La confusión concreta estaba en `AssignmentsPage.jsx`: la columna «Emisor» mostraba `dispatch.senderUserId` y `dispatch.senderDependency`. Esos campos describen correctamente al actor del despacho interno, no al emisor del PDF. Además, `nodeToDocument` dejaba `originatingDependency` vacío y usaba `createdByUser` como remitente sin distinguir el registro de creación del origen institucional.

Se verificó mediante GET en DEV:

- `gd:identificacion` contiene `gd:dependenciaOrigen`, `gd:remitente`, `gd:dependenciaDestino`, `gd:destinatario`, `gd:numero` y `gd:fechaDocumento`. Son propiedades existentes `d:text`; no se creó ninguna.
- El PDF `18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097` no tiene aplicado `gd:identificacion` ni declara `gd:dependenciaOrigen`. Tiene `createdByUser.id = DTI_T` y ubicación primaria en el UUID configurado para Emitidos DTI.
- `cm:author` contiene «Home». Su definición real es texto opcional y no protegido de autoría, sin semántica de dependencia institucional. No se utiliza para decidir el origen.
- `gd:tramite` y las tres propiedades de persistencia de asignaciones ya están desplegados. No se modificó su definición.
- El aspecto estándar `cm:referencing` y la asociación `cm:references` existen; la asociación admite destinos `cm:content` y múltiples relaciones.

Se mantiene intacto `senderDependency = dsa` en un despacho realizado desde DSA. La interfaz diferencia «Emisor documental original», «Creado en Alfresco por» y «Despachado por». Cuando el origen documental está declarado, muestra `gd:dependenciaOrigen`; cuando falta, muestra «No registrado». Emitidos DTI y `DTI_T` se presentan como evidencias separadas, sin inventar un valor histórico del origen. `gd:dependenciaDestino` tampoco se confunde con emisor o responsable actual.

Para futuras emisiones, la propuesta mínima es aplicar el aspecto existente `gd:identificacion` durante la creación y registrar `gd:dependenciaOrigen` desde la dependencia verificada de la sesión en backend. Registrar el remitente formal en `gd:remitente` solo con información institucional validada; el usuario que carga el PDF permanece en `createdByUser`. No inferir fecha formal del PDF de la fecha de carga ni suplantar al firmante con el usuario técnico. Este estampado futuro no se introdujo en el bloque de distribución DTI–DSA durante esta entrega; los datos históricos faltantes no se rellenan automáticamente.

## Atención implementada

`POST /api/documents/assignments/attend` recibe:

```json
{
  "documentId": "UUID-original",
  "assignmentId": "ID-propio-de-asignación",
  "requestKey": "clave-estable-del-reintento",
  "responseDocumentId": null
}
```

El backend exige sesión activa, capacidad de lectura/escritura, rol Dirección/Jefatura/Especialista y dependencia válida. Comprueba el PDF original `cm:content`, la ACL del actor y su pertenencia institucional con asociaciones primarias o secundarias `cm:contains`. La asignación se obtiene de Alfresco y debe pertenecer al mismo usuario, rol y dependencia de la sesión. No se confía en usuario/rol/dependencia de React.

La cuenta técnica debe estar habilitada, no ser administradora y tener `update` sobre el nodo concreto. Dentro del mutex por UUID se lee y valida el JSON actual, se modifica **una sola asignación**, se añaden `attendedAt` y `attendedByUserId`, se registra `ASSIGNMENT_ATTENDED`, se incrementa `revision`, se recalculan las proyecciones y se ejecuta PUT/GET de verificación. La exclusión siempre se libera.

El estado individual resultante es `ATENDIDO`. No cambia la instrucción ni fecha originales, el UUID, las otras obligaciones ni `gd:estado`. Una derivación a Especialista no completa la obligación de Jefatura. El mismo `requestKey` y contenido devuelve la actuación persistida sin duplicarla; un contenido incompatible da 409. Otra solicitud sobre una asignación ya no vigente se rechaza. Un timeout puede dejar resultado desconocido: consultar y reintentar con la misma clave, sin revertir metadatos a ciegas.

Las asignaciones propias `ATENDIDO` se conservan en las bandejas y mantienen acceso histórico al original **solo si Alfresco sigue permitiendo leerlo**. Este acceso histórico no sirve como origen de una nueva derivación: Jefatura necesita una asignación vigente. Una asignación anulada no obtiene ese acceso por esta regla.

Dirección puede atender una asignación propia ya existente. No se añadió Dirección como destinataria del despacho jerárquico, no se crea una obligación artificial y «Para mí» sigue siendo selección local, no asignación oficial.

## Responder reutilizando la emisión existente

Autorizaciones revisadas:

| Operación existente | Autorización efectiva |
| --- | --- |
| `POST /api/documents/send-to-director` y recuperación | Dirección activa con `documents:write`, destino institucional permitido y permisos reales de Alfresco |
| Carga genérica a `/api/alfresco/.../nodes/{id}/children` | Capacidad de escritura y destinatario/bandeja individual ya configurados; no es un flujo institucional general de Emitidos para Jefatura/Especialista |

Por tanto, **la respuesta institucional por emisión está habilitada para Dirección**. No se concedieron nuevas facultades de emisión a Jefatura o Especialista por tener la capacidad genérica de escritura. Falta una decisión institucional sobre su emisión en Emitidos, destinatarios y permisos; no se crean bandejas personales ni un segundo servicio de emisión para resolverlo.

La interfaz permite elegir un PDF propio ya ubicado en Emitidos o abrir el mismo `DocumentForm` y el mismo endpoint de emisión/distribución existentes. La nueva emisión recibe su propio UUID. El PDF original no se copia ni se convierte en otra versión de la respuesta. La referencia al original se vincula después de confirmar la emisión; abrir el formulario o vincular no atiende obligaciones.

Dirección también puede responder un recibido dentro de su autoridad documental **sin tener una asignación personal**. En ese caso la respuesta es una actuación documental sin `assignmentId`; no genera destinatarios ni responsabilidades nuevas. Si hay una asignación propia, la vinculación puede quedar en esa actuación individual.

### Vínculo verificable

`POST /api/documents/assignments/response` usa los mismos campos, con `responseDocumentId` obligatorio. `assignmentId` puede ser `null` únicamente para la respuesta documental de Dirección.

Se comprueba que el original pertenece al ámbito institucional del actor; la respuesta es otro PDF `cm:content`, creado por ese mismo usuario, en Emitidos de su dependencia y legible con su ACL. Un origen `gd:dependenciaOrigen` contradictorio se rechaza. No se considera formalmente aprobado/firmado un PDF solo por estar en Emitidos: se registra la evidencia de emisión disponible, sin inventar un estado formal adicional.

Se utiliza la asociación estándar **respuesta → original**, `cm:references`, tras aplicar `cm:referencing` al PDF de respuesta si falta. Se opera sobre esa respuesta con las credenciales del actor y se exige permiso real de actualización; un 403 detiene la operación, sin elevación ni cambio de ACL. El vínculo se verifica mediante GET de destinos. El detalle de respuesta se conserva dentro del JSON existente:

```json
{
  "documentId": "UUID-respuesta",
  "originalDocumentId": "UUID-original",
  "linkedAt": "fecha ISO",
  "linkedByUserId": "usuario de la actuación",
  "emitterDependency": "dsa",
  "emittedByUserId": "usuario verificado en createdByUser"
}
```

El registro vive en `recipient.responses` si corresponde a una obligación propia o en `envelope.responses` si es una actuación documental. Se registra `RESPONSE_LINKED` o `DOCUMENT_RESPONSE_LINKED`. Esta extensión es aditiva dentro de `gd:asignaciones`, conserva `schemaVersion: 1` y admite documentos previos sin esos campos. No añade propiedades `gd:*` ni modifica CMM. Los lectores antiguos que rechazan acciones de historial desconocidas no deben ejecutarse tras registrar los nuevos eventos: actualizar backend y frontend juntos y mantener una sola instancia.

La emisión, la asociación y el JSON original son operaciones distintas. El vínculo no es una transacción distribuida. Si se crea la asociación y falla el PUT del JSON, se devuelve `RESPONSE_LINK_PARTIAL`. No se borra automáticamente la relación ni se vuelve a emitir el PDF. Se reintenta el vínculo sobre el mismo UUID y clave; se reconoce la asociación existente y se completa el registro. Si el PUT sí se confirmó en el repositorio pero se perdió la respuesta, la historia persistida impide duplicados. Si después se eliminó la asociación, un reintento no declara éxito sin verificarla.

Si se recarga el navegador durante una emisión incierta, se conserva el mecanismo existente de recuperación de emisión. Si se pierde el contexto visual de respuesta, volver al original y elegir la emisión ya existente desde Emitidos. Nunca cargarla de nuevo para reparar únicamente el vínculo.

### Atención con respuesta y consulta

La atención con respuesta usa `responseDocumentId` en el POST de atención. Debe existir un vínculo registrado por el usuario sobre ese mismo original y una asociación real verificable. Se vuelve a comprobar el acceso a la respuesta. El historial de atención registra `mode: response` y el UUID utilizado. La atención directa usa `mode: direct`. Ninguna modalidad atiende asignaciones ajenas ni cierra el trámite.

- `GET /api/documents/response-candidates`: emisiones propias de Dirección, paginadas y filtradas con sus credenciales.
- `GET /api/documents/assignment-responses?documentId=...`: verifica acceso al original, devuelve referencias y metadatos de respuestas accesibles. Una respuesta denegada/eliminada conserva su referencia histórica con error visible.
- `GET /api/documents/response-content?documentId=...&responseDocumentId=...`: verifica original, registro del vínculo, asociación y ACL real de la respuesta antes de entregar su PDF. Conocer el UUID de una respuesta no basta.

## Cierre global preparado, no ejecutado

`attentionSummary` considera todas las asignaciones del documento, incluidas las derivaciones encadenadas. Solo propone revisión cuando existe al menos una obligación, todas están atendidas y no hay anulaciones pendientes de criterio. Mantiene `formalClosureAllowed: false` siempre.

Decisiones pendientes:

1. Quién puede cerrar formalmente: Dirección, un rol institucional distinto u otra autoridad.
2. Qué obligaciones pueden anularse, quién lo autoriza y si su anulación permite cierre.
3. El catálogo institucional y las transiciones permitidas de `gd:estado`, que no se deducen de que su tipo sea texto libre.
4. Facultades y circuito institucional de emisión de respuestas para Jefatura/Especialista; aprobación o firma, si son necesarias para considerar emitida una respuesta.

No hay endpoint de cierre formal, actualización arbitraria de `gd:estado`, archivado ni reapertura en esta entrega.

## Archivos principales

- `backend/src/attentionPolicy.js`, `documentIdentity.js`: políticas de atención, capacidades reales, resumen y separación de identidad.
- `backend/src/alfrescoDispatchRepository.js`: operaciones persistidas, historial, referencias y recuperación; conserva la escritura de proyecciones y los límites del piloto.
- `backend/src/dispatchPilotScope.js`: comparte la comprobación institucional sin habilitar derivación a Especialista.
- `backend/src/documentReadPolicy.js`: lectura de historial propio atendido con ACL obligatoria.
- `backend/src/index.js`: rutas de atención/respuesta y capacidades de sesión; el bloque de distribución DTI–DSA se conserva.
- `frontend/src/App.jsx`, `api/alfresco.js`, `utils/documentIdentity.js`, `utils/assignmentViews.js`: integración, emisión reutilizada, lectura de identidad e historial.
- `frontend/src/components/AttentionActions.jsx`, `ResponseComposer.jsx`, `RelatedResponses.jsx`, `DocumentIdentitySummary.jsx`, `PdfPreview.jsx`: atención, vinculación y consulta autorizada.
- `frontend/src/pages/AssignmentsPage.jsx`, `DirectorPage.jsx`, `DirectorWorkspacePage.jsx`, `App.css`: etiquetas separadas, historial propio, estado individual y controles; se mantienen los colores por usuario y etiquetas vigentes.
- Pruebas: `backend/src/attention.test.js`, `attention.integration.test.js`, `testFixtures/attention.js`, ajustes en `alfrescoDispatchRepository.test.js`; `frontend/src/utils/attention.render.test.js` y verificador Edge ampliado.

## Validación y prueba manual pendiente

Las pruebas usan mocks o almacenamiento aislado. La integración HTTP recorre el endpoint de emisión existente, comprueba UUID nuevo y distribución del mismo UUID de respuesta, vincula mediante `cm:references` y atiende después explícitamente. También se comprueban dueños, roles, ACL, permiso técnico, conservación de otras obligaciones, PUT/GET, reinicio del repositorio, idempotencia, concurrencia y errores/parciales.

Edge headless ejecuta el bundle real con API local simulada: Jefatura y Especialista atienden sus asignaciones, las conservan tras recargar y no reciben el botón de emisión institucional. Dirección abre el formulario existente sin completar obligaciones. Se comprueba emisor DTI separado del despacho DSA. Artefactos locales ignorados: `frontend/artifacts/dispatch-read/attention-head.png`, `attention-staff.png` y `report.json`. No son capturas de una sesión DEV.

Para validar manualmente después de revisar la entrega: reiniciar el backend actualizado y cargar el nuevo frontend; usar la configuración del piloto ya autorizada. Revisar primero por GET el original, sus asignaciones y permisos. Probar en un documento seleccionado una atención propia; comprobar por GET una sola transición, fecha, usuario, evento y proyecciones, sin cambio de `gd:estado`. Probar una respuesta de Dirección con UUID distinto, verificar el destino `cm:references` y el JSON original; confirmar que sigue pendiente hasta la atención explícita. No conceder permisos si una operación devuelve 403. Estas escrituras reales no se ejecutaron durante el desarrollo.

Fuente primaria del contrato REST de asociaciones: [API oficial de Alfresco](https://github.com/Alfresco/rest-api-explorer/blob/master/src/main/webapp/definitions/alfresco-core.yaml), `POST /nodes/{nodeId}/targets`, cuerpo `targetId` y `assocType`. El aspecto y la asociación también se verificaron directamente mediante GET del modelo real de DEV.

## Resultados finales de esta entrega

- `node --test backend/src/*.test.js frontend/src/utils/*.test.js`: 101 pruebas aprobadas, sin fallos ni omitidas.
- `npm run lint` y `npm run build` en frontend: correctos.
- `node frontend/scripts/verify-dispatch-browser.mjs`: correcto con el bundle de producción en Edge y API local simulada; dos atenciones simuladas, historial tras recarga y formulario de emisión reutilizado.
- `git diff --check`: correcto. El bloque de distribución DTI–DSA permanece idéntico a HEAD; ambos `.env.local` conservan sus hashes iniciales. No hay modificaciones del modelo documental.
- Rama conservada: `feature/jerarquia-despacho-interno`. Sin commit, push ni escrituras reales en Alfresco DEV.
