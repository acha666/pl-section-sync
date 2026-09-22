# Development and releases

Use short-lived branches and pull requests into `master`. Require the CI `verify` job and squash merge. PRs describe the result and validation. No separate development branch or commit-message convention is required.

## Version a release

1. Update `package.json` to a three-part numeric version and refresh `package-lock.json` with `npm install --package-lock-only` in the container.
2. Move meaningful user changes from `Unreleased` into a dated `CHANGELOG.md` entry: `## X.Y.Z (YYYY-MM-DD)`.
3. Run `npm run verify` and the manual smoke checks. Merge the release PR, then create and push `vX.Y.Z` at that commit.

Patch versions fix defects; minor versions add compatible functionality; major versions change behavior incompatibly. Internal restructuring alone does not require a major version. The package version is the source of truth for the built manifest. Chrome versions use numeric components; prerelease suffixes are not supported by this workflow.

The tag workflow checks the version and changelog, runs the container checks, and attaches the extension ZIP to a GitHub Release. Release notes come from the changelog. GitHub provides source archives from the tag. Never replace a published version's tag or ZIP; issue a new version.

## Chrome Web Store upload

Create the store item and complete its listing and privacy details in the developer dashboard. Enable the Chrome Web Store API and obtain OAuth credentials with the `chromewebstore` scope using the [official setup guide](https://developer.chrome.com/docs/webstore/using-api).

Configure the GitHub environment `chrome-web-store`:

| Kind      | Names                                                     |
| --------- | --------------------------------------------------------- |
| Variables | `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`                    |
| Secrets   | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` |

Run **Store upload** from `master` with a GitHub Release version such as `1.0.0`. It downloads that release's ZIP, verifies its manifest version, uploads once, and checks processing status. Credentials are passed only to the upload container. Uploads are serialized. Check the dashboard before retrying a failed or timed-out upload.

This workflow uploads the package only. Submit it for review in the dashboard; upload success does not mean approval or publication. Store credentials and listing configuration are external to the repository.
