# Changelog

## Unreleased

## 1.1.0 (2026-09-21)

- Add regex replacement for suggested section labels, including capture groups and sequential rules.
- Capitalize the generated label prefix as `Section `.
- Align CI and store upload workflows with the default `master` branch.

## 1.0.0 (2026-09-08)

- Import PrairieLearn students and match Canvas gradebooks by SIS Login ID and UIN.
- Review section mappings and student changes before applying verified updates.
- Preserve unrelated labels and unidentified students; support partial imports and full replacement.
- Stop between requests and recover interrupted work through a fresh preview.
