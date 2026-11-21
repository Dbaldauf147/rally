import { describe, it, expect } from 'vitest';
import {
  SEED_CATEGORIES, CUSTOM_CATEGORY, QUESTIONS_FIELD, normalizeQuestionState, questionGroups, categoryOptions,
  answerFor, setAnswer, answerWrite, venueProgress, groupProgress,
  addQuestion, updateQuestion, removeQuestion, pickerGroups, pickVenueId, newQuestionId,
} from './weddingVenueQuestions';

const empty = () => normalizeQuestionState(null);
const seedIds = SEED_CATEGORIES.flatMap((c) => c.questions.map((q) => q.id));

describe('the seed questions', () => {
  it('are 23 questions in six categories, each with its own id', () => {
    expect(SEED_CATEGORIES.map((c) => c.name)).toEqual([
      'Availability and basics', 'Cost', 'Food and drink', 'Vendors and rules', 'Logistics', 'Gut check',
    ]);
    expect(SEED_CATEGORIES.map((c) => c.questions.length)).toEqual([4, 5, 3, 4, 5, 2]);
    expect(seedIds).toHaveLength(23);
    expect(new Set(seedIds).size).toBe(23);
    expect(new Set(SEED_CATEGORIES.map((c) => c.id)).size).toBe(6);
  });
});

describe('normalizeQuestionState', () => {
  it('reads nothing, or junk, as an empty state', () => {
    for (const raw of [null, undefined, 'x', 7, [], { custom: 'no', answers: [] }]) {
      expect(normalizeQuestionState(raw)).toEqual({ custom: [], answers: {} });
    }
  });

  it('keeps well-formed questions and tidies them', () => {
    const { custom } = normalizeQuestionState({
      custom: [
        { id: 'q-1', text: '  Can we   bring the dog? ', category: 'logistics' },
        { id: 'q-2', text: 'Filed nowhere known', category: 'nope' },
        { id: 'q-1', text: 'A second one with the same id' },
        { id: 'q-3', text: '   ' },
        { id: 'basics-date', text: 'Pretending to be a built-in one' },
        { id: 'Bad Id', text: 'x' },
        null,
      ],
    });
    expect(custom).toEqual([
      { id: 'q-1', text: 'Can we bring the dog?', category: 'logistics' },
      { id: 'q-2', text: 'Filed nowhere known', category: CUSTOM_CATEGORY },
    ]);
  });

  it('keeps answers that say something and drops the ones that do not', () => {
    const { answers } = normalizeQuestionState({
      answers: {
        v1: { 'basics-date': { done: true, notes: ' Open in June \r\n$2k more on Saturdays ' }, 'cost-total': { done: 'yes', notes: '' }, 'cost-minimum': 'no' },
        v2: { 'basics-date': { done: false, notes: '' } },
        v3: 'junk',
      },
    });
    expect(answers).toEqual({ v1: { 'basics-date': { done: true, notes: 'Open in June \n$2k more on Saturdays' } } });
  });
});

describe('questionGroups', () => {
  it('shows the built-in categories alone until you add your own', () => {
    const groups = questionGroups(empty());
    expect(groups.map((g) => g.id)).toEqual(SEED_CATEGORIES.map((c) => c.id));
    expect(groups.every((g) => g.questions.every((q) => q.custom === false))).toBe(true);
  });

  it('files your questions after the built-in ones, or under My questions', () => {
    let s = addQuestion(empty(), 'Is there a generator?', 'logistics', 'q-a');
    s = addQuestion(s, 'Can we bring the dog?', undefined, 'q-b');
    const groups = questionGroups(s);
    const logistics = groups.find((g) => g.id === 'logistics');
    expect(logistics.questions.at(-1)).toEqual({ id: 'q-a', text: 'Is there a generator?', custom: true });
    expect(groups.at(-1)).toEqual({ id: CUSTOM_CATEGORY, name: 'My questions', questions: [{ id: 'q-b', text: 'Can we bring the dog?', custom: true }] });
    expect(categoryOptions()[0].id).toBe(CUSTOM_CATEGORY);
    expect(categoryOptions()).toHaveLength(7);
  });
});

describe('answers', () => {
  it('are kept per venue', () => {
    let s = setAnswer(empty(), 'v1', 'basics-date', { done: true }).state;
    s = setAnswer(s, 'v2', 'basics-date', { notes: 'Booked that day' }).state;
    expect(answerFor(s, 'v1', 'basics-date')).toEqual({ done: true, notes: '' });
    expect(answerFor(s, 'v2', 'basics-date')).toEqual({ done: true, notes: 'Booked that day' });
    expect(answerFor(s, 'v3', 'basics-date')).toEqual({ done: false, notes: '' });
    expect(answerFor(undefined, 'v1', 'x')).toEqual({ done: false, notes: '' });
  });

  it('tick the question with the first words of an answer, and only then', () => {
    const first = setAnswer(empty(), 'v1', 'cost-total', { notes: '$42k all in' });
    expect(first.answer).toEqual({ done: true, notes: '$42k all in' });
    // Unticked by hand, then the note is edited: it stays unticked.
    const unticked = setAnswer(first.state, 'v1', 'cost-total', { done: false });
    expect(unticked.answer).toEqual({ done: false, notes: '$42k all in' });
    expect(setAnswer(unticked.state, 'v1', 'cost-total', { notes: '$44k all in' }).answer.done).toBe(false);
  });

  it('forget an answer that is unticked and empty', () => {
    const ticked = setAnswer(empty(), 'v1', 'cost-total', { done: true }).state;
    const cleared = setAnswer(ticked, 'v1', 'cost-total', { done: false });
    expect(cleared.state.answers).toEqual({});
    // …but the write still says so, so the saved tick is written over.
    expect(answerWrite('v1', 'cost-total', cleared.answer)).toEqual({
      [QUESTIONS_FIELD]: { answers: { v1: { 'cost-total': { done: false, notes: '' } } } },
    });
  });

  it('do not change the state they were made from', () => {
    const before = setAnswer(empty(), 'v1', 'cost-total', { done: true }).state;
    const copy = JSON.parse(JSON.stringify(before));
    setAnswer(before, 'v1', 'cost-overtime', { notes: 'x' });
    expect(before).toEqual(copy);
  });
});

describe('progress', () => {
  it('counts the ticked questions of one venue', () => {
    let s = empty();
    expect(venueProgress(s, 'v1')).toEqual({ answered: 0, total: 23, pct: 0 });
    for (const id of seedIds.slice(0, 12)) s = setAnswer(s, 'v1', id, { done: true }).state;
    s = setAnswer(s, 'v2', seedIds[0], { done: true }).state;
    expect(venueProgress(s, 'v1')).toEqual({ answered: 12, total: 23, pct: 52 });
    expect(venueProgress(s, 'v2')).toMatchObject({ answered: 1, total: 23 });
    expect(groupProgress(s, 'v1', questionGroups(s)[0])).toEqual({ answered: 4, total: 4 });
    expect(groupProgress(s, 'v1', questionGroups(s)[5])).toEqual({ answered: 0, total: 2 });
  });

  it('counts your own questions for every venue, and not answers to deleted ones', () => {
    let s = addQuestion(empty(), 'Can we bring the dog?', undefined, 'q-dog');
    expect(venueProgress(s, 'v1').total).toBe(24);
    expect(venueProgress(s, 'v2').total).toBe(24);
    s = setAnswer(s, 'v1', 'q-dog', { done: true }).state;
    s.answers.v1['q-gone'] = { done: true, notes: '' };
    expect(venueProgress(s, 'v1')).toMatchObject({ answered: 1, total: 24 });
  });
});

describe('your own questions', () => {
  it('are added with a fresh id, and blank ones are not', () => {
    const s = addQuestion(empty(), '  Is there a generator?  ');
    expect(s.custom).toHaveLength(1);
    expect(s.custom[0]).toMatchObject({ text: 'Is there a generator?', category: CUSTOM_CATEGORY });
    expect(s.custom[0].id).toMatch(/^q-[a-z0-9-]+$/);
    expect(addQuestion(s, '   ')).toBe(s);
    expect(newQuestionId()).not.toBe(newQuestionId());
    // What was added survives a save and a load.
    expect(normalizeQuestionState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('are reworded and refiled without losing their answers', () => {
    let s = addQuestion(empty(), 'Generator?', undefined, 'q-gen');
    s = setAnswer(s, 'v1', 'q-gen', { notes: 'Yes, 20kW' }).state;
    s = updateQuestion(s, 'q-gen', { text: 'Is there a backup generator?', category: 'logistics' });
    expect(s.custom).toEqual([{ id: 'q-gen', text: 'Is there a backup generator?', category: 'logistics' }]);
    expect(answerFor(s, 'v1', 'q-gen').notes).toBe('Yes, 20kW');
    // Emptied text keeps the old wording; an unknown id changes nothing.
    expect(updateQuestion(s, 'q-gen', { text: '  ' }).custom[0].text).toBe('Is there a backup generator?');
    expect(updateQuestion(s, 'q-nope', { text: 'x' }).custom).toEqual(s.custom);
  });

  it('are deleted with their answers at every venue', () => {
    let s = addQuestion(empty(), 'Generator?', undefined, 'q-gen');
    s = setAnswer(s, 'v1', 'q-gen', { done: true }).state;
    s = setAnswer(s, 'v1', 'cost-total', { done: true }).state;
    s = setAnswer(s, 'v2', 'q-gen', { notes: 'No' }).state;
    const { state, venueIds } = removeQuestion(s, 'q-gen');
    expect(state.custom).toEqual([]);
    expect(venueIds.sort()).toEqual(['v1', 'v2']);
    expect(state.answers).toEqual({ v1: { 'cost-total': { done: true, notes: '' } } });
  });

  it('cannot delete a built-in question', () => {
    const s = setAnswer(empty(), 'v1', 'cost-total', { done: true }).state;
    expect(removeQuestion(s, 'cost-total')).toEqual({ state: s, venueIds: [] });
  });
});

describe('the venue picker', () => {
  const venues = [
    { id: 'a', name: 'Oheka Castle', status: 'Researching' },
    { id: 'b', name: 'The Foundry', status: 'Tour scheduled' },
    { id: 'c', name: 'bourne Mansion', status: 'Inquired', toVisit: true },
    { id: 'd', name: 'Hidden Barn', status: 'Toured', hidden: true },
    { id: 'e', name: 'Hidden Loft', status: 'Researching', hidden: true },
    { id: 'f', name: '', status: 'Researching' },
  ];

  it('puts the venues being toured first and leaves hidden ones out', () => {
    const groups = pickerGroups(venues, empty());
    expect(groups.map((g) => [g.label, g.venues.map((v) => v.id)])).toEqual([
      ['Touring', ['c', 'b']],
      ['Other venues', ['a']],
    ]);
  });

  it('keeps a hidden venue that already has answers', () => {
    const s = setAnswer(empty(), 'd', 'cost-total', { done: true }).state;
    expect(pickerGroups(venues, s)[1].venues.map((v) => v.id)).toEqual(['d', 'a']);
  });

  it('is one plain group when nothing is being toured, and none with no venues', () => {
    expect(pickerGroups([venues[0]], empty())).toEqual([{ label: 'Venues', venues: [venues[0]] }]);
    expect(pickerGroups(undefined, empty())).toEqual([]);
  });

  it('opens the venue asked for, else the first on the list', () => {
    const groups = pickerGroups(venues, empty());
    expect(pickVenueId(groups, 'a')).toBe('a');
    expect(pickVenueId(groups, 'deleted')).toBe('c');
    expect(pickVenueId(groups, '')).toBe('c');
    expect(pickVenueId([], 'a')).toBe('');
  });
});
