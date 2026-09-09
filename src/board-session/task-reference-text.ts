export function referenceParts(text: string): string[] {
  return text.split(/(https?:\/\/[^\s<>]+|\b[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,17}\b)/gi)
}
export function referenceKeys(text: string): string[] {
  return [...new Set(referenceParts(text).filter(part => /^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,17}$/i.test(part)).map(key => key.toUpperCase()))]
}
export function taskReferencePath(key: string): string {
  return `/spaces/${encodeURIComponent(key.split('-')[0])}/tasks/${encodeURIComponent(key)}`
}
