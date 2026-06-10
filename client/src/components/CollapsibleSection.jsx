import { useState } from 'react';

// A station-detail section with a collapsible body. The header stays visible
// (title, optional count, optional right-side actions); only the body toggles.
// When `storageKey` is given, the open/closed choice is remembered across reloads.
export default function CollapsibleSection({ title, count = 0, actions, defaultOpen = true, storageKey, children }) {
  const [open, setOpen] = useState(() => {
    if (storageKey && typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(`collapse:${storageKey}`);
      if (v != null) return v === 'open';
    }
    return defaultOpen;
  });

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (storageKey && typeof localStorage !== 'undefined') {
        localStorage.setItem(`collapse:${storageKey}`, next ? 'open' : 'closed');
      }
      return next;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <span className={`text-[9px] leading-none transition-transform ${open ? '' : '-rotate-90'}`}>▼</span>
          {title}
          {count > 0 && <span className="text-gray-300 dark:text-gray-600 normal-case">({count})</span>}
        </button>
        {actions && <div className="flex gap-3 items-center">{actions}</div>}
      </div>
      {open && children}
    </div>
  );
}
