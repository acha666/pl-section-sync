import { requireValue } from '../core/model.js';
import type { Context } from '../core/types.js';

/** Derives the course context from a PrairieLearn Students or Student labels URL. */
export function contextFromUrl(value: string, tabId: number): Context {
  const url = new URL(value);
  const match = url.pathname.match(
    /^(.*\/course_instance\/(\d+)\/instructor)\/instance_admin\/students(?:\/labels)?\/?$/,
  );
  requireValue(
    ['https:', 'http:'].includes(url.protocol) && match,
    'Open a PrairieLearn Students or Student labels page, then click the extension icon.',
  );
  return { tabId, origin: url.origin, base: match[1]!, courseId: match[2]! };
}
