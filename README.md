# Prototipo DSA - Gestión Documental

Prototipo React/Vite para validar el flujo inicial de gestión documental con Alfresco Community.

## Desarrollo local

La aplicación utiliza un BFF Node.js. Ejecuta el backend y el frontend en terminales separadas:

```powershell
Copy-Item .env.example .env
# Edita .env con los valores del entorno DEV; no agregues secretos al repositorio.
npm install
npm run dev:server
npm run dev -- --host
```

El frontend redirige `/api` a `http://localhost:3000`. El backend mantiene las sesiones y las credenciales de Alfresco fuera del navegador, en memoria temporal para DEV.

## Variables principales

- `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` y `KEYCLOAK_REDIRECT_URI`: cliente OIDC institucional registrado por Infraestructura.
- `ALFRESCO_TARGET`: URL base de Alfresco DEV.
- `ALFRESCO_BASIC_AUTH_ENABLED`: permite desactivar el acceso Basic Auth; debe ser `false` en producción.
- `ALFRESCO_SSO_AUTH_MODE`: modo de vinculación SSO con Alfresco; actualmente `bearer`.
- `ALFRESCO_GROUP_MAPPINGS_JSON`: mapa exacto de dependencia y función a grupos Alfresco. La configuración DEV esperada es `{"dependencies":{"DTI":"GROUP_GD_DTI","DSA":"GROUP_GD_DSA"},"functions":{"direccion":"GROUP_GD_DIRECCION","jefe-unidad":"GROUP_GD_JEFE_UNIDAD","especialista":"GROUP_GD_ESPECIALISTA"}}`.
- `SESSION_SECRET`: secreto aleatorio del backend.
- `COOKIE_SECURE`: debe ser `true` cuando el backend use HTTPS.

Alfresco es la fuente de verdad: después de cada autenticación se consulta `people/-me-` y los grupos de esa identidad. El backend exige exactamente una dependencia y una función reconocidas; si falta alguna o hay más de una, la sesión queda con autorización incompleta o ambigua y sin acceso documental restringido. La pantalla se resuelve con el `roleId` derivado, nunca por correo o nombre de usuario.

Para validar únicamente el resolver con combinaciones sintéticas:

```powershell
npm run test:resolver
```

## Endpoints del BFF

- `POST /api/auth/basic`: autenticación individual temporal con ticket Alfresco DEV.
- `GET /api/auth/login` y `GET /api/auth/callback`: Authorization Code + PKCE S256 con Keycloak.
- `GET /api/auth/me`: sesión pública sin tokens, tickets ni contraseñas.
- `GET /api/auth/status`: diagnóstico limitado.
- `POST /api/auth/logout`: invalida la sesión y exige CSRF.
- `/api/alfresco/...`: proxy autenticado con rutas Alfresco permitidas.

El cliente Keycloak `gestion-documental-dev` debe tener como redirect URI el valor de `KEYCLOAK_REDIRECT_URI`. No se reutiliza el cliente institucional `alfresco`.