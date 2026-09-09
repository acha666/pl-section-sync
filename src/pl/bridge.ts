import type { Command, Context, Reply } from '../core/types.js';
/** Runs in Chrome's isolated world. No page UI or page JavaScript is changed. */
export async function pageRequest(context: Context, command: Command): Promise<Reply> {
  // executeScript copies this function; all runtime helpers must remain inside it.
  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Unsupported PrairieLearn response.');
    return value as Record<string, unknown>;
  }
  let writing = false;
  try {
    function assertContext() {
      const match = location.pathname.match(
        /^(.*\/course_instance\/(\d+)\/instructor)\/instance_admin\/students(?:\/labels)?\/?$/,
      );
      if (location.origin !== context.origin || !match || match[1] !== context.base)
        throw new Error(
          'The source tab changed. Open the intended Students page and import again.',
        );
    }
    assertContext();
    const base = context.base;
    async function request(path: string, body?: unknown, token?: string) {
      assertContext();
      const response = await fetch(path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(90000),
        headers: {
          Accept: 'application/json',
          ...(token ? { 'X-TRPC': 'true', 'X-CSRF-Token': token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify({ json: body }) } : {}),
      });
      if (!response.ok)
        throw new Error(
          `PrairieLearn returned HTTP ${response.status}. Refresh the source page and import again.`,
        );
      return response;
    }
    const html = await request(`${base}/instance_admin/students`);
    const doc = new DOMParser().parseFromString(await html.text(), 'text/html');
    const node = doc.querySelector(
      'script[type="application/json"][data-component="InstructorStudents"][data-component-props]',
    );
    if (!node)
      throw new Error(
        'PrairieLearn student page is unavailable or incompatible. Check your login and course access.',
      );
    const props = object(object(JSON.parse(node.textContent ?? '') as unknown).json);
    const courseInstance = object(props.courseInstance),
      course = object(props.course ?? {}),
      authz = object(props.authzData ?? {});
    if (courseInstance.id !== context.courseId || typeof props.trpcCsrfToken !== 'string')
      throw new Error('PrairieLearn course context or CSRF token is unavailable.');
    const canEdit =
      authz.has_course_permission_edit === true &&
      authz.has_course_instance_permission_edit === true;
    const token = props.trpcCsrfToken;
    async function rpc(method: string, body?: unknown): Promise<unknown> {
      const response = await request(`${base}/trpc/studentLabels.${method}`, body, token);
      const data = object((await response.json()) as unknown);
      if (data.error) {
        const error = object(data.error);
        const detail = object(error.json ?? error);
        throw new Error(
          typeof detail.message === 'string'
            ? detail.message
            : 'PrairieLearn rejected the operation.',
        );
      }
      const result = object(object(data.result).data);
      if (!Object.hasOwn(result, 'json')) throw new Error('Unsupported tRPC response.');
      return result.json;
    }
    if (command.type === 'read') {
      const [roster, labels] = await Promise.all([
        request(`${base}/instance_admin/students/data.json`).then((r) => r.json()),
        rpc('list'),
      ]);
      return {
        ok: true,
        value: {
          roster,
          labels,
          canEdit,
          title:
            [
              course.short_name ?? course.title,
              courseInstance.long_name ?? courseInstance.short_name,
            ]
              .filter((value): value is string => typeof value === 'string' && value.length > 0)
              .join(' · ') || `Course instance ${context.courseId}`,
        },
      };
    }
    if (!canEdit)
      throw new Error(
        'Editing requires course edit and course-instance student-data edit permissions.',
      );
    const { method, input } = command;
    if (!['upsert', 'destroy', 'batchAdd', 'batchRemove'].includes(method))
      throw new Error('Unsupported operation.');
    // Credentials never leave this isolated function or enter extension storage.
    writing = true;
    return { ok: true, value: await rpc(method, input) };
  } catch (error) {
    return {
      ok: false,
      uncertain: writing,
      message: error instanceof Error ? error.message : 'PrairieLearn request failed.',
    };
  }
}
