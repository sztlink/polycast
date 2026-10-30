#!/usr/bin/env bash
# Deixa um cartão recém-gravado pelo grava-cartao.sh pronto para virar player SEM REDE (montagem do CCBB, decisão 29/10):
# faz a raiz de 8 GiB e a partição de dados com o resto (o Pi não precisa fazer o resize), leva a cache do apt
# (listas + pacotes arm64 com que a imagem foi feita), a pasta player/ e o provision.sh, e um serviço (aya-instala) que,
# no primeiro boot, instala tudo da cache, liga o player e reinicia (retomado no boot seguinte se cair no meio). Os vídeos entram depois, pelo cartao-conteudo.sh.
# uso: sudo ./cartao-offline.sh <dispositivo> <cache do apt (lists/ e archives/)>
# (AYA_TESTE_LOOP=1 aceita /dev/loopN, para ensaiar numa imagem em arquivo)
set -euo pipefail
dev=$1; apt=$2
aqui=$(cd "$(dirname "$0")" && pwd)
source "$aqui/guarda-cartao.sh"; guarda_cartao "$dev"
[[ -d $apt/lists && -d $apt/archives ]] || { echo "recusado: $apt sem lists/ e archives/"; exit 1; }
p1=$(lsblk -lnpo NAME "$dev" | sed -n 2p); p2=$(lsblk -lnpo NAME "$dev" | sed -n 3p)
[[ $(lsblk -no FSTYPE "$p1") == vfat && $(lsblk -no FSTYPE "$p2") == ext4 ]] || { echo "recusado: $dev não tem o layout da imagem (vfat + ext4)"; exit 1; }

[[ -z $(lsblk -lnpo NAME "$dev" | sed -n 4p) ]] || { echo "recusado: $dev já tem 3ª partição (já passou por aqui? regrave pelo grava-cartao)"; exit 1; }
# só cartão recém-gravado: raiz da imagem (~2,5 GB), nunca uma raiz já expandida ou um disco de sistema vfat+ext4
(( $(lsblk -bndo SIZE "$p2") < 8192 * 1048576 )) || { echo "recusado: a raiz de $dev já tem 8 GiB ou mais (não é cartão recém-gravado)"; exit 1; }
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
mkfs.ext4 -q -F -L aya-dados -m 0 -E lazy_itable_init=0,lazy_journal_init=0 "$p3"   # sem zerar inodes no Pi tocando
b=$(mktemp -d); r=$(mktemp -d); dados=$(mktemp -d); mount "$p1" "$b"; mount "$p2" "$r"; mount "$p3" "$dados"
trap 'umount "$b" "$r" "$dados" 2>/dev/null || true; rmdir "$b" "$r" "$dados" 2>/dev/null || true' EXIT
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
# primeiro boot sem rede: instala o player da cache do cartão (cartao-offline.sh) e reinicia uma vez.
# Roda a cada boot até dar certo (aya-instala.service): queda de energia ou falha no meio é retomada no boot seguinte.
i=/var/lib/aya-instala; st=/boot/firmware/aya-instala.txt   # o estado também no bootfs, legível na estação sem ssh
[[ -f $i/feito ]] && exit 0
exec >>$i/instala.log 2>&1
n=$(( $(cat $i/tentativas 2>/dev/null || echo 0) + 1 )); echo $n > $i/tentativas; sync
echo "início $(date -Is), tentativa $n"; echo "instalando, tentativa $n" > $st
dpkg --configure -a || true   # dpkg interrompido por queda de energia na tentativa anterior
if AYA_PACOTE=$i/pacote bash $i/provision.sh; then
  chown -R aya:aya /var/lib/aya-player
  date -Is > $i/feito; echo "ok: instalado na tentativa $n" > $st; echo "ok, reiniciando"; sync; systemctl reboot
else
  echo "FALHOU na tentativa $n: o Pi fica de pé sem o player; ver $i/instala.log" | tee $st
  # LED pisca rápido: o player e o vigia não estão instalados para dizer isso
  echo timer > /sys/class/leds/ACT/trigger 2>/dev/null; echo 100 > /sys/class/leds/ACT/delay_on 2>/dev/null; echo 100 > /sys/class/leds/ACT/delay_off 2>/dev/null
fi
EOF
chmod 755 "$i/instala.sh"
# serviço em vez de runcmd: o runcmd do cloud-init marca "feito" antes de rodar, e uma queda no meio não voltava a tentar.
# Depois do cloud-final (usuário aya criado, locale gerado); DefaultDependencies=no porque o cloud-final vem depois do
# multi-user.target, e o target esperaria por este serviço num ciclo.
cat > "$r/etc/systemd/system/aya-instala.service" <<'EOF'
[Unit]
Description=instala o player AYA da cache do cartão (primeiro boot sem rede)
DefaultDependencies=no
After=basic.target cloud-final.service
Conflicts=shutdown.target
Before=shutdown.target
ConditionPathExists=!/var/lib/aya-instala/feito
[Service]
Type=oneshot
ExecStart=/var/lib/aya-instala/instala.sh
TimeoutStartSec=0
[Install]
WantedBy=multi-user.target
EOF
mkdir -p "$r/etc/systemd/system/multi-user.target.wants"
ln -sf /etc/systemd/system/aya-instala.service "$r/etc/systemd/system/multi-user.target.wants/aya-instala.service"
echo "gravado, ainda não instalado" > "$b/aya-instala.txt"
sync
echo "ok: $dev pronto para instalar sem rede ($(df -h --output=avail "$dados" | tail -1 | tr -d ' ') livres para vídeos)"
