# Crow Todo Card

*** Experimental ***

Crow Todo Card is a Home Assistant `todo` entity card with an Apple-style design — glassmorphism panels, an SF Pro font stack and a `#007AFF` accent by default. It's built as a shopping list first, with an optional second linked task list, AI-powered categorisation and item lookups, swipe-to-delete rows, restock reminders and PDF export.

> ✨ **AI features are optional and off by default.** Turn on **AI Features** in the editor to unlock categorisation, duplicate detection and long-press item/task lookups — they need a conversation agent already configured in Home Assistant (e.g. Google Gemini, OpenAI, Claude, or Home Assistant's built-in AI). With AI off, the card still works fully as a plain shopping/todo list.

## Key Features

- **Shopping list card** — built on any Home Assistant `todo` entity, with an optional second linked `todo_entity` for a Tasks list shown in its own section
- **Apple-style Design** — glassmorphism panels, SF Pro font stack, customisable accent colour
- **Add, Check Off, Rename and Delete Items** — inline rename with tap-to-edit
- **Swipe to Delete** — swipe a row left to reveal delete, matching the standard iOS swipe-list convention; swiping open one row closes any other open row automatically
- **Long-press for Info** — long-press a shopping item or task (when AI Features and the relevant lookup are on) to open its AI-powered info popup
- **Sort by Category** — groups active items into aisle-style categories (Produce, Dairy, Household, etc.) when AI Features and Categorise Items are enabled; toggle from the card's own ⋮ menu, which remembers your last choice per card
- **Optional Tasks Section** — link a second `todo` entity as a Tasks list, shown in its own collapsible section below the shopping list, with its own AI categorisation, completed/active split and PDF export
- **Tasks Only View** — an AI-sorted, category-grouped view of just the Tasks list, toggled from the ⋮ menu (only appears once a Tasks list is configured and AI Features are on)
- **Compact Mode** — tighter single-line rows (smaller checkbox, less padding) to fit more items on screen; can be toggled anytime from the card's ⋮ menu, which remembers the last choice
- **Collapsible Card** — tap the title or chevron to collapse the card down to a one-line summary (e.g. "6 to get, 3 tasks")
- **Show Completed** — completed items and tasks collapse into their own expandable section rather than cluttering the active list
- **Duplicate Detection** — when AI Features and Duplicate Detection are on, adding an item similar to one already on the list prompts you to confirm before adding a near-duplicate
- **Restock Reminders** — suggests re-adding items you buy on a regular basis, based on how often you've completed and re-added them before; each suggestion can be dismissed individually
- **PDF Export** — export the shopping list or the Tasks list to a clean, category-grouped PDF from the ⋮ menu, with an in-card preview before you save or share it
- **Persistent Storage (optional)** — item categories, food/task info lookups, dismissed restock suggestions and the Tasks Only View choice can be saved to Home Assistant's own database instead of just the browser, so they survive app restarts and cache clears

## AI Features

AI features are **off by default** — the card works fully without them as a plain shopping/todo list. Enable them with the **AI Features** toggle in the editor, then select a conversation agent already configured in Home Assistant under **Settings → Voice Assistants** (Google Gemini, OpenAI, Claude, Home Assistant's built-in AI, Ollama, etc. can all work). Each AI-powered feature also has its own toggle so you only turn on what you want.

- **Categorise Items** — assigns a short aisle/category label (e.g. Produce, Dairy, Bakery, Meat, Frozen, Pantry, Household) to each shopping item, and a task category (Errand, Home, Work, Calls, Health, Admin, Family) to each task, used for Sort by Category and Tasks Only View
- **Duplicate Detection** — catches items that look like something already on the list (exact or close text match) before adding a second copy
- **Food Info Lookup** — long-press a shopping item to see a store-label-style popup: category, typical serving, approximate calories and carbs, glycemic-index category, dietary tags, storage tip, shelf life, a fun fact and — for cooked dishes — a typical ingredients list. Recognises when an item names a specific brand and flags whether the numbers are brand-specific or a generic estimate, with a one-tap switch to the generic fallback when a brand is detected. An optional toggle shows a looked-up photo alongside the info, and the popup itself can fetch a few short serving/pairing ideas and preparation tips on demand
- **Task Info Lookup** — long-press a task to see category, an estimated time to complete, tools/supplies typically needed, a suggested best time of day and a short note on what can vary, with a few practical tips and related/follow-up tasks fetchable on demand

## Installation

Install via **HACS** (recommended):

1. Open **HACS** in Home Assistant → **Frontend** tab
2. Click ⋮ → **Custom repositories**, add `https://github.com/jamesmcginnis/crow-todo-card` as a **Lovelace** repository
3. Search for **Crow Todo Card** and click **Download**
4. Restart Home Assistant, then hard-refresh your browser

Or download `crow-todo-card.js` from the [Releases](../../releases/latest) page, copy to `/config/www/`, and add `/local/crow-todo-card.js` as a **JavaScript module** resource under **Settings → Dashboards → Resources**.

## Quick Start

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

> **Note:** `todo_entity` is optional — leave it blank for a shopping-list-only card. AI features are **off by default**; the example above enables them, along with all of the individual AI toggles they gate. Leave `ai_features_enabled` out (or set it `false`) for a plain list with no AI calls.
