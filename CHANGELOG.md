# Changelog

## Unreleased

- Keep status and error messages visible while scrolling the panel.
- Follow the browser's dark theme.
- Show section labels as their own step, with the number of students per Canvas section.
- Keep the loaded course when the extension icon is clicked on an unrelated tab.
- Allow choosing the same CSV again after an import error.
- Apply regex rules with Enter, and explain why full replacement is unavailable.
- Describe review and progress steps in plain language, sorted by label name, without zero counts.
- Report how far an interrupted sync progressed.
- Allow updating all joined PL students when the CSV includes students who never joined PrairieLearn; only unidentified Canvas records block it.
- Ignore the Canvas Test Student, and keep joined students without a Section out of full replacement.
- Count and list joined students absent from the CSV who will lose section labels.

## 1.1.1 (2026-09-22)

- Publish Chrome Web Store releases using GitHub OIDC, automatically after tag releases or manually.

## 1.1.0 (2026-09-21)

- Add regex replacement for suggested section labels, including capture groups and sequential rules.
- Capitalize the generated label prefix as `Section `.
- Align CI and store upload workflows with the default `master` branch.

## 1.0.0 (2026-09-08)

- Import PrairieLearn students and match Canvas gradebooks by SIS Login ID and UIN.
- Review section mappings and student changes before applying verified updates.
- Preserve unrelated labels and unidentified students; support partial imports and full replacement.
- Stop between requests and recover interrupted work through a fresh preview.
