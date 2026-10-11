import { expect, test, type Page } from './fixtures/test';

interface Seed { name: string; format?: string; slides?: number }

/** Creates saved projects through the app's own store (as the editor would) and returns to the home screen. */
async function seedProjects(page: Page, projects: Seed[]) {
  // App loads the project index after its fonts are ready. Seeding before
  // that load completes lets its stale snapshot replace the new summaries.
  await expect(page.getByRole('button', { name: 'Create carousel' })).toBeVisible();
  await page.evaluate(async (list) => {
    const editorModule = '/src/store/editor.ts';
    const formatModule = '/src/lib/format.ts';
    const { useEditor } = await import(/* @vite-ignore */ editorModule);
    const { FORMATS } = await import(/* @vite-ignore */ formatModule);
    for (const project of list) {
      const format = FORMATS.find((f: { name: string }) => f.name === project.format) ?? FORMATS[0];
      await useEditor.getState().newProject(format, project.name);
      for (let i = 1; i < (project.slides ?? 1); i++) useEditor.getState().addSlide();
      await useEditor.getState().closeProject();
    }
  }, projects);
}

const names = (strings: string[]) => strings.map((name) => ({ name }));
const cardNames = (page: Page) => page.locator('.home-grid .home-card-name');

test.describe('desktop home', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('creates a project with the chosen format and name', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Recent projects' })).toBeVisible();

    const formats = page.getByRole('radiogroup', { name: 'Canvas format' });
    await expect(formats.getByRole('radio')).toHaveCount(6);
    await expect(formats.getByRole('radio', { name: /IG Portrait/ })).toHaveAttribute('aria-checked', 'true');
    await formats.getByRole('radio', { name: /IG Square/ }).click();
    await expect(formats.getByRole('radio', { name: /IG Square/ })).toHaveAttribute('aria-checked', 'true');
    await expect(formats.getByRole('radio', { name: /IG Portrait/ })).toHaveAttribute('aria-checked', 'false');

    await page.getByLabel('Project name').fill('New project test');
    await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
    await expect(page.getByTitle('Zoom out')).toBeVisible();
    await expect(page.getByLabel('Project name')).toHaveValue('New project test');
    await expect(page.getByLabel('Canvas format')).toHaveValue('IG Square');
  });

  test('format cards move with the arrow keys', async ({ page }) => {
    await page.goto('/');
    const formats = page.getByRole('radiogroup', { name: 'Canvas format' });
    await formats.getByRole('radio', { name: /IG Portrait/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(formats.getByRole('radio', { name: /IG Square/ })).toHaveAttribute('aria-checked', 'true');
    await expect(formats.getByRole('radio', { name: /IG Square/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(formats.getByRole('radio', { name: /Pinterest/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('empty profile shows a quiet empty state under the create row', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'No carousels yet' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Continue editing' })).toHaveCount(0);
    await expect(page.getByLabel('Search projects')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'New carousel', exact: true })).toHaveCount(0);
  });

  test('recent projects shows the latest project once and opens it', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, [{ name: 'Older', format: 'IG Landscape', slides: 3 }, { name: 'Newest', format: 'IG Story / Reels', slides: 2 }]);
    const recent = page.getByRole('region', { name: /Recent projects/ });
    const newest = recent.getByRole('button', { name: 'Open Newest', exact: true });
    await expect(newest).toHaveCount(1);
    await expect(newest).toContainText('IG Story / Reels · 2 slides');
    await expect(cardNames(page)).toHaveText(['Newest', 'Older']);
    await newest.click();
    await expect(page.getByTitle('Zoom out')).toBeVisible();
    await expect(page.getByLabel('Project name')).toHaveValue('Newest');
  });

  test('project cards open projects, show relative times with the date in a title, and load real previews', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, names(['Alpha', 'Bravo']));

    const card = page.getByRole('button', { name: 'Open Alpha', exact: true });
    await expect(card).toBeVisible();
    await expect(card).toContainText('IG Portrait · 1 slide');
    const time = card.locator('.home-card-time');
    await expect(time).toHaveText('Edited just now');
    expect(await time.getAttribute('title')).toMatch(/\d{4}/);
    // Recent projects are visible beside creation; their real previews render lazily.
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.home-frame[data-status="ready"] img')).toBeVisible();
    await expect(card.locator('.home-frame')).toHaveAttribute('style', /--r: 0\.8/);

    await card.click();
    await expect(page.getByLabel('Project name')).toHaveValue('Alpha');
  });

  test('search, no-match state and Clear search', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, names(['Alpine trip', 'Beach day', 'City lights', 'Autumn']));
    await expect(page.locator('.home-grid .home-card')).toHaveCount(4);

    const search = page.getByLabel('Search projects');
    await search.fill('al');
    await expect(cardNames(page)).toHaveText(['Alpine trip']);

    await search.fill('zzz');
    await expect(page.locator('.home-grid')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('No projects match “zzz”.');
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
    await expect(page.locator('.home-grid .home-card')).toHaveCount(4);
  });

  test('sorting by name, date created and last edited', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, names(['Bravo', 'Alpha', 'Charlie']));
    const sort = page.getByLabel('Sort projects');
    await expect(sort).toHaveValue('updated');
    await expect(cardNames(page)).toHaveText(['Charlie', 'Alpha', 'Bravo']);
    await sort.selectOption('name');
    await expect(cardNames(page)).toHaveText(['Alpha', 'Bravo', 'Charlie']);
    await sort.selectOption('created');
    await expect(cardNames(page)).toHaveText(['Charlie', 'Alpha', 'Bravo']);
  });

  test('grid and list views switch and are remembered', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, names(['One', 'Two']));
    const view = page.getByRole('group', { name: 'Project view' });
    await expect(view.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.home-grid')).toBeVisible();

    await view.getByRole('button', { name: 'List view' }).click();
    await expect(page.locator('.home-list .home-row')).toHaveCount(2);
    await expect(page.locator('.home-grid')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.home-list .home-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Grid view' }).click();
    await expect(page.locator('.home-grid .home-card')).toHaveCount(2);
  });

  test('a grid starter creates a project with that grid on its first slide', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radiogroup', { name: 'Canvas format' }).getByRole('radio', { name: /IG Square/ }).click();
    await page.getByLabel('Project name').fill('Grid start');
    await expect(page.getByRole('button', { name: 'Start with 2 side grid', exact: true })).toBeHidden();
    await page.locator('.home-grid-options > summary').click();
    await page.getByRole('button', { name: 'Start with 2 side grid', exact: true }).click();
    await expect(page.getByTitle('Zoom out')).toBeVisible();
    await expect(page.getByLabel('Project name')).toHaveValue('Grid start');
    await expect(page.getByLabel('Canvas format')).toHaveValue('IG Square');

    const grid = await page.evaluate(async () => {
      const editorModule = '/src/store/editor.ts';
      const { useEditor } = await import(/* @vite-ignore */ editorModule);
      const { doc } = useEditor.getState();
      return doc.slides[doc.slideOrder[0]].grid;
    });
    expect(grid).toMatchObject({ templateId: 'two-v', gap: 16, margin: 16 });
    expect(grid?.slotIds).toHaveLength(2);
  });

  test('the header "New carousel" button scrolls to and focuses the create panel', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, names(Array.from({ length: 16 }, (_, index) => `Project ${index + 1}`)));
    const scroller = page.locator('[data-home-scroll]');
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(200);

    await page.getByRole('button', { name: 'New carousel', exact: true }).click();
    await expect(page.getByLabel('Project name')).toBeFocused();
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('footer states what the app is and where files stay', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toContainText('MIT licensed');
    await expect(page.getByRole('contentinfo')).toContainText('Your files never leave this device');
  });
});

test.describe('phone home', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  const pill = (page: Page) => page.getByRole('button', { name: 'New carousel', exact: true });

  test('creates from the card with a chosen format and name', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'No carousels yet' })).toBeVisible();
    await page.getByRole('radio', { name: /IG Story/ }).tap();
    await expect(page.getByRole('radio', { name: /IG Story/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('Project name', { exact: true }).fill('Phone hero');
    await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
    await expect(page.getByRole('tablist', { name: 'Editor tools' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Project settings: Phone hero', exact: true })).toBeVisible();
  });

  test('recent project rows open projects with relative times and previews', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, [{ name: 'Earlier', slides: 4 }, { name: 'Latest', format: 'IG Square', slides: 2 }]);
    const row = page.getByRole('button', { name: 'Open Latest', exact: true });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('IG Square · 2 slides');
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator('.home-frame[data-status="ready"] img')).toBeVisible();
    const earlier = page.getByRole('button', { name: 'Open Earlier', exact: true });
    await expect(earlier).toContainText('IG Portrait · 4 slides');
    await expect(earlier).toContainText('Edited just now');
    await expect(earlier.locator('.home-prow-time')).toHaveAttribute('title', /\d{4}/);
    await row.tap();
    await expect(page.getByRole('button', { name: 'Project settings: Latest', exact: true })).toBeVisible();
  });

  test('search, no-match state and Clear search', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, names(['Alpine trip', 'Beach day', 'City lights', 'Autumn']));
    const search = page.getByLabel('Search projects');
    await search.scrollIntoViewIfNeeded();
    await search.fill('beach');
    await expect(page.locator('.home-plist-rows > li')).toHaveCount(1);
    await search.fill('zzz');
    await expect(page.getByRole('status')).toContainText('No projects match “zzz”.');
    await page.getByRole('button', { name: 'Clear search' }).tap();
    await expect(search).toHaveValue('');
    await expect(page.locator('.home-plist-rows > li')).toHaveCount(4);
  });

  test('the floating New carousel pill appears after scrolling and returns to the create card', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, names(['A', 'B', 'C', 'D', 'E', 'F']));
    const scroller = page.locator('[data-home-scroll]');
    const createButton = page.getByRole('button', { name: 'Create carousel', exact: true });

    await expect(createButton).toBeInViewport();
    await expect(pill(page)).toBeHidden();

    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(pill(page)).toBeVisible();
    await expect(createButton).not.toBeInViewport();
    // Visibility can precede the end of the entrance transition. Keep the
    // clearance requirement and wait for it against the actual viewport.
    await expect.poll(() => pill(page).evaluate((button) =>
      window.innerHeight - button.getBoundingClientRect().bottom,
    )).toBeGreaterThanOrEqual(8);

    await pill(page).tap();
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(createButton).toBeInViewport();
    await expect(pill(page)).toBeHidden();
  });

  test('the pill hides while a text field is focused (keyboard up)', async ({ page }) => {
    await page.goto('/');
    await seedProjects(page, names(['A', 'B', 'C', 'D', 'E', 'F']));
    const scroller = page.locator('[data-home-scroll]');
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(pill(page)).toBeVisible();
    await page.getByLabel('Search projects').focus();
    await expect(pill(page)).toBeHidden();
    await page.getByLabel('Search projects').blur();
    await expect(pill(page)).toBeVisible();
  });
});
