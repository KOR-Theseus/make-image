# Codex Image Generator

Local image and asset production dashboard for personal Codex workflows.

## What It Does

- Generates real images through `IMAGE_ADAPTER=codex-cli` or `IMAGE_ADAPTER=openai`.
- Organizes work by project and job flow so you can separate independent attempts while continuing related work.
- Provides task-based modes for:
  - single image generation
  - 2D sprite sheets
  - 3D production reference sheets
  - procedural `OBJ + MTL` 3D file export
  - cut/GIF-style image sequences
  - region editing for imported or generated images
- Splits sprite sheets into frame images.
- Builds GIF and cut-video outputs from generated images.
- Creates reusable character reference images for consistency.
- Imports local images for region editing and sends selected regions to `/api/edit-region`.
- Creates reusable character references from generated images so later generations can preserve identity.
- Runs chroma-key cleanup for transparent sticker/GIF outputs; broader automatic background removal is planned after the region-edit quality pass.

The app intentionally has no mock image fallback. If the selected real adapter cannot generate, the request fails visibly.

## Dashboard Structure

The UI is organized around the production workflow:

- `프로젝트/작업 사이드바`: projects are the top level, named work flows are nested below them, and individual jobs appear as the third level. Names are derived from the source filename or first prompt instead of opaque IDs.
- `제작 모드`: horizontal mode tabs for image, 2D sprite, 3D reference, 3D file, cut/GIF, and region editing.
- `상태 줄`: compact project status with last run, loaded job mode, and image count.
- `작업 흐름`: the left tree groups related jobs. Select a job and press `이 작업에 이어서` to save the next run in the same flow.
- `작업 번호`: jobs in a flow keep chronological numbers (`1`, `2`, `3`…) so later iterations remain easy to follow.
- `작업 영역`: central prompt editor, character reference controls, optional final prompt preview, output grid, and export links.
- `설정`: right-side settings for count, concurrency, and resolution. It stays visible by default and can be collapsed from the top bar.
- `고급 설정`: collapsed accordion for mode-specific controls, model, retries, and background.
- `작업 이력`: drawer with thumbnails and filter space for browsing what was created in the active project.

For the detailed UX rationale and simplification rules, see `docs/ux-dashboard.md`.

## Design Tone

The dashboard is styled as a calm production console:

- neutral workspace surfaces
- deep blue-gray primary actions
- muted selected states
- restrained shadows and 8px controls
- full-screen workspace without decorative browser chrome
- generated images as the main visual focus

## Production Modes

| Mode | Purpose | Output |
| --- | --- | --- |
| `이미지` | General image generation | PNG/JPG image files |
| `2D 스프라이트` | Direction/action sprite sheets | Generated sheet + optional frame split |
| `3D 레퍼런스` | Modeling reference sheet | PNG reference image |
| `3D 파일` | Procedural static mesh export | `OBJ + MTL` files |
| `컷툰/GIF` | Cut-based sticker/GIF/video flow | Image frames, GIF, MP4 |
| `영역 편집` | Import or select an image and edit a drawn region | Edited image appended to the job |

`영역 편집` is a workspace mode for local correction work. It can start from an imported image or an existing generated result, stores drawn regions on the selected image, and appends edited outputs back to that job. The current edit path uses the Codex CLI image tool and preserves source resolution; the next quality pass should composite edited regions onto the source canvas by default.

## Background Cleanup

Transparent sticker/GIF outputs currently use chroma-key cleanup when the prompt asks for transparent or green-screen style backgrounds. This is not full subject segmentation yet; general automatic background removal should be added as a separate post-processing slice with tests so normal images are not modified unexpectedly.

## Data Model

Persistent state is stored in `data/prompt-store.json`.

Important collections:

- `projects`: project records shown in the dashboard.
- `jobs`: generated runs, linked to `projectId`.
- `chainId` / `parentJobId`: optional job-flow links for continuing related work inside one project.
- `prompts`: saved prompt bodies.
- `slotSets`: reusable prompt slots such as `{동물}` or `{장소}`.
- `characterRefs`: generated character reference images.
- `meshExports`: procedural 3D exports.

State uses the current `projects` and `jobs` model directly. Legacy jobs are rejected instead of being silently repaired; the local store was migrated to the current workflow and chain fields on 2026-07-10.

## Run

```sh
IMAGE_ADAPTER=codex-cli npm start
```

Open `http://localhost:5173`.

If port `5173` is already in use:

```sh
PORT=5174 IMAGE_ADAPTER=codex-cli npm start
```

## OpenAI Adapter

To use OpenAI image generation directly:

```sh
OPENAI_API_KEY=... IMAGE_ADAPTER=openai npm start
```

The server also reads a local `.env` file when present.

## API Overview

- `GET /api/state`: load dashboard state.
- `POST /api/state`: save dashboard state.
- `GET /api/preflight`: check adapter and credential readiness.
- `POST /api/generate`: generate images for the active project.
- `POST /api/import-image`: import a local image into a region-edit job.
- `POST /api/edit-region`: edit a saved region on an imported or generated image.
- `POST /api/export-3d`: export procedural `OBJ + MTL` assets.
- `POST /api/character-ref`: generate a character reference.
- `POST /api/character-ref/from-image`: save an existing generated image as the active character reference.
- `POST /api/slice-sprite`: split a sheet into frames.
- `POST /api/make-gif`: build a GIF from generated frames.
- `POST /api/make-reveal-video`: build a cut-style MP4.
- `POST /api/prompts`: save a prompt.

## Check

```sh
npm run check
```

This runs:

- `node --check server.js`
- `node --check public/app.js`
- `node --test`

## Notes

- New generated files are grouped under `generated/<project>/<workflow>/<job>/`. Existing output paths remain readable and are not moved automatically.
- The app is desktop-first and uses vanilla JS/CSS with a Node HTTP server.
- Unity can import the exported static `OBJ + MTL` meshes directly.
