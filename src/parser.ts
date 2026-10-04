import * as cheerio from 'cheerio';
import type { Loan, Reservation, UserInfo } from './types.js';

const DATE_RE = /(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?/;
const READY_RE = /受取可能|用意できました|ご用意|準備できました|取置中|お取り置き|確保|到着/;

const TITLE_HEADER_RE = /^(タイトル|書名|資料名|題名)/;
const DUE_HEADER_RE = /^(返却期限|返却予定)/;
const STATUS_HEADER_RE = /^(状況|状態)/;
const CALL_NO_HEADER_RE = /^(請求記号|資料コード)/;
const HOLD_LIMIT_HEADER_RE = /^取置期限/;
const RESERVED_DATE_HEADER_RE = /^予約日/;
const RANK_HEADER_RE = /^順位/;

type ColumnMap = Record<string, number>;

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * 利用者のページのHTMLから貸出中・予約中の一覧を抽出する。
 *
 * ページ内の各テーブルのヘッダー行（th）を見て列を特定する。
 * - 「返却期限」列を持つテーブル → 貸出一覧（「請求記号」列がないものは電子書籍貸出一覧など別枠の貸出）
 * - 「状況」列と「予約日」列を持つテーブル → 予約一覧（「取置期限」列に日付があれば受取可能と判定し、期限も保持する）
 *
 * ページ上部のタブ見出し（「貸出 <件数>」「予約 <件数>」）の件数と照合し、
 * 一致しない場合はサイト構造が変わった可能性があるため ParseError を投げる。
 * 別枠の貸出は見出しの件数に含まれないため、照合対象から外す（通知対象には含める）。
 */
export function parseUserInfo(html: string, today: Date = new Date()): UserInfo {
  const $ = cheerio.load(html);
  const loans: Loan[] = [];
  const reservations: Reservation[] = [];
  /** タブ見出しの「貸出 <件数>」に数えられる貸出だけの件数 */
  let countedLoans = 0;

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
      // 「請求記号」列を持つのが通常の貸出一覧。持たないテーブル（電子書籍貸出一覧など）は
      // 同じ貸出タブ内にあるがタブ見出しの件数には含まれないため、照合対象から外す。
      const countedInTabHeading = columns.callNo !== undefined;
      for (const cells of eachDataRow($, dataRows, columns.title)) {
        const dateMatch = cells[columns.due]?.match(DATE_RE);
        if (!dateMatch) continue;
        const dueDate = formatDate(dateMatch);
        loans.push({ title: cells[columns.title], dueDate, daysLeft: diffDays(today, dueDate) });
        if (countedInTabHeading) countedLoans++;
      }
    } else if (columns.status !== undefined && columns.reservedDate !== undefined) {
      for (const cells of eachDataRow($, dataRows, columns.title)) {
        const rawStatus = cells[columns.status] ?? '';
        const rank = columns.rank !== undefined ? (cells[columns.rank] ?? '') : '';
        const status = rank ? `${rawStatus} (順位 ${rank})` : rawStatus;
        const holdLimitMatch =
          columns.holdLimit !== undefined ? cells[columns.holdLimit]?.match(DATE_RE) : undefined;
        const isReady = READY_RE.test(rawStatus) || holdLimitMatch != null;
        const reservation: Reservation = { title: cells[columns.title], status, isReady };
        if (holdLimitMatch) {
          reservation.holdLimit = formatDate(holdLimitMatch);
          reservation.holdDaysLeft = diffDays(today, reservation.holdLimit);
        }
        reservations.push(reservation);
      }
    }
  });

  const expected = extractTabCounts($);
  if (expected.loans !== countedLoans || expected.reservations !== reservations.length) {
    const uncounted = loans.length - countedLoans;
    throw new ParseError(
      `件数が一致しません（サイト構造が変わった可能性があります）: ` +
        `貸出 見出し${expected.loans}件/解析${countedLoans}件` +
        (uncounted > 0 ? `(別枠の貸出${uncounted}件は照合対象外)` : '') +
        `, 予約 見出し${expected.reservations}件/解析${reservations.length}件`,
    );
  }

  return { loans, reservations };
}

/** タブ見出しの「貸出 <件数>」「予約 <件数>」を読み取る。見つからなければ ParseError */
function extractTabCounts($: cheerio.CheerioAPI): { loans: number; reservations: number } {
  const counts: Record<string, number> = {};
  $('h1, h2, h3, h4').each((_, el) => {
    const m = normalize($(el).text()).match(/^(貸出|予約)\s*(\d+)$/);
    if (m && counts[m[1]] === undefined) counts[m[1]] = Number(m[2]);
  });
  if (counts['貸出'] === undefined || counts['予約'] === undefined) {
    throw new ParseError('貸出・予約の件数見出しが見つかりません（サイト構造が変わった可能性があります）');
  }
  return { loans: counts['貸出'], reservations: counts['予約'] };
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
  assign('callNo', CALL_NO_HEADER_RE);
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

/** today から YYYY/MM/DD 形式の日付までの残日数（当日は0、超過は負数） */
function diffDays(today: Date, date: string): number {
  const [y, m, d] = date.split('/').map(Number);
  const due = Date.UTC(y, m - 1, d);
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - base) / 86_400_000);
}
