import type { ErrorClass } from '@cognitive-dag/contracts';

/**
 * The worker records its messages in English (they are logs as much as messages). People read
 * Spanish, so the known codes are translated here; the code itself stays visible next to them.
 */
const BY_CODE: Record<string, string> = {
  MOCK_SERVICE_TRANSIENT:
    'El servicio simulado falló de forma pasajera y se agotaron los reintentos.',
  MOCK_SERVICE_PERMANENT: 'El servicio simulado rechazó la solicitud; repetirla no ayuda.',
  MOCK_SERVICE_RATE_LIMITED: 'El servicio simulado alcanzó su límite de uso.',
  RATE_LIMIT_EXHAUSTED: 'El nodo esperó por el límite de uso más tiempo del permitido.',
  RATE_LIMIT_UNAVAILABLE: 'No se pudo comprobar el límite de uso; se reintentará.',
  EFFECT_STORE_UNAVAILABLE: 'No se pudo registrar el efecto del nodo; se reintentará.',
  DESTINATION_UNAVAILABLE: 'El destino del nodo no está disponible.',
  ACTIVITY_TIMED_OUT: 'El nodo superó el tiempo máximo permitido.',
  ACTIVITY_TIMEOUT: 'El nodo superó el tiempo máximo permitido.',
  RUN_TIMED_OUT: 'La ejecución superó su duración máxima.',
  INVALID_DEFINITION: 'La definición de la versión no es válida.',
  UNSUPPORTED_NODES: 'La versión tiene nodos que todavía no se pueden ejecutar.',
  REFERENCE_MALFORMED: 'Una referencia a la salida de otro nodo está mal formada.',
  INVALID_INPUT: 'Los datos de entrada no cumplen el contrato del motor.',
  INTERNAL_ERROR: 'El nodo falló de forma inesperada.',
};

const BY_CLASS: Record<ErrorClass, string> = {
  transient: 'Falló de forma pasajera y se agotaron los reintentos.',
  rate_limited: 'Se alcanzó un límite de uso y la espera se agotó.',
  timeout: 'Superó el tiempo máximo permitido.',
  permanent: 'Falló y repetirlo no ayuda; revisa la configuración del nodo.',
};

/** Spanish text for an error of a run or a step; the original message only if nothing matches. */
export function errorMessage(error: { code: string; message: string; class?: ErrorClass }): string {
  return BY_CODE[error.code] ?? (error.class ? BY_CLASS[error.class] : undefined) ?? error.message;
}
