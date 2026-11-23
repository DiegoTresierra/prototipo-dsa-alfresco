# Emisión oficial y numeración

## Fuente de verdad y habilitación

El servicio está implementado y probado con mocks. La emisión oficial permanece deshabilitada hasta autorización independiente. Comprobar el modelo o compilar no la habilita.

Los documentos emitidos permanecen en Emitidos institucional, incluidos anulados. La aplicación rechaza moverlos o eliminarlos; no se cambian ACL automáticamente para imponer esa política fuera de la aplicación.

## Numeración

Cada secuencia se identifica por código documental completo y ciclo. El ciclo comienza el 2 de enero en America/Lima y termina el 1 de enero siguiente. Se toma el máximo numérico utilizado, incluyendo anulados; nunca se ordena como texto ni se usa el más reciente por fecha.

El numerador genérico admite secuencias independientes por código. El emisor actual autoriza Dirección y obtiene el código institucional de su dependencia; no inventa códigos de unidades o especialistas.

La fuente es la enumeración directa y completa de Emitidos mediante GET, con cm:contains, deduplicación y paginación consistente. No se depende del índice eventual, del nombre, de conteos ni de un contador local.

La cola por código/ciclo se conserva durante conciliación, asignación del siguiente número, creación, distribución y GET de comprobación. Solo hay garantía en una instancia con escritor exclusivo.

## Contrato del documento

El aspecto gd:identificacion conserva gd:numero como texto decimal positivo, además de gd:codigoDocumental, gd:cicloDocumental e identidad idempotente en gd:identidadEmision. No se crea gd:correlativoDocumental.

Código, ciclo, número e identidad se registran al crear oficialmente el PDF. El número visible se deriva del contrato institucional; no se reserva al abrir formularios o preparar borradores.

La identidad contiene version, actorId, requestKey y payloadHash. El backend construye metadatos institucionales de origen, destino, remitente, destinatario y fecha; el tipo documental usa gd:clasificacion. Período académico y prioridad todavía no son metadatos documentales persistidos: se conservan las advertencias explícitas.

## API existente

POST /api/documents/official-emissions requiere Dirección, sesión, CSRF, revalidación institucional y habilitación explícita. Su multipart admite filedata, requestKey, title, description, documentType, documentPeriod, priority, recipientDependency y receiptCategory. PDF con firma %PDF-, máximo 20 MiB.

No se aceptan propiedades gd arbitrarias ni un indicador approved como aprobación. Las rutas genéricas no pueden cargar en Emitidos para eludir el servicio.

Para una propuesta aprobada, la integración interna obtiene los bytes desde Alfresco, valida aprobación y reutiliza este emisor con una capacidad del servidor. No existe una ruta productiva nueva de emisión por propuestas.

## Permisos y distribución

El emisor debe tener create en su Emitidos. El servicio de distribución debe acreditar los permisos concretos para crear la asociación secundaria. El receptor debe poder leer el nodo y su PDF: cm:contains no concede permisos por sí sola.

No se exige lectura global de la otra Dirección sobre toda la carpeta Emitidos de origen. Se verifica el acceso institucional del nodo compartido. Si falta, se conserva el UUID/identidad y se informa del bloqueo; cualquier intervención de permisos requiere autorización aparte.

No se concede Consumer automáticamente ni se usa administración. La distribución heredada puede recuperar una operación legítima ya iniciada, pero no crear otra emisión oficial ni modificar ACL fuera de política.

## Idempotencia y conciliación

El nombre determinista y la identidad estable permiten encontrar la emisión por GET directo. Reintentar requiere el mismo actor, clave, PDF y parámetros. Un cambio produce conflicto, no otra carga.

Ante timeout después de crear, la secuencia queda incierta. Consultar la identidad antes de reservar otro número. Tras reinicio, recuperar la operación conocida; si no puede probarse el resultado, mantener el bloqueo y conciliar administrativamente.

La conciliación histórica usa un manifiesto v2 aprobado, ligado al destino, raíces, identidad estable y SHA-256 del contenido. Asignaciones, responsables y estados de atención mutables no invalidan por sí solos la clasificación. Un candidato no es una aprobación.

Los manifiestos y sus evidencias se conservan íntegros fuera del repositorio. Se suministran mediante OFFICIAL_EMISSION_RECONCILIATION_FILE y su SHA-256. No hay dependencia de un manifiesto DEV versionado. La exclusión afecta solo al cálculo de correlativos, nunca a despacho, atención o visualización.

La consulta se delimita por carpeta, código y ciclo. Una secuencia vacía no debe bloquearse por históricos de otra, salvo inconsistencia que afecte realmente a su integridad.

## Protección del circuito de revisión

La emisión general nueva bloquea PDFs de propuestas conocidas. Un hash distinto no prueba independencia: si el ámbito contiene procesos de revisión y no hay clasificación fiable, falla de forma segura. Los reintentos oficiales anteriores se recuperan por su identidad antes de esta clasificación.

Esto puede bloquear documentos independientes mientras no exista una política backend para acreditarlos. No se ofrece un flag de React para saltar la revisión. Véase [integración aprobada](APPROVED_RESPONSE_EMISSION.md).

## Preflight y puesta en servicio

Con destino privado y credenciales autorizadas, los scripts siguientes son GET-only:

```powershell
node backend/scripts/verify-emission-model.mjs --require-present
node backend/scripts/verify-official-emission.mjs --dependency=DSA
node backend/scripts/prepare-emission-reconciliation.mjs
```

Su salida es evidencia privada. Un manifiesto aprobado puede pasarse como argumento al verificador oficial; no anonimizar el original operativo.

Antes de habilitar: validar sesiones finales, cobertura completa, modelo real, ACL efectivas, política de conservación y único escritor. OFFICIAL_EMISSION_WRITES_ENABLED, destino esperado y confirmación explícita son condiciones adicionales, no prueba suficiente de esos requisitos. Mantener deshabilitado mientras falte cualquiera.

El emisor actual está restringido al piloto DEV: exige el perfil de despacho DEV validado, OFFICIAL_EMISSION_EXPECTED_TARGET idéntico al destino seleccionado y OFFICIAL_EMISSION_ACK=single-instance-exclusive-writer-official-emission-dev. Toma su lease separado, configurable con OFFICIAL_EMISSION_LEASE_PATH. No configurar estos valores como consecuencia de esta guía sin autorización; la plantilla mantiene la escritura desactivada. La habilitación de despacho en preproducción no habilita este emisor allí.

La política de aprobación, propuesta tipificada y proveedor institucional real siguen pendientes para el circuito nuevo. No se realiza atención ni cierre automático. Véanse [modelo](alfresco-model/EMISSION_CMM.md) y [operación del piloto](ALFRESCO_DISPATCH_PILOT.md).
