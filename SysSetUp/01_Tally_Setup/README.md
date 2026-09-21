# TallyPrime System Setup Guide for CFO Yantra

This guide describes how to configure TallyPrime so that the CFO Yantra Python backend can read accounting data over the local HTTP loopback interface.

---

## 🛠️ Step-by-Step TallyPrime Configuration

### Step 1: Open TallyPrime Configuration
1. Launch **TallyPrime** on your desktop.
2. From the Gateway of Tally (or Startup Screen), press **F12** (Configure).
3. Select **Advanced Configuration**.

### Step 2: Enable HTTP / ODBC Server
Configure the following settings in the Advanced Configuration screen:
- **TallyPrime is acting as**: `Both` (or `Server`)
- **Enable ODBC**: `Yes`
- **Port**: `9000` (default standard port)

### Step 3: Save and Restart Tally
1. Press **Ctrl + A** to save the configuration changes.
2. Tally will prompt: *"Do you want to restart TallyPrime for changes to take effect?"* -> Select **Yes**.
3. Once restarted, load/open your company in TallyPrime.

---

## 🔍 Verification

Double-click **`check_tally.bat`** (or run `python check_tally.py`) to verify:
- Connection response on `http://127.0.0.1:9000/`
- Latency (typically < 10 ms)
- Name of currently opened company

If successful, TallyPrime is fully ready for CFO Yantra synchronization!
