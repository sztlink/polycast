#!/usr/bin/env bash
# Põe os vídeos de um ponto direto no cartão do player, pelo leitor, sem rede: serve na gravação de um cartão novo e na
# troca de conteúdo (tira o cartão do Pi, atualiza, devolve). A pasta conteudo/ passa a ter exatamente estes vídeos e a
# lista.m3u esta ordem (a anterior fica com data); sha256 conferido no cartão depois do sync.
# uso: sudo ./cartao-conteudo.sh <dispositivo> [--boot aya-boot.mp4] [--volume N] [--ganho dB] (<video.mp4>... | --vazio)
#   --volume/--ganho escrevem o som.conf do ponto ao lado da lista (lido pelo aya-player-lista)
# (AYA_TESTE_LOOP=1 aceita /dev/loopN)
set -euo pipefail
# Se cair no meio (cartão puxado, falta de espaço, sha256 diferente), o cartão fica com a lista vazia: o Pi mostra a tela de
# espera, nunca uma lista apontando para vídeo apagado ou pela metade. A lista nova só entra depois do sha256 conferido.
dev=$1; shift; boot=(); vol=''; ganho=''; vids=(); vazio=0
while (( $# )); do case $1 in --boot) boot=("$2"); shift 2;; --volume) vol=$2; shift 2;; --ganho) ganho=$2; shift 2;; --vazio) vazio=1; shift;; *) vids+=("$1"); shift;; esac; done
aqui=$(cd "$(dirname "$0")" && pwd)
source "$aqui/guarda-cartao.sh"; guarda_cartao "$dev" montado-ok   # o Cinnamon abre o cartão sozinho; desmontado abaixo
(( ${#vids[@]} || vazio )) || { echo "recusado: nenhum vídeo (use --vazio para deixar o ponto só com a tela de espera)"; exit 1; }
for v in "${vids[@]}" "${boot[@]}"; do [[ -s $v ]] || { echo "não achei $v"; exit 1; }; done
for v in "${vids[@]}"; do [[ $(basename "$v") != \#* ]] || { echo "recusado: nome começando com # vira comentário na lista: $v"; exit 1; }; done
p2=$(lsblk -lnpo NAME "$dev" | sed -n 3p)
[[ $(lsblk -no FSTYPE "$p2") == ext4 ]] || { echo "recusado: $dev não tem a raiz ext4 do player"; exit 1; }
for p in $(lsblk -lnpo NAME "$dev" | tail -n +2); do umount "$p" 2>/dev/null || true; done
p3=$(lsblk -lnpo NAME "$dev" | sed -n 4p); novo_layout=0
[[ -n $p3 && $(lsblk -no LABEL "$p3") == aya-dados ]] && novo_layout=1
r=$(mktemp -d); mount $( (( novo_layout )) && echo -o ro) "$p2" "$r"; trap 'umount "$r" 2>/dev/null || true; rmdir "$r" 2>/dev/null || true' EXIT
[[ -f $r/var/lib/aya-instala/instala.sh || -f $r/usr/local/bin/aya-player-lista ]] || { echo "recusado: o cartão não é de player AYA"; exit 1; }
# o nome vem do user-data (antes do primeiro boot o /etc/hostname ainda é raspberrypi)
p1=$(lsblk -lnpo NAME "$dev" | sed -n 2p); b=$(mktemp -d); mount -o ro "$p1" "$b"
host=$(sed -n 's/^hostname: *//p' "$b/user-data" 2>/dev/null | head -1); umount "$b"; rmdir "$b"
# /var/lib/aya-player é a 3ª partição (aya-dados) nos cartões com raiz somente leitura; nos antigos, pasta da raiz
dados=$r/var/lib/aya-player
if (( novo_layout )); then
  dados=$(mktemp -d); mount "$p3" "$dados"; trap 'umount "$dados" "$r" 2>/dev/null || true; rmdir "$dados" "$r" 2>/dev/null || true' EXIT
fi
d=/var/lib/aya-player/conteudo; c=$dados/conteudo; mkdir -p "$c"
mapfile -t novos < <(for v in "${vids[@]}"; do basename "$v"; done)
na_lista() { printf '%s\n' "${novos[@]}" | grep -qxF "$1"; }
# espaço antes de apagar qualquer coisa: entra o que não está igual no cartão (rsync pula o que tem mesmo tamanho e data),
# sai o que não está na lista nova e o que vai ser sobrescrito
precisa=0; libera=0
for v in "${vids[@]}" "${boot[@]}"; do
  [[ ${#boot[@]} -gt 0 && $v == "${boot[0]}" ]] && alvo=$dados/aya-boot.mp4 || alvo=$c/$(basename "$v")
  if [[ -f $alvo && $(stat -c %s.%Y "$alvo") == $(stat -c %s.%Y "$v") ]]; then continue; fi
  precisa=$((precisa + $(stat -c %s "$v"))); [[ -f $alvo ]] && libera=$((libera + $(stat -c %s "$alvo")))
done
for f in "$c"/*; do [[ -f $f ]] || continue; n=$(basename "$f"); [[ $n == lista.m3u* || $n == som.conf ]] && continue
  na_lista "$n" || libera=$((libera + $(stat -c %s "$f"))); done
livre=$(df -B1 --output=avail "$dados" | tail -1)
(( precisa + 50000000 < livre + libera )) || { echo "não cabe: precisa $((precisa / 1000000)) MB, livre $(((livre + libera) / 1000000)) MB; nada foi mudado"; exit 1; }
# a partir daqui o cartão muda: primeiro a lista fica vazia (tela de espera se algo falhar), a anterior guardada com data
[[ -f $c/lista.m3u ]] && cp "$c/lista.m3u" "$c/lista.m3u.$(date +%Y%m%d-%H%M%S)"
: > "$c/lista.m3u.novo"; mv "$c/lista.m3u.novo" "$c/lista.m3u"; sync
for f in "$c"/*; do [[ -f $f ]] || continue; n=$(basename "$f"); [[ $n == lista.m3u* || $n == som.conf ]] && continue
  na_lista "$n" || rm -f "$f"; done
for v in "${vids[@]}"; do rsync -t --inplace --info=progress2 "$v" "$c/"; done
(( ${#boot[@]} )) && cp "${boot[0]}" "$dados/aya-boot.mp4"
[[ -n $vol$ganho ]] && { printf 'volume=%s\nganho_db=%s\n' "${vol:-100}" "${ganho:-0}" > "$c/som.conf.novo"; mv "$c/som.conf.novo" "$c/som.conf"; }
chown -R 1000:1000 "$dados"   # aya é o primeiro usuário que o cloud-init cria
sync; echo 3 > /proc/sys/vm/drop_caches
for v in "${vids[@]}"; do
  [[ $(sha256sum < "$v") == $(sha256sum < "$c/$(basename "$v")") ]] || { echo "ERRO: $(basename "$v") chegou diferente no cartão; a lista ficou vazia (tela de espera)"; exit 1; }
done
for n in "${novos[@]}"; do echo "$d/$n"; done > "$c/lista.m3u.novo"; chown 1000:1000 "$c/lista.m3u.novo"; mv "$c/lista.m3u.novo" "$c/lista.m3u"; sync
echo "ok: ${host:-cartão novo} com ${#vids[@]} vídeo(s), sha256 conferido: $(printf '%s ' "${novos[@]}")${vol:+, volume $vol}${ganho:+ ganho $ganho dB}"
