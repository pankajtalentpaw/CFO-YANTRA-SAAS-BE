import socketio
import logging
from typing import Any, Dict

logger = logging.getLogger('cfo_yantra.socket')

sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False
)

async def emit_sync_status(data: Dict[str, Any]):
    try:
        await sio.emit('tally:sync:status', data)
        await sio.emit('sync:status', data)
    except Exception as e:
        logger.debug(f'Socket emission error: {e}')
