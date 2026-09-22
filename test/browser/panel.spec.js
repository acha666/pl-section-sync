import { test, expect } from '@playwright/test';

test('imports, previews, verifies a sync, and requires fresh data', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Example course · Term A' })).toBeVisible();
  await page.getByRole('button', { name: 'Load synthetic CSV' }).click();
  await expect(page.locator('#match-summary')).toHaveText('1 student matched');
  await page.getByRole('button', { name: 'Confirm labels & preview' }).click();
  await expect(page.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  await page.locator('#delete-confirm').check();
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('#notice')).toHaveText(
    'Changes verified. Refresh the PrairieLearn page.',
  );
  await expect(page.locator('#csv')).toBeDisabled();
  await expect(page.locator('#preview')).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#csv')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('mapping edits keep focus and invalidate a preview', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#csv')).toBeEnabled();
  await page.getByRole('button', { name: 'Load synthetic CSV' }).click();
  await page.locator('#preview').click();
  const field = page.locator('#mappings textarea').first();
  await field.fill('Custom');
  await field.press('End');
  await field.pressSequentially(' label');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Custom label');
  await expect(page.locator('#review')).toBeHidden();
  await page.locator('#preview').click();
  await expect(page.locator('#changes')).toContainText('Section Custom label');
});

for (const width of [300, 380, 600])
  test(`panel fits ${width}px and reports import errors`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.locator('#csv')).toBeEnabled();
    await page.locator('#csv').setInputFiles({
      name: 'bad.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('ID,Section\n1,A'),
    });
    await expect(page.locator('#notice')).toContainText('Missing CSV column');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('#csv')).toBeEnabled();
    await page.getByRole('button', { name: 'Load synthetic CSV' }).click();
    await page.locator('#preview').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('preview.png'), fullPage: true });
  });

test('regex rules clean imported labels and update the preview', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#csv')).toBeEnabled();
  await page.locator('#csv').setInputFiles({
    name: 'sections.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Student,ID,SIS Login ID,Section\nOne,10,001,APSC_V 160 102 2026W1 and APSC_V 160 L1W 2026W1',
    ),
  });
  await page.getByText('Clean up labels with regex', { exact: true }).click();
  const field = page.locator('#mappings textarea').first();
  const replace = async (pattern, replacement) => {
    await page.getByLabel('Regular expression', { exact: true }).fill(pattern);
    await page.getByLabel('Replacement', { exact: true }).fill(replacement);
    await page.getByRole('button', { name: 'Replace in labels' }).click();
  };
  await replace('^APSC_V 160 (\\S+) 2026W1$', '$1');
  await expect(field).toHaveValue('102\nL1W');
  await page.locator('#preview').click();
  await page.locator('#delete-confirm').check();
  await replace('^(\\d+)$', 'Lecture $1');
  await expect(page.locator('#review')).toBeHidden();
  await expect(page.locator('#delete-confirm')).not.toBeChecked();
  await replace('^(L\\w+)$', 'Lab $1');
  await expect(field).toHaveValue('Lecture 102\nLab L1W');
  await replace('[', '');
  await expect(page.locator('#notice')).toHaveClass(/error/);
  await expect(field).toHaveValue('Lecture 102\nLab L1W');
  await page.locator('#preview').click();
  await expect(page.locator('#changes')).toContainText('Section Lecture 102');
  await expect(page.locator('#changes')).toContainText('Section Lab L1W');
});
