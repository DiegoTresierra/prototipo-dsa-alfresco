# Verificación de identidad Google en desarrollo

Este flujo verifica una cuenta de Google y muestra su nombre y correo. No consulta una base de usuarios, no asigna roles o dependencias y no concede acceso al dashboard ni a Alfresco. La sesión local vive en memoria y se pierde al reiniciar el servidor.

## Configuración

DTI debe crear o aprobar un OAuth Client ID de tipo aplicación web para el entorno de desarrollo y autorizar el origen local que se use. El Client ID es público; no se deben colocar aquí contraseñas, client secrets ni tokens. La app usa Google Identity Services y valida la firma, audiencia, emisor, expiración, correo verificado y nonce del ID token en el servidor local.

Configura `GOOGLE_CLIENT_ID` en el `.env.local` existente. Opcionalmente, DTI puede aprobar `GOOGLE_ALLOWED_HOSTED_DOMAIN` para limitar el acceso a un dominio Google Workspace concreto. Si no se configura `GOOGLE_CLIENT_ID`, el botón permanece deshabilitado. Nunca envíes valores de `.env.local` por chat ni los subas al repositorio.

## Ejecución local

Abre dos terminales en el proyecto:

```sh
npm run dev:auth-server
npm run dev
```

Vite reenvía `/api/auth` al servidor de sesión local en `127.0.0.1`. Este servidor solo escucha en loopback y rechaza la ejecución con `NODE_ENV=production`. No se debe exponer con `--host 0.0.0.0`.

El login de demostración sigue separado y simula perfiles. La verificación Google no equivale a autenticación institucional autorizada para acceder a documentos. La protección por dependencia y usuario requiere que DTI defina y despliegue una arquitectura de backend y permisos antes de habilitar el acceso documental a cuentas reales.
