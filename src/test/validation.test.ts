import { describe, it, expect } from 'vitest'
import { validateTask, validateComment } from '../context/TaskContext.tsx'

describe('validateTask', () => {
  it('returns error when title is empty', () => {
    const errors = validateTask({ title: '', description: '' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual({ field: 'title', message: 'Title is required' })
  })

  it('returns error when title is undefined', () => {
    const errors = validateTask({ description: '' })
    expect(errors).toHaveLength(1)
    expect(errors[0].field).toBe('title')
  })

  it('returns error when title is whitespace only', () => {
    const errors = validateTask({ title: '   ', description: '' })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('Title is required')
  })

  it('returns error when title is too short', () => {
    const errors = validateTask({ title: 'ab', description: '' })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('Title must be at least 3 characters')
  })

  it('returns error when title is too long', () => {
    const errors = validateTask({ title: 'a'.repeat(101), description: '' })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('Title must be less than 100 characters')
  })

  it('returns error when description is too long', () => {
    const errors = validateTask({ title: 'Valid title', description: 'a'.repeat(1001) })
    expect(errors).toHaveLength(1)
    expect(errors[0].field).toBe('description')
    expect(errors[0].message).toBe('Description must be less than 1000 characters')
  })

  it('returns no errors for valid task', () => {
    const errors = validateTask({ title: 'Valid task title', description: 'A description' })
    expect(errors).toHaveLength(0)
  })

  it('allows empty description', () => {
    const errors = validateTask({ title: 'Valid task', description: '' })
    expect(errors).toHaveLength(0)
  })

  it('allows title at exactly 3 characters', () => {
    const errors = validateTask({ title: 'abc', description: '' })
    expect(errors).toHaveLength(0)
  })

  it('allows title at exactly 100 characters', () => {
    const errors = validateTask({ title: 'a'.repeat(100), description: '' })
    expect(errors).toHaveLength(0)
  })
})

describe('validateComment', () => {
  it('returns error when text is empty', () => {
    const errors = validateComment('')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual({ field: 'text', message: 'Comment text is required' })
  })

  it('returns error when text is whitespace only', () => {
    const errors = validateComment('   ')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('Comment text is required')
  })

  it('returns error when text is too long', () => {
    const errors = validateComment('a'.repeat(501))
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('Comment must be less than 500 characters')
  })

  it('returns no errors for valid comment', () => {
    const errors = validateComment('This is a valid comment')
    expect(errors).toHaveLength(0)
  })

  it('allows comment at exactly 500 characters', () => {
    const errors = validateComment('a'.repeat(500))
    expect(errors).toHaveLength(0)
  })
})
