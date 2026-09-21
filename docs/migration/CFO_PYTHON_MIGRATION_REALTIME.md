# CFO YANTRA — REAL-TIME COMMUNICATION SPECIFICATION

## Executive Summary
The CFO Yantra desktop UI relies on real-time event streaming for synchronization progress, voucher loading notifications, and connection status updates. This document defines the protocol compatibility, Socket.io ASGI integration, authentication handshake, and event contracts.

---

## 1. Protocol Parity: Socket.io vs Plain WebSockets

The React frontend imports `socket.io-client` and communicates using the Engine.io / Socket.io packet protocol. A standard FastAPI WebSocket route (`@app.websocket`) is protocol-incompatible with `socket.io-client` and will fail during the initial handshake (`/socket.io/?EIO=4&transport=polling`).

### Implementation Strategy
We utilize `python-socketio` configured in ASGI mode and mounted into the FastAPI application root:
```python
import socketio

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False
)

socket_app = socketio.ASGIApp(
    socketio_server=sio,
    other_asgi_app=fastapi_app
)
```

---

## 2. Event Contracts & Schemas

### 2.1. Handshake & Authentication
- **Event**: `connect`
- **Data**: Handshake query or `auth` dictionary containing `{ "token": "JWT_TOKEN" }`.
- **Validation**: Server validates JWT against secret. If invalid, the connection is rejected:
  ```python
  @sio.event
  async def connect(sid, environ, auth):
      token = auth.get("token") if auth else None
      user = verify_jwt_token(token)
      if not user:
          return False  # Reject connection
      await sio.save_session(sid, {"user": user})
  ```

### 2.2. Synchronization Events
1. **`voucher:sync`**:
   - **Payload**:
     ```json
     {
       "companyId": 1,
       "syncedCount": 150,
       "totalCount": 1200,
       "progress": 12.5
     }
     ```
2. **`tally:voucher:progress`**:
   - **Payload**:
     ```json
     {
       "alterId": 10543,
       "voucherNumber": "INV-2024-001",
       "status": "SAVED"
     }
     ```
3. **`tally:voucher:error`**:
   - **Payload**:
     ```json
     {
       "alterId": 10544,
       "error": "Ledger 'Sundry Debtors' missing",
       "code": "PARSING_ERROR"
     }
     ```
4. **`sync:status`**:
   - **Payload**:
     ```json
     {
       "companyId": 1,
       "state": "SYNCING",
       "lastSyncTime": "2026-09-19T18:00:00Z",
       "message": "Fetching incremental vouchers from TallyPrime"
     }
     ```
