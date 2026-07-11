import test from "node:test";
import assert from "node:assert/strict";
import {
  getActiveJob,
  getActiveProject,
  getActiveWorkflow,
  getCurrentImage,
  getJobChainId,
  getJobDisplayName,
  getJobSequence,
  getJobWorkflowId,
  getProjectJobChains,
  getProjectJobs,
  getSelectedJob,
  normalizeClientState
} from "../public/state-selectors.js";
import { WORKFLOWS } from "../public/workflows.js";

test("keeps project jobs scoped by explicit project id", () => {
  const state = normalizeClientState({
    projects: [
      { id: "project_new", name: "새 프로젝트" },
      { id: "project_default", name: "기본 프로젝트" }
    ],
    jobs: [
      { id: "default_job", projectId: "project_default", projectType: "single-image", chainId: "default_job", resultImages: [] },
      { id: "new_job", projectId: "project_new", projectType: "single-image", chainId: "new_job", resultImages: [] }
    ],
    settings: { activeProjectId: "project_new", assetMode: "single-image" }
  });

  assert.deepEqual(getProjectJobs(state, "project_new").map((job) => job.id), ["new_job"]);
  assert.deepEqual(getProjectJobs(state, "project_default").map((job) => job.id), ["default_job"]);
});

test("groups project jobs into continuation chains", () => {
  const state = normalizeClientState({
    projects: [{ id: "project_a", name: "A" }],
    jobs: [
      { id: "job_3", chainId: "chain_1", projectId: "project_a", projectType: "single-image", resultImages: [{ id: "image_c" }] },
      { id: "job_2", chainId: "chain_1", projectId: "project_a", projectType: "single-image", resultImages: [{ id: "image_b" }] },
      { id: "job_1", chainId: "job_1", projectId: "project_a", projectType: "single-image", resultImages: [{ id: "image_a" }] }
    ],
    settings: { activeProjectId: "project_a", assetMode: "single-image" }
  });
  const jobs = getProjectJobs(state, "project_a");
  const chains = getProjectJobChains(jobs);

  assert.equal(getJobChainId(jobs[2]), "job_1");
  assert.equal(chains.length, 2);
  assert.deepEqual(chains[0].jobs.map((job) => job.id), ["job_3", "job_2"]);
  assert.equal(chains[0].imageCount, 2);
  assert.equal(chains[0].title, "새 작업 흐름");
  assert.equal(getJobSequence(chains[0], "job_2"), 1);
  assert.equal(getJobSequence(chains[0], "job_3"), 2);
});

test("creates readable storage labels from prompts and imported filenames", () => {
  assert.equal(getJobDisplayName({ prompt: "가져온 이미지: character-final.png" }), "character-final.png");
  assert.equal(getJobDisplayName({ finalPrompts: ["파란 망토를 입은 토끼 캐릭터가 숲에서 인사하는 장면을 아주 자세히"] }), "파란 망토를 입은 토끼 캐릭터가 숲에서 인사하는 장면을 아주…");
  assert.equal(getJobDisplayName({ projectType: "3d-mesh-export" }), "3D 파일 내보내기");
});

test("selects active project, workflow, job, and image deterministically", () => {
  const state = normalizeClientState({
    projects: [{ id: "project_a", name: "A" }],
    jobs: [{
      id: "job_a",
      projectId: "project_a",
      projectType: "single-image",
      chainId: "job_a",
      resultImages: [{ id: "image_a" }, { id: "image_b" }]
    }],
    settings: { activeProjectId: "project_a", assetMode: "sprite-sheet" }
  });

  assert.equal(getActiveProject(state).id, "project_a");
  assert.equal(getActiveWorkflow(state).id, "sprite-sheet");
  assert.equal(getActiveWorkflow(state, "region-edit").id, "region-edit");
  assert.equal(WORKFLOWS.some((workflow) => workflow.id === "region-edit"), true);
  assert.equal(getActiveJob(getProjectJobs(state), "missing").id, "job_a");
  assert.equal(getCurrentImage(state.jobs[0].resultImages, "image_b").id, "image_b");
  assert.equal(getCurrentImage(state.jobs[0].resultImages, "missing").id, "image_a");
});

test("keeps completed jobs tied to their original workflow", () => {
  const state = normalizeClientState({
    projects: [{ id: "project_a", name: "A" }],
    jobs: [
      { id: "job_image", projectId: "project_a", projectType: "single-image", chainId: "job_image", resultImages: [] },
      { id: "job_region", projectId: "project_a", projectType: "region-edit", chainId: "job_region", resultImages: [] }
    ],
    settings: { activeProjectId: "project_a", assetMode: "sprite-sheet" }
  });
  const jobs = getProjectJobs(state, "project_a");
  const selected = getSelectedJob(jobs, "job_region");

  assert.equal(getJobWorkflowId(selected), "region-edit");
  assert.equal(getActiveJob(jobs, "", "single-image").id, "job_image");
  assert.equal(getActiveJob(jobs, "job_region", "single-image").id, "job_region");
});


test("shows region-edit in visible workflow tabs", () => {
  const state = normalizeClientState({
    projects: [{ id: "project_a", name: "A" }],
    jobs: [{ id: "job_region", projectId: "project_a", projectType: "region-edit", chainId: "job_region", resultImages: [] }],
    settings: { activeProjectId: "project_a", assetMode: "region-edit" }
  });

  assert.deepEqual(WORKFLOWS.map((workflow) => workflow.id).includes("region-edit"), true);
  assert.equal(getActiveWorkflow(state).id, "region-edit");
  assert.equal(getJobWorkflowId(getSelectedJob(getProjectJobs(state), "job_region")), "region-edit");
});

test("rejects legacy jobs instead of silently adding current fields", () => {
  assert.throws(() => normalizeClientState({
    projects: [{ id: "project_a", name: "A" }],
    jobs: [{ id: "legacy_job", projectId: "project_a", projectType: "codex-cli" }],
    settings: { activeProjectId: "project_a", assetMode: "single-image" }
  }), /현재 작업 스키마/);
});
