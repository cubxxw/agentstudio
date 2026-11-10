import { describe, expect, it } from "vitest";
import { emptyDraft, restoreDraft, settleCreatedDraft } from "../../personal/src/conversation-state";

describe("existing conversation draft recovery", () => {
  const attachments = [{ name: "source.ts", text: "synthetic source", size: 16 }];
  const original = { text: "original request", attachments, mode: "connection", connectionId: "con_saved" };
  const legacy = { ...original, requestId: "request_saved", signature: JSON.stringify(original), memoryIds: ["mem_saved"] };
  const body = { text: original.text, clientId: "request_saved", attachments: [{ name: "source.ts", text: "synthetic source" }], mode: "connection", connectionId: "con_saved", memoryIds: ["mem_saved"] };

  it("reconstructs the exact JSON fingerprint of an unconfirmed historical send", () => {
    const draft = restoreDraft(null, legacy);
    expect(JSON.stringify(draft.pending?.body)).toBe(JSON.stringify(body));
    expect(draft.mode).toBe("connection");
    expect(draft.connectionId).toBe("con_saved");
    expect(draft.attachments).toEqual(attachments);
  });

  it("preserves newer edits separately from the pending original request", () => {
    const draft = restoreDraft(null, { ...legacy, text: "new unsent edit", mode: "local", attachments: [] });
    expect(draft.text).toBe("new unsent edit");
    expect(draft.mode).toBe("local");
    expect(draft.pending?.revision).not.toBe(draft.revision);
    expect(JSON.stringify(draft.pending?.body)).toBe(JSON.stringify(body));
  });

  it("marks an unconfirmed scratch request for its original create endpoint", () => {
    expect(restoreDraft(null, legacy, true).pending?.create).toBe(true);
  });

  it("keeps a saved modern empty draft ahead of the retained legacy backup", () => {
    expect(restoreDraft({ text: "", attachments: [], revision: 2 }, legacy).text).toBe("");
    expect(restoreDraft({ text: "", attachments: [], revision: 2 }, legacy).pending).toBeUndefined();
  });

  it("does not fabricate a pending request from a malformed old signature", () => {
    const draft = restoreDraft(null, { ...legacy, signature: "broken" });
    expect(draft.text).toBe(original.text);
    expect(draft.pending).toBeUndefined();
  });

  it("does not replace an existing destination draft when a creation receipt returns", () => {
    const source = { ...emptyDraft(), text: "later source edit", revision: 2 };
    const target = { ...emptyDraft(), text: "newer destination edit", revision: 7 };
    const result = settleCreatedDraft(source, 1, target, true);
    expect(result.target).toBeNull();
    expect(result.source.text).toBe(source.text);
    expect(target.text).toBe("newer destination edit");
  });

  it("keeps scratch edits at their origin when the user has navigated away", () => {
    const source = { ...emptyDraft(), text: "scratch edit after send", revision: 2 };
    const result = settleCreatedDraft(source, 1, emptyDraft(), false);
    expect(result.source.text).toBe(source.text);
    expect(result.target).toBeNull();
  });
});
