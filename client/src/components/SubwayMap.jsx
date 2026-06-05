import { useEffect, useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import StationNode from './StationNode.jsx';
import { useTheme } from '../theme.jsx';

const elk = new ELK();
const nodeTypes = { station: StationNode };

const NODE_W = 160;
const NODE_H = 64;

async function layoutGraph(stations, edges) {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children: stations.map((s) => ({ id: s.id, width: NODE_W, height: NODE_H })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] })),
  };

  const layout = await elk.layout(graph);

  const flowNodes = stations.map((station) => {
    const n = layout.children.find((c) => c.id === station.id);
    return {
      id: station.id,
      type: 'station',
      position: { x: n?.x ?? 0, y: n?.y ?? 0 },
      data: station,
    };
  });

  const flowEdges = edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#CBD5E1' },
    style: {
      stroke: '#CBD5E1',
      strokeWidth: e.weight != null ? Math.max(1, Math.round(1 + e.weight * 4)) : 2,
    },
    label: e.count > 1 ? `${e.count}×` : undefined,
    labelStyle: { fontSize: 10, fill: '#94A3B8' },
    labelBgStyle: { fill: 'transparent' },
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

export default function SubwayMap({ stations, edges, selectedStation, onStationSelect, lens = null, center = null }) {
  const { dark } = useTheme();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState([]);
  const rfRef = useRef(null);
  const [pulseId, setPulseId] = useState(null);

  useEffect(() => {
    if (!stations?.length) return;
    layoutGraph(stations, edges).then(({ nodes: ln, edges: le }) => {
      setNodes(ln.map((n) => ({ ...n, data: { ...n.data, lens } })));
      setEdges(le);
    });
  }, [stations, edges]);

  // Keep selection + active lens + pulse in sync on the nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({ ...n, selected: n.id === selectedStation?.id, data: { ...n.data, lens, pulse: n.id === pulseId } }))
    );
  }, [selectedStation, lens, pulseId]);

  // Center the viewport on a station when asked to (e.g. jumping from an impact
  // concern) and pulse it briefly so it's obvious which one lit up.
  useEffect(() => {
    if (!center?.id || !rfRef.current) return;
    rfRef.current.fitView({ nodes: [{ id: center.id }], duration: 650, maxZoom: 1.5, padding: 0.6 });
    setPulseId(center.id);
    const t = setTimeout(() => setPulseId(null), 1800);
    return () => clearTimeout(t);
  }, [center?.id, center?.nonce]);

  const onNodeClick = useCallback((_, node) => {
    onStationSelect(node.data);
  }, [onStationSelect]);

  const onPaneClick = useCallback(() => {
    onStationSelect(null);
  }, [onStationSelect]);

  return (
    <div style={{ height: 360, background: dark ? 'linear-gradient(180deg, #0e1118 0%, #0a0c11 100%)' : 'linear-gradient(180deg, #fcfcfd 0%, #f8fafc 100%)' }}>
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onInit={(inst) => { rfRef.current = inst; }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant="dots" color={dark ? '#2a3242' : '#CBD5E1'} gap={22} size={1.5} />
        <Controls showInteractive={false} className="!shadow-soft !rounded-lg overflow-hidden [&_button]:!bg-white dark:[&_button]:!bg-gray-800 [&_button]:!text-gray-600 dark:[&_button]:!text-gray-300 [&_button:hover]:!bg-gray-100 dark:[&_button:hover]:!bg-gray-700" />
      </ReactFlow>
    </div>
  );
}
