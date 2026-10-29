#!/usr/bin/env bash
# Base do player AYA num Raspberry Pi OS Lite Trixie recém-bootado. Idempotente.
# uso (do AYA2): ./provisiona.sh <pi>   (manda a pasta player/ e roda este script no Pi)
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# pacotes: player, controle de TV (cec-ctl vem no v4l-utils), acesso remoto, diagnóstico
# sem internet (estação de campo), o provisiona-campo.sh já deixou listas e pacotes na cache local
apt-get update -q || echo 'sem internet: instalando da cache local do apt'
# sem npm (29/10): eram centenas de pacotes node e a maior parte do primeiro boot; o player não usa
apt-get install -y -q --no-install-recommends mpv wireguard-tools v4l-utils nodejs jq rsync alsa-utils

# boot silencioso e sem tela de console
cfg=/boot/firmware/config.txt
grep -q '^disable_splash=1' $cfg || echo 'disable_splash=1' >> $cfg
grep -q '^dtparam=watchdog=on' $cfg || echo 'dtparam=watchdog=on' >> $cfg
grep -q '^hdmi_force_hotplug=1' $cfg || echo 'hdmi_force_hotplug=1' >> $cfg   # sobe a imagem mesmo com TV/projetor desligado
cmd=/boot/firmware/cmdline.txt
# fbcon=map:9: o console (tty1, que o initramfs exige) não se liga ao framebuffer, então nenhum texto do Linux aparece na tela
for o in quiet loglevel=3 logo.nologo vt.global_cursor_default=0 consoleblank=0 fbcon=map:9; do
  grep -qw "$o" $cmd || sed -i "s/\$/ $o/" $cmd
done

# cabo direto da estação de campo, sem roteador (29/10): sem DHCP, o Pi pega 169.254.x.x e é achado pelo nome .local
mkdir -p /etc/NetworkManager/conf.d
printf '[connection]\nipv4.link-local=fallback\nipv4.dhcp-timeout=20\n' > /etc/NetworkManager/conf.d/80-aya-cabo-direto.conf

# watchdog de hardware: o systemd alimenta; se o sistema travar, o Pi reinicia sozinho
mkdir -p /etc/systemd/system.conf.d
printf '[Manager]\nRuntimeWatchdogSec=15\nRebootWatchdogSec=2min\n' > /etc/systemd/system.conf.d/aya-watchdog.conf

# journal em memória (o root vai ficar somente leitura) e sem serviços que não servem ao player
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=volatile\nRuntimeMaxUse=32M\n' > /etc/systemd/journald.conf.d/aya.conf
systemctl disable --now apt-daily.timer apt-daily-upgrade.timer man-db.timer 2>/dev/null || true
systemctl disable --now ModemManager bluetooth hciuart 2>/dev/null || true

# diretórios do player
install -d -o aya -g aya /opt/aya-player /var/lib/aya-player /var/lib/aya-player/conteudo

# player: scripts e serviços vêm em /tmp/aya-player-pacote (o provisiona.sh manda a pasta player/)
pac=${AYA_PACOTE:-/tmp/aya-player-pacote}   # no cartão sem rede vem em /var/lib/aya-instala/pacote
if [[ -d $pac ]]; then
  install -m 755 $pac/bin/aya-player-lista $pac/bin/aya-player-log /usr/local/bin/
  install -m 644 $pac/systemd/aya-player.service $pac/systemd/aya-boot.service \
    $pac/systemd/aya-player-log.service $pac/systemd/aya-player-log.timer /etc/systemd/system/
  # cartão que veio da bancada: o teste antigo (aya-stress) sai, o vídeo de boot muda de lugar
  systemctl disable --now aya-stress.service aya-stress-log.timer 2>/dev/null || true
  [[ -f /var/lib/aya-player/teste/aya-boot.mp4 && ! -f /var/lib/aya-player/aya-boot.mp4 ]] \
    && install -m 644 -o aya -g aya /var/lib/aya-player/teste/aya-boot.mp4 /var/lib/aya-player/
  [[ -f /var/lib/aya-player/conteudo/lista.m3u ]] || install -m 664 -o aya -g aya /dev/null /var/lib/aya-player/conteudo/lista.m3u
  systemctl daemon-reload
  systemctl enable aya-boot.service aya-player.service aya-player-log.timer
  systemctl restart aya-player.service aya-player-log.timer
  rm -r $pac
fi
echo "ok: base do player em $(hostname), $(tr -d '\0' < /proc/device-tree/model)"
