/**
 * The archive's contents. Shared by the drawing (annotations), the read head
 * (which plays the annotated records as it passes) and hold-to-listen (every
 * record can be heard; each has its own synthesized voice).
 */
export type VoiceKind =
  | 'surge'
  | 'hull'
  | 'song'
  | 'ice'
  | 'rain'
  | 'swell'
  | 'thunder'
  | 'shrimp'
  | 'icesong'
  | 'chain'
  | 'school'
  | 'still'
  | 'chorus'
  | 'echo'
  | 'answer'

/** Keys of src/audio/narration.json — the narrator's lines. */
export type NarrationKey = keyof typeof import('../audio/narration.json')['lines']

export interface RecordInfo {
  id: string
  note: string
  memory: string
  kind: VoiceKind
  /** The narrator's reading of this record's memory. */
  voice: NarrationKey
}

/** The four records annotated on the drawing, with where they sit along the record (u). */
export const RECORDS = [
  {
    k: 0.18,
    u: 0.66,
    kind: 'surge' as const,
    voice: 'surge' as const,
    note: 'STORM SURGE · NIGHT OF 11 FEB',
    memory: 'The water rose four metres and took the harbour lights with it.',
  },
  {
    k: 0.43,
    u: 0.8,
    kind: 'hull' as const,
    voice: 'hull' as const,
    note: 'HULL HUM · 31 HZ · PASSING',
    memory: 'A ship passed at 03:10. Its engine is still in the water, somewhere.',
  },
  {
    k: 0.57,
    u: 0.59,
    kind: 'song' as const,
    voice: 'song' as const,
    note: 'SONG OF ONE · 52 HZ',
    memory: 'A single voice, singing at a pitch no other whale answers.',
  },
  {
    k: 0.83,
    u: 0.74,
    kind: 'ice' as const,
    voice: 'ice' as const,
    note: 'CALVING ICE · −6 DB',
    memory: 'A glacier let go of ten thousand winters in a single breath.',
  },
]

/** The unannotated records: quieter syllables of the same archive. */
const GENERIC: Omit<RecordInfo, 'id'>[] = [
  { kind: 'swell', voice: 'swell', note: 'SWELL · NO STORM ON RECORD', memory: 'Waves from a storm that never reached land.' },
  { kind: 'rain', voice: 'rain', note: 'RAIN ON OPEN WATER · 41 MIN', memory: 'Rain on the open sea, heard from forty metres down.' },
  { kind: 'thunder', voice: 'thunder', note: 'DISTANT THUNDER · UNLOGGED', memory: 'Thunder, far off. No ship logged the weather.' },
  { kind: 'shrimp', voice: 'shrimp', note: 'REEF · SNAPPING SHRIMP', memory: 'A whole reef crackling at once, like frying light.' },
  { kind: 'icesong', voice: 'icesong', note: 'SEA ICE · COOLING', memory: 'Ice singing to itself as the night cools it.' },
  { kind: 'chain', voice: 'chain', note: 'ANCHOR CHAIN · SEABED', memory: 'A chain dragging on the seabed, link by link.' },
  { kind: 'school', voice: 'school', note: 'SCHOOL TURNING · 40 000', memory: 'Forty thousand fish turning at the same moment.' },
  { kind: 'swell', voice: 'tide', note: 'TIDE · ARRIVING TWICE', memory: 'The tide, arriving twice a day, as promised.' },
]

export const recordId = (i: number) => `TR—${String(i + 1).padStart(2, '0')}`

/** Index of the line an annotated record sits on, for a drawing of N lines. */
export const recordLine = (k: number, N: number) => Math.round(k * (N - 1))

/** The visitor's own record, when they have left an echo: always the newest, outermost line. */
export function echoRecord(i: number, date: string): RecordInfo {
  const d = new Date(date)
  const stamp = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
  return { id: recordId(i), note: `YOUR ECHO · ${stamp}`, memory: 'This one is yours.', kind: 'echo', voice: 'echo-yours' }
}

export function recordFor(i: number, N: number, echoDate?: string | null): RecordInfo {
  if (echoDate && i === N - 1) return echoRecord(i, echoDate)
  const annotated = RECORDS.find((r) => recordLine(r.k, N) === i)
  if (annotated)
    return { id: recordId(i), note: annotated.note, memory: annotated.memory, kind: annotated.kind, voice: annotated.voice }
  const g = GENERIC[(i * 7 + 3) % GENERIC.length]
  return { id: recordId(i), ...g }
}

export const STILL_POINT: Record<'surface' | 'deep', RecordInfo> = {
  surface: {
    id: 'HYDROPHONE 00',
    note: 'LOWERED AT THE STILL POINT',
    memory: 'Here the tide turns, but nothing moves.',
    kind: 'still',
    voice: 'still',
  },
  deep: {
    id: 'TR—01 — TR—30',
    note: 'ALL RECORDS, AT ONCE',
    memory: 'Every trace, sounding together.',
    kind: 'chorus',
    voice: 'chorus',
  },
}

/** Where the chapter-02 read head is along the records (same 0..1 as RECORDS[].u). */
export const readHeadU = (read: number) => (0.13 + 0.88 * read) / 1.14
