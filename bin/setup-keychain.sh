#!/bin/zsh
# 認証情報をmacOS Keychainに登録する。
# 値は security コマンドの対話プロンプトが直接受け取るため、
# シェル履歴やプロセス一覧（ps）には残らない。
# 再実行すれば値を上書き更新できる。
set -eu

SECURITY=/usr/bin/security
ACCOUNT="$(id -un)"

cat <<'NOTE'
Keychainに認証情報を登録します。全5項目です。

各項目で security が英語で2回入力を求めます。
  password data for new item:   ← 1回目: 値を入力
  retype:                       ← 2回目: 確認のため同じ値を再入力
入力中の文字は画面に表示されません。

NOTE

register() {
  local service="$1" label="$2"
  echo "──────────────────────────────────────────"
  echo " ${label}"
  echo " (Keychainサービス名: ${service})"
  echo "──────────────────────────────────────────"
  "$SECURITY" add-generic-password -a "$ACCOUNT" -s "$service" -U -w
  echo "→ 登録しました"
  echo
}

register otsu-library-checker-card-no-1  '【1/5】アカウント1の 利用券番号'
register otsu-library-checker-password-1 '【2/5】アカウント1の パスワード'
register otsu-library-checker-card-no-2  '【3/5】アカウント2の 利用券番号'
register otsu-library-checker-password-2 '【4/5】アカウント2の パスワード'
register otsu-library-checker-slack-webhook-url '【5/5】Slack Incoming Webhook URL（共通）'

cat <<'NOTE'
完了しました。

通知に表示するアカウント名は .env の OTSU_LIBRARY_LABEL_1 / OTSU_LIBRARY_LABEL_2 で設定します。
動作確認: DRY_RUN=1 ./bin/run.sh
NOTE
