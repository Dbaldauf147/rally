import React, { useState, useEffect, useRef } from 'react';
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';
import styles from './FriendsPage.module.css';

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

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'users', user.uid, 'friends'), (snap) => {
      setFriends(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user]);

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
    });
    setEditFriend(friend);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!user || !editFriend) return;
    const cleanedAddresses = (editFields.addresses || [])
      .map(a => ({ label: (a.label || '').trim(), value: (a.value || '').trim() }))
      .filter(a => a.value);
    const nextFields = {
      ...editFields,
      email: (editFields.email || '').trim().toLowerCase(),
      workEmail: (editFields.workEmail || '').trim().toLowerCase(),
      addresses: cleanedAddresses,
      address: cleanedAddresses[0]?.value || '',
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
    setSelectMode(false);
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

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkAction, setShowBulkAction] = useState(null); // null | 'delete' | 'group' | 'tag'
  const [bulkValue, setBulkValue] = useState('');
  const [showAddToTrip, setShowAddToTrip] = useState(false);
  const [showSingleAddToEvent, setShowSingleAddToEvent] = useState(false);
  const [events, setEvents] = useState([]);
  const [addingToTrip, setAddingToTrip] = useState(false);
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Friends & Contacts</h1>
          <p className={styles.desc}>{friends.length} contact{friends.length !== 1 ? 's' : ''}{groups.length > 0 && ` in ${groups.length} group${groups.length !== 1 ? 's' : ''}`}</p>
        </div>
        <div className={styles.actions}>
          <button className={selectMode ? styles.addBtn : styles.templateBtn} onClick={() => { setSelectMode(p => !p); setSelectedIds(new Set()); }}>
            {selectMode ? 'Done' : 'Select'}
          </button>
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>+ Add Contact</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileSelect} />
          <button className={styles.uploadBtn} onClick={() => fileRef.current?.click()}>Upload Excel</button>
          <button className={styles.templateBtn} onClick={downloadTemplate}>Download Template</button>
        </div>
      </div>

      {result && (
        <div className={`${styles.result} ${styles[`result_${result.type}`]}`}>{result.message}</div>
      )}

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

      {/* Select mode toolbar */}
      {selectMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', background: 'var(--color-accent-light)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-accent)' }}>{selectedIds.size} selected</span>
          <button onClick={selectAll} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Select All ({filtered.length})</button>
          {selectedIds.size > 0 && <button onClick={selectNone} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>}
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
        <div className={styles.grid}>
          {(() => {
            // Group linked pairs together, render singles separately
            const rendered = new Set();
            const items = [];

            function renderCard(f) {
              return (
                <div key={f.id} className={styles.card} onClick={() => selectMode ? toggleSelect(f.id) : openEdit(f)} style={{ cursor: 'pointer', outline: selectedIds.has(f.id) ? '2px solid var(--color-accent)' : 'none' }}>
                  {selectMode && (
                    <input type="checkbox" checked={selectedIds.has(f.id)} onChange={() => toggleSelect(f.id)} onClick={e => e.stopPropagation()} style={{ accentColor: 'var(--color-accent)', flexShrink: 0 }} />
                  )}
                  <div className={styles.cardInfo}>
                    <div className={styles.cardName}>{f.name}</div>
                  </div>
                  <button className={styles.cardDelete} onClick={e => { e.stopPropagation(); removeFriend(f.id); }} title="Remove">&times;</button>
                </div>
              );
            }

            for (const f of filtered) {
              if (rendered.has(f.id)) continue;
              rendered.add(f.id);
              // Find linked partner
              const partner = f.linkedTo ? filtered.find(x => x.id === f.linkedTo) : null;
              const reversePartner = !partner ? filtered.find(x => x.linkedTo === f.id && !rendered.has(x.id)) : null;
              const linked = partner || reversePartner;

              if (linked && !rendered.has(linked.id)) {
                rendered.add(linked.id);
                items.push(
                  <div key={`pair-${f.id}`} className={styles.pair}>
                    {renderCard(f)}
                    {renderCard(linked)}
                  </div>
                );
              } else {
                items.push(
                  <div key={`single-${f.id}`} className={styles.single}>
                    {renderCard(f)}
                  </div>
                );
              }
            }
            return items;
          })()}
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
