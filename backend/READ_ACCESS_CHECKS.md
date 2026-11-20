# Verificación de lectura con sesiones finales

Este procedimiento no concede permisos ni realiza escrituras. Se ejecuta con sesiones reales autorizadas; no se infieren derechos de Dirección o Jefatura a partir de la cuenta técnica.

## Casos

1. Emisor consulta un PDF propio.
2. Destinatario consulta un PDF distribuido por asociación secundaria.
3. Usuario ajeno intenta leer un documento no compartido.
4. Revisor institucional intenta consultar original, propuesta y versión histórica.

Obtener los identificadores desde la bandeja autorizada de esa sesión; no incluirlos en informes compartidos.

## Comprobaciones GET

En Network, registrar en privado estado HTTP, identificador de caso, identidad efectiva y resultado, sin cookies, Authorization ni contraseñas.

- GET /api/auth/me confirma el contexto de la sesión.
- GET del nodo mediante /api/alfresco/api/-default-/public/alfresco/versions/1/nodes/{documentId} comprueba metadatos autorizados.
- GET del contenido mediante el mismo prefijo y /content comprueba PDF no vacío.
- La asociación cm:contains debe confirmarse mediante Alfresco, incluyendo ubicaciones secundarias; la visibilidad en una bandeja no demuestra ACL del nodo.
- Las propuestas se consultan mediante /api/documents/response-proposals?documentId=... y sus versiones mediante /api/documents/proposal-version-content. No se usa una ruta arbitraria de UUID para eludir el original o su vínculo.

Las versiones estándar se consultan en Alfresco con GET /nodes/{id}/versions, detalle /versions/{versionId} y /content de esa versión. La ausencia de una ruta proxy genérica para versiones no significa que Alfresco no las soporte: usar el servicio autorizado de propuestas o una sesión de API ya autorizada.

Para verificar firma y SHA-256 sin publicar contenido, usar herramientas locales sobre el PDF obtenido con la sesión. Un HTTP 200 con cero bytes no acredita una versión válida. No pegar un token en consola o en un archivo compartido.

## Interpretación y evidencia privada

Una asociación secundaria no concede lectura. Un 403 de /parents puede impedir enumerar padres sin negar el PDF; usar comprobación positiva de cm:contains cuando la política lo permita.

Jefatura conserva la política de propios/Por conocimiento y asignaciones Por atender; leer no concede responsabilidad, derivación ni aprobación. Para revisores futuros, integrar autoridad institucional específica sin acceso global por UUID.

Conservar evidencia fuera del repositorio: caso, fecha, actor, estados HTTP, tamaño, tipo y hash cuando proceda. No almacenar tokens ni PDF institucional en Git, capturas públicas o reportes de CI. Las ACL faltantes requieren decisión humana independiente.
