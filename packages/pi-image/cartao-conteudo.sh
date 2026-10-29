#!/usr/bin/env bash
# Põe os vídeos de um ponto direto no cartão do player, pelo leitor, sem rede: serve na gravação de um cartão novo e na
# troca de conteúdo (tira o cartão do Pi, atualiza, devolve). A pasta conteudo/ passa a ter exatamente estes vídeos e a
# lista.m3u esta ordem (a anterior fica com data); sha256 conferido no cartão depois do sync.
# uso: sudo ./cartao-conteudo.sh <dispositivo> [--boot aya-boot.mp4] [--volume N] [--ganho dB] <video.mp4>...
#   --volume/--ganho escrevem o som.conf do ponto ao lado da lista (lido pelo aya-player-lista)
# (AYA_TESTE_LOOP=1 aceita /dev/loopN)
set -euo pipefail
dev=$1; shift; boot=''; vol=''; ganho=''; vids=()
while (( $# )); do case $1 in --boot) boot=$2; shift 2;; --volume) vol=$2; shift 2;; --ganho) ganho=$2; shift 2;; *) vids+=("$1"); shift;; esac; done
re='^/dev/(sd[b-z]|mmcblk[0-9])$'; [[ ${AYA_TESTE_LOOP:-} == 1 ]] && re='^/dev/(sd[b-z]|mmcblk[0-9]|loop[0-9]+)$'
[[ $dev =~ $re ]] || { echo "recusado: $dev não parece leitor de cartão"; exit 1; }
for v in "${vids[@]}" $boot; do [[ -s $v ]] || { echo "não achei $v"; exit 1; }; done
p2=$(lsblk -lnpo NAME "$dev" | sed -n 3p)
[[ $(lsblk -no FSTYPE "$p2") == ext4 ]] || { echo "recusado: $dev não tem a raiz ext4 do player"; exit 1; }
for p in $(lsblk -lnpo NAME "$dev" | tail -n +2); do umount "$p" 2>/dev/null || true; done
r=$(mktemp -d); mount "$p2" "$r"; trap 'umount "$r" 2>/dev/null; rmdir "$r" 2>/dev/null' EXIT
[[ -f $r/var/lib/aya-instala/instala.sh || -f $r/usr/local/bin/aya-player-lista ]] || { echo "recusado: o cartão não é de player AYA"; exit 1; }
# o nome vem do user-data (antes do primeiro boot o /etc/hostname ainda é raspberrypi)
p1=$(lsblk -lnpo NAME "$dev" | sed -n 2p); b=$(mktemp -d); mount -o ro "$p1" "$b"
host=$(sed -n 's/^hostname: *//p' "$b/user-data" 2>/dev/null | head -1); umount "$b"; rmdir "$b"
# /var/lib/aya-player é a 3ª partição (aya-dados) nos cartões com raiz somente leitura; nos antigos, pasta da raiz
p3=$(lsblk -lnpo NAME "$dev" | sed -n 4p); dados=$r/var/lib/aya-player
if [[ -n $p3 && $(lsblk -no LABEL "$p3") == aya-dados ]]; then
  dados=$(mktemp -d); mount "$p3" "$dados"; trap 'umount "$dados" "$r" 2>/dev/null; rmdir "$dados" "$r" 2>/dev/null' EXIT
fi
d=/var/lib/aya-player/conteudo; c=$dados/conteudo; mkdir -p "$c"
# o que não está na lista nova sai antes de copiar, para caber
mapfile -t novos < <(for v in "${vids[@]}"; do basename "$v"; done)
for f in "$c"/*; do
  [[ -f $f ]] || continue; n=$(basename "$f")
  [[ $n == lista.m3u* ]] && continue
  printf '%s\n' "${novos[@]}" | grep -qxF "$n" || rm -f "$f"
done
precisa=$(du -cb "${vids[@]}" $boot | tail -1 | cut -f1); livre=$(df -B1 --output=avail "$dados" | tail -1)
(( precisa < livre )) || { echo "não cabe: precisa $((precisa / 1000000)) MB, livre $((livre / 1000000)) MB"; exit 1; }
for v in "${vids[@]}"; do rsync -t --inplace --info=progress2 "$v" "$c/"; done
[[ -n $boot ]] && cp "$boot" "$dados/aya-boot.mp4"
[[ -f $c/lista.m3u ]] && cp "$c/lista.m3u" "$c/lista.m3u.$(date +%Y%m%d-%H%M%S)"
for n in "${novos[@]}"; do echo "$d/$n"; done > "$c/lista.m3u"
[[ -n $vol$ganho ]] && printf 'volume=%s\nganho_db=%s\n' "${vol:-100}" "${ganho:-0}" > "$c/som.conf"
chown -R 1000:1000 "$dados"   # aya é o primeiro usuário que o cloud-init cria
sync; echo 3 > /proc/sys/vm/drop_caches
for v in "${vids[@]}"; do
  [[ $(sha256sum < "$v") == $(sha256sum < "$c/$(basename "$v")") ]] || { echo "ERRO: $(basename "$v") chegou diferente no cartão"; exit 1; }
done
echo "ok: ${host:-cartão novo} com ${#vids[@]} vídeo(s), sha256 conferido: $(printf '%s ' "${novos[@]}")${vol:+, volume $vol}${ganho:+ ganho $ganho dB}"
