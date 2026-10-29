#!/usr/bin/env bash
# Deixa um cartão recém-gravado pelo grava-cartao.sh pronto para virar player SEM REDE (montagem do CCBB, decisão 29/10):
# faz a raiz de 8 GiB e a partição de dados com o resto (o Pi não precisa fazer o resize), leva a cache do apt
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

[[ -z $(lsblk -lnpo NAME "$dev" | sed -n 4p) ]] || { echo "recusado: $dev já tem 3ª partição (já passou por aqui?)"; exit 1; }
# raiz com 8 GiB e o resto do cartão numa 3ª partição, aya-dados, montada em /var/lib/aya-player (29/10): a raiz roda
# somente leitura (overlayroot, ver provision.sh) e os vídeos, a lista, o som.conf e o registro ficam nela, graváveis.
# Vídeo mandado pela rede não pode cair na camada em RAM (1 GB no Pi 3B+). O "resize" sai do cmdline: não há o que crescer.
ini=$(parted -sm "$dev" unit MiB print | awk -F: '$1==2{sub("MiB","",$2); print int($2)}')
fim=$((ini + 8192)); total=$(( $(lsblk -bndo SIZE "$dev") / 1048576 ))
(( total - fim >= 4096 )) || { echo "recusado: $dev pequeno demais ($total MiB) para raiz de 8 GiB e dados"; exit 1; }
parted -s "$dev" unit MiB resizepart 2 $fim mkpart primary ext4 $fim 100%; partprobe "$dev"; udevadm settle; sleep 1
p3=$(lsblk -lnpo NAME "$dev" | sed -n 4p); [[ -n $p3 ]] || { echo "erro: a 3ª partição não apareceu"; exit 1; }
e2fsck -fy "$p2" >/dev/null || [[ $? -le 1 ]]
resize2fs "$p2" >/dev/null
mkfs.ext4 -q -F -L aya-dados -m 0 "$p3"
b=$(mktemp -d); r=$(mktemp -d); dados=$(mktemp -d); mount "$p1" "$b"; mount "$p2" "$r"; mount "$p3" "$dados"
trap 'umount "$b" "$r" "$dados" 2>/dev/null; rmdir "$b" "$r" "$dados" 2>/dev/null' EXIT
sed -i 's/ resize\b//' "$b/cmdline.txt"
mkdir -p "$r/var/lib/aya-player"
[[ -n $(ls -A "$r/var/lib/aya-player") ]] && mv "$r/var/lib/aya-player/"* "$dados/"
grep -q aya-dados "$r/etc/fstab" || echo 'LABEL=aya-dados  /var/lib/aya-player  ext4  defaults,noatime,nofail  0  2' >> "$r/etc/fstab"
chown -R 1000:1000 "$dados"   # aya é o primeiro usuário que o cloud-init cria

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
echo "ok: $dev pronto para instalar sem rede ($(df -h --output=avail "$dados" | tail -1 | tr -d ' ') livres para vídeos)"
