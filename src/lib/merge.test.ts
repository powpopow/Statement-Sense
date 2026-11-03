import { describe, expect, it } from 'vitest'
import { applyChange, live, mergeRows, newerRows, type Stamped } from './merge'

interface Row extends Stamped { id: string; v: string }
const key = (r: Row) => r.id

describe('mergeRows', () => {
  it('keeps rows that exist on only one side', () => {
    const merged = mergeRows<Row>([{ id: 'a', v: '1' }], [{ id: 'b', v: '2' }], key)
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('takes the newer change', () => {
    const merged = mergeRows<Row>([{ id: 'a', v: 'old', updatedAt: 1 }], [{ id: 'a', v: 'new', updatedAt: 2 }], key)
    expect(merged[0].v).toBe('new')
    expect(mergeRows<Row>([{ id: 'a', v: 'mine', updatedAt: 5 }], [{ id: 'a', v: 'theirs', updatedAt: 2 }], key)[0].v).toBe('mine')
  })

  it('keeps this side on a tie, and treats an unstamped row as oldest', () => {
    expect(mergeRows<Row>([{ id: 'a', v: 'mine', updatedAt: 3 }], [{ id: 'a', v: 'theirs', updatedAt: 3 }], key)[0].v).toBe('mine')
    expect(mergeRows<Row>([{ id: 'a', v: 'old' }], [{ id: 'a', v: 'new', updatedAt: 1 }], key)[0].v).toBe('new')
  })

  it('does not bring back a row deleted more recently than the other side edited it', () => {
    const merged = mergeRows<Row>([{ id: 'a', v: '1', deleted: true, updatedAt: 9 }], [{ id: 'a', v: '1', updatedAt: 4 }], key)
    expect(live(merged)).toEqual([])
  })

  it('does not lose a device\'s unsynced rows when the other side is empty', () => {
    expect(mergeRows<Row>([{ id: 'a', v: '1' }, { id: 'b', v: '2' }], [], key)).toHaveLength(2)
  })
})

describe('applyChange', () => {
  const full: Row[] = [{ id: 'a', v: '1', updatedAt: 1 }, { id: 'b', v: '2', updatedAt: 1 }]

  it('leaves unchanged rows alone, stamps edits and new rows, marks removals', () => {
    const out = applyChange(full, [{ id: 'a', v: '1', updatedAt: 1 }, { id: 'b', v: 'edited' }, { id: 'c', v: '3' }], key, 50)
    expect(out.find((r) => r.id === 'a')!.updatedAt).toBe(1)
    expect(out.find((r) => r.id === 'b')).toMatchObject({ v: 'edited', updatedAt: 50 })
    expect(out.find((r) => r.id === 'c')!.updatedAt).toBe(50)

    const removed = applyChange(full, [{ id: 'a', v: '1' }], key, 60)
    expect(removed.find((r) => r.id === 'b')).toMatchObject({ deleted: true, updatedAt: 60 })
    expect(live(removed).map((r) => r.id)).toEqual(['a'])
  })

  it('keeps an existing delete marker as it was', () => {
    const marked: Row[] = [{ id: 'a', v: '1', deleted: true, updatedAt: 7 }]
    expect(applyChange(marked, [], key, 99)[0].updatedAt).toBe(7)
  })
})

describe('newerRows', () => {
  it('sends rows the other side lacks or holds an older copy of, and nothing else', () => {
    const ours: Row[] = [{ id: 'a', v: '1', updatedAt: 5 }, { id: 'b', v: '2', updatedAt: 5 }, { id: 'c', v: '3' }, { id: 'd', v: '4', updatedAt: 1 }]
    const theirs: Row[] = [{ id: 'a', v: '1', updatedAt: 5 }, { id: 'b', v: 'x', updatedAt: 2 }, { id: 'd', v: '4', updatedAt: 9 }]
    expect(newerRows(ours, theirs, key).map((r) => r.id)).toEqual(['b', 'c'])
  })
})
