"""
Server launcher for CFO Yantra FastAPI backend.
Supports Electron child process execution and development server with dynamic port binding.
"""

import argparse
import os
import socket
import subprocess
import sys
import time
import uvicorn


def is_port_in_use(host: str, port: int) -> bool:
    """Checks whether a TCP port is currently listening or open."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def find_pid_by_port(port: int) -> list:
    """Finds PIDs bound to the specified TCP port on Windows."""
    pids = set()
    try:
        if sys.platform == "win32":
            output = subprocess.check_output(f"netstat -ano -p tcp | findstr :{port}", shell=True, text=True)
            for line in output.strip().splitlines():
                parts = line.split()
                if len(parts) >= 5 and "LISTENING" in parts[3].upper():
                    # Ensure exact port match at end of local address (e.g. :5000 not :50000)
                    local_addr = parts[1]
                    if local_addr.endswith(f":{port}"):
                        try:
                            pid = int(parts[4])
                            if pid > 0:
                                pids.add(pid)
                        except ValueError:
                            pass
    except Exception:
        pass
    return list(pids)


def kill_pids(pids: list) -> bool:
    """Forcefully terminates processes by PID list."""
    current_pid = os.getpid()
    for pid in pids:
        if pid == current_pid:
            continue
        try:
            if sys.platform == "win32":
                subprocess.run(f"taskkill /F /PID {pid}", shell=True, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                os.kill(pid, 9)
        except Exception:
            pass
    time.sleep(0.5)
    return True


def main():
    parser = argparse.ArgumentParser(description="CFO Yantra FastAPI Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host address to bind")
    parser.add_argument("--port", type=int, default=5000, help="Port to listen on")
    parser.add_argument("--workers", type=int, default=1, help="Number of worker processes")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    parser.add_argument("-k", "--kill-existing", action="store_true", help="Automatically kill any existing process occupying the target port")
    args = parser.parse_args()

    # Pre-flight check: is port already taken?
    if is_port_in_use(args.host, args.port):
        conflicting_pids = find_pid_by_port(args.port)
        if args.kill_existing:
            print(f"[INFO] Port {args.port} occupied by PID(s) {conflicting_pids}. Terminating for fresh restart...")
            kill_pids(conflicting_pids)
            time.sleep(0.5)
        else:
            pid_str = f"PID(s): {', '.join(map(str, conflicting_pids))}" if conflicting_pids else "another process"
            print("\n" + "=" * 70)
            print(f"[ERROR] Port {args.port} is ALREADY IN USE by {pid_str}!")
            print("=" * 70)
            print(f"CFO Yantra Backend or another service is already running on port {args.port}.")
            print("Options to resolve:")
            print(f"  1. Run with -k/--kill-existing to auto-restart:  python run.py --kill-existing")
            print(f"  2. Run on another port:                        python run.py --port 5050")
            print(f"  3. Use 1-Click Stop script:                   SysSetUp/02_CFO_Setup/stop_cfo_backend.bat")
            print("=" * 70 + "\n")
            sys.exit(1)

    # In desktop mode, workers must strictly remain 1
    workers = args.workers if not args.reload else 1

    uvicorn.run(
        "app.main:application",
        host=args.host,
        port=args.port,
        workers=workers,
        reload=args.reload,
        log_level="info"
    )


if __name__ == "__main__":
    main()
