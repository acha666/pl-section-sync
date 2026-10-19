import { createClient } from './pl/client.js';
import { parseTarget } from './pl/parse.js';
import { Controller } from './ui/controller.js';
import { createView } from './ui/view.js';
import type { State } from './ui/controller.js';

let render: (state: State) => void = () => {};
const controller = new Controller(
  {
    client: createClient,
    storage: chrome.storage.session,
    async lock(task) {
      return navigator.locks.request('pl-section-sync', { ifAvailable: true }, async (lock) => {
        if (!lock) return false;
        await task();
        return true;
      });
    },
  },
  (state) => render(state),
);
render = createView(controller);
render(controller.state);
const version = document.getElementById('version');
if (version) version.textContent = `Version ${chrome.runtime.getManifest().version}`;
try {
  const windowId = (await chrome.windows.getCurrent()).id;
  if (windowId === undefined) throw new Error('The browser window is unavailable.');
  const key = `target:${windowId}`;
  const accept = (value: unknown) => {
    if (value === undefined) return;
    try {
      void controller
        .accept(parseTarget(value, windowId))
        .catch((error: unknown) => controller.report(error));
    } catch (error) {
      controller.report(error);
    }
  };
  let changed = false;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[key]) {
      changed = true;
      accept(changes[key].newValue);
    }
  });
  const initial = await chrome.storage.session.get(key);
  if (!changed) accept(initial[key]);
} catch (error) {
  controller.report(error);
}
