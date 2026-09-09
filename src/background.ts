import { contextFromUrl, message, requireValue } from './core/model.js';
import type { Target } from './core/types.js';

chrome.action.onClicked.addListener((tab) => {
  const opening = chrome.sidePanel.open({ windowId: tab.windowId });
  let target: Target;
  const identity = { windowId: tab.windowId, nonce: crypto.randomUUID() };
  try {
    requireValue(tab.url && tab.id !== undefined, 'The selected tab is unavailable.');
    target = { ...identity, context: contextFromUrl(tab.url, tab.id) };
  } catch (error) {
    target = { ...identity, error: message(error) };
  }
  void chrome.storage.session
    .set({ [`target:${tab.windowId}`]: target })
    .catch(() => chrome.action.setBadgeText({ tabId: tab.id, text: '!' }));
  void opening
    .then(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }))
    .catch(() => chrome.action.setBadgeText({ tabId: tab.id, text: '!' }));
});
