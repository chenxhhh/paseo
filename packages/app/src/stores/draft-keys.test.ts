import { describe, expect, it } from "vitest";
import {
  buildDraftStoreKey,
  buildNewWorkspaceDraftKey,
  generateDraftId,
  isDraftId,
  NEW_WORKSPACE_DRAFT_KEY,
} from "./draft-keys";

describe("buildDraftStoreKey", () => {
  it("isolates agent drafts by server and agent ids", () => {
    const keyA = buildDraftStoreKey({
      serverId: "server-a",
      agentId: "agent-1",
    });
    const keyB = buildDraftStoreKey({
      serverId: "server-b",
      agentId: "agent-1",
    });
    const keyC = buildDraftStoreKey({
      serverId: "server-a",
      agentId: "agent-2",
    });

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
    expect(keyB).not.toBe(keyC);
  });

  it("uses draftId keyspace for create flow drafts", () => {
    const key = buildDraftStoreKey({
      serverId: "server-a",
      agentId: "__new_agent__",
      draftId: "draft-123",
    });

    expect(key).toBe("draft:server-a:draft-123");
  });
});

describe("isDraftId", () => {
  it("recognizes generated draft tab ids", () => {
    expect(isDraftId(generateDraftId())).toBe(true);
    expect(isDraftId("draft_msg_1786603298040_j3k5p5bp5")).toBe(true);
  });

  it("recognizes new-workspace draft keys", () => {
    expect(isDraftId(NEW_WORKSPACE_DRAFT_KEY)).toBe(true);
    expect(isDraftId(buildNewWorkspaceDraftKey("draft_msg_1_abc"))).toBe(true);
  });

  it("rejects real agent ids", () => {
    expect(isDraftId("0e0b462a-587c-45b9-9868-705029bb14cb")).toBe(false);
    expect(isDraftId("agent-1")).toBe(false);
    expect(isDraftId("")).toBe(false);
  });
});
