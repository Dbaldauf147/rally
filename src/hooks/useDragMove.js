import { useCallback, useEffect, useRef, useState } from 'react';

/* Dragging that works with a finger.
 *
 * The browser's own drag-and-drop (draggable + dragstart) does nothing at all
 * on iOS, which is most of where this app is used, so this drives the drag
 * from pointer events instead: they arrive the same from a mouse, a finger and
 * a pencil.
 *
 * A drag starts from a grip rather than the row, for two reasons: a row is
 * something you tap and scroll past, and a grip can carry `touch-action: none`
 * so the page doesn't scroll away under a finger that means to drag. The mouse
 * still waits for a few pixels of movement, so a click on the grip is a click.
 *
 * Drop targets say what they are in the DOM — `data-drop="section"` and the
 * rest — and are found under the pointer with elementFromPoint, which is what
 * makes a target anywhere on the page (a list, a heading, a filter chip) cost
 * nothing but an attribute.
 */

const MOUSE_SLOP = 4; // px before a mouse press counts as a drag
const EDGE = 64; // px from the top/bottom of the window where it scrolls
const EDGE_SPEED = 14; // px per frame at the very edge

// The drop target under a point, read off the DOM.
export function targetAt(x, y) {
  if (typeof document === 'undefined') return null;
  const el = document.elementFromPoint(x, y);
  const hit = el?.closest?.('[data-drop]');
  if (!hit) return null;
  const type = hit.getAttribute('data-drop');
  const box = hit.getBoundingClientRect();
  return {
    // Which part of the row the pointer is over decides between dropping
    // above it and dropping inside it — see lib/travelMove's isMiddle.
    rect: { top: box.top, height: box.height },
    type,
    sectionId: hit.getAttribute('data-section') || '',
    itemId: hit.getAttribute('data-item') || '',
    category: hit.getAttribute('data-category') || '',
    key: `${type}:${hit.getAttribute('data-section') || ''}:${hit.getAttribute('data-item') || ''}:${hit.getAttribute('data-category') || ''}`,
  };
}

export function useDragMove(onDrop) {
  // Held in a ref so a caller can pass a plain function: the listeners below
  // are bound once, not re-bound on every render.
  const dropRef = useRef(onDrop);
  useEffect(() => { dropRef.current = onDrop; });
  // { payload, label, x, y, target } once a drag is actually running.
  const [drag, setDrag] = useState(null);
  const pending = useRef(null); // a press that hasn't moved far enough yet
  const dragRef = useRef(null);
  const scroller = useRef(0);

  const stop = useCallback(() => {
    pending.current = null;
    dragRef.current = null;
    setDrag(null);
    if (scroller.current) { cancelAnimationFrame(scroller.current); scroller.current = 0; }
  }, []);

  // Keep dragging when the pointer reaches the top or bottom of the window:
  // the list this is for is longer than a phone screen, so the target is
  // usually off it when the drag starts.
  useEffect(() => {
    if (!drag) return undefined;
    let live = true;
    const step = () => {
      if (!live) return;
      const y = dragRef.current?.y ?? 0;
      const from = window.innerHeight;
      let by = 0;
      if (y < EDGE) by = -EDGE_SPEED * (1 - y / EDGE);
      else if (y > from - EDGE) by = EDGE_SPEED * (1 - (from - y) / EDGE);
      if (by) window.scrollBy(0, by);
      scroller.current = requestAnimationFrame(step);
    };
    scroller.current = requestAnimationFrame(step);
    return () => { live = false; if (scroller.current) cancelAnimationFrame(scroller.current); scroller.current = 0; };
  }, [drag]);

  useEffect(() => {
    const move = (e) => {
      const p = pending.current;
      if (p && !dragRef.current) {
        if (p.touch || Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOUSE_SLOP) {
          dragRef.current = { payload: p.payload, label: p.label, x: e.clientX, y: e.clientY, target: null };
          setDrag(dragRef.current);
        }
        return;
      }
      if (!dragRef.current) return;
      // Stops the page scrolling under a finger mid-drag. Only once a drag is
      // really running, so a tap or a scroll that started here still works.
      if (e.cancelable) e.preventDefault();
      const target = targetAt(e.clientX, e.clientY);
      const next = { ...dragRef.current, x: e.clientX, y: e.clientY, target };
      dragRef.current = next;
      setDrag(next);
    };
    const up = (e) => {
      const current = dragRef.current;
      if (current) {
        const target = targetAt(e.clientX, e.clientY) || current.target;
        stop();
        dropRef.current?.(current.payload, target, { x: e.clientX, y: e.clientY });
        return;
      }
      stop();
    };
    const cancel = () => stop();
    const key = (e) => { if (e.key === 'Escape') stop(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [stop]);

  /* What a grip spreads onto itself. `payload` is whatever the caller wants
     back on drop; `label` rides along for the thing that follows the pointer. */
  const gripProps = useCallback((payload, label) => ({
    onPointerDown: (e) => {
      if (e.button != null && e.button !== 0) return;
      e.stopPropagation();
      // A finger means it: a grip is not something you scroll or tap by
      // accident, so the drag starts on the first move rather than a hold.
      pending.current = { payload, label, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
    },
    // The grip alone opts out of scrolling, so the rest of the row still scrolls.
    style: { touchAction: 'none' },
  }), []);

  return { drag, gripProps, cancelDrag: stop };
}
