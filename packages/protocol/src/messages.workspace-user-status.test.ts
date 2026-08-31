import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("workspace user-status wire schemas", () => {
  test("keeps the capability optional for old daemons", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-host",
        features: {},
      }).features.workspaceUserStatus,
    ).toBeUndefined();
  });

  test("parses the set request and accepted response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "workspace.user-status.set.request",
        workspaceId: "workspace-1",
        userStatus: "in-progress",
        requestId: "req-1",
      }),
    ).toMatchObject({ type: "workspace.user-status.set.request", userStatus: "in-progress" });

    expect(
      SessionInboundMessageSchema.parse({
        type: "workspace.user-status.set.request",
        workspaceId: "workspace-1",
        userStatus: null,
        requestId: "req-2",
      }),
    ).toMatchObject({ userStatus: null });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "workspace.user-status.set.response",
        payload: {
          requestId: "req-1",
          workspaceId: "workspace-1",
          accepted: true,
          userStatus: "in-progress",
          error: null,
        },
      }),
    ).toMatchObject({
      type: "workspace.user-status.set.response",
      payload: { accepted: true, userStatus: "in-progress" },
    });
  });

  test("carries the assignment on workspace updates and omits it when unassigned", () => {
    const baseWorkspace = {
      id: "workspace-1",
      projectId: "project-1",
      projectDisplayName: "project",
      projectRootPath: "/project",
      projectKind: "git",
      workspaceKind: "worktree",
      name: "feature",
      pinnedAt: null,
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      scripts: [],
      gitRuntime: null,
      githubRuntime: null,
    };

    expect(
      SessionOutboundMessageSchema.parse({
        type: "workspace_update",
        payload: {
          kind: "upsert",
          workspace: {
            ...baseWorkspace,
            userStatus: "in-review",
          },
        },
      }),
    ).toMatchObject({ payload: { workspace: { userStatus: "in-review" } } });

    const unassigned = SessionOutboundMessageSchema.parse({
      type: "workspace_update",
      payload: { kind: "upsert", workspace: baseWorkspace },
    });
    expect(
      unassigned.payload && "workspace" in unassigned.payload
        ? unassigned.payload.workspace?.userStatus
        : "missing workspace",
    ).toBeUndefined();
  });
});
