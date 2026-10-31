import type Valkey from 'iovalkey';
import { and, eq, nodeEffects, sql, type WithContext } from '@cognitive-dag/db';

export interface EffectRef {
  organizationId: string;
  runId: string;
  nodeId: string;
}

export interface EffectState {
  status: 'started' | 'committed';
  /** Times the effect was tried, this one included while it is `started`. */
  attempts: number;
}

export interface EffectStore {
  /** Registers that the effect is about to run, or one more attempt of it. */
  begin(ref: EffectRef): Promise<EffectState>;
  /** Registers that the destination confirmed the effect. */
  commit(ref: EffectRef): Promise<void>;
}

/** The key every attempt of the effect sends to its destination (FR-011). */
export const idempotencyKeyFor = (runId: string, nodeId: string): string => `${runId}:${nodeId}`;

/** The effects table as `app_runtime`, in the context of the organization of the run. */
export function createEffectStore(withContext: WithContext): EffectStore {
  return {
    begin: (ref) =>
      withContext({ organizationId: ref.organizationId }, async (tx) => {
        const key = idempotencyKeyFor(ref.runId, ref.nodeId);
        const written = await tx
          .insert(nodeEffects)
          .values({
            organizationId: ref.organizationId,
            runId: ref.runId,
            nodeId: ref.nodeId,
            idempotencyKey: key,
          })
          .onConflictDoUpdate({
            target: nodeEffects.idempotencyKey,
            set: { attempts: sql`${nodeEffects.attempts} + 1` },
            // A committed effect is not tried again, so it does not count another attempt.
            setWhere: eq(nodeEffects.status, 'started'),
          })
          .returning({ status: nodeEffects.status, attempts: nodeEffects.attempts });
        if (written[0]) return written[0];
        const [existing] = await tx
          .select({ status: nodeEffects.status, attempts: nodeEffects.attempts })
          .from(nodeEffects)
          .where(eq(nodeEffects.idempotencyKey, key));
        return existing as EffectState;
      }),
    commit: (ref) =>
      withContext({ organizationId: ref.organizationId }, async (tx) => {
        await tx
          .update(nodeEffects)
          .set({ status: 'committed', committedAt: sql`now()` })
          .where(
            and(
              eq(nodeEffects.idempotencyKey, idempotencyKeyFor(ref.runId, ref.nodeId)),
              eq(nodeEffects.status, 'started'),
            ),
          );
      }),
  };
}

export interface IdempotentEffect<T> {
  store: EffectStore;
  ref: EffectRef;
  /** Performs the effect, sending the key so the destination can tell repetitions apart. */
  execute(idempotencyKey: string): Promise<T>;
}

export type IdempotentOutcome<T> =
  { replayed: true; attempts: number } | { replayed: false; value: T; attempts: number };

/**
 * The protocol of research R4: register the start, skip an effect that is already confirmed, run
 * it with the key, register the confirmation. A failure between the last two repeats the effect
 * in the next attempt with the same key, so the destination must deduplicate by it.
 */
export async function runIdempotentEffect<T>(
  effect: IdempotentEffect<T>,
): Promise<IdempotentOutcome<T>> {
  const state = await effect.store.begin(effect.ref);
  if (state.status === 'committed') return { replayed: true, attempts: state.attempts };
  const value = await effect.execute(idempotencyKeyFor(effect.ref.runId, effect.ref.nodeId));
  await effect.store.commit(effect.ref);
  return { replayed: false, value, attempts: state.attempts };
}

/** Where the effect of a node lands. Real connectors (F7) have their own; this one is simulated. */
export interface EffectDestination {
  /** Applies the effect of the key; false when the destination had already applied it. */
  register(idempotencyKey: string): Promise<boolean>;
}

const DESTINATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The simulated destination remembers each key in Valkey, so it applies every effect once. */
export function createMockDestination(valkey: Valkey): EffectDestination {
  return {
    async register(idempotencyKey) {
      const created = await valkey.set(
        `mock:effect:${idempotencyKey}`,
        '1',
        'EX',
        DESTINATION_TTL_SECONDS,
        'NX',
      );
      return created === 'OK';
    },
  };
}
