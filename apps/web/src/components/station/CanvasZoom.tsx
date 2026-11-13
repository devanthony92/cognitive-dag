import { useNodesInitialized, useReactFlow, useStore } from '@xyflow/react';
import { useEffect, useLayoutEffect } from 'react';

/**
 * Publishes the zoom of the canvas as `--canvas-zoom` on the React Flow root, so the station labels
 * and the line tags can scale back by `1 / zoom` in CSS and keep their size (The Station Label Rule).
 * It writes through the CSSOM (`setProperty`), which the CSP allows; only this tiny component
 * re-renders while zooming. Render it inside `<ReactFlow>`.
 */
export function CanvasZoom() {
  const zoom = useStore((state) => state.transform[2]);
  const root = useStore((state) => state.domNode);
  useLayoutEffect(() => {
    root?.style.setProperty('--canvas-zoom', String(zoom));
  }, [root, zoom]);
  return null;
}

/**
 * Fits the plan into the view once every station has been measured. The first `fitView` of React Flow
 * can run before the layout and the fonts settle and leave the plan at the minimum zoom; fitting again
 * when the nodes are initialised puts it right. Render it inside `<ReactFlow>`.
 */
export function FitWhenReady() {
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (ready) void fitView({ maxZoom: 1, padding: 0.25 });
  }, [ready, fitView]);
  return null;
}
