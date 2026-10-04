# otsu-library-checker

大津市立図書館のマイページ（貸出・予約照会）を自動チェックし、以下に該当する場合にSlackへ通知するスクリプト。

- 予約中の本が **受取可能** になった
- 貸出中の本の **返却期限が近い**（デフォルト: 7日以内、当日含む）

該当がない場合も、動作確認のため貸出数・予約数のみを通知する。ログイン失敗やパース失敗などのエラー時はエラー内容をSlackに通知し、非ゼロ終了コードで終了する。

## セットアップ

認証情報は [1Password CLI](https://developer.1password.com/docs/cli/) 経由で読み込む。`.env` には平文の秘密を書かず、1Passwordの参照URI（`op://`）を書いておき、`op run` が実行時に実値へ展開する。

### 1. 1Passwordにアイテムを作成する

任意のボールトに、図書館アカウントごとに以下のフィールドを持つアイテムを作成する（例: ボールト `Personal`、アイテム `Otsu Library`）。

| フィールド | 内容 |
| --- | --- |
| `card_no` | 利用券番号 |
| `password` | パスワード |

Slack Incoming Webhook URL も同様に1Passwordに保存しておく（同じアイテムのフィールドでも別アイテムでもよい）。

### 2. 依存関係のインストールと `.env` の作成

```bash
brew install 1password-cli   # 未インストールの場合
npm install
cp .env.example .env
vim .env   # op:// 参照をボールト名・アイテム名に合わせて修正
npm run build
```

`.env` の記述例（2アカウント）:

```dotenv
OTSU_LIBRARY_LABEL_1=パパ
OTSU_LIBRARY_CARD_NO_1="op://Personal/Otsu Library/card_no"
OTSU_LIBRARY_PASSWORD_1="op://Personal/Otsu Library/password"

OTSU_LIBRARY_LABEL_2=子ども
OTSU_LIBRARY_CARD_NO_2="op://Personal/Otsu Library (Kid)/card_no"
OTSU_LIBRARY_PASSWORD_2="op://Personal/Otsu Library (Kid)/password"

SLACK_WEBHOOK_URL="op://Personal/Otsu Library/slack_webhook_url"
```

参照URIは `op://<ボールト名>/<アイテム名またはID>/<フィールド名>` の形式。アイテム名に空白を含む場合はダブルクォートで囲む。

### 環境変数

| 変数名 | 必須 | 説明 |
| --- | --- | --- |
| `OTSU_LIBRARY_CARD_NO_<n>` | ✅ | n番目のアカウントの利用券番号（n = 1, 2, ...） |
| `OTSU_LIBRARY_PASSWORD_<n>` | ✅ | n番目のアカウントのパスワード |
| `OTSU_LIBRARY_LABEL_<n>` | | n番目のアカウントの表示名（省略時: `アカウントn`） |
| `SLACK_WEBHOOK_URL` | ✅ | Slack Incoming Webhook URL |
| `DUE_SOON_DAYS` | | 返却期限の何日前から通知するか（デフォルト: 7） |
| `MENTION_CHANNEL_DAYS` | | 返却期限までの残日数がこの値を切ったら `@channel` を付ける（デフォルト: 7） |
| `DRY_RUN` | | `1` でSlackに送信せず標準出力にメッセージを表示 |
| `DEBUG_DUMP_HTML` | | `1` で取得したHTMLを `debug/` に保存（トラブルシュート用） |

アカウントは `_1` から連番で読み込み、番号が途切れたところで終了する。1アカウントのみの場合はサフィックスなし（`OTSU_LIBRARY_CARD_NO` / `OTSU_LIBRARY_PASSWORD` / `OTSU_LIBRARY_LABEL`）でも指定できる。

## 実行

`op run` で `.env` の `op://` 参照を展開してから実行する。初回や1Passwordがロックされている場合は認証プロンプト（Touch ID等）が表示される。

```bash
# ビルド済みのものを実行
op run --env-file=.env -- npm start

# ビルドせずに直接実行
op run --env-file=.env -- npm run dev

# Slackに送らず内容を確認
op run --env-file=.env -- env DRY_RUN=1 node dist/index.js
```

`dotenv` も `.env` を読み込むが、既に設定済みの環境変数は上書きしないため、`op run` が展開した実値が優先される。

## 初回動作確認

利用者のページのHTML構造が想定と異なる場合、パース結果が空になったり誤った値になることがある。初回は以下で結果を確認する。

```bash
op run --env-file=.env -- env DRY_RUN=1 DEBUG_DUMP_HTML=1 node dist/index.js
```

標準出力に貸出中・予約中の一覧が表示される。マイページの表示と食い違う場合は `debug/*-user-info.html` を元に `src/parser.ts` を調整する。

パーサーはテーブルのヘッダー行から列を特定している。「返却期限」列を持つテーブルを貸出一覧、「状況」列と「予約日」列を持つテーブルを予約一覧として扱う。

また、ページ上部のタブ見出し（「貸出 N」「予約 N」）の件数とパース結果の件数を照合し、一致しない場合はエラーとして通知する。サイト構造が変わってパースが空振りした際に「0件」として見過ごさないための仕組み。

## 定期実行

launchd（macOS）で毎朝 9:00 に実行する。無人実行では `op` が認証プロンプトを出せないため、定期実行では 1Password を使わず **認証情報を macOS Keychain に保存し、`bin/run.sh` が実行時に読み出して環境変数として渡す**。リポジトリ内には平文の秘密を置かない。

### 1. 認証情報をKeychainに登録する

```bash
./bin/setup-keychain.sh
```

利用券番号・パスワード（アカウントごと）と Slack Webhook URL を順に対話入力する。値は `security` コマンドのプロンプトが直接受け取るため、シェル履歴やプロセス一覧（`ps`）に残らない。login キーチェーンに以下のサービス名で保存される。

| サービス名 | 内容 |
| --- | --- |
| `otsu-library-checker-card-no-1` | アカウント1の利用券番号 |
| `otsu-library-checker-password-1` | アカウント1のパスワード |
| `otsu-library-checker-card-no-2` | アカウント2の利用券番号 |
| `otsu-library-checker-password-2` | アカウント2のパスワード |
| `otsu-library-checker-slack-webhook-url` | Slack Incoming Webhook URL（全アカウント共通） |

同じスクリプトを再実行すれば値を上書き更新できる（「キーチェーンアクセス」アプリからも確認・変更できる）。

アカウントを増やす場合は `bin/setup-keychain.sh` と `bin/run.sh` に `-3` / `_3` の組を追加する。

### 2. アカウント名の設定

通知に表示する名前は秘密ではないので `.env`（`.gitignore` 済み）に書く。`bin/run.sh` が export した認証情報は `dotenv` に上書きされないため、両者は共存できる。

```dotenv
OTSU_LIBRARY_LABEL_1=わたし
OTSU_LIBRARY_LABEL_2=こども
```

空のままにすると「アカウント1」「アカウント2」と表示される。

### 3. 動作確認

```bash
npm run build
DRY_RUN=1 ./bin/run.sh
```

### 4. launchd への登録

`~/Library/LaunchAgents/com.sota1235.otsu-library-checker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sota1235.otsu-library-checker</string>

  <key>ProgramArguments</key>
  <array>
    <string>/Users/sota1235/src/otsu-library-checker/bin/run.sh</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/sota1235/src/otsu-library-checker</string>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>/Users/sota1235/src/otsu-library-checker/launchd-stdout.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/sota1235/src/otsu-library-checker/launchd-stderr.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
```

```bash
# 読み込み
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.sota1235.otsu-library-checker.plist

# 手動で即時実行して動作確認
launchctl kickstart -p "gui/$(id -u)/com.sota1235.otsu-library-checker"
tail -f launchd-stdout.log launchd-stderr.log

# 登録内容・前回終了コードの確認
launchctl print "gui/$(id -u)/com.sota1235.otsu-library-checker"

# 解除（plistを編集したら bootout → bootstrap で読み直す）
launchctl bootout "gui/$(id -u)/com.sota1235.otsu-library-checker"
```

### 注意点

- ログは `launchd-stdout.log` / `launchd-stderr.log` に追記される（`.gitignore` 済み）。
- 9:00 にMacがスリープしていた場合、launchd は起床後に遅れて実行する。電源が切れていた場合はその日はスキップされる。
- `bin/run.sh` は `node` を絶対パス（`/opt/homebrew/bin/node`）で指定している。mise等でNodeを切り替えている場合は `which node` の結果に合わせて修正する。
- `src/` を変更したら `npm run build` を忘れないこと。launchd が実行するのは `dist/index.js`。

## 通知例

```
📚 大津図書館チェック結果 (2026-09-10)
貸出 3件 / 予約 5件

🟢 受取可能な予約:
・『本のタイトル』

⏰ 返却期限が近い貸出:
・『本のタイトル』(残り3日: 2026/09/13)
```

返却期限までの残日数が `MENTION_CHANNEL_DAYS` を切った貸出がある場合は、先頭に `@channel 返却期限が迫っています` が付く。

受取可能な予約も返却期限が近い貸出もない場合は、件数のみを通知する。

```
📚 大津図書館チェック結果 (2026-09-10)
貸出 3件 / 予約 5件

✅ 受取可能な予約・返却期限が近い貸出はありません
```

複数アカウントを設定している場合は、全アカウントをラベルで区切って1通にまとめる。通知対象のないアカウントには ✅ 行が付き、取得に失敗したアカウントは ⚠️ 未チェックとして表示される。

```
📚 大津図書館チェック結果 (2026-09-10)

👤 パパ（貸出 3件 / 予約 5件）
⏰ 返却期限が近い貸出:
・『本のタイトル』(残り3日: 2026/09/13)

👤 子ども（貸出 2件 / 予約 1件）
🟢 受取可能な予約:
・『本のタイトル』
```

一部のアカウントでログイン等に失敗した場合は、他のアカウントの結果を通知したうえで、失敗したアカウントのエラーを別メッセージで通知し、非ゼロ終了コードで終了する。

## 構成

```
bin/
├── run.sh            # Keychainから認証情報を読んで実行（launchdが呼ぶ）
└── setup-keychain.sh # 認証情報をKeychainに登録
src/
├── index.ts          # エントリーポイント（チェック実行→Slack通知）
├── libraryClient.ts  # ログイン・貸出予約情報取得（cookie管理含む）
├── parser.ts         # HTML→構造化データへのパース（cheerio）
├── slack.ts          # Slack Webhook送信
└── types.ts          # 型定義
```
