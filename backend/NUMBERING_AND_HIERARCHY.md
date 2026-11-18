# Correlativos y jerarquía institucional

> HISTORICO: la decision definitiva reutiliza gd:numero como texto numerico oficial y retira el correlativo separado de la propuesta. Las recomendaciones anteriores de este informe quedan sustituidas por [el contrato vigente](./alfresco-model/EMISSION_CMM.md). Se conserva la evidencia de auditoria; no se modificaron documentos de prueba.

Actualización del piloto: la propuesta de base transaccional de este documento queda sustituida por [ALFRESCO_NUMBERING_PILOT.md](ALFRESCO_NUMBERING_PILOT.md). No se instalará un contador independiente. La emisión oficial continúa bloqueada por cobertura y recuperación aún no verificadas.

Decisiones incorporadas el 18 de noviembre de 2026. No se realizaron escrituras reales, cambios de modelo, ACL, grupos ni configuración local.

## Numeración

El contador anterior (`numberingStore.js`) usaba JSON local y una clave dependencia/unidad/tipo/año recibido del formulario. No representaba el código documental completo ni el ciclo que empieza el 2 de enero. Su lectura y renombrado de archivo no ofrecían exclusión transaccional entre procesos, reserva idempotente ni vínculo verificable con la emisión.

La reserva oficial ahora responde 503 `NUMBERING_ATOMIC_RESERVATION_REQUIRED`, sin tocar el JSON histórico. El formulario conserva y muestra el error y se detiene antes de emitir. No se implementó un contador de reemplazo inseguro. Los endpoints de carga y distribución de PDFs existentes se conservan: no constituyen una autoridad de numeración ni certifican números incluidos en un PDF externo. Los reintentos de distribución existentes no requieren un número nuevo.

`numberingScope(documentCode, instant)` prepara código completo y ciclo, usando America/Lima: hasta el 1 de enero inclusive pertenece al ciclo anterior. El período académico del formulario no determina el ciclo. Código `DTI`, `DTI-UPSI`, `DTI-UPSI-AMMR` y `DSA` son claves independientes; el tipo documental no añade otra partición salvo futura decisión institucional. No se deducen códigos desde usuarios ni unidades no verificadas.

### Ajuste mínimo antes de habilitar numeración oficial

Integrar un almacén transaccional duradero compartido por todos los emisores autorizados, no otro JSON ni un mutex de proceso. Propuesta: tablas `document_counters(document_code, cycle, last_number)` con clave primaria compuesta, y `document_issuances(issuer_id, request_key, code, cycle, number, status, node_uuid)` con unicidad de petición y de `(code, cycle, number)`.

El backend debe resolver el código completo desde identidad y catálogo institucional verificados. Dentro de una transacción, resolver primero el reintento, incrementar atómicamente el contador con bloqueo de fila/UPSERT RETURNING y registrar la reserva. Hacerlo exclusivamente al confirmar la emisión formal aprobada, nunca al abrir borrador, comentar o preparar una respuesta. Guardar ciclo junto con código y número en el registro duradero: no basta el año calendario del frontend.

Alfresco y la base no comparten transacción. Una reserva fallida no se reutiliza: registrar fallo o resultado incierto y reconciliar el UUID antes de reintentar, manteniendo la misma clave. Falta aprobar el tratamiento de huecos y la recuperación tras una caída durante la creación del PDF. Antes de activar, reconciliar contadores históricos para no reiniciar una secuencia existente a 1. Validar concurrencia entre procesos, reinicio, cambio de ciclo, reintento y respuesta incierta. No se desplegó una base ni se inventó una propiedad Alfresco para guardar el ciclo.

## Grupos internos

`organizationalHierarchy.js` ofrece una frontera de lectura desacoplada, `resolveManagedRecipients(session, directory, provider)`. El proveedor futuro debe implementar `resolveSpecialists({userId, dependency})` consultando grupos internos reales y devolver `{verified: true, members: [{userId, groupIds}]}`. Es un contrato entre módulos de backend, nunca un parámetro del frontend o una lista de usuarios en `.env`. El proveedor es código de confianza y es responsable de probar supervisión, no solo pertenencia genérica.

El proveedor debe consultar GET con paginación completa, distinguir membresía directa/heredada según el contrato institucional acordado, verificar grupos supervisados por esa Jefatura, dependencia y usuarios habilitados. Errores no deben convertirse en listas vacías. La implementación de administración del compañero definirá dónde reside la relación de supervisión y sus IDs reales; este módulo no crea ni modifica grupos. Aún no existe un proveedor conectado: no se afirma que los grupos internos estén disponibles o verificados en DEV.

GET del selector y POST del despacho utilizan el mismo resolvedor. Dirección conserva la intersección institucional por dependencia y función. Jefatura sin proveedor recibe 503 `ORGANIZATIONAL_HIERARCHY_PENDING`, visible en pantalla; no se muestran todos los especialistas como subordinados. Con proveedor, se intersectan personas verificadas con el directorio institucional habilitado, misma dependencia y función especialista. Especialista continúa sin derivación. El POST conserva además la comprobación de encargo vigente, ACL, ámbito documental y persistencia existente. Ningún dato del frontend habilita un proveedor.

## Estado operativo y límites

- Continúan: atención individual, historial, consulta autorizada, despacho múltiple de Dirección y distribución DTI–DSA. Las obligaciones originales no se extinguen por una derivación.
- Suspendida: reserva oficial y, por tanto, emisión nueva desde el formulario que la requiere. Vincular una respuesta ya emitida y autorizada no reserva un número ni completa automáticamente la atención.
- Pendiente de grupos reales: derivación Jefatura→Especialista, resolución Especialista→Jefatura para revisión y elevación jerárquica. No se implementan revisores automáticos, bandejas nuevas ni un segundo administrador de grupos.
- Pendiente: flujo de revisión y aprobación formal obligatoria por Dirección antes de la emisión de una respuesta en ese circuito. La vinculación documental existente no representa aprobación; no se presenta como un circuito de revisión ya implementado. `gd:estado` y la autoridad del cierre formal permanecen sin cambios.

Para integrar el proveedor, agregar también una operación explícita de resolución del supervisor real; ante inexistencia o ambigüedad bloquear el envío a revisión con explicación visible. No escoger al primer jefe de la dependencia. La aprobación debe dejar actor, instante, versión de respuesta aprobada y acciones auditables; un cambio posterior debe invalidarla. Este circuito y el servicio transaccional de numeración requieren una entrega posterior antes de declarar operativa la emisión oficial jerárquica.

## Validación

Pruebas de límites de ciclo con zona Lima, rechazo de reserva insegura, aislamiento del directorio de Dirección, bloqueo de Jefatura sin jerarquía y filtrado con proveedor institucional simulado. La integración HTTP comprueba GET y POST bloqueados sin proveedor y conserva las pruebas de encargos/ACL/derivaciones con un proveedor exclusivamente de prueba. No se verificaron jerarquías reales en Alfresco ni se realizaron escrituras reales.

Resultado: 105 pruebas aprobadas (cero fallos u omitidas); lint, build y `git diff --check` correctos. Ambos `.env.local` conservan los hashes de la entrega anterior. Rama `feature/jerarquia-despacho-interno`, sin commit, push ni merge.
