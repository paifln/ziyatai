#!/bin/sh
set -eu
font="$1"
shift
export HOME=/tmp
mkdir -p /tmp/font-cache
fc-match -f '%{family}' "$font" | grep -F "$font" >/dev/null || { echo 'ZIYAT_ERROR:FONT_UNAVAILABLE' >&2; exit 1; }
exec libreoffice "$@"
