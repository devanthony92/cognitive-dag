import { useStore } from '@xyflow/react';
import { useLayoutEffect } from 'react';

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
