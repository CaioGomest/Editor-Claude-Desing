#!/bin/bash
# Runs ffmpeg jobs api.php queues as plain .cmd files when the host's PHP
# has proc_open/exec disabled (this host does, in both web and CLI SAPIs) —
# a real shell process, outside PHP's sandbox, is the only thing that can
# actually invoke ffmpeg here. Scheduled via a cron job added in hPanel,
# e.g. every minute:
#   * * * * * bash /home/USER/domains/DOMAIN/public_html/editor/cron/process-jobs.sh >> /home/USER/domains/DOMAIN/public_html/editor/cron/cron.log 2>&1
set -u
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for cmdfile in "$BASE"/projects/exports/*/jobs/pending/*.cmd; do
  [ -e "$cmdfile" ] || continue
  pendingdir=$(dirname "$cmdfile")
  id=$(basename "$cmdfile" .cmd)
  lock="$pendingdir/$id.lock"

  if [ -e "$lock" ]; then
    age=$(( $(date +%s) - $(stat -c %Y "$lock" 2>/dev/null || echo 0) ))
    # Older than 10 minutes: the run that grabbed it must have died —
    # otherwise skip, some other cron tick already owns this job.
    if [ "$age" -lt 600 ]; then continue; fi
  fi
  touch "$lock"

  donedir="$(dirname "$pendingdir")/done"
  mkdir -p "$donedir"

  bash "$cmdfile" > "$donedir/$id.log" 2>&1
  code=$?
  if [ "$code" -eq 0 ]; then
    echo "ok" > "$donedir/$id.status"
  else
    echo "error" > "$donedir/$id.status"
  fi

  rm -f "$cmdfile" "$lock"
done
