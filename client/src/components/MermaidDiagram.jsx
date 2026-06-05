import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: { fontSize: '14px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
});

let counter = 0;

export default function MermaidDiagram({ chart }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !chart) return;
    const id = `mermaid-${++counter}`;
    mermaid
      .render(id, chart)
      .then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg;
      })
      .catch((err) => {
        if (ref.current) ref.current.innerHTML = `<p class="text-sm text-red-500">Diagram error: ${err.message}</p>`;
      });
  }, [chart]);

  return <div ref={ref} className="flex justify-center overflow-x-auto py-2" />;
}
