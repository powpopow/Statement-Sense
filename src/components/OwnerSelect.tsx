import { ME } from '../lib/people'

const ADD = '__add__'

/** Pick whose purchase this is, or add someone new without leaving the row. */
export function OwnerSelect({
  value,
  people,
  onChange,
  onAddPerson,
  label,
}: {
  value: string
  people: string[]
  onChange: (name: string) => void
  /** Saves a new name and returns it as stored, or null if it was empty. */
  onAddPerson: (name: string) => string | null
  label: string
}) {
  return (
    <select
      aria-label={label}
      title="Whose spending is this?"
      value={value}
      style={{ fontSize: 13 }}
      onChange={(e) => {
        if (e.target.value !== ADD) return onChange(e.target.value)
        const typed = window.prompt('Who is this for?')
        const added = typed ? onAddPerson(typed) : null
        if (added) onChange(added)
      }}
    >
      {people.map((p) => (
        <option key={p} value={p}>
          {p === ME ? 'For me' : `For ${p}`}
        </option>
      ))}
      <option value={ADD}>+ Add person…</option>
    </select>
  )
}
