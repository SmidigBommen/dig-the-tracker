import { useState, type FormEvent } from 'react'
import { useTaskContext } from '../context/TaskContext.tsx'
import { useAuth } from '../context/AuthContext.tsx'
import { supabase } from '../lib/supabase.ts'
import './ProfilePage.css'

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#10b981', '#14b8a6', '#3b82f6',
  '#f97316', '#84cc16',
]

export default function ProfilePage() {
  const { state } = useTaskContext()
  const { profile: authProfile, user, updateProfile: updateAuthProfile } = useAuth()

  const displayName = authProfile?.display_name || ''
  const email = user?.email || ''
  const avatarColor = authProfile?.avatar_color || '#6366f1'

  const [editDisplayName, setEditDisplayName] = useState(displayName)
  const [editAvatarColor, setEditAvatarColor] = useState(avatarColor)
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Invite link state
  const [inviteLink, setInviteLink] = useState('')
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editDisplayName.trim()) return
    setIsSaving(true)
    await updateAuthProfile({
      display_name: editDisplayName.trim(),
      avatar_color: editAvatarColor,
    })
    setIsSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function handleGenerateInvite() {
    const boardId = state.boardId
    if (!boardId || !user) return
    setIsGeneratingInvite(true)
    const { data, error } = await supabase
      .from('board_shares')
      .insert({ board_id: boardId, created_by: user.id })
      .select('token')
      .single()
    setIsGeneratingInvite(false)
    if (error || !data) return

    const baseUrl = window.location.origin + (import.meta.env.BASE_URL || '/')
    const link = `${baseUrl}?invite=${data.token}`
    setInviteLink(link)
    navigator.clipboard.writeText(link).then(() => {
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 3000)
    })
  }

  const initials = (editDisplayName || 'U')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('')

  const tasksByUser = state.tasks.filter(
    (t) => t.assignee_name.toLowerCase() === displayName.toLowerCase() && !t.parentId
  )
  const completedByUser = tasksByUser.filter((t) => t.status === 'done').length

  // Count comments by user from commentsByTask
  let commentsByUser = 0
  const commentsByTask = (state as unknown as { commentsByTask?: Record<string, { author_name: string }[]> }).commentsByTask
  if (commentsByTask) {
    for (const comments of Object.values(commentsByTask)) {
      commentsByUser += comments.filter((c) => c.author_name.toLowerCase() === displayName.toLowerCase()).length
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-layout">
        <div className="profile-card">
          <div className="profile-avatar-section">
            <div className="profile-avatar-large" style={{ background: editAvatarColor }}>
              {initials || 'U'}
            </div>
            <div className="profile-identity">
              <h2>{displayName || 'Set up your profile'}</h2>
              {email && <span className="profile-email">{email}</span>}
            </div>
          </div>

          {displayName && (
            <div className="profile-stats-row">
              <div className="profile-stat">
                <span className="profile-stat-value">{tasksByUser.length}</span>
                <span className="profile-stat-label">Assigned</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{completedByUser}</span>
                <span className="profile-stat-label">Completed</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{commentsByUser}</span>
                <span className="profile-stat-label">Comments</span>
              </div>
            </div>
          )}
        </div>

        <div className="profile-form-card">
          <h3>Edit Profile</h3>
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="profile-email">Email</label>
              <input
                id="profile-email"
                type="email"
                value={email}
                disabled
                className="input-disabled"
              />
              <span className="field-hint">Email is managed by your login</span>
            </div>

            <div className="form-group">
              <label htmlFor="profile-displayName">Display Name *</label>
              <input
                id="profile-displayName"
                type="text"
                value={editDisplayName}
                onChange={(e) => { setEditDisplayName(e.target.value); setSaved(false) }}
                placeholder="How others see you"
                maxLength={50}
              />
            </div>

            <div className="form-group">
              <label>Avatar Color</label>
              <div className="avatar-color-picker">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`avatar-color-option ${editAvatarColor === color ? 'selected' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => { setEditAvatarColor(color); setSaved(false) }}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
            </div>

            <div className="profile-form-actions">
              <button type="submit" className="btn btn-primary" disabled={isSaving || !editDisplayName.trim()}>
                {isSaving ? 'Saving...' : 'Save Profile'}
              </button>
              {saved && <span className="save-success">Profile saved!</span>}
            </div>
          </form>
        </div>

        <div className="profile-form-card">
          <h3>Invite Team Members</h3>
          <p className="invite-description">Generate a link to invite others to this board. Links expire after 7 days.</p>
          <button
            className="btn btn-secondary"
            onClick={handleGenerateInvite}
            disabled={isGeneratingInvite}
          >
            {isGeneratingInvite ? 'Generating...' : 'Generate Invite Link'}
          </button>
          {inviteLink && (
            <div className="invite-link-box">
              <input type="text" value={inviteLink} readOnly className="invite-link-input" />
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(inviteLink)
                  setInviteCopied(true)
                  setTimeout(() => setInviteCopied(false), 3000)
                }}
              >
                {inviteCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
