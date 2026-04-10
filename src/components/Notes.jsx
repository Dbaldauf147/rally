import { useState } from 'react';
import styles from './Notes.module.css';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

export function Notes({ event, onSave, currentUser, canManageAll }) {
  const notes = Array.isArray(event?.notes) ? event.notes : [];
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');

  const uid = currentUser?.uid;
  const isMember = !!(uid && event?.members?.[uid]);
  const canContribute = isMember || canManageAll;

  function startAdd() {
    setDraft('');
    setAdding(true);
    setEditingId(null);
  }

  function startEdit(note) {
    setDraft(note.content || '');
    setEditingId(note.id);
    setAdding(false);
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft('');
  }

  async function saveNote() {
    const content = draft.trim();
    if (!content) return;
    const now = new Date().toISOString();
    let next;
    if (adding) {
      const authorName =
        event?.members?.[uid]?.name ||
        currentUser?.displayName ||
        currentUser?.email ||
        'Someone';
      const newNote = {
        id: crypto.randomUUID(),
        content,
        authorUid: uid || '',
        authorName,
        createdAt: now,
        updatedAt: now,
      };
      next = [...notes, newNote];
    } else {
      next = notes.map(n =>
        n.id === editingId ? { ...n, content, updatedAt: now } : n
      );
    }
    await onSave({ notes: next });
    cancel();
  }

  async function deleteNote(id) {
    if (!confirm('Delete this note?')) return;
    const next = notes.filter(n => n.id !== id);
    await onSave({ notes: next });
  }

  const sorted = notes
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Notes</h3>
        {canContribute && !adding && !editingId && (
          <button className={styles.addBtn} onClick={startAdd}>
            + Add Note
          </button>
        )}
      </div>

      {(adding || editingId) && (
        <div className={styles.form}>
          <textarea
            className={styles.textarea}
            placeholder="Write a note for the group..."
            rows={4}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
          />
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={cancel}>
              Cancel
            </button>
            <button
              className={styles.saveBtn}
              onClick={saveNote}
              disabled={!draft.trim()}
            >
              {adding ? 'Add Note' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 && !adding ? (
        <div className={styles.empty}>
          <p>No notes yet.</p>
          {canContribute && (
            <p className={styles.emptyHint}>
              Click "+ Add Note" to leave a note for the group.
            </p>
          )}
        </div>
      ) : (
        <div className={styles.list}>
          {sorted.map(note => {
            const isAuthor = uid && note.authorUid === uid;
            const canEditThis = isAuthor;
            const canDeleteThis = isAuthor || canManageAll;
            const edited =
              note.updatedAt && note.updatedAt !== note.createdAt;
            return (
              <div key={note.id} className={styles.note}>
                <div className={styles.noteContent}>
                  <div className={styles.noteHeader}>
                    <span className={styles.noteAuthor}>
                      {note.authorName || 'Someone'}
                    </span>
                    <span className={styles.noteDate}>
                      {formatDate(note.createdAt)}
                      {edited && ' · edited'}
                    </span>
                  </div>
                  <div className={styles.noteBody}>{note.content}</div>
                </div>
                {(canEditThis || canDeleteThis) && (
                  <div className={styles.noteActions}>
                    {canEditThis && (
                      <button
                        className={styles.iconBtn}
                        onClick={() => startEdit(note)}
                        title="Edit"
                      >
                        ✎
                      </button>
                    )}
                    {canDeleteThis && (
                      <button
                        className={styles.iconBtn}
                        onClick={() => deleteNote(note.id)}
                        title="Delete"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
