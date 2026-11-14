import { useReactFlow, useStore } from '@xyflow/react';
import { CategorySprite } from './CategorySprite';
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
  return <CategorySprite />;
}

/**
 * Fits the plan once more shortly after it appears, but only when the first `fitView` of React Flow
 * went wrong. That one can run before the layout and the fonts settle and leave the plan at the
 * minimum zoom. One check after the layout settled is enough and costs nothing while the plan is
 * drawn (React Flow's `useNodesInitialized` would walk every node on every store update). A canvas
 * without size (no layout engine) has nothing to fit into. Render it inside `<ReactFlow>`.
 */
export function FitWhenReady({ minZoom }: { minZoom: number }) {
  const { fitView, getZoom } = useReactFlow();
  const sized = useStore((state) => state.width > 0 && state.height > 0);
  useEffect(() => {
    if (!sized) return;
    const timer = setTimeout(() => {
      if (getZoom() <= minZoom + 0.001) void fitView({ maxZoom: 1, padding: 0.25 });
    }, 400);
    return () => clearTimeout(timer);
  }, [sized, fitView, getZoom, minZoom]);
  return null;
}
