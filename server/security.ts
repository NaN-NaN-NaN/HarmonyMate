import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Actor } from "../shared/types.ts";

export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(message, status);
}
export const isActor = (value: unknown): value is Actor =>
  ["alex", "ben", "mom"].includes(String(value));
export class Tokens {
  constructor(readonly secret = randomBytes(32).toString("hex")) {}
  sign(payload: Record<string, unknown>, ttlSeconds: number) {
    const body = Buffer.from(
      JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 }),
    ).toString("base64url");
    return `${body}.${createHmac("sha256", this.secret).update(body).digest("base64url")}`;
  }
  verify(token: string, purpose: string): Record<string, unknown> {
    const [body, sig, extra] = token.split(".");
    assert(
      body && sig && !extra && token.length < 4096,
      "Invalid access token.",
      401,
    );
    const expected = createHmac("sha256", this.secret).update(body).digest();
    const actual = Buffer.from(sig, "base64url");
    assert(
      actual.length === expected.length && timingSafeEqual(actual, expected),
      "Invalid access token.",
      401,
    );
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(Buffer.from(body, "base64url").toString());
    } catch {
      throw new AppError("Invalid access token.", 401);
    }
    assert(
      data.purpose === purpose &&
        typeof data.exp === "number" &&
        data.exp > Date.now(),
      "This access link has expired. Please refresh.",
      401,
    );
    return data;
  }
  actor(token: string, purpose: string): Actor {
    const actor = this.verify(token, purpose).actor;
    assert(isActor(actor), "Invalid identity.", 401);
    return actor;
  }
}
