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

## Recorrido por rol sin escrituras

Abrir el frontend e iniciar sesión manualmente con cada cuenta de ensayo. Repetir
por separado con Dirección de cada dependencia, una Jefatura y un Especialista.
No emplear las credenciales técnicas como si fueran esas sesiones. Usar siempre
el mismo origen del navegador para conservar la sesión; no copiar cookies o tickets.

| GET | Dirección | Jefatura | Especialista |
| --- | --- | --- | --- |
| `/api/auth/me` | Identidad de la sesión | Identidad de la sesión | Identidad de la sesión |
| `/api/documents/emitted` | Originales de su dependencia | Emisiones propias autorizadas | Emisiones propias autorizadas |
| `/api/documents/dispatches` | Asignaciones y despachos visibles | Encargos y derivaciones propias | Encargos propios |
| `/api/documents/dispatches?include=documents` | No corresponde | Metadatos autorizados por UUID | Metadatos autorizados por UUID |
| `/api/directory/dispatch-recipients` | Roles destinatarios permitidos | Especialistas con supervisión acreditada | 403: no deriva |
| `/api/hierarchy` y `/api/hierarchy/audit` | Lectura administrativa institucional | 403 | 403 |
| `/api/documents/closure` | Bandeja protegida por dependencia | 403 | 403 |

Un 503 de jerarquía sin configuración no es prueba de que Alfresco esté caído.
`HIERARCHY_ALFRESCO_CONFIGURATION_REQUIRED` enumera únicamente nombres de parámetros.
Completar manualmente el almacenamiento `alfresco`, la identidad lectora autorizada,
su secreto y los UUID verificados de los contenedores institucional y de auditoría.
La consulta no requiere el contenedor LAB ni flags de escritura. Un 403 al consultar
un contenedor candidato impide acreditarlo; no demuestra ausencia de relaciones.

Este fragmento opcional se ejecuta en la consola del navegador ya autenticado.
Solo efectúa GET y produce un resumen acotado, sin tokens, títulos ni UUID documentales:

```js
await (async () => {
  const get = async path => {
    const response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
    const body = await response.json().catch(() => ({}))
    return { status: response.status, body }
  }
  const me = await get('/api/auth/me')
  if (me.status !== 200) return { sessionStatus: me.status, authenticated: false }
  const role = me.body.functionalRole
  const paths = ['/api/documents/emitted', '/api/documents/dispatches', '/api/directory/dispatch-recipients',
    '/api/hierarchy', '/api/hierarchy/audit', '/api/documents/closure']
  if (['jefe-unidad', 'especialista'].includes(role)) paths.push('/api/documents/dispatches?include=documents')
  const results = []
  for (const path of paths) {
    try {
      const { status, body } = await get(path)
      results.push({ path, status, error: body.error, persistence: body.persistence, source: body.source,
        complete: body.complete, documents: body.documents?.length, assignments: body.dispatches?.length,
        recipients: body.recipients?.length, closureCounts: body.counts, missingConfiguration: body.missingConfiguration })
    } catch { results.push({ path, status: 'NETWORK_UNAVAILABLE' }) }
  }
  return { actor: { id: me.body.alfresco?.id, functionalRole: role, dependency: me.body.dependency,
    authorizationStatus: me.body.authorizationStatus }, results }
})()
```

Además, abrir un PDF de su bandeja y comprobar GET de metadatos y contenido no vacío.
Para un caso ajeno usar un UUID de ensayo autorizado para la prueba negativa y exigir
rechazo del backend y de Alfresco. La consulta de bandeja no sustituye ese control.
En Aprobar cierres, seleccionar una fila solo para obtener una evaluación GET nueva;
no pulsar botones de decisión. Las categorías, los contadores y sus bloqueos deben
provenir del servicio protegido, nunca de una evaluación ejecutada como cuenta técnica.
