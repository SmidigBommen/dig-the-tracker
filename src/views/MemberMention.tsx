import { useId, useState } from 'react'
import type { BoardMemberView } from '../../api/contracts/board.ts'

export function MemberMention({ member, current }: {
  member: Pick<BoardMemberView, 'id' | 'displayName'>; current?: BoardMemberView
}) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  return <span className="member-mention">
    <a href={`#${id}`} aria-expanded={expanded} aria-controls={id}
      onClick={(event) => { event.preventDefault(); setExpanded(!expanded) }}>@{member.displayName}</a>
    <span id={id} role="region" aria-label={member.displayName} hidden={!expanded}>
      {current ? current.role === 'space-administrator' ? 'Space administrator' : 'Member of this Space' : 'Former Member'}
    </span>
  </span>
}
