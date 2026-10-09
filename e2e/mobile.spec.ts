import { expect, test, type Page } from '@playwright/test';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
/** Dock tab labels, in order. */
const TOOL_TAB_LABELS = ['Photos', 'Grids', 'Text', 'Shapes', 'Canvas', 'Layers'];

/** Collects uncaught page errors; each test asserts the list is empty at the end. */
function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const dock = (page: Page) => page.getByRole('tablist', { name: 'Editor tools' });
const dockTab = (page: Page, name: string) => dock(page).getByRole('tab', { name, exact: true });
const sheetRegion = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
const selectionBar = (page: Page) => page.getByRole('toolbar', { name: 'Selection actions' });
const addSlideButton = (page: Page) => page.getByRole('button', { name: 'Add slide', exact: true });
const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo', exact: true });

/** Home screen -> "Create carousel" -> mobile editor. */
async function createCarousel(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
  await expect(dock(page)).toBeVisible();
}

/** Adds a rectangle from the Shapes sheet and closes the sheet, leaving the new shape selected. */
async function addRectangle(page: Page) {
  await dockTab(page, 'Shapes').tap();
  await sheetRegion(page, 'Shapes').getByRole('button', { name: 'Rectangle', exact: true }).tap();
  await page.getByRole('button', { name: 'Close Shapes', exact: true }).tap();
  await expect(sheetRegion(page, 'Shapes')).toHaveCount(0);
}

test.describe('mobile editor', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('fresh profile shows the mobile home and "Create carousel" opens the mobile editor', async ({ page }) => {
    const errors = trackPageErrors(page);

    await test.step('Mobile home instead of the desktop landing page', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Open-SCRL', level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'No carousels yet' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'New project' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Create & open editor' })).toHaveCount(0);
    });

    await test.step('"Create carousel" opens the mobile editor', async () => {
      await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
      await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
      await expect(dock(page).getByRole('tab')).toHaveText(TOOL_TAB_LABELS);
      await expect(page.getByRole('heading', { name: 'No carousels yet' })).toHaveCount(0);
    });

    expect(errors).toEqual([]);
  });

  test('dock tabs open, switch, and close their sheets; the slide strip hides while a sheet is open', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);
    await expect(addSlideButton(page)).toBeVisible();

    for (const name of TOOL_TAB_LABELS) {
      await test.step(`${name} tab opens its sheet, and tapping it again closes the sheet`, async () => {
        await dockTab(page, name).tap();
        await expect(dockTab(page, name)).toHaveAttribute('aria-selected', 'true');
        await expect(sheetRegion(page, name)).toBeVisible();
        await expect(addSlideButton(page)).toBeHidden();

        await dockTab(page, name).tap();
        await expect(sheetRegion(page, name)).toHaveCount(0);
        await expect(dockTab(page, name)).toHaveAttribute('aria-selected', 'false');
        await expect(addSlideButton(page)).toBeVisible();
      });
    }

    await test.step('Tapping another tab switches the sheet', async () => {
      await dockTab(page, 'Photos').tap();
      await expect(sheetRegion(page, 'Photos')).toBeVisible();
      await dockTab(page, 'Text').tap();
      await expect(sheetRegion(page, 'Text')).toBeVisible();
      await expect(sheetRegion(page, 'Photos')).toHaveCount(0);
      await expect(dockTab(page, 'Photos')).toHaveAttribute('aria-selected', 'false');
      await expect(dockTab(page, 'Text')).toHaveAttribute('aria-selected', 'true');
    });

    await test.step('The sheet close button closes it', async () => {
      await dockTab(page, 'Shapes').tap();
      await expect(sheetRegion(page, 'Shapes')).toBeVisible();
      await page.getByRole('button', { name: 'Close Shapes', exact: true }).tap();
      await expect(sheetRegion(page, 'Shapes')).toHaveCount(0);
      await expect(dockTab(page, 'Shapes')).toHaveAttribute('aria-selected', 'false');
      await expect(addSlideButton(page)).toBeVisible();
    });

    expect(errors).toEqual([]);
  });

  test('adding a shape selects it; the selection bar replaces the dock and Done restores it', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);

    await test.step('Shape added from the Shapes sheet is selected and the selection bar shows', async () => {
      await addRectangle(page);
      await expect(selectionBar(page)).toBeVisible();
      await expect(page.getByRole('status', { name: 'Selected: Shape' })).toBeVisible();
      await expect(selectionBar(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
      await expect(selectionBar(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeVisible();
      await expect(selectionBar(page).getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
      await expect(dock(page)).toHaveCount(0);
    });

    await test.step('Duplicate adds a second layer', async () => {
      await selectionBar(page).getByRole('button', { name: 'Duplicate', exact: true }).tap();
      await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
      await expect(selectionBar(page)).toHaveCount(0);
      await expect(dock(page)).toBeVisible();

      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers').getByRole('option')).toHaveCount(2);
      // Selecting a row from the Layers sheet brings the selection bar back once the sheet closes.
      await sheetRegion(page, 'Layers').getByRole('option').first().tap();
      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers')).toHaveCount(0);
      await expect(selectionBar(page)).toBeVisible();
    });

    await test.step('Edit opens the inspector; Done clears the selection and restores the dock', async () => {
      await selectionBar(page).getByRole('button', { name: 'Edit', exact: true }).tap();
      await expect(sheetRegion(page, 'Shape')).toBeVisible();
      await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
      await expect(selectionBar(page)).toHaveCount(0);
      await expect(sheetRegion(page, 'Shape')).toHaveCount(0);
      await expect(dock(page)).toBeVisible();
      await expect(dockTab(page, 'Layers')).toHaveAttribute('aria-selected', 'false');
    });

    expect(errors).toEqual([]);
  });

  test('top bar undo and redo revert and restore an added shape', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);
    await expect(undoButton(page)).toBeDisabled();

    await test.step('Adding a shape enables Undo', async () => {
      await addRectangle(page);
      await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
      await expect(undoButton(page)).toBeEnabled();
      await expect(redoButton(page)).toBeDisabled();
    });

    await test.step('Undo removes the shape and enables Redo', async () => {
      await undoButton(page).tap();
      await expect(redoButton(page)).toBeEnabled();
      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers').getByText('Empty slide')).toBeVisible();
      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers')).toHaveCount(0);
    });

    await test.step('Redo restores the shape', async () => {
      await redoButton(page).tap();
      await expect(redoButton(page)).toBeDisabled();
      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers').getByRole('option')).toHaveCount(1);
      await dockTab(page, 'Layers').tap();
    });

    expect(errors).toEqual([]);
  });

  test('the slide strip adds a slide and the slide actions menu deletes it again', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);
    await expect(page.getByRole('status', { name: 'Slide 1 of 1' })).toBeVisible();

    await test.step('"+" tile adds a second slide', async () => {
      await addSlideButton(page).tap();
      await expect(page.getByRole('status', { name: 'Slide 2 of 2' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Slide \d/ })).toHaveCount(2);
    });

    await test.step('Tapping the selected thumbnail opens slide actions', async () => {
      await page.getByRole('button', { name: /^Slide 2, selected/ }).tap();
      const menu = page.getByRole('menu', { name: 'Slide actions' });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
    });

    await test.step('Delete returns the project to one slide', async () => {
      await page.getByRole('menu', { name: 'Slide actions' }).getByRole('menuitem', { name: 'Delete', exact: true }).tap();
      await expect(page.getByRole('menu', { name: 'Slide actions' })).toHaveCount(0);
      await expect(page.getByRole('status', { name: 'Slide 1 of 1' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Slide \d/ })).toHaveCount(1);
    });

    expect(errors).toEqual([]);
  });

  test('importing a photo in the Photos sheet and tapping it adds an image layer', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);

    await dockTab(page, 'Photos').tap();
    await expect(sheetRegion(page, 'Photos')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: tinyPng });
    await expect(page.getByText('Imported 1 media file.')).toBeVisible();

    await sheetRegion(page, 'Photos').getByAltText('tiny.png').tap();
    await page.getByRole('button', { name: 'Close Photos', exact: true }).tap();

    await expect(page.getByRole('status', { name: 'Selected: Photo' })).toBeVisible();
    await expect(selectionBar(page).getByRole('button', { name: 'Replace', exact: true })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the Export sheet offers three options and "Export carousel" downloads a ZIP', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);

    await test.step('Export opens the sheet with its three options', async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).tap();
      const exportSheet = sheetRegion(page, 'Export');
      await expect(exportSheet).toBeVisible();
      await expect(exportSheet.getByRole('button', { name: /^Export carousel/ })).toBeVisible();
      await expect(exportSheet.getByRole('button', { name: /^Save this slide/ })).toBeVisible();
      await expect(exportSheet.getByRole('button', { name: /^Preview on phone/ })).toBeVisible();
    });

    await test.step('Export carousel triggers a ZIP download', async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        sheetRegion(page, 'Export').getByRole('button', { name: /^Export carousel/ }).tap(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
      expect(await download.failure()).toBeNull();
    });

    expect(errors).toEqual([]);
  });

  test('renaming in the Project sheet shows on the home list and reopens the project', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);

    await test.step('Rename the project in the Project sheet', async () => {
      await page.getByRole('button', { name: /^Project settings:/ }).tap();
      await expect(sheetRegion(page, 'Project')).toBeVisible();
      await page.getByLabel('Project name', { exact: true }).fill('Beach trip');
      await expect(page.getByRole('button', { name: 'Project settings: Beach trip', exact: true })).toBeVisible();
    });

    await test.step('Back to projects lists the renamed project', async () => {
      await page.getByRole('button', { name: 'Back to projects', exact: true }).tap();
      await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open Beach trip', exact: true })).toBeVisible();
    });

    await test.step('Tapping the project reopens the editor', async () => {
      await page.getByRole('button', { name: 'Open Beach trip', exact: true }).tap();
      await expect(page.getByRole('button', { name: 'Project settings: Beach trip', exact: true })).toBeVisible();
      await expect(dock(page)).toBeVisible();
    });

    expect(errors).toEqual([]);
  });
});

test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('desktop landing page and editor render without the mobile dock', async ({ page }) => {
    const errors = trackPageErrors(page);

    await test.step('Desktop landing page, not the mobile home', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create & open editor' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Start from a grid' })).toHaveCount(0);
    });

    await test.step('Desktop editor with the side tools, not the mobile dock', async () => {
      await page.getByRole('button', { name: 'Create & open editor' }).click();
      await expect(page.getByTitle('Zoom out')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
      await expect(dock(page)).toHaveCount(0);
    });

    expect(errors).toEqual([]);
  });
});
