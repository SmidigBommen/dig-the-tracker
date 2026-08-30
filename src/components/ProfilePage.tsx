import { useState, type FormEvent } from 'react'
import { useTaskContext } from '../context/TaskContext.tsx'
import './ProfilePage.css'

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
  '#10b981', '#14b8a6', '#3b82f6', '#f97316', '#84cc16',
]

export default function ProfilePage() {
  const { state, updateProfile } = useTaskContext()
  const actor = state.actor
  const [displayName, setDisplayName] = useState(actor?.display_name ?? '')
  const [avatarColor, setAvatarColor] = useState(actor?.avatar_color ?? '#6366f1')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!displayName.trim()) return
    setSaving(true)
    const updated = await updateProfile(displayName.trim(), avatarColor)
    setSaving(false)
    if (updated) {
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    }
  }

  const initials = (displayName || 'L').split(' ').map((part) => part.charAt(0).toUpperCase()).slice(0, 2).join('')
  const assigned = state.tasks.filter((task) => task.assignee_name.toLowerCase() === displayName.toLowerCase() && !task.parentId)
  const completed = assigned.filter((task) => task.status === 'done').length
  const comments = Object.values(state.commentsByTask).flat().filter((comment) => comment.author_id === actor?.id).length

  return (
    <div className="profile-page">
      <div className="profile-layout">
        <div className="profile-card">
          <div className="profile-avatar-section">
            <div className="profile-avatar-large" style={{ background: avatarColor }}>{initials}</div>
            <div className="profile-identity">
              <h2>{displayName || 'Local User'}</h2>
              <span className="profile-email">Local profile · no account or login</span>
            </div>
          </div>
          <div className="profile-stats-row">
            <div className="profile-stat"><span className="profile-stat-value">{assigned.length}</span><span className="profile-stat-label">Assigned</span></div>
            <div className="profile-stat"><span className="profile-stat-value">{completed}</span><span className="profile-stat-label">Completed</span></div>
            <div className="profile-stat"><span className="profile-stat-value">{comments}</span><span className="profile-stat-label">Comments</span></div>
          </div>
        </div>

        <div className="profile-form-card">
          <h3>Edit Local Profile</h3>
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="profile-displayName">Display Name *</label>
              <input id="profile-displayName" type="text" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setSaved(false) }} maxLength={50} />
            </div>
            <div className="form-group">
              <label>Avatar Color</label>
              <div className="avatar-color-picker">
                {AVATAR_COLORS.map((color) => (
                  <button key={color} type="button" className={`avatar-color-option ${avatarColor === color ? 'selected' : ''}`} style={{ backgroundColor: color }} onClick={() => { setAvatarColor(color); setSaved(false) }} aria-label={`Select color ${color}`} />
                ))}
              </div>
            </div>
            <div className="profile-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving || !displayName.trim()}>{saving ? 'Saving...' : 'Save Profile'}</button>
              {saved && <span className="save-success">Profile saved!</span>}
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
