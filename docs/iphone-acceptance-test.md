# iPhone acceptance test: your scanned room, its photos and Select an area

What it checks, on your own iPhone: **import the room scan with its seven photos → the 3D room →
download and use Select an area on the sectional, a wall and the floor → apply and undo a colour
→ back to 3D → save, close and reopen → behaviour when memory runs short.**

About 40 minutes. Everything stays on your devices: the Mac only serves the app's own files,
and nothing is uploaded. Keep the scan package outside the Roomination folder (Downloads, Files),
never in Git.

Results from this test are the **physical-iPhone** results. Everything measured so far ran on the
Mac (desktop Chromium, WebKit and iPhone-sized emulation), which says little about an iPhone's
memory limits or speed.

## Before you start (once)

**On the Mac**, in Terminal, from the Roomination folder:

```
git checkout proto-lidar
npm run phone-test
```

Leave it running. Then follow *Before you start* in [real-object-test.md](real-object-test.md)
(trust the test certificate on the iPhone, open `https://Haris-MacBook-Pro.local:4443/Roomination/`,
turn on Web Inspector and connect the cable). If you already did this for the radio test, just
open the https address.

**The scan package on the iPhone:** in RoomSheet, open the scan *Room-20261024-1154A* →
**Export Package…** → **Save to Files** (it makes a `.zip`). Or AirDrop the zip from the Mac.

**Before each run:** close other Safari tabs and apps you don't need, so the memory numbers are
comparable.

## 1. Import the room and its photos

1. Roomination → **Projects → Import room scan… → Choose scan file…** → the zip in Files.
2. In the review, check the **Furniture** tab: one *Sectional sofa*, a *Dining table, 6 seats*,
   dining chairs, bookshelves, a desk. Note anything that looks wrong.
3. At the bottom: **Add the scan's 7 photos to Match my room** should be ticked. Tap **Create
   new project**. Note the time from tapping to the plan appearing.

## 2. The 3D room

1. **3D View**, orbit and zoom for 10 seconds. Smooth or jerky? Did Safari reload the page?
2. **On the Mac:** Safari → **Develop → (your iPhone) → Roomination** → **Timelines**: tick
   *Memory* and *CPU*, record while orbiting, stop. Note the memory peak. **Keep this recording
   running from here to the end of step 4** (stop and start it again if it gets long).

## 3. Select an area

1. **Options → Match my room**. The scan's photos are at the top; choose the one with the
   sectional (photo 1).
2. **Pick by: Selecting an area (AI)** → read the notice (19 MB) → **Download and turn on**.
   Note the download time.
3. Wait for *Tap the middle of the object or surface.* Note **Photo read in … s** (shown under
   the photo).
4. **The sectional:** tap the middle of the chaise.
   - Is it outlined cleanly? Try **Larger area** (whole sofa) and **Smaller area**.
   - Note the suggested colour and *last selection … s*.
   - To colour the sofa itself: tap the sofa in the 3D view to select it, then in Match my room
     tap **Photos for Sectional sofa** → **Pick colour** → **Selecting an area (AI)** → tap the
     chaise again → **Apply colour** (*Apply to* now says the sofa). Does the 3D sofa change
     colour?
   - **Undo** (the arrow at the top): does the colour go back?
5. **Reject**, then **a wall**: tap a plain stretch of wall → **Apply to: All walls** → **Apply
   colour**.
6. **Reject**, then **the floor**: tap the wooden floor → **Apply to: Floor** → **Apply colour**.
7. **Another photo:** choose photo 6 (the dining area) and tap the table. Note the read time.
8. **Repeat:** tap five different things in a row on one photo. Any slowdown? Any reload?
9. On the Mac's Timelines: note the **memory peak during steps 3–8**, and the memory a minute
   after closing Match my room (×). It should drop back towards the step 2 level.

## 4. Back to 3D, save, close and reopen

1. Close Match my room. **3D View**: do the walls, floor and sofa show the new colours? Orbit:
   still smooth?
2. Close the Safari tab (swipe it away). Open the address again: is the project there, with the
   colours and the seven photos (Options → Match my room)?
3. **Pick by: Selecting an area (AI)** again: it should come back **without downloading** (kept
   in Safari) and work. Note the time to *Tap the middle…*.
4. **Projects → Export file** → AirDrop the zip to the Mac → on the Mac,
   `http://localhost:4174/Roomination/` → **Projects → Import file…**: are the photos there?

## 5. When memory runs short

1. Open six or more other tabs with heavy pages (news sites, maps, videos), then go back to
   Roomination and use **Select an area** on a new photo.
2. If Safari reloads the page ("This webpage was reloaded…"): open Match my room again and
   choose **Selecting an area (AI)**. It should **not** start by itself, and should say that the
   page stopped last time. Tap **Turn on** to try again. If it stops the page a second time, it
   switches itself off on this iPhone and says so; **Tapping a point** must keep working, and the
   rest of the app (plan, 3D, saving) must be unaffected.
3. Also try a **HEIC photo straight from the Camera**: **+ Add photo** → **Photo Library** → a
   recent photo. (iOS usually hands Safari a JPEG copy; from **Files**, a `.heic` file stays
   HEIC.) Both should open. Then try one from **Files** that's a `.heic`.

## If something fails

- Write down the exact message, and what you were doing.
- On the Mac's Web Inspector → **Console**: copy any red errors.
- Don't send the scan, the photos or exported projects themselves.

## Results to send back

| Check | Result |
| --- | --- |
| iPhone model, iOS version | |
| Import: time to plan; furniture as listed? Anything wrong? | |
| 3D orbit: smooth / jerky; memory peak (step 2) | |
| Model download time | |
| Photo read time (photo 1, photo 6); after reopening | |
| Sectional: outline clean? Larger/Smaller useful? Colour plausible? | |
| Selection time (typical) | |
| Apply → 3D changed? Undo restored? | |
| Wall, floor: outline and colour plausible? | |
| Memory peak during Select an area; a minute after closing it | |
| Five taps in a row: slowdown? reload? | |
| After closing the tab: project, colours, 7 photos there? Model not re-downloaded? | |
| Export → Mac: photos there? | |
| Many tabs: any reload? Did the safeguard behave as described? Point picking still fine? | |
| HEIC from Photo Library / from Files: opened? | |
