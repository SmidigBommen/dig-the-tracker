import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext.tsx'
import { supabase } from '../lib/supabase.ts'
import LoginPage from './LoginPage.tsx'

interface InviteHandlerProps {
  token: string
}

export default function InviteHandler({ token }: InviteHandlerProps) {
  const { session, loading } = useAuth()
  const [status, setStatus] = useState<'pending' | 'accepting' | 'success' | 'error'>('pending')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!session || status !== 'pending') return

    async function accept() {
      setStatus('accepting')
      console.log('[invite] accepting token:', token.slice(0, 8) + '...')
      const { error } = await supabase.rpc('accept_invite', { p_token: token })
      if (error) {
        console.log('[invite] error:', error.message)
        setStatus('error')
        setErrorMsg(error.message)
      } else {
        console.log('[invite] accepted')
        setStatus('success')
        // Clear the invite query param and reload
        const url = new URL(window.location.href)
        url.searchParams.delete('invite')
        window.location.replace(url.toString())
      }
    }

    accept()
  }, [session, token, status])

  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    )
  }

  if (!session) {
    return <LoginPage message="Sign in to join this board" />
  }

  if (status === 'error') {
    return (
      <div className="app-loading">
        <p style={{ color: '#ef4444' }}>Invalid or expired invite link</p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>{errorMsg}</p>
        <button className="btn btn-primary" onClick={() => {
          const url = new URL(window.location.href)
          url.searchParams.delete('invite')
          window.location.replace(url.toString())
        }}>
          Go to Board
        </button>
      </div>
    )
  }

  return (
    <div className="app-loading">
      <div className="loading-spinner" />
      <p>Joining board...</p>
    </div>
  )
}
