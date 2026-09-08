import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactFormat } from "./artifact-format.ts";

test("artifactFormat maps mimes to cairn-plot format hints", () => {
  assert.equal(artifactFormat("image/x-exr"), "exr");
  assert.equal(artifactFormat("IMAGE/X-EXR"), "exr");
  assert.equal(artifactFormat("image/aces"), "exr");
  assert.equal(artifactFormat("image/openexr"), "exr");
  assert.equal(artifactFormat("application/x-npy"), "npy");
  assert.equal(artifactFormat("application/numpy"), "npy");
  assert.equal(artifactFormat("image/png"), undefined);
  assert.equal(artifactFormat(null), undefined);
});
