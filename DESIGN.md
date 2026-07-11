# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-10
- Primary product surfaces: Project-first production dashboard, hierarchical project/work sidebar, top mode tabs, generated asset workspace, history drawer, image region editing.
- Evidence reviewed: `README.md`, `docs/ux-dashboard.md`, `public/index.html`, `public/app.js`, `public/styles.css`, `server.js`, `/Users/kongms002/Downloads/proposed_dashboard_layout.svg`.

## Brand
- Personality: Practical creative workstation, calm production console, clear and production-minded.
- Trust signals: Real adapter status in the settings panel, visible preflight checks on demand, project-scoped output history, no mock generation fallback, strong selected states.
- Avoid: Marketing-style landing pages, decorative-heavy layouts, ambiguous history naming, generic bright-blue SaaS demo styling.

## Product goals
- Goals: Make 2D sprites, 3D references/files, cut/GIF assets, and image-model region edits easy to start from one project dashboard.
- Non-goals: Full DAM, collaborative review suite, or full image editor replacement.
- Success signals: Users can identify current project and mode without scrolling, generate assets, import images for region editing, inspect results prominently, choose a job flow and a job inside the project, continue related work into the same flow, browse project history from a drawer, and reload previous jobs into the result grid with their original mode preserved.

## Personas and jobs
- Primary personas: Solo creator, game asset maker, image production operator.
- User jobs: Generate assets, import external images, split frames, make GIF/video cuts, export 3D files, and run image-model edits on selected image regions with optional replacement/reference images.
- Key contexts of use: Local desktop workflow with generated files and iterative prompts.

## Information architecture
- Primary navigation: Persistent left project → work-flow → job tree, top mode tabs, central workbench, result workspace, right-side settings panel with one top-level collapse control, history drawer.
- Core routes/screens: Single-page local dashboard.
- Content hierarchy: Project → named work flow → named job in the left tree; mode and compact status in the workspace; prompt/workbench and results in the center; settings on the right; drawer history on demand.

## Design principles
- Principle 1: Production modes should be explicit and task-named.
- Principle 2: Project history should answer “what was made here?” with thumbnails and should not permanently consume workspace height.
- Principle 3: Region editing is a workspace mode, not a generation mode; it should not overwrite the user's asset generation settings.
- Principle 4: Complexity should be managed by region responsibility: top bar for project/mode, center for work/results, inspector for settings, drawer for history.
- Principle 5: Reference stats should stay compact; the result grid and primary action get visual priority.
- Principle 6: Mode-specific panels should render only in the relevant mode; unrelated 3D, GIF, or region-edit UI should not leak into other tabs.
- Principle 7: Buttons should describe user intent, not internal implementation; remove ambiguous helper actions unless they serve a frequent workflow.
- Principle 8: Projects should group related jobs into `작업 흐름`; avoid long flat job lists.
- Principle 9: Continuing a selected job must keep the same flow and assign a stable chronological job number; do not duplicate recent-flow navigation in the main workspace.
- Tradeoffs: Dense controls are acceptable, but nonessential settings move to the inspector.

## Visual language
- Color: Cool neutral workspace with deep blue-gray primary actions, muted blue-gray selected states, teal region-edit accents, and semantic green/amber/red only for status.
- Typography: Korean-readable UI sizing; compact labels are acceptable only for metadata. Use strong weights for active modes and section anchors, not oversized type.
- Spacing/layout rhythm: Full-screen top navigation plus two-column workstation layout; history appears as a right drawer. Result imagery receives the most visual space.
- Shape/radius/elevation: 8px controls, crisp borders, restrained elevation only for dropdowns and drawers.
- Motion: Minimal; scrolling to region editor is allowed.
- Imagery/iconography: Real generated images are the primary visual assets.

## Components
- Existing components to reuse: Buttons, section headers, tiles, badges, fields, file rows, status panels.
- New/changed components: Hierarchical project/work sidebar with prompt-derived readable labels, mode tabs, compact status strip, workbench, settings accordion, settings collapse, history drawer, clickable thumbnail history cards, region editor, character reference bar, save-as-character result action.
- Variants and states: Active project, active mode tab, loaded history job, collapsed settings, open advanced settings, open history drawer, disabled generation actions, empty results, selected image, draft region, keyboard focus ring.
- Region edit states: `작업 대기`, `편집 중`, `완료`, and `실패` must be visibly represented in the selected region, region list, and edit history.
- Token/component ownership: `public/styles.css` owns CSS variables and component classes.

## Accessibility
- Target standard: Practical keyboard/mouse usability for local tool use.
- Keyboard/focus behavior: Native buttons/inputs should remain focusable.
- Contrast/readability: Text uses neutral contrast; statuses use semantic colors with text labels.
- Screen-reader semantics: Native controls preferred over custom div-click controls.
- Reduced motion and sensory considerations: Only small optional scroll behavior.

## Responsive behavior
- Supported breakpoints/devices: Desktop-first local app, with narrower desktop support around 1180px.
- Layout adaptations: Result grid reduces columns; project hero stacks.
- Touch/hover differences: Region editor supports pointer events.

## Interaction states
- Loading: Status panel while generation/export is busy.
- Empty: Empty result tiles and empty project history text.
- Error: Status panel with red treatment.
- Success: Generated results appear in project-scoped output, compact status updates, the history drawer shows thumbnail-backed jobs, clicked history jobs load into the result grid, and each mode shows only relevant panels/actions.
- Imported images are stored as project jobs so region editing can start without generating a new image.
- Region edit requests call the image model after saving and can include an optional pasted/uploaded reference image; visible work state replaces repeated request text, completed results are selected automatically, and completed history rows reopen their result image.
- Region edit output must preserve the source image canvas size/aspect ratio and must not inherit sticker/GIF resize presets.
- Region edit final output should composite only the edited region onto the original canvas instead of replacing the whole source image.
- Background cleanup currently uses chroma-key post-processing for transparent sticker/GIF outputs; full automatic background removal is a future service-quality enhancement and should not alter normal image outputs by default.
- Disabled: Primary actions disabled when prompt/adapter/output prerequisites are missing.
- Offline/slow network, if applicable: Local app surfaces adapter/preflight state.

## Content voice
- Tone: Direct Korean production terminology.
- Terminology: “프로젝트” for grouped work; “작업” for generated runs; “제작 모드” for asset workflows; “영역 편집” for the mode and “편집 요청” for region-specific edit text.
- Microcopy rules: Prefer short labels over explanatory paragraphs. Avoid labels such as “분석 메모”, “주문 저장”, “선택 해제”, and adapter-detail badges in primary navigation.

## Implementation constraints
- Framework/styling system: Vanilla JS, CSS, Node HTTP server.
- Design-token constraints: Existing CSS variables in `:root`.
- Performance constraints: No frontend build step; keep render logic simple.
- Compatibility constraints: Current state uses `projects` and `jobs` directly; `chainId` and `projectType` are required current-schema fields and invalid legacy jobs fail explicitly. Existing generated paths remain valid, while new outputs use project/workflow folders.
- Test/screenshot expectations: `npm run check` for syntax and unit tests; browser smoke test for local rendering.
- UX documentation: `docs/ux-dashboard.md` defines the top-bar dashboard structure, complexity rules, mode behavior, copy guidance, and future simplification priorities.

## Frontend architecture
- `public/app.js`: composition root for stateful UI rendering and event binding.
- `public/api-client.js`: API transport boundary.
- `public/workflows.js`: workflow catalog, mode labels, and project labels.
- `public/state-selectors.js`: pure state normalization and selectors for projects, jobs, workflows, and images.
- `public/file-import.js`: browser file picker and Data URL conversion.
- `test/dashboard-state.test.js`: regression coverage for project separation, active job loading, job workflow locking, job-flow grouping, and image selection.

SOLID direction:
- Keep pure state logic out of render code.
- Keep network calls behind `api-client`.
- Keep browser-only file APIs behind `file-import`.
- Add tests before changing selectors or project/job ownership rules.
- Next refactor target: split render sections from `app.js` into view modules after current behavior remains stable.

## Open questions
- [ ] Should each project have a dedicated editable brief/status field?
- [x] Should region edit requests trigger actual image-edit generation, or remain production notes for now? Answer: trigger image-model editing through `/api/edit-region`; retain visible status and failure history.
- [x] Should project history support filtering by mode, date, or output type? Answer: reserve filter space in the history drawer; start with visible filter chips and wire behavior later.
- [ ] Should the history drawer filters be fully interactive in the next pass?
