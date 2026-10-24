# Testing with your real radio (iPhone + Mac)

The test: **scan the radio → export → import into Roomination → save to My Library → put it on
a shelf in your scanned room → open the project on the iPhone and the Mac.**

About 45 minutes. Your scan, room and photos stay on your devices: the Mac only serves the
app's own files, and nothing is uploaded. Keep the scan file outside the Roomination folder
(e.g. in Downloads), never in Git.

## Before you start (once)

**On the Mac**, in Terminal, from the Roomination folder:

```
git checkout proto-lidar
npm run phone-test
```

Leave it running (Ctrl+C stops it). It prints three addresses; yours will be:

- iPhone, first time: `http://Haris-MacBook-Pro.local:4080`
- iPhone, for testing: `https://Haris-MacBook-Pro.local:4443/Roomination/`
- the Mac itself: `http://localhost:4174/Roomination/`

**On the iPhone** (same Wi-Fi as the Mac):

1. Open `http://Haris-MacBook-Pro.local:4080` in Safari and follow its three steps (download
   the test certificate → install it in Settings → switch it on under *Certificate Trust
   Settings*). This is needed because phones only let web apps save photos and models on secure
   (https) addresses.
2. Then open `https://Haris-MacBook-Pro.local:4443/Roomination/`. If the name doesn't open,
   use the number the Mac printed instead, e.g. `https://10.0.0.78:4443/Roomination/`.
3. **For measurements:** iPhone Settings → Safari → Advanced → turn on **Web Inspector**. On
   the Mac: Safari → Settings → Advanced → tick **Show features for web developers**. Connect
   the iPhone with a cable.

## 1. Scan and export the radio (iPhone)

- **Reality Composer** (free, Apple): *New object capture* → walk slowly round the radio (and
  flip it if the app asks) → when done, **Share → Export → USDZ** → Save to Files.
- *Or* **Scaniverse**: *Small object* → scan → *Share → Export model* → **GLB** (or USDZ).

Good light, a plain surface, and the whole radio in view. Crop away the table in the app if it
offers to. AirDrop a copy to the Mac (into Downloads) for diagnosis.

## 2. Import it (iPhone)

1. Import your room scan if it isn't there yet (**Projects → Import room scan…**,
   `captured-room.json`). If the scan has no shelf, add **Open shelving unit** (Add → search
   "shelving").
2. Tap the shelf (to select it), then **Add → Custom furniture & library → Import 3D model**.
3. **Choose model file…** → your USDZ (or GLB). **Time it** (from choosing to the preview).
4. In the preview, check, and note what you see:
   - Does it stand upright? If not: **Tip forward / Tip sideways**.
   - Does its front face the blue arrow? If not: **Turn**.
   - Do the colours, wood grain and knobs look like the radio? Any dark, shiny or missing
     areas?
   - Is the size right? Measure the real radio with a tape and type **one** dimension; the
     others follow.
5. Keep **Also save it to My Library** ticked → **Add to room**. Time this too.
6. It should land on the shelf. Pick the shelf level under **Rests on → Surface**.

## 3. Look at it, and measure the phone

1. **3D View**: orbit round it, zoom in. Does it feel smooth or jerky? Did Safari reload the page
   (a sign of running out of memory)?
2. **On the Mac:** Safari → **Develop → (your iPhone) → Roomination**. In the Web Inspector:
   - **Timelines**: tick *Memory*, *CPU* and *Screen*/*Rendering Frames*, press record, orbit
     for 10 seconds, stop. Note the memory peak (MB) and the frame rate.
   - **Console**: type `__roomination3D.stats()` and press Return. Note `modelTriangles`,
     `modelFallbacks`, `drawCalls`.
3. **Nothing uploaded:** in Web Inspector → **Network**, reload the page and redo the import.
   Every row should be your Mac's name or address (or "blob"/"data"). Nothing else.

## 4. The triangle budget

1. Note the radio's triangles (select it → **3D model** in its properties).
2. In 3D, set **Quality → Low**. Low draws up to **150,000** triangles of models.
3. Tap the shelf, then add the radio again from **My Library**, repeatedly, until one copy
   becomes a **plain grey box**. That's the budget at work. Note how many copies fitted.
4. Switch to **Medium** (600,000) and **High** (1,500,000): the boxes should become radios
   again, as long as the total fits.
5. Delete the extra copies.

## 5. Save, close, reopen, move between devices

1. On the iPhone, **close the Safari tab** (swipe it away), open the address again: the project,
   radio and library item should all be there.
2. **Projects → Export file** → it saves a `.zip`. AirDrop it to the Mac.
3. On the **Mac**, open `http://localhost:4174/Roomination/` → **Projects → Import file…** →
   the zip. The radio should appear on its shelf with its textures. Also check **My Library on
   the Mac** (it starts empty there: the library belongs to each browser, and only projects
   travel in the export).
4. Optional: export from the Mac and import on the iPhone the same way.

## If something fails

- Write down the exact message Roomination shows.
- On the Mac, run: `npm run inspect-model -- ~/Downloads/YourRadio.usdz` (your file's name)
  and send me what it prints. It describes the file's structure and has no pictures or shapes
  in it.
- Don't send me the model file or room scan itself.

## Results to send back

| Check | Result |
| --- | --- |
| App and format (Reality Composer USDZ / Scaniverse GLB …), file size | |
| Import time (choose → preview) / save time (Add to room) | |
| Upright and facing front without changes? Which buttons were needed? | |
| Textures and materials: look right? Anything dark, shiny or missing? | |
| Real size typed, and does it look in proportion? | |
| Landed on the shelf? | |
| Orbiting: smooth / jerky? Any reloads? | |
| Memory peak (MB), frame rate (Timelines) | |
| `__roomination3D.stats()`: modelTriangles / modelFallbacks | |
| Network: anything other than your Mac? | |
| Budget: copies that fitted at Low; boxes back at Medium? | |
| After closing and reopening the tab: all there? | |
| Exported zip → Mac: radio there, textured? | |
| Anything confusing in the wording or steps | |

When you've finished: remove the test certificate from the iPhone (**Settings → General → VPN &
Device Management → Roomination phone test → Remove Profile**), and stop the Mac server
(Ctrl+C).
