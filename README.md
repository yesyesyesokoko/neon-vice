# Neon Vice

[![Bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/yesyesyesokoko/neon-vice/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/yesyesyesokoko/neon-vice/reward.svg)](https://make.fun/bounty/gta6-01)

Neon Vice is an open-world crime game set in Neon Bay, a sun-soaked modern coastal city. You are a driver fresh back in town who owes money to Rosa Vale, a fixer who runs a cafe on the boulevard. Drive the palm-lined streets, steal cars, outrun the police, take on jobs, and pay off the debt — or make the city yours instead.

Everything runs offline in a desktop browser from static files: no accounts, no network requests, no build step. The city, characters, vehicles, story, art, sound and music are all original, built on three.js (vendored under `game/vendor/`).

## Run it

Node 22 or newer, no install step:

```sh
node serve.ts
```

Then open <http://localhost:8080> in a desktop browser. To use another port:

```sh
node serve.ts --port 8123
```

## How to play

Start on the menu, then drive or walk around Neon Bay. Follow the yellow marker to pick up the next job from Rosa Vale — seven jobs in all, from a first delivery to a final run at the marina. Earn cash for each job you finish, and watch the wanted stars: the police chase, ram and bust you, and getting busted or wasted costs you a fine. You can fight back on foot with fists or a pistol, steal any car you find with E, and save your progress with P or from the pause menu. Progress, cash and completed jobs are saved in the browser.

### Controls

| Input | Action |
| --- | --- |
| W / A / S / D or arrow keys | Drive / walk |
| Mouse drag | Look around |
| Mouse wheel | Zoom camera |
| Shift | Sprint on foot |
| Space | Jump |
| E | Enter / exit car |
| 1 / 2 | Fists / pistol |
| F | Punch (fists) |
| G or left mouse click | Shoot pistol / punch with equipped weapon |
| R | Reload pistol |
| J | Job list |
| P | Save game |
| M | Mute sound |
| Esc | Pause |

### Systems

- **Neon Bay** — a procedural 600 × 600 m coastal city: 217 buildings, a palm-lined boulevard, beach and ocean, day sky with lit windows
- **Driving** — arcade handling with drift, five car styles, enter/exit any car, car damage and smoke
- **Traffic and pedestrians** — cars follow the road network, pedestrians stroll the sidewalks and scatter from fast cars
- **Wanted system** — 0–5 stars, police cars that route through the streets to ram you, foot officers at 2+ stars, BUSTED and WASTED with fines and respawn
- **Combat** — fists and pistol on foot, rival crews that chase and fight back
- **Missions** — a seven-job story arc with Rosa Vale: deliveries, a timed run, a car theft, losing the heat, a dockside shootout, a checkpoint race and a marina finale, with dialogue, beacons, minimap blips and cash rewards
- **HUD** — health, cash, speed, wanted stars, live objective with distance, compass arrow and a live minimap
- **Save** — localStorage autosave on job completion, manual save, Continue on the menu
- **Sound** — synthesized WebAudio: engine, sirens, music bed and effects, no audio files

Screenshots of the game are in `screenshots/`.

## License

MIT — see [LICENSE](LICENSE).

---

Built for the [gta6-01 bounty](https://make.fun/bounty/gta6-01) on make.fun. If you like it, come and build your own: [https://make.fun/r/tt5zh66d](https://make.fun/r/tt5zh66d) (my referral link).
