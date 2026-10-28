# player do Pi

O que roda nos pontos de vídeo da expo Nação Ilê (CCBB Salvador). Instalado pelo `../provisiona.sh <pi>`,
que manda esta pasta e roda o `../provision.sh` no Pi. Testado no pbancada (Pi 3B+, cartão P10) em 27/10/2026:
duas rodadas seguidas (idempotente) e reboot, com o vídeo de boot rodando até o fim, player a 24 Hz no P04, 0 erro de commit, sem texto na tela.

## O que tem

- `bin/aya-player-lista`: lê a lista `.m3u`, mede o fps de cada arquivo com o mpv e trava a saída
  HDMI no menor modo 1080p múltiplo do fps (24 fps sai a 24 Hz, 25 fps a 50 Hz). Detecta placa de som
  USB a cada arquivo. Com um arquivo só na lista, usa `--loop-file=inf` (emenda de no máximo 0,1 s).
- `bin/aya-player-log`: registro por minuto da saída (trocas de buffer no CRTC, erros de commit,
  PCM, avsync, temperatura) em `/var/lib/aya-player/registro.csv`.
- `systemd/aya-boot.service`: toca `/var/lib/aya-player/aya-boot.mp4` uma vez, antes do player (pula se não houver).
- `systemd/aya-player.service`: o player, lendo `/var/lib/aya-player/conteudo/lista.m3u`.
- `systemd/aya-player-log.{service,timer}`: o registro a cada minuto.
- `pbancada-2026-10-27/`: cópia fiel do pbancada antes da troca de nome (`aya-stress`), para a auditoria comparar.

O conteúdo (vídeos, `lista.m3u`, `aya-boot.mp4`) não está aqui: vai por rsync para `/var/lib/aya-player/`.

## Opções do mpv

Base: `--hwdec=v4l2m2m --drm-drmprime-video-plane=primary --drm-draw-plane=overlay`, áudio no fone
(`alsa/plughw:CARD=Headphones`, volume 70), trocado pela placa USB se houver.

Vencedora do autoresearch (27/10): `--osd-level=0 --no-osc --load-scripts=no --audio-format=s16 --cache=no`.
CPU de 16,8% de um núcleo contra 21,8% sem elas, 0 minuto ruim por hora
(2 noites de medição, método em `implante/research/ccbb-players-autoresearch-2026-10-26/`).

## Falta para a imagem final (auditoria)

- Rede por ponto (IP, hostname p01..p14, peer WG), overlayfs, node-agent, PJLink e CEC.
- Logger: decidir se fica na imagem de produção (grava no cartão a cada minuto; com raiz só leitura,
  vai para `/run` ou sai).
- Volume e saída de áudio por ponto (hoje é 70 no fone para todos).
- O mpv do boot avisa "Could not find any preferred mode" na TV Sony e pega o primeiro modo; o serviço termina com sucesso, mas ninguém olhou a tela.
