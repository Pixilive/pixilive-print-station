# Pixilive Print Station

A free, lightweight macOS app that prints photos to DNP dye-sublimation printers — automatically from a watched folder, or live from a Pixilive event gallery. A native Mac alternative to DNP's own Hot Folder Print utility, which is Windows-first.

## What it does

- Watches a folder and prints new images automatically to a connected DNP printer (tested with DNP RX1HS & DS620)
- Applies your own frame/overlay (PNG mask), with separate masks for portrait and landscape photos
- Shows how many prints are left on the roll, and warns you when it's time to get a new one ready
- Keeps a list of recent prints with their status, and saves a log of each session
- Archives each printed file into a `_printed` subfolder afterwards
- Runs quietly in the menu bar, no interaction needed once configured
- Available in English and French
- Works completely standalone — no account of any kind required

## Installation

1. Download the latest `.dmg` from the [Releases](../../releases) page — grab `Pixilive-Print-Station-X.X.X-arm64.dmg`.
2. Open the `.dmg` and drag the app into your Applications folder.
3. First launch: macOS will likely block it since it's not distributed via the App Store ("app is damaged" error). This is expected for independently distributed apps. Open Terminal and run:
   ```
   xattr -cr "/Applications/Pixilive Print Station.app"
   ```
   Then launch the app normally from Applications.
4. Click the menu bar icon (top right) → **Settings**:
   - **Printer**: select your DNP printer from the list
   - **Paper size**: match the paper loaded in your printer
   - **Masks** (optional): choose a PNG overlay for portrait and/or landscape photos
   - **Hotfolder**: enable the toggle, then choose any local folder you want to watch
   - **Language**: automatic (follows your Mac) or set manually
5. Save. Drop a JPEG into that folder — it should print automatically.

## Compatibility

- macOS on Apple Silicon (M1 and later)
- DNP dye-sublimation printers connected via USB (tested with DNP RX1HS and DS620)
- The remaining-prints counter requires a printer driver that reports media levels (tested with the DNP RX1HS). Other printers will show "level unknown" and print normally.

## Using it with Pixilive

Print Station is built and maintained by [Pixilive](https://about.pixi.live), a real-time photo distribution platform for professional events. Beyond standalone hotfolder printing, it connects directly to your Pixilive event gallery, turning it into a live print station for VIP evenings, weddings, birthdays, and photo booths — no other software needed.

Two ways to print from a Pixilive gallery:

### Moderated printing

Attendees request prints directly from the gallery, specifying their name and the number of copies. Requests land in a queue visible from the Pixilive backoffice. When someone shows up at the print stand, staff find their request by name and trigger the print with one click — full resolution, no watermark. Pixilive is updated once the prints have been sent to the printer.

Best for: staffed events, print stands, photo bars.

### Automatic printing (Hotfolder)

Point the same Hotfolder feature at a Dropbox folder synced with your Pixilive gallery. Every photo that lands there prints automatically, no staff intervention needed.

Best for: solo operation, remote/unattended printing.

### How the gallery talks to Print Station

When staff click the print icon in the Pixilive backoffice, the photo is sent straight to Print Station — nothing to configure. Just keep Print Station running on the Mac connected to the printer.

## Local print API

Other apps running on the same Mac (photo booth software, scripts…) can send prints to Print Station over a local HTTP API on port 4242 (change it under **Settings → Local port** if needed).

**Print a photo**

```
POST http://127.0.0.1:4242/print
Content-Type: application/json

{ "imageUrl": "https://…/photo.jpg", "quantity": 2, "name": "Jane" }
```

- `imageUrl` (required): a publicly reachable JPEG or PNG
- `quantity` (optional, default 1): number of copies
- `name` (optional): shown in the print list

The same mask, paper size and printer settings apply as for any other print.

**Check the status**

```
GET http://127.0.0.1:4242/status
```

Returns the selected printer, paper size, port and hotfolder state.

## Print log

The main window lists the last 20 prints: orange while pending, green once sent to the printer, red if something went wrong (with the reason). Each session is also saved as a CSV file in `Documents/Pixilive Print Station/Logs/`, so you can check after an event what was received and printed.

## Updates

The app lets you know when a new version is available. Download it from the Releases page and install it over the previous one:

👉 [github.com/Pixilive/pixilive-print-station/releases](https://github.com/Pixilive/pixilive-print-station/releases)

## Support

Questions or issues? Open an [issue](../../issues) on this repo, or contact contact@pixi.live.
