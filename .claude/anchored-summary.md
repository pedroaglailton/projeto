# CONTROL PREVENTIVA-CE — Project State

> Last updated: 2026-06-06 (after cleanup)

## Goal
Manter PWA `CONTROL PREVENTIVA-CE` funcional com chat em tempo real NOC↔técnico (WebSocket < 100ms + beep/vibração/notification do sistema no foreground como bypass de limitação TWA), instalado como APK via PWABuilder, com diagnóstico de notificações em celular Android.

## Constraints & Preferences
- User se comunica em português brasileiro
- App será usado por ~6 meses (sem Play Store, sem iOS, sem custo de assinatura)
- Preferência por **bypass de limitações do PWA** (ex: Web Audio + Vibration + new Notification no foreground) em vez de refatorar pra nativo
- LATÊNCIA no alerta de msg é prioridade: WebSocket > polling
- `.gitignore` deve cobrir caches, scripts working, APKs, AABs, keystore, signing-key-info.txt
- `modificados/` (backup do user) e `backups/` (ZIP Xcode iOS + lixo) devem ficar no disco mas **fora do git**
- Scripts V1/V2/V3, caches `.json`, logs `.txt`, `*.bkp-*`, `*.bak`, KMZ/KML, CSVs de relatório ficam **fora do git** e foram movidos pra `backups/lixo-2026-06-06/`
- PWABuilder: 1 APK gerado (`PreventivaCE.apk` 1.3MB) em `PreventivaCE - Google Play package/`, package name `com.onrender.projeto_ujbr.twa`
- **NÃO publicar APK na Play Store** (custo $25 + aprovação) — uso interno via sideload
- **NÃO fazer app nativo Android** (complexidade alta vs 6 meses de uso)
- **Caminho da PWA: PWABuilder → APK TWA** (assinado, gratuito, dispensa Mac) — suficiente pra 6 meses
- **Token Mapbox `pk.*` é público por design** — não revogar; se quiser, adicionar URL restriction em mapbox.com

## Production Code (in git, raiz)

| Arquivo | Função |
|---|---|
| `server.js` | backend (API, push VAPID, WebSocket broadcast, normalização coords) |
| `index.html` | PWA técnico (5832 linhas) |
| `rastreamento_noc/public/noc.html` | painel NOC |
| `rastreamento_noc/public/tracker.html` | tracker NOC adicional |
| `usuarios.js` | auth NOC (login, sessões, perfis) — **NÃO É LIXO** |
| `auth.js` | client auth helper |
| `posicoes-store.js` | storage posições |
| `sw.js` | Service Worker (`CACHE_VERSION = 'v2026.06.06-06'`) |
| `manifest.json` | PWA manifest com 5 ícones + `"id": "/"` |
| `app-icon.svg` | ícone fonte |
| `package.json` + `package-lock.json` | deps (express, multer, ws, web-push) |
| `pontos_planejados.json` | 2387 pontos geocoded |
| `RENDER-GITHUB-SYNC.md` | doc de deploy |
| `.well-known/assetlinks.json` | TWA fullscreen |
| `data/equipes.json` | cadastro equipes |
| `data/equipos.json` | (legado?) |
| `rastreamento_noc/public/car-topdown.svg` | asset carro |
| `rastreamento_noc/public/fortaleza_roads.geojson` + `.gz` | roads overlay |
| `icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon-180.png` | ícones PWA |

## Done

### Features principais
- **Geocoding completo** (commit `61a1780`): 2387/2387 pontos com cidade via Nominatim V1+V2+V3
- **Server.js** normalizador de lat/lng + rota `GET /pontos_planejados.json`
- **Manifest.json** com 5 ícones + `"id": "/"` (commits `713502e`, `d193e64`, `f6f5d29`)
- **Asset Links** em `.well-known/assetlinks.json` (commit `ce3d6fc`) — TWA fullscreen sem barra Chrome
- **Detecção de permissões bloqueadas** (commit `3958d4f`): `openAndroidSettings(target)`, `checkPerm(name)`, `showPermDialog(opts)`, `captureFoto(inputId)`, `tratarErroGeo(err)`. Aplicado em 3 botões de foto + 2 callbacks GPS + `togglePush()`
- **Alerta sonoro/vibração/notification do sistema** (commit `6b755ca`):
  - `tocarAlertaMensagem()` no `index.html` (3 bips descendentes 960→700Hz, vibrate `[300,100,300,100,500]`, debounce 3s)
  - `tocarAlertaNoc()` no `noc.html` (2 bips ascendentes 520→800Hz, debounce 4s)
  - `verificarNaoLidas()` cria `new Notification()` do sistema quando chat fechado
- **WebSocket no index.html** (commit `7e2fcaa`): `connectWs()` abre `wss://host`, `onmessage` toca alerta IMEDIATO em <100ms. Reconexão 3s após onclose + `visibilitychange`. Polling vira backup (3s chat, 15s badge)
- **Lightbox de fotos no chat** (commit `799c87d`): `abrirFotoGrande(url)` cria modal com fundo preto 0.92, `object-fit:contain`, X no canto. Substitui `window.open(url,'_blank')` que fazia o Chrome baixar. Aplicado em `noc.html` (linha 2326) + `index.html` (linha 5389)
- **CACHE_VERSION bump** (commit `6aa0597`): `v2026.06.06-05` → `v2026.06.06-06` força SW a descartar cache antigo do `index.html` (sem isso, SW servia HTML antigo e o `window.open` ainda disparava download)

### Infraestrutura
- ZIP iOS movido pra `backups/PreventivaCE-iOS-source.zip` (988KB, guardado)
- APK Android em `PreventivaCE - Google Play package/PreventivaCE.apk` (1.3MB, keystore salvo em `signing.keystore` + senha `g2QPlXiGlzzn`, alias `my-key-alias`)
- `.gitignore` robusto (commits `d6ac293`, `9869fe9`, `b45cb89`, etc.): cobre `backups/`, `modificados/`, `"PreventivaCE - Google Play package/"`, `*.apk`, `*.aab`, `*.keystore`, `signing-key-info.txt`, `data/`, `node_modules/`, `*.jpg`, `*.JPG`, `erros.txt`, `server_*.txt`, `renderlog.txt`, `*.log`, `*.bkp-*`, `*.bak`, `*.kmz`, `*.kml`, `*.ps1` (criado pelo user), `*.cjs` (working scripts)
- **Limpeza de lixo** (sessão 2026-06-06): **86 arquivos (9.7 MB)** movidos pra `backups/lixo-2026-06-06/`:
  - 75 untracked: scripts V1/V2/V3 (`preencher-cidades-faltantes.cjs`, etc.), caches JSON (`geocache-*.json`, `geocode-*.json`), logs (`geocode-*.txt`, `geocode-*.log.txt`), CSVs (`relatorio-*.csv`, `duplicatas-lat-lng.csv`), PowerShell scripts (`*.ps1`), KMZ/KML, `.bak*` arquivos, e o `mq351zux_2xrg` (prova do bug do download)
  - 12 tracked: `poste.png` (asset teste), `poste.txt` (nota), `prototipo-marcador-3d.html`, `teste-camera-layer.html`, `teste-clima-mapa.html`, `teste-poste-camera.html`, `ma.html` (exemplo Mapbox), `maplibre-exemplo.html`, `noc1.html` (NOC antigo), `git.txt` (notas + token Mapbox), `head.txt`, `continue.txt`

### Diagnóstico / contornos
- **Diagnóstico push notification**: server envia OK (`sent: 1, total: 1`), subscription existe, mas push NÃO aparece no celular mesmo com PWA instalada ou APK TWA. Contornado com Web Audio + Vibration + new Notification no foreground
- **Limitação TWA reconhecida**: app fechado / tela desligada ainda não dispara alerta (precisaria APK nativo com FCM, fora de escopo)

## In Progress
- (none)

## Blocked
- **Push notifications em background na TWA**: não vai funcionar, contornado com foreground alert

## Key Decisions
- **TWA do PWABuilder tem limitação com push notifications** — Service Worker não roda consistentemente. Solução: Web Audio + `navigator.vibrate()` + `new Notification()` no foreground (via WebSocket)
- **WebSocket no index.html segue padrão do noc.html** (linha 1884-1892): `wss://location.host`, reconexão 3s, `visibilitychange` reconecta
- **Polling vira backup** (3s chat, 15s badge); WS é a primária
- **NÃO fazer app nativo Android** (complexidade alta vs 6 meses de uso)
- **NÃO publicar APK na Play Store** (custo $25 + aprovação) — uso interno via sideload
- **Token Mapbox público**: NÃO revogar (é design). Se quiser defender melhor, adicionar URL restriction em mapbox.com → Account → Access tokens

## Next Steps
- (opcional) Mover `Capturar.JPG`, `erros.txt`, `renderlog.txt`, `server_err.txt`, `server_out.txt` (gitignored mas visíveis) pro backup
- (opcional) Adicionar URL restriction no token Mapbox (defesa real, 5 min)
- (opcional) Telegram Bot: token do `@BotFather` + chat_ids dos técnicos + integração no `addMensagem()`. User disse "depois, não agora"

## Critical Context

### URLs e domínios
- **Domínio produção**: `https://projeto-ujbr.onrender.com`
- **GitHub**: `https://github.com/pedroaglailton/projeto`
- **NOC endpoint**: `https://projeto-ujbr.onrender.com/noc`
- **PWA installer**: abrir domínio no Chrome → "Adicionar à tela inicial"

### TWA / Android
- **Package name TWA**: `com.onrender.projeto_ujbr.twa`
- **sha256 cert**: `B1:7D:58:7D:B2:78:E3:5C:D4:73:C7:39:FC:52:FB:C7:04:12:F6:9D:6D:78:2B:4C:61:F0:BC:A1:EC:B7:2E:E6`
- **Helper `TWA_PACKAGE = 'com.onrender.projeto_ujbr.twa'`** no `index.html` (intents Android Settings)

### VAPID / Push
- **VAPID keys**: geradas em `data/vapid-keys.json` (server-side, públicas `BNW_znV6dM7WBK1nI_7kGTGgK4xp8YtOxIBsNV3G-WSu-9Uh6XLV1fdmd7wFVS0j2-Q6cR6LjTJ9odzZz6zkjyQ`)
- **`web-push` instalado** (`server.js:12`); subscriptions salvas em `data/push-subscriptions.json` (no .gitignore)
- **Endpoint `/api/push/notify`**: retorna `{ok, sent, failed, total, filter}` — `total: 1, sent: 1` confirma subscription + push
- **Comportamento**: server envia, mas não chega no device (limitação TWA)

### Service Worker / Cache
- **`CACHE_VERSION sw.js`**: `v2026.06.06-06` (CORE_ASSETS inclui 4 PNGs em `icons/` + `app-icon.svg` + `manifest.json`)
- **Skip waiting**: SW faz `self.skipWaiting()` no install + limpa caches antigos
- **`push` handler**: aceita `payload.vibrate/tag/renotify` (mas não dispara por limitação TWA)

### Mensagens
- **`addMensagem()` em `server.js:200`**: dispara push automático quando `direcao === 'noc'` (mudança do commit `713bc57`); diferenciada por tipo (predefinida vibra curto, outros vibra longo)
- **`_msgAlertadas` (Set)** evita alertas duplicados; resetar no carregamento inicial
- **Endpoint `/api/mensagens` (POST)**: técnico envia resposta (precisa `X-Equipe-Token`)
- **Endpoint `/api/mensagens/noc` (POST)**: NOC envia alerta pra equipe
- **Endpoint `/api/mensagens/:equipeId` (GET)**: lista histórico (com auth)
- **WebSocket**: server broadcast `{type:'mensagem', data:msg}` pra todos os clientes conectados

### Assets críticos (backup obrigatório)
- `signing.keystore` + senha `g2QPlXiGlzzn` + alias `my-key-alias` (em `PreventivaCE - Google Play package/`)
- `PreventivaCE.apk` 1.3MB (em `PreventivaCE - Google Play package/`)
- `data/vapid-keys.json` (server-side, no .gitignore)
- `backups/PreventivaCE-iOS-source.zip` 988KB (projeto Xcode iOS guardado)

### Últimos commits (sessão 2026-06-06)
- `7e2fcaa` perf(alerta): WebSocket no tecnico + polling mais rapido (alerta <100ms)
- `799c87d` fix(chat): foto abre em lightbox em vez de baixar
- `6aa0597` chore(sw): bump CACHE_VERSION v2026.06.06-05 -> -06

### Estado do git
- `main` @ `6aa0597` (limpo, em sync com origin/main)
- Working tree: limpo (após mover 86 arquivos pra `backups/lixo-2026-06-06/`)
- Untracked: 0 na raiz (verificado via `git status -uall --porcelain`)
- 5 logs/screenshots visíveis mas gitignored: `Capturar.JPG`, `erros.txt`, `renderlog.txt`, `server_err.txt`, `server_out.txt`

## Relevant Files (organizado por função)

### Produção (raiz)
- `D:\preventivas\projeto-main\index.html` (5832 linhas): app do técnico
- `D:\preventivas\projeto-main\server.js` (995 linhas): backend
- `D:\preventivas\projeto-main\sw.js` (272 linhas): Service Worker
- `D:\preventivas\projeto-main\manifest.json`: PWA manifest
- `D:\preventivas\projeto-main\usuarios.js`: auth NOC
- `D:\preventivas\projeto-main\auth.js`: client auth helper
- `D:\preventivas\projeto-main\posicoes-store.js`: storage posições
- `D:\preventivas\projeto-main\app-icon.svg`: ícone fonte
- `D:\preventivas\projeto-main\package.json` + `package-lock.json`: deps
- `D:\preventivas\projeto-main\pontos_planejados.json`: 2387 pontos geocoded
- `D:\preventivas\projeto-main\.gitignore`: 26+ regras
- `D:\preventivas\projeto-main\RENDER-GITHUB-SYNC.md`: doc deploy

### NOC
- `D:\preventivas\projeto-main\rastreamento_noc\public\noc.html` (2776+ linhas): painel NOC principal
- `D:\preventivas\projeto-main\rastreamento_noc\public\tracker.html`: tracker adicional
- `D:\preventivas\projeto-main\rastreamento_noc\public\car-topdown.svg`: asset
- `D:\preventivas\projeto-main\rastreamento_noc\public\fortaleza_roads.geojson` + `.gz`: overlay roads

### Runtime (no .gitignore)
- `D:\preventivas\projeto-main\data\uploads\`: fotos/vídeos do chat
- `D:\preventivas\projeto-main\data\vapid-keys.json`: chaves push
- `D:\preventivas\projeto-main\data\push-subscriptions.json`: subscriptions
- `D:\preventivas\projeto-main\data\equipes.json`: cadastro equipes
- `D:\preventivas\projeto-main\data\posicoes\`, `data\producao\`, `data\producao_equipes\`: dados runtime

### Fora do git (mantidos em disco)
- `D:\preventivas\projeto-main\backups\PreventivaCE-iOS-source.zip` (988KB): projeto Xcode iOS
- `D:\preventivas\projeto-main\backups\lixo-2026-06-06\` (9.7MB, 86 arquivos): tudo que era working/caches/backup antigo
- `D:\preventivas\projeto-main\modificados\`: backup do user (HTML antigos)
- `D:\preventivas\projeto-main\PreventivaCE - Google Play package\`: pacote PWABuilder com APK assinado

### Raiz visível mas gitignored (opcional mover)
- `Capturar.JPG` (screenshot)
- `erros.txt` (log NOC)
- `renderlog.txt` (log Render)
- `server_err.txt`, `server_out.txt` (logs server)
