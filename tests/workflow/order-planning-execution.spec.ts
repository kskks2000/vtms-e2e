import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';
import { authHeaders } from '../support/master-api';
import { fillReliably } from '../support/reliable-fill';

test.use({ storageState: 'playwright/.auth/user.json' });
test.setTimeout(180_000);

const execFileAsync = promisify(execFile);

type OrderResponse = { id: number; order_no: string; status: string };
type ShipmentResponse = {
  id: number;
  shipment_no: string;
  status: string;
  stops: Array<{ id: number; arrived_at?: string; departed_at?: string }>;
  orders: Array<{ id: number; order_no: string; status: string }>;
};

function apiBaseUrl(): string {
  const value = process.env.API_BASE_URL;
  if (!value) throw new Error('API_BASE_URL이 설정되지 않았습니다.');
  return value;
}

async function apiJson<T>(pathname: string): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}/api${pathname}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function waitForOrderStatus(id: number, status: string): Promise<void> {
  await expect
    .poll(async () => (await apiJson<OrderResponse>(`/orders/${id}`)).status)
    .toBe(status);
}

async function waitForShipmentStatus(
  id: number,
  status: string,
): Promise<ShipmentResponse> {
  await expect
    .poll(async () => (await apiJson<ShipmentResponse>(`/planning/shipments/${id}`)).status)
    .toBe(status);
  return apiJson<ShipmentResponse>(`/planning/shipments/${id}`);
}

async function chooseDropdownOption(
  page: Page,
  label: string,
  fieldIndex = 0,
  option: number | string = 0,
): Promise<void> {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page
    .getByRole('button', { name: new RegExp(`^${escaped}(?: |$)`) })
    .nth(fieldIndex)
    .click();
  // DropdownRoute의 항목은 dispatchEvent로는 onTap이 실행되지 않는다.
  if (typeof option === 'string') {
    await page
      .getByRole('menuitem', { name: option, exact: true })
      .first()
      .click();
  } else {
    await page.getByRole('menuitem').nth(option).click();
  }
}

async function openFresh(page: Page, route: string): Promise<void> {
  // 인증 상태가 아직 복원되지 않은 콜드 딥링크는 앱 라우터가 /master로
  // 보내버린다(modules.spec.ts에도 기록된 앱 이슈). /master에서 인증과
  // Flutter 부팅을 끝낸 뒤 해시 라우팅으로 실제 메뉴 이동과 같은 경로를 탄다.
  if ((await page.locator('flutter-view').count()) === 0) {
    await gotoAndEnableSemantics(page, '/master');
    await expect(page.getByText('마스터', { exact: true })).toBeVisible();
  }
  if (route !== '/master') {
    await page.evaluate((path) => {
      window.location.hash = path;
    }, route);
    await expect(page).toHaveURL(new RegExp(`${route}$`));
  }
}

async function cleanupWorkflow(token: string): Promise<void> {
  const backendDir = path.resolve(process.cwd(), '../vtms/backend');
  await execFileAsync(
    path.join(backendDir, '.venv/bin/python'),
    [path.resolve(process.cwd(), 'tests/support/workflow-cleanup.py'), token],
    {
      cwd: backendDir,
      env: { ...process.env, PYTHONPATH: backendDir },
    },
  );
}

test('오더 생성 → 운송 편성·배정·배차 → 실행 완료', async ({ page }) => {
  const token = `E2E-WORKFLOW-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  let order: OrderResponse | undefined;
  let shipment: ShipmentResponse | undefined;

  try {
    await test.step('오더를 화면에서 등록하고 확정한다', async () => {
      await openFresh(page, '/order');
      await page
        .getByRole('button', { name: '오더 등록', exact: true })
        .first()
        .dispatchEvent('click');
      await expect(page.getByText('오더 등록', { exact: true })).toBeVisible();

      await chooseDropdownOption(page, '고객(거래처) *');
      await fillReliably(page.getByLabel('비고'), token);
      // 주소 필드의 실제 hit-test 영역이 바로 위 거점 드롭다운과 겹치는 Flutter
      // 웹 이슈가 있어, 직접 주소 타이핑 대신 룩업 거점을 명시적으로 선택한다.
      // 첫 항목은 '선택 안 함'이므로 실제 거점인 두 번째 항목을 고른다.
      await chooseDropdownOption(page, '거점 선택', 0, 1);
      await chooseDropdownOption(page, '거점 선택', 1, 1);
      // 신규 폼에는 기본운임 행이 이미 있으므로 금액은 필수다.
      await fillReliably(page.getByLabel('금액'), '50000');

      const createResponse = page.waitForResponse(
        (res) => res.url().endsWith('/api/orders') && res.request().method() === 'POST',
      );
      await page
        .getByRole('button', { name: '등록', exact: true })
        .dispatchEvent('click');
      const response = await createResponse;
      const responseBody = (await response.json()) as OrderResponse | { detail?: unknown };
      expect(response.status(), JSON.stringify(responseBody)).toBe(201);
      order = responseBody as OrderResponse;
      await expect(page.getByText(order.order_no, { exact: true })).toBeVisible();

      await page
        .getByRole('button', { name: '상태 변경', exact: true })
        .first()
        .dispatchEvent('click');
      // PopupMenuItem도 DropdownMenuItem처럼 실제 pointer click이 필요하다.
      await page
        .getByRole('menuitem', { name: '→ 확정', exact: true })
        .click();
      await waitForOrderStatus(order.id, 'confirmed');
    });

    await test.step('확정 오더를 운송으로 편성한다', async () => {
      if (!order) throw new Error('오더 등록 결과가 없습니다.');
      await openFresh(page, '/planning');
      await page
        .getByRole('button', { name: '편성 시작', exact: true })
        .dispatchEvent('click');
      // 편성 목록은 오래된 상차일 우선 50건만 보여주므로 생성 직후 오더도
      // 기본 페이지 밖일 수 있다. 고유 오더번호로 조회해 대상 행을 고정한다.
      const search = page.getByRole('textbox', {
        name: '오더번호 · 고객명 검색',
        exact: true,
      });
      await fillReliably(search, order.order_no);
      await page.keyboard.press('Enter');
      await expect(page.getByText(order.order_no, { exact: true })).toBeVisible({
        timeout: 10_000,
      });

      // 편성 화면의 첫 체크박스는 전체선택, 마지막 체크박스는 방금 만든 최신 오더다.
      await page.getByRole('checkbox').last().dispatchEvent('click');
      await expect(page.getByText('1건', { exact: true }).last()).toBeVisible();

      const composeResponse = page.waitForResponse(
        (res) =>
          res.url().endsWith('/api/planning/shipments') &&
          res.request().method() === 'POST',
      );
      await page
        .getByRole('button', { name: '운송 생성', exact: true })
        .dispatchEvent('click');
      const response = await composeResponse;
      expect(response.status()).toBe(201);
      const created = (await response.json()) as { id: number; shipment_no: string };
      shipment = await apiJson<ShipmentResponse>(`/planning/shipments/${created.id}`);
      expect(shipment.shipment_no).toBe(created.shipment_no);
      await expect(page.getByText(created.shipment_no, { exact: true })).toBeVisible();
    });

    await test.step('운송사를 배정하고 배차를 확정한다', async () => {
      if (!shipment) throw new Error('운송 편성 결과가 없습니다.');
      // 편성 직후 앱이 새 운송 상세(배정 폼 포함)를 바로 연다.
      await expect(
        page.getByText(shipment.shipment_no, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^운송사 \*/ }),
      ).toBeVisible();
      const carrierField = page.getByRole('button', { name: /^운송사 \*/ });
      // 첫 항목은 placeholder, 두 번째가 첫 실제 운송사다.
      await chooseDropdownOption(page, '운송사 *', 0, 1);
      await expect(carrierField).not.toHaveAccessibleName('운송사 * 선택');
      await page
        .getByRole('button', { name: '배정', exact: true })
        .dispatchEvent('click');
      await waitForShipmentStatus(shipment.id, 'booked');

      // 배정 성공 후 같은 운송 상세가 배정완료 패널로 갱신되고 여기서 바로
      // 배차 확정할 수 있다. 같은 해시를 재설정해도 내부 view는 초기화되지 않는다.
      await expect(
        page.getByRole('button', { name: '배차 확정', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: '배차 확정', exact: true })
        .dispatchEvent('click');
      shipment = await waitForShipmentStatus(shipment.id, 'dispatched');
      await waitForOrderStatus(order!.id, 'assigned');
    });

    await test.step('실행 화면에서 운행과 모든 정차지를 완료한다', async () => {
      if (!shipment) throw new Error('배차 결과가 없습니다.');
      await openFresh(page, '/execution');
      // 큐 카드의 전체 semantics가 progressbar 하나로 합쳐지므로 독립 Text가 없다.
      await page
        .getByRole('progressbar', {
          name: new RegExp(`^${shipment.shipment_no} `),
        })
        .click();
      await page
        .getByRole('button', { name: '운행 시작', exact: true })
        .dispatchEvent('click');
      shipment = await waitForShipmentStatus(shipment.id, 'in_transit');

      for (let i = 0; i < shipment.stops.length; i += 1) {
        await page
          .getByRole('button', { name: '도착', exact: true })
          .first()
          .click();
        await expect(
          page.getByRole('button', { name: '출발', exact: true }).first(),
        ).toBeVisible({ timeout: 10_000 });
        await page
          .getByRole('button', { name: '출발', exact: true })
          .first()
          .click();
      }

      await expect(
        page.getByRole('button', { name: '배송완료', exact: true }),
      ).toBeEnabled();
      await page
        .getByRole('button', { name: '배송완료', exact: true })
        .dispatchEvent('click');
      await waitForShipmentStatus(shipment.id, 'delivered');

      await page
        .getByRole('button', { name: '운행 종료', exact: true })
        .dispatchEvent('click');
      await waitForShipmentStatus(shipment.id, 'closed');
      await waitForOrderStatus(order!.id, 'completed');
    });
  } finally {
    await cleanupWorkflow(token);
  }
});
