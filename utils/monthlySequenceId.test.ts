import mongoose from "mongoose";
import { monthlySequenceId } from "./monthlySequenceId";

describe("monthlySequenceId", () => {
  it("starts at 01 and zero-pads", async () => {
    const id = await monthlySequenceId({
      scope: "invoice",
      key: "UNI-202605",
      prefix: "INV",
    });
    expect(id).toBe("INV-UNI-202605-01");
  });

  it("increments on subsequent calls to the same key", async () => {
    const a = await monthlySequenceId({ scope: "invoice", key: "UNI-202605", prefix: "INV" });
    const b = await monthlySequenceId({ scope: "invoice", key: "UNI-202605", prefix: "INV" });
    const c = await monthlySequenceId({ scope: "invoice", key: "UNI-202605", prefix: "INV" });
    expect(a).toBe("INV-UNI-202605-01");
    expect(b).toBe("INV-UNI-202605-02");
    expect(c).toBe("INV-UNI-202605-03");
  });

  it("independent keys have independent counters", async () => {
    const may = await monthlySequenceId({ scope: "invoice", key: "UNI-202605", prefix: "INV" });
    const jun = await monthlySequenceId({ scope: "invoice", key: "UNI-202606", prefix: "INV" });
    const may2 = await monthlySequenceId({ scope: "invoice", key: "UNI-202605", prefix: "INV" });
    expect(may).toBe("INV-UNI-202605-01");
    expect(jun).toBe("INV-UNI-202606-01");
    expect(may2).toBe("INV-UNI-202605-02");
  });

  it("pads to the requested width", async () => {
    const id = await monthlySequenceId({
      scope: "invoice",
      key: "ACM-202605",
      prefix: "INV",
      padTo: 4,
    });
    expect(id).toBe("INV-ACM-202605-0001");
  });

  it("survives concurrent writes without duplicating IDs", async () => {
    // Fire 20 simultaneous increments — every result must be unique.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        monthlySequenceId({ scope: "invoice", key: "CONC-202605", prefix: "INV" })
      )
    );
    expect(new Set(results).size).toBe(20);
    // And they should span 01..20 exactly.
    const seqs = results
      .map((r) => Number(r.split("-").pop()))
      .sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("rejects empty scope/key/prefix", async () => {
    await expect(
      monthlySequenceId({ scope: "", key: "x", prefix: "INV" })
    ).rejects.toThrow();
  });

  // Ensure mongoose gets a clean disconnect even on early failure — the global
  // setup handles the mongo URI, we just keep the connection state sane.
  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      // nothing to do — truncate is handled in tests/setup.ts
    }
  });
});
