import { useState, type FormEvent } from 'react'
import type { TaskStatus, TaskPriority, ValidationError } from '../types/index.ts'
import { useTaskContext } from '../context/TaskContext.tsx'
import { useAuth } from '../context/AuthContext.tsx'
import { validateTask } from '../context/taskUtils.ts'
import './TaskModal.css'

interface TaskModalProps {
  defaultStatus: TaskStatus
  parentId?: string
  onClose: () => void
}

export default function TaskModal({ defaultStatus, parentId, onClose }: TaskModalProps) {
  const { addTask } = useTaskContext()
  const { profile: authProfile } = useAuth()
  const currentUser = authProfile?.display_name || ''

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assignee, setAssignee] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const validationErrors = validateTask({ title, description })
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    setIsSubmitting(true)
    await addTask({
      title: title.trim(),
      description: description.trim(),
      status: defaultStatus,
      priority,
      assignee: assignee.trim(),
      createdBy: currentUser,
      tags,
      parentId: parentId || undefined,
      subtaskIds: [],
    })
    setIsSubmitting(false)
    onClose()
  }

  function getFieldError(field: string): string | undefined {
    return errors.find((e) => e.field === field)?.message
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Create task">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{parentId ? 'Add Subtask' : 'Create New Task'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {currentUser && (
          <div className="modal-creator-info">
            Creating as <strong>{currentUser}</strong>
          </div>
        )}
        <form onSubmit={handleSubmit} noValidate>
          <div className={`form-group ${getFieldError('title') ? 'has-error' : ''}`}>
            <label htmlFor="task-title">Title *</label>
            <input
              id="task-title"
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setErrors(errors.filter(err => err.field !== 'title')) }}
              placeholder="Enter task title..."
              autoFocus
              maxLength={100}
            />
            {getFieldError('title') && <span className="field-error">{getFieldError('title')}</span>}
            <span className="char-count">{title.length}/100</span>
          </div>

          <div className={`form-group ${getFieldError('description') ? 'has-error' : ''}`}>
            <label htmlFor="task-description">Description</label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setErrors(errors.filter(err => err.field !== 'description')) }}
              placeholder="Describe the task..."
              rows={3}
              maxLength={1000}
            />
            {getFieldError('description') && <span className="field-error">{getFieldError('description')}</span>}
            <span className="char-count">{description.length}/1000</span>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="task-priority">Priority</label>
              <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="task-assignee">Assignee</label>
              <div className="assignee-field">
                <input
                  id="task-assignee"
                  type="text"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="Assign to..."
                />
                {currentUser && assignee !== currentUser && (
                  <button
                    type="button"
                    className="assign-me-btn"
                    onClick={() => setAssignee(currentUser)}
                    title="Assign to me"
                  >
                    Me
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="task-tags">Tags (comma separated)</label>
            <input
              id="task-tags"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. frontend, bug, ui"
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : parentId ? 'Add Subtask' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
