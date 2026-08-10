import { test, expect } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';

test.use({ storageState: 'playwright/.auth/user.json' });

const modules: Array<{ label: string; path: string }> = [
  { label: '마스터', path: '/master' },
  { label: '오더 생성', path: '/order' },
  { label: '운송계획', path: '/planning' },
  { label: '실행', path: '/execution' },
  { label: '트래킹', path: '/tracking' },
  { label: '실적', path: '/performance' },
  { label: '정산', path: '/settlement' },
  { label: 'KPI', path: '/kpi' },
];

for (const { label, path } of modules) {
  test(`${path} 화면이 콘솔 에러 없이 로드된다 (${label})`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await gotoAndEnableSemantics(page, path);

    await expect(page).toHaveURL(new RegExp(`${path}$`));
    expect(
      consoleErrors,
      `콘솔 에러 발생:\n${consoleErrors.join('\n')}`,
    ).toEqual([]);
  });
}
