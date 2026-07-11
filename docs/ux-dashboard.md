# Dashboard UX Guide

This document defines the simplified dashboard structure. It is based on the proposed top-bar layout in `proposed_dashboard_layout.svg` and replaces the older sidebar-heavy structure.

## UX Diagnosis

The previous dashboard exposed too many decisions at once:

- project selection and production mode were stacked in the same narrow left sidebar
- project stats were shown as large cards even though they were reference information
- mode-specific settings were always expanded
- project history lived in a short bottom strip with no thumbnails
- result images did not have enough visual priority

The current direction is stricter: the main screen should prioritize production work, while secondary decisions move into a top bar, collapsible settings, or a history drawer.

## User Mental Model

The intended user flow is:

1. Pick the active `프로젝트` from the top project picker.
2. Pick a `제작 모드` from the horizontal mode tabs.
3. Type or reuse a prompt in the central workbench.
4. Generate, export, import an image, or open region editing.
5. Review generated results in the large result grid.
6. Use mode-relevant result actions such as frame split, GIF, cut video, or region editing.
7. Use the project job-flow selector when switching between independent attempts inside the same project.
8. Use the selected flow's job chips when switching between steps in that flow.
9. Use `이어 작업` when the next generation/import should stay connected to the current flow.
10. Open `작업 이력` only when browsing previous project outputs.
11. Click a history item to load that job back into the result grid with its original production mode.

## Information Architecture

Current layout:

| Area | Role | Should Answer |
| --- | --- | --- |
| Top project picker | Project selection | “Which project am I working in?” |
| Top mode tabs | Production mode selection | “What kind of asset am I making?” |
| Compact status row | Orientation | “What happened last, and how many outputs exist?” |
| Project job-flow selector | Flow selection | “Which attempt/thread am I continuing?” |
| Selected-flow job selector | Job loading | “Which step in this flow am I inspecting?” |
| Center workbench | Primary action | “What do I type and what button do I press?” |
| Slot toolbar | Prompt acceleration | “Which reusable variables can I insert?” |
| Result grid | Output review | “What was produced?” |
| Region editor | Follow-up orders | “Which part of this image needs a change?” |
| Right settings panel | Essential run settings | “What must I set before running?” |
| Advanced settings accordion | Rare tuning controls | “What can I tune if needed?” |
| History drawer | Project output browsing | “What did this project produce before?” |
| History cards | Job loading | “Which previous result should I bring back?” |

## Complexity Rules

Use these rules when adding or changing UI:

- Each screen region has one job.
- Project and mode selection belong in the top bar, not a sidebar.
- The top bar should not expose implementation status such as “Codex CLI 실제 연결”; keep adapter readiness inside `연결 상태`.
- The center area is for prompt writing and result inspection.
- Project status is a compact row, not large cards.
- The result grid should receive the most visual space.
- Only mode-relevant result actions should be visible.
- Only mode-relevant panels should be visible. For example, `3D 파일` output belongs only in the `3D 파일` tab, and region editing controls belong only in `영역 편집`.
- Essential settings should stay visible; mode details and tuning controls should be inside `고급 설정`.
- Settings use one top-level `설정` toggle. Do not add inner “설정 닫기” buttons inside the panel.
- Project history belongs in a drawer or separate view, not a permanent bottom strip.
- History items should include thumbnails when available.
- History should group jobs by flow before listing individual jobs.
- Flow and job items should be clickable and load their result into the current result grid.
- Each completed job keeps the production mode it was created with; loading a job must not silently reinterpret it as the currently selected tab.

## Tone And Manner

The dashboard should feel like a focused production console:

- calm, neutral, and task-oriented
- image-first, not decoration-first
- precise enough for repeated production work
- visually quiet until something needs attention

The current visual system uses:

- cool neutral backgrounds for the app shell and work surfaces
- deep blue-gray for primary actions and active navigation
- muted blue-gray fills for selected states
- teal for region-edit overlays and image-specific edit work
- semantic green, amber, and red only for status, warnings, and errors
- restrained shadows only for the window, dropdowns, and drawers

Avoid:

- bright generic SaaS blue as the dominant brand tone
- colorful cards for every section
- large decorative statistics
- repeated heavy shadows
- explanatory paragraphs inside the app
- status colors used as decoration

## Component Tone Rules

- Buttons are compact and workmanlike; primary buttons should be visually stronger but not oversized.
- Buttons should be named by the user's next action: `저장`, `불러오기`, `생성`, `이미지 가져오기`, `영역 지정`, `편집 실행`.
- Mode tabs use strong active state because mode choice changes the whole workflow.
- Badges are metadata, not calls to action.
- The status strip is low-emphasis orientation information.
- Settings panels should look quiet and secondary to the result grid.
- History cards should use thumbnails first, text second.
- Region boxes should be visible over images but not obscure the target area.
- Region edit requests should show work state (`작업 대기`, `편집 중`, `완료`, `실패`) and model name instead of repeating the same request text in every list.
- Empty states should be calm and actionable.

## Production Mode Rules

| Mode | Primary Action | Visible Result Actions | Advanced Settings |
| --- | --- | --- | --- |
| `이미지` | Generate images | None by default | character reference, model, retries, background |
| `2D 스프라이트` | Generate sprite sheet | Frame split | direction order, action rows, frame count |
| `3D 레퍼런스` | Generate reference image | None by default | views, target format, 3D style |
| `3D 파일` | Export mesh | OBJ/MTL download only in this tab | mesh kind, tile size |
| `컷툰/GIF` | Generate cuts | GIF, cut video | caption list, cut count, timing |
| `영역 편집` | Import or load an image, then run region edits through the image model | Region editor only in this tab | selected image, optional reference image, import image, region list, edit history |

`영역 편집` is a workspace mode. It does not overwrite the underlying generation mode.
It can start from generated images or from a local imported PNG/JPG/WEBP/GIF image. Saving a region request runs an image-model edit and appends the edited result image to the same job. Reference images can be added with the file picker or by pasting an actual clipboard image; pasting a file path or URL text is not an upload.

Background cleanup is currently chroma-key based for transparent sticker/GIF outputs. Treat broader automatic background removal as a separate post-processing enhancement with explicit controls and tests, not as a hidden change to every generated image.

## Simplification Priorities

The next simplification work should follow this order:

1. Keep advanced settings collapsed by default.
2. Keep the settings panel collapsible so result inspection can take the full width.
3. Keep project status as a one-line strip.
4. Keep project history in a drawer with thumbnails and filters.
5. Show final prompt preview only when slots are used.
6. Show only result actions that match the active mode.
7. Show only panels that match the active mode.
8. Add stronger empty states for new projects and region editing.
9. Add project rename/brief only after project management becomes a real workflow.

Avoid:

- rebuilding a left navigation column for project/mode choices
- making stats larger than the workbench or result grid
- adding another always-visible history area
- adding global tabs that duplicate the mode tabs
- adding decorative sections that do not help production

## Copy Guidelines

Prefer short Korean production labels:

- Use `프로젝트`, not `이미지 그룹`.
- Use `작업 이력` for the drawer.
- Use `최근 흐름` for the small preview inside the main workspace.
- Use `제작 모드`, not `에셋 모드` in visible navigation.
- Use `편집 요청`, not `주문 내용` or `편집 메모`, when the note is meant to become an image edit request.
- Use `고급 설정` for controls that most users do not need each run.
- Avoid ambiguous helper labels such as `분석 메모`, `주문 저장`, `선택 해제`, and repeated `닫기` text buttons.

Avoid long explanatory paragraphs inside the app. Put explanations in docs.

## Empty States

Empty states should be actionable:

- No project results: “프롬프트를 입력하고 생성하면 이 프로젝트의 결과가 여기에 표시됩니다.”
- No selected image: “결과 이미지를 선택하면 영역 편집을 시작할 수 있습니다.”
- No region edits: “이미지를 드래그해서 수정할 구역을 지정하세요.”
- No character reference: “기준 캐릭터가 없으면 현재 프롬프트만 사용합니다.”
- No history: “이 프로젝트에서 만든 결과가 아직 없습니다.”

## Interaction Rules

- Project picker opens a dropdown; selecting a project changes visible jobs and results.
- Mode tabs are always visible in one horizontal strip.
- Selecting a generation mode changes production settings.
- Selecting `영역 편집` does not overwrite the current generation mode.
- Clicking `이미지 가져오기` imports a local image into the active project as a loadable job.
- Clicking a project job chip loads that job and locks the active tab to the job's original production mode.
- Clicking a project flow chip loads the latest job in that flow.
- Clicking `이어 작업` links the next run to the selected flow using `chainId` and `parentJobId`.
- The settings panel can be collapsed.
- The settings panel has no internal close button; it is controlled by the top `설정` toggle.
- `고급 설정` is collapsed by default.
- Selecting an image makes it the target for region editing.
- Dragging on the image creates a draft region.
- Saving a region appends to that image's edit history and starts an image-model edit task.
- Adding a reference image should be optional and should preview before running the edit.
- Starting an edit must immediately show `편집 중`, not only a passive history entry.
- Completing an edit should select the generated result image automatically.
- Completed edit-history rows should be clickable and reopen their result image.
- Region edit output should preserve the source image size/aspect ratio and should not inherit 360x360 sticker/GIF output settings.
- Region edit final output should keep the original canvas and composite only the changed region back into it.
- Deleting a region also appends an edit-history event.
- Saving a region moves it through `작업 대기` / `편집 중` / `완료` or `실패`, and the selected region, region list, and edit history must show that state.
- Opening `작업 이력` shows a drawer with thumbnails and filter space.
- Clicking a history card closes the drawer and loads that job's images into the result grid.
- The loaded history card should have a clear selected state in recent jobs and the drawer.

## Acceptance Checklist For Future UI Changes

Before considering a dashboard change complete:

- Project and mode controls are visible without vertical scrolling.
- The active project is obvious.
- The active mode is obvious.
- The compact status row is one line.
- The primary button matches the mode.
- Advanced controls do not compete with the main action.
- Result actions are relevant to the active mode.
- The result grid has the largest share of the workspace.
- Irrelevant mode panels are hidden.
- History browsing includes thumbnails and does not permanently consume vertical space.
- A clicked history item loads into the result grid and is marked as loaded.
- A clicked history item preserves its original production mode tab.
- Region editing has a clear selected image and saved-history feedback.
- Region editing shows a visible work state after saving an order.
- Region editing can begin from either generated output or imported local images.
- Korean labels are short and consistent with this document.
