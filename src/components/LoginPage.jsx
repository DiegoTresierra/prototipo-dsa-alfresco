import { useEffect, useRef, useState } from 'react'
import './LoginPage.css'

/* eslint-disable react/prop-types */
export function LoginPage({ onDemoLogin, onGoogleLogin }) {
  const [demoProfile, setDemoProfile] = useState('DTI')
  const [message, setMessage] = useState('')
  const [googleConfig, setGoogleConfig] = useState(null)
  const [logoUnavailable, setLogoUnavailable] = useState(false)
  const googleMount = useRef(null)

  useEffect(() => {
    let cancelled = false
    let initialized = false

    const initializeGoogle = async () => {
      try {
        const configResponse = await fetch('/api/auth/config', { credentials: 'same-origin' })
        const config = await configResponse.json()
        if (!configResponse.ok || !config.enabled || !config.clientId) {
          if (!cancelled) setGoogleConfig({ enabled: false })
          return
        }
        if (cancelled) return
        setGoogleConfig({ enabled: true })

        const nonceResponse = await fetch('/api/auth/google/nonce', { credentials: 'same-origin' })
        const nonceResult = await nonceResponse.json()
        if (!nonceResponse.ok) throw new Error(nonceResult.error || 'No se pudo iniciar la verificación con Google.')

        const initialize = () => {
          if (cancelled || initialized || !googleMount.current || !window.google?.accounts?.id) return
          initialized = true
          window.google.accounts.id.initialize({
            client_id: config.clientId,
            nonce: nonceResult.nonce,
            callback: async ({ credential }) => {
              setMessage('Verificando la cuenta de Google…')
              try {
                const response = await fetch('/api/auth/google', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ credential }),
                })
                const result = await response.json()
                if (!response.ok) throw new Error(result.error || 'No se pudo verificar la identidad.')
                await onGoogleLogin()
              } catch (error) {
                setMessage(error.message || 'No se pudo verificar la identidad de Google.')
              }
            },
          })
          window.google.accounts.id.renderButton(googleMount.current, {
            theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular',
            width: Math.min(380, Math.max(250, googleMount.current.clientWidth)), locale: 'es',
          })
        }

        if (window.google?.accounts?.id) {
          initialize()
          return
        }

        let script = document.querySelector('script[data-google-identity]')
        if (!script) {
          script = document.createElement('script')
          script.src = 'https://accounts.google.com/gsi/client?hl=es'
          script.async = true
          script.defer = true
          script.dataset.googleIdentity = 'true'
          document.head.appendChild(script)
        }
        script.addEventListener('load', initialize, { once: true })
        script.addEventListener('error', () => setMessage('No se pudo cargar el servicio de identidad de Google.'), { once: true })
      } catch {
        if (!cancelled) setGoogleConfig({ enabled: false })
      }
    }

    initializeGoogle()
    return () => { cancelled = true }
  }, [onGoogleLogin])

  return (
    <main className="login-page">
      <section aria-labelledby="login-title" className="login-card">
        <div className="login-card__brand">
          {!logoUnavailable ? <img alt="Logotipo de la Universidad Andina del Cusco" className="login-card__logo" onError={() => setLogoUnavailable(true)} referrerPolicy="no-referrer" src="https://apiwww.uandina.edu.pe/storage/slider_detail/10/logotipo-actual-7d141a2a0266.webp" /> : <div aria-label="Universidad Andina del Cusco" className="login-card__logo-fallback">UAC</div>}
          <p className="login-card__institution">Universidad Andina del Cusco</p>
          <h1 id="login-title">Gestión Documental</h1>
        </div>

        <div className="login-form">
          <div aria-label="Acceso con cuenta de Google" className="login-google-mount" ref={googleMount} />
          {googleConfig?.enabled === false && <button className="login-google-button" disabled type="button">Ingresar con Google</button>}
          <p className="login-google-note">Google verifica la identidad; no se consulta una base de usuarios ni se asignan roles o permisos documentales.</p>
          {!googleConfig?.enabled && <p className="login-card__message">El acceso con Google aún no está configurado en este entorno.</p>}
          {message && <p aria-live="polite" className="login-card__message">{message}</p>}

          <div className="login-divider" role="separator"><span>Acceso de demostración</span></div>
          <label>
            <span>Perfil de prueba</span>
            <select onChange={(event) => setDemoProfile(event.target.value)} value={demoProfile}>
              <option value="DTI">Dirección de Tecnologías de Información (DTI)</option>
              <option value="DSA">Dirección de Servicios Académicos (DSA)</option>
            </select>
          </label>
          <button className="login-button" onClick={() => onDemoLogin(demoProfile)} type="button">Ingresar a la demostración</button>
        </div>

        <p className="login-card__notice">La demostración no autentica usuarios ni habilita el acceso a documentos de Alfresco.</p>
      </section>
    </main>
  )
}
