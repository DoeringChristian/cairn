import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  hideCard,
  loadProjectView,
  showAllCards,
  showCard,
} from "./project-view.ts";
import { storageKeys } from "./storage.ts";

// Minimal localStorage stand-in — the module only ever touches it inside
// its functions, so installing it before the first call is enough.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

test("an unconfigured project hides nothing", () => {
  assert.deepEqual(loadProjectView("p1").hidden, []);
});

test("hiding a card persists it for the project, not the run", () => {
  hideCard("p1", "dataset::");
  assert.deepEqual(loadProjectView("p1").hidden, ["dataset::"]);
  // A different project is untouched.
  assert.deepEqual(loadProjectView("p2").hidden, []);
});

test("hiding is idempotent", () => {
  hideCard("p1", "dataset::");
  hideCard("p1", "dataset::");
  assert.deepEqual(loadProjectView("p1").hidden, ["dataset::"]);
});

test("showing a card adds it back; show-all clears everything", () => {
  hideCard("p1", "dataset::");
  hideCard("p1", "loss::train");
  assert.deepEqual(showCard("p1", "dataset::").hidden, ["loss::train"]);
  assert.deepEqual(showAllCards("p1").hidden, []);
  assert.deepEqual(loadProjectView("p1").hidden, []);
});

test("a corrupt or foreign-version payload degrades to the full view", () => {
  localStorage.setItem(storageKeys.projectView("p1"), '{"version":99,"hidden":["x::"]}');
  assert.deepEqual(loadProjectView("p1").hidden, []);
  localStorage.setItem(storageKeys.projectView("p1"), "not json");
  assert.deepEqual(loadProjectView("p1").hidden, []);
});

test("non-string entries are dropped on load", () => {
  localStorage.setItem(storageKeys.projectView("p1"), '{"version":1,"hidden":["a::",7,null]}');
  assert.deepEqual(loadProjectView("p1").hidden, ["a::"]);
});
