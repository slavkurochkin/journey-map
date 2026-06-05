import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

export default function ScreenshotGallery({ sessionId, stationId, stations = [], sessionMappings }) {
  // sessionMappings: [{ sessionId, stationId }] provided by aggregate view (read-only)
  // sessionId + stationId: single-session view (full functionality)
  const isAggregate = !!sessionMappings;
  const effectiveMappings = sessionMappings ?? (sessionId ? [{ sessionId, stationId }] : null);

  const [screenshots, setScreenshots] = useState([]); // [{ id, sessionId, source }]
  const [lightbox, setLightbox] = useState(null);
  const [moveMenu, setMoveMenu] = useState(null);
  const [moveMenuPos, setMoveMenuPos] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (effectiveMappings?.length) fetchScreenshots();
  }, [sessionId, stationId, sessionMappings]);

  useEffect(() => {
    if (!moveMenu) return;
    const close = () => setMoveMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [moveMenu]);

  async function fetchScreenshots() {
    const results = await Promise.all(
      effectiveMappings.map(({ sessionId: sid, stationId: stId }) =>
        fetch(`/api/sessions/${sid}/screenshots?stationId=${stId}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((shots) => shots.map((s) => ({ ...s, sessionId: sid })))
      )
    );
    setScreenshots(results.flat());
  }

  function openMoveMenu(e, shotId) {
    e.stopPropagation();
    if (moveMenu === shotId) { setMoveMenu(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setMoveMenuPos({ top: rect.top + window.scrollY, left: rect.left + window.scrollX });
    setMoveMenu(shotId);
  }

  async function handleMove(screenshot, targetStationId) {
    await fetch(`/api/sessions/${screenshot.sessionId}/screenshots/${screenshot.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId: targetStationId }),
    });
    setMoveMenu(null);
    fetchScreenshots();
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      await fetch(`/api/sessions/${sessionId}/screenshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId, dataUrl: ev.target.result }),
      });
      await fetchScreenshots();
      setUploading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const closeLightbox = useCallback(() => setLightbox(null), []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') setLightbox((id) => {
      const idx = screenshots.findIndex((s) => s.id === id);
      return screenshots[idx + 1]?.id ?? id;
    });
    if (e.key === 'ArrowLeft') setLightbox((id) => {
      const idx = screenshots.findIndex((s) => s.id === id);
      return screenshots[idx - 1]?.id ?? id;
    });
  }, [screenshots, closeLightbox]);

  useEffect(() => {
    if (lightbox) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [lightbox, handleKeyDown]);

  if (!effectiveMappings?.length) return null;

  const otherStations = stations.filter((s) => s.id !== stationId);
  const shotUrl = (s) => `/api/sessions/${s.sessionId}/screenshots/${s.id}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Screenshots {screenshots.length > 0 && `(${screenshots.length})`}
        </p>
        {!isAggregate && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs text-emerald-500 hover:text-emerald-700 font-medium disabled:opacity-40 transition-colors"
          >
            {uploading ? 'Uploading…' : '+ Add'}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      </div>

      {screenshots.length === 0 ? (
        <p className="text-xs text-gray-300 italic">No screenshots for this station.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {screenshots.map((shot) => (
            <div key={shot.id} className="relative shrink-0 group" style={{ height: 72 }}>
              <button
                onClick={() => setLightbox(shot.id)}
                className="rounded-lg overflow-hidden border-2 border-transparent hover:border-emerald-400 transition-all focus:outline-none h-full"
              >
                <img
                  src={shotUrl(shot)}
                  alt="station screenshot"
                  className="h-full w-auto object-cover group-hover:scale-105 transition-transform duration-150"
                  style={{ maxWidth: 128 }}
                />
              </button>

              {!isAggregate && otherStations.length > 0 && (
                <button
                  onClick={(e) => openMoveMenu(e, shot.id)}
                  title="Move to another station"
                  className="absolute bottom-1 right-1 bg-black/60 hover:bg-black/80 text-white px-1 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity leading-none"
                >
                  <Icon name="move" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {moveMenu && moveMenuPos && createPortal(
        <div
          style={{ position: 'absolute', top: moveMenuPos.top - 8, left: moveMenuPos.left, transform: 'translateY(-100%)', zIndex: 9999 }}
          className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 min-w-max"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs text-gray-400 dark:text-gray-500 px-3 pt-1 pb-0.5">Move to</p>
          {otherStations.map((s) => {
            const shot = screenshots.find((sc) => sc.id === moveMenu);
            return (
              <button
                key={s.id}
                onClick={() => shot && handleMove(shot, s.id)}
                className="block w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
              >
                {s.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}

      {lightbox && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm" onClick={closeLightbox}>
          <div className="relative max-w-[92vw] max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={shotUrl(screenshots.find((s) => s.id === lightbox) ?? { sessionId, id: lightbox })}
              alt="screenshot full size"
              className="max-w-full max-h-[88vh] object-contain rounded-xl shadow-2xl"
            />
            {screenshots.length > 1 && (
              <>
                <button onClick={() => setLightbox(screenshots[Math.max(0, screenshots.findIndex(s => s.id === lightbox) - 1)].id)} className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-10 text-white/70 hover:text-white text-2xl w-8 text-center">‹</button>
                <button onClick={() => setLightbox(screenshots[Math.min(screenshots.length - 1, screenshots.findIndex(s => s.id === lightbox) + 1)].id)} className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-10 text-white/70 hover:text-white text-2xl w-8 text-center">›</button>
              </>
            )}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full">
              {screenshots.findIndex(s => s.id === lightbox) + 1} / {screenshots.length}
            </div>
          </div>
          <button onClick={closeLightbox} className="absolute top-4 right-5 text-white/60 hover:text-white text-2xl leading-none">×</button>
        </div>,
        document.body
      )}
    </div>
  );
}
