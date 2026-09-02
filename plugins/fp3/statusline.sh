#!/bin/bash
# fp3 status line — model, effort, account, context, and every usage window.
#
# Wired in via settings.json:
#   "statusLine": { "type": "command", "command": "~/.claude/statusline.sh",
#                   "refreshInterval": 30 }
# Keep ONE copy: ~/.claude/statusline.sh is a symlink into this file.
#
# Two sources, and it matters which is which:
#   * the JSON on stdin      — model, effort, context window, five_hour/seven_day
#   * the OAuth REST API     — account e-mail, and the PER-MODEL weekly buckets
#                              that the stdin JSON does NOT carry
set -u

input=$(cat)
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CREDS_FILE="$CLAUDE_DIR/.credentials.json"

MODEL=$(echo "$input" | jq -r '.model.display_name // "?"')
EFFORT=$(echo "$input" | jq -r '.effort.level // "?"')

# --- account e-mail (cached 1 h) ------------------------------------------
# ☠️ NOT https://claude.ai/api/account — that endpoint answers 403 to the CLI's
# OAuth token, and the failure is silent: the segment just goes blank.
EMAIL_CACHE="$CLAUDE_DIR/.email-cache"
EMAIL_TTL=3600

EMAIL=""
if [ -f "$EMAIL_CACHE" ]; then
    AGE=$(( $(date +%s) - $(stat -c %Y "$EMAIL_CACHE" 2>/dev/null || echo 0) ))
    [ "$AGE" -lt "$EMAIL_TTL" ] && EMAIL=$(cat "$EMAIL_CACHE" 2>/dev/null)
fi
if [ -z "$EMAIL" ] && [ -f "$CREDS_FILE" ]; then
    TOKEN=$(jq -r '.claudeAiOauth.accessToken // empty' "$CREDS_FILE" 2>/dev/null)
    if [ -n "$TOKEN" ]; then
        EMAIL=$(curl -sf --max-time 3 \
            -H "Authorization: Bearer $TOKEN" \
            -H "anthropic-beta: oauth-2025-04-20" \
            "https://api.anthropic.com/api/oauth/profile" 2>/dev/null \
            | jq -r '.account.email // empty')
        [ -n "$EMAIL" ] && echo "$EMAIL" > "$EMAIL_CACHE"
    fi
fi

# --- context window -------------------------------------------------------
USED=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
MAX=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)

# --- reset instants are ABSOLUTE local times, not "time left" -------------
fmt_time()  { date -d "@$1" "+%H:%M"; }
fmt_date()  {
    local dow time
    dow=$(date -d "@$1" "+%u")
    time=$(date -d "@$1" "+%H:%M")
    local days=(_ Hét Kedd Szer Csüt Pén Szo Vas)
    echo "${days[$dow]} $time"
}

FIVE_PCT=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
FIVE_RESET=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
SEVEN_PCT=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
SEVEN_RESET=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

FIVE_SEG=""; SEVEN_SEG=""
[ -n "$FIVE_PCT" ]  && [ -n "$FIVE_RESET" ]  && \
    FIVE_SEG="5h:$(printf '%.0f' "$FIVE_PCT")% ($(fmt_time "$FIVE_RESET"))"
[ -n "$SEVEN_PCT" ] && [ -n "$SEVEN_RESET" ] && \
    SEVEN_SEG="7d:$(printf '%.0f' "$SEVEN_PCT")% ($(fmt_date "$SEVEN_RESET"))"

# --- per-model weekly buckets (Fable, and whatever else appears) ----------
# The stdin JSON carries only five_hour and seven_day. The scoped ones live in
# https://api.anthropic.com/api/oauth/usage, under limits[].kind=="weekly_scoped",
# named by scope.model.display_name (the raw sibling keys are codenames:
# nimbus_quill, seven_day_opus, …). Selecting by DISPLAY NAME instead of by
# codename means a renamed bucket still shows up.
# Cached 60 s so a 30 s refresh does not mean a request per refresh.
USAGE_CACHE="$CLAUDE_DIR/.usage-cache.json"
USAGE_TTL=60

NEED_FETCH=1
if [ -f "$USAGE_CACHE" ]; then
    AGE=$(( $(date +%s) - $(stat -c %Y "$USAGE_CACHE" 2>/dev/null || echo 0) ))
    [ "$AGE" -lt "$USAGE_TTL" ] && NEED_FETCH=0
fi
if [ "$NEED_FETCH" = "1" ] && [ -f "$CREDS_FILE" ]; then
    UTOKEN=$(jq -r '.claudeAiOauth.accessToken // empty' "$CREDS_FILE" 2>/dev/null)
    if [ -n "$UTOKEN" ]; then
        # write to a temp file and validate before replacing: a truncated or
        # error-body response must not become the cache for the next 60 s
        curl -sf --max-time 3 \
            -H "Authorization: Bearer $UTOKEN" \
            -H "anthropic-beta: oauth-2025-04-20" \
            "https://api.anthropic.com/api/oauth/usage" \
            -o "${USAGE_CACHE}.tmp" 2>/dev/null \
            && jq -e '.limits' "${USAGE_CACHE}.tmp" >/dev/null 2>&1 \
            && mv "${USAGE_CACHE}.tmp" "$USAGE_CACHE"
        rm -f "${USAGE_CACHE}.tmp"
    fi
fi

SCOPED_SEG=""
if [ -f "$USAGE_CACHE" ]; then
    while IFS=$'\t' read -r name pct reset; do
        [ -z "$name" ] && continue
        seg="$(echo "$name" | tr 'A-Z' 'a-z'):$(printf '%.0f' "$pct")%"
        if [ -n "$reset" ] && [ "$reset" != "null" ]; then
            r=$(date -d "$reset" +%s 2>/dev/null)
            [ -n "$r" ] && seg="${seg} ($(fmt_date "$r"))"
        fi
        SCOPED_SEG="${SCOPED_SEG:+$SCOPED_SEG | }${seg}"
    done < <(jq -r '.limits[]? | select(.kind == "weekly_scoped")
                    | [ (.scope.model.display_name // "scoped"),
                        (.percent // 0),
                        (.resets_at // "") ] | @tsv' "$USAGE_CACHE" 2>/dev/null)
fi

LINE="[${MODEL}] [${EFFORT}] ${EMAIL} | ctx:${PCT}% (${USED}/${MAX})"
[ -n "$FIVE_SEG" ]   && LINE="${LINE} | ${FIVE_SEG}"
[ -n "$SEVEN_SEG" ]  && LINE="${LINE} | ${SEVEN_SEG}"
[ -n "$SCOPED_SEG" ] && LINE="${LINE} | ${SCOPED_SEG}"

echo "$LINE"
