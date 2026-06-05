import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

// Info "i" badge with a portal-rendered tooltip that never gets clipped by
// overflow containers. Tooltip is positioned relative to the icon on hover.
export default function InfoIcon({ children, width = 240 }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Prefer right-aligned under the icon; clamp to viewport
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 6, left });
  }

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 text-gray-400 dark:text-gray-500 text-[9px] font-bold leading-none cursor-help"
      >
        i
      </span>
      {pos && createPortal(
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
          className="z-[9999] bg-gray-900 text-white text-[11px] font-normal normal-case text-left rounded-lg p-2.5 shadow-xl leading-snug pointer-events-none"
        >
          {children}
        </div>,
        document.body
      )}
    </>
  );
}
