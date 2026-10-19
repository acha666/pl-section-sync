import { render } from 'preact';
import { createClient } from './pl/client.js';
import { parseTarget } from './pl/parse.js';
import { Controller } from './ui/controller.js';
import { Panel } from './ui/view.js';
import './panel.css';

const root = document.getElementById('app')!;
const controller: Controller = new Controller(
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
  (state) => render(<Panel controller={controller} state={state} />, root),
);
render(<Panel controller={controller} state={controller.state} />, root);
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
