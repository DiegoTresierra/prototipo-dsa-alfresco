# Arquitectura y seguridad documental

## Fuentes de verdad

Alfresco conserva nodos, contenido, relaciones, grupos, membresías y metadatos. El navegador presenta datos autorizados; su caché no asigna correlativos ni acredita permisos. Keycloak y el backend gestionan autenticación; la autoridad institucional se confirma en Alfresco.

El JSON provisional de organización no es fuente de supervisión ni autorización documental. La persistencia local de despachos y números se conserva únicamente para compatibilidad/recuperación y no debe confundirse con la fuente operativa Alfresco.

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
