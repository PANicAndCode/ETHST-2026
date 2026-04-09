# Sig Tau Easter Treasure Hunt

This package is a full QR-based hunt site with unlimited custom teams, join-or-create team flow, mascot selection, and a random clue order for each team. Clues 1 through 10 are shuffled once per team, and clue 11 stays last for everyone.

## What is included
- Website files (`index.html`, `styles.css`, `config.js`, `script-part-1.js` through `script-part-4.js`)
- `sigtau_setup.sql` for Supabase
- `dynamic_teams_migration.sql` for upgrading an older fixed-team database
- `property-map.png` and `property-map-labeled.png` using the uploaded map
- Printable QR sheets PDF
- QR placement guide PDF
- All QR images in a zip
- QR manifest CSV and code list TXT

## Setup
1. Upload these website files to a separate repo or folder for the Sig Tau hunt.
2. Put your real Supabase URL and anon key into `supabase-config.js`.
3. Run `sigtau_setup.sql` in Supabase.
4. If you are upgrading an older fixed-team install, run `dynamic_teams_migration.sql` once after the main setup file.
5. Hard refresh phones after publishing.

## Notes
- This build remembers the same team on the same device after the first join.
- Players can either create a new team or join an existing team that was already created.
- The admin view is available from the opening screen and the top bar.
- `Leave this device` is admin-only.
- The admin panel can reset one team or wipe the full game.
- Map coordinates are placeholders. Edit `config.js` if you want to place pins differently.
- The first three finishers should go to Andy for 1st, 2nd, and 3rd pick of candy.
