import { useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import styles from './EventForm.module.css';

export function EventForm({ event, onSave, onCancel }) {
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [location, setLocation] = useState(event?.location || '');
  const [dateTBD, setDateTBD] = useState(event?.dateTBD || false);
  const [date, setDate] = useState(() => {
    if (event?.date) {
      const d = event.date.toDate ? event.date.toDate() : new Date(event.date);
      return d.toISOString().slice(0, 16);
    }
    return '';
  });
  const [endDate, setEndDate] = useState(() => {
    if (event?.endDate) {
      const d = event.endDate.toDate ? event.endDate.toDate() : new Date(event.endDate);
      return d.toISOString().slice(0, 16);
    }
    return '';
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    if (!dateTBD && !date) return;
    const data = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      dateTBD,
    };
    if (dateTBD) {
      data.date = event?.date || Timestamp.fromDate(new Date());
      data.endDate = event?.endDate || null;
    } else {
      data.date = Timestamp.fromDate(new Date(date));
      data.endDate = endDate ? Timestamp.fromDate(new Date(endDate)) : null;
    }
    onSave(data);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.heading}>{event ? 'Edit Event' : 'Create Event'}</h2>

      <label className={styles.label}>
        Event Name
        <input className={styles.input} type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Game night, birthday dinner..." required autoFocus />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 500, color: dateTBD ? '#4f46e5' : '#6b7280' }}>
        <input type="checkbox" checked={dateTBD} onChange={e => setDateTBD(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#4f46e5' }} />
        Date & time to be determined (based on poll voting)
      </label>

      {!dateTBD && (
        <div className={styles.row}>
          <label className={styles.label}>
            Start
            <input className={styles.input} type="datetime-local" value={date} onChange={e => setDate(e.target.value)} required />
          </label>
          <label className={styles.label}>
            End (optional)
            <input className={styles.input} type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </label>
        </div>
      )}

      {dateTBD && (
        <div style={{ padding: '0.75rem', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: '8px', fontSize: '0.82rem', color: '#4338CA' }}>
          📊 Date will be decided by poll votes. You can finalize it later.
        </div>
      )}

      <label className={styles.label}>
        Location
        <input className={styles.input} type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="Address or venue name" />
      </label>

      <label className={styles.label}>
        Description
        <textarea className={styles.textarea} value={description} onChange={e => setDescription(e.target.value)} placeholder="What should people know?" rows={3} />
      </label>

      <div className={styles.actions}>
        <button className={styles.saveBtn} type="submit">{event ? 'Save Changes' : 'Create Event'}</button>
        {onCancel && <button className={styles.cancelBtn} type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
