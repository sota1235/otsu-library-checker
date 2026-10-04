#!/bin/zsh
# 認証情報をmacOS Keychainから読み出して図書館チェックを実行する。
# 事前に bin/setup-keychain.sh でKeychainへ登録しておくこと。
# 通知に表示するアカウント名は .env の OTSU_LIBRARY_LABEL_1 / _2 から dotenv が読み込む。
# launchd から呼ばれるため、コマンドは絶対パスで指定する。
set -eu

cd "$(dirname "$0")/.."

NODE=/opt/homebrew/bin/node
SECURITY=/usr/bin/security
ACCOUNT="$(id -un)"

secret() {
  "$SECURITY" find-generic-password -s "$1" -a "$ACCOUNT" -w
}

OTSU_LIBRARY_CARD_NO_1="$(secret otsu-library-checker-card-no-1)"
OTSU_LIBRARY_PASSWORD_1="$(secret otsu-library-checker-password-1)"
OTSU_LIBRARY_CARD_NO_2="$(secret otsu-library-checker-card-no-2)"
OTSU_LIBRARY_PASSWORD_2="$(secret otsu-library-checker-password-2)"
SLACK_WEBHOOK_URL="$(secret otsu-library-checker-slack-webhook-url)"
export OTSU_LIBRARY_CARD_NO_1 OTSU_LIBRARY_PASSWORD_1
export OTSU_LIBRARY_CARD_NO_2 OTSU_LIBRARY_PASSWORD_2
export SLACK_WEBHOOK_URL

echo "[$(date '+%Y-%m-%d %H:%M:%S')] start"
exec "$NODE" dist/index.js
