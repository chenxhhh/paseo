import {
  IDBKeyRange as FakeIDBKeyRange,
  IDBObjectStore as FakeIDBObjectStore,
  indexedDB as fakeIndexedDb,
} from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { runReplicaRowStoreContract } from "./row-store.contract";
import { createIndexedDbReplicaRowStore } from "./row-store.web";

globalThis.indexedDB = fakeIndexedDb;
globalThis.IDBKeyRange = FakeIDBKeyRange;

let databaseSequence = 0;

runReplicaRowStoreContract("IndexedDB", async () => {
  const databaseName = `replica-row-store-test-${databaseSequence++}`;
  return {
    store: createIndexedDbReplicaRowStore({ databaseName, schemaVersion: 1 }),
    async openWithSchemaVersion(schemaVersion) {
      const store = createIndexedDbReplicaRowStore({
        databaseName,
        schemaVersion,
      });
      await store.open();
      return store;
    },
  };
});

it("uses exact IndexedDB keys for targeted rows instead of scanning the host", async () => {
  const store = createIndexedDbReplicaRowStore({
    databaseName: `replica-row-store-targeted-${databaseSequence++}`,
    schemaVersion: 1,
  });
  await store.open();
  await store.apply({
    upserts: [
      { serverId: "server-a", kind: "agent", id: "agent-1", payload: "agent" },
      {
        serverId: "server-a",
        kind: "workspace",
        id: "workspace-1",
        payload: "workspace",
      },
    ],
    deletes: [],
  });
  const get = vi.spyOn(FakeIDBObjectStore.prototype, "get");
  const getAll = vi.spyOn(FakeIDBObjectStore.prototype, "getAll");

  expect(await store.read("server-a", ["agent"], ["agent-1"])).toEqual([
    { serverId: "server-a", kind: "agent", id: "agent-1", payload: "agent" },
  ]);
  expect(get).toHaveBeenCalledWith(["server-a", "agent", "agent-1"]);
  expect(getAll).not.toHaveBeenCalled();

  get.mockRestore();
  getAll.mockRestore();
});

it("ignores corrupt null and malformed rows returned by IndexedDB", async () => {
  const store = createIndexedDbReplicaRowStore({
    databaseName: "replica-corrupt-" + databaseSequence++,
    schemaVersion: 1,
  });
  await store.open();
  const valid = {
    serverId: "s",
    kind: "agent" as const,
    id: "a",
    payload: "{}",
  };
  await store.apply({ upserts: [valid], deletes: [] });
  const original = FakeIDBObjectStore.prototype.getAll;
  const spy = vi.spyOn(FakeIDBObjectStore.prototype, "getAll").mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    const request = original.apply(this, args);
    request.addEventListener("success", () => {
      Object.defineProperty(request, "result", {
        value: [null, {}, ...request.result],
      });
    });
    return request;
  });
  try {
    expect(await store.readAll()).toEqual([{ serverId: "s", rows: [valid] }]);
    expect(await store.read("s", ["agent"])).toEqual([valid]);
  } finally {
    spy.mockRestore();
  }
});
