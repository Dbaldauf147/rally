// What the weekly wedding email is about: the checklist.
//
// The digest used to report the guest list — how many households you could
// post an invitation to — which is one column of a much longer job. The
// checklist is the job, so it is the email; the guest-list numbers stay on as
// a footnote rather than the headline.
//
// The checklist itself lives in src/lib/weddingChecklist.js, shared with the
// page so the email can never disagree with the screen about what is ticked.
// Only two things are needed on top of it and neither belongs on the page: a
// summary shaped for rendering, and what moved since the last email.
//
// Pure: no Firestore, no DOM, no network. Lives outside api/ so Vercel doesn't
// route it as a function.

import {
  normalizeChecklist, allTasks, isDone, taskKey, phaseProgress,
} from '../src/lib/weddingChecklist.js';

/* The checklist shaped for an email.

   Phases keep their order — the list is a timeline and reordering it by how
   much is left would destroy the only thing it is telling you. Each phase
   carries its own progress so a finished one can be collapsed to a single line
   instead of printing eight struck-through tasks nobody is going to read.

   `next` is the earliest outstanding task anywhere, which is almost always the
   real answer to "where were we". */
export function checklistSummary(raw) {
  const { phases, done } = normalizeChecklist(raw);
  const sections = phases.map((phase) => {
    const progress = phaseProgress(phase, done);
    return {
      id: phase.id,
      title: phase.title,
      when: phase.when,
      ...progress,
      tasks: phase.tasks.map((t) => ({
        ...t,
        key: taskKey(phase.id, t.id),
        done: isDone(done, taskKey(phase.id, t.id)),
      })),
    };
  });

  const tasks = allTasks(phases);
  const total = tasks.length;
  // Counted off the tasks rather than off the keys in `done`, so a tick left
  // over from a deleted task can't push the count past the total.
  const complete = tasks.filter((t) => isDone(done, t.key)).length;
  const outstanding = tasks.filter((t) => !isDone(done, t.key));

  return {
    sections,
    total,
    complete,
    pct: total ? Math.round((complete / total) * 100) : 0,
    next: outstanding[0] ? { ...outstanding[0], phaseTitle: titleOf(phases, outstanding[0].phaseId) } : null,
    // The milestones — venue, invitations, licence — are what everything else
    // hangs off, so the email names the ones still outstanding by themselves.
    milestonesLeft: outstanding
      .filter((t) => t.milestone)
      .map((t) => ({ ...t, phaseTitle: titleOf(phases, t.phaseId) })),
    finished: total > 0 && complete === total,
  };
}

const titleOf = (phases, phaseId) => phases.find((p) => p.id === phaseId)?.title || '';

/* What to persist between sends.

   The ticked keys themselves, not just how many: a week where one task was
   ticked and another unticked nets to zero, and "no change" would be a lie.
   It is a few hundred bytes of short slugs, which is worth being able to say
   what actually got done. */
export function checklistSnapshot(raw) {
  const { phases, done } = normalizeChecklist(raw);
  return {
    total: allTasks(phases).length,
    done: allTasks(phases).filter((t) => isDone(done, t.key)).map((t) => t.key).sort(),
  };
}

/* What moved since the last email.

   Null on the first run — there is nothing to compare against, and inventing a
   week of progress would be worse than saying so. `ticked` names what got
   done, in timeline order; `unticked` counts what came back off, which happens
   when something is marked done early and then reopened.

   A task deleted since the last email is not "unticked" — it is gone — so only
   keys that still exist are compared. */
export function checklistDelta(raw, previous) {
  if (!previous || typeof previous !== 'object' || !Array.isArray(previous.done)) return null;
  const { phases, done } = normalizeChecklist(raw);
  const before = new Set(previous.done);
  const tasks = allTasks(phases);

  const ticked = tasks
    .filter((t) => isDone(done, t.key) && !before.has(t.key))
    .map((t) => ({ ...t, phaseTitle: titleOf(phases, t.phaseId) }));
  const unticked = tasks.filter((t) => !isDone(done, t.key) && before.has(t.key));

  return {
    ticked,
    unticked: unticked.length,
    added: Math.max(0, tasks.length - Number(previous.total || 0)),
    any: ticked.length > 0 || unticked.length > 0,
  };
}
