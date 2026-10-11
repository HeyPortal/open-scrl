import { expect, test as base, type WebError } from '@playwright/test';

// Listen on the context so additional tabs and popups receive the same checks.
export const test = base.extend<{ browserErrors: void }>({
  browserErrors: [async ({ context }, runTest, testInfo) => {
    const errors: string[] = [];
    const recordError = (event: WebError) => {
      const error = event.error();
      errors.push(`${event.page()?.url() ?? 'Unknown page'}\n${error.stack ?? error.message}`);
    };
    context.on('weberror', recordError);
    try {
      await runTest();
    } finally {
      context.off('weberror', recordError);
      if (errors.length) {
        await testInfo.attach('browser-errors', { body: errors.join('\n\n'), contentType: 'text/plain' });
      }
      expect(errors, 'Uncaught browser errors').toEqual([]);
    }
  }, { auto: true }],
});

export { expect };
export type { CDPSession, Download, Page } from '@playwright/test';
