import { execFileSync } from 'node:child_process';
import { requireEnv } from './env';
import { authHeaders } from './master-api';

/**
 * 마스터 화면은 백엔드 `/api/master/_meta`가 내려주는 메타데이터로 구동되는
 * 범용 CRUD다. 23종을 스펙 파일에 하드코딩하면 백엔드가 컬럼을 바꿀 때마다
 * 테스트가 조용히 낡으므로, 테스트도 같은 메타데이터를 읽어 무엇을 어떻게
 * 입력할지 스스로 계산한다.
 */

export type MasterColumnType =
  | 'int'
  | 'text'
  | 'bool'
  | 'datetime'
  | 'number'
  | 'date';

export interface MasterColumn {
  name: string;
  label: string;
  type: MasterColumnType;
  required: boolean;
  editable: boolean;
  in_list: boolean;
  searchable: boolean;
  group: string;
  help: string;
  full_width: boolean;
  default: string;
  /** DB 문자열 길이 제한. TEXT 처럼 제한이 없으면 null. */
  max_length: number | null;
  /** enum/CHECK 제약이 허용하는 값. 제한이 없으면 null. */
  enum_values: string[] | null;
  /** DB 가 NULL 을 허용하는지. NOT NULL 이면 false. */
  nullable: boolean;
}

export interface MasterMeta {
  key: string;
  label: string;
  subtitle: string;
  pk: string;
  soft_delete: boolean;
  columns: MasterColumn[];
}

export interface PlannedField {
  /** 폼에서 이 필드를 찾을 라벨. 필수 컬럼은 `거래처 코드 *`처럼 별표가 붙는다. */
  label: string;
  value: string;
  column: MasterColumn;
}

export type TestPlan =
  | {
      testable: true;
      meta: MasterMeta;
      /** 입력할 필드들. date 타입은 value가 비어 있고 날짜 선택기로 처리한다. */
      fields: PlannedField[];
      /** 검색창에 넣어 이 행을 찾아낼 값. */
      searchValue: string;
      /** 수정 테스트에서 바꿀 필드와 새 값. */
      edit: { label: string; value: string };
    }
  | { testable: false; meta: MasterMeta; reason: string };

/**
 * 마스터 목록을 **동기로** 읽는다.
 *
 * 스펙은 마스터 하나당 테스트 하나를 만드는데, Playwright의 테스트 수집은
 * 동기라 스펙 파일 안에서 await할 수 없다. 그렇다고 global-setup이 파일로
 * 떨궈 주게 하면 순서가 맞지 않는다 — 수집이 global-setup보다 먼저 돌기
 * 때문에 새 환경에서는 그 파일이 영원히 없다(실측: 스펙이 로드 단계에서
 * 깨졌다). `_meta`는 인증 없이도 200으로 열리므로 여기서 직접 읽는다.
 *
 * fetch는 Promise라 쓸 수 없어 curl을 동기로 실행한다.
 */
export function fetchMasterMetaSync(): MasterMeta[] {
  const url = `${requireEnv('API_BASE_URL')}/api/master/_meta`;
  let raw: string;
  try {
    raw = execFileSync('curl', ['-sS', '--fail', '--max-time', '15', url], {
      encoding: 'utf-8',
    });
  } catch (error) {
    throw new Error(
      `마스터 메타데이터(${url})를 읽지 못했습니다. 백엔드가 떠 있는지 ` +
        `확인하세요: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const body = JSON.parse(raw) as { masters: MasterMeta[] };
  return body.masters;
}

/** 폼에 실제로 입력할 수 있는 필수 컬럼. pk나 생성일시처럼 editable=false는 빠진다. */
/**
 * 등록 시 반드시 채워야 하는 컬럼.
 *
 * config 의 `required`(화면 표시용)뿐 아니라 **DB 의 NOT NULL** 도 본다.
 * `tax_codes.effective_from` 처럼 `NOT NULL DEFAULT` 인 컬럼은 required=False
 * 지만, 화면이 빈 값을 명시적 null 로 보내면 기본값이 적용되지 않고 NOT NULL
 * 위반으로 등록이 실패한다(실측: "중복되거나 제약 조건에 맞지 않는 값입니다").
 *
 * 다만 NOT NULL 이라도 **폼 기본값(`default`)이 있으면 건드리지 않는다**.
 * `tariffs.currency` 는 CHAR(3) + FK(currencies) 인데 폼이 이미 'KRW' 를
 * 채워 두므로, 우리가 임의 값으로 덮으면 오히려 FK 위반이 난다.
 *
 * bool 은 폼이 스위치로 기본값을 이미 들고 있어 우리가 채울 대상이 아니다.
 */
export function editableRequiredColumns(meta: MasterMeta): MasterColumn[] {
  return meta.columns.filter(
    (c) =>
      c.editable &&
      c.type !== 'bool' &&
      (c.required || (c.nullable === false && c.default === '')),
  );
}

/**
 * 등록한 행을 검색창으로 다시 찾으려면, 우리가 값을 넣을 수 있고(editable)
 * 검색 대상이기도 한(searchable) text 컬럼이 최소 하나 필요하다.
 */
/**
 * 고유 토큰을 담으려면 최소 이만큼은 되어야 한다. 이보다 짧으면 잘라 넣어도
 * 병렬 실행 중 다른 행과 겹칠 수 있어 검색이 1건으로 좁혀지지 않는다.
 */
const MIN_TOKEN_COLUMN_LENGTH = 8;

/**
 * 값을 컬럼 제약에 맞춘다.
 *
 * 길이 초과분은 **앞을 버리고 뒤를 남긴다** — 토큰의 뒷부분(밀리초 + 난수)에
 * 구분력이 몰려 있어 앞을 자르면 서로 겹치기 때문이다.
 */
function fitValue(value: string, maxLength: number | null): string {
  if (maxLength === null || value.length <= maxLength) return value;
  return value.slice(value.length - maxLength);
}

/** 토큰을 담아 되찾을 수 있는 검색용 컬럼. */
export function searchableTextColumns(meta: MasterMeta): MasterColumn[] {
  return meta.columns.filter(
    (c) =>
      c.editable &&
      c.searchable &&
      c.type === 'text' &&
      // enum 컬럼은 허용값만 받으므로 고유 토큰을 넣을 수 없다.
      !c.enum_values &&
      // CHAR(3) 통화코드처럼 짧은 컬럼에는 고유 토큰이 들어가지 않는다.
      (c.max_length === null || c.max_length >= MIN_TOKEN_COLUMN_LENGTH),
  );
}

/** `carrier_id`, `partner_id`처럼 다른 마스터의 행을 가리키는 컬럼. */
export function isForeignKey(column: MasterColumn): boolean {
  return column.type === 'int' && column.name.endsWith('_id');
}

/**
 * FK 컬럼 이름에서 참조 대상 마스터 key를 유추한다. `_meta`에 참조 관계가
 * 실려 있지 않아 이름 규칙에 의존할 수밖에 없다. 규칙에서 벗어난 이름에
 * 조용히 틀린 값을 넣는 것보다 명시적으로 실패하는 편이 안전하므로, 아는
 * 이름만 표에 두고 나머지는 null을 돌려준다.
 */
const FOREIGN_KEY_TARGETS: Record<string, string> = {
  carrier_id: 'carriers',
  partner_id: 'partners',
  origin_zone_id: 'zones',
  dest_zone_id: 'zones',
  zone_id: 'zones',
  vehicle_id: 'vehicles',
  driver_id: 'drivers',
  facility_id: 'facilities',
};

export function foreignKeyTarget(column: MasterColumn): string | null {
  return FOREIGN_KEY_TARGETS[column.name] ?? null;
}

/**
 * 한 마스터에 대해 "무엇을 입력하면 UI로 등록·검색·수정·삭제를 한 바퀴 돌 수
 * 있는가"를 계산한다. 구조적으로 불가능한 마스터는 이유와 함께 testable=false를
 * 돌려준다 — 스펙에서 조용히 빠뜨리는 대신 skip 사유로 드러내기 위해서다.
 */
export async function planFor(
  meta: MasterMeta,
  allMasters: MasterMeta[],
  token: string,
): Promise<TestPlan> {
  // 필수 pk가 폼에서 편집 불가면 UI 등록 자체가 불가능하다
  // (carriers.partner_id, number_sequences.seq_type이 이 경우다).
  const unfillablePk = meta.columns.find(
    (c) => c.required && !c.editable && c.name === meta.pk,
  );
  if (unfillablePk) {
    return {
      testable: false,
      meta,
      reason: `필수 기본키 ${unfillablePk.name}가 폼에서 편집 불가라 UI로 등록할 수 없다`,
    };
  }

  const searchable = searchableTextColumns(meta);
  if (searchable.length === 0) {
    return {
      testable: false,
      meta,
      reason:
        '값을 넣을 수 있으면서 검색도 되는 text 컬럼이 없어, 등록한 행을 ' +
        '검색창으로 다시 찾을 수 없다',
    };
  }
  const searchColumn = searchable[0];

  const fields: PlannedField[] = [];
  for (const column of editableRequiredColumns(meta)) {
    if (isForeignKey(column)) {
      const targetKey = foreignKeyTarget(column);
      if (!targetKey) {
        return {
          testable: false,
          meta,
          reason: `FK 컬럼 ${column.name}의 참조 대상을 이름 규칙으로 알 수 없다`,
        };
      }
      const target = allMasters.find((m) => m.key === targetKey);
      if (!target) {
        return {
          testable: false,
          meta,
          reason: `FK 참조 대상 마스터 ${targetKey}가 메타데이터에 없다`,
        };
      }
      const id = await firstRowPk(target);
      if (id === null) {
        return {
          testable: false,
          meta,
          reason: `참조할 ${targetKey} 행이 하나도 없어 ${column.name}를 채울 수 없다`,
        };
      }
      fields.push({ label: labelOf(column), value: String(id), column });
      continue;
    }
    fields.push({
      label: labelOf(column),
      value: valueFor(column, token, searchColumn),
      column,
    });
  }

  // 검색용 컬럼이 필수가 아니라면 위 루프에서 빠졌을 수 있다. 토큰이 어딘가에는
  // 반드시 들어가야 등록한 행을 되찾을 수 있으므로 여기서 채워 넣는다.
  if (!fields.some((f) => f.column.name === searchColumn.name)) {
    fields.push({
      label: labelOf(searchColumn),
      value: fitValue(token, searchColumn.max_length),
      column: searchColumn,
    });
  }

  return {
    testable: true,
    meta,
    fields,
    // 검색 컬럼이 짧으면 토큰이 잘려 들어가므로, 실제로 저장된 값으로 찾는다.
    searchValue: fitValue(token, searchColumn.max_length),
    edit: planEdit(meta, searchColumn, token),
  };
}

/**
 * 수정 테스트에서 바꿀 필드를 고른다. 검색 컬럼이 아닌 text 컬럼을 우선하는데,
 * 검색으로 좁혀 둔 상태에서 그 검색 대상 값을 바꾸면 목록이 조건에서 벗어나
 * 이어지는 삭제 단계가 행을 찾지 못할 수 있기 때문이다. 마땅한 다른 컬럼이
 * 없을 때만 검색 컬럼을 쓰되, 토큰을 남겨 검색 조건이 계속 맞도록 한다.
 */
function planEdit(
  meta: MasterMeta,
  searchColumn: MasterColumn,
  token: string,
): { label: string; value: string } {
  const alternative = meta.columns.find(
    (c) =>
      c.editable &&
      c.type === 'text' &&
      c.name !== searchColumn.name &&
      c.name !== meta.pk &&
      // enum 컬럼은 허용값만 받으므로 임의의 '수정됨' 값을 넣을 수 없다.
      !c.enum_values &&
      // 바꾼 값이 잘리면 목록에서 그 값을 그대로 찾을 수 없다.
      (c.max_length === null || c.max_length >= `${token} 수정됨`.length),
  );
  if (alternative) {
    return { label: labelOf(alternative), value: `${token} 수정됨` };
  }
  return {
    label: labelOf(searchColumn),
    value: fitValue(`${token}X`, searchColumn.max_length),
  };
}

function labelOf(column: MasterColumn): string {
  return column.required ? `${column.label} *` : column.label;
}

/**
 * 타입별로 폼 검증(`숫자를 입력하세요.`)을 통과하는 값을 만든다. date는 폼이
 * readOnly + 날짜 선택기라 여기서 값을 만들 수 없고, master-ui.ts가 선택기를
 * 열어 처리한다(그래서 빈 문자열).
 */
function valueFor(
  column: MasterColumn,
  token: string,
  searchColumn: MasterColumn,
): string {
  // enum 컬럼은 허용값 밖의 값을 넣으면 DB 가 거부한다(400 DataError).
  if (column.enum_values && column.enum_values.length > 0) {
    return column.enum_values[0];
  }
  switch (column.type) {
    case 'number':
      return '1.5';
    case 'int':
      return '1';
    case 'date':
      return '';
    default:
      return fitValue(
        column.name === searchColumn.name ? token : `E2E ${column.label}`,
        column.max_length,
      );
  }
}

/**
 * 참조용 부모 행 하나의 pk 값을 가져온다. pk 컬럼 이름은 마스터마다 다르므로
 * (carriers는 `id`가 아니라 `partner_id`다) 메타데이터의 pk를 그대로 쓴다.
 */
async function firstRowPk(target: MasterMeta): Promise<number | null> {
  const res = await fetch(
    `${requireEnv('API_BASE_URL')}/api/master/${target.key}?limit=1`,
    { headers: authHeaders() },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { items: Array<Record<string, unknown>> };
  const first = body.items[0];
  if (!first) return null;
  const value = first[target.pk];
  return typeof value === 'number' ? value : null;
}
