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

/**
 * 通知メッセージを組み立てる。
 * 全アカウントの貸出数・予約数を表示し、受取可能な予約・返却期限が近い貸出があればその一覧を付ける。
 * 複数アカウントの場合はラベルごとに区切る。
 */
export function buildReportMessage(
  today: string,
  reports: AccountReport[],
  options: { mentionChannel?: boolean; showLabels?: boolean } = {},
): string {
  const lines: string[] = [];
  if (options.mentionChannel) lines.push('<!channel> 返却期限が迫っています');
  lines.push(`📚 大津図書館チェック結果 (${today})`);

  for (const report of reports) {
    // 複数アカウント時はラベル行で区切り、その配下の見出し前には空行を入れない
    const gap = options.showLabels ? [] : [''];
    const counts = `貸出 ${report.loanCount}件 / 予約 ${report.reservationCount}件`;
    lines.push(...(options.showLabels ? ['', `👤 ${report.label}（${counts}）`] : [counts]));
    if (report.readyReservations.length > 0) {
      lines.push(...gap, '🟢 受取可能な予約:');
      for (const r of report.readyReservations) {
        lines.push(`・『${r.title}』`);
      }
    }
    if (report.dueSoonLoans.length > 0) {
      lines.push(...gap, '⏰ 返却期限が近い貸出:');
      for (const l of report.dueSoonLoans) {
        lines.push(`・『${l.title}』(${formatDaysLeft(l.daysLeft)}: ${l.dueDate})`);
      }
    }
  }

  const hasTarget = reports.some((r) => r.readyReservations.length > 0 || r.dueSoonLoans.length > 0);
  if (!hasTarget) lines.push('', '✅ 受取可能な予約・返却期限が近い貸出はありません');

  return lines.join('\n');
}

export function buildErrorMessage(today: string, errors: AccountError[]): string {
  const lines: string[] = [`🚨 大津図書館チェックでエラーが発生しました (${today})`];
  for (const { label, error } of errors) {
    const detail = error instanceof Error ? error.message : String(error);
    lines.push('', `👤 ${label}`, '```', detail, '```');
  }
  return lines.join('\n');
}

function formatDaysLeft(days: number): string {
  if (days < 0) return `${-days}日超過`;
  if (days === 0) return '本日期限';
  return `残り${days}日`;
}
