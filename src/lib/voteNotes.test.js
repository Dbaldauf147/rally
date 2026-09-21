// Notes on a vote, and the merging writes that keep them from being clobbered.
import { describe, it, expect } from 'vitest';
import { noteOf, hasVote, voteUpdate, noteUpdate } from './voteNotes.js';

const DEL = '__deleteField__'; // stands in for Firestore's sentinel

describe('noteOf / hasVote', () => {
  it('reads a note, trimmed, and nothing from an entry without one', () => {
    expect(noteOf({ note: '  driving up after work ' })).toBe('driving up after work');
    expect(noteOf({ vote: 'yes' })).toBe('');
    expect(noteOf(undefined)).toBe('');
  });

  it('counts only a real answer as a vote', () => {
    expect(hasVote({ vote: 'yes' })).toBe(true);
    expect(hasVote({ vote: 'none' })).toBe(false);
    expect(hasVote({ note: 'asked, waiting to hear' })).toBe(false);
    expect(hasVote(undefined)).toBe(false);
  });
});

describe('voteUpdate', () => {
  it('writes a level deeper, so another writer’s note survives', () => {
    expect(voteUpdate('u1', 'yes', 'Mike', { note: 'late' }, DEL)).toEqual({
      'votes.u1.vote': 'yes',
      'votes.u1.name': 'Mike',
    });
  });

  it('keeps the note when the vote is cleared', () => {
    expect(voteUpdate('u1', 'none', 'Mike', { vote: 'no', note: 'works if the game is off' }, DEL))
      .toEqual({ 'votes.u1.vote': DEL });
  });

  it('takes the whole entry when there is no note to keep', () => {
    expect(voteUpdate('u1', 'none', 'Mike', { vote: 'no' }, DEL)).toEqual({ 'votes.u1': DEL });
    expect(voteUpdate('u1', 'none', 'Mike', undefined, DEL)).toEqual({ 'votes.u1': DEL });
  });
});

describe('noteUpdate', () => {
  it('writes the note beside the vote, trimmed, with the name for company', () => {
    expect(noteUpdate('u1', '  driving up after work  ', 'Mike', { vote: 'yes' }, DEL)).toEqual({
      'votes.u1.note': 'driving up after work',
      'votes.u1.name': 'Mike',
    });
  });

  it('can annotate someone who has not answered yet', () => {
    expect(noteUpdate('u1', 'asked, waiting to hear', 'Mike', undefined, DEL)).toEqual({
      'votes.u1.note': 'asked, waiting to hear',
      'votes.u1.name': 'Mike',
    });
  });

  it('keeps the name already on the entry when none is passed', () => {
    expect(noteUpdate('u1', 'hi', '', { vote: 'yes', name: 'Mikey' }, DEL))
      .toMatchObject({ 'votes.u1.name': 'Mikey' });
  });

  it('removes just the note from an entry that still holds a vote', () => {
    expect(noteUpdate('u1', '   ', 'Mike', { vote: 'yes', note: 'old' }, DEL))
      .toEqual({ 'votes.u1.note': DEL });
  });

  it('removes the entry when the note was all that was left', () => {
    expect(noteUpdate('u1', '', 'Mike', { note: 'old' }, DEL)).toEqual({ 'votes.u1': DEL });
  });
});
