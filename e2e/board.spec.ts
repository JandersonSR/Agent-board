import { expect, test, type Page } from '@playwright/test';

// Cada teste começa em inglês e no tema claro; erros de JavaScript na página derrubam o teste.
async function open(page: Page, view = 'overview') {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(v => {
    localStorage.setItem('ab3.lang', 'en');
    localStorage.setItem('ab3.theme', 'light');
    localStorage.setItem('ab3.view', v);
  }, view);
  await page.goto('/');
  return errors;
}
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name });

test('todas as telas abrem sem erro, com o aviso de demonstração', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByText('demo mode')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Attention' })).toBeVisible();
  for (const [screen, marker] of [
    ['Agents', 'Needs you'], ['PRs and deploys', 'Hotfix: installment off by one cent'], ['Runs', 'Simulation: per-installment rounding'],
    ['Product', 'Critical path'], ['Infra', 'Firing alerts'], ['Incidents', 'Simulation down after deploy'], ['Decisions', 'Outbox for proposal events'],
    ['Metrics', 'Agents'], ['Settings', 'Board data'], ['Today', 'Team daily'],
  ] as const) {
    await nav(page, screen).click();
    await expect(page.getByRole('heading', { level: 1, name: screen })).toBeVisible();
    await expect(page.getByText(marker, { exact: false }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('métricas: DORA e conhecimento com os dados do demo', async ({ page }) => {
  await open(page, 'metrics');
  await page.getByRole('tab', { name: 'DORA' }).click();
  await expect(page.getByText('Deploy frequency')).toBeVisible();
  await expect(page.getByText('Failed deliveries')).toBeVisible();
  await page.getByRole('tab', { name: 'Knowledge' }).click();
  await expect(page.getByRole('cell', { name: 'acme/loans-api' })).toBeVisible();
  await expect(page.getByText('Where only one person reviews')).toBeVisible();
});

test('incidente: registrar, adicionar ação e salvar', async ({ page }) => {
  await open(page, 'incidents');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('Checkout timeouts');
  await dialog.getByRole('button', { name: 'Log it' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Checkout timeouts');
  await page.getByRole('button', { name: 'Action', exact: true }).click();
  await page.getByPlaceholder('Action').last().fill('Add a timeout alert');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Incident saved').last()).toBeVisible();
  await expect(page.getByText('0/1 actions')).toBeVisible();
});

test('decisão: criar e aparecer entre as abertas', async ({ page }) => {
  await open(page, 'decisions');
  await page.getByRole('button', { name: 'New decision' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('Adopt feature flags');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Decision saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adopt feature flags' })).toBeVisible();
});

test('execução de review: mudar o julgamento de um achado atualiza a contagem', async ({ page }) => {
  await open(page, 'runs');
  await page.getByText('Simulation: per-installment rounding').first().click();
  await expect(page.getByText('3 of 3 judged · 2 go into the review')).toBeVisible();
  await page.getByRole('button', { name: 'Keep' }).nth(2).click();
  await expect(page.getByText('3 of 3 judged · 3 go into the review')).toBeVisible();
});

test('atalho L troca o idioma', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.keyboard.press('l');
  await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible();
});

test('agentes em segundo plano (claude agents): logs e parar com confirmação', async ({ page }) => {
  await open(page, 'agents');
  await page.getByRole('tab', { name: /Background/ }).click();
  await expect(page.getByText('flaky-test-fix')).toBeVisible();
  await expect(page.getByText('permission request')).toBeVisible();
  await page.getByRole('button', { name: 'Logs' }).first().click();
  await expect(page.getByText('Allow Bash(npm run migrate)?')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Stop' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Session stopped')).toBeVisible();
});

test('infra: alertas em tempo real, possível causa e incidente aberto pela regra', async ({ page }) => {
  const errors = await open(page, 'infra');
  await expect(page.getByRole('heading', { level: 1, name: 'Infra' })).toBeVisible();
  const alerts = page.getByTestId('infra-alert');
  await expect(alerts.filter({ hasText: 'High CPU on api-prod' })).toBeVisible();
  const latency = alerts.filter({ hasText: 'High p95 latency on loans-api-prod' });
  await expect(latency.getByText(/possible cause: Deploy #121 of loans-api-prod/)).toBeVisible();
  await expect(latency.getByRole('button', { name: 'View incident' })).toBeVisible(); // aberto pela regra automática
  await alerts.filter({ hasText: 'DTU above 85%' }).getByRole('button', { name: 'Open incident' }).click();
  await expect(page.getByText('Incident opened from the alert')).toBeVisible();
  await expect(page.getByTestId('infra-resource').first()).toBeVisible();
  await latency.getByRole('button', { name: 'View incident' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
  await expect(page.getByText('High p95 latency on loans-api-prod').first()).toBeVisible();
  expect(errors).toEqual([]);
});
