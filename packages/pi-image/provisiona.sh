#!/usr/bin/env bash
# Provisiona um player a partir do AYA2: manda a pasta player/ e roda o provision.sh no Pi. Idempotente.
# uso: ./provisiona.sh <host ou ip> [chave ssh]
# ex.: ./provisiona.sh 192.168.15.130 ~/.ssh/id_ed25519_fleet
set -euo pipefail
pi=$1; chave=${2:-$HOME/.ssh/id_ed25519_fleet}
aqui=$(cd "$(dirname "$0")" && pwd)
ssh_=(ssh -i "$chave" -o BatchMode=yes "aya@$pi")
rsync -a --delete -e "ssh -i $chave -o BatchMode=yes" --exclude pbancada-2026-10-27 --exclude LEIAME.md "$aqui/player/" "aya@$pi:/tmp/aya-player-pacote/"
"${ssh_[@]}" 'sudo bash -s' < "$aqui/provision.sh"
