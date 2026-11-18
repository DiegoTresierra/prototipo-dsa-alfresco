# Emisiones oficiales: contrato propuesto y permanencia en Emitidos

> HISTORICO: la decision definitiva reutiliza gd:numero como texto numerico oficial y retira el correlativo separado de la propuesta. Las recomendaciones anteriores de este informe quedan sustituidas por [el contrato vigente](./alfresco-model/EMISSION_CMM.md). Se conserva la evidencia de auditoria; no se modificaron documentos de prueba.

Entrega preparada en `feature/jerarquia-despacho-interno`. La emisión oficial NO está activada. No se modificaron modelos, ACL o `.env.local`, ni se emitieron documentos reales. La decisión de conservación sustituye el supuesto anterior de movilidad normal de documentos: el flujo de aplicación no moverá ni borrará emisiones oficiales, y la anulación conservará UUID, registro y número.

## Evidencia real obtenida exclusivamente por GET

Se consultaron `/alfresco/service/api/classes`, las tres clases `gd_clasificacion`, `gd_identificacion`, `gd_tramite`, las carpetas Emitidos configuradas de DTI y DSA y el nodo de prueba `18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097` con `include=permissions,allowableOperations`. Todas esas consultas devolvieron 200 con la cuenta de distribución configurada, sin utilizar identidad administrativa ni imprimir credenciales.

`gd:identificacion` contiene `gd:numero` (d:text, singular), `gd:fechaDocumento` (d:text), origen/destino y remitente/destinatario. `gd:clasificacion` contiene `gd:tipoDocumental`. `gd:tramite` contiene estado y asignaciones. Ninguna de estas clases define campos específicos para código documental completo, ciclo, correlativo numérico o identidad idempotente de emisión.

En ambas carpetas Emitidos, `gd_distribucion` recibe efectivamente `delete`, `update`, `create`, `updatePermissions`; en el PDF revisado recibe `delete`, `update`, `updatePermissions`. Hay Coordinator heredado para `GROUP_GD_SERVICIO_DISTRIBUCION`; el Consumer local NO elimina esos permisos efectivos. No se comprobó la ACL de cada PDF ni de cada usuario final, por lo que no se extrapola esta prueba a todas las identidades o documentos.

## Ampliación mínima propuesta, pendiente de aprobación

Añadir de forma aditiva al aspecto existente `gd:identificacion`, sin cambiar propiedades existentes:

| Propiedad PROPUESTA (no existe actualmente) | Tipo | Significado |
|---|---|---|
| `gd:codigoDocumental` | `d:text`, singular | Código institucional completo, como DTI, DTI-UPSI o DTI-UPSI-AMMR, resuelto por backend desde el catálogo y autoridad verificados. |
| `gd:cicloDocumental` | `d:int`, singular | Año de inicio del ciclo que abarca 2 de enero–1 de enero siguiente, en America/Lima. |
| `gd:correlativoDocumental` | `d:long`, singular | Entero positivo utilizado para calcular el máximo, nunca fecha ni conteo. En JavaScript se exige entero seguro. |
| `gd:identidadEmision` | `d:text`, singular | JSON v1 con `actorId`, `requestKey`, `payloadHash` SHA-256 del contenido y parámetros formales canónicos. Permite detectar reintento incompatible y buscar el intento sin depender del nombre del archivo. |

Son cuatro propiedades nuevas porque se verificaron en DEV valores textuales compuestos en `gd:numero`: `TEST-MF-001` y `TEST-SERVICIO-001`, sin restricciones numéricas en el modelo. No se reinterpretarán sus sufijos ni se sustituirá su contenido. Se conserva como identificador documental textual; el origen externo y el formato formal de producción no están demostrados. La regla de presentación debe aprobarse antes de generarla. Ver [auditoría concreta de gd:numero](GD_NUMERO_AUDIT.md). `gd:fechaDocumento` no se usa como sustituto del ciclo y `cm:creator` no sustituye una clave de reintento. `gd:estado` no filtra el cálculo: un anulado conserva el correlativo.

Las propiedades nuevas deben ser opcionales en el modelo por compatibilidad con documentos históricos y obligatorias en backend para una nueva emisión oficial. No deben tener `protected=true` si se van a escribir mediante REST. La consulta directa no necesita índices. No se cambia el estado activo del modelo ni se sustituye su definición completa. El administrador deberá revisar con CMM el procedimiento aditivo compatible con la versión desplegada, respaldar la definición vigente y validar en GET las cuatro propiedades después del despliegue autorizado. Este informe no despliega ni autoriza ese cambio.

## Código de esta entrega

- `officialEmissionContract.js`: nombres propuestos declarados explícitamente como propuesta; comprobación de tipos/multivalor del modelo, codificación y decodificación estrictas. No escribe en Alfresco. Conserva `gd:numero`. Rechaza ausencia o datos inválidos, incluidos PDFs antiguos sin contrato: requieren conciliación, no un reinicio a 1.
- `alfrescoNumbering.js`: reutiliza la cola existente por código completo y ciclo. Nuevo `createInstitutionalEmissionReader` toma una raíz Emitidos resuelta por servidor y enumera directamente GET de nodos y `children?assocType=cm:contains`, con paginación, deduplicación UUID y propiedades directas. Filtra por igualdad exacta de código y ciclo, sin filtro de estado. `verify` compara UUID, código, ciclo, número, actor, petición y huella, además de comprobar pertenencia visible a Emitidos.
- El coordinador mantiene la exclusión durante lectura, máximo, creación, GET y enumeración posterior. En resultado incierto deja la secuencia bloqueada hasta conciliación; la salida del mutex usa `finally`. No ofrece garantía distribuida ni protección contra procesos externos.
- `emittedRetentionPolicy.js` e `index.js`: rechazo explícito del proxy para DELETE, PUT/PATCH arbitrarios, POST move y copy. Impide borrar nodos, sobrescribir metadata/contenido o retirar asociaciones por solicitudes directas de aplicación. No existe una excepción enviada por frontend. Las rutas internas autorizadas de asignaciones continúan pudiendo actualizar únicamente sus propiedades; la distribución continúa añadiendo asociaciones secundarias sin retirar la asociación Emitidos.
- La política del proxy se aplica a todos los nodos porque esas operaciones ya estaban excluidas de la allowlist. No recorta una funcionalidad legítima existente de mantenimiento de otros documentos. Tampoco implementa anulación, traslado administrativo ni un editor de ACL.

La emisión real no se conectó todavía: las propiedades propuestas faltan, el formulario aún tiene una reserva separada y el endpoint existente no registra ese contrato. Después de aprobar/desplegar y conciliar datos, se deberá reemplazar la reserva frontend por una sola solicitud formal autenticada. El backend resolverá código y ciclo, y creará PDF y sus cuatro propiedades en la MISMA petición Alfresco dentro de la cola, con `autoRename=false`. No asignar número después en un PUT separado: un timeout entre creación y metadata dejaría un número utilizado sin rastreo. La respuesta de subida no sustituye el GET de comprobación. El flujo de emisión DTI–DSA actual permanece intacto, pero no certifica numeración oficial.

## Idempotencia y resultados inciertos

La identidad debe quedar registrada atómicamente con el PDF. `reconcile` consultará directamente las emisiones por identidad y verificará actor, código, ciclo y huella; un reintento no debe incrementar ni crear otro nodo. El ciclo del intento debe conservarse al reintentar, incluso si cruza el 2 de enero. Si no se localiza un intento tras timeout, eso no demuestra por sí mismo que haya fallado: podría seguir ejecutándose en Alfresco. Mantener la secuencia bloqueada y conciliar, también después de reiniciar. Esta recuperación real sigue pendiente; las pruebas de reinicio existentes usan un adaptador durable simulado. No hay un nuevo registro independiente de contadores o base adicional.

## Alcance de la inmutabilidad y ACL

La restricción implementada es de aplicación. Alfresco sigue permitiendo borrado a la cuenta técnica inspeccionada y puede permitirlo a otras identidades. No puede declararse una retención efectiva frente a accesos directos, otros clientes o administradores basándose en el Consumer local. Tampoco basta ocultar botones.

Para reforzar mediante ACL se requiere una revisión administrativa independiente: permisos efectivos de cada rol y de propietarios, herencia, facultad de borrar nodo/retirar hijos, actualización de propiedades, adición de asociaciones de distribución y actualización de permisos. Se debe probar una combinación que permita las escrituras documentales necesarias y deniegue borrado/movimiento, sin romper distribución ni atención. No se propone quitar Coordinator automáticamente, ni añadir denegaciones genéricas que puedan impedir operaciones legítimas. Esta entrega no demuestra todavía que una combinación de roles estándar satisfaga toda la matriz; requiere una prueba autorizada con las identidades reales.

Hasta entonces, el piloto requiere una sola instancia activa, ausencia de otros emisores y compromiso operativo de no mover/eliminar documentos ni modificar la metadata de numeración desde fuera del backend. Un procedimiento administrativo excepcional será externo, auditado y deberá suspender la emisión, preservar todos los números usados y verificar/restablecer la asociación institucional antes de reanudar. Si una emisión deja de estar enumerada en Emitidos sin otra evidencia durable del número en Alfresco, este algoritmo no puede garantizar la secuencia y debe permanecer bloqueado.

## Pruebas y condiciones previas a activar

Ejecutadas: 115 pruebas automatizadas aprobadas con mocks, incluidas las nuevas de contrato y lector institucional, anulados, filtrado por código completo/ciclo, rechazo de metadata incompleta, comprobación GET, retención por HTTP para Dirección/Jefatura/Especialista y regresión de distribución. `git diff --check` correcto; `.env.local` conserva sus hashes previos. No se realizó una nueva validación de navegador porque no se cambiaron componentes de interfaz en esta entrega.

Pendiente antes de activar, con autorización separada para escrituras de prueba:

1. Aprobar y desplegar las cuatro propiedades, verificarlas por GET y conciliar todos los PDFs oficiales históricos en Emitidos. No omitir silenciosamente archivos sin metadata; los no oficiales deben clasificarse explícitamente con evidencia institucional antes de excluirlos.
2. Confirmar catálogo de códigos por emisor, formato formal de `gd:numero`, capacidad de lectura completa del contador y política de conservación. Validar roles/ACL sin cambiar permisos automáticamente.
3. Integrar creación atómica de PDF y metadata, GET exacto, lectura inmediata por children, inclusión de anulados y asociaciones secundarias. Probar varias páginas y varias emisiones del mismo código con máximos fuera de orden cronológico.
4. Probar concurrencia en una instancia, independencia DTI/DTI-UPSI/DTI-UPSI-AMMR, frontera del 2 de enero, reintento compatible/incompatible y timeout después de creación antes de respuesta, seguido de reinicio. No liberar una secuencia incierta por simple ausencia del nodo en una consulta.
5. Confirmar que los intentos directos de borrar/mover/desasociar se rechazan en aplicación y evaluar por separado sus permisos efectivos en Alfresco. Comprobar que la distribución conserva el mismo UUID en Emitidos y en las bandejas receptoras.

Hasta completar estas condiciones, `reserveDocumentNumber` continúa devolviendo 503. No hay una bandera que haga existentes las propiedades o permita saltar estos bloqueos.
