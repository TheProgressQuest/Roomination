# Release checklist

Roomination is built **prototype-first**:
- **Prototype:** features are built and filmed on `proto-*` branches with quick checks.
- **Release:** the full checks below run before anything reaches `main` and the live site.

## While prototyping (`proto-*` branches)

- **Where work happens:** on a `proto-*` branch. `main` and the live site stay untouched.
- **After each change:**
  - `npm run check` (TypeScript and a production build);
  - the unit tests for the code touched (`npx vitest run src/<area>`);
  - `npm run test:smoke` (one short pass through each main workflow).
- **Each new workflow** gets a smoke test in `e2e/smoke.spec.ts`.
- **CI on `proto-*` branches** runs the same quick checks (`.github/workflows/prototype.yml`) and
  never deploys.
- **Fix immediately:** crashes, data loss, privacy problems and serious geometry errors.
- **Defer the rest:** record it in [prototype-log.md](prototype-log.md).
- **Filmable milestones:** each one ends with a working demo, screenshots and a short note of
  what's real and what's mocked.

## Before a release (merging to `main`)

1. [ ] Move the work to a `phase-*` branch (or open one from the prototype). The full CI suite
       runs there.
2. [ ] Full regression:
   - [ ] `npm run test:full`: unit tests, then browser tests on the dev server and on the
     production build under `/Roomination/`, then the 3D tests one at a time.
   - [ ] Deferred tests from the prototype log written and passing.
3. [ ] Security:
   - [ ] No new network requests, analytics, accounts or uploads.
   - [ ] Imported files validated, with size limits.
   - [ ] New dependencies reviewed; new skills and tools scanned with SkillSpector.
4. [ ] Privacy:
   - [ ] No real scans, photos or personal data committed.
   - [ ] The README privacy section is updated.
5. [ ] Accessibility:
   - [ ] Keyboard paths.
   - [ ] Labels and names.
   - [ ] Contrast in light and dark themes.
   - [ ] Touch target sizes.
   - [ ] Reduced motion.
6. [ ] Performance:
   - [ ] Startup download measured against `main`.
   - [ ] Heavy features lazy-loaded.
   - [ ] 3D frame rate checked on a real device.
7. [ ] Real devices: the new workflows on an iPhone (Safari) and a Mac at least; for scanning, a
       real LiDAR scan.
8. [ ] Docs:
   - [ ] README features and limitations.
   - [ ] An ADR for significant decisions.
   - [ ] Beta labels where testing is incomplete.
9. [ ] The owner approves a working demonstration.
10. [ ] Fast-forward `main` (never force-push), wait for CI, deploy and verify-live, then check
        the live version and run the demo on the live site.
