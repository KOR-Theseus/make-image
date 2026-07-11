import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { slugify } from "../src/naming.js";
import { buildElementalBlockMesh, buildForestTerrainMesh, exportMeshAsset } from "../src/mesh-exporter.js";

test("slugify creates stable filesystem-safe names", () => {
  assert.equal(slugify("Forest terrain: modular trees + river!"), "forest-terrain-modular-trees-river");
  assert.equal(slugify("파란 토끼 캐릭터"), "파란-토끼-캐릭터");
  assert.equal(slugify("   "), "asset");
});

test("forest terrain exposes separable component groups", () => {
  const mesh = buildForestTerrainMesh("forest terrain river block kit", { meshAssetKind: "forest-terrain", meshTileSize: 24 });
  const groups = mesh.groups();
  assert.ok(groups.includes("terrain_block"));
  assert.ok(groups.includes("river_strip"));
  assert.ok(groups.some((group) => group.startsWith("tree_")));
  assert.match(mesh.toGroupObj(groups.find((group) => group.startsWith("tree_"))), /^o tree_/m);
});

test("elemental block character exposes body part groups", () => {
  const mesh = buildElementalBlockMesh("water elemental block character");
  assert.deepEqual(mesh.groups().sort(), ["body", "head", "left_arm", "left_leg", "right_arm", "right_leg"].sort());
});

test("exportMeshAsset writes prompt slug folder and component files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mesh-export-"));
  try {
    const result = await exportMeshAsset({
      prompt: "forest terrain modular trees rocks river block kit",
      settings: { meshAssetKind: "forest-terrain", meshTileSize: 24 },
      outputDir: root,
      publicUrlForGenerated: (filePath) => `/generated/${path.relative(root, filePath).split(path.sep).join("/")}`
    });
    assert.match(result.id, /forest-terrain-modular-trees-rocks-river-block-kit/);
    assert.ok(result.components.length > 1);
    assert.ok(result.components.some((component) => component.name === "terrain_block"));
    await stat(result.objPath);
    await stat(result.components[0].path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
