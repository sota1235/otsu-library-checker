import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LibraryClient } from './libraryClient.js';
import { parseUserInfo } from './parser.js';
import { buildErrorMessage, buildReportMessage, postToSlack } from './slack.js';
import type { Config } from './types.js';

function loadConfig(): Config {
  const missing: string[] = [];
  const required = (name: string): string => {
    const v = process.env[name]?.trim();
    if (!v) missing.push(name);
    return v ?? '';
  };

  const cardNo = required('OTSU_LIBRARY_CARD_NO');
  const password = required('OTSU_LIBRARY_PASSWORD');
  const slackWebhookUrl = required('SLACK_WEBHOOK_URL');
  if (missing.length > 0) {
    throw new Error(`環境変数が設定されていません: ${missing.join(', ')}`);
  }

  const dueSoonDays = Number(process.env.DUE_SOON_DAYS ?? '7');
  if (!Number.isInteger(dueSoonDays) || dueSoonDays < 0) {
    throw new Error(`DUE_SOON_DAYS は0以上の整数で指定してください: ${process.env.DUE_SOON_DAYS}`);
  }

  return {
    cardNo,
    password,
    slackWebhookUrl,
    dueSoonDays,
    dumpHtml: process.env.DEBUG_DUMP_HTML === '1',
    dryRun: process.env.DRY_RUN === '1',
  };
}

function formatToday(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function dumpPages(client: LibraryClient): Promise<void> {
  const dir = path.resolve('debug');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const [i, page] of client.pages.entries()) {
    const file = path.join(dir, `${stamp}-${i}-${page.name}.html`);
    await writeFile(file, page.html, 'utf8');
    console.error(`[debug] HTMLを保存しました: ${file}`);
  }
}

async function notify(config: Config, text: string): Promise<void> {
  if (config.dryRun) {
    console.log('[dry-run] Slackへ送信予定のメッセージ:\n' + text);
    return;
  }
  await postToSlack(config.slackWebhookUrl, text);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const now = new Date();
  const today = formatToday(now);
  const client = new LibraryClient();

  try {
    await client.login(config.cardNo, config.password);
    const html = await client.fetchUserInfo();
    const info = parseUserInfo(html, now);

    console.log(`貸出中: ${info.loans.length}件, 予約中: ${info.reservations.length}件`);
    for (const l of info.loans) console.log(`  [貸出] ${l.title} 返却期限 ${l.dueDate} (残り${l.daysLeft}日)`);
    for (const r of info.reservations) console.log(`  [予約] ${r.title} ${r.status}${r.isReady ? ' ★受取可能' : ''}`);

    const readyReservations = info.reservations.filter((r) => r.isReady);
    const dueSoonLoans = info.loans.filter((l) => l.daysLeft <= config.dueSoonDays);

    if (readyReservations.length === 0 && dueSoonLoans.length === 0) {
      console.log('通知対象はありません。');
      return;
    }

    await notify(config, buildReportMessage(today, readyReservations, dueSoonLoans));
    console.log('Slackに通知しました。');
  } catch (error) {
    console.error(error);
    await notify(config, buildErrorMessage(today, error)).catch((e) => console.error('エラー通知にも失敗:', e));
    process.exitCode = 1;
  } finally {
    if (config.dumpHtml) {
      await dumpPages(client).catch((e) => console.error('HTMLダンプに失敗:', e));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
