export function PlainText({ text }: { text: string }) {
  return <p className="task-description">{text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => /^https?:\/\//.test(part)
    ? <a key={index} href={part} target="_blank" rel="noreferrer noopener">{part}</a> : part)}</p>
}
