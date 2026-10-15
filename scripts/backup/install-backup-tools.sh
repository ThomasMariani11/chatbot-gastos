#!/usr/bin/env bash
set -euo pipefail
umask 077
tools="$(mktemp -d "${RUNNER_TEMP:?}/pesito-backup-tools-XXXXXX")"
curl --fail --silent --show-error --location --max-time 60 \
  'https://github.com/supabase/cli/releases/download/v2.120.0/supabase_2.120.0_linux_amd64.tar.gz' -o "$tools/supabase.tar.gz"
printf '%s  %s\n' '7074584113aa00495beeac661c41fb09f1ddd0a483cd7333894b0d080086dc6e' "$tools/supabase.tar.gz" | sha256sum --check --status
tar -xzf "$tools/supabase.tar.gz" -C "$tools" supabase
curl --fail --silent --show-error --location --max-time 60 \
  'https://downloads.rclone.org/v1.75.2/rclone-v1.75.2-linux-amd64.zip' -o "$tools/rclone.zip"
printf '%s  %s\n' '349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702' "$tools/rclone.zip" | sha256sum --check --status
unzip -q "$tools/rclone.zip" -d "$tools"
cp "$tools/rclone-v1.75.2-linux-amd64/rclone" "$tools/rclone"
chmod 700 "$tools/supabase" "$tools/rclone"
printf '%s\n' "$tools" >> "${GITHUB_PATH:?}"
