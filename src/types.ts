export interface Loan {
  title: string;
  /** 返却期限 (YYYY/MM/DD) */
  dueDate: string;
  /** 返却期限までの残日数（当日は0、超過は負数） */
  daysLeft: number;
}

export interface Reservation {
  title: string;
  /** サイト上のステータス文言（例: 「受取可能」「予約中」「3人待ち」） */
  status: string;
  /** 受取可能かどうか */
  isReady: boolean;
}

export interface UserInfo {
  loans: Loan[];
  reservations: Reservation[];
}

export interface Config {
  cardNo: string;
  password: string;
  slackWebhookUrl: string;
  dueSoonDays: number;
  dumpHtml: boolean;
  dryRun: boolean;
}
