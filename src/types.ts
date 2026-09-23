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

export interface Account {
  /** 通知やログで表示する名前 */
  label: string;
  cardNo: string;
  password: string;
}

export interface Config {
  accounts: Account[];
  slackWebhookUrl: string;
  dueSoonDays: number;
  /** 返却期限までの残日数がこの値を切ったら @channel メンションを付ける */
  mentionChannelDays: number;
  dumpHtml: boolean;
  dryRun: boolean;
}

/** 1アカウント分のチェック結果（通知対象のみ） */
export interface AccountReport {
  label: string;
  readyReservations: Reservation[];
  dueSoonLoans: Loan[];
}

export interface AccountError {
  label: string;
  error: unknown;
}
