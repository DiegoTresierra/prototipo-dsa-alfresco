# Correcciones P0 de identidad y escritura

Rama: `feature/jerarquia-despacho-interno`. Alcance exclusivo E01–E04 de `ALFRESCO_DATA_SOURCE_AUDIT.md`. No se implementan P1/P2. El informe de auditoría previo se conserva sin reescribir sus evidencias históricas.

## E01 — Vigencia institucional

**Causa:** sesión con rol/dependencia resueltos al iniciar sesión; renovar el token no renovaba esa autoridad antes de escribir con servicio o administrar el organigrama.

**Cambio:** nuevo `src/institutionalIdentity.js`. GET `/people/-me-` con las credenciales del actor exige identidad coincidente y `enabled:true`. GET paginado `/people/{id}/groups` exige IDs, contrato y avance válidos. Resuelve rol actual y exige coincidencia de rol/dependencia con la sesión. Una revocación no cambia automáticamente la sesión a otro rol: rechaza la operación y pide nuevo login.

`index.js` aplica el middleware a GET/PUT de jerarquía, despacho y atención/vinculación. La creación genérica lo ejecuta antes de enviar el multipart a Alfresco. `officialEmissionService.js` reutiliza el mismo resolvedor en lugar de duplicar su consulta de actor/grupos. El login también usa el lector paginado desde `alfrescoClient.js`.

No hay caché compartida de autorización: cada operación revalida. Dentro de una solicitud no se repite la revalidación del servicio oficial en otro middleware. Se mantienen las comprobaciones de ACL, rol permitido, pertenencia documental, destinatarios y permiso técnico update.

Errores estables: `INSTITUTIONAL_IDENTITY_REJECTED` (403), `INSTITUTIONAL_IDENTITY_UNAVAILABLE` (503). Red, JSON inválido, paginación incompleta y respuestas denegadas nunca se transforman en autorización.

**Pruebas:** `institutionalIdentity.test.js`: páginas posteriores, cambios de rol después de una llamada válida, dependencia distinta, ambigüedad, enabled falso, IDs parecidos, HTTP 401/403/500/503, red y contratos inválidos. Los tests HTTP de despacho, atención y jerarquía verifican rechazos sin mutar JSON o asignaciones. Los fixtures anteriores se ampliaron con GET de actor real simulado; no se introducen bypass en producción.

**Límite:** no es una transacción conjunta entre membresía y escritura; una modificación externa después del GET puede ocurrir. Las sesiones de solo lectura no se convierten en un sistema de revocación global inmediata. No hay garantía distribuida ni cambio de política de lectura.

## E02 — IDs exactos

**Causa:** `roleResolver.js` quitaba prefijos, signos, mayúsculas/minúsculas y fragmentos; grupos diferentes podían resultar equivalentes.

**Cambio:** igualdad exacta de IDs recibidos/configurados. No se aceptan etiquetas de presentación como prueba de pertenencia. Configuración explícita de uno o varios IDs por rol sigue admitida; los alias de las claves de configuración no transforman IDs de autoridad.

**Pruebas:** `roleResolver.test.js` reproduce prefijos distintos, guiones, minúsculas, espacios y etiquetas; ninguno concede rol. Se comprueban IDs alternativos autorizados mediante configuración explícita.

**Compatibilidad:** IDs reales configurados correctamente conservan sus roles. Un despliegue que antes dependía de coincidencias aproximadas será rechazado y deberá corregir su mapeo con IDs reales, sin modificar grupos. No se cambió `.env.local`.

## E03 — Emisión nueva y recuperación de distribución

**Causa:** `/send-to-director` podía crear un documento sin contrato oficial cuando la emisión oficial estaba deshabilitada. El reintento podía añadir Consumer al nodo automáticamente.

**Cambio:** las emisiones nuevas usan exclusivamente `/api/documents/official-emissions`; la ruta antigua devuelve `OFFICIAL_EMISSION_ENDPOINT_REQUIRED`, independientemente del flag oficial. Se elimina su bloque de creación; mantener el flag deshabilitado ya no abre una vía alternativa de emisión. La creación genérica tampoco puede apuntar a Emitidos configurados, incluso si se mapearon como bandeja personal.

Se conserva `/api/documents/retry-director-delivery` para un PDF previo no oficial: requiere identidad institucional vigente, Dirección autorizada, mismo creador, `cm:content`, PDF y padre Emitidos correcto. El destino se resuelve mediante configuración del backend. Se comprueba lectura institucional del destinatario usando `hasInstitutionalRead`, igual que el servicio oficial. No existe PUT de permisos en esta ruta.

Si falta lectura devuelve 409 `DIRECTOR_RECIPIENT_NODE_READ_REQUIRED` con `emittedNodeId`. El operador conserva el UUID y revisa permisos por el procedimiento institucional externo; la aplicación no los concede. Si el documento es oficial, su recuperación exige el flujo oficial y misma clave; no entra por el retry legacy.

Cuando ya hay lectura, el servicio agrega la asociación secundaria `cm:contains`, sin duplicar el PDF. Un conflicto 409 de asociación solo se considera éxito al comprobar por GET el padre secundario exacto. El frontend reconoce los nuevos errores y conserva el UUID de recuperación.

**Pruebas:** `documentDelivery.integration.test.js`: rechazo de creación legacy, ausencia de PUT, falta de lectura, recuperación en ambas Direcciones y ambas bandejas receptoras, conflicto no verificado/verificado, creador ajeno, denegación de lectura/asociación y documento oficial. No se realizan ACL reales ni otras escrituras contra DEV. La suite oficial conserva pruebas de creación, numeración, timeout y recuperación con mocks.

**Compatibilidad:** el frontend actual ya usa emisión oficial para creación nueva; los documentos parciales anteriores se pueden recuperar sin reemitir si existe permiso de lectura. No se habilita emisión oficial. El cliente antiguo que intentaba crear por `/send-to-director` debe usar el contrato oficial; esta restricción es deliberada para cerrar el bypass, no un endpoint sustituto de distribución.

## E04 — Contrato multipart genérico

**Causa:** se reenviaba el cuerpo recibido, prohibiendo solo cuatro campos de numeración; otros aspectos o metadatos institucionales podían llegar arbitrariamente al repositorio.

**Cambio:** nuevo `src/pdfCreation.js`. Allowlist exacta: `filedata`, `name`, `nodeType`, `cm:title`, `cm:description`; una aparición de cada campo. Solo `cm:content`, firma PDF, nombre PDF sin rutas y límites de tamaño/texto. El backend reconstruye un FormData nuevo y deja que fetch genere su Content-Type/boundary.

Propiedades `gd:*`, proyecciones de responsables, asignaciones, identidad de emisión, `cm:author`, ACL, `properties`, aspectos y cualquier campo no autorizado se rechazan. No se filtran silenciosamente ni se reenvían como un objeto anidado. Los servicios especializados siguen construyendo en backend su propio contrato privilegiado.

**Pruebas:** `pdfCreation.test.js`: creación legítima preserva bytes/título, metadatos reservados, aspectos y ACL prohibidos, duplicados, tipos distintos, rutas, valores Blob en texto y firma inválida. El test HTTP de jerarquía incluye la ruta real genérica, comprueba que no se invoca creación upstream al rechazar, que llega un FormData reconstruido en el caso válido y que Emitidos no admite bypass.

**Compatibilidad:** conserva la carga PDF genérica actual (nombre, título y descripción), sesión/CSRF y mapeo servidor de bandeja destinataria. No amplía la creación de usuarios no-Dirección ni corrige sus deudas P1 de catálogo/unidad.

## Archivos

Producción modificada: `src/alfrescoClient.js`, `src/roleResolver.js`, `src/index.js`, `src/officialEmissionService.js`, `../frontend/src/api/alfresco.js`.

Producción nueva: `src/institutionalIdentity.js`, `src/pdfCreation.js`.

Pruebas nuevas: `src/institutionalIdentity.test.js`, `src/pdfCreation.test.js`, `src/testFixtures/institutionalIdentity.js`.

Pruebas adaptadas/ampliadas: `src/roleResolver.test.js`, `src/hierarchy.integration.test.js`, `src/alfrescoDispatch.integration.test.js`, `src/dispatch.integration.test.js`, `src/attention.integration.test.js`, `src/documentDelivery.integration.test.js`.

## Validación y pendientes

Suite completa: `node --test backend/src/*.test.js frontend/src/utils/*.test.js`. Frontend: `npm run lint` y `npm run build` desde `frontend`. Las pruebas usan destinos `.invalid`, GET de identidad simulados y escrituras simuladas; ninguna prueba crea/modifica documentos reales. Resultado: 153 pruebas aprobadas, cero fallidas; lint y build correctos.

Quedan por verificar mediante GET con sesiones reales los IDs de grupos configurados y la disponibilidad del endpoint de membresías para cada actor. La UI puede seguir mostrando temporalmente el snapshot de sesión; el backend rechaza acciones que ya no corresponden. Mantener modelo actual y prohibición de desbloquear Jefatura → Especialista sin proveedor institucional. El JSON de organigrama no se usa en autorización.

No se modificaron grupos, modelos, ACL, archivos operativos ni `.env.local`. No se habilitó emisión oficial. Sin commit, push, merge ni rebase. No se resolvieron los hallazgos P1/P2.
