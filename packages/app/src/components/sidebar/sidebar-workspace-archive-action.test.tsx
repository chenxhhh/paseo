/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import { SidebarWorkspaceArchiveAction } from "@/components/sidebar/sidebar-workspace-archive-action";

void testI18n;

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => cleanup());

describe("SidebarWorkspaceArchiveAction", () => {
  it("swaps the icon for an inline confirm and archives on confirm", () => {
    const onArchive = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <SidebarWorkspaceArchiveAction workspaceKey="w1" onArchive={onArchive} />,
    );

    fireEvent.click(getByTestId("sidebar-workspace-archive-w1"));

    expect(queryByTestId("sidebar-workspace-archive-w1")).toBeNull();
    expect(getByTestId("sidebar-workspace-archive-confirm-w1")).not.toBeNull();
    expect(onArchive).not.toHaveBeenCalled();

    fireEvent.click(getByTestId("sidebar-workspace-archive-confirm-w1"));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(getByTestId("sidebar-workspace-archive-w1")).not.toBeNull();
  });

  it("returns to the icon without archiving when cancelled", () => {
    const onArchive = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <SidebarWorkspaceArchiveAction workspaceKey="w1" onArchive={onArchive} />,
    );

    fireEvent.click(getByTestId("sidebar-workspace-archive-w1"));
    fireEvent.click(getByTestId("sidebar-workspace-archive-cancel-w1"));

    expect(onArchive).not.toHaveBeenCalled();
    expect(getByTestId("sidebar-workspace-archive-w1")).not.toBeNull();
    expect(queryByTestId("sidebar-workspace-archive-confirm-w1")).toBeNull();
  });

  it("ignores presses while disabled", () => {
    const onArchive = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <SidebarWorkspaceArchiveAction workspaceKey="w1" disabled onArchive={onArchive} />,
    );

    fireEvent.click(getByTestId("sidebar-workspace-archive-w1"));

    expect(queryByTestId("sidebar-workspace-archive-confirm-w1")).toBeNull();
    expect(onArchive).not.toHaveBeenCalled();
  });
});
