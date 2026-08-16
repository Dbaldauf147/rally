// UI for the friends list's user-defined fields — the manager that edits the
// definitions, and the inputs that collect a value for one contact.
//
// Both live here rather than in FriendsPage so the add-contact modal and the
// edit-contact modal render the same controls from the same code; the storage
// shape and the type coercion are in lib/customFields.js.

import React, { useState } from 'react';
import styles from './FriendsPage.module.css';
import {
  CUSTOM_FIELD_TYPES, newFieldId, parseOptionList, optionListText,
  customFieldValues,
} from '../lib/customFields';

// One value input, shaped by the field's type. `onChange` hands back exactly
// what was typed — coercion happens once on save (coerceCustomMap), because
// trimming mid-keystroke would make a space impossible to type.
export function CustomFieldInput({ field, value, onChange }) {
  if (field.type === 'checkbox') {
    return (
      <label
        key={field.id}
        className={styles.label}
        style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', textTransform: 'none', letterSpacing: 'normal', fontSize: '0.85rem' }}
      >
        <input
          type="checkbox"
          checked={value === true}
          onChange={e => onChange(e.target.checked)}
          style={{ width: '18px', height: '18px', accentColor: 'var(--color-accent)' }}
        />
        {field.label}
      </label>
    );
  }

  let control;
  if (field.type === 'select') {
    // A choice list still accepts anything typed in — an import can introduce a
    // value the list never had, and the editor shouldn't silently drop it.
    const options = [...new Set([...(field.options || []), ...(value ? [String(value)] : [])])];
    control = (
      <>
        <input
          className={styles.input}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          list={`custom-opts-${field.id}`}
          placeholder={options.length > 0 ? `e.g. ${options[0]}` : 'Type a value'}
        />
        <datalist id={`custom-opts-${field.id}`}>
          {options.map(o => <option key={o} value={o} />)}
        </datalist>
      </>
    );
  } else if (field.type === 'number') {
    control = (
      <input
        className={styles.input}
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  } else if (field.type === 'date') {
    control = (
      <input
        className={styles.input}
        type="date"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    );
  } else {
    control = (
      <input
        className={styles.input}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  return <label className={styles.label}>{field.label}{control}</label>;
}

// The custom-field block of the add/edit contact forms. Renders nothing until
// the user has defined a field, so the forms look untouched by default.
export function CustomFieldInputs({ fields, values, onChange }) {
  if (!fields || fields.length === 0) return null;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Custom fields</span>
        <span style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
      </div>
      {fields.map(f => (
        <CustomFieldInput
          key={f.id}
          field={f}
          value={values?.[f.id]}
          onChange={v => onChange(f.id, v)}
        />
      ))}
    </>
  );
}

const rowStyle = {
  display: 'flex', flexDirection: 'column', gap: '0.4rem',
  padding: '0.65rem', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', background: 'var(--color-surface-alt)',
};
const iconBtnStyle = {
  width: '1.9rem', height: '1.9rem', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
  color: 'var(--color-text-muted)', fontSize: '0.85rem', lineHeight: 1,
  cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
};

// Manager modal. Edits a draft copy so Cancel really cancels; the parent only
// sees the definitions once Save is pressed.
export function CustomFieldsModal({ fields, friends, onSave, onClose }) {
  const [draft, setDraft] = useState(() => fields.map(f => ({ ...f, options: [...(f.options || [])] })));
  const [saving, setSaving] = useState(false);

  const update = (i, patch) => setDraft(d => d.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const move = (i, delta) => setDraft(d => {
    const j = i + delta;
    if (j < 0 || j >= d.length) return d;
    const next = [...d];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i) => {
    const f = draft[i];
    // Only the definition goes away. Values stay on the contacts, so re-adding
    // a field with the same name and losing everyone's answers isn't possible
    // by accident — but nothing reads them while the field is gone.
    const inUse = friends.filter(x => {
      const v = x?.custom?.[f.id];
      return v !== undefined && v !== null && v !== '';
    }).length;
    const warning = inUse > 0
      ? `Remove “${f.label}”? ${inUse} contact${inUse !== 1 ? 's have' : ' has'} a value for it — the values stay stored but stop showing anywhere.`
      : `Remove “${f.label}”?`;
    if (!window.confirm(warning)) return;
    setDraft(d => d.filter((_, idx) => idx !== i));
  };
  const add = () => setDraft(d => [
    ...d,
    { id: newFieldId(), label: '', type: 'text', options: [], showInTable: true },
  ]);

  async function handleSave() {
    setSaving(true);
    // A row left blank is a row the user started and abandoned — drop it rather
    // than saving a nameless column.
    await onSave(draft.filter(f => f.label.trim()).map(f => ({
      ...f,
      label: f.label.trim(),
      options: f.type === 'select' ? f.options : [],
    })));
    setSaving(false);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <h2 className={styles.modalTitle}>Custom Fields</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>
          Track anything the built-in fields don’t cover. Custom fields show on every
          contact, can be imported from a spreadsheet, and appear as columns you can
          sort and filter.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {draft.map((f, i) => (
            <div key={f.id} style={rowStyle}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input
                  className={styles.input}
                  value={f.label}
                  onChange={e => update(i, { label: e.target.value })}
                  placeholder="Field name — Shirt size, How we met…"
                  style={{ flex: 1, minWidth: 0, background: 'var(--color-surface)' }}
                  autoFocus={!f.label}
                />
                <select
                  value={f.type}
                  onChange={e => update(i, { type: e.target.value })}
                  style={{ padding: '0.6rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontFamily: 'inherit', background: 'var(--color-surface)', color: 'var(--color-text)', flexShrink: 0 }}
                >
                  {CUSTOM_FIELD_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up" aria-label="Move up" style={{ ...iconBtnStyle, opacity: i === 0 ? 0.35 : 1 }}>↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} title="Move down" aria-label="Move down" style={{ ...iconBtnStyle, opacity: i === draft.length - 1 ? 0.35 : 1 }}>↓</button>
                <button type="button" onClick={() => remove(i)} title="Remove field" aria-label="Remove field" style={{ ...iconBtnStyle, color: 'var(--color-danger)' }}>×</button>
              </div>

              {f.type === 'select' && (
                <textarea
                  className={styles.input}
                  value={optionListText(f.options)}
                  onChange={e => update(i, { options: parseOptionList(e.target.value) })}
                  placeholder={'Choices — one per line\nSmall\nMedium\nLarge'}
                  rows={3}
                  style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4, background: 'var(--color-surface)' }}
                />
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={f.showInTable !== false}
                  onChange={e => update(i, { showInTable: e.target.checked })}
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                Show as a column in the contacts table
                {(() => {
                  const used = customFieldValues(friends, f).length;
                  return used > 0
                    ? <span style={{ color: 'var(--color-text-muted)' }}>· {used} distinct value{used !== 1 ? 's' : ''} in use</span>
                    : null;
                })()}
              </label>
            </div>
          ))}

          {draft.length === 0 && (
            <div style={{ padding: '1.25rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              No custom fields yet.
            </div>
          )}

          <button type="button" className={styles.addressAddBtn} onClick={add}>+ Add field</button>
        </div>

        <div className={styles.formActions} style={{ marginTop: '1rem' }}>
          <button className={styles.saveBtn} type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Fields'}
          </button>
          <button className={styles.cancelBtn} type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
