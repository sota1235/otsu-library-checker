import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LibraryClient } from './libraryClient.js';
import { parseUserInfo } from './parser.js';
import { buildErrorMessage, buildReportMessage, postToSlack } from './slack.js';
import type { Account, AccountError, AccountReport, Config } from './types.js';

function loadConfig(): Config {
  const accounts = loadAccounts();
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!slackWebhookUrl) {
    throw new Error('環境変数が設定されていません: SLACK_WEBHOOK_URL');
  }

  return {
    accounts,
    slackWebhookUrl,
    dueSoonDays: nonNegativeInt('DUE_SOON_DAYS', 7),
    mentionChannelDays: nonNegativeInt('MENTION_CHANNEL_DAYS', 7),
    dumpHtml: process.env.DEBUG_DUMP_HTML === '1',
    dryRun: process.env.DRY_RUN === '1',
  };
}

/**
 * アカウント設定を環境変数から読み込む。
 * - OTSU_LIBRARY_CARD_NO_1 / OTSU_LIBRARY_PASSWORD_1 / OTSU_LIBRARY_LABEL_1 のように連番で複数指定できる
 * - サフィックスなし (OTSU_LIBRARY_CARD_NO 等) も1アカウントとして扱う
 */
function loadAccounts(): Account[] {
  const accounts: Account[] = [];
  const read = (suffix: string, defaultLabel: string): Account | undefined => {
    const cardNo = process.env[`OTSU_LIBRARY_CARD_NO${suffix}`]?.trim();
    const password = process.env[`OTSU_LIBRARY_PASSWORD${suffix}`]?.trim();
    if (!cardNo && !password) return undefined;
    if (!cardNo || !password) {
      throw new Error(
        `OTSU_LIBRARY_CARD_NO${suffix} と OTSU_LIBRARY_PASSWORD${suffix} は両方設定してください`,
      );
    }
    const label = process.env[`OTSU_LIBRARY_LABEL${suffix}`]?.trim() || defaultLabel;
    return { label, cardNo, password };
  };

  const single = read('', 'アカウント');
  if (single) accounts.push(single);
  for (let i = 1; ; i++) {
    const account = read(`_${i}`, `アカウント${i}`);
    if (!account) break;
    accounts.push(account);
  }

  if (accounts.length === 0) {
    throw new Error(
      '環境変数が設定されていません: OTSU_LIBRARY_CARD_NO_1, OTSU_LIBRARY_PASSWORD_1 (または OTSU_LIBRARY_CARD_NO, OTSU_LIBRARY_PASSWORD)',
    );
  }
  return accounts;
}

function nonNegativeInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} は0以上の整数で指定してください: ${raw}`);
  }
  return value;
}

function formatToday(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function dumpPages(label: string, client: LibraryClient): Promise<void> {
  const dir = path.resolve('debug');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = label.replace(/[^\p{L}\p{N}_-]/gu, '_');
  for (const [i, page] of client.pages.entries()) {
    const file = path.join(dir, `${stamp}-${safeLabel}-${i}-${page.name}.html`);
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

/** 1アカウント分のログイン・取得・判定を行い、通知対象を返す */
async function checkAccount(config: Config, account: Account, now: Date): Promise<AccountReport> {
  const client = new LibraryClient();
  try {
    await client.login(account.cardNo, account.password);
    const html = await client.fetchUserInfo();
    const info = parseUserInfo(html, now);

    console.log(`[${account.label}] 貸出中: ${info.loans.length}件, 予約中: ${info.reservations.length}件`);
    for (const l of info.loans) console.log(`  [貸出] ${l.title} 返却期限 ${l.dueDate} (残り${l.daysLeft}日)`);
    for (const r of info.reservations) console.log(`  [予約] ${r.title} ${r.status}${r.isReady ? ' ★受取可能' : ''}`);

    return {
      label: account.label,
      loanCount: info.loans.length,
      reservationCount: info.reservations.length,
      readyReservations: info.reservations.filter((r) => r.isReady),
      dueSoonLoans: info.loans.filter((l) => l.daysLeft <= config.dueSoonDays),
    };
  } finally {
    if (config.dumpHtml) {
      await dumpPages(account.label, client).catch((e) => console.error('HTMLダンプに失敗:', e));
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const now = new Date();
  const today = formatToday(now);

  const reports: AccountReport[] = [];
  const errors: AccountError[] = [];
  for (const account of config.accounts) {
    try {
      reports.push(await checkAccount(config, account, now));
    } catch (error) {
      console.error(`[${account.label}]`, error);
      errors.push({ label: account.label, error });
    }
  }

  if (reports.length > 0) {
    const mentionChannel = reports.some((r) =>
      r.dueSoonLoans.some((l) => l.daysLeft < config.mentionChannelDays),
    );
    const showLabels = config.accounts.length > 1;
    await notify(config, buildReportMessage(today, reports, { mentionChannel, showLabels }));
    console.log('Slackに通知しました。');
  }

  if (errors.length > 0) {
    await notify(config, buildErrorMessage(today, errors)).catch((e) => console.error('エラー通知にも失敗:', e));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
