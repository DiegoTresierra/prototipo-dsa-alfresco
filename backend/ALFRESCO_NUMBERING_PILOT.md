# Numeración desde emisiones oficiales Alfresco: piloto preparado, no activado

> HISTORICO: la decision definitiva reutiliza gd:numero como texto numerico oficial y retira el correlativo separado de la propuesta. Las recomendaciones anteriores de este informe quedan sustituidas por [el contrato vigente](./alfresco-model/EMISSION_CMM.md). Se conserva la evidencia de auditoria; no se modificaron documentos de prueba.

Actualización funcional: las emisiones deben permanecer en Emitidos y no pueden moverse ni borrarse desde la aplicación. Ver [contrato propuesto y retención](OFFICIAL_EMISSION_RETENTION.md) para los GET reales del modelo/ACL, las cuatro propiedades propuestas, las nuevas defensas HTTP y los bloqueos restantes. No se mantiene la movilidad normal como supuesto del flujo institucional.

## Decisión y alcance

La fuente será el conjunto completo de documentos oficiales registrados en Alfresco, no una base adicional ni `document-numbers.json`. La propuesta anterior de contador transaccional independiente queda fuera de este piloto. No se realizaron emisiones reales ni modificaciones de modelo, ACL o `.env.local`.

Una sola instancia Express y un único escritor autorizado son condiciones operativas obligatorias. El mutex no protege frente a otra instancia o a un escritor externo. La exclusión de procesos del piloto de despacho no prueba que otros usuarios o aplicaciones no emitan documentos; se necesita confirmación operativa independiente. El módulo nuevo no concede permisos ni habilita escrituras.

## Implementado y comprobado con mocks

`src/alfrescoNumbering.js` contiene `createAlfrescoNumberedIssuer(adapter)`. La clave de cola es la tupla JSON de código completo y ciclo. `DTI`, `DTI-UPSI` y `DTI-UPSI-AMMR` tienen colas independientes. `numberingScope` calcula el ciclo con fecha de servidor en America/Lima; el 1 de enero aún pertenece al ciclo anterior. No se usa fecha de creación para escoger el máximo ni timestamps para garantizar unicidad.

Dentro de una misma exclusión: preflight, conciliación de intento, enumeración de registros, máximo numérico, emisión completa, GET de verificación y comprobación de visibilidad por enumeración. La cola espera a las solicitudes previas y libera siempre en `finally` usando `createDocumentQueue`. Rechaza correlativos inválidos, desbordamiento y duplicados preexistentes; los anulados consumen número. No persiste un contador local.

`enumerateIssuedRecords({rootIds,get,decode})` recorre directamente nodos y hijos `cm:contains` paginados, incluye asociaciones secundarias y subcarpetas, deduplica UUIDs y consulta las propiedades mediante GET directo. No usa SEARCH/AFTS, fecha de modificación, conteos como correlativos ni filtro por estado. Rechaza respuestas incompletas, inconsistencias de paginación y errores. El adaptador `get` debe rechazar HTTP no exitoso; nunca convertir 403 en carpeta vacía. El decoder se suministrará solo tras verificar el contrato documental real: debe rechazar metadata oficial incompleta y devolver null únicamente para archivos identificados explícitamente como no oficiales.

El adaptador de emisión debe conservar el bloqueo hasta completar el registro oficial y su verificación, no solo hasta subir el PDF. `verify` debe leer desde Alfresco y comparar UUID, código completo, ciclo y número, sin confiar en la respuesta de creación. `assertReady` es una obligación del adaptador de confianza, no una variable que demuestre por sí misma las garantías.

Un error desde el inicio de emisión deja la secuencia en cuarentena en memoria, incluso si se desconoce si llegó a crearse el nodo. No se incrementa para otra solicitud ni se reutiliza el número. La misma petición puede recuperarse si `reconcile` prueba un resultado completo y el GET y la enumeración lo confirman. El mutex se libera, pero las nuevas emisiones de esa secuencia quedan bloqueadas. No se hace rollback ni se borra un PDF.

La memoria NO resuelve reinicios. `reconcile` debe disponer de identidad de intento durable en Alfresco y distinguir ausencia demostrada de resultado incierto. Debe vincular esa identidad al actor, código, ciclo y contenido de emisión, y rechazar reintentos incompatibles. La prueba de reinicio usa esa capacidad simulada; no afirma que el emisor actual la tenga. Si no puede demostrarse ausencia, debe devolver estado incierto, nunca `absent`. Tras un reinicio sin ese mecanismo debe mantenerse deshabilitada toda emisión hasta conciliación operativa.

## Bloqueos para conectar el emisor real

1. El endpoint actual `send-to-director` sube un multipart y distribuye el PDF. No registra código completo, ciclo, número e identidad del intento en un contrato documental comprobado. No se modificó ese flujo DTI–DSA ni se conectó la nueva orquestación a él.
2. La auditoría real previa verificó `gd:numero` como texto y `gd:fechaDocumento`, pero no un formato institucional inequívoco del número completo y su ciclo. El PDF auditado ni siquiera tenía `gd:identificacion`. No se inventaron `gd:codigo`, `gd:ciclo` ni otras propiedades. Falta aprobar y verificar cómo guardar y leer los datos necesarios usando el modelo existente, incluida identidad durable de intento sin crear un contador independiente.
3. Las carpetas Emitidos configuradas no prueban por sí solas cobertura histórica completa. Hay que inventariar las emisiones oficiales, incluidos anulados, nodos movidos, otras asociaciones y registros de números utilizados. Eliminar definitivamente un documento oficial o quitar todas sus asociaciones de las raíces enumeradas haría desaparecer su número; sin política de conservación o evidencia durable en Alfresco no puede garantizarse el máximo utilizado. La papelera o documentos inaccesibles no se consideran cubiertos automáticamente.
4. Una identidad con visibilidad parcial no puede calcular el máximo global del código. Debe verificarse lectura efectiva de todo el conjunto, sin elevar privilegios ni modificar ACL. El código completo se resolverá en backend desde datos institucionales aprobados, no desde un campo confiado del frontend.
5. Falta demostrar lectura inmediata después de creación y después de anulación/movimiento, y recuperación por identidad de intento tras timeout y reinicio. El algoritmo directo evita el índice eventual, pero no demuestra por sí solo esas garantías del entorno.

Por estos motivos `reserveDocumentNumber` permanece cerrado con 503. Su antiguo nombre de error se conserva por compatibilidad; el mensaje de interfaz ahora explica el bloqueo de cobertura/recuperación Alfresco. El formulario no emite un número oficial. No se habilitó una ruta alternativa de numeración ni una bandera para saltar esta comprobación. Las cargas/distribuciones de PDFs existentes no certifican numeración oficial.

## Verificación necesaria antes de activar

Primero, solo GET: comprobar modelo real, formato y calidad de metadata, alcance de identidades y raíces institucionales, paginación completa y asociación secundaria de documentos conocidos; cotejar el máximo con un inventario institucional completo, incluyendo anulados. Documentar la política de conservación y quién puede mover/eliminar/modificar registros. Cualquier omisión o ambigüedad bloquea la activación.

Después, con autorización nueva para pruebas de escritura: demostrar creación y visibilidad inmediata por GET y children, misma numeración tras distribución mediante asociación secundaria, anulación que conserva el número, peticiones paralelas del mismo código y de códigos diferentes, timeout después de crear, reintento idéntico e incompatible y reinicio real del backend. Una sesión caída no debe permitir una nueva emisión hasta resolver su intento. Ninguna de estas escrituras reales se ejecutó en esta entrega.

Solo tras resolver esos puntos se implementará el adaptador real, se retirará la reserva separada del frontend y se integrará la numeración en el proceso de emisión formal bajo el mismo bloqueo. El formulario actual reserva antes de subir: no puede mantenerse ese contrato para el piloto aprobado. La aprobación jerárquica formal permanece como requisito independiente aún pendiente.

## Pruebas

Pruebas nuevas con repositorio simulado: máximo frente a orden de fecha, anulados, colas por código, límites de ciclo, GET bajo bloqueo, reintento, recuperación tras timeout, bloqueo de resultados inciertos, reinicio con conciliación durable simulada, GET/lectura inconsistente, error de preflight con liberación de cola, duplicados y enumeración paginada de asociaciones secundarias. No son evidencia de cobertura del repositorio DEV.

Resultado de la entrega: 111 pruebas aprobadas, cero fallos u omitidas; lint y build correctos; `git diff --check` correcto. Ambos `.env.local` conservan sus hashes anteriores. Se preservaron los cambios locales en `feature/jerarquia-despacho-interno`, sin commit, push ni merge.
