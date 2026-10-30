import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const alfrescoTarget = env.ALFRESCO_TARGET
  const hasCredentials = env.ALFRESCO_USERNAME && env.ALFRESCO_PASSWORD

  return {
    plugins: [react()],
    base: '/prototipo-dsa-alfresco/',
    server: {
      proxy: {
        '/api/alfresco': {
          target: alfrescoTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/alfresco/, '/alfresco'),
          ...(hasCredentials
            ? {
                auth: `${env.ALFRESCO_USERNAME}:${env.ALFRESCO_PASSWORD}`,
              }
            : {}),
        },
      },
    },
  }
})
