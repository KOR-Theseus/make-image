import { api } from "./api-client.js";
import {
  getActiveJob,
  getActiveProject,
  getActiveWorkflow,
  getCurrentImage,
  getJobDisplayName,
  getJobChainId,
  getJobSequence,
  getJobWorkflowId,
  getProjectJobChains,
  getProjectJobs,
  getSelectedJob,
  normalizeClientState
} from "./state-selectors.js";
import { WORKFLOWS, projectLabel } from "./workflows.js";
import { chooseImageFile, readFileAsDataUrl } from "./file-import.js";

const app = document.querySelector("#app");

let state = null;
let promptBody = "";
let preflight = {
  codexInstalled: false,
  codexVersion: "",
  openaiApiKey: false,
  imageAdapter: "codex-cli",
  note: "점검 중"
};
let uiStatus = { busy: false, label: "", error: "" };
let imageEditor = emptyImageEditor();
let selectedWorkflowId = "";
let viewState = {
  projectMenuOpen: false,
  settingsCollapsed: false,
  advancedOpen: false,
  historyOpen: false,
  selectedJobId: "",
  selectedChainId: "",
  continueFromJobId: ""
};

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function extractSlots(prompt) {
  return [...new Set([...prompt.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1].trim()))];
}

function emptyImageEditor(overrides = {}) {
  return { selectedImageId: "", activeRegionId: "", draft: null, referenceImage: null, dragStart: null, ...overrides };
}

function activeWorkflow(lockedJob = getSelectedJob(projectJobs(), viewState.selectedJobId)) {
  return getActiveWorkflow(state, getJobWorkflowId(lockedJob) || selectedWorkflowId);
}

function activeProject() {
  return getActiveProject(state);
}

function projectJobs(projectId = activeProject()?.id) {
  return getProjectJobs(state, projectId);
}

function activeJob(jobs = projectJobs(), selectedJobId = viewState.selectedJobId, workflowId = activeWorkflow().id) {
  return getActiveJob(jobs, selectedJobId, workflowId);
}

function latestImages() {
  return activeJob(projectJobs(), viewState.selectedJobId, activeWorkflow().id)?.resultImages || [];
}

function currentImage(images = latestImages()) {
  return getCurrentImage(images, imageEditor.selectedImageId);
}

function renderFinalPrompt(prompt, index = 0) {
  const byName = new Map(state.slotSets.map((slot) => [slot.name, slot]));
  return prompt.replace(/\{([^{}]+)\}/g, (_, rawName) => {
    const slot = byName.get(rawName.trim());
    if (!slot || slot.keywords.length === 0) return `{${rawName}}`;
    return state.settings.combinationMode === "sequential" ? slot.keywords[index % slot.keywords.length] : slot.keywords[0];
  });
}

function canGenerate() {
  return !uiStatus.busy && promptBody.trim().length > 0 && (
    (preflight.imageAdapter === "openai" && preflight.openaiApiKey) ||
    (preflight.imageAdapter === "codex-cli" && preflight.codexInstalled)
  );
}

function canExport3d() {
  return !uiStatus.busy && promptBody.trim().length > 0;
}

function canEditRegion() {
  const job = activeJob(projectJobs(), viewState.selectedJobId, activeWorkflow().id);
  const image = currentImage(job?.resultImages || latestImages());
  return !uiStatus.busy && Boolean(job && image?.path && (imageEditor.activeRegionId || imageEditor.draft));
}

function settingsForWorkflow(workflowId = activeWorkflow().id) {
  const parentJob = viewState.continueFromJobId ? getSelectedJob(projectJobs(), viewState.continueFromJobId) : null;
  return {
    ...state.settings,
    activeProjectId: activeProject()?.id,
    assetMode: workflowId,
    parentJobId: parentJob?.id || "",
    chainId: parentJob ? getJobChainId(parentJob) : ""
  };
}

function activeJobChain(chains, selectedJob = getSelectedJob(projectJobs(), viewState.selectedJobId)) {
  const selectedChainId = viewState.selectedChainId || getJobChainId(selectedJob);
  return chains.find((chain) => chain.id === selectedChainId) || chains[0] || null;
}

function render() {
  if (!state) {
    app.innerHTML = `<div class="shell"><div class="window"><div class="box">불러오는 중...</div></div></div>`;
    return;
  }

  const project = activeProject();
  const jobs = projectJobs(project.id);
  const selectedJob = getSelectedJob(jobs, viewState.selectedJobId);
  const workflow = activeWorkflow(selectedJob);
  const chains = getProjectJobChains(jobs);
  const chain = activeJobChain(chains, selectedJob);
  const scopedJobs = chain?.jobs || jobs;
  const job = activeJob(scopedJobs, viewState.selectedJobId, workflow.id);
  const images = job?.resultImages || [];
  const selectedImage = currentImage(images);
  if (selectedImage && imageEditor.selectedImageId !== selectedImage.id) imageEditor.selectedImageId = selectedImage.id;

  app.innerHTML = `
    <div class="shell">
      <div class="window">
        ${productionNav(project, workflow)}
        <div class="layout ${viewState.settingsCollapsed ? "settings-collapsed" : ""}">
          ${workspaceSidebar(project, chain)}
          ${mainDashboard(project, workflow, jobs, chains, chain, scopedJobs, images, selectedImage, job)}
          ${viewState.settingsCollapsed ? "" : inspector(workflow)}
        </div>
        ${historyDrawer(project, jobs)}
      </div>
    </div>
  `;
  bindEvents();
}

function productionNav(project, workflow) {
  return `
    <nav class="production-nav">
      <div class="app-identity"><strong>IMAGE STUDIO</strong><span>로컬 제작 대시보드</span></div>
      <div class="mode-tabs">
        ${WORKFLOWS.map((item) => `
          <button class="mode-tab ${item.id === workflow.id ? "active" : ""}" data-workflow="${item.id}">${item.label}</button>
        `).join("")}
      </div>
      <div class="nav-actions">
        <button data-action="toggle-history">작업 이력</button>
        <button class="${viewState.settingsCollapsed ? "" : "active"}" data-action="toggle-settings">설정</button>
      </div>
    </nav>
  `;
}

function workspaceSidebar(activeProjectItem, currentChain) {
  return `
    <aside class="workspace-sidebar" aria-label="프로젝트와 작업 탐색">
      <div class="sidebar-head">
        <div><strong>프로젝트</strong><span>${state.projects.length}개 보관함</span></div>
        <button class="icon-button" data-action="add-project" title="새 프로젝트" aria-label="새 프로젝트">＋</button>
      </div>
      <div class="project-tree">
        ${state.projects.map((project) => {
          const jobs = projectJobs(project.id);
          const chains = getProjectJobChains(jobs);
          const active = project.id === activeProjectItem.id;
          return `
            <section class="tree-project ${active ? "active" : ""}">
              <button class="tree-project-button" data-project-id="${project.id}">
                <span class="tree-chevron">${active ? "▾" : "▸"}</span>
                <span class="tree-project-copy"><strong>${project.name}</strong><em>${projectLabel(project.type)} · ${jobs.length}개 작업</em></span>
                <span class="tree-count">${chains.length}</span>
              </button>
              ${active ? `<div class="tree-chains">
                ${chains.length ? chains.map((chain) => treeChain(chain, currentChain?.id)).join("") : `<div class="tree-empty">아직 작업이 없습니다</div>`}
              </div>` : ""}
            </section>
          `;
        }).join("")}
      </div>
      <div class="sidebar-legend"><span><i class="legend-project"></i>프로젝트</span><span><i class="legend-flow"></i>작업 흐름</span><span><i class="legend-job"></i>작업</span></div>
    </aside>
  `;
}

function treeChain(chain, currentChainId) {
  const active = chain.id === (viewState.selectedChainId || currentChainId);
  return `
    <div class="tree-chain ${active ? "active" : ""}">
      <button class="tree-chain-button" data-chain-id="${chain.id}" title="${chain.title}">
        <span class="tree-line-icon">${active ? "▾" : "▸"}</span>
        <span><strong>${chain.title}</strong><em>${projectLabel(chain.workflowId)} · ${chain.imageCount}개 결과</em></span>
      </button>
      ${active ? `<div class="tree-jobs">${chain.jobs.map((job) => `
        <button class="tree-job ${job.id === (viewState.selectedJobId || chain.latest?.id) ? "active" : ""}" data-job-id="${job.id}" title="${getJobDisplayName(job)}">
          <span class="job-index">${getJobSequence(chain, job.id)}</span>
          <span><strong>${getJobDisplayName(job)}</strong><em>${projectLabel(getJobWorkflowId(job))} · ${formatDate(job.startedAt)}</em></span>
        </button>
      `).join("")}</div>` : ""}
    </div>
  `;
}

function mainDashboard(project, workflow, jobs, chains, currentChain, scopedJobs, images, selectedImage, currentJob) {
  const meshExports = (state.meshExports || []).filter((item) => !item.projectId || item.projectId === project.id);
  const slots = extractSlots(promptBody);
  const showImageResults = workflow.id !== "3d-mesh-export";
  const regionMode = workflow.id === "region-edit";
  return `
    <main class="main dashboard-main">
      ${projectStatusLine(project, workflow, jobs, currentJob)}

      <section class="section workbench ${regionMode ? "workbench-compact" : ""}">
        <div class="editor-head">
          <div><h2 class="section-title">${workflow.title}${regionMode ? "하기" : " 만들기"}</h2><div class="muted">${regionMode ? "이미지를 선택하고 수정할 영역을 드래그하세요" : promptBody.trim() ? "프롬프트 준비됨" : "프롬프트를 입력하세요"}</div></div>
          <div class="toolbar">
            ${regionMode ? "" : `<button data-action="save-prompt">저장</button><button data-action="library">불러오기</button>`}
            ${currentJob && !regionMode ? `<button class="${viewState.continueFromJobId ? "active" : ""}" data-action="continue-job">${viewState.continueFromJobId ? "이어 작업 해제" : "이 작업에 이어서"}</button>` : ""}
            ${primaryAction(workflow)}
          </div>
        </div>
        ${continuationNotice(currentJob, currentChain)}
        ${regionMode ? `<div class="region-workbench-note">결과 썸네일을 고르거나 이미지를 가져온 뒤, 아래 편집판에서 영역을 지정하고 요청을 실행하세요.</div>` : `<textarea id="promptInput" placeholder="만들고 싶은 이미지를 입력하세요. 예: 같은 캐릭터가 점프, 공격, 대기하는 2D 스프라이트">${promptBody}</textarea>`}
        ${regionMode ? "" : slotToolbar(slots)}
        ${regionMode ? "" : characterReferenceBar()}
        ${statusPanel()}
        ${!regionMode && slots.length ? `<details class="prompt-preview"><summary>최종 프롬프트 미리보기</summary><div class="preview">${promptBody.trim() ? renderFinalPrompt(promptBody) : "슬롯을 쓰면 최종 프롬프트가 여기에 표시됩니다."}</div></details>` : ""}
      </section>

      ${showImageResults ? imageResultsSection(workflow, images, selectedImage, currentJob) : ""}
      ${workflow.id === "3d-mesh-export" ? meshExportSection(meshExports) : ""}

    </main>
  `;
}

function imageResultsSection(workflow, images, selectedImage, currentJob) {
  const regionMode = workflow.id === "region-edit";
  return `
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">결과</h2>
        <div class="toolbar">
          ${resultActions(workflow, images)}
          <span class="badge">${images.length}개 파일</span>
        </div>
      </div>
      ${regionMode ? regionEditorPanel(selectedImage) : ""}
      <div class="output-grid">
        ${images.length ? images.map((image) => imageTile(image)).join("") : emptyTiles()}
      </div>
      ${selectedImage ? selectedImageActions(selectedImage, workflow) : ""}
      ${workflow.id === "kakao-emoticon-gif" ? downloadLinks(currentJob) : ""}
    </section>
  `;
}

function meshExportSection(meshExports) {
  return `
    <section class="section">
      <div class="section-header"><h2 class="section-title">3D 파일</h2><span class="badge">${meshExports.length} exports</span></div>
      <div class="file-list">${meshExports.length ? meshExports.slice(0, 5).map(meshRow).join("") : `<div class="box muted">아직 내보낸 3D 파일이 없습니다. 프롬프트를 입력하고 3D 파일 export를 실행하세요.</div>`}</div>
    </section>
  `;
}

function projectStatusLine(project, workflow, jobs, currentJob) {
  const latest = jobs[0];
  const imageCount = jobs.reduce((sum, job) => sum + (job.resultImages?.length || 0), 0);
  return `
    <section class="status-strip">
      <strong>${project.name}</strong>
      <span>마지막 실행 ${latest ? formatDate(latest.startedAt) : "없음"}</span>
      <span>${workflow.label}</span>
      <span>${currentJob ? `${projectLabel(getJobWorkflowId(currentJob))} 작업 로드됨 ${formatDate(currentJob.startedAt)}` : "로드된 작업 없음"}</span>
      <span>이미지 ${imageCount}</span>
    </section>
  `;
}

function projectWorkNavigator(chains, currentChain, jobs, currentJob) {
  return `
    <section class="work-flow-panel" aria-label="프로젝트 작업 흐름">
      <div class="flow-switcher">
        ${chains.length ? chains.map((chain, index) => `
          <button class="flow-chip ${chain.id === currentChain?.id ? "active" : ""}" data-chain-id="${chain.id}" title="작업 흐름 선택">
            <strong>흐름 ${index + 1}</strong>
            <span>${chain.jobs.length}개 작업 · ${chain.imageCount}개 결과</span>
          </button>
        `).join("") : `<div class="box muted">이 프로젝트에서 만든 작업 흐름이 아직 없습니다.</div>`}
      </div>
      ${currentChain ? `
        <div class="job-switcher" aria-label="작업 선택">
          ${jobs.map((job) => `
            <button class="job-chip ${job.id === currentJob?.id ? "active" : ""}" data-job-id="${job.id}" title="${projectLabel(getJobWorkflowId(job))} 작업 로드">
              <strong>${projectLabel(getJobWorkflowId(job))}</strong>
              <span>${formatDate(job.startedAt)} · ${job.resultImages?.length || 0}개</span>
            </button>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function slotToolbar(slots) {
  if (!state.slotSets.length) return "";
  return `
    <div class="slot-toolbar">
      <span class="muted">슬롯 ${slots.length ? slots.join(", ") : "미사용"}</span>
      <div>
        ${state.slotSets.map((slot) => `<button data-slot="${slot.name}" title="프롬프트에 {${slot.name}} 삽입">{${slot.name}}</button>`).join("")}
      </div>
    </div>
  `;
}

function resultActions(workflow, images) {
  if (workflow.id === "sprite-sheet") {
    return `<button data-action="slice-latest" ${images.length ? "" : "disabled"}>프레임 분리</button>`;
  }
  if (workflow.id === "kakao-emoticon-gif") {
    return `<button data-action="make-gif" ${images.length ? "" : "disabled"}>GIF</button><button data-action="make-video" ${images.length ? "" : "disabled"}>컷 영상</button>`;
  }
  return "";
}

function continuationNotice(currentJob, currentChain) {
  if (!viewState.continueFromJobId || !currentJob || !currentChain) return "";
  return `<div class="continuation-notice"><strong>${currentChain.title}</strong><span>작업 ${getJobSequence(currentChain, currentJob.id)} 다음 번호로 저장됩니다.</span></div>`;
}

function flowCard(chain) {
  const image = chain.latest?.resultImages?.[0];
  return `
    <button class="history-card" data-chain-id="${chain.id}" title="작업 흐름 로드">
      <div class="history-thumb">${image ? `<img src="${image.url}" alt="${image.prompt}">` : `<span>${chain.jobs.length}</span>`}</div>
      <div>
        <strong>${chain.title} · ${chain.jobs.length}개 작업</strong>
        <p class="truncate">${chain.latest?.finalPrompts?.[0] || "작업 흐름"}</p>
        <span>${formatDate(chain.latest?.startedAt)} · ${projectLabel(getJobWorkflowId(chain.latest))}</span>
      </div>
    </button>
  `;
}

function primaryAction(workflow) {
  if (workflow.id === "3d-mesh-export") {
    return `<button class="primary" data-action="export-3d" ${canExport3d() ? "" : "disabled"}>${uiStatus.busy && uiStatus.label === "3D 파일 export 중" ? "export 중..." : "3D 파일 export"}</button>`;
  }
  if (workflow.id === "region-edit") {
    const label = latestImages().length ? "영역 편집 시작" : "이미지 가져오기";
    return `<button class="primary" data-action="${latestImages().length ? "focus-region" : "import-image"}" ${uiStatus.busy ? "disabled" : ""}>${uiStatus.busy && uiStatus.label === "영역 편집 중" ? "편집 중..." : label}</button>`;
  }
  return `<button class="primary" data-action="generate" ${canGenerate() ? "" : "disabled"}>${uiStatus.busy && uiStatus.label === "이미지 생성 중" ? "생성 중..." : "생성"}</button>`;
}

function imageTile(image) {
  return `
    <figure class="tile ${image.id === imageEditor.selectedImageId ? "tile-selected" : ""}" data-select-image="${image.id}">
      <img src="${image.url}" alt="${image.prompt}">
      <figcaption class="status">${image.sourceRegionId ? "수정본" : "완료"}</figcaption>
    </figure>
  `;
}

function emptyTiles() {
  const labels = ["프롬프트", "생성", "검토", "저장"];
  const message = "프로젝트 결과가 여기에 표시됩니다.";
  return labels.map((label) => `
    <div class="tile tile-empty">${label}<br>${message}</div>
  `).join("");
}

function characterReferenceBar() {
  const active = state.characterRefs.find((ref) => ref.id === state.settings.activeCharacterRefId) || null;
  const enabled = Boolean(state.settings.useCharacterRef && active);
  const nextStep = active
    ? "다음 생성부터 같은 얼굴, 의상, 비율을 유지하려면 기준 유지를 켜고 생성하세요."
    : "결과 이미지에서 ‘캐릭터로 저장’을 눌러 먼저 기준 캐릭터를 만들어 주세요.";
  return `
    <div class="character-reference-card ${enabled ? "active" : ""}">
      <div class="character-reference-copy">
        <strong>${active ? `선택된 캐릭터: ${active.title}` : "아직 저장된 캐릭터가 없습니다"}</strong>
        <span>${enabled ? "캐릭터 기준 사용 중" : active ? "캐릭터 기준 꺼짐" : "생성 결과를 기준 캐릭터로 저장할 수 있습니다"}</span>
        <p>${nextStep}</p>
      </div>
      ${active ? `<div class="character-reference-preview"><img src="${active.imageUrl}" alt="${active.title}"><span>${active.lock || "same character"}</span></div>` : ""}
      <div class="character-reference-actions">
        ${selectField("기준 캐릭터", "activeCharacterRefId", state.settings.activeCharacterRefId || "", [["", "선택 안 함"], ...state.characterRefs.map((ref) => [ref.id, ref.title])])}
        ${selectField("기준 유지", "useCharacterRef", String(state.settings.useCharacterRef ?? false), [["false", "꺼짐"], ["true", "켜짐"]])}
      </div>
    </div>
  `;
}

function selectedImageActions(image, workflow = activeWorkflow()) {
  if (workflow.id === "region-edit") return "";
  return `
    <div class="selected-image-actions">
      <div><strong>선택한 결과를 캐릭터 기준으로 재사용</strong><span>재생성 없이 이 이미지를 저장하고 다음 생성에 바로 적용합니다.</span></div>
      <button data-action="save-character-from-image" ${image.path ? "" : "disabled"}>캐릭터로 저장</button>
    </div>
  `;
}


function regionEditorPanel(image) {
  if (!image) return `<div class="region-editor"><div class="box muted">결과 이미지를 선택하거나 이미지 가져오기로 영역 편집을 시작할 수 있습니다.</div><div><button data-action="import-image">이미지 가져오기</button></div></div>`;
  const regions = image.regions || [];
  const activeRegion = regions.find((region) => region.id === imageEditor.activeRegionId) || regions[0] || null;
  const draft = imageEditor.draft;
  const history = image.editHistory || [];
  return `
    <div class="region-editor">
      <div class="region-steps" aria-label="영역 편집 단계">
        <span>1 이미지 선택</span><span>2 영역 드래그</span><span>3 요청 작성</span><span>4 편집 실행</span>
      </div>
      <div class="region-stage">
        <div class="region-progress"><strong>${image.prompt || "선택 이미지"}</strong><span class="region-state ${activeRegion?.status || ""}">${regionStatusLabel(activeRegion?.status)}</span></div>
        <div class="region-canvas" data-region-canvas>
          <img src="${image.url}" alt="${image.prompt || "영역 편집 이미지"}">
          ${regions.map((region, index) => regionBox(region, index + 1, region.id === imageEditor.activeRegionId)).join("")}
          ${draft ? regionBox({ ...draft, id: "draft" }, "새", true, true) : ""}
        </div>
        <div class="region-guide"><strong>드래그해서 수정할 구역을 지정하세요.</strong><span>저장된 영역을 선택하거나 새 영역을 그린 뒤 편집 요청을 실행합니다.</span></div>
      </div>
      <div class="region-side">
        <div class="field"><label for="regionRequest">편집 요청</label><textarea id="regionRequest" data-region-request style="min-height:104px" placeholder="예: 선택 영역의 로고만 지우고 배경 질감을 자연스럽게 이어 주세요">${activeRegion?.orderText || promptBody}</textarea></div>
        ${referenceDrop()}
        <div class="toolbar">
          <button data-action="save-region" ${canEditRegion() ? "" : "disabled"}>편집 실행</button>
          <button data-action="import-image">이미지 가져오기</button>
          <button data-action="clear-region-draft" ${draft ? "" : "disabled"}>초안 지우기</button>
          <button data-action="delete-region" ${activeRegion ? "" : "disabled"}>영역 삭제</button>
        </div>
        <div class="region-list">${regions.length ? regions.map((region, index) => regionListItem(region, index + 1)).join("") : `<div class="box muted">이미지를 드래그해서 수정할 구역을 지정하세요.</div>`}</div>
        <div class="history-mini">${history.length ? history.map(historyMiniRow).join("") : `<div class="box muted">아직 영역 편집 이력이 없습니다.</div>`}</div>
      </div>
    </div>
  `;
}

function regionBox(region, label, active, draft = false) {
  return `<button class="region-box ${active ? "active" : ""} ${draft ? "draft" : ""}" data-region-id="${region.id}" style="left:${region.x}%; top:${region.y}%; width:${region.width}%; height:${region.height}%"><span>${label}</span></button>`;
}

function regionListItem(region, index) {
  return `<button class="region-item ${region.id === imageEditor.activeRegionId ? "active" : ""}" data-region-id="${region.id}"><span class="region-state ${region.status || ""}">${regionStatusLabel(region.status)}</span><div><strong>영역 ${index}</strong><span>${Math.round(region.width)}×${Math.round(region.height)}% · ${region.model || "편집 대기"}</span></div></button>`;
}

function historyMiniRow(item) {
  const clickable = item.resultImageId ? "clickable" : "";
  return `<button class="history-mini-row ${clickable}" ${item.resultImageId ? `data-history-image-id="${item.resultImageId}"` : "disabled"}><strong>${item.action || "편집 이력"}</strong><span class="region-state ${item.status || ""}">${regionStatusLabel(item.status)}</span><span class="truncate">${item.note || item.model || formatDate(item.createdAt)}</span></button>`;
}

function referenceDrop() {
  const reference = imageEditor.referenceImage;
  return `<div class="reference-drop ${reference ? "has-image" : ""}" data-reference-drop>
    ${reference ? `<img src="${reference.dataUrl}" alt="참조 이미지">` : ""}
    <div><strong>${reference ? "참조 이미지 선택됨" : "참조 이미지 선택/붙여넣기"}</strong><span>${reference?.name || "선택 영역에만 적용할 이미지를 선택하거나 클립보드 이미지를 붙여넣으세요."}</span></div>
    <div class="toolbar"><button data-action="pick-reference-image">선택</button><button data-action="clear-reference-image" ${reference ? "" : "disabled"}>지우기</button></div>
  </div>`;
}

function regionStatusLabel(status) {
  return { queued: "작업 대기", editing: "편집 중", ordered: "작업 대기", done: "완료", failed: "실패" }[status] || "대기";
}

function downloadLinks(job) {
  return `
    ${job?.gifs?.length ? `<div class="gif-list">${job.gifs.map((gif) => `<a class="gif-link" href="${gif.url}" download>GIF ${gif.frameCount} frames · ${(gif.sizeBytes / 1024).toFixed(0)} KB</a>`).join("")}</div>` : ""}
    ${job?.videos?.length ? `<div class="gif-list">${job.videos.map((video) => `<a class="gif-link" href="${video.url}" download>MP4 ${video.frameCount} cuts · ${(video.sizeBytes / 1024).toFixed(0)} KB</a>`).join("")}</div>` : ""}
  `;
}

function meshRow(item) {
  return `
    <div class="file-row">
      <strong>${item.kind}</strong><a href="${item.objUrl}" download>OBJ</a><a href="${item.mtlUrl}" download>MTL</a>
      <span class="muted">OBJ 전용</span><span class="truncate">${item.id} · ${item.components?.length || 0}개 component · ${item.note}</span>
    </div>
  `;
}

function inspector(workflow) {
  const adapterLabel = preflight.imageAdapter === "codex-cli" ? "Codex CLI" : "OpenAI";
  const apiKeyLabel = preflight.openaiApiKey ? "감지됨" : "필요";
  const promptOk = promptBody.trim() ? "입력됨" : "필요";
  return `
    <aside class="inspector">
      <section class="section">
        <div class="section-header"><h2 class="section-title">설정</h2></div>
        <div class="stack">
          <div class="split">${numberField("생성 수", "count", state.settings.count, 1, ["kakao-emoticon-static", "kakao-emoticon-gif"].includes(workflow.id) ? 32 : 12)}${numberField("동시 생성", "concurrency", state.settings.concurrency, 1, 12)}</div>
          ${field("해상도", "resolution", state.settings.resolution)}
        </div>
      </section>

      <details class="section settings-details" ${viewState.advancedOpen ? "open" : ""}>
        <summary data-action="toggle-advanced">고급 설정</summary>
        <div class="stack">
          ${workflowSettings(workflow)}
          ${field("이미지 모델", "imageModel", state.settings.imageModel)}
          ${field("Codex 모델", "codexModel", state.settings.codexModel)}
          ${selectField("조합 방식", "combinationMode", state.settings.combinationMode, [["random", "랜덤"], ["sequential", "순차"]])}
          <div class="split">${numberField("재시도", "retries", state.settings.retries, 0, 5)}${field("배경", "background", state.settings.background)}</div>
          <button data-action="make-character">기준 캐릭터 생성</button>
        </div>
      </details>

      <details class="section settings-details">
        <summary>연결 상태</summary>
        <div class="box">
          ${checkRow("이미지 생성", adapterLabel, "ok")}
          ${checkRow("OPENAI_API_KEY", apiKeyLabel, preflight.imageAdapter === "openai" ? (preflight.openaiApiKey ? "ok" : "fail") : "warn")}
          ${checkRow("Codex CLI", preflight.codexInstalled ? "준비됨" : "확인 필요", preflight.codexInstalled ? "ok" : "warn")}
          ${checkRow("프롬프트", promptOk, promptBody.trim() ? "ok" : "fail")}
        </div>
      </details>
    </aside>
  `;
}

function historyDrawer(project, jobs) {
  if (!viewState.historyOpen) return "";
  const chains = getProjectJobChains(jobs);
  return `
    <div class="drawer-backdrop" data-action="toggle-history"></div>
    <aside class="history-drawer">
      <div class="section-header">
        <div><h2 class="section-title">프로젝트 작업</h2><div class="muted">${project.name}에서 만들어진 결과</div></div>
        <button class="icon-button" data-action="toggle-history" title="작업 이력 닫기" aria-label="작업 이력 닫기">×</button>
      </div>
      <div class="history-filters">
        <button class="active">전체</button>
        <button>${projectLabel(state.settings.assetMode)}</button>
        <button>이미지</button>
        <button>3D</button>
      </div>
      <div class="history-cards">
        ${chains.length ? chains.map(historyChain).join("") : `<div class="box muted">이 프로젝트에서 만든 결과가 아직 없습니다.</div>`}
      </div>
    </aside>
  `;
}

function historyChain(chain) {
  return `
    <div class="history-chain">
      ${flowCard(chain)}
      <div class="history-chain-jobs">
        ${chain.jobs.map(historyCard).join("")}
      </div>
    </div>
  `;
}

function historyCard(job) {
  const image = job.resultImages?.[0];
  return `
    <button class="history-card ${job.id === viewState.selectedJobId ? "active" : ""}" data-job-id="${job.id}" title="이 작업 결과 로드">
      <div class="history-thumb">${image ? `<img src="${image.url}" alt="${image.prompt}">` : `<span>OBJ</span>`}</div>
      <div>
        <strong>${getJobDisplayName(job)}</strong>
        <p class="truncate">${job.finalPrompts?.[0] || "3D export"}</p>
        <span>${formatDate(job.startedAt)} · ${job.id === viewState.selectedJobId ? "로드됨" : job.status}</span>
      </div>
    </button>
  `;
}

function workflowSettings(workflow) {
  return [staticEmoticonControls(workflow.id), gifControls(workflow.id), spriteControls(workflow.id), threeDControls(workflow.id), meshControls(workflow.id)].filter(Boolean).join("");
}

function field(label, name, value) {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" data-setting="${name}" value="${value ?? ""}"></div>`;
}

function numberField(label, name, value, min, max) {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" data-setting="${name}" type="number" min="${min}" max="${max}" value="${value ?? ""}"></div>`;
}

function colorField(label, name, value) {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" data-setting="${name}" type="color" value="${value || "#1d4ed8"}"></div>`;
}

function selectField(label, name, value, options) {
  return `<div class="field"><label for="${name}">${label}</label><select id="${name}" data-setting="${name}">
    ${options.map(([key, labelText]) => `<option value="${key}" ${String(value) === String(key) ? "selected" : ""}>${labelText}</option>`).join("")}
  </select></div>`;
}

function statusPanel() {
  if (!uiStatus.busy && !uiStatus.error) return "";
  return `<div class="${uiStatus.error ? "status-panel error-panel" : "status-panel"}">${uiStatus.error || uiStatus.label}</div>`;
}

function spriteControls(workflowId) {
  if (workflowId !== "sprite-sheet") return "";
  return `
    <div class="box stack">
      ${field("방향 순서", "spriteDirections", state.settings.spriteDirections || "S, SW, W, NW, N, NE, E, SE")}
      ${field("동작 행", "spriteActions", state.settings.spriteActions || "idle, walk, attack, death")}
      ${numberField("프레임 수", "spriteFrames", state.settings.spriteFrames || 4, 1, 12)}
      ${characterLockField()}
    </div>
  `;
}

function kakaoTextControls() {
  const textEnabled = state.settings.emoticonIncludeText ?? true;
  return `
    ${selectField("한글 문구", "emoticonIncludeText", String(textEnabled), [["true", "포함"], ["false", "없음"]])}
    ${textEnabled ? `
      <div class="split">
        ${selectField("문구 방식", "emoticonTextMode", state.settings.emoticonTextMode || "overlay", [["overlay", "앱 고정 스타일"], ["model", "이미지 모델"]])}
        ${colorField("문구 색상", "emoticonTextColor", state.settings.emoticonTextColor || "#1d4ed8")}
      </div>
    ` : ""}
  `;
}

function staticEmoticonControls(workflowId) {
  if (workflowId !== "kakao-emoticon-static") return "";
  return `
    <div class="box stack">
      ${kakaoTextControls()}
      <div class="field"><label for="emoticonExpressions">32종 문구 목록</label><textarea id="emoticonExpressions" data-setting="emoticonExpressions" style="min-height:118px" placeholder="예: 안녕, 고마워, 좋아!">${state.settings.emoticonExpressions || "안녕, 고마워, 좋아!"}</textarea></div>
      ${characterLockField()}
    </div>
  `;
}

function gifControls(workflowId) {
  if (workflowId !== "kakao-emoticon-gif") return "";
  return `
    <div class="box stack">
      ${selectField("컷 구성", "gifCutPreset", String(state.settings.gifCutPreset || 4), [["3", "3컷"], ["4", "4컷"], ["8", "8프레임"]])}
      ${selectField("프레임 생성 방식", "gifFrameStrategy", state.settings.gifFrameStrategy || "separate", [["sheet", "한 장 시퀀스"], ["separate", "개별 프레임"]])}
      ${kakaoTextControls()}
      ${numberField("프레임 지연", "gifFrameDelay", state.settings.gifFrameDelay || 12, 4, 80)}
      ${numberField("컷당 초", "revealVideoSeconds", state.settings.revealVideoSeconds || 1.2, 0.4, 5)}
      <div class="field"><label for="emoticonExpressions">프레임/문구 목록</label><textarea id="emoticonExpressions" data-setting="emoticonExpressions" style="min-height:118px" placeholder="예: 안녕 또는 안녕|손을 크게 흔들기">${state.settings.emoticonExpressions || "안녕"}</textarea></div>
      ${characterLockField()}
    </div>
  `;
}

function threeDControls(workflowId) {
  if (!["3d-production-sheet", "3d-animation-sequence"].includes(workflowId)) return "";
  return `
    <div class="box stack">
      ${field("목표 포맷", "threeDTargetFormat", state.settings.threeDTargetFormat || "OBJ")}
      ${field("3D 스타일", "threeDStyle", state.settings.threeDStyle || "stylized game character, clean topology-friendly forms, readable silhouette")}
      ${field("턴어라운드 뷰", "threeDViews", state.settings.threeDViews || "front, left side, back, right side, 3/4 front, 3/4 back")}
      ${characterLockField()}
    </div>
  `;
}

function meshControls(workflowId) {
  if (workflowId !== "3d-mesh-export") return "";
  return `
    <div class="box stack">
      ${selectField("3D 파일 종류", "meshAssetKind", state.settings.meshAssetKind || "forest-terrain", [["forest-terrain", "Forest terrain block"], ["elemental-block-character", "Elemental block character"]])}
      ${numberField("타일 크기", "meshTileSize", state.settings.meshTileSize || 24, 8, 48)}
    </div>
  `;
}

function characterLockField() {
  return `<div class="field"><label for="characterLock">캐릭터 고정 설명</label><textarea id="characterLock" data-setting="characterLock" style="min-height:76px" placeholder="같은 얼굴, 같은 의상, 같은 비율">${state.settings.characterLock || "same character, same costume, same proportions, same silhouette, same palette"}</textarea></div>`;
}

export function characterRefPanel() {
  const active = state.characterRefs.find((ref) => ref.id === state.settings.activeCharacterRefId) || state.characterRefs[0];
  if (!active) return `<div class="box muted">아직 기준 캐릭터가 없습니다.</div>`;
  return `
    <div class="box">
      <div class="tile" style="width:100%; aspect-ratio:1; margin-bottom:8px"><img src="${active.imageUrl}" alt="${active.title}"><span class="status">기준</span></div>
      <strong style="font-size:13px">${active.title}</strong><div class="muted truncate">${active.prompt}</div>
    </div>
  `;
}

function checkRow(label, value, status) {
  const text = status === "ok" ? "통과" : status === "warn" ? "주의" : "실패";
  return `<div class="check"><span>${label}</span><span class="${status}">${text} · ${value}</span></div>`;
}

function bindEvents() {
  document.querySelector("#promptInput")?.addEventListener("input", (event) => {
    promptBody = event.target.value;
    render();
    document.querySelector("#promptInput")?.focus();
  });

  document.querySelectorAll("[data-setting]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const key = event.target.dataset.setting;
      const value = event.target.type === "number"
        ? Number(event.target.value)
        : event.target.value === "true"
          ? true
          : event.target.value === "false"
            ? false
            : event.target.value;
      state.settings[key] = value;
      if (key === "assetMode") {
        selectedWorkflowId = value;
        updateActiveProjectType(value);
      }
      state = normalizeClientState(await api.post("/api/state", state));
      render();
    });
  });

  document.querySelectorAll("[data-project-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.settings.activeProjectId = button.dataset.projectId;
      viewState.projectMenuOpen = false;
      viewState.selectedJobId = "";
      viewState.selectedChainId = "";
      viewState.continueFromJobId = "";
      selectedWorkflowId = state.projects.find((project) => project.id === button.dataset.projectId)?.type || selectedWorkflowId;
      state = normalizeClientState(await api.post("/api/state", state));
      imageEditor = emptyImageEditor();
      render();
    });
  });

  document.querySelectorAll("[data-workflow]").forEach((button) => {
    button.addEventListener("click", async () => {
      selectedWorkflowId = button.dataset.workflow;
      viewState.selectedJobId = "";
      viewState.selectedChainId = "";
      viewState.continueFromJobId = "";
      if (selectedWorkflowId === "region-edit") {
        imageEditor.draft = null;
      } else {
        state.settings.assetMode = selectedWorkflowId;
        updateActiveProjectType(selectedWorkflowId);
      }
      state = normalizeClientState(await api.post("/api/state", state));
      render();
    });
  });

  document.querySelectorAll("[data-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      promptBody = `${promptBody}${promptBody.endsWith(" ") || !promptBody ? "" : " "}{${button.dataset.slot}}`;
      render();
    });
  });

  document.querySelectorAll("[data-select-image]").forEach((tile) => {
    tile.addEventListener("click", () => {
      imageEditor = emptyImageEditor({ selectedImageId: tile.dataset.selectImage });
      render();
    });
  });

  document.querySelectorAll("[data-region-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (button.dataset.regionId === "draft") return;
      imageEditor.activeRegionId = button.dataset.regionId;
      imageEditor.draft = null;
      render();
    });
  });

  document.querySelectorAll("[data-history-image-id]").forEach((button) => {
    button.addEventListener("click", () => {
      imageEditor = emptyImageEditor({ selectedImageId: button.dataset.historyImageId });
      render();
    });
  });

  const canvas = document.querySelector("[data-region-canvas]");
  if (canvas) bindRegionCanvas(canvas);

  document.onpaste = handleReferencePaste;

  document.querySelectorAll("[data-job-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const job = projectJobs().find((item) => item.id === button.dataset.jobId);
      viewState.selectedJobId = button.dataset.jobId;
      viewState.selectedChainId = getJobChainId(job);
      selectedWorkflowId = getJobWorkflowId(job) || selectedWorkflowId;
      viewState.historyOpen = false;
      imageEditor = emptyImageEditor();
      render();
    });
  });

  document.querySelectorAll("[data-chain-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const chain = getProjectJobChains(projectJobs()).find((item) => item.id === button.dataset.chainId);
      viewState.selectedChainId = button.dataset.chainId;
      viewState.selectedJobId = chain?.latest?.id || "";
      viewState.continueFromJobId = "";
      viewState.historyOpen = false;
      selectedWorkflowId = getJobWorkflowId(chain?.latest) || selectedWorkflowId;
      imageEditor = emptyImageEditor();
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action)));
}

function updateActiveProjectType(type) {
  const project = activeProject();
  if (!project) return;
  project.type = type === "region-edit" ? project.type : type;
  project.updatedAt = new Date().toISOString();
}

function bindRegionCanvas(canvas) {
  canvas.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".region-box")) return;
    const point = regionPoint(canvas, event);
    imageEditor.dragStart = point;
    imageEditor.draft = { x: point.x, y: point.y, width: 1, height: 1 };
    canvas.setPointerCapture(event.pointerId);
    drawDraftRegion(canvas);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!imageEditor.dragStart) return;
    const point = regionPoint(canvas, event);
    imageEditor.draft = normalizeRegion(imageEditor.dragStart, point);
    drawDraftRegion(canvas);
  });
  canvas.addEventListener("pointerup", () => {
    imageEditor.dragStart = null;
    if (imageEditor.draft && (imageEditor.draft.width < 1 || imageEditor.draft.height < 1)) imageEditor.draft = null;
    render();
  });
}

function drawDraftRegion(canvas) {
  let draftBox = canvas.querySelector("[data-region-id=\"draft\"]");
  if (!imageEditor.draft) {
    draftBox?.remove();
    return;
  }
  if (!draftBox) {
    draftBox = document.createElement("button");
    draftBox.className = "region-box active draft";
    draftBox.dataset.regionId = "draft";
    draftBox.innerHTML = "<span>새</span>";
    canvas.appendChild(draftBox);
  }
  draftBox.style.left = `${imageEditor.draft.x}%`;
  draftBox.style.top = `${imageEditor.draft.y}%`;
  draftBox.style.width = `${imageEditor.draft.width}%`;
  draftBox.style.height = `${imageEditor.draft.height}%`;
}

function regionPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
  };
}

function normalizeRegion(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    status: "ordered"
  };
}

async function handleReferencePaste(event) {
  if (activeWorkflow().id !== "region-edit") return;
  const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
  if (!file) return;
  imageEditor.referenceImage = { name: file.name || "clipboard-image", dataUrl: await readFileAsDataUrl(file) };
  render();
}

async function handleAction(action) {
  if (action === "save-prompt") {
    const title = window.prompt("프롬프트 제목", "새 프롬프트");
    if (!title) return;
    state = normalizeClientState(await api.post("/api/prompts", { title, body: promptBody }));
    render();
    return;
  }

  if (action === "toggle-project-menu") {
    viewState.projectMenuOpen = !viewState.projectMenuOpen;
    render();
    return;
  }

  if (action === "toggle-settings") {
    viewState.settingsCollapsed = !viewState.settingsCollapsed;
    render();
    return;
  }

  if (action === "toggle-advanced") {
    viewState.advancedOpen = !viewState.advancedOpen;
    render();
    return;
  }

  if (action === "toggle-history") {
    viewState.historyOpen = !viewState.historyOpen;
    render();
    return;
  }

  if (action === "continue-job") {
    const job = activeJob(projectJobs(), viewState.selectedJobId, activeWorkflow().id);
    viewState.continueFromJobId = viewState.continueFromJobId === job?.id ? "" : job?.id || "";
    viewState.selectedChainId = getJobChainId(job);
    render();
    return;
  }

  if (action === "focus-region") {
    document.querySelector("[data-region-canvas]")?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }

  if (action === "import-image") {
    await importImageForRegionEdit();
    return;
  }

  if (action === "pick-reference-image") {
    const file = await chooseImageFile();
    if (!file) return;
    imageEditor.referenceImage = { name: file.name, dataUrl: await readFileAsDataUrl(file) };
    render();
    return;
  }

  if (action === "clear-reference-image") {
    imageEditor.referenceImage = null;
    render();
    return;
  }

  if (action === "clear-region-draft") {
    imageEditor.draft = null;
    render();
    return;
  }

  if (action === "delete-region") {
    deleteActiveRegion();
    state = normalizeClientState(await api.post("/api/state", state));
    render();
    return;
  }

  if (action === "save-region") {
    await saveRegionOrder();
    return;
  }

  if (action === "generate") {
    await runBusy("이미지 생성 중", async () => {
      state = normalizeClientState(await api.post("/api/generate", { prompt: promptBody, settings: settingsForWorkflow() }));
      const nextJob = projectJobs()[0];
      viewState.selectedJobId = nextJob?.id || "";
      viewState.selectedChainId = getJobChainId(nextJob);
      if (viewState.continueFromJobId) viewState.continueFromJobId = nextJob?.id || "";
    });
    return;
  }

  if (action === "save-character-from-image") {
    await saveCharacterFromSelectedImage();
    return;
  }

  if (action === "export-3d") {
    await runBusy("3D 파일 export 중", async () => {
      state = normalizeClientState(await api.post("/api/export-3d", { prompt: promptBody, settings: settingsForWorkflow("3d-mesh-export") }));
    });
    return;
  }

  if (action === "slice-latest") {
    const latest = activeJob(projectJobs());
    if (!latest?.resultImages?.length) return;
    await runBusy("프레임 분리 중", async () => {
      state = normalizeClientState(await api.post("/api/slice-sprite", { jobId: latest.id, imageId: latest.resultImages[0].id, frameSize: state.settings.sliceFrameSize || 256 }));
    });
    return;
  }

  if (action === "make-gif" || action === "make-video") {
    const latest = activeJob(projectJobs());
    if (!latest?.resultImages?.length) return;
    const path = action === "make-gif" ? "/api/make-gif" : "/api/make-reveal-video";
    const body = action === "make-gif"
      ? { jobId: latest.id, frameCount: latest.resultImages.length, delay: state.settings.gifFrameDelay || 12 }
      : { jobId: latest.id, frameCount: state.settings.gifCutPreset || latest.resultImages.length, seconds: state.settings.revealVideoSeconds || 1.2 };
    await runBusy(action === "make-gif" ? "GIF 생성 중" : "영상 생성 중", async () => {
      state = normalizeClientState(await api.post(path, body));
    });
    return;
  }

  if (action === "make-character") {
    const title = window.prompt("캐릭터 이름", "기준 캐릭터");
    if (!title) return;
    const concept = window.prompt("캐릭터 기준 설명", promptBody || "작은 기사 캐릭터, 파란 튜닉, 빨간 스카프, 둥근 방패, 짧은 검");
    if (!concept) return;
    await runBusy("기준 캐릭터 생성 중", async () => {
      state = normalizeClientState(await api.post("/api/character-ref", { prompt: concept, settings: { ...state.settings, characterName: title, characterLock: state.settings.characterLock } }));
      promptBody = concept;
    });
    return;
  }

  if (action === "library") {
    const first = state.prompts[0];
    if (first) {
      promptBody = first.body;
      render();
    }
    return;
  }

  if (action === "add-project") {
    const name = window.prompt("프로젝트 이름", "새 프로젝트");
    if (!name) return;
    const project = { id: `project_${Date.now()}`, name, type: state.settings.assetMode || "single-image", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.projects.unshift(project);
    state.settings.activeProjectId = project.id;
    viewState.projectMenuOpen = false;
    viewState.selectedJobId = "";
      imageEditor = emptyImageEditor();
    state = normalizeClientState(await api.post("/api/state", state));
    render();
    return;
  }

}


async function importImageForRegionEdit() {
  const file = await chooseImageFile();
  if (!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  await runBusy("이미지 가져오는 중", async () => {
    state = normalizeClientState(await api.post("/api/import-image", {
      name: file.name,
      dataUrl,
      settings: settingsForWorkflow("region-edit")
    }));
    selectedWorkflowId = "region-edit";
    const nextJob = projectJobs()[0];
    viewState.selectedJobId = nextJob?.id || "";
    viewState.selectedChainId = getJobChainId(nextJob);
    imageEditor = emptyImageEditor({ selectedImageId: nextJob?.resultImages?.[0]?.id || "" });
  });
}

function deleteActiveRegion() {
  const job = activeJob(projectJobs(), viewState.selectedJobId, activeWorkflow().id);
  const image = currentImage(job?.resultImages || []);
  if (!image?.regions?.length || !imageEditor.activeRegionId) return;
  image.regions = image.regions.filter((region) => region.id !== imageEditor.activeRegionId);
  image.editHistory = image.editHistory || [];
  image.editHistory.unshift({ id: `history_${Date.now()}`, action: "영역 삭제", regionId: imageEditor.activeRegionId, status: "done", createdAt: new Date().toISOString() });
  imageEditor.activeRegionId = image.regions[0]?.id || "";
}

async function saveRegionOrder() {
  const job = activeJob(projectJobs(), viewState.selectedJobId, activeWorkflow().id);
  const image = currentImage(job?.resultImages || []);
  if (!job || !image?.path) return;
  const requestText = document.querySelector("[data-region-request]")?.value.trim() || promptBody.trim() || "선택 영역을 자연스럽게 편집";
  let regionId = imageEditor.activeRegionId;
  image.regions = image.regions || [];
  if (imageEditor.draft) {
    const region = { id: `region_${Date.now()}`, ...imageEditor.draft, orderText: requestText, status: "ordered", updatedAt: new Date().toISOString() };
    image.regions.push(region);
    regionId = region.id;
    imageEditor.activeRegionId = regionId;
    imageEditor.draft = null;
  } else {
    const region = image.regions.find((item) => item.id === regionId);
    if (region) {
      region.orderText = requestText;
      region.status = "ordered";
      region.updatedAt = new Date().toISOString();
    }
  }
  if (!regionId) return;
  state = normalizeClientState(await api.post("/api/state", state));
  await runBusy("영역 편집 중", async () => {
    const nextState = await api.post("/api/edit-region", {
      jobId: job.id,
      imageId: image.id,
      regionId,
      requestText,
      referenceImage: imageEditor.referenceImage,
      settings: settingsForWorkflow("region-edit")
    });
    if (nextState.editError) throw new Error(nextState.editError);
    state = normalizeClientState(nextState);
    imageEditor = emptyImageEditor({ selectedImageId: nextState.editedImageId || image.id, activeRegionId: regionId });
  });
}

async function saveCharacterFromSelectedImage() {
  const job = activeJob(projectJobs(), viewState.selectedJobId, activeWorkflow().id);
  const image = currentImage(job?.resultImages || latestImages());
  if (!job || !image?.path) return;
  const title = window.prompt("캐릭터 이름", state.settings.characterName || "저장한 캐릭터");
  if (!title) return;
  const lock = window.prompt("유지할 특징", state.settings.characterLock || "same character, same costume, same proportions, same silhouette, same palette");
  await runBusy("캐릭터 저장 중", async () => {
    state = normalizeClientState(await api.post("/api/character-ref/from-image", {
      jobId: job.id,
      imageId: image.id,
      title,
      lock: lock || state.settings.characterLock,
      prompt: image.prompt || promptBody,
      settings: { ...state.settings, activeProjectId: activeProject()?.id }
    }));
  });
}

async function runBusy(label, task) {
  uiStatus = { busy: true, label, error: "" };
  render();
  try {
    await task();
    uiStatus = { busy: false, label: "", error: "" };
  } catch (error) {
    uiStatus = { busy: false, label: "", error: error.message || "요청 실패" };
  }
  render();
}

async function init() {
  state = normalizeClientState(await api.get("/api/state"));
  selectedWorkflowId = state.settings.assetMode || "single-image";
  promptBody = state.prompts[0]?.body || "";
  render();
  preflight = await api.get("/api/preflight");
  render();
}

init().catch((error) => {
  app.innerHTML = `<pre>${error.stack || error.message}</pre>`;
});
