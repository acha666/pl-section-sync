import { pageRequest } from './bridge.js';
import {
  object,
  parseLabels,
  parseRoster,
  requireValue,
  RequestError,
  string,
} from '../core/model.js';
import type { Client, Command, Context, Reply } from '../core/types.js';

export function createClient(context: Context): Client {
  let documentId: string | undefined;
  async function call(command: Command): Promise<unknown> {
    let result: chrome.scripting.InjectionResult<Reply> | undefined;
    try {
      [result] = await chrome.scripting.executeScript({
        target: documentId
          ? { tabId: context.tabId, documentIds: [documentId] }
          : { tabId: context.tabId },
        world: 'ISOLATED',
        func: pageRequest,
        args: [context, command],
      });
    } catch {
      throw new RequestError(
        'The source page closed, navigated, or lost access. Reopen it and import again.',
        command.type !== 'read',
      );
    }
    requireValue(result?.documentId, 'Chrome did not return a source document.');
    documentId ??= result.documentId;
    const reply = result.result;
    if (!reply?.ok)
      throw new RequestError(
        reply?.message ?? 'The source page did not respond.',
        reply?.uncertain ?? command.type !== 'read',
      );
    return reply.value;
  }
  return {
    async read() {
      const data = object(await call({ type: 'read' }));
      requireValue(typeof data.canEdit === 'boolean', 'Unsupported edit permissions.');
      return {
        roster: parseRoster(data.roster, context.courseId),
        ...parseLabels(data.labels),
        title: string(data.title),
        canEdit: data.canEdit,
      };
    },
    mutate: (command) => call({ type: 'write', ...command }),
  };
}
