#!/usr/bin/env bash
# Create two virtual CUPS printers on Debian/Ubuntu for PrintGo testing:
#   blackandwhite - grayscale only
#   color         - color capable, RGB by default
# Jobs are saved as PDFs by CUPS-PDF; no physical printer is needed.
#
# Run as your current normal desktop user (mint, prem, etc.), WITHOUT sudo:
#   bash Scripts/dummyprinter.sh
# Or, after downloading just this file:
#   bash dummyprinter.sh
# The script asks for sudo internally for packages and printer administration.
# Run print jobs and the kiosk app as your normal user, never with sudo.
#
# Test with an existing PDF:
#   lp -d blackandwhite -t PrintGo-BW-test /path/to/test.pdf
#   lp -d color -t PrintGo-color-test -o ColorModel=RGB /path/to/test.pdf
#   lpstat -p blackandwhite -p color
# Output normally appears in ~/PDF on Debian/Ubuntu; the configured output
# location is displayed at the end. Do not use raw printing (-o raw), which
# bypasses the driver and its grayscale conversion.
# Rerunning updates these dummy queues without deleting their pending jobs.
# Existing unrelated queues/defaults are kept. The CUPS-PDF package may also
# create its own generic "PDF" queue; this script leaves that queue alone.
# Remove only these two dummy printers later, if desired:
#   sudo lpadmin -h localhost -x blackandwhite
#   sudo lpadmin -h localhost -x color
# Backend documentation: https://www.cups-pdf.de/documentation.shtml

set -Eeuo pipefail
export LC_ALL=C
umask 022
trap 'printf "\nSetup failed at line %s. Fix the error above and rerun.\n" "$LINENO" >&2' ERR
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$EUID" -ne 0 ]] || die 'Run without sudo: bash dummyprinter.sh (from your normal user).'
[[ "$(uname -s)" == Linux ]] || die 'This script requires Linux.'
command -v apt-get >/dev/null || die 'This script supports Debian/Ubuntu with apt-get.'
command -v sudo >/dev/null || die 'Your normal user needs sudo access for installing CUPS.'

printf 'Installing virtual printer support...\n'
sudo -v
sudo apt-get update
sudo apt-get install -y cups cups-client cups-filters printer-driver-cups-pdf ghostscript python3
if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
  sudo systemctl enable --now cups
else
  sudo service cups start
fi

# Refuse to repurpose an existing real printer that happens to use either name.
# Check both names before modifying either queue.
for printer in blackandwhite color; do
  if details="$(lpstat -h localhost -l -p "$printer" 2>/dev/null)"; then
    grep -Fq "Description: PrintGo dummy printer ($printer)" <<< "$details" ||
      die "A different printer named '$printer' already exists. Rename that printer before running this script."
    device="$(lpstat -h localhost -v "$printer")"
    [[ "$device" == "device for $printer: cups-pdf:/" ]] ||
      die "Printer '$printer' does not use the expected dummy PDF backend."
  fi
done

# Use the distribution's complete PPD for paper sizes, resolution, and PDF
# backend compatibility. Modify temporary copies, never the packaged driver.
PPD_SOURCE="$(dpkg -L printer-driver-cups-pdf | awk '/\/CUPS-PDF_noopt\.ppd(\.gz)?$/ {print; exit}')"
[[ -n "$PPD_SOURCE" && -r "$PPD_SOURCE" ]] || die 'The installed CUPS-PDF package has no readable CUPS-PDF_noopt.ppd driver.'
WORK_DIR="$(mktemp -d)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

python3 - "$PPD_SOURCE" "$WORK_DIR" <<'PY'
import gzip
import pathlib
import re
import sys

source, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
data = gzip.open(source, "rb").read() if source.suffix == ".gz" else source.read_bytes()
base = data.decode("latin-1").replace("\r\n", "\n")
if not base.startswith('*PPD-Adobe:'):
    raise SystemExit("The packaged file is not a valid PPD.")
# Replace any existing color selector, including its default and choices.
base = re.sub(r'^\*OpenUI\s+\*ColorModel\b[^\n]*\n.*?^\*CloseUI:\s+\*ColorModel[^\n]*\n?', '', base, flags=re.M | re.S)
base = re.sub(r'^\*(?:DefaultColorModel|ColorModel\s[^:]+):[^\n]*\n?', '', base, flags=re.M)

def set_field(text, key, value):
    pattern = rf'^\*{re.escape(key)}:[^\n]*'
    line = f'*{key}: {value}'
    return re.sub(pattern, lambda _: line, text, flags=re.M) if re.search(pattern, text, re.M) else text + '\n' + line + '\n'

for name, is_color in [('blackandwhite', False), ('color', True)]:
    ppd = set_field(base, 'ColorDevice', 'True' if is_color else 'False')
    ppd = set_field(ppd, 'DefaultColorSpace', 'RGB' if is_color else 'Gray')
    ppd = set_field(ppd, 'NickName', f'"PrintGo dummy {name} (CUPS-PDF)"')
    ppd += '\n*OpenUI *ColorModel/Color Mode: PickOne\n'
    ppd += '*OrderDependency: 10 AnySetup *ColorModel\n'
    ppd += '*DefaultColorModel: ' + ('RGB' if is_color else 'Gray') + '\n'
    ppd += '*ColorModel Gray/Grayscale: "<</ProcessColorModel /DeviceGray>>setpagedevice"\n'
    if is_color:
        ppd += '*ColorModel RGB/Color: "<</ProcessColorModel /DeviceRGB>>setpagedevice"\n'
    ppd += '*CloseUI: *ColorModel\n'
    (output / f'{name}.ppd').write_bytes(ppd.encode('latin-1'))
PY

# Validate both driver files before creating either printer.
cupstestppd "$WORK_DIR/blackandwhite.ppd" "$WORK_DIR/color.ppd"
for printer in blackandwhite color; do
  mode=Gray
  print_mode=monochrome
  if [[ "$printer" == color ]]; then mode=RGB; print_mode=color; fi
  sudo lpadmin -h localhost -p "$printer" -E \
    -v 'cups-pdf:/' -P "$WORK_DIR/$printer.ppd" \
    -D "PrintGo dummy printer ($printer)" -L 'Virtual PDF printer for kiosk testing' \
    -o printer-is-shared=false -o printer-error-policy=abort-job \
    -o job-sheets-default=none,none -o PageSize=A4 \
    -o "ColorModel=$mode" -o "print-color-mode-default=$print_mode" \
    -o 'Label=1' -o 'TitlePref=1'
  sudo cupsaccept -h localhost "$printer"
  sudo cupsenable -h localhost "$printer"
done

printf '\nChecking printer capabilities...\n'
for printer in blackandwhite color; do
  options="$(lpoptions -h localhost -p "$printer" -l)"
  color_line="$(grep '^ColorModel/' <<< "$options")"
  printf '%s: %s\n' "$printer" "$color_line"
  if [[ "$printer" == blackandwhite ]]; then
    [[ "$color_line" == *Gray* && "$color_line" != *RGB* && "$color_line" != *CMYK* ]] || die 'Grayscale capability check failed.'
  else
    [[ "$color_line" == *RGB* ]] || die 'Color capability check failed.'
  fi
done
lpstat -h localhost -p blackandwhite -p color
OUTPUT_LOCATION="$(sudo awk '$1 == "Out" {sub(/^[[:space:]]*Out[[:space:]]+/, ""); value=$0} END {print value}' /etc/cups/cups-pdf.conf)"
OUTPUT_LOCATION="${OUTPUT_LOCATION:-'/var/spool/cups-pdf/${USER}'}"
printf '\nReady: blackandwhite (grayscale) and color (RGB).\n'
printf 'PDF output location from CUPS-PDF config: %s\n' "$OUTPUT_LOCATION"
printf 'HOME/USER placeholders refer to the user who submits the print job.\n'
printf 'Select either printer in PrintGo; restart the app if its printer list is cached.\n'
printf 'Test: lp -d blackandwhite -t PrintGo-BW-test /path/to/test.pdf\n'
printf 'Test: lp -d color -t PrintGo-color-test -o ColorModel=RGB /path/to/test.pdf\n'
