# Crow Todo Card

*** Experimental AI Features ***

Crow Todo Card is a Home Assistant `todo` entity card with an Apple-style design — glassmorphism panels, an SF Pro font stack and a `#007AFF` accent by default. It's built as a shopping list first, with an optional second linked task list, AI-powered categorisation and item lookups, swipe-to-delete rows, restock reminders and PDF export.

> ✨ **AI features are optional and off by default.** Turn on **AI Features** in the editor to unlock categorisation, duplicate detection and long-press item/task lookups — they need a conversation agent configured in Home Assistant (see [AI Features Setup](#-ai-features-setup-optional) below). With AI off, the card still works fully as a plain shopping/todo list.

![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2026+-blue)
![HACS](https://img.shields.io/badge/HACS-Custom-orange)

[![Open your Home Assistant instance and add this repository to HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jamesmcginnis&repository=crow-todo-card&category=plugin)

---

## 🛠️ Installation

### Via HACS (Recommended)

1. In Home Assistant, open **HACS** from the sidebar
2. Click the **⋮ menu** (top right) → **Custom repositories**
3. Add `https://github.com/jamesmcginnis/crow-todo-card` as a **Lovelace** repository, then close
4. Click **+ Explore & Download Repositories**, search for **Crow Todo Card** and click **Download**
5. Restart Home Assistant when prompted
6. Hard-refresh your browser (Cmd+Shift+R on Mac) or close and reopen the Home Assistant app

### Manual

1. Download `crow-todo-card.js` from [Releases](../../releases/latest)
2. Copy the file to `/config/www/` on your Home Assistant instance
3. In Home Assistant go to **Settings → Dashboards → Resources** and click **+ Add resource**
   - URL: `/local/crow-todo-card.js`
   - Type: **JavaScript module**
4. Click **Create**, then hard-refresh your browser

---

## 🤖 AI Features Setup (Optional)

AI features are **off by default** — the card works fully without them as a plain shopping/todo list. To unlock item categorisation, duplicate detection and the long-press food/task info lookups, turn on **AI Features** in the editor, then select a conversation agent already configured in Home Assistant (e.g. Google Gemini, OpenAI, Claude, Home Assistant's built-in AI, Ollama — added via **Settings → Voice Assistants**).

### Configure the Card

In the card's visual editor, turn on **AI Features** and select your conversation agent from the AI Agent dropdown. Then choose which AI-powered features to enable individually: **Categorise Items**, **Duplicate Detection**, **Food Info Lookup** (with optional photo), and **Task Info Lookup**.

> 💡 AI responses are cached per item/task, so repeated lookups of the same item don't re-query your agent.

---

## ✨ Features

### Core List

- 🛒 **Shopping list card** — built on any Home Assistant `todo` entity, with an optional second linked `todo_entity` for a Tasks list shown in its own section
- 🎨 **Apple-style design** — glassmorphism panels, SF Pro font stack, customisable accent colour
- ✅ **Add, check off, rename and delete items** — inline rename with tap-to-edit
- 👈 **Swipe to delete** — swipe a row left to reveal delete, matching the standard iOS swipe-list convention; swiping open one row closes any other open row automatically
- 👆 **Long-press for info** — long-press a shopping item or task (when AI Features and the relevant lookup are on) to open its AI-powered info popup
- 📁 **Sort by Category** — groups active items into aisle-style categories (Produce, Dairy, Household, etc.) when AI Features and Categorise Items are enabled; toggle from the card's own ⋮ menu, which remembers your last choice per card
- 📋 **Optional Tasks section** — link a second `todo` entity as a Tasks list, shown in its own collapsible section below the shopping list, with its own AI categorisation, completed/active split and PDF export
- 🗂️ **Tasks Only View** — an AI-sorted, category-grouped view of just the Tasks list, toggled from the ⋮ menu (only appears once a Tasks list is configured and AI Features are on)
- 📐 **Compact Mode** — tighter single-line rows (smaller checkbox, less padding) to fit more items on screen; can be toggled anytime from the card's ⋮ menu, which remembers the last choice
- 🔽 **Collapsible card** — tap the title or chevron to collapse the card down to a one-line summary (e.g. "6 to get, 3 tasks")
- ✔️ **Show Completed** — completed items and tasks collapse into their own expandable section rather than cluttering the active list
- 🔁 **Duplicate detection** — when AI Features and Duplicate Detection are on, adding an item similar to one already on the list prompts you to confirm before adding a near-duplicate
- 🔔 **Restock reminders** — suggests re-adding items you buy on a regular basis, based on how often you've completed and re-added them before; each suggestion can be dismissed individually
- 📄 **PDF export** — export the shopping list or the Tasks list to a clean, category-grouped PDF from the ⋮ menu, with an in-card preview before you save or share it
- 💾 **Persistent storage (optional)** — item categories, food/task info lookups, dismissed restock suggestions and the Tasks Only View choice can be saved to Home Assistant's own database instead of just the browser, so they survive app restarts and cache clears

### AI Features

- 🏷️ **Categorise Items** — assigns a short aisle/category label (e.g. Produce, Dairy, Bakery, Meat, Frozen, Pantry, Household) to each shopping item, and a task category (Errand, Home, Work, Calls, Health, Admin, Family) to each task, used for Sort by Category and Tasks Only View
- 🔁 **Duplicate Detection** — catches items that look like something already on the list (exact or close text match) before adding a second copy
- 🥫 **Food Info Lookup** — long-press a shopping item to see a store-label-style popup: category, typical serving, approximate calories and carbs, glycemic-index category, dietary tags, storage tip, shelf life, a fun fact and — for cooked dishes — a typical ingredients list. Recognises when an item names a specific brand and flags whether the numbers are brand-specific or a generic estimate, with a one-tap switch to the generic fallback when a brand is detected
  - 🖼️ **Optional photo** — shows a looked-up image of the item alongside its info (toggle separately in the editor)
  - 🍽️ **Serving & cooking suggestions** — a few short serving/pairing ideas and preparation tips, fetched on demand from within the popup
- 🗓️ **Task Info Lookup** — long-press a task to see category, an estimated time to complete, tools/supplies typically needed, a suggested best time of day and a short note on what can vary
  - 💡 **Task tips & related tasks** — a few practical tips for doing the task well, plus related or follow-up tasks worth doing around the same time, fetched on demand from within the popup

---

## 📋 Quick Start

```yaml
type: custom:crow-todo-card
entity: todo.shopping_list
title: Shopping List
accent_color: '#007AFF'
show_add_bar: true
group_by_category: true
ai_features_enabled: true
ai_conversation_agent: conversation.google_generative_ai
ai_categorize: true
ai_duplicate_check: true
ai_food_lookup: true
ai_food_lookup_image: true
restock_suggestions: true
max_list_height: 340
todo_entity: todo.tasks
show_tasks_section: true
ai_task_lookup: true
start_collapsed: false
compact_mode: false
persistent_storage: false
```

> **Note:** `todo_entity` is optional — leave it blank for a shopping-list-only card. AI features are **off by default**; the example above enables them, along with all of the individual AI toggles they gate (Categorise Items, Duplicate Detection, Food Info Lookup, Task Info Lookup). Leave `ai_features_enabled` out (or set it `false`) for a plain list with no AI calls.

---

## 🔧 Troubleshooting

**AI features are missing from the editor or don't do anything**
- Check **AI Features** is turned on in the editor, and that an AI Agent is selected — AI is off by default.
- Make sure the individual AI toggle for the feature you want (Categorise Items, Duplicate Detection, Food Info Lookup, Task Info Lookup) is also on.

**Sort by Category shows everything under "Other"**
- Categorisation needs **AI Features** and **Categorise Items** both enabled, and only runs for items not already in the category cache — give it a moment after adding new items.

**Tasks section doesn't appear**
- Confirm a `todo_entity` is set in the editor, and that **Show Tasks Section** is on (either in the editor or the card's own ⋮ menu — the ⋮ menu toggle wins once you've used it).

**Swiping a row doesn't reveal delete**
- The gesture locks to whichever direction (horizontal swipe vs. vertical scroll) it detects first — a mostly-vertical touch is treated as a scroll. Try a more deliberate horizontal swipe.

**Long-press doesn't open the info popup**
- Long-press only opens a lookup when **AI Features** is on and the matching toggle (Food Info Lookup or Task Info Lookup) is enabled for that list.

**PDF export fails or shows a blank preview**
- The card loads the PDF library from a CDN the first time it's needed — check your internet connection if export fails immediately.

**Data disappears after closing and reopening the app**
- By default, categories, lookups, dismissed restock suggestions and view choices are cached in the browser only. Enable **Persistent Storage** in the editor to save them to Home Assistant's own database instead.

**Card doesn't appear after installation**
- Add the resource to Lovelace and hard-refresh your browser (or close and reopen the Home Assistant app).

---

## 🙏 Credits & Acknowledgements

- The [Home Assistant](https://www.home-assistant.io) team
- The HA community for inspiration and feedback
- All users who test, report issues and suggest improvements

---

## 📄 License

MIT License — free to use, modify and distribute.

---

## 🐦 Why "CROW"?

- **C**lean design
- **R**esponsive interface
- **O**ptimised performance
- **W**ell-crafted experience

---

## ⭐ Support

If this card is useful to you, please **star the repository** and share it with the community!

For bugs or feature requests, use the [GitHub Issues](../../issues) page.
