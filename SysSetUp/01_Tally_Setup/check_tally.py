"""
Standalone TallyPrime HTTP Gateway Diagnostic Tool.
Zero external dependencies (uses standard library urllib) to run anywhere.
"""

import sys
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

TALLY_HOST = "127.0.0.1"
TALLY_PORT = 9000
TALLY_URL = f"http://{TALLY_HOST}:{TALLY_PORT}"

LIST_COMPANIES_XML = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CompanyCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CompanyCollection" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <FETCH>Name</FETCH>
            <FETCH>Guid</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>"""

def probe_tally():
    print("=" * 60)
    print("   TallyPrime HTTP Gateway Connectivity Test")
    print("=" * 60)
    print(f"Target URL : {TALLY_URL}")
    print(f"Loopback   : {TALLY_HOST}:{TALLY_PORT}")
    print("-" * 60)

    start_time = time.time()
    req = urllib.request.Request(
        TALLY_URL,
        data=LIST_COMPANIES_XML.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            latency_ms = int((time.time() - start_time) * 1000)
            status_code = response.status
            body = response.read().decode("utf-8", errors="replace")

        print(f"[OK] Connection Successful! (HTTP {status_code})")
        print(f"[OK] Response Latency: {latency_ms} ms\n")

        # Parse loaded companies
        companies = []
        try:
            root = ET.fromstring(body)
            for elem in root.iter():
                tag_lower = elem.tag.lower()
                if tag_lower in ("companyname", "name") and elem.text:
                    name = elem.text.strip()
                    if name and name not in companies:
                        companies.append(name)
        except Exception:
            pass

        if companies:
            print("Loaded Company / Companies in Tally:")
            for i, comp in enumerate(companies, 1):
                print(f"  {i}. {comp}")
        else:
            print("[INFO] Tally is running, but no company is currently open.")
            print("       Please open a company in TallyPrime.")

        print("-" * 60)
        print("[RESULT] TALLY SETUP STATUS: READY FOR CFO YANTRA SYNC")
        print("=" * 60)
        return 0

    except urllib.error.URLError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        print("[FAIL] Could not connect to TallyPrime!")
        print(f"[INFO] Error: {e.reason}")
        print("\nTroubleshooting Checklist:")
        print(" 1. Is TallyPrime running on this machine?")
        print(" 2. Press F12 in TallyPrime -> Advanced Configuration:")
        print(f"    - 'TallyPrime is acting as': Both or Server")
        print(f"    - 'Enable ODBC': Yes")
        print(f"    - 'Port': {TALLY_PORT}")
        print(" 3. Did you restart TallyPrime after changing configuration?")
        print(" 4. Is Windows Firewall blocking port 9000 on localhost?")
        print("-" * 60)
        print("[RESULT] TALLY SETUP STATUS: NOT CONNECTED")
        print("=" * 60)
        return 1

if __name__ == "__main__":
    sys.exit(probe_tally())
