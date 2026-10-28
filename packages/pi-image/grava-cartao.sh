#!/usr/bin/env bash
# Grava a imagem base do player num cartão microSD e prepara o primeiro boot (cloud-init).
# uso: sudo ./grava-cartao.sh <imagem.img.xz> <dispositivo> <host> <chave.pub> [chave.pub...]
# ex.: sudo ./grava-cartao.sh 2026-10-06-raspios-trixie-arm64-lite.img.xz /dev/sde p01 ~/.ssh/id_ed25519_fleet.pub
set -euo pipefail
img=$1; dev=$2; host=$3; shift 3
aqui=$(cd "$(dirname "$0")" && pwd)

# guardas: só cartão removível, até 140 GB, nunca o disco do sistema, nada montado
nome=$(basename "$dev")
[[ $dev =~ ^/dev/(sd[b-z]|mmcblk[0-9])$ ]] || { echo "recusado: $dev não parece leitor de cartão"; exit 1; }
[[ $(cat /sys/block/$nome/removable 2>/dev/null) == 1 || $nome == mmcblk* ]] || { echo "recusado: $dev não é removível"; exit 1; }
tam=$(lsblk -bndo SIZE "$dev")
(( tam > 0 && tam <= 140000000000 )) || { echo "recusado: tamanho $tam fora de 0-140 GB"; exit 1; }
raiz=$(findmnt -no SOURCE / | xargs -I{} lsblk -no PKNAME {} 2>/dev/null | head -1)
[[ $nome != "$raiz" ]] || { echo "recusado: $dev é o disco do sistema"; exit 1; }
if lsblk -no MOUNTPOINTS "$dev" | grep -q .; then echo "recusado: $dev tem partição montada"; exit 1; fi
[[ $host =~ ^(p[0-9]{2}|r[0-9]{2}|pbancada)$ ]] || { echo "recusado: host $host fora do padrão p01/r01/pbancada"; exit 1; }

echo "gravando $img em $dev ($((tam / 1000000000)) GB) como $host"
xz -dc "$img" | dd of="$dev" bs=4M conv=fsync status=progress
partprobe "$dev"; sleep 2
p1=$(lsblk -lnpo NAME "$dev" | sed -n 2p)
m=$(mktemp -d); mount "$p1" "$m"
chaves=$(for k in "$@"; do printf '      - %s\n' "$(cat "$k")"; done)
awk -v h="$host" -v c="$chaves" '{gsub("__HOST__", h); if ($0 ~ /__CHAVES__/) print c; else print}' "$aqui/cloud-init/user-data.tmpl" > "$m/user-data"
cp "$aqui/cloud-init/network-config" "$m/network-config"
sed "s/__HOST__/$host/" "$aqui/cloud-init/meta-data" > "$m/meta-data"
# YAML inválido faz o cloud-init ignorar tudo e o Pi sobe sem chave SSH: conferir antes de soltar o cartão
python3 -c "import yaml,sys; d=yaml.safe_load(open(sys.argv[1])); assert d['hostname']==sys.argv[2] and d['users'][0]['ssh_authorized_keys']" "$m/user-data" "$host" \
  || { umount "$m"; echo "erro: user-data inválido"; exit 1; }
sync; umount "$m"; rmdir "$m"
echo "ok: $dev pronto para o primeiro boot como $host"
