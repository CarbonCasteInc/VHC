# Dev Color Panel Reference

Applies across sprints. Extracted from Sprint 3.5.

### Controlled CSS Variables (57 total)

**Page Backgrounds (6):**
- `--page-bg-venn` - VENN page background
- `--page-bg-hermes` - HERMES page background  
- `--page-bg-agora` - AGORA page background
- `--section-container-bg` - Container background (supports α)
- `--section-container-border` - Container border (supports α)
- `--section-title` - "Headlines" / "Forum Threads" title text

**VENN Cards (9):**
- `--headline-card-bg` - Unexpanded headline card
- `--headline-card-border` - Headline card border
- `--headline-card-text` - Headline card primary text
- `--headline-card-muted` - Headline card muted text
- `--analysis-surface` - Expanded analysis view (supports α)
- `--analysis-label` - "Summary", "Perspectives" labels
- `--analysis-text` - Analysis content text
- `--bias-table-bg` - Bias/perspectives table (supports α)
- `--bias-row-hover` - Row hover state

**HERMES Cards (6):**
- `--thread-surface` - Thread header (supports α)
- `--thread-title` - Thread title
- `--thread-text` - Thread content
- `--thread-muted` - Author, timestamp, score
- `--summary-card-bg` - AI summary nested card (supports α)
- `--summary-card-text` - Summary text

**Thread List (4):**
- `--thread-list-card-bg` - Thread card background in forum feed (supports α)
- `--thread-list-card-border` - Thread card border
- `--tag-bg` - Tag pill background (supports α)
- `--tag-text` - Tag pill text

**Stance — Support/Oppose/Discuss (9):**
- `--concur-button` - Support accent color (SlideToPost left zone)
- `--counter-button` - Oppose accent color (SlideToPost right zone)
- `--discuss-button` - Discuss accent color (SlideToPost center)
- `--discuss-border` - Discuss comment border color
- `--discuss-bg` - Discuss legacy column background (supports α)
- `--concur-bg` - Support legacy column background (supports α)
- `--concur-label` - "👍 Support" label
- `--counter-bg` - Oppose legacy column background (supports α)
- `--counter-label` - "👎 Oppose" label

**Forum Stream — Threaded Comments (5):**
- `--stream-concur-bg` - Support comment card background (supports α)
- `--stream-counter-bg` - Oppose comment card background (supports α)
- `--stream-discuss-bg` - Discuss comment card background (supports α)
- `--stream-thread-line` - Tree connector line color
- `--stream-collapse-bg` - Collapse/expand pill background (supports α)

**Comments (4):**
- `--comment-card-bg` - Composer card background (supports α)
- `--comment-author` - Author name
- `--comment-text` - Comment content
- `--comment-meta` - Timestamp, etc.

**Controls (4):**
- `--btn-primary-bg` - Primary button background
- `--btn-primary-text` - Primary button text
- `--btn-secondary-bg` - Secondary button background
- `--btn-secondary-text` - Secondary button text

**Icons (7):**
- `--icon-default` - Unengaged icon color
- `--icon-engaged` - Engaged icon color (solid)
- `--icon-glow` - Glow effect color (rgba, supports α)
- `--icon-shadow` - Shadow behind glow for edge definition (rgba, supports α)
- `--icon-shadow-x` - Shadow X offset (px)
- `--icon-shadow-y` - Shadow Y offset (px)
- `--icon-shadow-blur` - Shadow blur radius (px)

**Messaging (3):**
- `--chat-bg` - Chat area background
- `--msg-sent-bg` - Sent message bubble
- `--msg-received-bg` - Received message bubble

### Panel Controls

Each color has three sliders:
| Slider | What it controls |
|--------|------------------|
| **Saturation** | Color intensity (0% = gray, 100% = vibrant) |
| **Lightness** | Brightness (0% = black, 100% = white) |
| **Opacity** | Transparency (0% = invisible, 100% = solid) |

### How to Use

1. Click the **🎨 button** (bottom-right, dev mode only)
2. Select category tab (Page, VENN Cards, HERMES Cards, Thread List, etc.)
3. Adjust colors via:
   - Color picker (hue)
   - Saturation/Lightness/Opacity sliders
   - Direct text input (hex/rgba)
4. Toggle dark/light mode (theme toggle) to edit each mode separately
5. Changes persist to localStorage automatically

### Panel Buttons

| Button | Action |
|--------|--------|
| **💾 Save** | Copies Tailwind config code to clipboard — paste into `tailwind.config.cjs` to make permanent |
| **CSS** | Copies raw CSS variables to clipboard |
| **↺** | Reset all colors to original defaults |
| **✕** | Close panel |

### Saving Colors as Permanent Defaults

1. Tune colors until satisfied
2. Click **💾 Save**
3. Open `apps/web-pwa/tailwind.config.cjs`
4. Replace the entire `plugins: [...]` section with the copied code
5. Restart dev server

**Status:** Ready for manual color tuning
