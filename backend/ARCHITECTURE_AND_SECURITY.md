# Arquitectura y seguridad documental

## Fuentes de verdad

Alfresco conserva nodos, contenido, relaciones, grupos, membresías y metadatos. El navegador presenta datos autorizados; su caché no asigna correlativos ni acredita permisos. Keycloak y el backend gestionan autenticación; la autoridad institucional se confirma en Alfresco.

El servidor exige Alfresco para leer y escribir despachos. La jerarquía consulta las unidades y asignaciones activas de Alfresco y sus diarios. Los archivos históricos privados quedan fuera del circuito operativo. Un error de lectura se comunica al cliente.

La sesión vincula la persona de Alfresco con sus grupos actuales. El servidor excluye de la actuación interactiva las dos identidades de servicio configuradas y las identidades técnicas adicionales declaradas en `ALFRESCO_TECHNICAL_USER_IDS_JSON`. El operador debe mantener ese inventario y revisar la pertenencia a grupos funcionales de las cuentas de automatización.

`ALFRESCO_GROUP_MAPPINGS_JSON` vincula los IDs exactos de las autoridades con sus funciones y dependencias. La API de miembros aporta pertenencias. El significado institucional de cada grupo requiere configuración. Una dependencia con varios grupos requiere una selección explícita en `ALFRESCO_OFFICE_GROUP_IDS_JSON` para distribuir. Un objeto vacío explícito desactiva esos destinos. Los UUID de bandejas y contenedores, los códigos oficiales de firmantes y las credenciales permanecen en configuración privada. Los nombres técnicos de tipos, aspectos y asociaciones se validan contra el contrato del modelo.

## Identidad y autorización

El middleware de sesión valida autenticación; las mutaciones requieren además CSRF. Las operaciones críticas revalidan persona habilitada, identidad efectiva y membresías paginadas mediante institutionalIdentity.js. No basta el rol conservado al iniciar sesión.

roleResolver.js compara IDs institucionales exactos y configurados. No elimina prefijos o puntuación para equiparar grupos diferentes. Los alias de configuración/presentación no son equivalencias de autoridades.

Si Alfresco no confirma identidad, grupos o permisos, la operación falla de forma segura. Las credenciales técnicas no se usan para superar una denegación del actor.

## Lectura y responsabilidad

Conocer un UUID no autoriza lectura. Metadatos, PDF, búsquedas y carpetas se validan en backend y se filtran con la política institucional y ACL del actor. Las asignaciones tampoco conceden permisos Alfresco.

Jefatura conserva lectura de documentos propios y Por conocimiento de su dependencia; Por atender exige asignación. Especialista consulta sus encargos autorizados. Las revisiones institucionales futuras necesitarán una integración específica de la lectura del revisor; no se abre acceso global por UUID.

Una ubicación primaria no demuestra todo el ámbito. Las asociaciones secundarias cm:contains se comprueban mediante Alfresco; no se confía en carpetas o dependencias del frontend. Una asociación no concede ACL automáticamente.

## Creación y operaciones privilegiadas

Los multipart genéricos tienen allowlist estricta. Se admite un tipo documental de negocio validado y metadatos descriptivos permitidos; se rechazan aspectos arbitrarios, propiedades gd privilegiadas, asignaciones, permisos e identidad oficial aportados por React.

Los servicios backend construyen los metadatos institucionales. Las cargas genéricas no pueden escribir en Emitidos para eludir el emisor formal. La ruta heredada de nueva emisión no sustituye al servicio oficial; la recuperación de distribuciones legítimas mantiene el UUID sin conceder ACL.

No se concede Consumer automáticamente ni se usa una cuenta administrativa. El servicio técnico debe acreditar permisos efectivos sobre los nodos concretos.

## Jerarquía y decisiones

Dirección puede despachar a Jefaturas o Especialistas de su dependencia. Jefatura solo podrá derivar a especialistas supervisados mediante proveedor institucional verificado. Especialista no deriva.

La resolución del supervisor real y del revisor de Dirección usa un proveedor confiable de solo lectura. Un grupo funcional no demuestra por sí solo subordinación. Ausencia o ambigüedad bloquea la operación; nunca se sustituye por el primer usuario de una lista o por organization.json.

La capacidad de escritura no equivale a facultad de aprobar. La autoaprobación de Dirección sigue pendiente de política y bloqueada.

## Concurrencia e integridad

Se reutilizan colas por UUID y por código/ciclo; lectura, modificación y comprobación permanecen bajo el bloqueo correspondiente. Son mecanismos de una instancia. No hay transacción multinodo, compare-and-swap ni exclusión garantizada de escritores externos.

Los resultados inciertos se concilian con identidades estables y GET. No se repiten cargas ciegamente, no se reutilizan números inciertos ni se trunca el historial para liberar espacio.

## Configuración y evidencias

Los secretos permanecen en configuración privada, nunca en VITE, ejemplos, informes o fixtures. Los grupos y UUID reales se configuran fuera de Git. Los nombres técnicos del modelo, tipos estándar y contratos de API son parte del código y deben conservar su semántica.

Las evidencias institucionales se archivan fuera del repositorio con control de acceso. Los tests deben utilizar destinos .invalid, usuarios de prueba y UUID sintéticos. No ejecutar scripts de despliegue, ni sus opciones de escritura, como parte de una auditoría GET.

La validación reproducible está en [README](../README.md); las verificaciones con sesiones finales están en [READ_ACCESS_CHECKS](READ_ACCESS_CHECKS.md).

## Inventario de portabilidad

| Elemento | Tratamiento |
| --- | --- |
| Personas, estado y membresías | Consultas paginadas al directorio configurado y verificación de identidad. La lectura del PDF utiliza las credenciales del actor. |
| Jefaturas, especialistas y nuevas unidades | Lectura de `gdo:unidad` y `gdo:asignacion`, con estado activo, dependencia, revisión y comprobación de auditoría. |
| Códigos documentales y firmantes | Configuración institucional explícita y verificación en Alfresco. El nombre del usuario no acredita un código oficial. |
| Grupos, carpetas y cuentas técnicas | Configuración privada por entorno. El ID de cada grupo conserva puntuación, prefijo y mayúsculas. Las carpetas personales solo intervienen en entregas que requieren una bandeja personal. |
| Tipos, asociaciones, campos, nombres esperados de los contenedores y cabeceras del protocolo | Contratos de interoperabilidad y verificación del destino. Los scripts LAB comprueban además el contenedor de laboratorio antes de operar. |
| JSON históricos y planificador | Los originales permanecen privados. El planificador es independiente del servidor. Las pruebas de compatibilidad usan un almacén de fixture en un directorio temporal. |
| Nombres de usuarios, UUID y documentos de ejemplo | Datos sintéticos en pruebas. El navegador de regresión usa el frontend compilado y un servidor de fixtures. |
| Evidencias, locks, copias y builds | Exclusiones de Git. Las copias operativas y los diarios se conservan para conciliación. |
| Decisiones institucionales | El alta de emisores, la política sobre grupos anidados y la autorización de escrituras reales requieren validación del operador. |
