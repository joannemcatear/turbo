# Turbo

A tiny browser app that connects to a **Zwift Hub One** smart trainer and lets a **Zwift Click v2** change the resistance — no Zwift subscription needed.

**Open it:** https://joannemcatear.github.io/turbo/
**Try it without any hardware:** https://joannemcatear.github.io/turbo/?demo

## What it does

- **ERG mode** — the trainer holds a set wattage whatever your cadence. Click buttons raise or lower the target.
- **Slope mode** — the trainer simulates a hill (−10% to +20%). Click buttons change the gradient.
- Shows live power (3-second average), cadence, speed, ride time, average power and a 5-minute power chart.
- Keeps the screen awake while the trainer is connected.
- Every Click v2 button can be re-assigned (Clicker buttons panel); choices are remembered in the browser.

### Default button layout

| Button | Does |
|---|---|
| **+** (right puck) | Increase (+10 W / +0.5%) |
| **B** | Decrease |
| **Y** | Big increase (+25 W / +2%) |
| **A** | Big decrease |
| **Z** | Switch between ERG and Slope |
| **−** (left puck) | Decrease |
| ▲ / ▼ | Big increase / big decrease |
| ◀ / ▶ | Decrease / increase |

Holding an increase/decrease button repeats it. Keyboard: ↑/↓, Shift+↑/↓, M.

## How to use

1. **Close Zwift and Zwift Companion** — the Hub One only allows one Bluetooth connection at a time.
2. Open the app in **Chrome or Edge** (Windows, Mac, ChromeOS or Android). On iPhone/iPad use the **Bluefy** browser — Safari has no Bluetooth support.
3. Start pedalling to wake the trainer, tap **Connect trainer** and choose your Zwift Hub.
4. Press a button on the Click to wake it, tap **Add clicker** and choose it. The Click v2 is two separate devices — tap **Add clicker** again for the other half.

### Click v2 quirks

Zwift "locks" the Click v2 to its own app. If it isn't unlocked, it disconnects about once a minute (the app reconnects automatically) or the left half may not send buttons. To unlock for roughly 24 hours: open Zwift, pair the trainer and the Click v2, leave it ~30 seconds, close Zwift completely, then connect here. The right half generally works without unlocking, which is why **+** and **B** cover both directions by default.

## Files

```
index.html            page layout
style.css             look and feel
js/app.js             screen, settings, button handling, chart
js/ftms.js            trainer (standard Bluetooth FTMS: ERG + slope)
js/zwift-click.js     Zwift Click v2 (Zwift's own protocol)
js/demo.js            fake devices for ?demo
```

No build step — GitHub Pages serves these files as they are.

## Credits

The Click v2 protocol details come from the open-source [BikeControl](https://github.com/jonasbark/swiftcontrol) project.
