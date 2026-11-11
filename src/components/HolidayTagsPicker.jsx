import { useMemo } from 'react';
import { loadHolidays } from '../lib/holidayStore';
import { nextOccurrences, parseIso, toIso } from '../lib/holidayRules';

/* The Holidays field on a contact's pop-up: the holidays to reach out to this
   person on. Each is a chip with its next date; the dropdown adds another from
   the Holidays page's list, soonest first. On the day, the contact shows up in
   a card on Reach Out and a notification goes out (api/holiday-reachout.js). */

const chip = { display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.15rem 0.15rem 0.5rem', background: 'var(--color-accent-light)', color: 'var(--color-accent)', borderRadius: 'var(--radius-full)', fontSize: '0.78rem', fontWeight: 600 };
const chipX = { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.15rem' };

function shortDate(iso) {
  const d = parseIso(iso);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

export function HolidayTagsPicker({ value, onChange, inputClassName }) {
  const tags = Array.isArray(value) ? value : [];
  const options = useMemo(() => {
    const list = loadHolidays();
    const todayIso = toIso(new Date());
    return list
      .filter((h) => h.name)
      .map((h) => ({ id: h.id, name: h.name, next: nextOccurrences(h, todayIso, 1, list)[0]?.start || '' }))
      .sort((a, b) => (a.next || '9999').localeCompare(b.next || '9999') || a.name.localeCompare(b.name));
  }, []);
  const byId = new Map(options.map((o) => [o.id, o]));
  const remaining = options.filter((o) => !tags.includes(o.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
          {tags.map((id) => {
            const h = byId.get(id);
            const label = h ? h.name : 'Removed holiday';
            return (
              <span key={id} style={chip} title={h?.next ? `Next: ${shortDate(h.next)}` : undefined}>
                {label}{h?.next ? <span style={{ fontWeight: 400, opacity: 0.8 }}> · {shortDate(h.next)}</span> : null}
                <button type="button" style={chipX} aria-label={`Remove ${label}`} onClick={() => onChange(tags.filter((t) => t !== id))}>×</button>
              </span>
            );
          })}
        </div>
      )}
      <select
        className={inputClassName}
        value=""
        aria-label="Add a holiday to reach out on"
        onChange={(e) => { if (e.target.value) onChange([...tags, e.target.value]); }}
      >
        <option value="">{tags.length ? '+ Add another holiday…' : '+ Remind me on a holiday…'}</option>
        {remaining.map((o) => (
          <option key={o.id} value={o.id}>{o.name}{o.next ? ` (${shortDate(o.next)})` : ''}</option>
        ))}
      </select>
    </div>
  );
}
