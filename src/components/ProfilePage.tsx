import { useState, type FormEvent } from 'react'
import type { ValidationError } from '../types/index.ts'
import { useTaskContext, validateProfile } from '../context/TaskContext.tsx'
import './ProfilePage.css'

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#10b981', '#14b8a6', '#3b82f6',
  '#f97316', '#84cc16',
]

export default function ProfilePage() {
  const { state, updateProfile } = useTaskContext()
  const { profile } = state

  const [username, setUsername] = useState(profile.username)
  const [email, setEmail] = useState(profile.email)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [avatarColor, setAvatarColor] = useState(profile.avatarColor)
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [saved, setSaved] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const validationErrors = validateProfile({ username, email, displayName })
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      setSaved(false)
      return
    }
    updateProfile({
      username: username.trim(),
      email: email.trim(),
      displayName: displayName.trim(),
      avatarColor,
    })
    setErrors([])
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function getFieldError(field: string) {
    return errors.find((e) => e.field === field)?.message
  }

  const initials = (displayName || username || 'U')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('')

  const tasksByUser = state.tasks.filter(
    (t) => t.assignee.toLowerCase() === (displayName || username).toLowerCase() && !t.parentId
  )
  const completedByUser = tasksByUser.filter((t) => t.status === 'done').length
  const commentsByUser = state.tasks.reduce(
    (sum, t) => sum + t.comments.filter((c) => c.author.toLowerCase() === (displayName || username).toLowerCase()).length,
    0
  )

  return (
    <div className="profile-page">
      <div className="profile-layout">
        <div className="profile-card">
          <div className="profile-avatar-section">
            <div className="profile-avatar-large" style={{ background: avatarColor }}>
              {initials || 'U'}
            </div>
            <div className="profile-identity">
              <h2>{displayName || username || 'Set up your profile'}</h2>
              {username && <span className="profile-handle">@{username}</span>}
              {email && <span className="profile-email">{email}</span>}
            </div>
          </div>

          {(displayName || username) && (
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
            <div className={`form-group ${getFieldError('username') ? 'has-error' : ''}`}>
              <label htmlFor="profile-username">Username *</label>
              <input
                id="profile-username"
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setErrors(errors.filter(err => err.field !== 'username')); setSaved(false) }}
                placeholder="e.g. neo"
                maxLength={30}
              />
              {getFieldError('username') && <span className="field-error">{getFieldError('username')}</span>}
            </div>

            <div className={`form-group ${getFieldError('email') ? 'has-error' : ''}`}>
              <label htmlFor="profile-email">Email *</label>
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrors(errors.filter(err => err.field !== 'email')); setSaved(false) }}
                placeholder="you@example.com"
              />
              {getFieldError('email') && <span className="field-error">{getFieldError('email')}</span>}
            </div>

            <div className={`form-group ${getFieldError('displayName') ? 'has-error' : ''}`}>
              <label htmlFor="profile-displayName">Display Name</label>
              <input
                id="profile-displayName"
                type="text"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setErrors(errors.filter(err => err.field !== 'displayName')); setSaved(false) }}
                placeholder="How others see you"
                maxLength={50}
              />
              {getFieldError('displayName') && <span className="field-error">{getFieldError('displayName')}</span>}
            </div>

            <div className="form-group">
              <label>Avatar Color</label>
              <div className="avatar-color-picker">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`avatar-color-option ${avatarColor === color ? 'selected' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => { setAvatarColor(color); setSaved(false) }}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
            </div>

            <div className="profile-form-actions">
              <button type="submit" className="btn btn-primary">
                Save Profile
              </button>
              {saved && <span className="save-success">Profile saved!</span>}
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
