# Sig Tau Easter Treasure Hunt

This package is a full QR-based hunt site that uses the same QR codes and team order as the earlier hunt.

## What is included
- Website files (`index.html`, `styles.css`, `script.js`, `config.js`)
- `sigtau_setup.sql` for Supabase
- `property-map.png` and `property-map-labeled.png` using the uploaded map
- Printable QR sheets PDF
- QR placement guide PDF
- All QR images in a zip
- QR manifest CSV and code list TXT

## Setup
1. Upload these website files to a separate repo or folder for the Sig Tau hunt.
2. Put your real Supabase URL and anon key into `supabase-config.js`.
3. Run `sigtau_setup.sql` in Supabase.
4. Hard refresh phones after publishing.

## Notes
- This build remembers the same team on the same device after the first join.
- The admin view is available from the opening screen and the top bar.
- The admin panel can reset one team or the full game.
- Map coordinates are placeholders. Edit `config.js` if you want to place pins differently.
- The first three finishers should go to Andy for 1st, 2nd, and 3rd pick of candy.
