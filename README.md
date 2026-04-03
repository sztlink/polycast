# ⬡ polycast

**Distributed immersive playback — replace Resolume Arena with a cluster of cheap nodes.**

One mini PC per projector. Short HDMI. Long Ethernet. Pre-rendered video. Automatic sync. No expensive license.

---

## The Problem

Running a single pre-rendered video on loop for 4 months across 4 projectors shouldn't require:
- A R$15k workstation
- A R$2.5k Resolume Arena license
- Expensive fiber HDMI cables

Polycast is the alternative for **fixed installations where the content is already rendered**.

## Architecture

```
authoring machine (Windows/Mac/Linux)
  └── polycast-export → splits master video into per-node slices

network (Ethernet)
  ├── master server → sync server + web dashboard
  ├── node-1 (mini PC) → mpv → projector 1 [HDMI]
  ├── node-2 (mini PC) → mpv → projector 2 [HDMI]
  ├── node-3 (mini PC) → mpv → projector 3 [HDMI]
  └── node-4 (mini PC) → mpv → projector 4 [HDMI]
```

## Packages

| Package | Description |
|---|---|
| `@polycast/exporter` | CLI: splits master video into node slices with baked edge blending |
| `@polycast/node-agent` | Daemon on each mini PC: controls mpv, syncs with master |
| `@polycast/master` | Sync server + web dashboard |

## Quick Start

### 1. Export content

```bash
npm install
node packages/exporter/src/index.js \
  --input master.mp4 \
  --config examples/aya-studio-4p.json \
  --output ./dist
```

### 2. Deploy to nodes

```bash
node packages/exporter/src/deploy.js \
  --config examples/aya-studio-4p.json \
  --dist ./dist \
  --user polycast
```

### 3. Start master

```bash
cd packages/master
npm install
npm start
# Dashboard at http://localhost:3000
```

### 4. Setup each node

See [docs/setup-node.md](docs/setup-node.md) for full Ubuntu setup guide.

```bash
# On each mini PC (Ubuntu 22.04)
sudo apt install mpv nodejs npm
git clone https://github.com/sztlink/polycast /opt/polycast/app
npm install --prefix /opt/polycast/app
# Edit /opt/polycast/config.json
sudo systemctl enable --now polycast-node
```

## Layout Config

The `layout.json` defines your canvas and projector geometry:

```json
{
  "canvas": { "width": 7200, "height": 1080, "fps": 25 },
  "master": { "host": "192.168.1.100", "port": 3001 },
  "nodes": [
    {
      "id": "node-1",
      "host": "192.168.1.101",
      "crop": { "x": 0, "y": 0, "w": 2080, "h": 1080 },
      "blend": { "right": 160 }
    }
  ]
}
```

See `examples/aya-studio-4p.json` for the full 4-projector AYA Studio layout.

## Sync Model

- **Software sync** via WebSocket (no genlock/framelock hardware required)
- Master broadcasts timecode every 1s
- Nodes self-correct if drift > 200ms
- Typical drift in practice: 50–150ms — imperceptible for contemplative video

## Edge Blending

Blend is **baked into the exported video** via ffmpeg `geq` filter:
- Linear luminance ramp at overlap zones
- No runtime processing on nodes (dumb players)
- Re-export needed if blend needs adjustment (usually once per installation)

## Requirements

| Component | Requirements |
|---|---|
| Exporter | Node.js 18+, ffmpeg in PATH |
| Node agent | Ubuntu 22.04+, Node.js 18+, mpv |
| Master | Node.js 18+, any OS |

## Hardware for AYA 4-Projector Setup

Recommended mini PC: **Beelink S12 Pro** (~R$800)
- Intel N100, 16GB RAM, 500GB SSD
- HDMI 2.0 output
- Fanless / low noise
- Proven at AYA (already used for kiosks)

4 nodes + switch + cables ≈ R$3.500 total
vs. workstation + Arena license ≈ R$18.000+

## Status

MVP — built for AYA Studio 4-projector installation, April 2026.

- [x] Exporter with crop + blend
- [x] Node agent with mpv IPC + watchdog
- [x] Master sync server
- [x] Web dashboard
- [ ] Field test with real projectors (pending hardware)

## License

MIT — AYA Studio / Felipe Sztutman
