#!/bin/sh
set -eu
printf 'Go runtime license\n'
cat /usr/local/go/LICENSE
if [ -f /usr/local/go/PATENTS ]; then cat /usr/local/go/PATENTS; fi
go list -m -f '{{if .Dir}}{{.Path}} {{.Dir}}{{end}}' all | while read -r module directory; do
  [ -n "$directory" ] || continue
  printf '\n=== %s ===\n' "$module"
  find "$directory" -maxdepth 1 -type f \( -iname 'license*' -o -iname 'licence*' -o -iname 'copying*' -o -iname 'notice*' \) -exec cat {} \;
done
