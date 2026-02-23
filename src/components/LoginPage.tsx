import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext.tsx'
import './LoginPage.css'

interface LoginPageProps {
  message?: string
}

export default function LoginPage({ message }: LoginPageProps) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    setErrorMsg('')
    const { error } = await signIn(email.trim())
    if (error) {
      setStatus('error')
      setErrorMsg(error)
    } else {
      setStatus('sent')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-logo-icon">◆</span>
          <h1>Dig</h1>
          <span className="login-subtitle">Issue Tracker</span>
        </div>

        {message && <p className="login-message">{message}</p>}

        {status === 'sent' ? (
          <div className="login-success">
            <p>Check your email for a magic link to sign in.</p>
            <button className="btn btn-secondary" onClick={() => setStatus('idle')}>
              Try a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
              />
            </div>
            {status === 'error' && <p className="login-error">{errorMsg}</p>}
            <button
              type="submit"
              className="btn btn-primary login-btn"
              disabled={status === 'sending' || !email.trim()}
            >
              {status === 'sending' ? 'Sending...' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
