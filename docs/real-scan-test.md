# Testing with a real room scan (iPhone 17 Pro)

These steps use only your iPhone and the live Roomination site. Your scan stays on your phone:
Roomination reads it in Safari and uploads nothing.

## 1. Install a scanning app

**RoomSheet** (free, needs iOS 18.6 or later) from the App Store. It exports Apple's own
RoomPlan data (`captured-room.json`), which Roomination reads.

*Alternative:* **LiDAR Room Scanner** says it exports "RoomPlan JSON" free. It should work too, but
it hasn't been tried yet.

## 2. Scan a room

- Turn the lights on, open the doors you want detected, and clear clutter from the floor if you
  can.
- In RoomSheet, start a new scan and walk slowly around the room. Point the phone at every
  wall, corner, door, window and piece of furniture until the outline closes.
- Finish the scan.

**For the video:** measure one wall with a tape measure first, so you can compare it with
Roomination later.

## 3. Export the scan

1. In RoomSheet, choose **Export Package…** → **Save to Files** → *On My iPhone* (for example a
   folder called *Scans*).
2. Open the **Files** app and **tap the .zip once**. The iPhone unzips it into a folder.
3. Inside that folder is **`captured-room.json`**. That's the file Roomination needs.

## 4. Import it into Roomination (Safari)

1. Open **https://theprogressquest.github.io/Roomination/** in Safari.
2. Tap **Projects** → **Import room scan… (Beta)** → **Choose scan file…** → **Browse**.
3. Pick **`captured-room.json`** from the folder you unzipped.
4. **Review the room:**
   - **Room:** do the wall lengths look right? Compare the wall you measured.
   - **Openings:** are the doors and windows all there? Add any it missed.
   - **Furniture:** is everything there, and is each piece the right kind? Change any that aren't.
5. Tap **Create new project**. Your other projects aren't touched.

## 5. Look at the result

- **2D Plan → Technical:** measurements and the wall outline.
- **2D Plan → Presentation:** the illustrated plan.
- **3D View:** drag to look around.
- Tap a piece of furniture. Under **From the room scan** you'll see what the scanner measured,
  next to what Roomination guessed.

## If it doesn't import

- **Please don't send the scan file itself:** it's a map of your home.
- Roomination will show a short message. Under it, tap **Show the file's structure (no
  measurements or names)** → **Copy structure**, and paste that to me. It contains only the
  file's layout, which is enough to add support for that app.
- Also tell me which app you used and the message you saw.

## Keeping scans private

- Leave scans in Files on your phone. Don't copy them into the Roomination project folder on
  your Mac.
- The repository's `.gitignore` blocks common scan files, but keeping them elsewhere is safest.
- Delete the scan from RoomSheet and Files whenever you like. The Roomination project keeps
  only what it needs: the measured walls, openings and furniture.
