import { useState } from 'react'
import { loginBasic } from '../auth'
import { apiUrl } from '../api/client'
import './LoginPage.css'

/* eslint-disable react/prop-types */
export function LoginPage({ basicAuthEnabled, onAuthenticated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const logoUrl = import.meta.env.VITE_INSTITUTION_LOGO_URL
  const institution = import.meta.env.VITE_INSTITUTION_NAME || ''
  const [logoUnavailable, setLogoUnavailable] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const session = await loginBasic(username, password)
      onAuthenticated(session)
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <header className="login-card__brand">
          {logoUrl && !logoUnavailable && <img alt={institution} className="login-card__logo"
            onError={() => setLogoUnavailable(true)} referrerPolicy="no-referrer" src={logoUrl} />}
          {institution && <p className="login-card__institution">{institution}</p>}
          <p className="login-card__product">Gestión Documental Interna</p>
        </header>

        <div className="login-card__heading">
          <h1 id="login-title">Iniciar sesión</h1>
          <p>Acceda con sus credenciales institucionales.</p>
        </div>

        {basicAuthEnabled && (
          <form aria-busy={loading} className="login-form" onSubmit={handleSubmit}>
            <label className="form-field">
              <span>Usuario institucional</span>
              <input autoComplete="username" onChange={(event) => setUsername(event.target.value)} required value={username} />
            </label>
            <label className="form-field">
              <span>Contraseña</span>
              <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
            </label>
            {error && <p className="form-message form-message--error" role="alert">{error}</p>}
            <button className="button-primary login-card__submit" disabled={loading} type="submit">
              {loading && <span aria-hidden="true" className="login-card__spinner" />}
              {loading ? 'Validando…' : 'Iniciar sesión'}
            </button>
          </form>
        )}

        {basicAuthEnabled && <div className="login-divider"><span>O continúa con</span></div>}
        <a className="button-primary login-card__sso" href={apiUrl('/api/auth/login')}>Iniciar sesión institucional (SSO)</a>
        {!basicAuthEnabled && <p className="form-message">El acceso con cuentas Alfresco DEV está deshabilitado.</p>}
      </section>
    </main>
  )
}
