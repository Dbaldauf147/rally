import { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import styles from './ChatPanel.module.css';

export function ChatPanel({ entityType, entityId }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, entityType, entityId, 'chat'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
    return unsub;
  }, [entityType, entityId]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim() || !user) return;
    setSending(true);
    await addDoc(collection(db, entityType, entityId, 'chat'), {
      authorUid: user.uid,
      authorName: user.displayName || user.email || 'Anonymous',
      text: text.trim(),
      createdAt: serverTimestamp(),
    });
    setText('');
    setSending(false);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.messages}>
        {messages.length === 0 && <p className={styles.empty}>No messages yet. Start the conversation!</p>}
        {messages.map(m => {
          const isMe = m.authorUid === user?.uid;
          const time = m.createdAt?.toDate ? format(m.createdAt.toDate(), 'MMM d, h:mm a') : '';
          return (
            <div key={m.id} className={isMe ? styles.msgMe : styles.msg}>
              <div className={styles.msgHeader}>
                <span className={styles.msgAuthor}>{isMe ? 'You' : m.authorName}</span>
                <span className={styles.msgTime}>{time}</span>
              </div>
              <p className={styles.msgText}>{m.text}</p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form className={styles.inputRow} onSubmit={handleSend}>
        <input className={styles.input} type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Type a message..." disabled={sending} />
        <button className={styles.sendBtn} type="submit" disabled={!text.trim() || sending}>Send</button>
      </form>
    </div>
  );
}
