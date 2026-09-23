import type { Loan, Reservation } from './types.js';

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

export function buildReportMessage(
  today: string,
  readyReservations: Reservation[],
  dueSoonLoans: Loan[],
): string {
  const lines: string[] = [`📚 大津図書館チェック結果 (${today})`];

  if (readyReservations.length > 0) {
    lines.push('', '🟢 受取可能な予約:');
    for (const r of readyReservations) {
      lines.push(`・『${r.title}』`);
    }
  }

  if (dueSoonLoans.length > 0) {
    lines.push('', '⏰ 返却期限が近い貸出:');
    for (const l of dueSoonLoans) {
      lines.push(`・『${l.title}』(${formatDaysLeft(l.daysLeft)}: ${l.dueDate})`);
    }
  }

  return lines.join('\n');
}

export function buildErrorMessage(today: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [`🚨 大津図書館チェックでエラーが発生しました (${today})`, '', '```', detail, '```'].join('\n');
}

function formatDaysLeft(days: number): string {
  if (days < 0) return `${-days}日超過`;
  if (days === 0) return '本日期限';
  return `残り${days}日`;
}
