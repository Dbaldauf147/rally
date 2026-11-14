import { useState } from 'react';
import { format } from 'date-fns';
import { DEFAULT_REMINDER_INTERVALS, remindableMembers, hasMissingAnswers } from '../lib/autoReminders';
import { DEFAULT_EVENT_REMINDER_DAYS, eventReminderRecipients, reminderDays } from '../lib/eventReminders';
import {
  DEFAULT_RSVP_REMINDER_INTERVALS, rsvpIntervals, rsvpReminderRecipients, rsvpReminderSchedule, parseDayList,
} from '../lib/rsvpReminders';

const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
const dayList = (days) => (days.length <= 1 ? days.join('') : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`);

// One reminder kind: what it does, an on/off switch, and the days it runs on.
function Row({ testid, title, desc, on, onToggle, days, daysLabel, onDays, detail }) {
  const [text, setText] = useState(days.join(', '));
  const [bad, setBad] = useState(false);
  function commit() {
    const next = parseDayList(text);
    if (next.length === 0) { setBad(true); return; }
    setBad(false);
    setText(next.join(', '));
    if (next.join() !== days.join()) onDays(next);
  }
  return (
    <div data-testid={testid} style={{ padding: '0.85rem 1rem', border: `1px solid ${on ? '#6366F1' : 'var(--color-border)'}`, background: on ? '#EEF2FF' : 'var(--color-surface)', borderRadius: 'var(--radius-md)', marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)' }}>{title}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.15rem', lineHeight: 1.4 }}>{desc}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={title}
          onClick={onToggle}
          style={{
            flexShrink: 0, padding: '0.35rem 0.9rem', border: 'none', borderRadius: '999px', fontFamily: 'inherit',
            fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', color: '#fff', background: on ? '#16A34A' : '#9CA3AF',
          }}
        >{on ? 'On' : 'Off'}</button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem', fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
        {daysLabel[0]}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
          aria-label={`${title}: days`}
          style={{ width: '6.5rem', padding: '0.25rem 0.4rem', border: `1px solid ${bad ? '#DC2626' : 'var(--color-border)'}`, borderRadius: '6px', fontFamily: 'inherit', fontSize: '0.8rem' }}
        />
        {daysLabel[1]}
      </label>
      {bad && <div style={{ fontSize: '0.72rem', color: '#DC2626', marginTop: '0.25rem' }}>Enter days as numbers, like 3, 7.</div>}
      {on && detail && <div style={{ fontSize: '0.76rem', color: '#3730A3', marginTop: '0.45rem', lineHeight: 1.4 }}>{detail}</div>}
    </div>
  );
}

// The header's "Email reminders" popup: every automatic reminder this event
// can send at its current stage, each switched on or off right here.
export function RemindersPopup({ event, eventId, stage, dateOptions, updateEvent, onClose }) {
  const now = new Date();

  // --- While dates are still being voted on: nudge whoever hasn't voted.
  const ar = event.autoReminders || {};
  const arDays = Array.isArray(ar.intervals) && ar.intervals.length ? ar.intervals : DEFAULT_REMINDER_INTERVALS;
  const nonVoters = remindableMembers(event).filter(([uid, m]) => m.role !== 'owner' && hasMissingAnswers(uid, dateOptions)).length;

  // --- Once the date is set: nudge whoever hasn't said if they're coming…
  const rr = event.rsvpReminders || {};
  const rrDays = rsvpIntervals(rr.intervals ? rr : { intervals: DEFAULT_RSVP_REMINDER_INTERVALS });
  const noAnswer = rsvpReminderRecipients(event, dateOptions).length;
  const upcoming = rsvpReminderSchedule({ ...rr, intervals: rrDays }, now).filter((s) => !s.past);

  // …and remind the ones who are coming that it's nearly here.
  const er = event.eventReminders || {};
  const erDays = reminderDays(Array.isArray(er.daysBefore) ? er : { daysBefore: DEFAULT_EVENT_REMINDER_DAYS });
  const coming = eventReminderRecipients(event, dateOptions).length;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Email reminders"
        data-testid="reminders-popup"
        style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', maxWidth: '480px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>📧 Email reminders</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.4rem', lineHeight: 1, color: 'var(--color-text-muted)', cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0 0 0.9rem', lineHeight: 1.45 }}>
          Sent automatically each morning to guests with an email address. People stop getting them as soon as they answer.
        </p>

        {stage === 'finalized' ? (
          <>
            <Row
              testid="reminders-rsvp"
              title="People who haven’t responded"
              desc={`Asks guests who haven’t said whether they’re coming. Right now that’s ${people(noAnswer)}.`}
              on={!!rr.enabled}
              onToggle={() => updateEvent(eventId, {
                rsvpReminders: rr.enabled
                  ? { enabled: false, intervals: rrDays, startedAt: rr.startedAt || '' }
                  // Switching on starts the clock afresh, so nobody gets a
                  // reminder the same morning off an old start date.
                  : { enabled: true, intervals: rrDays, startedAt: new Date().toISOString() },
              })}
              days={rrDays}
              daysLabel={['Send', 'days after switching on']}
              onDays={(next) => updateEvent(eventId, { rsvpReminders: { enabled: !!rr.enabled, intervals: next, startedAt: rr.startedAt || '' } })}
              detail={upcoming.length
                ? `Next: ${upcoming.map((s) => format(s.at, 'EEE, MMM d')).join(', then ')}. Nothing is sent after the event.`
                : 'Every reminder on this schedule has gone out. Switch off and on again to start over.'}
            />
            <Row
              testid="reminders-event"
              title="People who are coming"
              desc={`A heads-up before the event to the yeses and maybes. Right now that’s ${people(coming)}.`}
              on={!!er.enabled}
              onToggle={() => updateEvent(eventId, { eventReminders: { enabled: !er.enabled, daysBefore: erDays } })}
              days={[...erDays].sort((a, b) => a - b)}
              daysLabel={['Send', 'days before the event']}
              onDays={(next) => updateEvent(eventId, { eventReminders: { enabled: !!er.enabled, daysBefore: next } })}
              detail={`Goes out ${dayList([...erDays].sort((a, b) => b - a))} ${erDays.length === 1 && erDays[0] === 1 ? 'day' : 'days'} before.`}
            />
          </>
        ) : (
          <Row
            testid="reminders-vote"
            title="People who haven’t voted"
            desc={`Asks guests with a date still unanswered on the poll. Right now that’s ${people(nonVoters)}.`}
            on={!!ar.enabled}
            onToggle={() => updateEvent(eventId, {
              autoReminders: ar.enabled
                ? { enabled: false, intervals: arDays, startedAt: ar.startedAt || '' }
                : { enabled: true, intervals: arDays, startedAt: new Date().toISOString() },
            })}
            days={arDays}
            daysLabel={['Send', 'days after switching on']}
            onDays={(next) => updateEvent(eventId, { autoReminders: { enabled: !!ar.enabled, intervals: next, startedAt: ar.startedAt || '' } })}
            detail="Once the date is set, these stop — come back here to remind people who haven’t responded."
          />
        )}

        <button type="button" onClick={onClose} style={{ width: '100%', padding: '0.55rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}>Done</button>
      </div>
    </div>
  );
}
