// Toggleable chips of station labels — shared by the eval create/edit forms and
// the "Add to evals" flow. `selected` is an array of labels.
export default function StationChips({ stations, selected, onToggle }) {
  if (!stations || stations.length === 0) {
    return <p className="text-xs text-gray-300 italic">No stations — record &amp; save some journeys first.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {stations.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onToggle(s.label)}
          className={`text-xs px-2 py-1 rounded-full border transition-colors ${
            selected.includes(s.label)
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-emerald-300'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
