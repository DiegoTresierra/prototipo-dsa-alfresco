# Emisión oficial y numeración

## Fuente de verdad y habilitación

El servicio está implementado y probado con mocks. La emisión oficial permanece deshabilitada hasta autorización independiente. Comprobar el modelo o compilar no la habilita.

Los documentos emitidos permanecen en Emitidos institucional, incluidos anulados. La aplicación rechaza moverlos o eliminarlos; no se cambian ACL automáticamente para imponer esa política fuera de la aplicación.

## Numeración

Cada secuencia se identifica por código documental completo y ciclo. El ciclo comienza el 2 de enero en America/Lima y termina el 1 de enero siguiente. Se toma el máximo numérico utilizado, incluyendo anulados; nunca se ordena como texto ni se usa el más reciente por fecha.

El numerador admite secuencias independientes por código. Dirección usa su dependencia verificada. Jefatura y Especialista pueden formalizar documentos propios: el backend exige configuración explícita y una asignación `gdo:asignacion` ACTIVA en una `gdo:unidad` ACTIVA, con usuario, función y dependencia coincidentes. No deduce siglas de nombres ni del organigrama JSON.

La fuente es la enumeración directa y completa de Emitidos mediante GET, con cm:contains, deduplicación y paginación consistente. No se depende del índice eventual, del nombre, de conteos ni de un contador local.

La cola por código/ciclo se conserva durante conciliación, asignación del siguiente número, creación, distribución y GET de comprobación. Solo hay garantía en una instancia con escritor exclusivo.

## Contrato del documento

El aspecto gd:identificacion conserva gd:numero como texto decimal positivo, además de gd:codigoDocumental, gd:cicloDocumental e identidad idempotente en gd:identidadEmision. No se crea gd:correlativoDocumental.

Código, ciclo, número e identidad se registran al crear oficialmente el PDF. El número visible se deriva del contrato institucional; no se reserva al abrir formularios o preparar borradores.

La identidad contiene version, actorId, requestKey y payloadHash. El backend construye metadatos institucionales de origen, destino, remitente, destinatario y fecha; el tipo documental usa gd:clasificacion. Período académico y prioridad todavía no son metadatos documentales persistidos: se conservan las advertencias explícitas.

## API existente

POST /api/documents/official-emissions requiere Dirección, Jefatura o Especialista, sesión, CSRF, revalidación institucional y habilitación explícita. Su multipart admite filedata, requestKey, title, description, documentType, documentPeriod, priority, recipientDependency y receiptCategory. PDF con firma %PDF-, máximo 20 MiB. El código, carpeta, ciclo y número los resuelve exclusivamente el backend.

Sin destinatario, `recipientDependency` y `receiptCategory` deben estar vacíos: se crea solo el original en Emitidos, sin recepción, asociación secundaria ni asignación. La respuesta devuelve `distributed: false` y `receivedEntry: null`. Dirección conserva la distribución existente con destinatario; la distribución de documentos propios de Jefatura/Especialista queda bloqueada hasta definir su circuito. Jefatura y Especialista pueden formalizar emisiones propias directamente: no se exige aprobación de Dirección por defecto. La capacidad interna de emisión por revisión aprobada sigue reservada a Dirección; cuando existe un proceso de revisión se conserva su aprobación y la vinculación a contenido concreto. Un documento ya oficial puede reutilizarse posteriormente como respuesta sin otra emisión ni otro número, respetando esas reglas específicas y la competencia sobre el original.

Configuración manual, sin activar escrituras: `ALFRESCO_DOCUMENT_ISSUER_ASSIGNMENTS_JSON` relaciona el ID exacto de actor con `unitId` (UUID real de la unidad) y `documentCode` completo; especialistas añaden `signatoryCode` institucional explícito. Ejemplo sintético: `{"person@example.invalid":{"unitId":"00000000-0000-4000-8000-000000000099","documentCode":"DTI-UNIT-AA","signatoryCode":"AA"}}`. Jefatura usa el código de unidad sin sigla personal. El código de unidad procede de `gdo:codigoUnidad`; puede ser local (`UNIT`) o completo (`DTI-UNIT`). Se rechazan códigos incompatibles, duplicados personales, relaciones inactivas, ausencia de ACL de lectura y paginación incompleta. La configuración asigna códigos, no concede membresías, aprobación ni permisos.

El rol y la afiliación se comprueban también antes de crear el PDF y durante su verificación. Esto detecta cambios observables, pero no constituye una transacción distribuida con las modificaciones de jerarquía. La ventana coordinada y un único backend siguen siendo requisitos del piloto. En DEV la configuración continúa vacía hasta intervención del operador; el modelo desplegado no implica que existan relaciones activas ni códigos personales configurados.

GET /api/documents/emitted se consulta con identidad institucional revalidada y ACL del actor. Dirección ve originales de su dependencia; Jefatura y Especialista ven sus propios originales. El acceso adicional por unidad sigue bloqueado hasta integrar su competencia verificable. Se recorren todas las páginas y se deduplican UUID; errores documentales individuales producen una advertencia de lista parcial, y errores de paginación rechazan la consulta.

No se aceptan propiedades gd arbitrarias ni un indicador approved como aprobación. Las rutas genéricas no pueden cargar en Emitidos para eludir el servicio.

La identidad técnica debe acreditar explícitamente `capabilities.isAdmin: false` mediante GET; el nombre de cuenta por sí solo no demuestra ausencia de privilegios administrativos. Una respuesta sin esa evidencia bloquea la emisión antes de crear el PDF.

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

### Primera emisión de ensayo, después de autorización separada

1. Confirmar una sesión auténtica de Dirección mediante `/api/auth/me` y los GET
   de [lectura por rol](READ_ACCESS_CHECKS.md). Verificar membresías vigentes, lectura
   y permiso efectivo de creación en su Emitidos; la cuenta técnica no sustituye
   al actor. Una carpeta vacía observada por la cuenta lectora no acredita esos permisos.
2. Preferir un documento nuevo sin destinatario para el primer ensayo. Así se prueba
   una única emisión en su carpeta institucional sin añadir asociaciones ni ACL.
   Una futura prueba distribuida requiere verificar aparte la lectura del destinatario
   sobre el nodo y contenido; la asociación secundaria no concede Consumer.
3. Comprobar los cuatro campos de identificación en el modelo y el inventario directo
   de esa secuencia. Si Emitidos está vacío y completamente acreditado, el máximo es
   cero y el primer número será uno. Un código/ciclo distinto no consume números;
   numeración histórica incompatible dentro del ámbito exige conciliación aprobada.
4. Obtener el código desde el backend. Dirección utiliza su dependencia revalidada.
   Jefatura y Especialista requieren `ALFRESCO_DOCUMENT_ISSUER_ASSIGNMENTS_JSON` y
   relación activa comprobada en Alfresco; no derivar siglas desde nombres. El ciclo
   se calcula en America/Lima con inicio el 2 de enero, no desde un campo de React.
5. Preparar un PDF de ensayo no vacío, con firma `%PDF-`, y registrar su SHA-256 en
   evidencia privada. Mantener una única `requestKey` para el contenido y metadatos
   elegidos. Revisar título, descripción, tipo documental, período y prioridad; no
   enviar código, correlativo, carpeta, aspectos, permisos ni identidad oficial.
6. Antes de habilitar cualquier flag, obtener autorización explícita, coordinar la
   ventana sin otros escritores y confirmar una única instancia. Esto reduce el
   riesgo y no constituye exclusión distribuida. Verificar destino exacto, leases y
   confirmaciones del piloto y de emisión. No retirar bloqueos huérfanos automáticamente.
7. Solo tras esa autorización, usar el endpoint existente y CSRF de la sesión. El
   backend crea `gd:numero`, `gd:codigoDocumental`, `gd:cicloDocumental` e
   `gd:identidadEmision`; conserva el bloqueo hasta completar la comprobación GET.
8. Verificar UUID distinto de cualquier propuesta/original previo, ubicación Emitidos,
   identidad idempotente, código, ciclo, correlativo decimal y hash del contenido.
   Sin destinatario deben resultar `distributed: false` y `receivedEntry: null`, sin
   obligaciones ficticias. Período y prioridad conservan sus advertencias de no persistencia.
9. Ante timeout o resultado parcial, conservar PDF, campos, clave, UUID y correlativo
   si se conocen. Conciliar antes de otra solicitud; no sustituir la clave ni reservar
   otro número. Reanudar únicamente la misma operación cuando su estado esté acreditado.
10. Tras una operación confirmada, reiniciar de manera controlada y repetir GET de
    Emitidos, metadatos y contenido. Verificar la identidad desde Alfresco y que la
    aplicación continúa rechazando mover o eliminar el oficial. No borrar locks de
    resultados inciertos para forzar un reinicio; requieren revisión y conciliación.

Esta lista no habilita escrituras ni demuestra que el ensayo real ya se haya realizado.

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
