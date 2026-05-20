<div align="center">

# Trova

**Cerca davvero nei tuoi file. In locale. Con stile.**

L'app desktop local-first che indicizza documenti, foto, audio e video sul tuo PC
e li trova al volo, con UI minimale stile Google e zero dati nel cloud per default.

[![Release](https://img.shields.io/github/v/release/mengo1234/trova?style=for-the-badge&color=4285f4)](https://github.com/mengo1234/trova/releases/latest)
[![Linux · Windows · macOS](https://img.shields.io/badge/Linux%20·%20Windows%20·%20macOS-supportati-34a853?style=for-the-badge)](https://github.com/mengo1234/trova/releases/latest)
[![License GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-9b69ff?style=for-the-badge)](LICENSE)

</div>

---

## ⚡ Scarica e installa

Vai alla pagina delle **[Release](https://github.com/mengo1234/trova/releases/latest)** e scarica il file giusto per il tuo sistema:

| Sistema | File da scaricare | Come si installa |
|---|---|---|
| 🪟 **Windows 10/11** | `Trova_0.1.0_x64-setup.msi` | Doppio click sul file scaricato → Avanti → Installa. Si avvia dal menu Start. |
| 🐧 **Linux Debian/Ubuntu** | `trova_0.1.0_amd64.deb` | `sudo dpkg -i trova_0.1.0_amd64.deb` oppure aprilo con il gestore pacchetti |
| 🐧 **Linux Fedora/RHEL** | `trova-0.1.0-1.x86_64.rpm` | `sudo rpm -i trova-0.1.0-1.x86_64.rpm` |
| 🍎 **macOS** | `Trova_0.1.0_x64.dmg` | Doppio click sul .dmg, trascina Trova nelle Applicazioni |

> Al primo avvio Trova prepara tutto da sola in background: indicizza Documenti / Download / Immagini,
> scarica i modelli per la ricerca visuale (CLIP/DINO/SigLIP), e prepara OCR / audio.
> Tu vedi solo una barra di progresso nella home. Niente click, niente terminale.

---

## ✨ Cosa fa Trova

- 🔍 **Ricerca testuale + semantica** dentro PDF, Office, codice, testo: trova quello che intendi, non solo quello che scrivi
- 📷 **Ricerca per immagine** locale con embedding neurali (CLIP, DINOv3, SigLIP2) — anche offline
- 🎙️ **Audio e video cercabili** via fingerprint visuale + scene/keyframe
- 👤 **Modalita "stessa persona"** esplicita, locale, senza nomi (richiede consenso)
- 💬 **Chat AI multi-turno** sui tuoi file con cronologia e citazioni cliccabili (NVIDIA Nemotron 49B, Gemma 4 27B, Llama 3.3 70B, DeepSeek V4 Flash, oppure Ollama / LM Studio locali)
- 🤖 **Agenti AI** opzionali: l'AI puo cercare sul web (DuckDuckGo), leggere link, fare calcoli quando i tuoi file non bastano
- 🌐 **Cloud opzionale**: Gemini File Search e NVIDIA rerank, solo se decidi tu, cartella per cartella
- 🔌 **Remote Access** sicuro: web UI raggiungibile dalla LAN con token, opt-in
- 💻 **Cross-platform**: Linux, Windows, macOS — installer .msi/.deb/.rpm/.dmg con backend bundled, niente Node da installare
- 🔓 **GPL-3.0 open source**, ispirato a [File Brain](https://github.com/Hamza5/file-brain), [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm), Apache Tika, Typesense

---

## 🔒 Privacy by default

- Tutto resta sul tuo PC. **Nessun dato viene inviato online finche non lo decidi tu.**
- Gemini riceve solo file caricati manualmente o di cartelle con il toggle online attivo.
- La modalita "stessa persona" non identifica per nome e non spedisce mai volti al cloud.
- I modelli vision CLIP/DINO/SigLIP girano nel runtime locale dell'app.
- Remote Access spento di default. Quando attivo: token obbligatorio + audit log locale.

---

## 🚀 Avvio rapido (dopo l'installazione)

1. Apri Trova dal menu / Spotlight / Launcher
2. Vedi un tutorial in 4 schermate — **sfogliale o chiudi subito**: il setup gira gia
3. (Opzionale) Nell'ultima schermata accendi Google online o NVIDIA online se vuoi quelle funzioni cloud
4. **Entra in Trova** → vedi una card blu con percentuale: e la preparazione in corso
5. Quando diventa verde "Tutto pronto" → digita nella barra di ricerca

---

## 🛠️ Per sviluppatori

```bash
git clone https://github.com/mengo1234/trova
cd trova
npm install
npm run dev          # preview web su http://127.0.0.1:1420
npm run desktop      # app desktop Tauri (richiede Rust toolchain)
npm run build        # bundle frontend per produzione
```

### Test goal (26 test progressivi)

```bash
npm run test:goal1   # indicizzazione core
npm run test:goal2   # ricerca semantica
npm run test:goal3   # vision locale
# ...
npm run test:goal28  # NVIDIA summary
```

### Build degli installer

```bash
npm run package:preflight    # verifica catena di build
npm run package:desktop      # crea .deb + .rpm su Linux, .msi su Windows, .dmg su macOS
```

### Servizi avanzati (opzionali)

```bash
npm run search:up    # Apache Tika + Typesense via Docker per estrazione e ricerca avanzata
```

### CLI

```bash
npx trova doctor
npx trova search "elefante"
npx trova remotes list
npx trova remote-access start --bind 127.0.0.1 --port 18754
```

### MCP server stdio

`scripts/trova-mcp-server.mjs` espone 14 tool MCP (search_files, visual_search, ask_files, ...) per integrazioni con Claude e simili.

---

## 📋 Dipendenze native Linux (build da sorgente)

```bash
# Ubuntu / Debian
sudo apt install libdbus-1-dev libwebkit2gtk-4.1-dev pkg-config

# Fedora
sudo dnf install dbus-devel webkit2gtk4.1-devel pkgconf-pkg-config
```

Su Windows / macOS Tauri si occupa di tutto in automatico (richiede Rust + Node).

---

## 🤝 Contribuire

Trova e GPL-3.0-or-later. Issue e pull request benvenute.

Attribution: progetto ispirato architetturalmente a [Hamza5/file-brain](https://github.com/Hamza5/file-brain),
estrazione contenuti via [Apache Tika](https://tika.apache.org/), ricerca testuale via [Typesense](https://typesense.org/).

Vedi [`LICENSE`](LICENSE).

---

<div align="center">

**[Scarica l'ultima versione →](https://github.com/mengo1234/trova/releases/latest)**

</div>
