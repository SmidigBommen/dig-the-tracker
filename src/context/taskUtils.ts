import type { ValidationError } from '../types/index.ts'

export function formatTaskKey(n: number): string {
  return `DIG-${n}`
}

export function validateTask(task: {
  title?: string
  description?: string
}): ValidationError[] {
  const errors: ValidationError[] = []
  if (!task.title || task.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title is required' })
  } else if (task.title.trim().length < 3) {
    errors.push({ field: 'title', message: 'Title must be at least 3 characters' })
  } else if (task.title.trim().length > 100) {
    errors.push({ field: 'title', message: 'Title must be less than 100 characters' })
  }
  if (task.description && task.description.trim().length > 1000) {
    errors.push({ field: 'description', message: 'Description must be less than 1000 characters' })
  }
  return errors
}

export function validateProfile(profile: { username?: string; email?: string; displayName?: string }): ValidationError[] {
  const errors: ValidationError[] = []
  if (!profile.username || profile.username.trim().length === 0) {
    errors.push({ field: 'username', message: 'Username is required' })
  } else if (profile.username.trim().length < 2) {
    errors.push({ field: 'username', message: 'Username must be at least 2 characters' })
  } else if (profile.username.trim().length > 30) {
    errors.push({ field: 'username', message: 'Username must be less than 30 characters' })
  } else if (!/^[a-zA-Z0-9_.-]+$/.test(profile.username.trim())) {
    errors.push({ field: 'username', message: 'Username can only contain letters, numbers, dots, hyphens, and underscores' })
  }
  if (!profile.email || profile.email.trim().length === 0) {
    errors.push({ field: 'email', message: 'Email is required' })
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) {
    errors.push({ field: 'email', message: 'Please enter a valid email address' })
  }
  if (profile.displayName && profile.displayName.trim().length > 50) {
    errors.push({ field: 'displayName', message: 'Display name must be less than 50 characters' })
  }
  return errors
}

export function validateComment(text: string): ValidationError[] {
  const errors: ValidationError[] = []
  if (!text || text.trim().length === 0) {
    errors.push({ field: 'text', message: 'Comment text is required' })
  } else if (text.trim().length > 500) {
    errors.push({ field: 'text', message: 'Comment must be less than 500 characters' })
  }
  return errors
}
