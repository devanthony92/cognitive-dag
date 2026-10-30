import { useEffect, useState } from 'react';
import {
  validateDefinition,
  type DagDefinition,
  type DagLimits,
  type ValidationResult,
} from '@cognitive-dag/dag-schema';

export const VALIDATION_DEBOUNCE_MS = 200;

interface Snapshot {
  definition: DagDefinition;
  limits: DagLimits;
  result: ValidationResult;
}

const run = (definition: DagDefinition, limits: DagLimits): Snapshot => ({
  definition,
  limits,
  result: validateDefinition(definition, { limits }),
});

/**
 * Validates with the same `validateDefinition` the API uses, 200 ms after the last change
 * (research R8). The first result is immediate; until the next one lands, `pending` is true and
 * the previous result stays on screen.
 */
export function useLiveValidation(definition: DagDefinition, limits: DagLimits) {
  const [snapshot, setSnapshot] = useState(() => run(definition, limits));
  const pending = snapshot.definition !== definition || snapshot.limits !== limits;

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setSnapshot(run(definition, limits)), VALIDATION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [definition, limits, pending]);

  return { result: snapshot.result, pending };
}
