import { useState, type FormEvent } from 'react'
import type { TaskPriority, TaskStatus, ValidationError } from '../types/index.ts'
import { COLUMNS, PRIORITY_CONFIG } from '../types/index.ts'
import { useTaskContext, validateTask, validateComment } from '../context/TaskContext.tsx'
import TaskModal from './TaskModal.tsx'
import './TaskDetailModal.css'

interface TaskDetailModalProps {
  taskId: string
  onClose: () => void
}

export default function TaskDetailModal({ taskId, onClose }: TaskDetailModalProps) {
  const { state, updateTask, deleteTask, addComment, deleteComment, moveTask } = useTaskContext()
  const task = state.tasks.find((t) => t.id === taskId)
  const { profile } = state
  const currentUser = profile.displayName || profile.username

  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task?.title ?? '')
  const [editDescription, setEditDescription] = useState(task?.description ?? '')
  const [editPriority, setEditPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [editAssignee, setEditAssignee] = useState(task?.assignee ?? '')
  const [editTags, setEditTags] = useState(task?.tags.join(', ') ?? '')
  const [editErrors, setEditErrors] = useState<ValidationError[]>([])

  const [commentText, setCommentText] = useState('')
  const [commentErrors, setCommentErrors] = useState<ValidationError[]>([])

  const [showSubtaskModal, setShowSubtaskModal] = useState(false)
  const [openSubtaskId, setOpenSubtaskId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!task) return null

  const subtasks = state.tasks.filter((t) => t.parentId === task.id)
  const parentTask = task.parentId ? state.tasks.find((t) => t.id === task.parentId) : null
  const completedSubtasks = subtasks.filter((t) => t.status === 'done').length

  function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    const validationErrors = validateTask({ title: editTitle, description: editDescription })
    if (validationErrors.length > 0) {
      setEditErrors(validationErrors)
      return
    }
    updateTask(task!.id, {
      title: editTitle.trim(),
      description: editDescription.trim(),
      priority: editPriority,
      assignee: editAssignee.trim(),
      tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
    })
    setIsEditing(false)
  }

  function handleAddComment(e: FormEvent) {
    e.preventDefault()
    const author = currentUser
    const validationErrors = validateComment(commentText)
    if (!author) {
      validationErrors.push({ field: 'author', message: 'Set up your profile to comment' })
    }
    if (validationErrors.length > 0) {
      setCommentErrors(validationErrors)
      return
    }
    addComment(task!.id, commentText.trim(), author)
    setCommentText('')
    setCommentErrors([])
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    subtasks.forEach((st) => deleteTask(st.id))
    deleteTask(task!.id)
    onClose()
  }

  function getEditError(field: string) {
    return editErrors.find((e) => e.field === field)?.message
  }
  function getCommentError(field: string) {
    return commentErrors.find((e) => e.field === field)?.message
  }

  const priority = PRIORITY_CONFIG[task.priority]

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Task details">
      <div className="modal-content detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="detail-header-left">
            {parentTask && (
              <button className="parent-link" onClick={onClose} title={`Back to: ${parentTask.title}`}>
                ↑ {parentTask.title.slice(0, 30)}{parentTask.title.length > 30 ? '...' : ''}
              </button>
            )}
            <span className="task-id-badge">#{task.id.slice(0, 6)}</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {isEditing ? (
          <form onSubmit={handleSaveEdit} className="edit-form" noValidate>
            <div className={`form-group ${getEditError('title') ? 'has-error' : ''}`}>
              <label htmlFor="edit-title">Title *</label>
              <input
                id="edit-title"
                type="text"
                value={editTitle}
                onChange={(e) => { setEditTitle(e.target.value); setEditErrors(editErrors.filter(err => err.field !== 'title')) }}
                maxLength={100}
              />
              {getEditError('title') && <span className="field-error">{getEditError('title')}</span>}
            </div>
            <div className={`form-group ${getEditError('description') ? 'has-error' : ''}`}>
              <label htmlFor="edit-description">Description</label>
              <textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => { setEditDescription(e.target.value); setEditErrors(editErrors.filter(err => err.field !== 'description')) }}
                rows={3}
                maxLength={1000}
              />
              {getEditError('description') && <span className="field-error">{getEditError('description')}</span>}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="edit-priority">Priority</label>
                <select id="edit-priority" value={editPriority} onChange={(e) => setEditPriority(e.target.value as TaskPriority)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="edit-assignee">Assignee</label>
                <div className="assignee-field">
                  <input id="edit-assignee" type="text" value={editAssignee} onChange={(e) => setEditAssignee(e.target.value)} />
                  {currentUser && editAssignee !== currentUser && (
                    <button type="button" className="assign-me-btn" onClick={() => setEditAssignee(currentUser)} title="Assign to me">Me</button>
                  )}
                </div>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="edit-tags">Tags (comma separated)</label>
              <input id="edit-tags" type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Changes</button>
            </div>
          </form>
        ) : (
          <div className="detail-body">
            <div className="detail-main">
              <div className="detail-title-row">
                <h2 className="detail-title">{task.title}</h2>
                <button className="btn btn-sm btn-secondary edit-inline-btn" onClick={() => setIsEditing(true)}>Edit</button>
              </div>
              {task.description && <p className="detail-description">{task.description}</p>}

              <div className="detail-meta-grid">
                <div className="meta-item">
                  <span className="meta-label">Status</span>
                  <select
                    className="status-select"
                    value={task.status}
                    onChange={(e) => moveTask(task.id, e.target.value as TaskStatus)}
                    aria-label="Change status"
                  >
                    {COLUMNS.map((col) => (
                      <option key={col.id} value={col.id}>{col.icon} {col.title}</option>
                    ))}
                  </select>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Priority</span>
                  <span className="priority-display" style={{ color: priority.color }}>
                    {priority.icon} {priority.label}
                  </span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Assignee</span>
                  <div className="meta-assignee">
                    <span>{task.assignee || 'Unassigned'}</span>
                    {currentUser && task.assignee !== currentUser && (
                      <button
                        className="assign-me-link"
                        onClick={() => updateTask(task.id, { assignee: currentUser })}
                      >
                        Assign to me
                      </button>
                    )}
                  </div>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Created</span>
                  <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Created by</span>
                  <span className="created-by-value">{task.createdBy || 'Unknown'}</span>
                </div>
                {task.completedAt && (
                  <div className="meta-item">
                    <span className="meta-label">Completed</span>
                    <span>{new Date(task.completedAt).toLocaleDateString()}</span>
                  </div>
                )}
              </div>

              {task.tags.length > 0 && (
                <div className="detail-tags">
                  {task.tags.map((tag) => (
                    <span key={tag} className="task-tag">{tag}</span>
                  ))}
                </div>
              )}

              {/* Subtasks section */}
              <div className="subtasks-section">
                <div className="subtasks-header">
                  <h3>Subtasks {subtasks.length > 0 && <span className="subtask-progress">{completedSubtasks}/{subtasks.length}</span>}</h3>
                  <button className="btn btn-sm btn-secondary" onClick={() => setShowSubtaskModal(true)}>+ Add Subtask</button>
                </div>
                {subtasks.length > 0 && (
                  <>
                    <div className="subtask-progress-bar">
                      <div
                        className="subtask-progress-fill"
                        style={{ width: `${subtasks.length > 0 ? (completedSubtasks / subtasks.length) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="subtask-list">
                      {subtasks.map((st) => (
                        <div key={st.id} className={`subtask-item ${st.status === 'done' ? 'completed' : ''}`}>
                          <button
                            className="subtask-check"
                            onClick={() => moveTask(st.id, st.status === 'done' ? 'todo' : 'done')}
                            aria-label={st.status === 'done' ? 'Mark as incomplete' : 'Mark as complete'}
                          >
                            {st.status === 'done' ? '✓' : '○'}
                          </button>
                          <button
                            className="subtask-title-btn"
                            onClick={() => setOpenSubtaskId(st.id)}
                            title="Open subtask"
                          >
                            {st.title}
                          </button>
                          <span className="subtask-priority" style={{ color: PRIORITY_CONFIG[st.priority].color }}>
                            {PRIORITY_CONFIG[st.priority].icon}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {subtasks.length === 0 && (
                  <p className="no-subtasks">No subtasks yet</p>
                )}
              </div>

              {/* Action buttons */}
              <div className="detail-actions">
                <button
                  className={`btn ${confirmDelete ? 'btn-danger-confirm' : 'btn-danger'}`}
                  onClick={handleDelete}
                >
                  {confirmDelete ? 'Confirm Delete?' : 'Delete'}
                </button>
              </div>
            </div>

            {/* Comments section */}
            <div className="detail-comments">
              <h3>Comments ({task.comments.length})</h3>
              <div className="comments-list">
                {task.comments.map((comment) => (
                  <div key={comment.id} className="comment-item">
                    <div className="comment-header">
                      <span className="comment-avatar">{comment.author.charAt(0).toUpperCase()}</span>
                      <span className="comment-author">{comment.author}</span>
                      {comment.author === currentUser && <span className="comment-you-badge">you</span>}
                      <span className="comment-time">{new Date(comment.createdAt).toLocaleString()}</span>
                      <button
                        className="comment-delete"
                        onClick={() => deleteComment(task.id, comment.id)}
                        aria-label="Delete comment"
                        title="Delete comment"
                      >
                        ×
                      </button>
                    </div>
                    <p className="comment-text">{comment.text}</p>
                  </div>
                ))}
                {task.comments.length === 0 && (
                  <p className="no-comments">No comments yet. Start the conversation!</p>
                )}
              </div>
              {currentUser ? (
                <form className="comment-form" onSubmit={handleAddComment} noValidate>
                  <div className="comment-as-info">
                    Commenting as <strong>{currentUser}</strong>
                  </div>
                  <div className={`form-group ${getCommentError('text') ? 'has-error' : ''}`}>
                    <textarea
                      placeholder="Write a comment..."
                      value={commentText}
                      onChange={(e) => { setCommentText(e.target.value); setCommentErrors(commentErrors.filter(err => err.field !== 'text')) }}
                      rows={2}
                      maxLength={500}
                    />
                    {getCommentError('text') && <span className="field-error">{getCommentError('text')}</span>}
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm">Post Comment</button>
                </form>
              ) : (
                <div className="comment-form-disabled">
                  <p>Set up your profile to leave comments.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showSubtaskModal && (
        <TaskModal
          defaultStatus="backlog"
          parentId={task.id}
          onClose={() => setShowSubtaskModal(false)}
        />
      )}

      {openSubtaskId && (
        <TaskDetailModal
          taskId={openSubtaskId}
          onClose={() => setOpenSubtaskId(null)}
        />
      )}
    </div>
  )
}
