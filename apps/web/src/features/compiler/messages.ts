import type { Compilation } from '@cognitive-dag/contracts';

export const STATUS_LABEL: Record<Compilation['status'], string> = {
  queued: 'En cola',
  running: 'Compilando',
  succeeded: 'Listo',
  failed: 'Falló',
};

const BY_CODE: Record<string, string> = {
  COMPILER_INVALID_DAG: 'El modelo no logró un workflow válido tras los intentos de reparación.',
  LLM_CONTENT_BLOCKED:
    'El proveedor bloqueó la solicitud por su contenido. Reformula la descripción e inténtalo de nuevo.',
  LLM_DAILY_BUDGET_EXHAUSTED: 'Se agotó el presupuesto diario de tokens de la organización.',
  COMPILER_BUDGET_EXHAUSTED: 'La compilación superó su tope de tokens.',
  LLM_DISABLED: 'La IA está desactivada en este entorno.',
  SERVICE_UNAVAILABLE: 'No se pudo iniciar la compilación en el motor. Inténtalo de nuevo.',
  ACTIVITY_TIMED_OUT: 'La compilación superó el tiempo máximo permitido.',
};

const BY_CLASS: Record<string, string> = {
  transient: 'Falló de forma pasajera y se agotaron los reintentos.',
  rate_limited: 'Se alcanzó el límite de uso del proveedor y la espera se agotó.',
  timeout: 'La compilación superó el tiempo máximo permitido.',
  permanent: 'La compilación falló y repetirla tal cual no ayuda.',
  invalid_output: 'El modelo no devolvió una salida válida tras los intentos de reparación.',
  budget_exhausted: 'Se agotó el presupuesto de tokens.',
};

/** Spanish text for the reason a compilation failed. */
export function failureMessage(compilation: Pick<Compilation, 'errorCode' | 'errorClass'>): string {
  return (
    (compilation.errorCode ? BY_CODE[compilation.errorCode] : undefined) ??
    (compilation.errorClass ? BY_CLASS[compilation.errorClass] : undefined) ??
    'La compilación falló.'
  );
}
