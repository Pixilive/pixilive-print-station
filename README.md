# Pixilive Print Station

A free, lightweight macOS app that watches a folder and prints incoming photos automatically to DNP dye-sublimation printers. A native Mac alternative to DNP's own Hot Folder Print utility, which is Windows-first.

## What it does

- Watches a folder and prints new images automatically to a connected DNP printer (tested with DNP RX1HS & DS620)
- Archives each printed file into a `_printed` subfolder afterwards
- Runs quietly in the menu bar, no interaction needed once configured
- Works completely standalone — no account of any kind required

## Installation

1. Download the latest `.dmg` from the [Releases](../../releases) page — grab `Pixilive.Print.Station-X.X.X-arm64.dmg`.
2. Open the `.dmg` and drag the app into your Applications folder.
3. First launch: macOS will likely block it since it's not distributed via the App Store ("app is damaged" error). This is expected for independently distributed apps. Open Terminal and run:
   ```
   xattr -cr "/Applications/Pixilive Print Station.app"
   ```
   Then launch the app normally from Applications.
4. Click the menu bar icon (top right) → **Settings**:
   - **Printer**: select your DNP printer from the list
   - **Paper size**: match the paper loaded in your printer
   - **Hotfolder**: enable the toggle, then choose any local folder you want to watch
5. Save. Drop a JPEG into that folder — it should print automatically.

## Compatibility

macOS, DNP dye-sublimation printers connected via USB (tested with DNP RX1HS).

## Using it with Pixilive

Print Station is built and maintained by [Pixilive](https://about.pixi.live), a real-time photo distribution platform for professional events. Beyond standalone hotfolder printing, it connects directly to your Pixilive event gallery, turning it into a live print station for VIP evenings, weddings, birthdays, and photo booths — no other software needed.

Two ways to print from a Pixilive gallery:

### Moderated printing

Attendees request prints directly from the gallery, specifying their name and the number of copies. Requests land in a queue visible from the Pixilive backoffice. When someone shows up at the print stand, staff find their request by name and trigger the print with one click — full resolution, no watermark.

Best for: staffed events, print stands, photo bars.

### Automatic printing (Hotfolder)

Point the same Hotfolder feature at a Dropbox folder synced with your Pixilive gallery. Every photo that lands there prints automatically, no staff intervention needed.

Best for: solo operation, remote/unattended printing.

### Local port (4242)

Moderated printing communicates with Pixilive over local port 4242. This is preconfigured and rarely needs changing. If another app is already using it, change it under **Settings → Local port** (any value between 1024–65535 works). Hotfolder mode doesn't use this port at all — it works independently of any network connection to Pixilive.

## Updates

The app checks for new versions automatically. Full version history:

👉 [github.com/Pixilive/pixilive-print-station/releases](https://github.com/Pixilive/pixilive-print-station/releases)

## Support

Questions or issues? Open an [issue](../../issues) on this repo, or contact contact@pixi.live.
