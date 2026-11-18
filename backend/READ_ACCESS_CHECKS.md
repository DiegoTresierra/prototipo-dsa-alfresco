# Comprobaciones GET con sesiones reales de prueba

Mantener `OFFICIAL_EMISSION_WRITES_ENABLED=false`. Esta prueba no emite documentos, no concede permisos ni llama al endpoint de login. Requiere una sesión ya iniciada en la aplicación y el backend local disponible. Si falta sesión, dejar la prueba pendiente; no compartir tokens, cookies, contraseñas ni el JSON completo de `/api/auth/me`.

Las sesiones DSA_T/DTI_T no están accesibles al agente: no hay sesión de navegador conectada ni backend local disponible en la comprobación. La cuenta `gd_distribucion` sirve para inventario y ACL, pero NO sustituye la lectura efectiva de un destinatario. Por ello no se registran resultados HTTP ficticios para esas dos identidades.

## Pasos desde el navegador

1. Con la aplicación abierta y una sesión real DSA_T, abrir DevTools → Console. Confirmar que es el entorno DEV acordado. No pulsar emitir, derivar, atender o modificar permisos.
2. Revisar y ejecutar el siguiente bloque GET-only. Examina el usuario efectivo del backend y luego los dos UUID concretos. No lee ni imprime credenciales. Una denegación esperada debe ser 403/404, no 401 ni fallo de red.
3. Repetir en una ventana/perfil con sesión DTI_T. No sustituir su identidad por un parámetro ni utilizar la cuenta técnica para simularla.
4. Conservar únicamente las filas de resultados y la identidad resumida. Comparar metadatos y contenido por separado: listar un nodo en una bandeja no prueba que pueda descargarse.

```javascript
await (async () => {
  const options = { method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store' };
  const response = await fetch('/api/auth/me', options);
  if (response.status !== 200) throw new Error('PENDIENTE: falta sesión real activa');
  const session = await response.json();
  const userId = session.alfresco?.id;
  if (session.authorizationStatus !== 'active' || !['DSA_T', 'DTI_T'].includes(userId)) {
    throw new Error('PENDIENTE: utilizar la sesión de prueba acordada');
  }
  console.log({ userId, functionalRole: session.functionalRole, dependency: session.dependency });
  const shared = '18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097';
  const privateDTI = 'efa8b1e8-0814-42e4-a8b1-e8081472e43e';
  const cases = [
    { documentId: shared, expectedRead: true, case: 'DTI compartido con DSA' },
    { documentId: privateDTI, expectedRead: userId === 'DTI_T', case: 'DTI no compartido' }
  ];
  const rows = [];
  for (const item of cases) {
    try {
      const base = '/api/alfresco/api/-default-/public/alfresco/versions/1/nodes/' + encodeURIComponent(item.documentId);
      const metadata = await fetch(base + '?include=properties', options);
      const content = await fetch(base + '/content', options);
      const bytes = new Uint8Array(await content.arrayBuffer());
      const mime = (content.headers.get('content-type') || '').split(';')[0].trim();
      const pdfSignature = new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
      const readable = metadata.status === 200 && content.status === 200;
      const validPdf = content.status === 200 && bytes.length > 0 && mime === 'application/pdf' && pdfSignature;
      const denied = [403, 404].includes(metadata.status) && [403, 404].includes(content.status);
      let sha256;
      if (content.status === 200) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        sha256 = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
      }
      rows.push({ userId, ...item, metadataHTTP: metadata.status, contentHTTP: content.status,
        bytes: bytes.length, mime, pdfSignature, sha256,
        result: item.expectedRead ? readable && validPdf ? 'OK' : 'REVISAR' : denied ? 'OK_DENEGADO' : 'REVISAR' });
    } catch (error) { rows.push({ userId, ...item, result: 'PENDIENTE_ERROR_GET', error: error.name }); }
  }
  console.table(rows);
  return rows;
})();
```

La comprobación de permisos no requiere `include=permissions`: Consumer puede consultar metadatos/contenido sin que debamos exigir facultades de administración de ACL. La firma `%PDF-` comprueba el tipo inicial y no es una validación estructural completa del PDF. Comparar el SHA-256 del documento compartido obtenido desde ambas sesiones.

## Matriz y registro pendiente

| Sesión real | Documento | Resultado esperado | Resultado real actual |
|---|---|---|---|
| DSA_T | `18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097` | Metadatos 200, contenido 200, PDF no vacío | PENDIENTE: sesión no accesible |
| DTI_T | `18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097` | Metadatos 200, contenido 200, mismo hash | PENDIENTE: sesión no accesible |
| DSA_T | `efa8b1e8-0814-42e4-a8b1-e8081472e43e` | Metadatos y contenido 403/404 | PENDIENTE: sesión no accesible |
| DTI_T | `efa8b1e8-0814-42e4-a8b1-e8081472e43e` | Metadatos y contenido 200, PDF no vacío | PENDIENTE: sesión no accesible |

No usar los UUID `ae23bcf0-ef2a-48c7-a3bc-f0ef2a98c7b1` y `dd778efd-6acd-48f1-b78e-fd6acd08f1e1` como controles positivos de PDF: el GET técnico devolvió 200 pero contenido de cero bytes. No repararlos automáticamente.

El código del proxy sigue enviando la autorización de la sesión real; no hay un fallback a la cuenta técnica para estas descargas. Si un GET propio falla, registrar su estado y revisar identidad/ACL. Si el control negativo permite acceso, detener el piloto y auditar la concesión antes de modificar permisos.
