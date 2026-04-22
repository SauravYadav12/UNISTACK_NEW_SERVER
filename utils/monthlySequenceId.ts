import { CounterModel } from "../models/counterModel";

/**
 * Atomic per-month sequence generator. Returns a zero-padded, prefixed ID like
 * `INV-UNI-202605-03`.
 *
 * Implementation: one `Counter` row per `(scope, key)` bumped with
 * `findOneAndUpdate($inc)` so even two simultaneous requests can't collide.
 * This replaces the naive "sort by createdAt, parse last ID" pattern used by
 * `sequenceId` — necessary for money-carrying IDs.
 */
export async function monthlySequenceId(opts: {
  scope: string;       // e.g. 'invoice'
  key: string;         // e.g. 'UNI-202605'
  prefix: string;      // e.g. 'INV'
  padTo?: number;      // default 2
}): Promise<string> {
  const { scope, key, prefix } = opts;
  const padTo = opts.padTo ?? 2;

  if (!scope || !key || !prefix) {
    throw new Error("monthlySequenceId: scope, key and prefix are required");
  }

  const updated = await CounterModel.findOneAndUpdate(
    { scope, key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).exec();

  const n = updated.seq;
  const padded = n.toString().padStart(padTo, "0");
  return `${prefix}-${key}-${padded}`;
}
