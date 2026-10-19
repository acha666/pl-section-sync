# PL Section Sync

A Chrome side panel that matches a Canvas Gradebook CSV to PrairieLearn students and syncs section labels. Built with TypeScript and Preact; everything is bundled into the extension, with no backend.

## Install and use

Download and extract the extension ZIP from GitHub Releases. In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder. Chrome 116 or later is required.

1. Open PrairieLearn **Students** or **Student labels** and click the extension icon. Check the selected course and site.
2. Choose a Canvas Gradebook CSV containing `ID`, `SIS Login ID`, and `Section`.
3. Review section labels. Each line becomes a `Section …` label; an empty box clears those students’ assignments. Select **Confirm labels & preview**.
4. Review changes, approve any label deletions, and select **Apply changes**. Keep the panel and source tab open until verification finishes, then refresh PrairieLearn.

Use **Clean up labels with regex** to replace text in all current label suggestions; press Enter or **Replace in labels** to apply a rule. Patterns use JavaScript regex syntax without `/` delimiters; replacement supports `$1`, `$2`, etc. All matches are replaced, unmatched labels are preserved, and empty results are removed. Rules apply in sequence, before the `Section ` prefix is added.

For example, replace `^APSC_V 160 (\S+) 2026W1$` with `$1` to get `102` and `L1W`. Then replace `^(\d+)$` with `Lecture $1` and `^(L\w+)$` with `Lab $1` to generate `Section Lecture 102` and `Section Lab L1W`.

Only joined students with a unique, exact `SIS Login ID = UIN` match are updated. Leading zeros and case are preserved. The default scope preserves students outside the CSV. **All joined PL students** also clears assignments for eligible students absent from the CSV; the preview counts and lists them. Canvas records without a Canvas ID or SIS Login ID block that scope, because they might be joined students. Canvas students not in PrairieLearn or not joined, joined students without a Section, and the Canvas Test Student are listed as not updated and do not block it. Students without unique identifiers and non-joined enrollments are preserved.

Labels beginning with `Section ` are managed case-insensitively. Other labels are preserved. Cleanup deletes unused, empty managed labels, including preexisting ones. **Deleting a label may remove assessment access-rule references; recreating its name does not restore them.**

Writes are checked before and after each operation. **Stop after current request** stops between verified operations. After interruption or failure, refresh students and import the same CSV to review the remaining changes. Completed changes are not rolled back. Avoid concurrent roster or label edits.

## Develop

Open the repository in VS Code and select **Dev Containers: Reopen in Container**. The container provides Node.js and Chromium and runs `npm ci`. Docker is the only host runtime required.

Without VS Code:

```sh
./scripts/docker.sh npm ci
./scripts/docker.sh npm run verify
./scripts/docker.sh npm run dev
```

Inside the container:

| Command           | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `npm run dev`     | Synthetic UI at `http://localhost:8080` with live reload (Vite) |
| `npm run check`   | Strict TS, ESLint, and Prettier checks                          |
| `npm run format`  | Format source, configuration, and documentation                 |
| `npm test`        | Build and run unit tests (Vitest)                               |
| `npm run test:ui` | Chromium browser tests                                          |
| `npm run package` | Build `dist/` and `release/pl-section-sync-<version>.zip`       |
| `npm run verify`  | All checks, tests, and packaging                                |

Load `dist/` in host Chrome to test the actual extension; `npm run build -- --watch` rebuilds it on save. The synthetic UI uses generated students and makes no PrairieLearn requests. Container commands write generated files using the host user's UID/GID. Dependencies are locked in `package-lock.json`.

## Structure

- `src/core/`: models, CSV parsing, matching, and change planning; no PrairieLearn wire formats.
- `src/pl/`: same-origin adapter, document-bound Chrome client, and response validation.
- `src/sync/`: serial writes and state verification.
- `src/ui/`: panel state coordinator and Preact components.
- `panel.html`, `src/manifest.json`: panel entry and manifest template; the build injects the package version.
- `public/`: icons copied unchanged.
- `test/`: synthetic unit and browser tests.

See [release workflow](docs/RELEASING.md), [adapter contract](docs/COMPATIBILITY.md), [validation](docs/VALIDATION.md), and [privacy](PRIVACY.md). Independent project; not affiliated with PrairieLearn, Canvas, or Google.
