#!/usr/bin/env bash
#
# usage-dashboard.sh — launcher + console for the AI Usage Survey dashboard.
#
#   • finds a free port (starting at 4173)
#   • starts the server quietly (output goes to a log file, not this screen)
#   • opens the dashboard in your browser
#   • gives you a small console:
#       l  view live server logs   (Ctrl+C or q returns here)
#       r  restart the server      (picks up code changes)
#       o  open the dashboard in the browser again
#       q  quit
#
set -uo pipefail

# --- resolve our own directory so the alias works from anywhere -----------
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/usage-dashboard.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/usage-dashboard"
cd "$SCRIPT_DIR"

DEFAULT_PORT="${PORT:-4173}"
LOG_FILE="$(mktemp -t usage-dashboard-log.XXXXXX)"
SERVER_PID=""
PORT_IN_USE_LIMIT=50   # how many ports to probe before giving up

# --- pretty output --------------------------------------------------------
bold() { printf '\033[1m%s\033[0m' "$1"; }
dim()  { printf '\033[2m%s\033[0m' "$1"; }
green(){ printf '\033[32m%s\033[0m' "$1"; }
red()  { printf '\033[31m%s\033[0m' "$1"; }

# --- terminal raw mode ----------------------------------------------------
# THE root cause of "I type q but nothing happens (and it echoes)": bash's
# `read -n1` only switches the tty to raw mode for the instant it is reading.
# Between reads (polling gaps, while `tail` writes) the tty is in cooked mode,
# so a keystroke is echoed and line-buffered until Enter — the next read can't
# get it. We instead put the tty in raw mode ONCE for the whole session:
#   -icanon  no line buffering (deliver each byte immediately)
#   -echo    don't print the typed key
#   -isig    don't turn Ctrl+C/Ctrl+\ into signals — they arrive as bytes
#   min 1 time 0  a read returns as soon as 1 byte is available
TTY="/dev/tty"
TTY_SAVED=""
CTRL_C=$'\x03'
have_tty() { [[ -e "$TTY" ]] && (exec 3<"$TTY") 2>/dev/null; }
enter_raw() {
    have_tty || return 1
    TTY_SAVED="$(stty -g <"$TTY" 2>/dev/null)" || { TTY_SAVED=""; return 1; }
    stty -icanon -echo -isig min 1 time 0 <"$TTY" 2>/dev/null || { TTY_SAVED=""; return 1; }
    return 0
}
leave_raw() { [[ -n "$TTY_SAVED" ]] && stty "$TTY_SAVED" <"$TTY" 2>/dev/null; TTY_SAVED=""; }

# Read exactly one byte from the tty into $1. Returns non-zero only on real EOF.
read_key() {
    local __k
    if [[ -n "$TTY_SAVED" ]]; then
        __k="$(dd if="$TTY" bs=1 count=1 2>/dev/null)"
    else
        IFS= read -r -n 1 __k 2>/dev/null || return 1
    fi
    printf -v "$1" '%s' "$__k"
    return 0
}

# --- cleanup on exit ------------------------------------------------------
# Runs when the launcher exits (via 'q', or terminal close): restore the tty,
# stop the server (it's in its own session, so we kill it explicitly), and
# remove the temp log. No orphan left behind.
cleanup() {
    leave_raw
    stop_server
    [[ -n "${LOG_FILE:-}" && -f "$LOG_FILE" ]] && rm -f "$LOG_FILE"
    printf '\n'
}
trap cleanup EXIT

# --- port probing (bash /dev/tcp, no external deps) -----------------------
port_in_use() {
    # returns 0 (true) if something is listening on $1
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; }
    return 1
}

find_free_port() {
    local p="$1" tried=0
    while port_in_use "$p"; do
        p=$((p + 1))
        tried=$((tried + 1))
        if (( tried >= PORT_IN_USE_LIMIT )); then
            return 1
        fi
    done
    printf '%s' "$p"
}

# --- browser open (cross-platform) ----------------------------------------
open_browser() {
    local url="$1"
    if command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 &
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 &
    elif command -v wslview >/dev/null 2>&1; then wslview "$url" >/dev/null 2>&1 &
    else return 1; fi
    return 0
}

# --- server lifecycle -----------------------------------------------------
# Start node in its OWN session so a terminal Ctrl+C (delivered to the
# launcher's process group only) can never reach it. We stop it ourselves with
# an explicit SIGTERM on quit/restart.
#
# Detacher selection (macOS has NO setsid, so the fallbacks matter):
#   setsid           — Linux / GCR
#   perl POSIX setsid — macOS & anywhere with perl (the bare 'setsid' form is
#                       NOT a real call — must `use POSIX`)
#   python3 os.setsid — macOS without a working perl
#   (none)           — last resort: plain background + disown
SESSION_RUNNER=""
if command -v setsid >/dev/null 2>&1; then
    SESSION_RUNNER="setsid"
elif command -v perl >/dev/null 2>&1; then
    SESSION_RUNNER="perl"
elif command -v python3 >/dev/null 2>&1; then
    SESSION_RUNNER="python3"
fi

start_server() {
    # CRITICAL: redirect the server's stdin from /dev/null. Otherwise the
    # detached node process inherits the terminal as stdin and competes with
    # this menu for typed keystrokes — the classic "Ctrl+C works but typed keys
    # vanish" bug. stdout/stderr go to the log file.
    case "$SESSION_RUNNER" in
        setsid)
            setsid env PORT="$PORT_ACTIVE" node server.js </dev/null >"$LOG_FILE" 2>&1 &
            ;;
        perl)
            perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die' \
                env PORT="$PORT_ACTIVE" node server.js </dev/null >"$LOG_FILE" 2>&1 &
            ;;
        python3)
            PORT="$PORT_ACTIVE" python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
                node server.js </dev/null >"$LOG_FILE" 2>&1 &
            ;;
        *)
            PORT="$PORT_ACTIVE" node server.js </dev/null >"$LOG_FILE" 2>&1 &
            ;;
    esac
    SERVER_PID=$!
    disown "$SERVER_PID" 2>/dev/null || true   # detach from job control too
}

stop_server() {
    if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null
        # give it a moment, then force
        for _ in 1 2 3 4 5; do
            kill -0 "$SERVER_PID" 2>/dev/null || break
            sleep 0.1
        done
        kill -9 "$SERVER_PID" 2>/dev/null || true
    fi
    SERVER_PID=""
}

server_alive() {
    [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null
}

# --- one-time alias setup -------------------------------------------------
setup_alias() {
    local profile=""
    case "${SHELL:-}" in
        */zsh) profile="$HOME/.zshrc" ;;
        */bash)
            if   [[ -f "$HOME/.bashrc" ]]; then profile="$HOME/.bashrc"
            elif [[ -f "$HOME/.bash_profile" ]]; then profile="$HOME/.bash_profile"; fi ;;
    esac
    [[ -z "$profile" ]] && { [[ -f "$HOME/.zshrc" ]] && profile="$HOME/.zshrc"; }
    [[ -z "$profile" ]] && return 0

    # remove stale aliases from earlier names (ai-survey, usage-dashboard)
    for stale in ai-survey usage-dashboard; do
        if grep -q "alias $stale=" "$profile" 2>/dev/null; then
            sed -i '' "/alias $stale=/d" "$profile" 2>/dev/null || sed -i "/alias $stale=/d" "$profile"
        fi
    done

    if grep -q "alias survey-dashboard=" "$profile" 2>/dev/null; then
        return 0
    fi
    printf "\n# AI Usage Survey dashboard launcher\nalias survey-dashboard='%s'\n" "$SCRIPT_PATH" >> "$profile"
    ALIAS_ADDED="$profile"
}

# --- screens --------------------------------------------------------------
banner() {
    clear
    echo
    bold "  AI Usage Survey"; echo
    dim  "  ─────────────────────────────────────────────"; echo
    printf "  %s  %s\n" "$(green "running")" "http://localhost:$PORT_ACTIVE"
    if ! server_alive; then
        printf "  %s  server is not running — press r to restart\n" "$(red "stopped")"
    fi
    # diagnostic: detacher used + whether node is in its own process group
    if server_alive; then
        local mypg npg detached="?"
        mypg="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
        npg="$(ps -o pgid= -p "$SERVER_PID" 2>/dev/null | tr -d ' ')"
        if [[ -n "$mypg" && -n "$npg" ]]; then
            [[ "$mypg" != "$npg" ]] && detached="yes (Ctrl+C-safe)" || detached="NO — Ctrl+C will reach server"
        fi
        dim "  detacher: ${SESSION_RUNNER:-none}   ·   server isolated: $detached"; echo
    fi
    echo
    bold "  l"; dim " view live logs"; echo
    bold "  r"; dim " restart server"; echo
    bold "  o"; dim " open in browser"; echo
    bold "  q"; dim " quit"; echo
    echo
    if [[ -n "${ALIAS_ADDED:-}" ]]; then
        dim "  added 'survey-dashboard' alias to $ALIAS_ADDED — run: source $ALIAS_ADDED"; echo
        echo
    fi
    printf "  press a key ▸ "
}

view_logs() {
    clear
    echo
    bold "  live server logs"; dim "   ( press q — or Ctrl+C — to go back )"; echo
    dim  "  ─────────────────────────────────────────────"; echo
    echo
    tail -n 200 -f "$LOG_FILE" 2>/dev/null &
    local tpid=$!

    # Already in raw mode, so a single keypress is delivered instantly. q or
    # Ctrl+C (byte 0x03) returns to the menu; any other key is ignored. The
    # server is in its own session, so nothing here can touch it.
    local k
    while :; do
        read_key k || break
        case "$k" in
            q|Q|"$CTRL_C") break ;;
            *) : ;;
        esac
    done
    kill "$tpid" 2>/dev/null
    wait "$tpid" 2>/dev/null || true
}

# --- preflight ------------------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "node is required but not found on PATH." >&2; exit 1; }
[[ -f "$SCRIPT_DIR/server.js" ]] || { echo "server.js not found in $SCRIPT_DIR." >&2; exit 1; }

setup_alias

PORT_ACTIVE="$(find_free_port "$DEFAULT_PORT")" || {
    echo "Could not find a free port in range $DEFAULT_PORT..$((DEFAULT_PORT + PORT_IN_USE_LIMIT))." >&2
    exit 1
}

start_server
sleep 0.6   # let it bind / fail fast
if ! server_alive; then
    echo "Server failed to start. Last output:" >&2
    tail -n 20 "$LOG_FILE" >&2
    exit 1
fi
open_browser "http://localhost:$PORT_ACTIVE" || true

# --- main console loop ----------------------------------------------------
# Enter raw mode ONCE for the whole session (see enter_raw). In raw mode every
# keystroke is delivered immediately and not echoed, and Ctrl+C arrives as the
# byte 0x03 (a no-op here) rather than a signal — so a single keypress just
# works, with no Enter, no polling gaps, and no stray quit.
enter_raw || true   # if no tty (piped), read_key falls back to line read
trap '' INT         # belt-and-suspenders for the no-tty / non-raw fallback
while true; do
    banner
    key=""
    read_key key || break          # real EOF → quit
    case "$key" in
        l|L) view_logs ;;
        r|R)
            stop_server
            if port_in_use "$PORT_ACTIVE"; then
                PORT_ACTIVE="$(find_free_port "$PORT_ACTIVE")"
            fi
            start_server
            sleep 0.4
            ;;
        o|O) open_browser "http://localhost:$PORT_ACTIVE" || true ;;
        q|Q) break ;;
        "$CTRL_C") : ;;   # Ctrl+C at the menu: harmless no-op, just redraw
        *) : ;;
    esac
done

# 'q' falls through here; the EXIT trap runs cleanup() (restores the tty).
