import { Injectable } from '@nestjs/common';
import { and, eq, isNull, oneTimeTokens, type Tx } from '@cognitive-dag/db';
import { generateToken, hashToken } from './one-time-token';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class OneTimeTokenService {
  /**
   * Issues a token and consumes the earlier unconsumed ones of the same user and purpose, so only
   * the newest link works (data-model.md). Needs `userId` in the row-level security context.
   * Returns the plain token: it goes into the email and is never stored.
   */
  async issue(
    tx: Tx,
    userId: string,
    purpose: 'email_verification' | 'password_reset',
    ttlMs: number,
  ): Promise<string> {
    await tx
      .update(oneTimeTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(oneTimeTokens.userId, userId),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.consumedAt),
        ),
      );
    const token = generateToken();
    await tx.insert(oneTimeTokens).values({
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }
}
