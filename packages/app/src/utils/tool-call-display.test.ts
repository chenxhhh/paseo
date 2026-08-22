import { describe, expect, it } from "vitest";

import { buildToolCallDisplayModel } from "./tool-call-display";

describe("tool-call-display", () => {
  it("builds display model from canonical shell detail", () => {
    const display = buildToolCallDisplayModel({
      name: "shell",
      status: "running",
      error: null,
      detail: {
        type: "shell",
        command: "npm test",
      },
    });

    expect(display).toEqual({
      displayName: "Ran",
      summary: "npm test",
    });
  });

  it("builds display model from canonical read detail", () => {
    const display = buildToolCallDisplayModel({
      name: "read_file",
      status: "completed",
      error: null,
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
      },
      cwd: "/tmp/repo",
    });

    expect(display).toEqual({
      displayName: "Read",
      summary: "src/index.ts",
    });
  });

  it("builds display model from canonical edit detail", () => {
    const display = buildToolCallDisplayModel({
      name: "edit",
      status: "completed",
      error: null,
      detail: {
        type: "edit",
        filePath: "/tmp/repo/src/index.ts",
        oldString: "a",
        newString: "b",
      },
      cwd: "/tmp/repo",
    });

    expect(display).toEqual({
      displayName: "Edited",
      summary: "src/index.ts",
    });
  });

  it("builds display model from canonical write detail", () => {
    const display = buildToolCallDisplayModel({
      name: "write",
      status: "completed",
      error: null,
      detail: {
        type: "write",
        filePath: "/tmp/repo/README.md",
        content: "# hi",
      },
      cwd: "/tmp/repo",
    });

    expect(display).toEqual({
      displayName: "Wrote",
      summary: "README.md",
    });
  });

  it("builds display model from canonical search detail", () => {
    const display = buildToolCallDisplayModel({
      name: "search",
      status: "completed",
      error: null,
      detail: {
        type: "search",
        query: "paseo",
      },
    });

    expect(display).toEqual({
      displayName: "Searched",
      summary: "paseo",
    });
  });

  it("builds display model from canonical fetch detail", () => {
    const display = buildToolCallDisplayModel({
      name: "fetch",
      status: "completed",
      error: null,
      detail: {
        type: "fetch",
        url: "https://paseo.sh",
      },
    });

    expect(display).toEqual({
      displayName: "Fetched",
      summary: "https://paseo.sh",
    });
  });

  it("uses sub-agent detail for task label and description", () => {
    const display = buildToolCallDisplayModel({
      name: "task",
      status: "running",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        log: "[Read] README.md",
      },
    });

    expect(display).toEqual({
      displayName: "Explore",
      summary: "Inspect repository structure",
    });
  });

  it("falls back to humanized tool name for unknown tools", () => {
    const display = buildToolCallDisplayModel({
      name: "custom_tool_name",
      status: "completed",
      error: null,
      detail: {
        type: "unknown",
        input: null,
        output: null,
      },
    });

    expect(display).toEqual({
      displayName: "Custom Tool Name",
    });
  });

  it("builds display model from worktree setup detail", () => {
    const display = buildToolCallDisplayModel({
      name: "paseo_worktree_setup",
      status: "running",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath: "/tmp/repo/.paseo/worktrees/repo/branch",
        branchName: "feature-branch",
        log: "==> [1/1] Running: npm install\n",
        commands: [
          {
            index: 1,
            command: "npm install",
            cwd: "/tmp/repo/.paseo/worktrees/repo/branch",
            log: "",
            status: "running",
            exitCode: null,
          },
        ],
      },
    });

    expect(display).toEqual({
      displayName: "Worktree Setup",
      summary: "feature-branch",
    });
  });

  it("does not derive command summary from unknown raw detail", () => {
    const display = buildToolCallDisplayModel({
      name: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: { command: "npm run test" },
        output: null,
      },
    });

    expect(display).toEqual({
      displayName: "Exec Command",
    });
  });

  it("returns formatted errorText from the same display pipeline", () => {
    const display = buildToolCallDisplayModel({
      name: "shell",
      status: "failed",
      error: { message: "boom" },
      detail: {
        type: "unknown",
        input: { command: "false" },
        output: null,
      },
    });

    expect(display.errorText).toBe('{\n  "message": "boom"\n}');
  });

  it("shows terminal interaction with only the fixed label when no command is available", () => {
    const display = buildToolCallDisplayModel({
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        icon: "square_terminal",
      },
    });

    expect(display).toEqual({
      displayName: "Terminal",
    });
  });

  it("shows terminal interaction command as the summary when available", () => {
    const display = buildToolCallDisplayModel({
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        label: "npm run test",
        icon: "square_terminal",
      },
    });

    expect(display).toEqual({
      displayName: "Terminal",
      summary: "npm run test",
    });
  });
});
