# otsu-library-checker

大津市立図書館のマイページ（貸出・予約照会）を自動チェックし、以下に該当する場合にSlackへ通知するスクリプト。

- 予約中の本が **受取可能** になった
- 貸出中の本の **返却期限が近い**（デフォルト: 7日以内、当日含む）

該当がない場合は通知しない。ログイン失敗やパース失敗などのエラー時はエラー内容をSlackに通知し、非ゼロ終了コードで終了する。

## セットアップ

```bash
npm install
cp .env.example .env
vim .env   # 利用券番号・パスワード・Slack Webhook URLを設定
npm run build
```

### 環境変数

| 変数名 | 必須 | 説明 |
| --- | --- | --- |
| `OTSU_LIBRARY_CARD_NO` | ✅ | 利用券番号 |
| `OTSU_LIBRARY_PASSWORD` | ✅ | パスワード |
| `SLACK_WEBHOOK_URL` | ✅ | Slack Incoming Webhook URL |
| `DUE_SOON_DAYS` | | 返却期限の何日前から通知するか（デフォルト: 7） |
| `DRY_RUN` | | `1` でSlackに送信せず標準出力にメッセージを表示 |
| `DEBUG_DUMP_HTML` | | `1` で取得したHTMLを `debug/` に保存（トラブルシュート用） |

## 実行

```bash
# ビルド済みのものを実行
npm start

# ビルドせずに直接実行
npm run dev

# Slackに送らず内容を確認
DRY_RUN=1 npm start
```

## 初回動作確認

貸出・予約照会ページのHTML構造は柔軟にパースするようにしているが、想定と異なる場合はパース結果が空になることがある。初回は以下で結果を確認する。

```bash
DRY_RUN=1 DEBUG_DUMP_HTML=1 npm start
```

標準出力に貸出中・予約中の一覧が表示される。マイページの表示と食い違う場合は `debug/*-user-info.html` を元に `src/parser.ts` を調整する。

## 定期実行（cron）

毎朝8時に実行する例。`.env` は `dotenv` により自動で読み込まれるため、リポジトリのディレクトリで実行すればよい。

```cron
0 8 * * * cd /path/to/otsu-library-checker && /usr/local/bin/node dist/index.js >> /tmp/otsu-library-checker.log 2>&1
```

`node` のパスは `which node` で確認する（nvm等を使っている場合は絶対パスで指定する）。

### launchd を使う場合（macOS）

`~/Library/LaunchAgents/local.otsu-library-checker.plist` を作成する。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.otsu-library-checker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/otsu-library-checker</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>8</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/otsu-library-checker.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/otsu-library-checker.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/local.otsu-library-checker.plist
```

## 通知例

```
📚 大津図書館チェック結果 (2026-09-10)

🟢 受取可能な予約:
・『本のタイトル』

⏰ 返却期限が近い貸出:
・『本のタイトル』(残り3日: 2026/09/13)
```

## 構成

```
src/
├── index.ts          # エントリーポイント（チェック実行→Slack通知）
├── libraryClient.ts  # ログイン・貸出予約情報取得（cookie管理含む）
├── parser.ts         # HTML→構造化データへのパース（cheerio）
├── slack.ts          # Slack Webhook送信
└── types.ts          # 型定義
```
