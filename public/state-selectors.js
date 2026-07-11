import { WORKFLOWS } from "./workflows.js";

export function normalizeClientState(store) {
  const projects = store.projects || [];
  if (!projects.length) throw new Error("프로젝트 데이터가 없습니다.");
  const jobs = store.jobs || [];
  const invalidJob = jobs.find((job) => !job.id || !job.projectId || !job.chainId || !job.projectType);
  if (invalidJob) throw new Error(`현재 작업 스키마와 맞지 않는 데이터가 있습니다: ${invalidJob.id || "unknown"}`);
  return {
    ...store,
    projects,
    jobs,
    prompts: store.prompts || [],
    slotSets: store.slotSets || [],
    characterRefs: store.characterRefs || [],
    meshExports: store.meshExports || [],
    settings: {
      ...store.settings,
      activeProjectId: store.settings?.activeProjectId || projects[0].id
    }
  };
}

export function getActiveWorkflow(state, selectedWorkflowId = "") {
  return WORKFLOWS.find((item) => item.id === (selectedWorkflowId || state.settings.assetMode)) || WORKFLOWS[0];
}

export function getJobWorkflowId(job) {
  return job?.projectType || "";
}

export function getJobChainId(job) {
  return job?.chainId || "";
}

export function compactLabel(value, fallback = "이름 없는 작업", maxLength = 34) {
  const normalized = String(value || "")
    .replace(/^가져온 이미지:\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return fallback;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export function getJobDisplayName(job) {
  return compactLabel(
    job?.title || job?.name || job?.finalPrompts?.[0] || job?.prompt,
    job?.projectType === "3d-mesh-export" ? "3D 파일 내보내기" : "이름 없는 작업"
  );
}

export function getSelectedJob(jobs, selectedJobId = "") {
  return jobs.find((job) => job.id === selectedJobId) || null;
}

export function getActiveProject(state) {
  return state.projects.find((project) => project.id === state.settings.activeProjectId) || state.projects[0];
}

export function getProjectJobs(state, projectId = getActiveProject(state)?.id) {
  return state.jobs.filter((job) => !projectId || job.projectId === projectId);
}

export function getActiveJob(jobs, selectedJobId = "", workflowId = "") {
  const selected = getSelectedJob(jobs, selectedJobId);
  if (selected) return selected;
  return jobs.find((job) => !workflowId || getJobWorkflowId(job) === workflowId) || jobs[0] || null;
}

export function getProjectJobChains(jobs) {
  const chains = new Map();
  jobs.forEach((job) => {
    const chainId = getJobChainId(job);
    if (!chains.has(chainId)) chains.set(chainId, { id: chainId, jobs: [], latest: job });
    chains.get(chainId).jobs.push(job);
  });
  return [...chains.values()].map((chain) => ({
    ...chain,
    root: chain.jobs[chain.jobs.length - 1],
    title: compactLabel(chain.jobs[chain.jobs.length - 1]?.chainTitle || chain.jobs[chain.jobs.length - 1]?.title || chain.jobs[chain.jobs.length - 1]?.name || chain.jobs[chain.jobs.length - 1]?.finalPrompts?.[0] || chain.jobs[chain.jobs.length - 1]?.prompt, "새 작업 흐름"),
    workflowId: getJobWorkflowId(chain.latest),
    imageCount: chain.jobs.reduce((sum, job) => sum + (job.resultImages?.length || 0), 0)
  }));
}

export function getJobSequence(chain, jobId) {
  const chronological = [...(chain?.jobs || [])].reverse();
  const index = chronological.findIndex((job) => job.id === jobId);
  return index < 0 ? 0 : index + 1;
}

export function getLatestImages(state, viewState = {}) {
  return getActiveJob(getProjectJobs(state), viewState.selectedJobId)?.resultImages || [];
}

export function getCurrentImage(images, selectedImageId = "") {
  if (!images.length) return null;
  return images.find((image) => image.id === selectedImageId) || images[0];
}
