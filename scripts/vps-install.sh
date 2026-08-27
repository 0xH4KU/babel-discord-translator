#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Babel Discord Translator"
DEFAULT_PORT="3000"
MAX_HEALTH_ATTEMPTS="30"

info() {
    printf '[babel] %s\n' "$1"
}

warn() {
    printf '[babel] WARNING: %s\n' "$1" >&2
}

fail() {
    printf '[babel] ERROR: %s\n' "$1" >&2
    exit 1
}

repo_root() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "${script_dir}/.." && pwd
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

is_ubuntu() {
    [[ -r /etc/os-release ]] && grep -q '^ID=ubuntu$' /etc/os-release
}

confirm() {
    local prompt="$1"

    if [[ ! -t 0 ]]; then
        return 1
    fi

    read -r -p "${prompt} [y/N] " reply
    [[ "${reply}" == "y" || "${reply}" == "Y" || "${reply}" == "yes" || "${reply}" == "YES" ]]
}

install_docker_on_ubuntu() {
    info "Installing Docker using Docker's official convenience script."
    sudo apt-get update
    sudo apt-get install -y curl ca-certificates
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sudo sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh

    if ! groups "$USER" | grep -q '\bdocker\b'; then
        sudo usermod -aG docker "$USER" || true
        warn "Your user was added to the docker group. Log out and back in if docker commands require sudo."
    fi
}

ensure_docker() {
    if command_exists docker && docker compose version >/dev/null 2>&1; then
        return
    fi

    if is_ubuntu && confirm "Docker or Docker Compose is missing. Install Docker now?"; then
        install_docker_on_ubuntu
    fi

    if ! command_exists docker; then
        fail "Docker is not installed. Install Docker, then run: bash scripts/vps-install.sh"
    fi

    if ! docker compose version >/dev/null 2>&1; then
        fail "Docker Compose is not available. Install the Docker Compose plugin, then rerun this script."
    fi
}

ensure_env_file() {
    if [[ -f .env ]]; then
        info "Refusing to overwrite existing .env; using the current file."
        return
    fi

    cp .env.example .env
    info "Created .env from .env.example."
    warn "Edit .env before production use: set DISCORD_TOKEN and a strong DASHBOARD_PASSWORD."
}

read_env_value() {
    local key="$1"
    local value

    value="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d '=' -f 2- || true)"
    printf '%s' "${value}"
}

warn_about_placeholders() {
    local token password app_profile
    local has_placeholder=0

    token="$(read_env_value DISCORD_TOKEN)"
    password="$(read_env_value DASHBOARD_PASSWORD)"
    app_profile="$(read_env_value BABEL_APP)"

    if [[ -z "${token}" || "${token}" == "your_bot_token_here" ]]; then
        warn "DISCORD_TOKEN is still the example value."
        has_placeholder=1
    fi

    if [[ -z "${password}" || "${password}" == "change_me" || "${password}" == "admin" ]]; then
        warn "DASHBOARD_PASSWORD is still the example value."
        has_placeholder=1
    fi

    if [[ "${app_profile:-guild}" != "guild" && "${app_profile}" != "pocket" && "${app_profile}" != "combined" ]]; then
        warn "BABEL_APP should be guild, pocket, or combined. Current value: ${app_profile}"
        has_placeholder=1
    fi

    if [[ "${has_placeholder}" -eq 1 ]]; then
        warn "Open .env in your editor, then rerun this script."
        if [[ -t 0 && -n "${EDITOR:-}" ]] && confirm "Open .env with ${EDITOR}?"; then
            "${EDITOR}" .env
            warn_about_placeholders
            return
        fi
        exit 1
    fi
}

dashboard_port() {
    local port

    port="$(read_env_value DASHBOARD_PORT)"
    printf '%s' "${port:-${DEFAULT_PORT}}"
}

app_profile() {
    local profile

    profile="$(read_env_value BABEL_APP)"
    printf '%s' "${profile:-guild}"
}

wait_for_livez() {
    local port="$1"
    local url="http://localhost:${port}/livez"
    local attempt

    info "Waiting for ${url} ..."
    for attempt in $(seq 1 "${MAX_HEALTH_ATTEMPTS}"); do
        if curl -fsS "${url}" >/dev/null 2>&1; then
            info "Health check passed: ${url}"
            return
        fi
        sleep 2
    done

    warn "Health check did not pass yet. Inspect logs with: docker compose logs -f babel"
}

print_next_steps() {
    local port="$1"
    local profile="$2"
    local register_command

    case "${profile}" in
        pocket)
            register_command="docker compose exec babel npm run register:built:pocket"
            ;;
        combined)
            register_command="docker compose exec babel npm run register:built:guild
  docker compose exec babel npm run register:built:pocket"
            ;;
        *)
            register_command="docker compose exec babel npm run register:built:guild"
            ;;
    esac

    cat <<EOF

${APP_NAME} is starting.

Dashboard:
  http://localhost:${port}

Useful commands:
  docker compose logs -f babel
  docker compose ps
  docker compose restart babel

Register Discord commands after DISCORD_APP_ID is set in .env:
  ${register_command}

The script does not register Discord commands for you. This avoids registering the wrong Guild/Pocket command surface.
EOF
}

main() {
    cd "$(repo_root)"

    ensure_docker
    ensure_env_file
    warn_about_placeholders

    info "Starting Docker Compose deployment."
    docker compose up -d --build

    wait_for_livez "$(dashboard_port)"
    print_next_steps "$(dashboard_port)" "$(app_profile)"
}

main "$@"
