/* The "should we invite them?" decision tree on the wedding Guest List's
   Invite Decision subtab.

   Pure data and pure functions, so the branching can be tested without a
   page. It only ever answers a question — it never reads or writes a guest.

   Two branches leave the first question: the "we want them there" side
   (q1 → q2 → q3) and the "do we only feel we should" side (q1 → q4 → q5).
   No path is longer than three questions. */

export const START = 'q1';

export const QUESTIONS = {
  q1: {
    text: 'Would we genuinely want this person celebrating our wedding with us?',
    yes: 'q2',
    no: 'q4',
  },
  q2: {
    text: 'Have they been a meaningful part of our lives in the past year?',
    yes: 'invite',
    no: 'q3',
  },
  q3: {
    text: 'Are they someone with whom we have a meaningful history or an important relationship that we want to maintain?',
    yes: 'invite',
    no: 'discuss',
  },
  q4: {
    text: 'Are we considering inviting them primarily because we feel obligated?',
    yes: 'skip',
    no: 'q5',
  },
  q5: {
    text: 'Would we genuinely miss having them there on our wedding day?',
    yes: 'discuss',
    no: 'skip',
  },
};

/* The three ends. `note` is the short line on the branch that led there:
   q3's NO is a "maybe", q5's YES a "reconsider" — both land on Discuss. */
export const OUTCOMES = {
  invite: {
    title: 'Invite them',
    message: 'You genuinely want them there. Make room for the people who make your life special.',
  },
  skip: {
    title: "Don't invite them",
    message: "Your wedding is about celebrating with the people who matter most. You don't need to invite someone out of obligation.",
  },
  discuss: {
    title: 'Discuss together',
    message: 'This one deserves a conversation with your partner before making a final decision.',
  },
};

export const isQuestion = (id) => Object.prototype.hasOwnProperty.call(QUESTIONS, id);
export const isOutcome = (id) => Object.prototype.hasOwnProperty.call(OUTCOMES, id);

/* Where a list of answers (true = YES) leads, and the questions it passed
   through. Answers past an outcome are ignored. */
export function walk(answers) {
  let node = START;
  const steps = [];
  for (const yes of answers) {
    if (!isQuestion(node)) break;
    const next = yes ? QUESTIONS[node].yes : QUESTIONS[node].no;
    steps.push({ id: node, yes: !!yes });
    node = next;
  }
  return { node, steps };
}

/* The most questions still to come from here, counting this one. An outcome
   has none left. */
export function remainingDepth(id) {
  if (!isQuestion(id)) return 0;
  const q = QUESTIONS[id];
  return 1 + Math.max(remainingDepth(q.yes), remainingDepth(q.no));
}

/* How far along you are, 0 → 1. Answered over answered-plus-the-most-still-
   to-come, so the bar never runs backward on a YES/NO and reads full only
   at an outcome. */
export function progress(answers) {
  const { node, steps } = walk(answers);
  const left = remainingDepth(node);
  const total = steps.length + left;
  return total ? steps.length / total : 0;
}

/* The question's number on this path ("Question 2"), counting from 1. */
export const questionNumber = (answers) => walk(answers).steps.length + 1;
