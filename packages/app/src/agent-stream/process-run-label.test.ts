import { describe, expect, it } from "vitest";
import type { ProcessRunDigest } from "./process-run-collapse";
import { formatProcessRunLabel } from "./process-run-label";

function t(key: string, options: { count: number }): string {
  if (key === "toolCallGroup.thoughts.other") {
    return `${options.count} thoughts`;
  }
  if (key === "toolCallGroup.readFiles.other") {
    return `read ${options.count} files`;
  }
  if (key === "toolCallGroup.searches.other") {
    return `searched ${options.count} times`;
  }
  if (key === "toolCallGroup.commands.one") {
    return `ran ${options.count} command`;
  }
  return key;
}

function digest(overrides: Partial<ProcessRunDigest>): ProcessRunDigest {
  return {
    firstItemId: "th1",
    thoughtCount: 0,
    toolCountsByCategory: {
      read: 0,
      search: 0,
      edit: 0,
      shell: 0,
      fetch: 0,
      other: 0,
    },
    todoCount: 0,
    ...overrides,
  };
}

describe("formatProcessRunLabel", () => {
  it("joins thought and tool counts in stable order", () => {
    expect(
      formatProcessRunLabel(
        digest({
          thoughtCount: 3,
          toolCountsByCategory: {
            read: 4,
            search: 2,
            edit: 0,
            shell: 1,
            fetch: 0,
            other: 0,
          },
        }),
        t,
      ),
    ).toBe("3 thoughts · read 4 files · searched 2 times · ran 1 command");
  });
});
