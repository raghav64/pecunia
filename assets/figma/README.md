# Pecunia: Figma mocks for the dashboard redesign

Home-screen mocks for the planned React rebuild, styled after a warm "paper" finance dashboard (Flexoki palette, Inter + JetBrains Mono, slim icon rail). Dollar amounts and share counts are scaled demo values; percentages and market prices are real.

| File | What it shows |
|---|---|
| `home-light.png` | Home dashboard, light (paper) theme |
| `home-dark.png` | Same screen, dark theme (one Figma variable-mode switch) |
| `home-dark-menu-open.png` | ☰ flyout listing the analysis pages |

## Design tokens (Figma variables → CSS variables)

| Token | Light | Dark |
|---|---|---|
| bg/page | #F2F0E5 | #100F0F |
| bg/card | #FFFCF0 | #1C1B1A |
| bg/raised | #E6E4D9 | #282726 |
| border/default · strong | #E6E4D9 · #CECDC3 | #282726 · #403E3C |
| text/primary · muted · faint | #100F0F · #6F6E69 · #B7B5AC | #CECDC3 · #878580 · #575653 |
| accent/positive | #66800B | #879A39 |
| accent/negative | #AF3029 | #D14D41 |
| accent/orange | #BC5215 | #DA702C |
| *-subtle · chart/area | same hue at 14% · 22% alpha | same |

## Layout
- 72px icon rail: Home · ☰ Analysis · Benchmarks · Compare · Dip buying · Re-orient · Data … Refresh · Theme · Settings
- Header: live total value (mono 46) with change pill, "Live · updated" status, Refresh button
- Value-history area chart (portfolio, S&P 500 "same dollars" dashed, net invested dotted) + 1D…ALL range selector
- Markets & watchlist: SPY, QQQ + four blue chips with intraday sparklines
- Positions table (`Position row` component) · sector allocation bars with a concentration warning · "You outperformed the S&P 500 by" card
