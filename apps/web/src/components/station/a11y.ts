import type { AriaLabelConfig } from '@xyflow/react';

/** Names of the outputs of a branching node: the label of its line and of its port. */
export const HANDLE_LABELS: Record<string, string> = {
  true: 'Sí',
  false: 'No',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  timeout: 'Vencido',
};

const DIRECTION: Record<string, string> = {
  up: 'arriba',
  down: 'abajo',
  left: 'la izquierda',
  right: 'la derecha',
};

/**
 * What React Flow says to assistive technology, in Spanish: the description of a focused station or
 * line, the announcement when the arrow keys move a station, and the names of the canvas controls.
 */
export const CANVAS_ARIA_LABELS: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default':
    'Pulsa Intro o Espacio para seleccionar la estación. Seleccionada, Intro abre su configuración, las flechas la mueven y Suprimir la elimina tras confirmar.',
  'node.a11yDescription.keyboardDisabled':
    'Pulsa Intro o Espacio para seleccionar la estación y ver su detalle.',
  'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
    `Estación movida hacia ${DIRECTION[direction] ?? direction}. Nueva posición: x ${x}, y ${y}.`,
  'edge.a11yDescription.default':
    'Pulsa Intro o Espacio para seleccionar la conexión. Seleccionada, Suprimir la elimina tras confirmar.',
  'controls.ariaLabel': 'Controles del lienzo',
  'controls.zoomIn.ariaLabel': 'Acercar',
  'controls.zoomOut.ariaLabel': 'Alejar',
  'controls.fitView.ariaLabel': 'Encajar el plano en la vista',
  'controls.interactive.ariaLabel': 'Bloquear o desbloquear el lienzo',
  'minimap.ariaLabel': 'Minimapa',
  'handle.ariaLabel': 'Puerto',
};
