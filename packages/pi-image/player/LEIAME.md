# player do Pi

O que roda nos pontos de vídeo da expo Nação Ilê (CCBB Salvador), num Pi 3B+ **sem rede**: o cartão sai pronto da estação
de campo (`../grava-cartao.sh` → `../cartao-offline.sh` → `../cartao-conteudo.sh`) e no primeiro boot o `aya-instala`
instala esta pasta da cache do cartão pelo `../provision.sh`. Com rede, `../provisiona.sh <pi>` faz o mesmo.
Testado no pbancada (27/10), no p02 (29-30/10) e em cartões virtuais na estação (29-30/10).

## Cartão

```
p1  bootfs     cmdline.txt com overlayroot=tmpfs:recurse=0 depois do primeiro boot; aya-instala.txt com o estado da instalação
p2  rootfs     8 GiB, somente leitura em operação (o que o sistema escreve fica na RAM e some no boot)
p3  aya-dados  o resto, /var/lib/aya-player, gravável: conteudo/ (vídeos, lista.m3u, som.conf), aya-boot.mp4, registro
```

Queda de energia não corrompe a raiz. Mexer no sistema: tirar o `overlayroot=...` do `cmdline.txt` (cartão na estação) ou
`sudo overlayroot-chroot`. O primeiro boot é retomado no boot seguinte se cair no meio (`aya-instala.service`, tentativas e
registro em `/var/lib/aya-instala/`).

## O que tem

- `bin/aya-player-lista`: lê a lista `.m3u`, mede o fps de cada arquivo e trava a saída HDMI no menor modo 1080p múltiplo do
  fps (24 fps sai a 24 Hz, 25 fps a 50 Hz). Com um arquivo só, `--loop-file=inf` (emenda de no máximo 0,1 s). Som pelo
  `som.conf` ao lado da lista (`volume=`, `ganho_db=`, `saida=p2|usb`), padrão P2 do Pi, volume 100, sem ganho; placa USB só
  com `saida=usb` (no 3B+ a UCA222 perde pacotes com vídeo tocando). Lista vazia ou ausente: tela de espera com o
  `aya-boot.mp4` em loop, sem som, até a lista ganhar vídeo.
- `bin/aya-player-log`, a cada minuto: registro da saída (trocas de buffer no CRTC, erros de commit, PCM, avsync,
  temperatura, throttled) em `registro.csv`, com o número do boot; hora que nunca volta (sem RTC nem rede, cada boot
  recomeça da última registrada, `estado.json`); vigia (2 min de tela parada reiniciam o player, 3 reinícios sem resolver
  reiniciam o Pi, no máximo uma vez a cada 15 min e só com tela ligada); LED verde (coração = ok, pisca rápido = problema,
  fixo = sem vídeo); remonta a aya-dados se ela não subiu.
- `systemd/aya-boot.service`: toca `aya-boot.mp4` uma vez, antes do player.
- `systemd/aya-player.service`: o player (`TimeoutStopSec=10`, para o vigia não esperar um mpv congelado).
- `systemd/aya-player-log.{service,timer}`: o registro e o vigia (`TimeoutStartSec=50`).
- `pbancada-2026-10-27/`: cópia fiel do pbancada antes da troca de nome (`aya-stress`), referência histórica.

## Opções do mpv

Base: `--hwdec=v4l2m2m --drm-drmprime-video-plane=primary --drm-draw-plane=overlay`, áudio no fone
(`alsa/plughw:CARD=Headphones`); o `--volume` do som.conf vem depois e vale ele.
Vencedora do autoresearch (27/10): `--osd-level=0 --no-osc --load-scripts=no --audio-format=s16 --cache=no`.
CPU de 16,8% de um núcleo contra 21,8% sem elas, 0 minuto ruim por hora
(2 noites de medição, método em `implante/research/ccbb-players-autoresearch-2026-10-26/`).

## Em aberto

- Projetor desligado no boot: o `hdmi_force_hotplug` é da pilha antiga do firmware e com KMS talvez não force a saída.
  O player tenta de novo os modos a cada volta da lista, mas com um arquivo só em loop isso só acontece no reinício.
  Medir com o projetor desligado; se precisar, `video=HDMI-A-1:1920x1080@60D` no cmdline. O `../gera-edid.py` não é usado
  (e declararia só 1080p60, o que quebraria a trava de fps).
- PJLink e CEC: fora, a energia do circuito liga e desliga tudo (NEC com Direct Power On).
- O mpv do boot avisa "Could not find any preferred mode" na TV Sony e pega o primeiro modo.
