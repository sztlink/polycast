#!/usr/bin/env python3
"""EDID 1.3 fixo de 1920x1080@60 (CEA 1080p60) para o player sair sempre em 1080p,
com a TV ou o projetor ligado ou não no boot. uso: gera-edid.py saida.bin"""
import sys

def descritor_texto(tag, texto):
  t = texto.encode()[:13]
  t += b'\n' + b' ' * (12 - len(t)) if len(t) < 13 else b''
  return bytes([0, 0, 0, tag, 0]) + t

e = bytearray(b'\x00\xff\xff\xff\xff\xff\xff\x00')
m = 'AYA'
e += ((ord(m[0]) - 64) << 10 | (ord(m[1]) - 64) << 5 | (ord(m[2]) - 64)).to_bytes(2, 'big')
e += (1080).to_bytes(2, 'little') + (0).to_bytes(4, 'little') + bytes([43, 36])   # produto, série, semana 43 de 2026
e += bytes([1, 3, 0x80, 0, 0, 0x78, 0x0A])                                        # EDID 1.3, digital, gamma 2.2, timing preferido
e += bytes([0xEE, 0x91, 0xA3, 0x54, 0x4C, 0x99, 0x26, 0x0F, 0x50, 0x54])          # cromaticidade sRGB
e += bytes([0, 0, 0]) + b'\x01\x01' * 8                                          # sem timings estabelecidos nem padrão
e += bytes.fromhex('023a801871382d40582c4500138e2100001e')                     # 1920x1080@60, 148,5 MHz
e += descritor_texto(0xFC, 'AYA PLAYER')
e += bytes.fromhex('000000fd00173d0f440f000a202020202020')                     # faixa 23-61 Hz, 15-68 kHz, até 150 MHz
e += descritor_texto(0x10, '')[:5] + bytes(13)                                  # descritor vazio
e += bytes([0])                                                                  # sem extensões
e += bytes([(-sum(e)) & 0xFF])
assert len(e) == 128 and sum(e) % 256 == 0
open(sys.argv[1], 'wb').write(e)
