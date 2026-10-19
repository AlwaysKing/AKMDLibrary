import { PersonalNoteNode } from '../api/personal';

export interface FlatPersonalNote {
  note: PersonalNoteNode;
  depth: number;
}

export function flattenPersonalNotes(notes: PersonalNoteNode[], depth = 0): FlatPersonalNote[] {
  return notes.flatMap((note) => [
    { note, depth },
    ...flattenPersonalNotes(note.children || [], depth + 1),
  ]);
}

export function countPersonalNotes(notes: PersonalNoteNode[]): number {
  return notes.reduce((total, note) => total + 1 + countPersonalNotes(note.children || []), 0);
}
