# Setup: Node (mini PC Ubuntu)

Guia completo para configurar um mini PC como node Polycast.
Testado em Ubuntu 22.04 LTS.

---

## Requisitos

- Mini PC com Ubuntu 22.04+ (Beelink S12 Pro, NUC, ou similar)
- Saída HDMI para o projetor
- Conexão Ethernet à rede local da AYA
- SSH key da máquina de authoring autorizada

---

## 1. Instalar dependências

```bash
sudo apt update
sudo apt install -y mpv nodejs npm rsync curl

# Verificar versões
mpv --version       # >= 0.32
node --version      # >= 18
```

---

## 2. Criar usuário e diretórios

```bash
# Criar usuário dedicado
sudo useradd -m -s /bin/bash polycast
sudo mkdir -p /opt/polycast/content
sudo chown -R polycast:polycast /opt/polycast

# Permitir mpv iniciar sem display (precisa estar no grupo video)
sudo usermod -aG video,audio polycast
```

---

## 3. Instalar o node-agent

```bash
# Clone do repo (ou copiar via rsync da máquina de authoring)
sudo -u polycast git clone https://github.com/sztlink/polycast.git /opt/polycast/app
cd /opt/polycast/app
npm install

# Ou copiar apenas o pacote node-agent:
# rsync -avz polycast@authoring:/path/to/polycast/packages/node-agent/ /opt/polycast/node-agent/
```

---

## 4. Criar o arquivo de configuração

```bash
sudo -u polycast nano /opt/polycast/config.json
```

Conteúdo (gerado pelo `polycast-export`, ajustar se necessário):

```json
{
  "nodeId": "node-1",
  "masterHost": "192.168.1.100",
  "masterPort": 3001,
  "videoFile": "/opt/polycast/content/video.mp4"
}
```

---

## 5. Instalar o serviço systemd

```bash
sudo cp /opt/polycast/app/packages/node-agent/systemd/polycast-node.service \
        /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable polycast-node
sudo systemctl start polycast-node

# Verificar status
sudo systemctl status polycast-node
```

---

## 6. Configurar autostart do display (Wayland/X11)

Para mpv abrir em fullscreen sem usuário logado, precisa do display server rodando.

### Opção A: autologin + mpv via systemd (recomendado)

```bash
# Habilitar autologin para o usuário polycast
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d/
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin polycast --noclear %I $TERM
EOF
```

Configurar `~/.bashrc` do usuário polycast para iniciar X se TTY1:
```bash
# Adicionar no ~/.bashrc do polycast:
if [[ -z "$DISPLAY" ]] && [[ $(tty) = /dev/tty1 ]]; then
  startx
fi
```

### Opção B: modo kiosk com openbox (mais robusto para instalação longa)

```bash
sudo apt install -y openbox
# Configurar .xinitrc do polycast para abrir apenas openbox
# mpv fullscreen não precisa de WM, mas openbox garante display estável
```

---

## 7. Autorizar SSH key da máquina de authoring

```bash
sudo -u polycast mkdir -p /home/polycast/.ssh
sudo -u polycast tee -a /home/polycast/.ssh/authorized_keys << EOF
[colar aqui a chave pública da máquina de authoring]
EOF
sudo chmod 600 /home/polycast/.ssh/authorized_keys
```

---

## 8. Testar manualmente

```bash
# Testar mpv standalone
mpv --fullscreen --loop=inf /opt/polycast/content/video.mp4

# Testar node-agent
sudo -u polycast node /opt/polycast/app/packages/node-agent/src/index.js

# Ver logs
tail -f ~/polycast.log
journalctl -u polycast-node -f
```

---

## 9. Verificar no dashboard

Com o master rodando, abrir `http://{master-ip}:3000`.
O node deve aparecer na grid com status ● verde.

Se não aparecer:
1. Verificar `masterHost` no `config.json`
2. Verificar que porta 3001 está acessível na rede
3. Checar `journalctl -u polycast-node -n 50`

---

## IPs reservados (AYA Studio)

| Node   | IP              | Projetor |
|--------|-----------------|----------|
| node-1 | 192.168.1.101   | P1 (esq) |
| node-2 | 192.168.1.102   | P2       |
| node-3 | 192.168.1.103   | P3       |
| node-4 | 192.168.1.104   | P4 (dir) |
| master | 192.168.1.100   | —        |

> Atualizar com IPs reais após setup de rede.
