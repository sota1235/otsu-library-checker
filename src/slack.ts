import type { AccountError, AccountReport } from './types.js';

export async function postToSlack(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook failed: ${res.status} ${body}`);
  }
}

/** 受取可能な予約・返却期限が近い貸出のいずれかがあるか */
export function hasNotifiable(report: AccountReport): boolean {
  return report.readyReservations.length > 0 || report.dueSoonLoans.length > 0;
}

/**
 * 通知メッセージを組み立てる。
 * 全アカウントの貸出数・予約数を表示し、受取可能な予約・返却期限が近い貸出があればその一覧を、
 * なければその旨をアカウントごとに付ける。複数アカウントの場合はラベルごとに区切る。
 * failedLabels に取得に失敗したアカウントを渡すと、そのアカウントは未チェックである旨を表示する。
 */
export function buildReportMessage(
  today: string,
  reports: AccountReport[],
  options: { mentionChannel?: boolean; showLabels?: boolean; failedLabels?: string[] } = {},
): string {
  const lines: string[] = [];
  if (options.mentionChannel) lines.push('<!channel> 返却期限が迫っています');
  lines.push(`📚 大津図書館チェック結果 (${today})`);

  // 複数アカウント時はラベル行で区切り、その配下の見出し前には空行を入れない
  const gap = options.showLabels ? [] : [''];
  for (const report of reports) {
    const counts = `貸出 ${report.loanCount}件 / 予約 ${report.reservationCount}件`;
    if (options.showLabels) {
      lines.push('', `👤 ${escapeSlackText(report.label)}（${counts}）`);
    } else {
      lines.push(counts);
    }
    if (report.readyReservations.length > 0) {
      lines.push(...gap, '🟢 受取可能な予約:');
      for (const r of report.readyReservations) {
        lines.push(`・『${escapeSlackText(r.title)}』`);
      }
    }
    if (report.dueSoonLoans.length > 0) {
      lines.push(...gap, '⏰ 返却期限が近い貸出:');
      for (const l of report.dueSoonLoans) {
        lines.push(`・『${escapeSlackText(l.title)}』(${formatDaysLeft(l.daysLeft)}: ${l.dueDate})`);
      }
    }
    if (!hasNotifiable(report)) {
      lines.push(...gap, '✅ 受取可能な予約・返却期限が近い貸出はありません');
    }
  }

  for (const label of options.failedLabels ?? []) {
    lines.push('', `👤 ${escapeSlackText(label)}`, '⚠️ 取得に失敗したため未チェックです（別途エラー通知を参照）');
  }

  return lines.join('\n');
}

export function buildErrorMessage(today: string, errors: AccountError[]): string {
  const lines: string[] = [`🚨 大津図書館チェックでエラーが発生しました (${today})`];
  for (const { label, error } of errors) {
    const detail = error instanceof Error ? error.message : String(error);
    lines.push('', `👤 ${escapeSlackText(label)}`, '```', escapeSlackText(detail), '```');
  }
  return lines.join('\n');
}

function formatDaysLeft(days: number): string {
  if (days < 0) return `${-days}日超過`;
  if (days === 0) return '本日期限';
  return `残り${days}日`;
}

/** Slackのtextで特別扱いされる & < > をエスケープする（<!channel> 等の意図しない解釈を防ぐ） */
function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
