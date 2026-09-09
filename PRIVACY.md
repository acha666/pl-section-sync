# Privacy

PL Section Sync processes the selected Canvas Gradebook CSV locally. It keeps Canvas IDs, student names, SIS Login IDs, and sections in panel memory for matching; grades and other columns are discarded. PrairieLearn identifiers, names, enrollment status, and label memberships are held in memory to prepare and verify changes.

The extension communicates only with the selected PrairieLearn site through its existing signed-in session. Membership updates send enrollment IDs. Label creation sends a name, color, and empty UID list. It does not upload grades, invite students, or change enrollment status.

No analytics, advertising, telemetry, remote scripts, or external backend is used. CSV contents, student lists, credentials, and operation names are not stored persistently. Chrome session storage holds the selected tab/course context and a small progress marker. It clears when the browser session ends or the extension is removed. Closing the panel releases imported data from memory.

CSRF tokens are obtained and used inside Chrome's isolated execution world. They are not returned to the panel or stored. The browser sends same-origin cookies; the extension does not read cookie values.

## Permissions

- `activeTab`: temporary access to the tab selected through the extension icon.
- `scripting`: run the packaged PrairieLearn adapter in the selected document.
- `sidePanel`: display the extension interface.
- `storage`: keep session-only source context and recovery progress.

No broad host permissions or continuously running content scripts are requested.
