# Validation

`npm run verify` runs strict TypeScript checks, ESLint, Prettier, unit tests, Chromium browser tests, and extension packaging in the development container.

Automated coverage includes CSV parsing, identity conflicts, label planning, stale-state rejection, partial writes, uncertain responses, cancellation, document binding, injected-function isolation, asynchronous panel imports, deletion approval, recovery, narrow layouts, and mocked store uploads. Fixtures contain synthetic students only.

The installed-extension test uses local mock endpoints and adds a localhost permission to a temporary manifest. It verifies real Chrome injection and writes without exercising the toolbar’s `activeTab` grant.

Automated tests do not establish compatibility with an authenticated PrairieLearn deployment or Chrome Web Store acceptance.

## Manual release smoke test

Use a disposable course instance or authorized test roster.

1. Load `dist/` in Chrome. Open Students and Student labels in turn; click the toolbar icon and confirm the course, site, and roster.
2. Import a small CSV with multiple sections, an unmatched student, and a leading-zero UIN. Review mappings and both update scopes.
3. Confirm Apply requires approval when deleting labels. Apply a small plan and check memberships, unrelated labels, and preserved students in PrairieLearn. A fresh import should show no further changes.
4. Navigate or close the source tab after preview; confirm execution stops. Change labels in another window; confirm stale plans are rejected.
5. Stop during a sync, then reimport and finish the remaining changes. Close and reopen the panel during a sync and check the recovery reminder.
6. Verify read-only accounts and expired sessions. Use two Chrome windows and select another course while syncing; the running target must remain fixed.

Store uploading and review submission are tested with mocked HTTP responses. Live publishing requires an authorized service account and an existing store item.
