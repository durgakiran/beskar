# Document PDF export

Use **More actions (⋯) → Export PDF** in the draft editor or published document view. On mobile, use the actions menu. Select A4 or Letter, portrait or landscape, then download. Draft export captures the visible editor state (including unsaved changes) at click time. Published export captures the published editor. Comments and editing controls are excluded. Whiteboards are outside this document-export feature.

PDF generation runs locally with pdfmake 0.3.11. Fonts are bundled; no PDF service or CDN is required. Images still require access to their normal media URLs. The engine is dynamically loaded through `@durgakiran/editor/pdf`; it is absent from the initial editor bundle. Block equations use MathJax SVG output. Desktop saves through a Wails native file dialog and writes atomically; canceling does not report success.

## Supported content and limitations

- Headings, paragraphs, formatting, safe links, lists, quotes, code, callouts, images, merged table cells and repeating table headers.
- Status/date/attachment/document chips become readable text and links where available. Attachment bytes are not embedded.
- Images use the application's media proxy. Missing or inaccessible images produce labeled placeholders and an export note. Images are downsampled to 2400 pixels on the longest edge; animated formats become a static frame.
- Block equations render as vectors. Invalid formulas and inline equations retain their LaTeX text, with an export note.
- Columns flow in reading order. Interactive embeds become links. Live child-page lists and the interactive table of contents are not reproduced. Fallbacks are reported in the dialog.
- Bundled Roboto supports Latin, Greek and Cyrillic. Other scripts and emoji may lack glyphs; potentially affected documents receive a warning. Additional font coverage is future work.
- Desktop exports have a 64 MB save limit. Generation happens on the client; exceptionally large documents can temporarily occupy the UI thread.

## Package and build integration

`packages/editor/src/pdf` provides the reusable adapter and browser generator. `@durgakiran/editor/pdf` is a separate package export. `pdfmake` and `mathjax-full` are bundled in that entry; `@types/pdfmake` supplies TypeScript definitions.

The repository UI resolves only the `/pdf` subpath to the local build so this feature does not depend on first publishing a new editor version to the private registry. Its existing editor dependency is unchanged. UI dev/build hooks run the dedicated PDF build. Install editor dependencies with `npm --prefix packages/editor ci` before running the UI. The Docker UI build installs these dependencies in an isolated stage and includes the PDF source/build tools for its build hook.

## Verification

- `npm --prefix packages/editor run test:pdf`
- `npm --prefix packages/editor run type-check`
- `npm --prefix ui test -- app/core/editor/PdfExportButton.test.tsx`
- `npm --prefix ui run build` and `npm --prefix ui run build:desktop`
- From `desktop`: `GOWORK=off GOTOOLCHAIN=auto go test ./pdfexport`

Set `PDF_TEST_OUTPUT=/tmp/pdf-export-check.pdf` when running `test:pdf` to save the multi-page verification fixture for visual review. The fixture covers pagination, repeated headers, long code and equations. Native file-dialog behavior should also be exercised on each supported desktop OS.
