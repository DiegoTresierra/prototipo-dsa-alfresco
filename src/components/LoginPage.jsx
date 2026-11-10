import { useState } from 'react'
import { loginBasic } from '../auth'

/* eslint-disable react/prop-types */
export function LoginPage({ basicAuthEnabled, onAuthenticated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
        <p className="breadcrumb">Gestión Documental UAC</p>
        <h1 id="login-title">Inicie sesión</h1>
        {basicAuthEnabled && (
          <form onSubmit={handleSubmit}>
            <label className="form-field"><span>Usuario Alfresco DEV</span><input autoComplete="username" onChange={(event) => setUsername(event.target.value)} required value={username} /></label>
            <label className="form-field"><span>Contraseña</span><input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
            {error && <p className="form-message form-message--error" role="alert">{error}</p>}
            <button className="button-primary login-card__submit" disabled={loading} type="submit">{loading ? 'Validando...' : 'Iniciar sesión'}</button>
          </form>
        )}
        {basicAuthEnabled && <div className="login-divider" aria-hidden="true"><span>O</span></div>}
        <a className="button-primary login-card__sso" href="/api/auth/login">Iniciar sesión institucional (SSO)</a>
        {!basicAuthEnabled && <p className="form-message">El acceso con cuentas Alfresco DEV está deshabilitado.</p>}
      </section>
    </main>
  )
}
