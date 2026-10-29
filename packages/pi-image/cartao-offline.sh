#!/usr/bin/env bash
# Deixa um cartão recém-gravado pelo grava-cartao.sh pronto para virar player SEM REDE (montagem do CCBB, decisão 29/10):
# cresce a raiz até o fim do cartão (o Pi não precisa fazer o resize e já cabem os vídeos), leva a cache do apt
# (listas + pacotes arm64 com que a imagem foi feita), a pasta player/ e o provision.sh, e põe no user-data um runcmd que,
# no primeiro boot, instala tudo da cache, liga o player e reinicia. Os vídeos entram depois, pelo cartao-conteudo.sh.
# uso: sudo ./cartao-offline.sh <dispositivo> <cache do apt (lists/ e archives/)>
# (AYA_TESTE_LOOP=1 aceita /dev/loopN, para ensaiar numa imagem em arquivo)
set -euo pipefail
dev=$1; apt=$2
aqui=$(cd "$(dirname "$0")" && pwd)
re='^/dev/(sd[b-z]|mmcblk[0-9])$'; [[ ${AYA_TESTE_LOOP:-} == 1 ]] && re='^/dev/(sd[b-z]|mmcblk[0-9]|loop[0-9]+)$'
[[ $dev =~ $re ]] || { echo "recusado: $dev não parece leitor de cartão"; exit 1; }
[[ -d $apt/lists && -d $apt/archives ]] || { echo "recusado: $apt sem lists/ e archives/"; exit 1; }
if lsblk -no MOUNTPOINTS "$dev" | grep -q .; then echo "recusado: $dev tem partição montada"; exit 1; fi
p1=$(lsblk -lnpo NAME "$dev" | sed -n 2p); p2=$(lsblk -lnpo NAME "$dev" | sed -n 3p)
[[ $(lsblk -no FSTYPE "$p1") == vfat && $(lsblk -no FSTYPE "$p2") == ext4 ]] || { echo "recusado: $dev não tem o layout da imagem (vfat + ext4)"; exit 1; }

# raiz até o fim do cartão; o "resize" sai do cmdline porque já não há o que crescer
parted -s "$dev" resizepart 2 100%; partprobe "$dev"; sleep 1
e2fsck -fy "$p2" >/dev/null || [[ $? -le 1 ]]
resize2fs "$p2" >/dev/null
b=$(mktemp -d); r=$(mktemp -d); mount "$p1" "$b"; mount "$p2" "$r"
trap 'umount "$b" "$r" 2>/dev/null; rmdir "$b" "$r" 2>/dev/null' EXIT
sed -i 's/ resize\b//' "$b/cmdline.txt"

# cache do apt e instalador do primeiro boot
cp -a "$apt/lists/." "$r/var/lib/apt/lists/"
cp -a "$apt/archives/." "$r/var/cache/apt/archives/"
i=$r/var/lib/aya-instala; rm -rf "$i"; mkdir -p "$i/pacote"
cp -a "$aqui/player/bin" "$aqui/player/systemd" "$i/pacote/"
install -m 755 "$aqui/provision.sh" "$i/provision.sh"
cat > "$i/instala.sh" <<'EOF'
#!/bin/bash
# primeiro boot sem rede: instala o player da cache do cartão (cartao-offline.sh) e reinicia uma vez
i=/var/lib/aya-instala
[[ -f $i/feito ]] && exit 0
exec >>$i/instala.log 2>&1
echo "início $(date -Is)"
if AYA_PACOTE=$i/pacote bash $i/provision.sh; then
  chown -R aya:aya /var/lib/aya-player
  date -Is > $i/feito; echo "ok, reiniciando"; sync; systemctl reboot
else
  echo "FALHOU: o Pi fica de pé sem o player; ver este registro"
fi
EOF
chmod 755 "$i/instala.sh"
grep -q aya-instala "$b/user-data" || printf 'runcmd:\n  - [bash, /var/lib/aya-instala/instala.sh]\n' >> "$b/user-data"
python3 -c "import yaml,sys; d=yaml.safe_load(open(sys.argv[1])); assert d['runcmd'] and d['users'][0]['ssh_authorized_keys']" "$b/user-data" \
  || { echo "erro: user-data inválido depois do runcmd"; exit 1; }
sync
echo "ok: $dev pronto para instalar sem rede ($(df -h --output=avail "$r" | tail -1 | tr -d ' ') livres na raiz)"
