import React, { useEffect, useRef, useState } from 'react';
import styles from './FamilyTree.module.css';
import { RELATIONS, familyRows, addPerson, updatePerson, removePerson, normalizeFamilyTree } from '../lib/familyTree';
import { saveFamilyPhoto, readFamilyPhoto, deleteFamilyPhoto } from '../lib/familyPhotos';

// Phones get a list; anything wider gets the tree. Same breakpoint as the
// other pages that switch layouts (Reach Out, Plans, Dashboard).
const MOBILE_QUERY = '(max-width: 760px)';
function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// A face: the stored photo once it loads, the person's initials until then
// (or for good, when there's no photo).
function Avatar({ uid, photoId, name, size }) {
  // Kept with the id it belongs to, so a changed photoId shows initials until
  // its own picture arrives rather than the previous face.
  const [loaded, setLoaded] = useState({ id: '', data: null });
  useEffect(() => {
    let live = true;
    if (photoId && uid) readFamilyPhoto(uid, photoId).then((d) => { if (live) setLoaded({ id: photoId, data: d }); }).catch(() => {});
    return () => { live = false; };
  }, [uid, photoId]);
  const src = loaded.id === photoId ? loaded.data : null;
  return (
    <span className={styles.avatar} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {src ? <img src={src} alt={name} /> : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  );
}

/* The family tree pop-up for one friend. Edits are handed straight back —
 * `onChange({ tree, kids })` — and FriendsPage writes them at once, so closing
 * this (or the contact behind it) never loses a photo that was just added. */
export function FamilyTreeModal({ uid, friendId, name, partnerName, tree, kids, onChange, onClose }) {
  const isMobile = useIsMobile();
  const t = normalizeFamilyTree(tree);
  const kidList = Array.isArray(kids) ? kids : [];
  const rows = familyRows({ name, tree: t, kids: kidList, partnerName });
  const fileRef = useRef(null);
  const [photoFor, setPhotoFor] = useState(null); // the person a picked file is for
  const [busy, setBusy] = useState(null); // key of the person whose photo is uploading
  const [editing, setEditing] = useState(null); // { id, name, relation }
  const [draft, setDraft] = useState({ name: '', relation: 'parent' });

  // Where a person's photo id lives, and how to write a new one there.
  function withPhoto(person, photoId) {
    if (person.kind === 'self') return { tree: { ...t, selfPhoto: photoId }, kids: kidList };
    if (person.kind === 'partner') return { tree: { ...t, partnerPhoto: photoId }, kids: kidList };
    if (person.kind === 'kid') {
      return { tree: t, kids: kidList.map((k, i) => (i === person.index ? { ...k, photoId } : k)) };
    }
    return { tree: updatePerson(t, person.id, { photoId }), kids: kidList };
  }

  function pickPhoto(person) {
    setPhotoFor(person);
    fileRef.current?.click();
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const person = photoFor;
    if (!file || !person) return;
    setBusy(person.key);
    try {
      const id = await saveFamilyPhoto(uid, friendId, file);
      await onChange(withPhoto(person, id));
      if (person.photoId) deleteFamilyPhoto(uid, person.photoId);
    } catch (err) {
      alert(err.message || 'Could not save that photo.');
    } finally {
      setBusy(null);
    }
  }

  async function clearPhoto(person) {
    await onChange(withPhoto(person, ''));
    deleteFamilyPhoto(uid, person.photoId);
  }

  async function add(e) {
    e.preventDefault();
    const n = draft.name.trim();
    if (!n) return;
    // A kid goes on the Kids list, which is where the rest of Rally reads kids.
    if (draft.relation === 'kid') await onChange({ tree: t, kids: [...kidList, { name: n, birthday: '' }] });
    else await onChange({ tree: addPerson(t, n, draft.relation), kids: kidList });
    setDraft((d) => ({ ...d, name: '' }));
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editing.name.trim()) return;
    await onChange({ tree: updatePerson(t, editing.id, { name: editing.name, relation: editing.relation }), kids: kidList });
    setEditing(null);
  }

  async function remove(person) {
    if (!window.confirm(`Remove ${person.name} from the family tree?`)) return;
    await onChange({ tree: removePerson(t, person.id), kids: kidList });
    if (person.photoId) deleteFamilyPhoto(uid, person.photoId);
    setEditing(null);
  }

  // One person, as a card in the tree or a row in the list.
  const personView = (p) => {
    const editingThis = editing && p.kind === 'person' && editing.id === p.id;
    return (
      <div key={p.key} className={isMobile ? styles.listRow : `${styles.card} ${p.kind === 'self' ? styles.cardSelf : ''}`} data-person={p.key}>
        <button
          type="button"
          className={styles.photoBtn}
          onClick={() => pickPhoto(p)}
          title={p.photoId ? `Change ${p.name}'s photo` : `Add a photo of ${p.name}`}
          aria-label={p.photoId ? `Change photo of ${p.name}` : `Add photo of ${p.name}`}
          disabled={!!busy}
        >
          <Avatar uid={uid} photoId={p.photoId} name={p.name} size={isMobile ? 52 : 88} />
          <span className={styles.photoBadge}>{busy === p.key ? '…' : p.photoId ? '✎' : '+'}</span>
        </button>
        {editingThis ? (
          <form className={styles.editForm} onSubmit={saveEdit}>
            <input className={styles.input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Name" autoFocus />
            <select className={styles.input} value={editing.relation} onChange={(e) => setEditing({ ...editing, relation: e.target.value })} aria-label="Relation">
              {RELATIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <div className={styles.editActions}>
              <button type="submit" className={styles.smallPrimary}>Save</button>
              <button type="button" className={styles.smallBtn} onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className={styles.smallDanger} onClick={() => remove(p)}>Remove</button>
            </div>
          </form>
        ) : (
          <div className={styles.personText}>
            <div className={styles.personName}>{p.name}</div>
            <div className={styles.personRel}>{p.relation}</div>
            <div className={styles.personActions}>
              {p.kind === 'person' && (
                <button type="button" className={styles.linkBtn} onClick={() => setEditing({ id: p.id, name: p.name, relation: p.relationKey })}>Edit</button>
              )}
              {p.photoId && <button type="button" className={styles.linkBtn} onClick={() => clearPhoto(p)}>Remove photo</button>}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={isMobile ? styles.sheet : styles.stage}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${name || 'Their'} family tree`}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>👪 {name || 'Their'} family tree</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close family tree">×</button>
        </div>

        <form className={styles.addForm} onSubmit={add}>
          <input
            className={styles.input}
            placeholder="Add someone — name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label="New person's name"
          />
          <select className={styles.input} value={draft.relation} onChange={(e) => setDraft({ ...draft, relation: e.target.value })} aria-label="New person's relation">
            {RELATIONS.filter((r) => r.gen < 1).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            <option value="kid">Kid</option>
            {RELATIONS.filter((r) => r.gen >= 1).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button type="submit" className={styles.smallPrimary} disabled={!draft.name.trim()}>Add</button>
        </form>

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

        {isMobile ? (
          <div className={styles.list}>
            {rows.map((r) => (
              <section key={r.gen} className={styles.listGroup} aria-label={r.label}>
                <h3 className={styles.listHeading}>{r.label}</h3>
                {r.people.map(personView)}
              </section>
            ))}
          </div>
        ) : (
          <div className={styles.tree}>
            {rows.map((r, i) => {
              // The friend's row puts the couple together, joined, in the middle.
              const couple = r.gen === 0 ? r.people.filter((p) => r.couple.includes(p.key)) : [];
              const before = r.gen === 0 ? r.people.slice(0, r.people.indexOf(couple[0])) : r.people;
              const after = r.gen === 0 ? r.people.slice(r.people.indexOf(couple[couple.length - 1]) + 1) : [];
              return (
                <section key={r.gen} className={`${styles.gen} ${i > 0 ? styles.genLinked : ''}`} aria-label={r.label}>
                  <div className={styles.genLabel}>{r.label}</div>
                  <div className={styles.genPeople}>
                    {before.map(personView)}
                    {couple.length > 0 && (
                      <div className={styles.couple}>
                        {couple.map((p, ci) => (
                          <React.Fragment key={p.key}>
                            {ci > 0 && <span className={styles.coupleLink} aria-hidden="true">♥</span>}
                            {personView(p)}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                    {after.map(personView)}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        <p className={styles.hint}>Tap a photo circle to add or change a picture. Kids come from the Kids list; the partner from “Comes with” or Guest.</p>
      </div>
    </div>
  );
}
