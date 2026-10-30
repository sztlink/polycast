# Guardas comuns dos scripts que escrevem num cartão (grava-cartao, cartao-offline, cartao-conteudo): só leitor de cartão
# removível, até 140 GB, nunca o disco do sistema. Uso: source "$aqui/guarda-cartao.sh"; guarda_cartao <dev> [montado-ok]
# (AYA_TESTE_LOOP=1 aceita /dev/loopN, para ensaiar numa imagem em arquivo, nunca um disco)
guarda_cartao() {
  local dev=$1 nome re tam raiz
  nome=$(basename "$dev")
  re='^/dev/(sd[b-z]|mmcblk[0-9])$'; [[ ${AYA_TESTE_LOOP:-} == 1 ]] && re='^/dev/(sd[b-z]|mmcblk[0-9]|loop[0-9]+)$'
  [[ $dev =~ $re ]] || { echo "recusado: $dev não parece leitor de cartão"; exit 1; }
  [[ $(cat /sys/block/$nome/removable 2>/dev/null) == 1 || $nome == mmcblk* || $nome == loop* ]] || { echo "recusado: $dev não é removível"; exit 1; }
  tam=$(lsblk -bndo SIZE "$dev")
  (( tam > 0 && tam <= 140000000000 )) || { echo "recusado: tamanho $tam fora de 0-140 GB"; exit 1; }
  raiz=$(findmnt -no SOURCE / | xargs -I{} lsblk -no PKNAME {} 2>/dev/null | head -1)
  [[ $nome != "$raiz" ]] || { echo "recusado: $dev é o disco do sistema"; exit 1; }
  [[ ${2:-} == montado-ok ]] || ! lsblk -no MOUNTPOINTS "$dev" | grep -q . || { echo "recusado: $dev tem partição montada"; exit 1; }
}
