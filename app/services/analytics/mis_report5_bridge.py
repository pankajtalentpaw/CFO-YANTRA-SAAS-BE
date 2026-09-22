import json
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional

# Root directory of project
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
BACKEND_DIR = PROJECT_ROOT / 'backend'
SCRIPT_PATH = BACKEND_DIR / 'scripts' / 'generate_mis_report5.js'

_cache: Dict[str, Any] = {}
_cache_timestamps: Dict[str, float] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes in-memory cache

def invalidate_cache(company_id: Optional[str] = None):
    global _cache, _cache_timestamps
    if company_id:
        keys_to_del = [k for k in _cache if k.startswith(f'{company_id}:')]
        for k in keys_to_del:
            _cache.pop(k, None)
            _cache_timestamps.pop(k, None)
    else:
        _cache.clear()
        _cache_timestamps.clear()

def call_mis_report5_engine(
    company_id: str,
    action: str = 'report5',
    options: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Executes the comprehensive Decision Intelligence & 18-Filter MIS Report 5 engine.
    Connects directly to the company's local SQLite database and computes the full
    multi-dimensional product x city x month analytics cube with Decimal precision.
    """
    options = options or {}
    measure = options.get('measure') or 'withCharges'
    from_date = options.get('fromDate') or ''
    to_date = options.get('toDate') or ''
    filter_id = str(options.get('filterId') or '')
    lens_id = str(options.get('lensId') or '')
    analysis_id = str(options.get('analysisId') or '')

    cache_key = f'{company_id}:{action}:{measure}:{from_date}:{to_date}:{filter_id}:{lens_id}:{analysis_id}'
    now = time.time()
    if cache_key in _cache and (now - _cache_timestamps.get(cache_key, 0) < CACHE_TTL_SECONDS):
        return _cache[cache_key]

    cmd = [
        'node',
        str(SCRIPT_PATH),
        '--companyId', str(company_id),
        '--action', str(action),
        '--measure', str(measure)
    ]
    if from_date:
        cmd.extend(['--fromDate', str(from_date)])
    if to_date:
        cmd.extend(['--toDate', str(to_date)])
    if filter_id:
        cmd.extend(['--filterId', str(filter_id)])
    if lens_id:
        cmd.extend(['--lensId', str(lens_id)])
    if analysis_id:
        cmd.extend(['--analysisId', str(analysis_id)])

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(BACKEND_DIR),
            capture_output=True,
            text=True,
            timeout=45,
            encoding='utf-8'
        )
        if proc.returncode != 0:
            return {
                'success': False,
                'available': False,
                'companyId': company_id,
                'reason': {'message': proc.stderr or 'Analytics generation engine encountered an error'}
            }
        stdout = proc.stdout.strip()
        first_brace = stdout.find('{')
        last_brace = stdout.rfind('}')
        if first_brace != -1 and last_brace != -1:
            data = json.loads(stdout[first_brace:last_brace+1])
            _cache[cache_key] = data
            _cache_timestamps[cache_key] = now
            return data
        return {
            'success': False,
            'available': False,
            'companyId': company_id,
            'reason': {'message': 'Invalid response payload from analytics engine'}
        }
    except Exception as e:
        return {
            'success': False,
            'available': False,
            'companyId': company_id,
            'reason': {'message': str(e)}
        }
