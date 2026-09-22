# Development and releases

Use short-lived branches and pull requests into `master`. Require the CI `verify` job and squash merge. PRs describe the result and validation. No separate development branch or commit-message convention is required.

## Version a release

1. Update `package.json` to a three-part numeric version and refresh `package-lock.json` with `npm install --package-lock-only` in the container.
2. Move meaningful user changes from `Unreleased` into a dated `CHANGELOG.md` entry: `## X.Y.Z (YYYY-MM-DD)`.
3. Run `npm run verify` and the manual smoke checks. Merge the release PR, then create and push `vX.Y.Z` at that commit.

Patch versions fix defects; minor versions add compatible functionality; major versions change behavior incompatibly. Internal restructuring alone does not require a major version. The package version is the source of truth for the built manifest. Chrome versions use numeric components; prerelease suffixes are not supported by this workflow.

The tag workflow checks the version and changelog, runs the container checks, and attaches the extension ZIP to a GitHub Release. Release notes come from the changelog. GitHub provides source archives from the tag. Never replace a published version's tag or ZIP; issue a new version.

## Chrome Web Store publishing

Create the store item and complete its listing and privacy details in the developer dashboard. Enable the Chrome Web Store API and link the Google service account in the dashboard's Account section using the [official service account guide](https://developer.chrome.com/docs/webstore/service-accounts).

Configure [Workload Identity Federation through a service account](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account) for this repository. No stored OAuth secrets are required.

Configure these variables in the GitHub environment `chrome-web-store`, allowing `master` and version tags:

| Kind      | Names                                                   |
| --------- | ------------------------------------------------------- |
| Variables | `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`                  |
| Variables | `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER` |

After a tag release succeeds, **Publish Chrome Extension** uploads its ZIP and submits it for review. To publish an existing GitHub Release, run it manually from `master` with a version such as `1.1.0`. It verifies the ZIP version and waits for upload processing to succeed before submitting. Store jobs are serialized.

Validation warnings block submission; approval triggers publication. Check the dashboard before retrying failures or timeouts, as reruns upload again. Store credentials and listing configuration are external to the repository.
