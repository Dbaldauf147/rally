import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, deleteField, addDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';
import styles from './FriendsPage.module.css';

// Field detectors mirroring handleFileSelect's logic, exposed here so the
// paste-from-clipboard flow auto-maps the same way an uploaded file does.
const PASTE_FIELD_DETECTORS = [
  { key: 'name', match: k => (k.includes('name') && !k.includes('last') && !k.includes('group') && !k.includes('work') && !k.includes('business')) || k === 'full name' },
  { key: 'firstName', match: k => k.includes('first') },
  { key: 'lastName', match: k => k.includes('last') && k.includes('name') },
  { key: 'email', match: k => (k.includes('email') || k.includes('e-mail')) && !k.includes('work') && !k.includes('business') && !k.includes('office') },
  { key: 'workEmail', match: k => (k.includes('work') && (k.includes('email') || k.includes('e-mail'))) || k.includes('business email') || k.includes('office email') },
  { key: 'phone', match: k => k.includes('phone') || k.includes('mobile') || k.includes('cell') },
  { key: 'address', match: k => k === 'address' || k.includes('street') || k.includes('mailing') || k.includes('home address') },
  { key: 'group', match: k => k === 'group' || k === 'category' },
  { key: 'guest', match: k => k === 'guest' || k.includes('plus one') || k.includes('+1') || k.includes('partner') || k.includes('spouse') },
  { key: 'tag', match: k => k === 'tag' || k === 'tags' || k === 'label' || k === 'labels' },
  { key: 'instagram', match: k => k === 'instagram' || k === 'ig' || k.includes('insta') },
];

function autoDetectMapping(headers) {
  const mapping = {};
  for (const header of headers) {
    const k = header.toLowerCase().trim();
    const matched = PASTE_FIELD_DETECTORS.find(f => f.match(k));
    mapping[header] = matched ? matched.key : '';
  }
  return mapping;
}

// Splits one CSV line, honoring "" quoted fields (which can contain commas).
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Turns pasted spreadsheet content into header + row objects. Auto-detects
// the column delimiter: tab (Excel/Sheets paste) is preferred, then comma.
function parsePastedTable(text) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const useTab = lines.some(l => l.includes('\t'));
  const splitLine = useTab
    ? (line) => line.split('\t').map(s => s.trim())
    : splitCsvLine;
  const headers = splitLine(lines[0]).map(h => h || '(unnamed)');
  const rows = lines.slice(1).map(line => {
    const cells = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] || ''; });
    return obj;
  });
  return { headers, rows };
}

// Normalize a friend's addresses into an array of { label, value }.
// Supports legacy friends with a single `address` string.
function getFriendAddresses(friend) {
  if (Array.isArray(friend?.addresses) && friend.addresses.length > 0) {
    return friend.addresses.map(a => ({ label: a.label || '', value: a.value || a.address || '' }));
  }
  if (friend?.address) return [{ label: 'Home', value: friend.address }];
  return [];
}

function AddressListEditor({ value, onChange }) {
  const rows = value && value.length > 0 ? value : [{ label: '', value: '' }];
  function update(i, patch) {
    const next = rows.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    onChange(next);
  }
  function add() {
    onChange([...rows, { label: '', value: '' }]);
  }
  function remove(i) {
    const next = rows.filter((_, idx) => idx !== i);
    onChange(next.length > 0 ? next : [{ label: '', value: '' }]);
  }
  return (
    <div className={styles.addressList}>
      {rows.map((row, i) => (
        <div key={i} className={styles.addressRow}>
          <input
            className={styles.addressLabelInput}
            placeholder="Label (Home, Work...)"
            value={row.label}
            onChange={e => update(i, { label: e.target.value })}
            list={`address-label-options-${i}`}
          />
          <datalist id={`address-label-options-${i}`}>
            <option value="Home" />
            <option value="Work" />
            <option value="Cabin" />
            <option value="Vacation" />
            <option value="Parents" />
          </datalist>
          <input
            className={styles.addressValueInput}
            placeholder="123 Main St, City, State ZIP"
            value={row.value}
            onChange={e => update(i, { value: e.target.value })}
          />
          <button
            type="button"
            className={styles.addressRemoveBtn}
            onClick={() => remove(i)}
            title="Remove address"
            aria-label="Remove address"
          >×</button>
        </div>
      ))}
      <button type="button" className={styles.addressAddBtn} onClick={add}>
        + Add another address
      </button>
    </div>
  );
}

function ComesWithPicker({ friends, editFriendId, value, onChange }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  const linked = friends.find(f => f.id === value);

  React.useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const filtered = friends
    .filter(f => f.id !== editFriendId)
    .filter(f => !search.trim() || (f.name || '').toLowerCase().includes(search.toLowerCase()) || (f.phone || '').includes(search));

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
        Comes With (auto +1 on events)
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <input
            type="text"
            value={open ? search : (linked ? linked.name : '')}
            onChange={e => { setSearch(e.target.value); if (!open) setOpen(true); }}
            onFocus={() => { setOpen(true); setSearch(''); }}
            placeholder="Type a name..."
            style={{ flex: 1, padding: '0.5rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', fontFamily: 'inherit' }}
          />
          {value && (
            <button type="button" onClick={() => { onChange(''); setSearch(''); }} style={{ padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-danger)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
          )}
        </div>
      </label>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: '180px', overflowY: 'auto' }}>
          {filtered.slice(0, 20).map(f => (
            <button key={f.id} type="button" onClick={() => { onChange(f.id); setSearch(''); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.45rem 0.65rem', border: 'none', background: f.id === value ? 'var(--color-accent-light)' : 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', fontSize: '0.85rem' }}
              onMouseEnter={e => { if (f.id !== value) e.currentTarget.style.background = 'var(--color-bg)'; }}
              onMouseLeave={e => { if (f.id !== value) e.currentTarget.style.background = 'none'; }}
            >
              <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{f.name}</span>
              {f.phone && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{f.phone}</span>}
            </button>
          ))}
          {filtered.length === 0 && <div style={{ padding: '0.5rem', fontSize: '0.82rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>No matches</div>}
        </div>
      )}
    </div>
  );
}

// Table view: pick one of your events, then RSVP each contact for it in a
// single column. Renders inside the Friends & Contacts page on the "Event
// Roster" sub-tab.
function RosterTable({
  friends, events, rosterEventId, setRosterEventId,
  rosterEvent, rosterSearch, setRosterSearch,
  setRosterRsvp, removeFromRoster, sanitizeKey, onNewEvent,
}) {
  const members = (rosterEvent && rosterEvent.members && typeof rosterEvent.members === 'object')
    ? rosterEvent.members
    : {};

  const sortedFriends = [...friends].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
  );
  const q = rosterSearch.trim().toLowerCase();
  const visibleFriends = q
    ? sortedFriends.filter(f =>
        (f.name || '').toLowerCase().includes(q) ||
        (f.email || '').toLowerCase().includes(q)
      )
    : sortedFriends;

  const rsvpOptions = [
    { key: 'yes', label: 'Going', bg: 'var(--color-success-light)', color: 'var(--color-success)' },
    { key: 'maybe', label: 'Maybe', bg: 'var(--color-warning-light)', color: 'var(--color-warning)' },
    { key: 'no', label: 'No', bg: 'var(--color-danger-light)', color: 'var(--color-danger)' },
  ];

  const totals = { yes: 0, maybe: 0, no: 0, pending: 0 };
  for (const m of Object.values(members)) {
    if (!m || typeof m !== 'object') continue;
    const r = ['yes', 'maybe', 'no'].includes(m.rsvp) ? m.rsvp : 'pending';
    totals[r] = (totals[r] || 0) + 1;
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
          Event
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'stretch' }}>
            <select
              value={rosterEventId}
              onChange={e => setRosterEventId(e.target.value)}
              style={{ padding: '0.5rem 0.65rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', fontFamily: 'inherit', minWidth: '260px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="">— Pick an event —</option>
              {events.map(evt => {
                const d = evt.date?.toDate ? evt.date.toDate() : (evt.date ? new Date(evt.date) : null);
                const dateStr = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                return (
                  <option key={evt.id} value={evt.id}>
                    {evt.title}{dateStr ? ` · ${dateStr}` : ''}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={onNewEvent}
              style={{ padding: '0 0.85rem', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: '#fff', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}
              title="Create a new event and open its roster"
            >+ Event</button>
          </div>
        </label>
        {rosterEventId && (
          <input
            type="text"
            value={rosterSearch}
            onChange={e => setRosterSearch(e.target.value)}
            placeholder="Search contacts…"
            style={{ flex: 1, minWidth: '200px', padding: '0.55rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', fontFamily: 'inherit', alignSelf: 'flex-end' }}
          />
        )}
      </div>

      {!rosterEventId ? (
        <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-lg)', color: 'var(--color-text-muted)' }}>
          {events.length === 0
            ? 'No events found. Create one from the Dashboard first.'
            : 'Pick an event above to start building its roster.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem', fontSize: '0.78rem' }}>
            <span style={{ padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', background: 'var(--color-success-light)', color: 'var(--color-success)', fontWeight: 600 }}>Going {totals.yes}</span>
            <span style={{ padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', background: 'var(--color-warning-light)', color: 'var(--color-warning)', fontWeight: 600 }}>Maybe {totals.maybe}</span>
            <span style={{ padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', background: 'var(--color-danger-light)', color: 'var(--color-danger)', fontWeight: 600 }}>No {totals.no}</span>
            {totals.pending > 0 && (
              <span style={{ padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', background: 'var(--color-surface-alt)', color: 'var(--color-text-muted)', fontWeight: 600 }}>Pending {totals.pending}</span>
            )}
          </div>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--color-surface)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) minmax(180px, 1.8fr) minmax(260px, auto)', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-muted)', background: 'var(--color-surface-alt)', padding: '0.55rem 0.85rem', borderBottom: '1px solid var(--color-border)' }}>
              <div>Contact</div>
              <div>Email</div>
              <div>Status</div>
            </div>
            {visibleFriends.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                {friends.length === 0 ? 'No contacts yet — add some on the Contacts tab.' : 'No matches.'}
              </div>
            ) : (
              visibleFriends.map(f => {
                const key = sanitizeKey(f.email || f.id);
                const member = members[key];
                const isMember = !!member;
                const currentRsvp = isMember && ['yes', 'maybe', 'no'].includes(member.rsvp) ? member.rsvp : (isMember ? 'pending' : null);
                return (
                  <div
                    key={f.id}
                    style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) minmax(180px, 1.8fr) minmax(260px, auto)', alignItems: 'center', padding: '0.55rem 0.85rem', borderBottom: '1px solid var(--color-border)', fontSize: '0.85rem', background: isMember ? 'var(--color-accent-light)' : 'transparent' }}
                  >
                    <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                      {f.name || '(unnamed)'}
                      {isMember && currentRsvp === 'pending' && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>· no reply</span>
                      )}
                    </div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.email || ''}>
                      {f.email || <span style={{ fontStyle: 'italic' }}>no email</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      {rsvpOptions.map(opt => {
                        const active = currentRsvp === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setRosterRsvp(f, opt.key)}
                            style={{
                              padding: '0.25rem 0.65rem',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              fontFamily: 'inherit',
                              borderRadius: 'var(--radius-full)',
                              cursor: 'pointer',
                              background: active ? opt.bg : 'var(--color-surface)',
                              color: active ? opt.color : 'var(--color-text-secondary)',
                              border: active ? `1px solid ${opt.color}` : '1px solid var(--color-border)',
                            }}
                            title={isMember ? `Set RSVP to ${opt.label}` : `Add ${f.name || 'contact'} as ${opt.label}`}
                          >{opt.label}</button>
                        );
                      })}
                      {isMember && (
                        <button
                          type="button"
                          onClick={() => removeFromRoster(f)}
                          title="Remove from event"
                          aria-label="Remove from event"
                          style={{
                            marginLeft: '0.15rem',
                            padding: '0.2rem 0.45rem',
                            fontSize: '0.85rem',
                            lineHeight: 1,
                            fontFamily: 'inherit',
                            borderRadius: 'var(--radius-md)',
                            background: 'transparent',
                            color: 'var(--color-text-muted)',
                            border: '1px solid var(--color-border)',
                            cursor: 'pointer',
                          }}
                        >×</button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Drag-and-drop tier board: sort contacts into A/B/C priority tiers (plus an
// Unassigned column). Lives on the "Tiers" sub-tab. The tier is stored as a
// `tier` field on each friend doc.
const TIER_COLUMNS = [
  { key: 'A', title: 'A-tier', desc: 'Inner circle — the people you’d call at 2am.', accent: '#16a34a', bg: '#f0fdf4' },
  { key: 'B', title: 'B-tier', desc: 'Genuine friends you make plans with on purpose.', accent: '#2563eb', bg: '#eff6ff' },
  { key: 'C', title: 'C-tier', desc: 'Friendly connections — warm, but context-dependent.', accent: '#d97706', bg: '#fffbeb' },
  { key: 'D', title: 'D-tier', desc: 'Acquaintances — you know them, but aren’t really friends.', accent: '#9333ea', bg: '#faf5ff' },
  { key: '', title: 'Unassigned', desc: 'Drag contacts into a tier', accent: 'var(--color-text-muted)', bg: 'var(--color-surface-alt)' },
];

// Full descriptions + sorting tests, shown in an expandable guide on the board.
const TIER_GUIDE = [
  { key: 'A', title: 'A-tier: your inner circle', accent: '#16a34a', body: 'These are the people you’d call at 2am, who know the unpolished version of your life, and who show up when it costs them something. The relationship is reciprocal — they check on you as much as you check on them — and you can be fully yourself without managing an image. Most people have somewhere between two and five of these, and that’s normal. This tier is defined by trust and effort, not history.' },
  { key: 'B', title: 'B-tier: genuine friends', accent: '#2563eb', body: 'You enjoy them, you trust them with real things (just not everything), and you make plans on purpose rather than only crossing paths. The friendship survives gaps — you can not talk for two months and pick right back up. Many of these are “context-plus” friendships: they started at work or through a hobby, but they’ve outgrown the original context.' },
  { key: 'C', title: 'C-tier: friendly connections', accent: '#d97706', body: 'Coworkers you like, gym acquaintances, friends-of-friends, people you’re warm with but wouldn’t seek out one-on-one. The relationship mostly depends on shared context, and if that context disappeared, it would probably fade. That’s not a flaw — these people add real texture and community to life.' },
  { key: 'D', title: 'D-tier: acquaintances', accent: '#9333ea', body: 'People you know by name and are cordial with — a neighbor you wave to, someone you’ve met a handful of times — but with no real relationship or shared history yet. Pleasant and low-stakes; easy to lose track of, and that’s fine.' },
];
const TIER_TESTS = [
  { name: 'The crisis test', q: 'If something bad happened, would you tell them? Would they drop something to help?' },
  { name: 'The effort test', q: 'Who initiates? If you stopped reaching out entirely, would the friendship survive?' },
  { name: 'The energy test', q: 'Do you feel better or drained after seeing them?' },
  { name: 'The honesty test', q: 'Can you disagree with them, or say no to them, without fearing the relationship?' },
];

function TierBoard({ friends, onSetTier }) {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [search, setSearch] = useState('');
  const [fGroup, setFGroup] = useState([]);
  const [fTag, setFTag] = useState([]);
  const [fGuest, setFGuest] = useState([]);

  const tierGroupTokens = (v) => (v || '').split(',').map(g => g.trim()).filter(Boolean);
  const allGroups = [...new Set(friends.flatMap(f => tierGroupTokens(f.group)))].sort();
  const allTags = [...new Set(friends.flatMap(f => (f.tag || '').split(';').map(t => t.trim()).filter(Boolean)))].sort();
  const allGuests = [...new Set(friends.map(f => f.guest).filter(Boolean))].sort();
  const toggle = (setter, val) => setter(prev => (prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]));

  const q = search.trim().toLowerCase();
  const byTier = { A: [], B: [], C: [], D: [], '': [] };
  for (const f of friends) {
    if (q && !(f.name || '').toLowerCase().includes(q)) continue;
    if (fGroup.length > 0 && !tierGroupTokens(f.group).some(g => fGroup.includes(g))) continue;
    if (fTag.length > 0) {
      const tags = (f.tag || '').split(';').map(t => t.trim());
      if (!fTag.some(t => tags.includes(t))) continue;
    }
    if (fGuest.length > 0 && !fGuest.includes(f.guest)) continue;
    const t = ['A', 'B', 'C', 'D'].includes(f.tier) ? f.tier : '';
    byTier[t].push(f);
  }
  for (const k of Object.keys(byTier)) {
    byTier[k].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  }

  const drop = (colKey) => {
    if (dragId != null) onSetTier(dragId, colKey);
    setDragId(null);
    setOverCol(null);
  };

  return (
    <div>
      <details style={{ marginBottom: '0.85rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)', overflow: 'hidden' }}>
        <summary style={{ cursor: 'pointer', padding: '0.7rem 0.9rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text)', userSelect: 'none' }}>
          How to sort people into tiers
        </summary>
        <div style={{ padding: '0 0.9rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {TIER_GUIDE.map(g => (
            <div key={g.key}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: g.accent, marginBottom: '0.15rem' }}>{g.title}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', lineHeight: 1.45 }}>{g.body}</div>
            </div>
          ))}
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text)', marginBottom: '0.25rem' }}>A few honest tests to sort people</div>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {TIER_TESTS.map(t => (
                <li key={t.name} style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', lineHeight: 1.45 }}>
                  <strong style={{ color: 'var(--color-text)' }}>{t.name}:</strong> {t.q}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search contacts…"
        style={{ width: '100%', maxWidth: '360px', padding: '0.55rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', fontFamily: 'inherit', marginBottom: '0.6rem' }}
      />
      {(allGroups.length > 0 || allTags.length > 0 || allGuests.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', marginBottom: '0.85rem' }}>
          {allGroups.length > 0 && <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-muted)' }}>Group</span>}
          {allGroups.map(g => (
            <button key={`g-${g}`} type="button" className={fGroup.includes(g) ? styles.groupChipActive : styles.groupChip} onClick={() => toggle(setFGroup, g)}>{g}</button>
          ))}
          {allTags.length > 0 && <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-muted)', marginLeft: allGroups.length > 0 ? '0.35rem' : 0 }}>Tag</span>}
          {allTags.map(t => (
            <button key={`t-${t}`} type="button" className={fTag.includes(t) ? styles.groupChipActive : styles.groupChip} onClick={() => toggle(setFTag, t)}>{t}</button>
          ))}
          {allGuests.length > 0 && <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-muted)', marginLeft: (allGroups.length > 0 || allTags.length > 0) ? '0.35rem' : 0 }}>Guest of</span>}
          {allGuests.map(g => (
            <button key={`gu-${g}`} type="button" className={fGuest.includes(g) ? styles.groupChipActive : styles.groupChip} onClick={() => toggle(setFGuest, g)}>{g}</button>
          ))}
          {(fGroup.length > 0 || fTag.length > 0 || fGuest.length > 0) && (
            <button type="button" onClick={() => { setFGroup([]); setFTag([]); setFGuest([]); }} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>Clear</button>
          )}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', alignItems: 'start' }}>
        {TIER_COLUMNS.map(col => {
          const list = byTier[col.key];
          const isOver = overCol === col.key;
          return (
            <div
              key={col.key || 'none'}
              onDragOver={e => { e.preventDefault(); if (overCol !== col.key) setOverCol(col.key); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(o => (o === col.key ? null : o)); }}
              onDrop={e => { e.preventDefault(); drop(col.key); }}
              style={{
                border: `1px solid ${isOver ? col.accent : 'var(--color-border)'}`,
                boxShadow: isOver ? `0 0 0 2px ${col.accent}33` : 'none',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--color-surface)',
                overflow: 'hidden',
                minHeight: '120px',
              }}
            >
              <div style={{ padding: '0.6rem 0.75rem', background: col.bg, borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: col.accent }}>{col.title}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>{list.length}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.15rem', lineHeight: 1.3 }}>{col.desc}</div>
              </div>
              <div style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', minHeight: '60px' }}>
                {list.map(f => (
                  <div
                    key={f.id}
                    draggable
                    onDragStart={() => setDragId(f.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    title="Drag to another tier"
                    style={{
                      padding: '0.45rem 0.6rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-surface)',
                      cursor: 'grab',
                      opacity: dragId === f.id ? 0.4 : 1,
                      fontSize: '0.85rem',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{f.name || '(unnamed)'}</div>
                    {f.email && <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.email}</div>}
                  </div>
                ))}
                {list.length === 0 && (
                  <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FriendsPage() {
  const { user } = useAuth();
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkPreview, setBulkPreview] = useState([]);
  const [bulkRawRows, setBulkRawRows] = useState([]);
  const [bulkHeaders, setBulkHeaders] = useState([]);
  const [bulkMapping, setBulkMapping] = useState({});
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  // New contact form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [newGuest, setNewGuest] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newAddresses, setNewAddresses] = useState([{ label: '', value: '' }]);
  const [newWorkEmail, setNewWorkEmail] = useState('');
  const [newInstagram, setNewInstagram] = useState('');
  const [editFriend, setEditFriend] = useState(null); // null=closed, object=editing
  const [editFields, setEditFields] = useState({});
  const [giftDraft, setGiftDraft] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'users', user.uid, 'friends'), (snap) => {
      setFriends(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user]);

  // Deep link from elsewhere (e.g. Reach Out's Friend column): /friends?open=<id>
  // opens that contact's editor once, then clears the param.
  const openedFromParamRef = useRef(false);
  useEffect(() => {
    if (openedFromParamRef.current) return;
    const openId = searchParams.get('open');
    if (!openId || friends.length === 0) return;
    const f = friends.find(x => x.id === openId);
    if (f) {
      openEdit(f);
      openedFromParamRef.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends, searchParams]);

  async function addFriend(data) {
    if (!user || !data.name?.trim()) return;
    const id = data.email?.trim().toLowerCase() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cleanedAddresses = (data.addresses || [])
      .map(a => ({ label: (a.label || '').trim(), value: (a.value || '').trim() }))
      .filter(a => a.value);
    await setDoc(doc(db, 'users', user.uid, 'friends', id), {
      name: data.name.trim(),
      email: (data.email || '').trim().toLowerCase(),
      phone: (data.phone || '').trim(),
      group: (data.group || '').trim(),
      guest: (data.guest || '').trim(),
      tag: (data.tag || '').trim(),
      address: cleanedAddresses[0]?.value || (data.address || '').trim(),
      addresses: cleanedAddresses,
      workEmail: (data.workEmail || '').trim().toLowerCase(),
      instagram: (data.instagram || '').trim(),
      createdAt: new Date().toISOString(),
    });
  }

  async function removeFriend(id) {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'friends', id));
  }

  // Drag-and-drop tier assignment on the Tiers sub-tab. '' clears the tier.
  async function setFriendTier(id, tier) {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'friends', id), {
      tier: ['A', 'B', 'C', 'D'].includes(tier) ? tier : deleteField(),
    }).catch(err => console.error('Set tier error:', err));
  }

  function openEdit(friend) {
    const initialAddresses = getFriendAddresses(friend);
    setEditFields({
      name: friend.name || '',
      email: friend.email || '',
      workEmail: friend.workEmail || '',
      phone: friend.phone || '',
      addresses: initialAddresses.length > 0 ? initialAddresses : [{ label: '', value: '' }],
      group: friend.group || '',
      guest: friend.guest || '',
      tag: friend.tag || '',
      instagram: friend.instagram || '',
      linkedTo: friend.linkedTo || '',
      giftIdeas: Array.isArray(friend.giftIdeas) ? friend.giftIdeas : [],
    });
    setGiftDraft('');
    setEditFriend(friend);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!user || !editFriend) return;
    const cleanedAddresses = (editFields.addresses || [])
      .map(a => ({ label: (a.label || '').trim(), value: (a.value || '').trim() }))
      .filter(a => a.value);
    // Fold in a gift idea that was typed but not yet "Added".
    const pendingGift = giftDraft.trim();
    const giftIdeas = [...(editFields.giftIdeas || []), ...(pendingGift ? [pendingGift] : [])];
    const nextFields = {
      ...editFields,
      email: (editFields.email || '').trim().toLowerCase(),
      workEmail: (editFields.workEmail || '').trim().toLowerCase(),
      addresses: cleanedAddresses,
      address: cleanedAddresses[0]?.value || '',
      giftIdeas,
      createdAt: editFriend.createdAt || new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', user.uid, 'friends', editFriend.id), nextFields);

    // Propagate name/email/phone to any event where this person is a member.
    // Match by the PREVIOUS identity (what the event record currently stores) —
    // email, phone digits, or full/first name — so renames still find them.
    try {
      const prevEmail = (editFriend.email || '').toLowerCase();
      const prevDigits = (editFriend.phone || '').replace(/[^\d]/g, '');
      const prevName = (editFriend.name || '').toLowerCase();
      const prevFirst = prevName.split(/\s+/)[0] || '';
      const newName = (nextFields.name || '').trim();
      const newEmail = nextFields.email;
      const newPhone = (nextFields.phone || '').trim();

      const allEvents = await getDocs(collection(db, 'events'));
      for (const eventDoc of allEvents.docs) {
        const members = eventDoc.data().members || {};
        const updates = {};
        for (const [key, m] of Object.entries(members)) {
          if (!m || typeof m !== 'object') continue;
          const mEmail = (m.email || '').toLowerCase();
          const mDigits = (m.phone || '').replace(/[^\d]/g, '');
          const mName = (m.name || '').toLowerCase();
          const mFirst = mName.split(/\s+/)[0] || '';
          const hit =
            (prevEmail && mEmail === prevEmail) ||
            (prevDigits && prevDigits.length >= 7 && mDigits === prevDigits) ||
            (prevName && mName === prevName) ||
            (prevFirst && mFirst && mFirst === prevFirst && mName.length <= prevName.length + 1);
          if (!hit) continue;
          if (newName && m.name !== newName) updates[`members.${key}.name`] = newName;
          if (newEmail && m.email !== newEmail) updates[`members.${key}.email`] = newEmail;
          if (newPhone && m.phone !== newPhone) updates[`members.${key}.phone`] = newPhone;
        }
        if (Object.keys(updates).length > 0) {
          updateDoc(doc(db, 'events', eventDoc.id), updates).catch(() => {});
        }
      }
    } catch {}

    setEditFriend(null);
    setResult({ type: 'success', message: 'Contact updated — synced to events' });
    setTimeout(() => setResult(null), 3000);
  }

  function editSet(key, value) { setEditFields(prev => ({ ...prev, [key]: value })); }
  function addGiftIdea() {
    const t = giftDraft.trim();
    if (!t) return;
    setEditFields(prev => ({ ...prev, giftIdeas: [...(prev.giftIdeas || []), t] }));
    setGiftDraft('');
  }
  function removeGiftIdea(i) {
    setEditFields(prev => ({ ...prev, giftIdeas: (prev.giftIdeas || []).filter((_, idx) => idx !== i) }));
  }

  async function loadEvents() {
    if (!user) return;
    try {
      const q = query(collection(db, 'events'), where('createdBy', '==', user.uid));
      const snap = await getDocs(q);
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {}
  }

  function sanitizeKey(str) {
    return (str || '').replace(/[.@#$/\[\]]/g, '_');
  }

  async function addSingleContactToEvent(eventId) {
    if (!user || !editFriend) return;
    setAddingToTrip(true);
    const key = sanitizeKey(editFriend.email || editFriend.id);
    await updateDoc(doc(db, 'events', eventId), {
      [`members.${key}`]: { role: 'viewer', rsvp: 'pending', name: editFriend.name || '', email: editFriend.email || '', phone: editFriend.phone || '' },
      memberUids: arrayUnion(key),
    }).catch(err => console.error('Add to event error:', err));
    setAddingToTrip(false);
    setShowSingleAddToEvent(false);
    setResult({ type: 'success', message: `${editFriend.name} added to event!` });
    setTimeout(() => setResult(null), 3000);
  }

  async function addContactsToEvent(eventId) {
    if (!user || selectedIds.size === 0) return;
    setAddingToTrip(true);
    const selectedFriends = friends.filter(f => selectedIds.has(f.id));
    for (const f of selectedFriends) {
      const key = sanitizeKey(f.email || f.id);
      await updateDoc(doc(db, 'events', eventId), {
        [`members.${key}`]: { role: 'viewer', rsvp: 'pending', name: f.name || '', email: f.email || '', phone: f.phone || '' },
        memberUids: arrayUnion(key),
      }).catch(err => console.error('Add to event error:', err));
    }
    setAddingToTrip(false);
    setShowAddToTrip(false);
    setSelectedIds(new Set());
    setResult({ type: 'success', message: `${selectedFriends.length} contact${selectedFriends.length !== 1 ? 's' : ''} added to event!` });
    setTimeout(() => setResult(null), 3000);
  }

  // Add a friend to the roster event with an explicit RSVP, or update the
  // RSVP if they're already a member. Same write shape addContactsToEvent
  // uses so the member shows up identically on the event detail page.
  async function setRosterRsvp(friend, rsvp) {
    if (!user || !rosterEventId || !friend) return;
    const key = sanitizeKey(friend.email || friend.id);
    const isMember = rosterEvent?.members && Object.prototype.hasOwnProperty.call(rosterEvent.members, key);
    if (isMember) {
      await updateDoc(doc(db, 'events', rosterEventId), {
        [`members.${key}.rsvp`]: rsvp,
      }).catch(err => console.error('Set RSVP error:', err));
    } else {
      await updateDoc(doc(db, 'events', rosterEventId), {
        [`members.${key}`]: {
          role: 'viewer',
          rsvp,
          name: friend.name || '',
          email: friend.email || '',
          phone: friend.phone || '',
        },
        memberUids: arrayUnion(key),
      }).catch(err => console.error('Add roster member error:', err));
    }
  }

  // Remove a friend from the roster event. Deletes the member entry and
  // pulls the uid from memberUids so EventDetail's count stays correct.
  async function removeFromRoster(friend) {
    if (!user || !rosterEventId || !friend) return;
    const key = sanitizeKey(friend.email || friend.id);
    await updateDoc(doc(db, 'events', rosterEventId), {
      [`members.${key}`]: deleteField(),
      memberUids: arrayRemove(key),
    }).catch(err => console.error('Remove roster member error:', err));
  }

  function toggleSelect(id) {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map(f => f.id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    if (!user || !window.confirm(`Delete ${selectedIds.size} contacts? This cannot be undone.`)) return;
    for (const id of selectedIds) {
      await deleteDoc(doc(db, 'users', user.uid, 'friends', id)).catch(() => {});
    }
    setSelectedIds(new Set());
    setResult({ type: 'success', message: `${selectedIds.size} contacts deleted` });
    setTimeout(() => setResult(null), 3000);
  }

  async function bulkUpdateField(field, value) {
    if (!user) return;
    for (const id of selectedIds) {
      const friend = friends.find(f => f.id === id);
      if (!friend) continue;
      if (field === 'tag') {
        // Append tag instead of replacing
        const existing = (friend.tag || '').split(';').map(t => t.trim()).filter(Boolean);
        if (!existing.includes(value)) existing.push(value);
        await setDoc(doc(db, 'users', user.uid, 'friends', id), { ...friend, tag: existing.join(';') }).catch(() => {});
      } else {
        await setDoc(doc(db, 'users', user.uid, 'friends', id), { ...friend, [field]: value }).catch(() => {});
      }
    }
    setShowBulkAction(null);
    setBulkValue('');
    setResult({ type: 'success', message: `${selectedIds.size} contacts updated` });
    setTimeout(() => setResult(null), 3000);
  }

  async function handleAddSingle(e) {
    e.preventDefault();
    await addFriend({ name: newName, email: newEmail, phone: newPhone, group: newGroup, guest: newGuest, tag: newTag, addresses: newAddresses, workEmail: newWorkEmail, instagram: newInstagram });
    setNewName(''); setNewEmail(''); setNewPhone(''); setNewGroup(''); setNewGuest(''); setNewTag(''); setNewAddresses([{ label: '', value: '' }]); setNewWorkEmail(''); setNewInstagram('');
    setShowAdd(false);
    setResult({ type: 'success', message: 'Contact added!' });
    setTimeout(() => setResult(null), 3000);
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (rows.length === 0) { setResult({ type: 'error', message: 'File is empty' }); return; }
        const headers = Object.keys(rows[0]);
        setBulkRawRows(rows);
        setBulkHeaders(headers);
        // Auto-detect column mappings
        const FIELD_OPTIONS = [
          { key: 'name', label: 'Name', match: k => (k.includes('name') && !k.includes('last') && !k.includes('group') && !k.includes('work') && !k.includes('business')) || k === 'full name' },
          { key: 'firstName', label: 'First Name', match: k => k.includes('first') },
          { key: 'lastName', label: 'Last Name', match: k => k.includes('last') && k.includes('name') },
          { key: 'email', label: 'Email', match: k => (k.includes('email') || k.includes('e-mail')) && !k.includes('work') && !k.includes('business') && !k.includes('office') },
          { key: 'workEmail', label: 'Work Email', match: k => k.includes('work') && (k.includes('email') || k.includes('e-mail')) || k.includes('business email') || k.includes('office email') },
          { key: 'phone', label: 'Phone', match: k => k.includes('phone') || k.includes('mobile') || k.includes('cell') },
          { key: 'address', label: 'Address', match: k => k === 'address' || k.includes('street') || k.includes('mailing') || k.includes('home address') },
          { key: 'group', label: 'Group', match: k => k === 'group' || k === 'category' },
          { key: 'guest', label: 'Guest', match: k => k === 'guest' || k.includes('plus one') || k.includes('+1') || k.includes('partner') || k.includes('spouse') },
          { key: 'tag', label: 'Tag', match: k => k === 'tag' || k === 'tags' || k === 'label' || k === 'labels' },
          { key: 'instagram', label: 'Instagram', match: k => k === 'instagram' || k === 'ig' || k.includes('insta') },
        ];
        const mapping = {};
        for (const header of headers) {
          const k = header.toLowerCase().trim();
          const matched = FIELD_OPTIONS.find(f => f.match(k));
          mapping[header] = matched ? matched.key : '';
        }
        setBulkMapping(mapping);
        setShowBulk(true);
      } catch (err) {
        setResult({ type: 'error', message: 'Could not read file: ' + err.message });
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  }

  function applyMapping() {
    return bulkRawRows.map(row => {
      const r = {};
      for (const [header, field] of Object.entries(bulkMapping)) {
        if (!field || !row[header]) continue;
        const val = String(row[header]).trim();
        if (!val) continue;
        if (field === 'firstName') r.firstName = val;
        else if (field === 'lastName') r.lastName = val;
        else r[field] = val;
      }
      if (!r.name && (r.firstName || r.lastName)) {
        r.name = [r.firstName, r.lastName].filter(Boolean).join(' ');
      }
      return r;
    }).filter(r => r.name || r.email);
  }

  async function handleBulkUpload() {
    const contacts = applyMapping();
    if (contacts.length === 0) {
      setResult({ type: 'error', message: 'No valid contacts found. Make sure Name or Email is mapped.' });
      return;
    }
    setUploading(true);
    let count = 0;
    const errors = [];
    for (const row of contacts) {
      try {
        await addFriend(row);
        count++;
      } catch (err) {
        errors.push({ name: row.name || row.email || 'Unknown', error: err.message });
      }
    }
    setUploading(false);
    setShowBulk(false);
    setBulkRawRows([]);
    setBulkHeaders([]);
    setBulkMapping({});
    if (errors.length > 0) {
      setResult({ type: 'error', message: `${count} imported, ${errors.length} failed: ${errors.map(e => e.name).join(', ')}` });
    } else {
      setResult({ type: 'success', message: `${count} contact${count !== 1 ? 's' : ''} imported!` });
    }
    setTimeout(() => setResult(null), 5000);
  }

  function handlePasteContinue() {
    const { headers, rows } = parsePastedTable(pasteText);
    if (headers.length === 0 || rows.length === 0) {
      setResult({ type: 'error', message: 'No rows detected. Paste a header row plus at least one contact row.' });
      setTimeout(() => setResult(null), 4500);
      return;
    }
    setBulkRawRows(rows);
    setBulkHeaders(headers);
    setBulkMapping(autoDetectMapping(headers));
    setShowPaste(false);
    setPasteText('');
    setShowBulk(true);
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Email', 'Work Email', 'Phone', 'Address', 'Group', 'Guest', 'Tag', 'Instagram'],
      ['John Smith', 'john@email.com', 'john.smith@acme.com', '555-1234', '123 Main St, Denver CO 80202', 'College Friends', 'Sarah Smith', 'VIP', '@johnsmith'],
      ['Jane Doe', 'jane@email.com', '', '555-5678', '456 Oak Ave, Austin TX 78701', 'Family', '', 'Close Friend', '@janedoe'],
      ['Mike Johnson', 'mike@email.com', 'mike@bigcorp.com', '', '', 'Work', 'Lisa Johnson', 'Outdoors; Foodie', ''],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    XLSX.writeFile(wb, 'rally-contacts-template.xlsx');
  }

  // Polished Excel export of the friends list. Honors the active search and
  // filter state — what the user sees in the table is what gets exported.
  function exportFriendsExcel() {
    const data = filtered.length > 0 ? filtered : friends;
    if (data.length === 0) {
      setResult({ type: 'error', message: 'No contacts to export.' });
      setTimeout(() => setResult(null), 4000);
      return;
    }

    const nameById = {};
    for (const f of friends) nameById[f.id] = f.name || '(unnamed)';

    const headers = [
      'Name', 'Email', 'Work Email', 'Phone', 'Instagram',
      'Group', 'Guest', 'Tags', 'Linked To', 'Addresses', 'Created',
    ];
    const rows = data.map(f => {
      const addresses = getFriendAddresses(f)
        .map(a => (a.label ? `${a.label}: ${a.value}` : a.value))
        .join('\n');
      const tags = (f.tag || '').split(';').map(t => t.trim()).filter(Boolean).join(', ');
      const linkedName = f.linkedTo ? (nameById[f.linkedTo] || '') : '';
      const created = f.createdAt
        ? new Date(f.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : '';
      return [
        f.name || '',
        f.email || '',
        f.workEmail || '',
        f.phone || '',
        f.instagram || '',
        f.group || '',
        f.guest || '',
        tags,
        linkedName,
        addresses,
        created,
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // Column widths tuned to typical contact field lengths.
    ws['!cols'] = [
      { wch: 24 }, // Name
      { wch: 28 }, // Email
      { wch: 28 }, // Work Email
      { wch: 14 }, // Phone
      { wch: 16 }, // Instagram
      { wch: 18 }, // Group
      { wch: 18 }, // Guest
      { wch: 22 }, // Tags
      { wch: 18 }, // Linked To
      { wch: 40 }, // Addresses
      { wch: 14 }, // Created
    ];

    // Header row + filter dropdowns + frozen first row.
    const lastColLetter = XLSX.utils.encode_col(headers.length - 1);
    ws['!autofilter'] = { ref: `A1:${lastColLetter}${rows.length + 1}` };
    ws['!freeze'] = { ySplit: 1 };
    ws['!rows'] = [{ hpt: 22 }];

    // Hyperlinks: emails open mailto, Instagram opens the public profile.
    for (let i = 0; i < rows.length; i++) {
      const f = data[i];
      const r = i + 1;
      if (f.email) {
        const a = XLSX.utils.encode_cell({ r, c: 1 });
        if (ws[a]) ws[a].l = { Target: `mailto:${f.email}`, Tooltip: 'Email' };
      }
      if (f.workEmail) {
        const a = XLSX.utils.encode_cell({ r, c: 2 });
        if (ws[a]) ws[a].l = { Target: `mailto:${f.workEmail}`, Tooltip: 'Work email' };
      }
      if (f.instagram) {
        const handle = f.instagram.replace(/^@/, '').trim();
        if (handle) {
          const a = XLSX.utils.encode_cell({ r, c: 4 });
          if (ws[a]) ws[a].l = { Target: `https://instagram.com/${handle}`, Tooltip: 'Instagram' };
        }
      }
    }

    const wb = XLSX.utils.book_new();

    // Summary sheet: counts by group and tag, plus quick stats.
    const groupCounts = {};
    const tagCounts = {};
    for (const f of data) {
      const fGroups = groupTokens(f.group);
      if (fGroups.length === 0) groupCounts['(no group)'] = (groupCounts['(no group)'] || 0) + 1;
      for (const g of fGroups) groupCounts[g] = (groupCounts[g] || 0) + 1;
      const fTags = (f.tag || '').split(';').map(t => t.trim()).filter(Boolean);
      for (const t of fTags) tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
    const sortByCountDesc = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]);
    const withEmail = data.filter(f => f.email).length;
    const withPhone = data.filter(f => f.phone).length;
    const withIG = data.filter(f => f.instagram).length;
    const withAddress = data.filter(f => getFriendAddresses(f).length > 0).length;

    const summaryAoa = [
      ['Rally — Contacts Export'],
      [`Generated ${new Date().toLocaleString()}`],
      [`Total contacts: ${data.length}`],
      [`With email: ${withEmail}`],
      [`With phone: ${withPhone}`],
      [`With Instagram: ${withIG}`],
      [`With address: ${withAddress}`],
      [],
      ['Group', 'Count'],
      ...Object.entries(groupCounts).sort(sortByCountDesc),
      [],
      ['Tag', 'Count'],
      ...Object.entries(tagCounts).sort(sortByCountDesc),
    ];
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa);
    summaryWs['!cols'] = [{ wch: 30 }, { wch: 10 }];

    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');

    const datestamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `rally-contacts-${datestamp}.xlsx`);
  }

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkAction, setShowBulkAction] = useState(null); // null | 'delete' | 'group' | 'tag'
  const [bulkValue, setBulkValue] = useState('');
  const [showAddToTrip, setShowAddToTrip] = useState(false);
  const [showSingleAddToEvent, setShowSingleAddToEvent] = useState(false);
  const [events, setEvents] = useState([]);
  const [addingToTrip, setAddingToTrip] = useState(false);
  const [viewTab, setViewTab] = useState('cards'); // 'cards' | 'roster'
  const [rosterEventId, setRosterEventId] = useState('');
  const [rosterEvent, setRosterEvent] = useState(null);
  const [rosterSearch, setRosterSearch] = useState('');
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDate, setNewEventDate] = useState('');
  const [newEventLocation, setNewEventLocation] = useState('');
  const [creatingEvent, setCreatingEvent] = useState(false);

  // Create an event from the roster tab and immediately pick it as the
  // active roster. Mirrors createEvent in hooks/useEvents.js so the new
  // event shows up everywhere else (Dashboard, EventDetail) with the same
  // shape.
  async function createRosterEvent(e) {
    e?.preventDefault?.();
    if (!user || !newEventTitle.trim()) return;
    setCreatingEvent(true);
    try {
      const payload = {
        title: newEventTitle.trim(),
        location: newEventLocation.trim(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        memberUids: [user.uid],
        members: {
          [user.uid]: { role: 'owner', rsvp: 'yes', name: user.displayName || user.email || '' },
        },
        visibility: 'private',
        shareToken: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      };
      if (newEventDate) {
        payload.date = Timestamp.fromDate(new Date(newEventDate));
        payload.dateTBD = false;
      } else {
        payload.dateTBD = true;
        payload.date = Timestamp.fromDate(new Date());
      }
      const ref = await addDoc(collection(db, 'events'), payload);
      // Refresh the local events list so the picker shows the new entry,
      // then select it.
      await loadEvents();
      setRosterEventId(ref.id);
      setShowNewEvent(false);
      setNewEventTitle('');
      setNewEventDate('');
      setNewEventLocation('');
      setResult({ type: 'success', message: `${payload.title} created` });
      setTimeout(() => setResult(null), 3000);
    } catch (err) {
      console.error('Create event error:', err);
      setResult({ type: 'error', message: 'Could not create event: ' + err.message });
      setTimeout(() => setResult(null), 4000);
    } finally {
      setCreatingEvent(false);
    }
  }

  // Load events list once the roster tab opens.
  useEffect(() => {
    if (viewTab !== 'roster' || !user) return;
    if (events.length > 0) return;
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTab, user]);

  // Live subscribe to the picked roster event so RSVP edits show up
  // immediately without a manual refetch.
  useEffect(() => {
    if (!user || !rosterEventId) { setRosterEvent(null); return; }
    const unsub = onSnapshot(doc(db, 'events', rosterEventId), (snap) => {
      setRosterEvent(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, () => setRosterEvent(null));
    return unsub;
  }, [user, rosterEventId]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ group: [], tag: [], guest: [], hasEmail: '', hasPhone: '', hasInstagram: '' });
  const activeFilterCount = filters.group.length + filters.tag.length + filters.guest.length + (filters.hasEmail ? 1 : 0) + (filters.hasPhone ? 1 : 0) + (filters.hasInstagram ? 1 : 0);

  // Groups and tags
  function groupTokens(value) {
    return (value || '').split(',').map(g => g.trim()).filter(Boolean);
  }
  const groups = [...new Set(friends.flatMap(f => groupTokens(f.group)))].sort();
  const allTags = [...new Set(friends.flatMap(f => (f.tag || '').split(';').map(t => t.trim()).filter(Boolean)))].sort();
  const allGuests = [...new Set(friends.map(f => f.guest).filter(Boolean))].sort();

  // Column sorting for the contacts table. Empty values always sort last.
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const onSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortArrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const sortVal = (f, key) => {
    switch (key) {
      case 'email': return (f.email || '').toLowerCase();
      case 'phone': return (f.phone || '').replace(/[^\d]/g, '');
      case 'group': return groupTokens(f.group).join(', ').toLowerCase();
      case 'guest': return (f.guest || '').toLowerCase();
      case 'tags': return (f.tag || '').toLowerCase();
      default: return (f.name || '').toLowerCase();
    }
  };

  let filtered = friends;
  // Text search
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(f => f.name?.toLowerCase().includes(q));
  }
  // Dropdown filters
  if (filters.group.length > 0) filtered = filtered.filter(f => { const tokens = groupTokens(f.group); return filters.group.some(g => tokens.includes(g)); });
  if (filters.tag.length > 0) filtered = filtered.filter(f => { const tags = (f.tag || '').split(';').map(t => t.trim()); return filters.tag.some(t => tags.includes(t)); });
  if (filters.guest.length > 0) filtered = filtered.filter(f => filters.guest.includes(f.guest));
  if (filters.hasEmail === 'yes') filtered = filtered.filter(f => f.email);
  if (filters.hasEmail === 'no') filtered = filtered.filter(f => !f.email);
  if (filters.hasPhone === 'yes') filtered = filtered.filter(f => f.phone);
  if (filters.hasPhone === 'no') filtered = filtered.filter(f => !f.phone);
  if (filters.hasInstagram === 'yes') filtered = filtered.filter(f => f.instagram);
  if (filters.hasInstagram === 'no') filtered = filtered.filter(f => !f.instagram);

  filtered = [...filtered].sort((a, b) => {
    const va = sortVal(a, sortKey);
    const vb = sortVal(b, sortKey);
    if (!va && !vb) return 0;
    if (!va) return 1;   // empties last, regardless of direction
    if (!vb) return -1;
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Friends & Contacts</h1>
          <p className={styles.desc}>{friends.length} contact{friends.length !== 1 ? 's' : ''}{groups.length > 0 && ` in ${groups.length} group${groups.length !== 1 ? 's' : ''}`}</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>+ Add Contact</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileSelect} />
          <button className={styles.uploadBtn} onClick={() => fileRef.current?.click()}>Upload Excel</button>
          <button
            className={styles.uploadBtn}
            onClick={() => { setPasteText(''); setShowPaste(true); }}
            title="Paste a range from Excel, Google Sheets, or any CSV/TSV — you'll map columns next"
          >📋 Paste Data</button>
          <button className={styles.templateBtn} onClick={downloadTemplate}>Download Template</button>
          <button className={styles.templateBtn} onClick={exportFriendsExcel} title="Download all visible contacts as a polished Excel file">⬇ Export Excel</button>
        </div>
      </div>

      {result && (
        <div className={`${styles.result} ${styles[`result_${result.type}`]}`}>{result.message}</div>
      )}

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '0.4rem', borderBottom: '1px solid var(--color-border)', marginBottom: '1rem' }}>
        {[
          { key: 'cards', label: 'Contacts' },
          { key: 'tiers', label: 'Tiers' },
          { key: 'roster', label: 'Event Roster' },
        ].map(t => {
          const active = viewTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setViewTab(t.key)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '0.55rem 0.85rem',
                marginBottom: '-1px',
                fontSize: '0.88rem',
                fontWeight: 600,
                fontFamily: 'inherit',
                color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >{t.label}</button>
          );
        })}
      </div>

      {viewTab === 'cards' && (<>
      {/* Search */}
      <input
        className={styles.search}
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name..."
      />

      {/* Filter toggle + panel */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => setShowFilters(p => !p)}
          style={{ padding: '0.35rem 0.75rem', border: activeFilterCount > 0 ? '1px solid var(--color-accent)' : '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', background: activeFilterCount > 0 ? 'var(--color-accent-light)' : 'var(--color-surface)', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
        >
          Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button onClick={() => setFilters({ group: [], tag: [], guest: [], hasEmail: '', hasPhone: '', hasInstagram: '' })} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>Clear all</button>
        )}
        {(activeFilterCount > 0 || search.trim()) && filtered.length > 0 && (
          <button
            onClick={() => { setSelectedIds(new Set(filtered.map(f => f.id))); setShowAddToTrip(true); loadEvents(); }}
            style={{ padding: '0.35rem 0.75rem', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-full)', background: 'var(--color-accent)', color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            title="Add everyone matching the current filters to an event"
          >
            + Add {filtered.length} to Event
          </button>
        )}
        {/* Group chips */}
        {groups.length > 0 && groups.map(g => (
          <button key={g} className={filters.group.includes(g) ? styles.groupChipActive : styles.groupChip} onClick={() => setFilters(prev => ({ ...prev, group: prev.group.includes(g) ? prev.group.filter(x => x !== g) : [...prev.group, g] }))}>{g}</button>
        ))}
      </div>

      {showFilters && (() => {
        function MultiCheck({ label, options, selected, onToggle }) {
          return (
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>
                {label} {selected.length > 0 && <span style={{ color: 'var(--color-accent)' }}>({selected.length})</span>}
              </div>
              <div style={{ maxHeight: '130px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '0.25rem' }}>
                {options.map(opt => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.4rem', fontSize: '0.75rem', cursor: 'pointer', borderRadius: '4px' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-alt)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} style={{ accentColor: 'var(--color-accent)' }} />
                    {opt}
                  </label>
                ))}
                {options.length === 0 && <div style={{ padding: '0.3rem', fontSize: '0.72rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>None</div>}
              </div>
            </div>
          );
        }
        function toggleArr(key, val) {
          setFilters(prev => ({ ...prev, [key]: prev[key].includes(val) ? prev[key].filter(x => x !== val) : [...prev[key], val] }));
        }
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: '0.75rem' }}>
            <MultiCheck label="Group" options={groups} selected={filters.group} onToggle={v => toggleArr('group', v)} />
            <MultiCheck label="Tag" options={allTags} selected={filters.tag} onToggle={v => toggleArr('tag', v)} />
            <MultiCheck label="Guest" options={allGuests} selected={filters.guest} onToggle={v => toggleArr('guest', v)} />
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>Has Email</div>
              <select value={filters.hasEmail} onChange={e => setFilters(prev => ({ ...prev, hasEmail: e.target.value }))} style={{ width: '100%', padding: '0.35rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'inherit' }}>
                <option value="">All</option><option value="yes">Yes</option><option value="no">No</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>Has Phone</div>
              <select value={filters.hasPhone} onChange={e => setFilters(prev => ({ ...prev, hasPhone: e.target.value }))} style={{ width: '100%', padding: '0.35rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'inherit' }}>
                <option value="">All</option><option value="yes">Yes</option><option value="no">No</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>Has Instagram</div>
              <select value={filters.hasInstagram} onChange={e => setFilters(prev => ({ ...prev, hasInstagram: e.target.value }))} style={{ width: '100%', padding: '0.35rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'inherit' }}>
                <option value="">All</option><option value="yes">Yes</option><option value="no">No</option>
              </select>
            </div>
          </div>
        );
      })()}

      {/* Bulk-action toolbar — visible whenever any contact is selected */}
      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', background: 'var(--color-accent-light)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-accent)' }}>{selectedIds.size} selected</span>
          <button onClick={selectAll} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Select All ({filtered.length})</button>
          <button onClick={selectNone} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
            <button onClick={() => { setShowAddToTrip(true); loadEvents(); }} disabled={selectedIds.size === 0} style={{ padding: '0.3rem 0.65rem', border: '1px solid var(--color-accent)', borderRadius: '6px', background: 'var(--color-accent)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#fff', opacity: selectedIds.size === 0 ? 0.4 : 1 }}>Add to Event</button>
            <button onClick={() => setShowBulkAction('group')} disabled={selectedIds.size === 0} style={{ padding: '0.3rem 0.65rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)', opacity: selectedIds.size === 0 ? 0.4 : 1 }}>Set Group</button>
            <button onClick={() => setShowBulkAction('tag')} disabled={selectedIds.size === 0} style={{ padding: '0.3rem 0.65rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)', opacity: selectedIds.size === 0 ? 0.4 : 1 }}>Add Tag</button>
            <button onClick={bulkDelete} disabled={selectedIds.size === 0} style={{ padding: '0.3rem 0.65rem', border: '1px solid var(--color-danger)', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-danger)', opacity: selectedIds.size === 0 ? 0.4 : 1 }}>Delete</button>
          </div>
        </div>
      )}

      {/* Bulk action modal */}
      {showBulkAction && (
        <div className={styles.overlay} onClick={() => setShowBulkAction(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '360px' }}>
            <h2 className={styles.modalTitle}>{showBulkAction === 'group' ? 'Set Group' : 'Add Tag'} for {selectedIds.size} contacts</h2>
            <div className={styles.form}>
              <input
                className={styles.input}
                value={bulkValue}
                onChange={e => setBulkValue(e.target.value)}
                placeholder={showBulkAction === 'group' ? 'Group name...' : 'Tag name...'}
                autoFocus
                list={showBulkAction === 'group' ? 'bulk-group-opts' : 'bulk-tag-opts'}
                onKeyDown={e => { if (e.key === 'Enter' && bulkValue.trim()) bulkUpdateField(showBulkAction, bulkValue.trim()); }}
              />
              {showBulkAction === 'group' && groups.length > 0 && <datalist id="bulk-group-opts">{groups.map(g => <option key={g} value={g} />)}</datalist>}
              {showBulkAction === 'tag' && allTags.length > 0 && <datalist id="bulk-tag-opts">{allTags.map(t => <option key={t} value={t} />)}</datalist>}
              {(showBulkAction === 'group' ? groups : allTags).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.5rem' }}>
                  {(showBulkAction === 'group' ? groups : allTags).map(v => (
                    <button key={v} onClick={() => bulkUpdateField(showBulkAction, v)} style={{ padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}>{v}</button>
                  ))}
                </div>
              )}
              <div className={styles.formActions} style={{ marginTop: '0.75rem' }}>
                <button className={styles.saveBtn} onClick={() => bulkUpdateField(showBulkAction, bulkValue.trim())} disabled={!bulkValue.trim()}>Apply</button>
                <button className={styles.cancelBtn} onClick={() => setShowBulkAction(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add to Event/Trip modal */}
      {showAddToTrip && (
        <div className={styles.overlay} onClick={() => setShowAddToTrip(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <h2 className={styles.modalTitle}>Add {selectedIds.size} contact{selectedIds.size !== 1 ? 's' : ''} to an event</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>Select an event to add the selected contacts as members.</p>
            {events.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-muted)' }}>
                <p style={{ fontSize: '0.88rem', margin: '0 0 0.75rem' }}>No events found. Create one first.</p>
                <a href="/" style={{ color: 'var(--color-accent)', fontWeight: 600, fontSize: '0.85rem' }}>Go to Dashboard</a>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '300px', overflowY: 'auto' }}>
                {events.map(evt => {
                  const d = evt.date?.toDate ? evt.date.toDate() : evt.date ? new Date(evt.date) : null;
                  const memberCount = evt.members ? Object.keys(evt.members).length : 0;
                  return (
                    <button
                      key={evt.id}
                      onClick={() => addContactsToEvent(evt.id)}
                      disabled={addingToTrip}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%', transition: 'border-color 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-accent)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = ''}
                    >
                      <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--color-accent-light)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {d && <>
                          <span style={{ fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-accent)', lineHeight: 1 }}>{d.toLocaleDateString('en-US', { month: 'short' })}</span>
                          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-accent)', lineHeight: 1 }}>{d.getDate()}</span>
                        </>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evt.title}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                          {d && d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          {evt.location && ` · ${evt.location}`}
                          {memberCount > 0 && ` · ${memberCount} member${memberCount !== 1 ? 's' : ''}`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className={styles.formActions} style={{ marginTop: '1rem' }}>
              <button className={styles.cancelBtn} onClick={() => setShowAddToTrip(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Contact list */}
      {loading ? (
        <p className={styles.loading}>Loading contacts...</p>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>👥</div>
          <h2 className={styles.emptyTitle}>No contacts yet</h2>
          <p className={styles.emptyDesc}>Add friends and family to easily invite them to events and trips.</p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem' }}>
            <button className={styles.addBtn} onClick={() => setShowAdd(true)}>+ Add Contact</button>
            <button className={styles.uploadBtn} onClick={() => fileRef.current?.click()}>Upload Excel</button>
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thCheckbox}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every(f => selectedIds.has(f.id))}
                    onChange={() => {
                      const allSelected = filtered.length > 0 && filtered.every(f => selectedIds.has(f.id));
                      if (allSelected) selectNone(); else selectAll();
                    }}
                    title="Select all visible"
                    style={{ accentColor: 'var(--color-accent)' }}
                  />
                </th>
                <th className={styles.th} onClick={() => onSort('name')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Sort by name">Name{sortArrow('name')}</th>
                <th className={styles.th} onClick={() => onSort('email')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Sort by email">Email{sortArrow('email')}</th>
                <th className={styles.th} onClick={() => onSort('phone')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Sort by phone">Phone{sortArrow('phone')}</th>
                <th className={styles.th} onClick={() => onSort('group')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Sort by group">Group{sortArrow('group')}</th>
                <th className={styles.th} onClick={() => onSort('guest')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Sort by guest">Guest{sortArrow('guest')}</th>
                <th className={styles.th} onClick={() => onSort('tags')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Sort by tags">Tags{sortArrow('tags')}</th>
                <th className={styles.th}>Linked</th>
                <th className={styles.thAction} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => {
                const partner = f.linkedTo ? filtered.find(x => x.id === f.linkedTo) : null;
                const reversePartner = !partner ? friends.find(x => x.linkedTo === f.id) : null;
                const linked = partner || reversePartner;
                const tags = (f.tag || '').split(';').map(t => t.trim()).filter(Boolean);
                const selected = selectedIds.has(f.id);
                return (
                  <tr
                    key={f.id}
                    className={`${styles.tr} ${selected ? styles.trSelected : ''}`}
                    onClick={() => openEdit(f)}
                  >
                    <td className={styles.tdCheckbox} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelect(f.id)}
                        style={{ accentColor: 'var(--color-accent)' }}
                      />
                    </td>
                    <td className={`${styles.td} ${styles.tdName}`}>{f.name || <span className={styles.tdMuted}>—</span>}</td>
                    <td className={styles.td}>{f.email || <span className={styles.tdMuted}>—</span>}</td>
                    <td className={styles.td}>{f.phone || <span className={styles.tdMuted}>—</span>}</td>
                    <td className={styles.td}>
                      {f.group ? <span className={styles.cardGroup}>{f.group}</span> : <span className={styles.tdMuted}>—</span>}
                    </td>
                    <td className={styles.td}>{f.guest || <span className={styles.tdMuted}>—</span>}</td>
                    <td className={styles.td}>
                      {tags.length === 0
                        ? <span className={styles.tdMuted}>—</span>
                        : tags.map((t, i) => <span key={i} className={styles.tagChip}>{t}</span>)}
                    </td>
                    <td className={styles.td}>
                      {linked ? <span className={styles.linkedChip}>↔ {linked.name}</span> : <span className={styles.tdMuted}>—</span>}
                    </td>
                    <td className={styles.tdAction} onClick={e => e.stopPropagation()}>
                      <button
                        className={styles.rowDelete}
                        onClick={() => removeFriend(f.id)}
                        title="Remove"
                        aria-label="Remove"
                      >&times;</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>)}

      {viewTab === 'tiers' && (
        <TierBoard friends={friends} onSetTier={setFriendTier} />
      )}

      {viewTab === 'roster' && (
        <RosterTable
          friends={friends}
          events={events}
          rosterEventId={rosterEventId}
          setRosterEventId={setRosterEventId}
          rosterEvent={rosterEvent}
          rosterSearch={rosterSearch}
          setRosterSearch={setRosterSearch}
          setRosterRsvp={setRosterRsvp}
          removeFromRoster={removeFromRoster}
          sanitizeKey={sanitizeKey}
          onNewEvent={() => setShowNewEvent(true)}
        />
      )}

      {showNewEvent && (
        <div className={styles.overlay} onClick={() => setShowNewEvent(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h2 className={styles.modalTitle}>New Event</h2>
            <form className={styles.form} onSubmit={createRosterEvent}>
              <label className={styles.label}>
                Title *
                <input
                  className={styles.input}
                  value={newEventTitle}
                  onChange={e => setNewEventTitle(e.target.value)}
                  placeholder="Spain trip, game night, birthday dinner…"
                  autoFocus
                  required
                />
              </label>
              <label className={styles.label}>
                Date <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional — leave blank for TBD)</span>
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={newEventDate}
                  onChange={e => setNewEventDate(e.target.value)}
                />
              </label>
              <label className={styles.label}>
                Location
                <input
                  className={styles.input}
                  value={newEventLocation}
                  onChange={e => setNewEventLocation(e.target.value)}
                  placeholder="Address or venue (optional)"
                />
              </label>
              <div className={styles.formActions}>
                <button className={styles.saveBtn} type="submit" disabled={!newEventTitle.trim() || creatingEvent}>
                  {creatingEvent ? 'Creating…' : 'Create & open roster'}
                </button>
                <button className={styles.cancelBtn} type="button" onClick={() => setShowNewEvent(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add single contact modal */}
      {showAdd && (
        <div className={styles.overlay} onClick={() => setShowAdd(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Add Contact</h2>
            <form onSubmit={handleAddSingle} className={styles.form}>
              <label className={styles.label}>
                Name *
                <input className={styles.input} value={newName} onChange={e => setNewName(e.target.value)} required autoFocus placeholder="Full name" />
              </label>
              <label className={styles.label}>
                Email
                <input className={styles.input} type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@example.com" />
              </label>
              <label className={styles.label}>
                Phone
                <input className={styles.input} type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="(555) 123-4567" />
              </label>
              <label className={styles.label}>
                Group
                <input className={styles.input} value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="Family, Friends, Work..." list="group-options" />
                {groups.length > 0 && (
                  <datalist id="group-options">
                    {groups.map(g => <option key={g} value={g} />)}
                  </datalist>
                )}
              </label>
              <label className={styles.label}>
                Work Email
                <input className={styles.input} type="email" value={newWorkEmail} onChange={e => setNewWorkEmail(e.target.value)} placeholder="work@company.com" />
              </label>
              <label className={styles.label}>
                Addresses
                <AddressListEditor value={newAddresses} onChange={setNewAddresses} />
              </label>
              <label className={styles.label}>
                Guest
                <input className={styles.input} value={newGuest} onChange={e => setNewGuest(e.target.value)} placeholder="Guest or +1 name" />
              </label>
              <label className={styles.label}>
                Instagram
                <input className={styles.input} value={newInstagram} onChange={e => setNewInstagram(e.target.value)} placeholder="@username or URL" />
              </label>
              <label className={styles.label}>
                Tags
                <input className={styles.input} value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="VIP; Outdoors; Foodie (separate with ;)" />
              </label>
              <div className={styles.formActions}>
                <button className={styles.saveBtn} type="submit">Add Contact</button>
                <button className={styles.cancelBtn} type="button" onClick={() => setShowAdd(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit contact modal */}
      {editFriend && (
        <div className={styles.overlay} onClick={() => setEditFriend(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Edit Contact</h2>
            <form onSubmit={handleSaveEdit} className={styles.form}>
              <label className={styles.label}>Name *<input className={styles.input} value={editFields.name} onChange={e => editSet('name', e.target.value)} required autoFocus /></label>
              <label className={styles.label}>Email<input className={styles.input} type="email" value={editFields.email} onChange={e => editSet('email', e.target.value)} /></label>
              <label className={styles.label}>Work Email<input className={styles.input} type="email" value={editFields.workEmail} onChange={e => editSet('workEmail', e.target.value)} /></label>
              <label className={styles.label}>Phone<input className={styles.input} type="tel" value={editFields.phone} onChange={e => editSet('phone', e.target.value)} placeholder="(555) 123-4567" /></label>
              <label className={styles.label}>Addresses<AddressListEditor value={editFields.addresses || [{ label: '', value: '' }]} onChange={v => editSet('addresses', v)} /></label>
              <label className={styles.label}>Group
                <input className={styles.input} value={editFields.group} onChange={e => editSet('group', e.target.value)} list="edit-group-options" />
                {groups.length > 0 && <datalist id="edit-group-options">{groups.map(g => <option key={g} value={g} />)}</datalist>}
              </label>
              <label className={styles.label}>Guest<input className={styles.input} value={editFields.guest} onChange={e => editSet('guest', e.target.value)} /></label>
              <label className={styles.label}>Instagram<input className={styles.input} value={editFields.instagram} onChange={e => editSet('instagram', e.target.value)} placeholder="@username or URL" /></label>
              <label className={styles.label}>Tags<input className={styles.input} value={editFields.tag} onChange={e => editSet('tag', e.target.value)} placeholder="Separate with ;" /></label>
              <div className={styles.label}>
                🎁 Gift ideas
                {(editFields.giftIdeas || []).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', margin: '0.35rem 0' }}>
                    {(editFields.giftIdeas || []).map((g, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', background: 'var(--color-surface-alt)', borderRadius: 'var(--radius-md)' }}>
                        <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 400, color: 'var(--color-text)', wordBreak: 'break-word' }}>{g}</span>
                        <button type="button" onClick={() => removeGiftIdea(i)} title="Remove" aria-label="Remove gift idea" style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.2rem' }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    className={styles.input}
                    value={giftDraft}
                    onChange={e => setGiftDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGiftIdea(); } }}
                    placeholder="Add a gift idea"
                    style={{ flex: 1 }}
                  />
                  <button type="button" onClick={addGiftIdea} disabled={!giftDraft.trim()} style={{ flexShrink: 0, padding: '0 0.85rem', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'var(--color-accent-light)', color: 'var(--color-accent)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Add</button>
                </div>
              </div>
              <ComesWithPicker
                friends={friends}
                editFriendId={editFriend?.id}
                value={editFields.linkedTo || ''}
                onChange={val => editSet('linkedTo', val)}
              />
              <div className={styles.formActions}>
                <button className={styles.saveBtn} type="submit">Save Changes</button>
                <button className={styles.cancelBtn} type="button" onClick={() => setEditFriend(null)}>Cancel</button>
                <button type="button" onClick={() => { if (window.confirm('Delete this contact?')) { removeFriend(editFriend.id); setEditFriend(null); } }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
              </div>

            </form>

            {/* Add to Event section */}
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border-light)' }}>
              {!showSingleAddToEvent ? (
                <button onClick={() => { setShowSingleAddToEvent(true); loadEvents(); }} style={{ width: '100%', padding: '0.55rem', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'var(--color-accent-light)', color: 'var(--color-accent)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  + Add to Event
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>Select an event</div>
                  {events.length === 0 ? (
                    <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '0.5rem 0' }}>No events found</p>
                  ) : (
                    <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {events.map(evt => {
                        const d = evt.date?.toDate ? evt.date.toDate() : evt.date ? new Date(evt.date) : null;
                        return (
                          <button key={evt.id} onClick={() => addSingleContactToEvent(evt.id)} disabled={addingToTrip}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-accent)'}
                            onMouseLeave={e => e.currentTarget.style.borderColor = ''}
                          >
                            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evt.title}</div>
                            {d && <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button onClick={() => setShowSingleAddToEvent(false)} style={{ marginTop: '0.4rem', background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Paste contact data — first stage; column mapping happens in the bulk-upload modal once parsed. */}
      {showPaste && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowPaste(false); setPasteText(''); } }}
        >
          <div style={{ background: 'var(--color-surface)', borderRadius: '12px', maxWidth: '720px', width: '100%', maxHeight: '90vh', overflow: 'auto', padding: '1.25rem 1.5rem', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
            <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>Paste contact data</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Copy a range from Excel, Google Sheets, Numbers, or any spreadsheet — include the header row. Tab-separated and comma-separated both work.
            </p>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={'Name\tEmail\tPhone\tGroup\nJohn Smith\tjohn@email.com\t555-1234\tCollege Friends\nJane Doe\tjane@email.com\t555-5678\tFamily'}
              style={{ width: '100%', minHeight: '220px', padding: '0.6rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.82rem', resize: 'vertical', background: 'var(--color-surface-alt)' }}
              autoFocus
            />
            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              {pasteText.trim() ? (() => {
                const { headers, rows } = parsePastedTable(pasteText);
                if (headers.length === 0) return 'No data detected.';
                return `Detected ${headers.length} column${headers.length === 1 ? '' : 's'} and ${rows.length} row${rows.length === 1 ? '' : 's'}. Click Continue to map columns.`;
              })() : 'Paste a header row followed by your contacts.'}
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className={styles.templateBtn} onClick={() => { setShowPaste(false); setPasteText(''); }}>Cancel</button>
              <button
                className={styles.addBtn}
                onClick={handlePasteContinue}
                disabled={!pasteText.trim()}
              >Continue → Map columns</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk upload — column mapping + preview modal */}
      {showBulk && (() => {
        const FIELD_OPTIONS = [
          { key: '', label: '— Skip —' },
          { key: 'name', label: 'Name' },
          { key: 'firstName', label: 'First Name' },
          { key: 'lastName', label: 'Last Name' },
          { key: 'email', label: 'Email' },
          { key: 'workEmail', label: 'Work Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'address', label: 'Address' },
          { key: 'group', label: 'Group' },
          { key: 'guest', label: 'Guest' },
          { key: 'tag', label: 'Tag' },
          { key: 'instagram', label: 'Instagram' },
        ];
        const preview = applyMapping();
        const unmapped = bulkHeaders.filter(h => !bulkMapping[h]);
        const hasNameOrEmail = Object.values(bulkMapping).includes('name') || Object.values(bulkMapping).includes('firstName') || Object.values(bulkMapping).includes('email');
        return (
          <div className={styles.overlay} onClick={() => { setShowBulk(false); setBulkRawRows([]); }}>
            <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '720px' }}>
              <h2 className={styles.modalTitle}>Import Contacts</h2>

              {/* Column mapping */}
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', margin: '0 0 0.5rem' }}>Column Mapping</h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem' }}>Match your file columns to the correct fields. Unmatched columns will be skipped.</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.4rem', alignItems: 'center' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', padding: '0 0.4rem' }}>Your Column</div>
                  <div></div>
                  <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', padding: '0 0.4rem' }}>Maps To</div>
                  {bulkHeaders.map(header => (
                    <React.Fragment key={header}>
                      <div style={{ padding: '0.35rem 0.5rem', background: 'var(--color-surface-alt)', borderRadius: '4px', fontSize: '0.82rem', fontWeight: 500 }}>{header}</div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>→</span>
                      <select
                        value={bulkMapping[header] || ''}
                        onChange={e => setBulkMapping(prev => ({ ...prev, [header]: e.target.value }))}
                        style={{ padding: '0.35rem 0.5rem', border: `1px solid ${bulkMapping[header] ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: '6px', fontSize: '0.82rem', fontFamily: 'inherit', color: bulkMapping[header] ? 'var(--color-accent)' : 'var(--color-text-muted)', background: bulkMapping[header] ? 'var(--color-accent-light)' : 'var(--color-surface)', fontWeight: bulkMapping[header] ? 600 : 400 }}
                      >
                        {FIELD_OPTIONS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </React.Fragment>
                  ))}
                </div>
                {!hasNameOrEmail && (
                  <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.75rem', background: 'var(--color-danger-light)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--color-danger)', fontWeight: 500 }}>
                    Map at least Name or Email to import contacts.
                  </div>
                )}
              </div>

              {/* Preview */}
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', margin: '0 0 0.5rem' }}>Preview ({preview.length} contacts)</h3>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-surface-alt)', position: 'sticky', top: 0 }}>
                        {['Name', 'Email', 'Phone', 'Group'].map(h => (
                          <th key={h} style={{ padding: '0.4rem', textAlign: 'left', fontWeight: 600, fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.slice(0, 10).map((r, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                          <td style={{ padding: '0.35rem 0.4rem', fontWeight: 500 }}>{r.name || '—'}</td>
                          <td style={{ padding: '0.35rem 0.4rem', color: 'var(--color-text-secondary)' }}>{r.email || '—'}</td>
                          <td style={{ padding: '0.35rem 0.4rem', color: 'var(--color-text-secondary)' }}>{r.phone || '—'}</td>
                          <td style={{ padding: '0.35rem 0.4rem' }}>{r.group || '—'}</td>
                        </tr>
                      ))}
                      {preview.length > 10 && <tr><td colSpan={4} style={{ padding: '0.35rem 0.4rem', color: 'var(--color-text-muted)', fontStyle: 'italic', textAlign: 'center' }}>+{preview.length - 10} more...</td></tr>}
                    </tbody>
                  </table>
                </div>
                {preview.length === 0 && hasNameOrEmail && (
                  <div style={{ padding: '0.5rem', fontSize: '0.78rem', color: 'var(--color-warning)', textAlign: 'center' }}>No valid contacts found with current mapping.</div>
                )}
              </div>

              <div className={styles.formActions}>
                <button className={styles.saveBtn} onClick={handleBulkUpload} disabled={uploading || preview.length === 0}>
                  {uploading ? 'Importing...' : `Import ${preview.length} Contacts`}
                </button>
                <button className={styles.cancelBtn} onClick={() => { setShowBulk(false); setBulkRawRows([]); }}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
