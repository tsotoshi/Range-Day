# Range Day: a USPSA-style shooting game

A small browser game. Pick a stage, wait for the beep, and put two hits on each of
three cardboard targets as fast as you can. Stage 2 adds a white no-shoot target.
Stage 3 has a no-shoot, a tuxedo target (black paint = hard cover) and a small target.

Play it online: https://tsotoshi.github.io/Range-Day/

## What each file does

| File         | Job        | In plain English                                                        |
|--------------|------------|-------------------------------------------------------------------------|
| `index.html` | Skeleton   | Lists what's on the page: timer, buttons, the drawing area.             |
| `style.css`  | Looks      | Colours, fonts, sizes and layout. Changes how things look, never what they do. |
| `game.js`    | Brain      | Draws the range, listens to your mouse, plays sounds, keeps score.      |
| `README.md`  | This guide | Notes for humans. The game doesn't use it.                              |

The browser opens `index.html` first. That file loads `style.css` and `game.js`.

## How to run it on your Mac

1. Put the `range-day` folder somewhere easy to find, like your Desktop.
2. Double-click `index.html`. It opens in Safari or Chrome.
3. Turn your sound on and click **Start**.

You don't need to install anything or connect to the internet.

## How to make changes

1. Open the file in a text editor. TextEdit works (choose *Format → Make Plain Text*),
   but the free editor **Visual Studio Code** is much nicer.
2. Change something and save.
3. Go back to the browser and press **⌘ + R** to reload.

### Easy first experiments (all in section 1 at the top of `game.js`)

- `ROUNDS_PER_STAGE = 10` → give yourself more or fewer bullets.
- `POINTS = { A: 5, C: 3, D: 1 }` → change what each zone is worth.
- `MIN_DELAY` / `MAX_DELAY` → change how long you wait for the beep.
- `STAGES` → each stage lists its `targets` and `noShoots`. Move one by changing
  its `x` (left/right) or `y` (up/down). To make a Stage 3, copy a stage block,
  change its name and positions, then add a matching button in `index.html`.
- In `style.css`, change `--accent: #ff7a1a;` to another colour.

When you change `style.css` or `game.js`, also bump the version number in
`index.html` (`style.css?v=5` → `?v=6`, and the same for `game.js`). Otherwise
browsers may keep using their old saved copy for a few minutes.

If something breaks, undo your change (⌘ + Z) and save again. To see error messages,
right-click the page, choose **Inspect**, then open the **Console** tab.

## Scoring rules used

- A = 5, C = 3, D = 1 (the head's outer "B" area counts as C)
- Only the best 2 hits on each target count
- Each missing hit = −10 penalty
- Each hit on a white no-shoot = −10 penalty. A shot can go through the no-shoot
  and still score on the target behind it (a no-shoot isn't hard cover)
- Hits on black paint (a tuxedo target) are hard cover: they don't score and
  don't count toward your two hits
- Targets can be made bigger or smaller with `scale` (Stage 3 uses `scale: 0.6`)
  and painted as a tuxedo with `tuxedo: true`
- Time runs from the beep to your last shot
- **Hit factor = (points − penalties) ÷ time**. Higher is better. Each stage's best is saved in this browser.

## Online leaderboard (optional)

Players can post their hit factor to a shared top-10 list for each stage. The scores
live in a free **Supabase** database, because GitHub Pages can't store data.
Until you fill in the two keys below, the leaderboard stays hidden and the game works as before.

**Where it lives now:** the Supabase project **games** (shared with my other games),
in the table **`range_scores`**. The URL and publishable key are already in `game.js`.
The steps below are only needed if you ever move it to a new project.

1. Sign up at [supabase.com](https://supabase.com) and create a new project (the free plan is fine).
2. Open **SQL Editor → New query**, paste everything from `supabase-setup.sql`, and click **Run**.
   This creates the `scores` table and locks it so the public can only *read* and *add* scores.
3. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
4. Paste them into `LEADERBOARD_URL` and `LEADERBOARD_KEY` near the top of `game.js`.
   The anon key is designed to be public, so it's fine for it to be on GitHub.
5. Bump the version number, then save, commit and push.

To remove a fake or rude score, delete its row in Supabase's **Table Editor**.
Scores are sent from the player's browser, so a determined cheater could post a fake
one. The database rejects impossible numbers (hit factor over 40, time under 0.3 s).
