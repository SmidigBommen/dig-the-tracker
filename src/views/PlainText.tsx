import type { ReactNode } from 'react'
import type { TaskReference } from '../../api/contracts/board.ts'
import type { BoardSession } from '../board-session/board-session.ts'
import { referenceParts,taskReferencePath } from '../board-session/task-reference-text.ts'

type Props = { text: string; references?: TaskReference[]; session?: BoardSession }
function linkedParts({ text,references = [],session }: Props): ReactNode[] {
  return referenceParts(text).map((part,index) => {
    if (/^https?:\/\//i.test(part)) return <a key={index} href={part} target="_blank" rel="noreferrer noopener">{part}</a>
    const reference = references.find(item => item.key === part.toUpperCase())
    const anotherSpace = reference && session?.getSnapshot().overview.space.key !== reference.spaceKey
    return reference ? <a key={index} href={taskReferencePath(reference.key)} target={anotherSpace ? '_blank' : undefined} rel={anotherSpace ? 'noreferrer noopener' : undefined} onClick={event => {
      if (session && session.getSnapshot().overview.space.key === reference.spaceKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
        event.preventDefault();void session.openEditor({ kind: 'id',taskId: reference.id })
      }
    }}>{part}</a> : part
  })
}
export function PlainText(props: Props) { return <p className="task-description">{linkedParts(props)}</p> }
export function DescriptionLinks(props: Props) {
  const links = linkedParts(props).filter(part => typeof part !== 'string')
  return links.length > 0 && <div className="description-links" aria-label="Description links">{links}</div>
}
