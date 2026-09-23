import * as cheerio from 'cheerio';
import type { Loan, Reservation, UserInfo } from './types.js';

const DATE_RE = /(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?/;
const READY_RE = /受取可能|用意できました|ご用意|準備できました|取置中|お取り置き|確保|到着/;

const TITLE_HEADER_RE = /^(タイトル|書名|資料名|題名)/;
const DUE_HEADER_RE = /^(返却期限|返却予定)/;
const STATUS_HEADER_RE = /^(状況|状態)/;
const HOLD_LIMIT_HEADER_RE = /^取置期限/;
const RESERVED_DATE_HEADER_RE = /^予約日/;
const RANK_HEADER_RE = /^順位/;

type ColumnMap = Record<string, number>;

/**
 * 利用者のページのHTMLから貸出中・予約中の一覧を抽出する。
 *
 * ページ内の各テーブルのヘッダー行（th）を見て列を特定する。
 * - 「返却期限」列を持つテーブル → 貸出一覧
 * - 「状況」列と「予約日」列を持つテーブル → 予約一覧
 */
export function parseUserInfo(html: string, today: Date = new Date()): UserInfo {
  const $ = cheerio.load(html);
  const loans: Loan[] = [];
  const reservations: Reservation[] = [];

  $('table').each((_, table) => {
    const $table = $(table);
    if ($table.find('table').length > 0) return;

    const rows = $table.find('tr').toArray();
    const headerRow = rows.find((row) => $(row).find('th').length >= 2);
    if (!headerRow) return;

    const columns = mapColumns($(headerRow).find('th, td').toArray().map((c) => normalize($(c).text())));
    if (columns.title === undefined) return;

    const dataRows = rows.filter((row) => row !== headerRow);
    if (columns.due !== undefined) {
      for (const cells of eachDataRow($, dataRows, columns.title)) {
        const dateMatch = cells[columns.due]?.match(DATE_RE);
        if (!dateMatch) continue;
        const dueDate = formatDate(dateMatch);
        loans.push({ title: cells[columns.title], dueDate, daysLeft: diffDays(today, dueDate) });
      }
    } else if (columns.status !== undefined && columns.reservedDate !== undefined) {
      for (const cells of eachDataRow($, dataRows, columns.title)) {
        const rawStatus = cells[columns.status] ?? '';
        const rank = columns.rank !== undefined ? (cells[columns.rank] ?? '') : '';
        const status = rank ? `${rawStatus} (順位 ${rank})` : rawStatus;
        const holdLimit = columns.holdLimit !== undefined ? (cells[columns.holdLimit] ?? '') : '';
        const isReady = READY_RE.test(rawStatus) || DATE_RE.test(holdLimit);
        reservations.push({ title: cells[columns.title], status, isReady });
      }
    }
  });

  return { loans, reservations };
}

function mapColumns(headers: string[]): ColumnMap {
  const columns: ColumnMap = {};
  const assign = (key: string, re: RegExp) => {
    const idx = headers.findIndex((h) => re.test(h));
    if (idx >= 0) columns[key] = idx;
  };
  assign('title', TITLE_HEADER_RE);
  assign('due', DUE_HEADER_RE);
  assign('status', STATUS_HEADER_RE);
  assign('holdLimit', HOLD_LIMIT_HEADER_RE);
  assign('reservedDate', RESERVED_DATE_HEADER_RE);
  assign('rank', RANK_HEADER_RE);
  return columns;
}

/** タイトル列が空でないデータ行だけを、セル文字列の配列として返す */
function* eachDataRow($: cheerio.CheerioAPI, rows: any[], titleIndex: number): Generator<string[]> {
  for (const row of rows) {
    const cells = $(row)
      .find('th, td')
      .toArray()
      .map((c) => normalize($(c).text()));
    if (!cells[titleIndex]) continue;
    yield cells;
  }
}

function normalize(text: string): string {
  return text.replace(/[\s　]+/g, ' ').trim();
}

function formatDate(m: RegExpMatchArray): string {
  return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
}

function diffDays(today: Date, dueDate: string): number {
  const [y, m, d] = dueDate.split('/').map(Number);
  const due = Date.UTC(y, m - 1, d);
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - base) / 86_400_000);
}
