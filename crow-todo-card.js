// crow-todo-card.js
// Apple-style Home Assistant `todo` entity card — glassmorphism panels,
// SF Pro font stack, #007AFF accent, conversation/process-routed AI features.

class TigerTodoCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._items = [];
    this._lastStateSig = null;
    this._showCompleted = false;
    this._categoryCache = {};       // item text (lowercased) -> category label
    this._completionLog = {};       // item text (lowercased) -> [timestamps]
    this._dismissedRestock = {};    // item text (lowercased) -> timestamp when dismissed
    this._pendingDuplicate = null;  // { text, existing } awaiting user confirm
    this._userDataLoaded = false;
    this._openRowUid = null;        // uid of the row currently swiped open, if any
    this._foodInfoCache = {};       // item text (lowercased) -> looked-up food info
    this._foodPopupOverlay = null;
    this._sortByCategory = null;    // null = follow config default; true/false = explicit override from the ⋮ menu
    this._collapsed = null;         // null = follow config default; true/false = explicit override from the chevron/title
    this._compactMode = null;       // null = follow config default; true/false = explicit override from the ⋮ menu
    this._menuOpen = false;
    this._pdfPopupOverlay = null;
    this._taskItems = [];           // items from the optional second (todo_entity) list
    this._lastTaskStateSig = null;
    this._showTasks = null;         // null = follow config default; true/false = explicit override from the ⋮ menu
    this._tasksExpanded = false;    // collapsed by default, same as Completed
    this._showCompletedTasks = false;
    this._taskCategoryCache = {};   // task text (lowercased) -> AI category label
    this._tasksOnlyView = false;    // "View Tasks Only (AI Sorted)" from the ⋮ menu
    this._taskInfoCache = {};       // task text (lowercased) -> looked-up task info
    this._categoryPinByUid = {};    // item uid -> category, overrides the text lookup right after a rename
    this._taskCategoryPinByUid = {}; // same, for the Tasks list
  }

  disconnectedCallback() {
    this._closeFoodPopup();
    this._closePdfPopup();
  }

  static getConfigElement() {
    return document.createElement('crow-todo-card-editor');
  }

  static getStubConfig(hass) {
    const todoEntity = hass ? Object.keys(hass.states).find(e => e.startsWith('todo.')) : '';
    return {
      entity: todoEntity || '',
      title: 'Shopping List',
      accent_color: '#007AFF',
      show_add_bar: true,
      group_by_category: true,
      ai_features_enabled: false,
      ai_conversation_agent: '',
      ai_categorize: true,
      ai_duplicate_check: true,
      ai_food_lookup: true,
      ai_task_lookup: true,
      ai_food_lookup_image: true,
      restock_suggestions: true,
      max_list_height: 340,
      todo_entity: '',
      show_tasks_section: true,
      start_collapsed: false,
      compact_mode: false,
      persistent_storage: false
    };
  }

  setConfig(config) {
    if (!config.entity) throw new Error('Please define a todo entity');
    this._config = {
      title: 'Shopping List',
      accent_color: '#007AFF',
      show_add_bar: true,
      group_by_category: true,
      ai_features_enabled: false,
      ai_conversation_agent: '',
      ai_categorize: true,
      ai_duplicate_check: true,
      ai_food_lookup: true,
      ai_task_lookup: true,
      ai_food_lookup_image: true,
      restock_suggestions: true,
      max_list_height: 340,
      todo_entity: '',
      show_tasks_section: true,
      start_collapsed: false,
      compact_mode: false,
      persistent_storage: false,
      ...config
    };
    // The ⋮ menu's "Sort by Category" and "Show Tasks Section" toggles are
    // runtime overrides that otherwise always win over these editor
    // settings, so they survive a reload — but that means once either has
    // ever been touched from the card itself, changing the matching editor
    // setting would silently do nothing. To make an editor change always
    // take effect (even though the editor's live preview may recreate this
    // element on every edit, losing normal instance memory), compare
    // against the last config value we saw, persisted in localStorage
    // rather than kept only on `this` — a genuine edit changes that stored
    // value; an unrelated reload of the same saved config does not.
    try {
      const lastKey = 'tiger_last_config_' + this._config.entity;
      const lastRaw = localStorage.getItem(lastKey);
      const last = lastRaw ? JSON.parse(lastRaw) : null;
      if (last && last.group_by_category !== this._config.group_by_category) {
        this._sortByCategory = this._config.group_by_category;
        this._saveSortPreference();
      }
      if (last && last.show_tasks_section !== this._config.show_tasks_section) {
        this._showTasks = this._config.show_tasks_section;
        this._saveTasksVisibilityPreference();
      }
      localStorage.setItem(lastKey, JSON.stringify({
        group_by_category: this._config.group_by_category,
        show_tasks_section: this._config.show_tasks_section
      }));
    } catch (_) {}
    if (this.shadowRoot.innerHTML) this._render();
  }

  getCardSize() { return 4; }

  set hass(hass) {
    const firstRun = !this._hass;
    this._hass = hass;
    const stateObj = hass.states[this._config.entity];
    if (!stateObj) { this._render(); return; }
    const sig = stateObj.last_changed + stateObj.state;
    if (firstRun) {
      this._loadUserData();
    }
    if (sig !== this._lastStateSig) {
      this._lastStateSig = sig;
      this._fetchItems();
    } else if (firstRun) {
      this._fetchItems();
    }

    // Optional second (Tasks) list — tracked the same way, independently.
    if (this._config.todo_entity) {
      const taskStateObj = hass.states[this._config.todo_entity];
      if (taskStateObj) {
        const taskSig = taskStateObj.last_changed + taskStateObj.state;
        if (taskSig !== this._lastTaskStateSig) {
          this._lastTaskStateSig = taskSig;
          this._fetchTaskItems();
        } else if (firstRun) {
          this._fetchTaskItems();
        }
      }
    }
  }

  // ── Data layer ──────────────────────────────────────────────────────
  async _fetchItems() {
    if (!this._hass) return;
    try {
      const res = await this._hass.connection.sendMessagePromise({
        type: 'todo/item/list',
        entity_id: this._config.entity
      });
      this._items = res.items || [];
      if (this._config.ai_features_enabled && this._config.ai_categorize) {
        this._categorizeMissingItems();
      }
      this._render();
    } catch (e) {
      console.error('tiger-todo-card: failed to load items', e);
      this._showToast("Couldn't load the list");
    }
  }

  // The Tasks list is deliberately plain — no AI categorization, no
  // restock tracking, no long-press lookup. It's a second, independent
  // checklist that happens to live in the same card.
  async _fetchTaskItems() {
    if (!this._hass || !this._config.todo_entity) return;
    try {
      const res = await this._hass.connection.sendMessagePromise({
        type: 'todo/item/list',
        entity_id: this._config.todo_entity
      });
      this._taskItems = res.items || [];
      if (this._tasksOnlyView) {
        this._categorizeMissingTasks();
      }
      this._render();
    } catch (e) {
      console.error('tiger-todo-card: failed to load tasks', e);
      this._showToast("Couldn't load the tasks list");
    }
  }

  async _addItem(text, isTask = false) {
    if (!text || !text.trim()) return;
    const clean = text.trim();
    const entityId = isTask ? this._config.todo_entity : this._config.entity;
    if (!entityId) return;

    if (!isTask && this._config.ai_features_enabled && this._config.ai_duplicate_check) {
      const dup = this._findSimilarItem(clean);
      if (dup) {
        this._pendingDuplicate = { text: clean, existing: dup };
        this._render();
        return;
      }
    }

    // Optimistic insert — shows the item instantly instead of waiting on
    // the round trip (service call -> HA pushes new state -> we re-fetch).
    // A real uid gets swapped in automatically the next time the list is
    // re-fetched (triggered by the entity's state changing), which
    // replaces the array wholesale.
    const tempUid = 'temp-' + Date.now();
    const prevItems = isTask ? this._taskItems : this._items;
    const nextItems = [...prevItems, { uid: tempUid, summary: clean, status: 'needs_action' }];
    if (isTask) this._taskItems = nextItems; else this._items = nextItems;
    this._render();

    try {
      await this._hass.callService('todo', 'add_item', {
        entity_id: entityId,
        item: clean
      });
    } catch (e) {
      console.error('tiger-todo-card: add_item failed', e);
      if (isTask) this._taskItems = prevItems; else this._items = prevItems;
      this._render();
      this._showToast("Couldn't add that item");
    }
  }

  async _toggleItem(item, isTask = false) {
    const entityId = isTask ? this._config.todo_entity : this._config.entity;
    const newStatus = item.status === 'completed' ? 'needs_action' : 'completed';
    if (!isTask && newStatus === 'completed') {
      this._logCompletion(item.summary);
    }

    // Optimistic update — flip it locally right away, reconcile in the background.
    const prevItems = isTask ? this._taskItems : this._items;
    const nextItems = prevItems.map(i => i.uid === item.uid ? { ...i, status: newStatus } : i);
    if (isTask) this._taskItems = nextItems; else this._items = nextItems;
    this._render();

    try {
      await this._hass.callService('todo', 'update_item', {
        entity_id: entityId,
        item: item.uid,
        status: newStatus
      });
    } catch (e) {
      console.error('tiger-todo-card: update_item failed', e);
      if (isTask) this._taskItems = prevItems; else this._items = prevItems;
      this._render();
      this._showToast("Couldn't update that item");
    }
  }

  async _removeItem(item, isTask = false) {
    const entityId = isTask ? this._config.todo_entity : this._config.entity;
    // Optimistic removal — same reasoning as _toggleItem.
    const prevItems = isTask ? this._taskItems : this._items;
    const nextItems = prevItems.filter(i => i.uid !== item.uid);
    if (isTask) this._taskItems = nextItems; else this._items = nextItems;
    this._render();

    try {
      await this._hass.callService('todo', 'remove_item', {
        entity_id: entityId,
        item: item.uid
      });
    } catch (e) {
      console.error('tiger-todo-card: remove_item failed', e);
      if (isTask) this._taskItems = prevItems; else this._items = prevItems;
      this._render();
      this._showToast("Couldn't delete that item");
    }
  }

  async _renameItem(item, newSummary, isTask = false) {
    const entityId = isTask ? this._config.todo_entity : this._config.entity;
    const prevItems = isTask ? this._taskItems : this._items;
    const nextItems = prevItems.map(i => i.uid === item.uid ? { ...i, summary: newSummary } : i);
    if (isTask) this._taskItems = nextItems; else this._items = nextItems;

    // A significant rename can put the item in a different AI category.
    // Rather than showing "Other" the instant the text changes, pin it to
    // its previous category until the new text has actually been
    // (re)categorized, then let it jump.
    const cache = isTask ? this._taskCategoryCache : this._categoryCache;
    const pinMap = isTask ? this._taskCategoryPinByUid : this._categoryPinByUid;
    const oldKey = item.summary.trim().toLowerCase();
    let oldCategory = null;
    if (this._aiEnabled()) {
      oldCategory = cache[oldKey];
      if (oldCategory) pinMap[item.uid] = oldCategory;
      delete cache[oldKey]; // stale — nothing else should still resolve to it
    }

    this._render();

    // Kick off recategorization for the new text right away, instead of
    // waiting for the next natural fetch cycle to notice the summary
    // changed — that's what actually clears the pin above.
    if (this._aiEnabled()) {
      const recategorize = isTask ? this._categorizeMissingTasks() : this._categorizeMissingItems();
      recategorize.then(() => this._clearCategoryPin(item.uid, isTask));
    }

    try {
      await this._hass.callService('todo', 'update_item', {
        entity_id: entityId,
        item: item.uid,
        rename: newSummary
      });
    } catch (e) {
      console.error('tiger-todo-card: rename failed', e);
      if (isTask) this._taskItems = prevItems; else this._items = prevItems;
      // Roll back the category bookkeeping too — a rename that didn't
      // actually go through shouldn't leave the item stuck under "Other".
      if (oldCategory) cache[oldKey] = oldCategory;
      this._clearCategoryPin(item.uid, isTask, /* silently, no extra render */ true);
      this._render();
      this._showToast("Couldn't rename that item");
    }
  }

  _clearCategoryPin(uid, isTask, skipRender = false) {
    const pinMap = isTask ? this._taskCategoryPinByUid : this._categoryPinByUid;
    if (pinMap[uid] === undefined) return;
    delete pinMap[uid];
    if (!skipRender) this._render();
  }

  // Tap-to-rename — swaps the row's text span for an input, in place, no
  // full re-render while typing (same reasoning as the expand/collapse
  // toggles: tearing down the DOM mid-edit would lose focus and the
  // keyboard). Enter or tapping away both commit; Escape cancels.
  _beginRename(row, span) {
    const isTask = row.dataset.source === 'task';
    const uid = row.dataset.uid;
    const item = (isTask ? this._taskItems : this._items).find(i => i.uid === uid);
    if (!item) return;

    row.classList.add('editing');
    const original = item.summary;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'item-rename-input';
    input.value = original;
    span.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      row.classList.remove('editing');
      const newVal = input.value.trim();
      if (!newVal || newVal === original) { this._render(); return; }
      this._renameItem(item, newVal, isTask);
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      row.classList.remove('editing');
      this._render();
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('click', e => e.stopPropagation());
  }

  async _clearCompleted(isTask = false) {
    const entityId = isTask ? this._config.todo_entity : this._config.entity;
    const prevItems = isTask ? this._taskItems : this._items;
    const nextItems = prevItems.filter(i => i.status !== 'completed');
    if (isTask) this._taskItems = nextItems; else this._items = nextItems;
    this._render();

    try {
      await this._hass.callService('todo', 'remove_completed_items', {
        entity_id: entityId
      });
    } catch (e) {
      // Fallback for backends without the bulk service
      try {
        const completed = prevItems.filter(i => i.status === 'completed');
        for (const item of completed) {
          await this._hass.callService('todo', 'remove_item', { entity_id: entityId, item: item.uid });
        }
      } catch (e2) {
        console.error('tiger-todo-card: clear completed failed', e2);
        if (isTask) this._taskItems = prevItems; else this._items = prevItems;
        this._render();
        this._showToast("Couldn't clear completed items");
      }
    }
  }

  // Crowai-style toast — catches service/WS failures ourselves instead of
  // letting Home Assistant's default (much more technical) error banner show.
  _showToast(message, duration = 3500) {
    const toast = this.shadowRoot?.getElementById('tigerToast');
    const textEl = this.shadowRoot?.getElementById('tigerToastText');
    if (!toast || !textEl) return;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    textEl.textContent = message;
    toast.classList.add('visible');
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('visible');
      this._toastTimer = null;
    }, duration);
  }

  // ── Persistence (tier-1 localStorage, tier-2 frontend/set_user_data) ─
  async _loadUserData() {
    try {
      const raw = localStorage.getItem('tiger_categories_' + this._config.entity);
      if (raw) this._categoryCache = JSON.parse(raw);
    } catch (_) {}
    if (this._config.todo_entity) {
      try {
        const raw = localStorage.getItem('tiger_task_categories_' + this._config.todo_entity);
        if (raw) this._taskCategoryCache = JSON.parse(raw);
      } catch (_) {}
    }
    try {
      const raw = localStorage.getItem('tiger_completion_log_' + this._config.entity);
      if (raw) this._completionLog = JSON.parse(raw);
    } catch (_) {}
    try {
      const raw = localStorage.getItem('tiger_food_info_' + this._config.entity);
      if (raw) this._foodInfoCache = JSON.parse(raw);
    } catch (_) {}
    if (this._config.todo_entity) {
      try {
        const raw = localStorage.getItem('tiger_task_info_' + this._config.todo_entity);
        if (raw) this._taskInfoCache = JSON.parse(raw);
      } catch (_) {}
    }
    try {
      const raw = localStorage.getItem('tiger_dismissed_restock_' + this._config.entity);
      if (raw) this._dismissedRestock = JSON.parse(raw);
    } catch (_) {}
    try {
      const raw = localStorage.getItem('tiger_sort_by_category_' + this._config.entity);
      if (raw !== null) this._sortByCategory = JSON.parse(raw);
    } catch (_) {}
    try {
      const raw = localStorage.getItem('tiger_collapsed_' + this._config.entity);
      if (raw !== null) this._collapsed = JSON.parse(raw);
    } catch (_) {}
    try {
      const raw = localStorage.getItem('tiger_compact_mode_' + this._config.entity);
      if (raw !== null) this._compactMode = JSON.parse(raw);
    } catch (_) {}
    try {
      const raw = localStorage.getItem('tiger_show_tasks_' + this._config.entity);
      if (raw !== null) this._showTasks = JSON.parse(raw);
    } catch (_) {}
    let tasksOnlyLocallySet = false;
    if (this._config.todo_entity) {
      try {
        const raw = localStorage.getItem('tiger_tasks_only_view_' + this._config.todo_entity);
        if (raw !== null) { this._tasksOnlyView = JSON.parse(raw); tasksOnlyLocallySet = true; }
      } catch (_) {}
    }

    if (this._config.persistent_storage && this._hass) {
      try {
        const conn = this._hass.connection;
        const [catRes, logRes, dismissRes, sortRes, tasksVisRes, taskCatRes, tasksOnlyRes, taskInfoRes] = await Promise.all([
          conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_categories' }),
          conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_completion_log' }),
          conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_dismissed_restock' }),
          conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_sort_by_category' }),
          conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_show_tasks' }),
          conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_task_categories' }),
          conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_tasks_only_view' }),
          conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_task_info' })
        ]);
        if (catRes?.value?.[this._config.entity]) {
          this._categoryCache = { ...catRes.value[this._config.entity], ...this._categoryCache };
        }
        if (logRes?.value?.[this._config.entity]) {
          this._completionLog = { ...logRes.value[this._config.entity], ...this._completionLog };
        }
        if (dismissRes?.value?.[this._config.entity]) {
          this._dismissedRestock = { ...dismissRes.value[this._config.entity], ...this._dismissedRestock };
        }
        // Local value (if the user already toggled it on this device) wins
        // over the synced one, same tie-break as the caches above.
        if (this._sortByCategory === null && sortRes?.value?.[this._config.entity] !== undefined) {
          this._sortByCategory = sortRes.value[this._config.entity];
        }
        if (this._showTasks === null && tasksVisRes?.value?.[this._config.entity] !== undefined) {
          this._showTasks = tasksVisRes.value[this._config.entity];
        }
        if (this._config.todo_entity && taskCatRes?.value?.[this._config.todo_entity]) {
          this._taskCategoryCache = { ...taskCatRes.value[this._config.todo_entity], ...this._taskCategoryCache };
        }
        if (!tasksOnlyLocallySet && this._config.todo_entity && tasksOnlyRes?.value?.[this._config.todo_entity] !== undefined) {
          this._tasksOnlyView = tasksOnlyRes.value[this._config.todo_entity];
        }
        if (this._config.todo_entity && taskInfoRes?.value?.[this._config.todo_entity]) {
          this._taskInfoCache = { ...taskInfoRes.value[this._config.todo_entity], ...this._taskInfoCache };
        }
      } catch (_) {}
    }
    this._userDataLoaded = true;
  }

  _saveCategoryCache() {
    try {
      localStorage.setItem('tiger_categories_' + this._config.entity, JSON.stringify(this._categoryCache));
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      const conn = this._hass.connection;
      conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_categories' })
        .then(res => {
          const full = res?.value || {};
          full[this._config.entity] = this._categoryCache;
          conn.sendMessagePromise({ type: 'frontend/set_user_data', key: 'tiger_categories', value: full }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  _saveTaskCategoryCache() {
    if (!this._config.todo_entity) return;
    try {
      localStorage.setItem('tiger_task_categories_' + this._config.todo_entity, JSON.stringify(this._taskCategoryCache));
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      const conn = this._hass.connection;
      conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_task_categories' })
        .then(res => {
          const full = res?.value || {};
          full[this._config.todo_entity] = this._taskCategoryCache;
          conn.sendMessagePromise({ type: 'frontend/set_user_data', key: 'tiger_task_categories', value: full }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  _saveFoodInfoCache() {
    try {
      localStorage.setItem('tiger_food_info_' + this._config.entity, JSON.stringify(this._foodInfoCache));
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      const conn = this._hass.connection;
      conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_food_info' })
        .then(res => {
          const full = res?.value || {};
          full[this._config.entity] = this._foodInfoCache;
          conn.sendMessagePromise({ type: 'frontend/set_user_data', key: 'tiger_food_info', value: full }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  _saveTaskInfoCache() {
    if (!this._config.todo_entity) return;
    try {
      localStorage.setItem('tiger_task_info_' + this._config.todo_entity, JSON.stringify(this._taskInfoCache));
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      const conn = this._hass.connection;
      conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_task_info' })
        .then(res => {
          const full = res?.value || {};
          full[this._config.todo_entity] = this._taskInfoCache;
          conn.sendMessagePromise({ type: 'frontend/set_user_data', key: 'tiger_task_info', value: full }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  _saveDismissedRestock() {
    try {
      localStorage.setItem('tiger_dismissed_restock_' + this._config.entity, JSON.stringify(this._dismissedRestock));
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      const conn = this._hass.connection;
      conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_dismissed_restock' })
        .then(res => {
          const full = res?.value || {};
          full[this._config.entity] = this._dismissedRestock;
          conn.sendMessagePromise({ type: 'frontend/set_user_data', key: 'tiger_dismissed_restock', value: full }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  _saveSortPreference() {
    try {
      localStorage.setItem('tiger_sort_by_category_' + this._config.entity, JSON.stringify(this._sortByCategory));
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      const conn = this._hass.connection;
      conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_sort_by_category' })
        .then(res => {
          const full = res?.value || {};
          full[this._config.entity] = this._sortByCategory;
          conn.sendMessagePromise({ type: 'frontend/set_user_data', key: 'tiger_sort_by_category', value: full }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  // Local-storage only, deliberately not synced to the HA account the way
  // the other preferences above are — a collapsed/expanded state is low-
  // stakes enough (one tap to redo on a new device) that it isn't worth
  // touching the persistent_storage Promise.all block's careful positional
  // result-array for.
  _saveCollapsedPreference() {
    try {
      localStorage.setItem('tiger_collapsed_' + this._config.entity, JSON.stringify(this._collapsed));
    } catch (_) {}
  }

  // Same local-storage-only scoping as collapsed state, same reasoning.
  _saveCompactModePreference() {
    try {
      localStorage.setItem('tiger_compact_mode_' + this._config.entity, JSON.stringify(this._compactMode));
    } catch (_) {}
  }

  _saveTasksVisibilityPreference() {
    try {
      localStorage.setItem('tiger_show_tasks_' + this._config.entity, JSON.stringify(this._showTasks));
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      const conn = this._hass.connection;
      conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_show_tasks' })
        .then(res => {
          const full = res?.value || {};
          full[this._config.entity] = this._showTasks;
          conn.sendMessagePromise({ type: 'frontend/set_user_data', key: 'tiger_show_tasks', value: full }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  _saveTasksOnlyViewPreference() {
    if (!this._config.todo_entity) return;
    try {
      localStorage.setItem('tiger_tasks_only_view_' + this._config.todo_entity, JSON.stringify(this._tasksOnlyView));
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      const conn = this._hass.connection;
      conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_tasks_only_view' })
        .then(res => {
          const full = res?.value || {};
          full[this._config.todo_entity] = this._tasksOnlyView;
          conn.sendMessagePromise({ type: 'frontend/set_user_data', key: 'tiger_tasks_only_view', value: full }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  _logCompletion(text) {
    const key = text.trim().toLowerCase();
    const log = this._completionLog[key] || [];
    log.push(Date.now());
    this._completionLog[key] = log.slice(-10);
    try {
      localStorage.setItem('tiger_completion_log_' + this._config.entity, JSON.stringify(this._completionLog));
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      const conn = this._hass.connection;
      conn.sendMessagePromise({ type: 'frontend/get_user_data', key: 'tiger_completion_log' })
        .then(res => {
          const full = res?.value || {};
          full[this._config.entity] = this._completionLog;
          conn.sendMessagePromise({ type: 'frontend/set_user_data', key: 'tiger_completion_log', value: full }).catch(() => {});
        })
        .catch(() => {});
    }
  }

  // ── AI features (opt-in, routed through conversation/process) ───────
  _aiEnabled() {
    return this._config?.ai_features_enabled === true && !!this._config?.ai_conversation_agent;
  }

  async _aiAsk(prompt) {
    if (!this._aiEnabled() || !this._hass) return null;
    try {
      const res = await this._hass.connection.sendMessagePromise({
        type: 'conversation/process',
        text: prompt,
        agent_id: this._config.ai_conversation_agent,
        language: navigator.language || 'en'
      });
      return res?.response?.speech?.plain?.speech || null;
    } catch (e) {
      console.error('tiger-todo-card: AI call failed', e);
      return null;
    }
  }

  // Aisle/category grouping for items not yet in the cache.
  async _categorizeMissingItems() {
    if (!this._aiEnabled()) return;
    const active = this._items.filter(i => i.status !== 'completed');
    const missing = active.filter(i => !this._categoryCache[i.summary.trim().toLowerCase()]);
    if (missing.length === 0) return;
    const list = missing.map(i => i.summary).join('; ');
    const prompt = `Assign a short grocery store aisle/category (e.g. Produce, Dairy, Bakery, Meat, Frozen, Pantry, Household, Other) to each item below. Reply with ONLY lines in the exact format "item: category", one per line, same order, no extra text. Items: ${list}`;
    const reply = await this._aiAsk(prompt);
    if (!reply) return;
    reply.split('\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const name = line.slice(0, idx).trim().toLowerCase();
      const cat = line.slice(idx + 1).trim();
      if (name && cat) this._categoryCache[name] = cat;
    });
    this._saveCategoryCache();
    this._render();
  }

  // Same idea as _categorizeMissingItems, but for the Tasks list — general
  // task categories instead of grocery aisles. Only runs when "View Tasks
  // Only (AI Sorted)" is switched on, so it's never a surprise AI call for
  // people who just want a plain checklist.
  async _categorizeMissingTasks() {
    if (!this._aiEnabled()) return;
    const active = this._taskItems.filter(i => i.status !== 'completed');
    const missing = active.filter(i => !this._taskCategoryCache[i.summary.trim().toLowerCase()]);
    if (missing.length === 0) return;
    const list = missing.map(i => i.summary).join('; ');
    const prompt = `Assign a short task category (e.g. Errand, Home, Work, Calls, Health, Admin, Family, Other) to each task below. Reply with ONLY lines in the exact format "task: category", one per line, same order, no extra text. Tasks: ${list}`;
    const reply = await this._aiAsk(prompt);
    if (!reply) return;
    reply.split('\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const name = line.slice(0, idx).trim().toLowerCase();
      const cat = line.slice(idx + 1).trim();
      if (name && cat) this._taskCategoryCache[name] = cat;
    });
    this._saveTaskCategoryCache();
    this._render();
  }

  _groupTasks(items, force = false) {
    if ((!force && !this._tasksOnlyView) || !this._aiEnabled()) return { __none__: items };
    const groups = {};
    for (const item of items) {
      const cat = this._taskCategoryPinByUid[item.uid] || this._taskCategoryCache[item.summary.trim().toLowerCase()] || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }

  // ── Item Lookup (long-press) ─────────────────────────────────────────
  // Fetches general reference info for any item name on the list — works
  // for food (carbs, GI, calories, dietary tags, ingredients for dishes)
  // as well as non-food products (category, pack size, storage tip) —
  // plus a fun fact and a note on variability either way.
  async _fetchFoodInfo(name) {
    const key = name.trim().toLowerCase();
    const cached = this._foodInfoCache[key];
    // Schema bump: entries cached before brand-aware lookup (and before that,
    // before generic_search_term was tightened to a short canonical noun)
    // still hold shapes that older code can't render correctly — e.g. no
    // generic_fallback for the toggle, or a stale long search phrase.
    // Force those to refetch once rather than silently keeping the old value.
    if (cached && cached._lookupSchema === 3) return cached;
    if (!this._aiEnabled()) return cached || null;

    const prompt = `You are a general shopping-list reference tool, like a store label lookup. For the item "${name.trim()}", first check: does the text name a specific brand, manufacturer, retailer, or product line (e.g. "Cathedral City", "Trader Joe's", "Quaker")? If yes, and you have reliable knowledge of that specific product's real nutrition and ingredients, set "brand_specific" to true and give data for that exact product. If no brand is present, or you don't have reliable knowledge of that specific product, set "brand_specific" to false and give a generic estimate for the type of item instead — never guess at brand-specific numbers you don't actually know. Return ONLY a JSON object (no markdown, no commentary) with these fields: {"name":"...", "brand_specific":true|false, "generic_name":"...", "category":"...", "generic_search_term":"...", "is_food":true|false, "typical_serving":"..."_or_null, "approx_carbs_g":number_or_null, "gi_category":"low"|"medium"|"high"|"unknown"_or_null, "calories_kcal":number_or_null, "dietary_tags":["..."]_or_empty_array, "storage_tip":"...", "shelf_life":"..."_or_null, "fun_fact":"...", "note":"...", "ingredients":["...","..."]_or_null, "generic_fallback":{...}_or_null}. "name" is the item's real name — keep the brand in it if the user gave one. "generic_name" is the general type of thing with any brand/product name and descriptive filler stripped — 1 to 3 words, matching what its Wikipedia article would be titled (e.g. "Lasagna" not "Cathedral City Cheesy Lasagna", "Potato" not "potatoes for cooking", "Toilet paper" not a specific brand, "AA battery", "Eye drop"). "generic_search_term" is that same short canonical noun, used only for an image search — always brand-stripped, even when brand_specific is true, since a specific product photo lookup is unreliable. "category" is a short shopping aisle/category label (e.g. Produce, Dairy, Household, Frozen, Bakery). If "is_food" is false, leave approx_carbs_g, gi_category, calories_kcal, dietary_tags and ingredients null/empty, and focus on category and storage_tip instead. If is_food is true, "typical_serving" MUST be filled with a short, concrete, human-readable serving description (e.g. "1 pie", "100g", "2 slices", "1 medium apple") — never leave it null for food. "approx_carbs_g" and "calories_kcal" MUST both be for that exact typical_serving amount, not per 100g and not for the whole pack, unless typical_serving itself describes the whole pack. If you don't recognise the specific item, still give your best general estimate for a typical serving of that type of food rather than leaving the numbers null, and set gi_category to "unknown" only if you genuinely have no basis for a guess. Only fill "ingredients" (4-8 common ingredients, general/typical rather than a precise recipe) when the item is an actual cooked dish or recipe — for simple foods that need no preparation (a piece of fruit, a can of soda, etc.) leave it null. dietary_tags should be short (e.g. "vegetarian", "vegan", "gluten-free", "dairy-free", "contains nuts") and only included when clearly applicable. "note" is one short sentence: if brand_specific is true, flag that this is your best knowledge of that specific product and it can vary by recipe changes or region; if false, note that this is a generic estimate not specific to any brand. If, and only if, brand_specific is true, ALSO fill "generic_fallback" with a second, complete set of generic (non-brand) estimates for the same underlying type of food, using this exact shape so the user can switch to it: {"typical_serving":"..."_or_null,"approx_carbs_g":number_or_null,"gi_category":"low"|"medium"|"high"|"unknown"_or_null,"calories_kcal":number_or_null,"dietary_tags":["..."]_or_empty_array,"storage_tip":"...","shelf_life":"..."_or_null,"ingredients":["...","..."]_or_null} — same rules as above but generic instead of brand-specific. If brand_specific is false, set "generic_fallback" to null.`;

    const reply = await this._aiAsk(prompt);
    if (!reply) return cached || null;
    try {
      const clean = reply.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
      const result = JSON.parse(clean);
      result._lookupSchema = 3;
      this._foodInfoCache[key] = result;
      this._saveFoodInfoCache();
      return result;
    } catch (e) {
      console.error('tiger-todo-card: item info parse failed', e, reply);
      return cached || null;
    }
  }

  // Lazy-loaded, separate from the main lookup so opening the popup stays
  // fast — these only fire the first time the person expands that section,
  // then get cached alongside the rest of that item's info.
  async _fetchServingSuggestions(name, category) {
    const key = name.trim().toLowerCase();
    const cached = this._foodInfoCache[key];
    if (cached?.serving_suggestions) return cached.serving_suggestions;
    if (!this._aiEnabled()) return null;

    const prompt = `For the food item "${name.trim()}"${category ? ` (category: ${category})` : ''}, suggest 3-4 short, appetizing ways to serve or pair it — sides, sauces, or occasions. Return ONLY a JSON array of short strings (no markdown, no commentary, no numbering), each under 12 words, e.g. ["...", "...", "..."].`;
    const reply = await this._aiAsk(prompt);
    if (!reply) return null;
    try {
      const clean = reply.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
      const result = JSON.parse(clean);
      if (!Array.isArray(result)) return null;
      this._foodInfoCache[key] = { ...(this._foodInfoCache[key] || {}), serving_suggestions: result };
      this._saveFoodInfoCache();
      return result;
    } catch (e) {
      console.error('tiger-todo-card: serving suggestions parse failed', e, reply);
      return null;
    }
  }

  async _fetchCookingSuggestions(name, category) {
    const key = name.trim().toLowerCase();
    const cached = this._foodInfoCache[key];
    if (cached?.cooking_suggestions) return cached.cooking_suggestions;
    if (!this._aiEnabled()) return null;

    const prompt = `For the food item "${name.trim()}"${category ? ` (category: ${category})` : ''}, suggest 3-4 short tips or variations for preparing it beyond the basic method — seasoning ideas, flavor pairings, or ways to elevate it. Return ONLY a JSON array of short strings (no markdown, no commentary, no numbering), each under 14 words, e.g. ["...", "...", "..."].`;
    const reply = await this._aiAsk(prompt);
    if (!reply) return null;
    try {
      const clean = reply.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
      const result = JSON.parse(clean);
      if (!Array.isArray(result)) return null;
      this._foodInfoCache[key] = { ...(this._foodInfoCache[key] || {}), cooking_suggestions: result };
      this._saveFoodInfoCache();
      return result;
    } catch (e) {
      console.error('tiger-todo-card: cooking suggestions parse failed', e, reply);
      return null;
    }
  }

  // ── Task Info (long-press on a Tasks-list row) ───────────────────────
  // Deliberately no photo lookup here — tasks are actions, not products,
  // so a generic image search would just risk the same wrong-picture
  // problem groceries had. A category emoji covers it instead.
  async _fetchTaskInfo(name) {
    const key = name.trim().toLowerCase();
    const cached = this._taskInfoCache[key];
    if (cached && cached._lookupSchema === 1) return cached;
    if (!this._aiEnabled()) return cached || null;

    const prompt = `You are a general task-planning reference. For the task "${name.trim()}", return ONLY a JSON object (no markdown, no commentary) with fields: {"name":"...", "category":"...", "estimated_time":"...", "tools_needed":["..."]_or_empty_array, "best_time":"...", "note":"..."}. "category" is a short task category (e.g. Home, Errand, Work, Calls, Health, Admin, Family, Other). "estimated_time" is a short, general estimate of how long this typically takes (e.g. "~15 minutes", "30-45 min", "1-2 hours") — your best general guess even for an unfamiliar task. "tools_needed" lists a few common tools or supplies typically needed (e.g. "vacuum cleaner", "extension cord") — an empty array if the task genuinely needs nothing. "best_time" is a short practical suggestion for when to do it (e.g. "Morning", "Weekday business hours", "Anytime"). "note" is one short sentence flagging anything that varies (e.g. by house size, by provider) — keep it brief.`;
    const reply = await this._aiAsk(prompt);
    if (!reply) return cached || null;
    try {
      const clean = reply.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
      const result = JSON.parse(clean);
      result._lookupSchema = 1;
      this._taskInfoCache[key] = result;
      this._saveTaskInfoCache();
      return result;
    } catch (e) {
      console.error('tiger-todo-card: task info parse failed', e, reply);
      return cached || null;
    }
  }

  async _fetchTaskTips(name, category) {
    const key = name.trim().toLowerCase();
    const cached = this._taskInfoCache[key];
    if (cached?.how_to_tips) return cached.how_to_tips;
    if (!this._aiEnabled()) return null;

    const prompt = `For the task "${name.trim()}"${category ? ` (category: ${category})` : ''}, give 3-4 short, practical tips for doing it well or more efficiently. Return ONLY a JSON array of short strings (no markdown, no commentary, no numbering), each under 14 words, e.g. ["...", "...", "..."].`;
    const reply = await this._aiAsk(prompt);
    if (!reply) return null;
    try {
      const clean = reply.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
      const result = JSON.parse(clean);
      if (!Array.isArray(result)) return null;
      this._taskInfoCache[key] = { ...(this._taskInfoCache[key] || {}), how_to_tips: result };
      this._saveTaskInfoCache();
      return result;
    } catch (e) {
      console.error('tiger-todo-card: task tips parse failed', e, reply);
      return null;
    }
  }

  async _fetchRelatedTasks(name, category) {
    const key = name.trim().toLowerCase();
    const cached = this._taskInfoCache[key];
    if (cached?.related_tasks) return cached.related_tasks;
    if (!this._aiEnabled()) return null;

    const prompt = `For the task "${name.trim()}"${category ? ` (category: ${category})` : ''}, suggest 3-4 short, related or follow-up tasks worth doing around the same time (e.g. adjacent chores, natural next steps). Return ONLY a JSON array of short strings (no markdown, no commentary, no numbering), each under 12 words, e.g. ["...", "...", "..."].`;
    const reply = await this._aiAsk(prompt);
    if (!reply) return null;
    try {
      const clean = reply.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
      const result = JSON.parse(clean);
      if (!Array.isArray(result)) return null;
      this._taskInfoCache[key] = { ...(this._taskInfoCache[key] || {}), related_tasks: result };
      this._saveTaskInfoCache();
      return result;
    } catch (e) {
      console.error('tiger-todo-card: related tasks parse failed', e, reply);
      return null;
    }
  }

  _giColor(cat) {
    return cat === 'low' ? '#34C759' : cat === 'high' ? '#FF9500' : cat === 'medium' ? '#FFD60A' : this._ta(0.4);
  }

  // Thumbnail via Wikipedia's own article images (not raw Commons media
  // search). Wikipedia's search ranking resolves a short noun query to the
  // single best-matching article, and "pageimages" returns that article's
  // curated lead/infobox image — the photo editors chose to represent that
  // exact topic. This is far more reliable than searching Commons' full
  // media library directly, which is full of coincidental title matches
  // (e.g. "potato" is also a real place name, so raw Commons search can
  // return an unrelated street photo just because the word appears in it).
  async _fetchThumbnail(query) {
    const key = query.trim().toLowerCase();
    if (!this._thumbnailCache) this._thumbnailCache = {};
    if (key in this._thumbnailCache) return this._thumbnailCache[key];
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1&gsrnamespace=0&prop=pageimages&piprop=thumbnail|original&pithumbsize=300&format=json&origin=*`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('bad response: ' + res.status);
      const data = await res.json();
      const pages = data?.query?.pages;
      let result = null;
      if (pages) {
        const page = Object.values(pages)[0];
        const thumb = page?.thumbnail?.source;
        if (thumb) result = { thumb, full: page?.original?.source || thumb };
      }
      this._thumbnailCache[key] = result;
      return result;
    } catch (e) {
      console.error('tiger-todo-card: thumbnail fetch failed', e);
      this._thumbnailCache[key] = null;
      return null;
    }
  }

  _categoryEmoji(category) {
    const c = (category || '').toLowerCase();
    if (c.includes('produce') || c.includes('fruit') || c.includes('veg')) return '🥦';
    if (c.includes('dairy')) return '🥛';
    if (c.includes('frozen')) return '🧊';
    if (c.includes('bak')) return '🍞';
    if (c.includes('meat') || c.includes('fish') || c.includes('deli')) return '🥩';
    if (c.includes('household') || c.includes('clean')) return '🧴';
    if (c.includes('drink') || c.includes('beverage')) return '🥤';
    if (c.includes('pantry') || c.includes('tin') || c.includes('can')) return '🥫';
    return '🛒';
  }

  _taskCategoryEmoji(category) {
    const c = (category || '').toLowerCase();
    if (c.includes('home') || c.includes('chore') || c.includes('clean')) return '🏠';
    if (c.includes('errand')) return '🚗';
    if (c.includes('work')) return '💼';
    if (c.includes('call') || c.includes('phone')) return '📞';
    if (c.includes('health') || c.includes('medical') || c.includes('appointment')) return '🩺';
    if (c.includes('admin') || c.includes('finance') || c.includes('bill') || c.includes('paperwork')) return '📄';
    if (c.includes('family') || c.includes('kid') || c.includes('child')) return '👨‍👩‍👧';
    if (c.includes('shop')) return '🛍️';
    return '✅';
  }

  _showImageLightbox(imgSrc, caption) {
    if (!imgSrc) return;
    document.getElementById('tiger-image-lightbox')?.remove();
    const t = this._theme();

    const backdrop = document.createElement('div');
    backdrop.id = 'tiger-image-lightbox';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';

    const card = document.createElement('div');
    card.style.cssText = `background:${t.cardBg};border-radius:20px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:360px;width:100%;box-sizing:border-box;box-shadow:0 20px 60px rgba(0,0,0,${t.dark ? '0.6' : '0.25'});`;

    const closeRow = document.createElement('div');
    closeRow.style.cssText = 'display:flex;justify-content:flex-end;width:100%;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `width:28px;height:28px;border-radius:50%;border:none;background:${this._ta(0.12)};color:${t.text};font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;flex-shrink:0;`;
    closeBtn.addEventListener('click', e => { e.stopPropagation(); backdrop.remove(); });
    closeRow.appendChild(closeBtn);

    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = caption || '';
    img.style.cssText = `width:100%;max-width:280px;aspect-ratio:1/1;height:auto;border-radius:14px;object-fit:cover;background:${this._ta(0.05)};`;

    card.appendChild(closeRow);
    card.appendChild(img);
    if (caption) {
      const label = document.createElement('div');
      label.textContent = caption;
      label.style.cssText = `font-size:14px;font-weight:600;color:${t.text};text-align:center;`;
      card.appendChild(label);
    }

    backdrop.appendChild(card);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  // ── PDF Export ────────────────────────────────────────────────────────
  // Lazily loads jsPDF from a CDN the first time it's needed — there's no
  // bundler here, so this is the standard way a single-file custom card
  // pulls in a library it doesn't need on every load. Cached as a promise
  // so a second export doesn't reload it.
  _ensureJsPDF() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (this._jsPDFLoadPromise) return this._jsPDFLoadPromise;
    this._jsPDFLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = () => {
        if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error('jsPDF failed to initialise'));
      };
      script.onerror = () => { this._jsPDFLoadPromise = null; reject(new Error('Could not load PDF library — check your internet connection')); };
      document.head.appendChild(script);
    });
    return this._jsPDFLoadPromise;
  }

  _closePdfPopup() {
    if (this._pdfPopupOverlay) {
      this._pdfPopupOverlay.remove();
      this._pdfPopupOverlay = null;
    }
  }

  // Shows a finished jsPDF document in a popup before committing to a
  // download — a blob URL in an iframe for an actual rendered preview; if
  // the surrounding WebView won't render PDFs inline (a known restriction
  // in some embedded WebViews), the iframe just shows blank — the
  // Download button below it works regardless.
  _showPdfPreview(doc, filename) {
    this._closePdfPopup();
    const accent = this._config.accent_color || '#007AFF';
    const blobUrl = doc.output('bloburl');
    const t = this._theme();

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10040;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';

    const popup = document.createElement('div');
    popup.style.cssText = `background:${t.dark ? 'rgba(24,24,28,0.96)' : 'rgba(255,255,255,0.97)'};border:1px solid ${this._ta(0.15)};border-radius:24px;box-shadow:0 24px 64px ${t.dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.18)'};padding:20px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;color:${t.text};box-sizing:border-box;`;
    popup.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
    headerRow.innerHTML = `
      <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${this._ta(0.45)};">PDF Preview</span>
      <button class="tiger-pdf-close" style="background:${this._ta(0.1)};border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:${this._ta(0.65)};font-size:15px;line-height:1;padding:0;flex-shrink:0;">✕</button>`;
    headerRow.querySelector('.tiger-pdf-close').addEventListener('click', () => this._closePdfPopup());

    // The frame itself stays a fixed white "page" regardless of theme —
    // that's genuinely what the PDF looks like, and a dark-mode-tinted
    // preview area would misrepresent the actual downloaded document.
    const frameWrap = document.createElement('div');
    frameWrap.style.cssText = `width:100%;height:58vh;min-height:320px;border-radius:12px;overflow:hidden;background:#fff;margin-bottom:12px;border:1px solid ${this._ta(0.12)};`;
    const iframe = document.createElement('iframe');
    iframe.src = blobUrl;
    iframe.title = 'PDF preview';
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    frameWrap.appendChild(iframe);

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '⬇ Download';
    downloadBtn.style.cssText = `width:100%;padding:12px;border-radius:12px;border:none;background:${accent};color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;`;
    downloadBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      downloadBtn.textContent = '✓ Downloaded';
      setTimeout(() => { downloadBtn.textContent = '⬇ Download'; }, 1500);
    });

    popup.appendChild(headerRow);
    popup.appendChild(frameWrap);
    popup.appendChild(downloadBtn);
    overlay.appendChild(popup);
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closePdfPopup(); });
    document.body.appendChild(overlay);
    this._pdfPopupOverlay = overlay;

    // Revoke the blob once this popup is actually gone, however it closed.
    const observer = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        URL.revokeObjectURL(blobUrl);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  }

  // Builds a simple, clean PDF of the current shopping list — grouped by
  // category if "Sort by Category" is on, flat otherwise. Active items
  // only (nothing already checked off).
  async _exportShoppingListPdf() {
    this._showToast('Preparing PDF…');
    let JsPDFCtor;
    try {
      JsPDFCtor = await this._ensureJsPDF();
    } catch (e) {
      console.error('tiger-todo-card: jsPDF load failed', e);
      this._showToast("Couldn't load the PDF library — check your connection");
      return;
    }

    const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
    const marginX = 40;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 56;

    const accentRgb = this._hexToRgb(this._config.accent_color || '#007AFF');
    const setAccent = () => doc.setTextColor(accentRgb.r, accentRgb.g, accentRgb.b);
    const setInk = () => doc.setTextColor(20, 20, 20);
    const setMuted = () => doc.setTextColor(130, 130, 130);

    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    setInk();
    doc.text(this._config.title || 'Shopping List', marginX, y);
    y += 20;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    setMuted();
    const active = this._items.filter(i => i.status !== 'completed');
    doc.text(`Generated ${new Date().toLocaleString('en-GB')}  ·  ${active.length} item${active.length === 1 ? '' : 's'}`, marginX, y);
    y += 24;

    const ensureSpace = needed => {
      if (y + needed > pageHeight - 40) {
        doc.addPage();
        y = 50;
      }
    };

    const drawItem = name => {
      ensureSpace(22);
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(1);
      doc.rect(marginX, y - 10, 12, 12); // empty checkbox
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      setInk();
      doc.text(name, marginX + 20, y);
      y += 22;
    };

    const grouped = this._groupItems(active);
    const groupKeys = Object.keys(grouped);
    if (groupKeys.length === 1 && groupKeys[0] === '__none__') {
      active.forEach(item => drawItem(item.summary));
    } else {
      for (const [category, items] of Object.entries(grouped)) {
        ensureSpace(26);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        setAccent();
        doc.text(category.toUpperCase(), marginX, y);
        y += 6;
        doc.setDrawColor(accentRgb.r, accentRgb.g, accentRgb.b);
        doc.setLineWidth(0.75);
        doc.line(marginX, y, pageWidth - marginX, y);
        y += 16;
        items.forEach(item => drawItem(item.summary));
        y += 6;
      }
    }

    if (!active.length) {
      doc.setFontSize(11);
      setMuted();
      doc.text('Nothing on the list right now.', marginX, y);
    }

    const filename = `${(this._config.title || 'shopping-list').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    this._showPdfPreview(doc, filename);
  }

  // Separate, simpler export for the Tasks list — plain checklist, no
  // category grouping (tasks aren't shopping items), its own filename.
  async _exportTasksPdf() {
    if (!this._config.todo_entity) return;
    this._showToast('Preparing PDF…');
    let JsPDFCtor;
    try {
      JsPDFCtor = await this._ensureJsPDF();
    } catch (e) {
      console.error('tiger-todo-card: jsPDF load failed', e);
      this._showToast("Couldn't load the PDF library — check your connection");
      return;
    }

    // Categorize first so the export can group by category even if the
    // person has never turned on "Tasks Only View" to trigger this before.
    if (this._aiEnabled()) {
      await this._categorizeMissingTasks();
    }

    const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
    const marginX = 40;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 56;

    const accentRgb = this._hexToRgb(this._config.accent_color || '#007AFF');
    const setAccent = () => doc.setTextColor(accentRgb.r, accentRgb.g, accentRgb.b);
    const setInk = () => doc.setTextColor(20, 20, 20);
    const setMuted = () => doc.setTextColor(130, 130, 130);

    const taskEntityName = this._hass?.states?.[this._config.todo_entity]?.attributes?.friendly_name || 'Tasks';

    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    setInk();
    doc.text(taskEntityName, marginX, y);
    y += 20;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    setMuted();
    const active = this._taskItems.filter(i => i.status !== 'completed');
    doc.text(`Generated ${new Date().toLocaleString('en-GB')}  ·  ${active.length} task${active.length === 1 ? '' : 's'}`, marginX, y);
    y += 24;

    const ensureSpace = needed => {
      if (y + needed > pageHeight - 40) {
        doc.addPage();
        y = 50;
      }
    };

    const drawItem = name => {
      ensureSpace(22);
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(1);
      doc.rect(marginX, y - 10, 12, 12); // empty checkbox
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      setInk();
      doc.text(name, marginX + 20, y);
      y += 22;
    };

    if (!active.length) {
      doc.setFontSize(11);
      setMuted();
      doc.text('Nothing on the list right now.', marginX, y);
    } else {
      const grouped = this._groupTasks(active, true); // force: group whenever category data is available
      const groupKeys = Object.keys(grouped);
      if (groupKeys.length === 1 && groupKeys[0] === '__none__') {
        active.forEach(item => drawItem(item.summary));
      } else {
        for (const [category, items] of Object.entries(grouped)) {
          ensureSpace(26);
          doc.setFontSize(10);
          doc.setFont(undefined, 'bold');
          setAccent();
          doc.text(category.toUpperCase(), marginX, y);
          y += 6;
          doc.setDrawColor(accentRgb.r, accentRgb.g, accentRgb.b);
          doc.setLineWidth(0.75);
          doc.line(marginX, y, pageWidth - marginX, y);
          y += 16;
          items.forEach(item => drawItem(item.summary));
          y += 6;
        }
      }
    }

    const filename = `${taskEntityName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    this._showPdfPreview(doc, filename);
  }

  _hexToRgb(hex) {
    const m = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec((hex || '').trim());
    if (!m) return { r: 0, g: 122, b: 255 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  // iOS-style confirm sheet — used for anything destructive (Clear
  // Completed, etc.) instead of a native confirm(), which looks out of
  // place inside a themed card.
  _showConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = true, onConfirm, onCancel }) {
    document.getElementById('tiger-confirm-dialog')?.remove();
    const t = this._theme();

    const overlay = document.createElement('div');
    overlay.id = 'tiger-confirm-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.35);';

    const style = document.createElement('style');
    style.textContent = `
      @keyframes tigerConfirmFadeIn  { from{opacity:0} to{opacity:1} }
      @keyframes tigerConfirmSlideUp { from{transform:translateY(12px) scale(0.96);opacity:0} to{transform:none;opacity:1} }
    `;
    overlay.style.animation = 'tigerConfirmFadeIn 0.15s ease';

    const card = document.createElement('div');
    card.style.cssText = `width:100%;max-width:270px;background:${t.confirmBg};backdrop-filter:blur(30px) saturate(180%);-webkit-backdrop-filter:blur(30px) saturate(180%);border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.35);border:1px solid ${t.confirmBorder};font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;animation:tigerConfirmSlideUp 0.2s cubic-bezier(0.34,1.3,0.64,1);`;
    card.innerHTML = `
      <div style="padding:18px 18px 16px;text-align:center;">
        <div style="font-size:15px;font-weight:600;color:${t.confirmTitle};margin-bottom:4px;">${this._escape(title)}</div>
        ${message ? `<div style="font-size:12.5px;color:${t.confirmMsg};line-height:1.4;">${this._escape(message)}</div>` : ''}
      </div>
      <div style="display:flex;border-top:1px solid ${t.confirmDivider};">
        <button id="tiger-confirm-cancel" style="flex:1;padding:12px;background:none;border:none;border-right:1px solid ${t.confirmCancelBorder};color:${this._config.accent_color || '#007AFF'};font-size:14.5px;font-weight:500;cursor:pointer;font-family:inherit;">${this._escape(cancelLabel)}</button>
        <button id="tiger-confirm-ok" style="flex:1;padding:12px;background:none;border:none;color:${destructive ? '#FF3B30' : (this._config.accent_color || '#007AFF')};font-size:14.5px;font-weight:700;cursor:pointer;font-family:inherit;">${this._escape(confirmLabel)}</button>
      </div>`;

    overlay.appendChild(style);
    overlay.appendChild(card);
    const close = () => {
      overlay.style.transition = 'opacity 0.15s ease';
      overlay.style.opacity = '0';
      setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 150);
    };
    card.querySelector('#tiger-confirm-cancel').addEventListener('click', () => { close(); onCancel?.(); });
    card.querySelector('#tiger-confirm-ok').addEventListener('click', () => { close(); onConfirm?.(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { close(); onCancel?.(); } });
    document.body.appendChild(overlay);
  }

  _closeFoodPopup() {
    if (this._foodPopupOverlay) {
      this._foodPopupOverlay.remove();
      this._foodPopupOverlay = null;
    }
    document.getElementById('tiger-image-lightbox')?.remove();
  }

  // Long-pressing any row opens this — appended to document.body (outside
  // our shadow root) so it isn't clipped or intercepted by HA's own
  // event-trapping layers.
  async _openFoodPopup(name) {
    this._closeFoodPopup();
    const accent = this._config.accent_color || '#007AFF';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';

    const style = document.createElement('style');
    style.textContent = `
      @keyframes tigerFadeIn  { from{opacity:0} to{opacity:1} }
      @keyframes tigerSlideUp { from{transform:translateY(18px) scale(0.97);opacity:0} to{transform:none;opacity:1} }
      @keyframes tigerSpin { to { transform: rotate(360deg); } }
      .tiger-food-popup { animation: tigerSlideUp 0.26s cubic-bezier(0.34,1.3,0.64,1); }
      .tiger-food-overlay { animation: tigerFadeIn 0.2s ease; }
      .tiger-food-close:hover { background: ${this._ta(0.22)} !important; }
    `;

    const popup = document.createElement('div');
    popup.className = 'tiger-food-popup';
    popup.style.cssText = `background:${this._theme().dark ? 'rgba(24,24,28,0.92)' : 'rgba(255,255,255,0.96)'};backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid ${this._ta(0.15)};border-radius:24px;box-shadow:0 24px 64px ${this._theme().dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.18)'};padding:20px;width:100%;max-width:400px;max-height:88vh;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;color:${this._theme().text};box-sizing:border-box;`;
    popup.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;';
    headerRow.innerHTML = `
      <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${this._ta(0.45)};">Item Info</span>
      <button class="tiger-food-close" style="background:${this._ta(0.1)};border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:${this._ta(0.65)};font-size:15px;line-height:1;padding:0;transition:background 0.15s;flex-shrink:0;">✕</button>`;
    headerRow.querySelector('.tiger-food-close').addEventListener('click', () => this._closeFoodPopup());

    const body = document.createElement('div');
    body.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px 0;color:${this._ta(0.6)};font-size:13px;">
      <span style="width:16px;height:16px;border:2px solid ${this._ta(0.2)};border-top-color:${this._ta(0.85)};border-radius:50%;display:inline-block;animation:tigerSpin 0.75s linear infinite;"></span>
      Looking up "${this._escape(name)}"…
    </div>`;

    popup.appendChild(style);
    popup.appendChild(headerRow);
    popup.appendChild(body);
    overlay.appendChild(popup);
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeFoodPopup(); });
    document.body.appendChild(overlay);
    this._foodPopupOverlay = overlay;

    if (!this._aiEnabled()) {
      body.innerHTML = `<div style="background:rgba(255,159,10,0.1);border:1px solid rgba(255,159,10,0.3);border-radius:14px;padding:14px 16px;font-size:12.5px;color:${this._ta(0.75)};line-height:1.5;">
        Item lookup needs AI Features turned on with an assistant selected, in this card's settings.
      </div>`;
      return;
    }

    const wantsImage = this._config.ai_food_lookup_image !== false;
    const result = await this._fetchFoodInfo(name);
    if (!this._foodPopupOverlay) return; // closed while we were waiting

    if (!result) {
      body.innerHTML = `<div style="background:${this._ta(0.05)};border:1px solid ${this._ta(0.1)};border-radius:14px;padding:14px 16px;font-size:12.5px;color:${this._ta(0.6)};text-align:center;">
        Couldn't find anything for "${this._escape(name)}".
      </div>`;
      return;
    }

    let thumbData = null;
    if (wantsImage) {
      // Search using the short canonical noun the AI gave us, not the raw
      // (often branded) item name or the category — a bare category word
      // like "Frozen" is exactly the kind of query that can innocently
      // match a pop-culture Wikipedia article (the movie) instead of food,
      // so it's deliberately not used as a fallback here. No match just
      // means the emoji icon shows instead — safer than a wrong photo.
      const searchTerm = result.generic_search_term || result.name || name;
      thumbData = await this._fetchThumbnail(searchTerm);
      if (!this._foodPopupOverlay) return; // closed while we were waiting
    }
    const thumb = thumbData?.thumb || null;
    const thumbFull = thumbData?.full || thumb;

    // Brand-aware lookup: when the AI recognised a specific branded product
    // it fills the top-level fields with that product's real data and also
    // supplies generic_fallback — a second, non-brand estimate for the same
    // type of food. The toggle below lets the person flip between the two
    // without a second AI round-trip. Nothing to toggle when the AI never
    // found a brand (or found one but didn't know its specifics) — in that
    // case the top-level fields already are the generic estimate.
    const canToggle = !!(result.brand_specific && result.generic_fallback);
    let currentMode = canToggle ? 'brand' : 'generic';

    const renderBody = (mode) => {
      const activeData = (mode === 'generic' && result.generic_fallback) ? result.generic_fallback : result;
      const isFood = result.is_food !== false && (activeData.approx_carbs_g != null || activeData.gi_category || activeData.calories_kcal != null || (Array.isArray(activeData.dietary_tags) && activeData.dietary_tags.length) || (Array.isArray(activeData.ingredients) && activeData.ingredients.length));
      const color = this._giColor(activeData.gi_category);
      const ingredients = Array.isArray(activeData.ingredients) ? activeData.ingredients.filter(Boolean) : [];
      const tags = Array.isArray(activeData.dietary_tags) ? activeData.dietary_tags.filter(Boolean) : [];
      const toggleLabel = mode === 'brand' ? 'Brand-specific · switch to generic estimate' : 'Generic estimate · switch to brand-specific';
      const footerNote = mode === 'brand'
        ? (result.note || 'AI-generated best-knowledge estimate for this specific product — always check the actual packaging for anything that matters.')
        : 'AI-generated general estimate for a typical serving — not specific to any brand or product. Always check the actual packaging for anything that matters.';

      body.innerHTML = `
        <div style="background:${this._ta(0.05)};border:1px solid ${this._ta(0.1)};border-radius:16px;padding:14px 16px;margin-bottom:10px;">
          <div style="display:flex;gap:12px;margin-bottom:6px;">
            ${thumb
              ? `<img class="tiger-thumb-open" data-full="${this._escape(thumbFull)}" data-caption="${this._escape(result.name || name)}" src="${thumb}" alt="" style="width:56px;height:56px;border-radius:12px;object-fit:cover;flex-shrink:0;background:${this._ta(0.06)};border:1px solid ${this._ta(0.1)};cursor:pointer;" />`
              : `<div style="width:56px;height:56px;border-radius:12px;background:${this._ta(0.06)};border:1px solid ${this._ta(0.1)};display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">${this._categoryEmoji(result.category)}</div>`}
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-size:16px;font-weight:700;min-width:0;">${this._escape(result.name || name)}</span>
                ${result.category ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.04em;padding:3px 9px;border-radius:20px;background:${accent}22;color:${accent};border:1px solid ${accent}44;text-transform:uppercase;flex-shrink:0;">${this._escape(result.category)}</span>` : ''}
              </div>
              ${activeData.typical_serving ? `<div style="font-size:12px;color:${this._ta(0.55)};margin-top:4px;">Serving size: ${this._escape(activeData.typical_serving)}</div>` : ''}
            </div>
          </div>
          ${canToggle ? `<button class="tiger-food-mode-toggle" style="width:100%;text-align:left;background:${accent}14;border:1px solid ${accent}40;border-radius:10px;padding:7px 10px;margin:2px 0 8px;font-size:11px;font-weight:600;color:${accent};cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;-webkit-tap-highlight-color:transparent;">
            <span>${mode === 'brand' ? '🏷️' : '📋'} ${toggleLabel}</span>
            <span style="opacity:0.6;">↺</span>
          </button>` : ''}
          ${isFood ? `
          <div style="margin-bottom:10px;padding-top:6px;border-top:1px solid ${this._ta(0.07)};">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${this._ta(0.35)};margin-bottom:8px;">Nutrition${activeData.typical_serving ? ` · per ${this._escape(activeData.typical_serving)}` : ' · per serving'}</div>
            <div style="display:flex;gap:8px;">
              <div style="flex:1;background:${this._ta(0.04)};border:1px solid ${this._ta(0.08)};border-radius:10px;padding:8px 6px;text-align:center;">
                <div style="font-size:18px;font-weight:700;color:${accent};">${activeData.approx_carbs_g != null ? activeData.approx_carbs_g + 'g' : '—'}</div>
                <div style="font-size:10px;color:${this._ta(0.45)};margin-top:2px;">Carbs</div>
              </div>
              <div style="flex:1;background:${this._ta(0.04)};border:1px solid ${this._ta(0.08)};border-radius:10px;padding:8px 6px;text-align:center;">
                <div style="font-size:18px;font-weight:700;">${activeData.calories_kcal != null ? activeData.calories_kcal : '—'}</div>
                <div style="font-size:10px;color:${this._ta(0.45)};margin-top:2px;">Calories</div>
              </div>
              ${(activeData.gi_category && activeData.gi_category !== 'unknown') ? `<div style="flex:1;background:${color}14;border:1px solid ${color}40;border-radius:10px;padding:8px 6px;text-align:center;">
                <div style="font-size:13px;font-weight:700;color:${color};text-transform:capitalize;margin-top:2px;">${this._escape(activeData.gi_category)}</div>
                <div style="font-size:10px;color:${this._ta(0.45)};margin-top:2px;">GI</div>
              </div>` : ''}
            </div>
            ${(activeData.gi_category && activeData.gi_category !== 'unknown') ? `<div style="font-size:10.5px;color:${this._ta(0.35)};line-height:1.4;margin-top:6px;">GI = Glycemic Index, how quickly this raises blood sugar (low is gentlest, high is fastest).</div>` : ''}
          </div>
          ${tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${tags.map(t => `<span style="font-size:11px;color:${accent};background:${accent}1a;border:1px solid ${accent}44;border-radius:20px;padding:3px 9px;">${this._escape(t)}</span>`).join('')}</div>` : ''}
          ${ingredients.length ? `<div style="margin-bottom:8px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${this._ta(0.35)};margin-bottom:5px;">Typical Ingredients</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;">${ingredients.map(ing => `<span style="font-size:11px;color:${this._ta(0.7)};background:${this._ta(0.06)};border:1px solid ${this._ta(0.1)};border-radius:20px;padding:3px 9px;">${this._escape(ing)}</span>`).join('')}</div>
          </div>` : ''}` : ''}
          ${(activeData.storage_tip || activeData.shelf_life) ? `<div style="display:flex;flex-direction:column;gap:2px;margin-bottom:8px;padding-top:8px;border-top:1px solid ${this._ta(0.07)};">
            ${activeData.storage_tip ? `<div style="font-size:12px;color:${this._ta(0.7)};line-height:1.5;"><strong style="color:${this._ta(0.5)};font-weight:600;">Storage:</strong> ${this._escape(activeData.storage_tip)}</div>` : ''}
            ${activeData.shelf_life ? `<div style="font-size:12px;color:${this._ta(0.7)};line-height:1.5;"><strong style="color:${this._ta(0.5)};font-weight:600;">Shelf life:</strong> ${this._escape(activeData.shelf_life)}</div>` : ''}
          </div>` : ''}
          ${result.fun_fact ? `<div style="font-size:12px;color:${this._ta(0.7)};line-height:1.5;margin-bottom:6px;">${this._escape(result.fun_fact)}</div>` : ''}
        </div>

        ${isFood ? `
        <div class="tiger-expand-card" style="background:${this._ta(0.05)};border:1px solid ${this._ta(0.1)};border-radius:16px;margin-bottom:8px;overflow:hidden;">
          <div class="tiger-expand-header" data-kind="serving" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
            <span style="font-size:13px;font-weight:600;">🍽️ Serving Suggestions</span>
            <svg class="tiger-expand-chevron" data-kind="serving" viewBox="0 0 24 24" style="width:16px;height:16px;fill:${this._ta(0.4)};transition:transform 0.2s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
          </div>
          <div class="tiger-expand-body" data-kind="serving" style="display:none;padding:0 14px 14px;"></div>
        </div>
        <div class="tiger-expand-card" style="background:${this._ta(0.05)};border:1px solid ${this._ta(0.1)};border-radius:16px;margin-bottom:8px;overflow:hidden;">
          <div class="tiger-expand-header" data-kind="cooking" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
            <span style="font-size:13px;font-weight:600;">👨‍🍳 Cooking Suggestions</span>
            <svg class="tiger-expand-chevron" data-kind="cooking" viewBox="0 0 24 24" style="width:16px;height:16px;fill:${this._ta(0.4)};transition:transform 0.2s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
          </div>
          <div class="tiger-expand-body" data-kind="cooking" style="display:none;padding:0 14px 14px;"></div>
        </div>
        ` : ''}

        <div style="font-size:10.5px;color:${this._ta(0.3)};line-height:1.5;padding:0 2px;">${this._escape(footerNote)}</div>
      `;

      const thumbEl = body.querySelector('.tiger-thumb-open');
      if (thumbEl) thumbEl.addEventListener('click', () => this._showImageLightbox(thumbEl.dataset.full, thumbEl.dataset.caption));

      const toggleEl = body.querySelector('.tiger-food-mode-toggle');
      if (toggleEl) toggleEl.addEventListener('click', () => {
        currentMode = currentMode === 'brand' ? 'generic' : 'brand';
        renderBody(currentMode);
      });

      if (isFood) {
        body.querySelectorAll('.tiger-expand-header').forEach(header => {
          header.addEventListener('click', async () => {
            const kind = header.dataset.kind;
            const chevron = body.querySelector(`.tiger-expand-chevron[data-kind="${kind}"]`);
            const panel = body.querySelector(`.tiger-expand-body[data-kind="${kind}"]`);
            const isOpen = panel.style.display !== 'none';
            if (isOpen) {
              panel.style.display = 'none';
              chevron.style.transform = '';
              return;
            }
            panel.style.display = 'block';
            chevron.style.transform = 'rotate(90deg)';
            if (panel.dataset.loaded === '1') return; // already fetched this popup session

            panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:${this._ta(0.5)};padding:2px 0 10px;">
              <span style="width:14px;height:14px;border:2px solid ${this._ta(0.2)};border-top-color:${this._ta(0.8)};border-radius:50%;display:inline-block;animation:tigerSpin 0.7s linear infinite;"></span>
              Thinking…
            </div>`;

            const list = kind === 'serving'
              ? await this._fetchServingSuggestions(name, result.category)
              : await this._fetchCookingSuggestions(name, result.category);
            if (!this._foodPopupOverlay) return; // closed while we were waiting

            if (!list || !list.length) {
              panel.innerHTML = `<div style="font-size:12px;color:${this._ta(0.4)};padding:0 0 10px;">Nothing to suggest for this one.</div>`;
              return;
            }
            panel.innerHTML = `<ul style="margin:2px 0 10px;padding-left:18px;">${list.map(s => `<li style="font-size:12.5px;color:${this._ta(0.75)};line-height:1.6;">${this._escape(s)}</li>`).join('')}</ul>`;
            panel.dataset.loaded = '1';
          });
        });
      }
    };

    renderBody(currentMode);
  }

  // Long-pressing a Tasks-list row (either in the embedded Tasks section or
  // Tasks Only View) opens this — same shell/overlay approach as
  // _openFoodPopup, reusing the same popup-tracking variable since only
  // one of these popups is ever open at a time.
  async _openTaskInfoPopup(name) {
    this._closeFoodPopup();
    const accent = this._config.accent_color || '#007AFF';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';

    const style = document.createElement('style');
    style.textContent = `
      @keyframes tigerFadeIn  { from{opacity:0} to{opacity:1} }
      @keyframes tigerSlideUp { from{transform:translateY(18px) scale(0.97);opacity:0} to{transform:none;opacity:1} }
      @keyframes tigerSpin { to { transform: rotate(360deg); } }
      .tiger-food-popup { animation: tigerSlideUp 0.26s cubic-bezier(0.34,1.3,0.64,1); }
      .tiger-food-overlay { animation: tigerFadeIn 0.2s ease; }
      .tiger-food-close:hover { background: ${this._ta(0.22)} !important; }
    `;

    const popup = document.createElement('div');
    popup.className = 'tiger-food-popup';
    popup.style.cssText = `background:${this._theme().dark ? 'rgba(24,24,28,0.92)' : 'rgba(255,255,255,0.96)'};backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid ${this._ta(0.15)};border-radius:24px;box-shadow:0 24px 64px ${this._theme().dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.18)'};padding:20px;width:100%;max-width:400px;max-height:88vh;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;color:${this._theme().text};box-sizing:border-box;`;
    popup.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;';
    headerRow.innerHTML = `
      <span style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${this._ta(0.45)};">Task Info</span>
      <button class="tiger-food-close" style="background:${this._ta(0.1)};border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:${this._ta(0.65)};font-size:15px;line-height:1;padding:0;transition:background 0.15s;flex-shrink:0;">✕</button>`;
    headerRow.querySelector('.tiger-food-close').addEventListener('click', () => this._closeFoodPopup());

    const body = document.createElement('div');
    body.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px 0;color:${this._ta(0.6)};font-size:13px;">
      <span style="width:16px;height:16px;border:2px solid ${this._ta(0.2)};border-top-color:${this._ta(0.85)};border-radius:50%;display:inline-block;animation:tigerSpin 0.75s linear infinite;"></span>
      Looking up "${this._escape(name)}"…
    </div>`;

    popup.appendChild(style);
    popup.appendChild(headerRow);
    popup.appendChild(body);
    overlay.appendChild(popup);
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeFoodPopup(); });
    document.body.appendChild(overlay);
    this._foodPopupOverlay = overlay;

    if (!this._aiEnabled()) {
      body.innerHTML = `<div style="background:rgba(255,159,10,0.1);border:1px solid rgba(255,159,10,0.3);border-radius:14px;padding:14px 16px;font-size:12.5px;color:${this._ta(0.75)};line-height:1.5;">
        Task lookup needs AI Features turned on with an assistant selected, in this card's settings.
      </div>`;
      return;
    }

    const result = await this._fetchTaskInfo(name);
    if (!this._foodPopupOverlay) return; // closed while we were waiting

    if (!result) {
      body.innerHTML = `<div style="background:${this._ta(0.05)};border:1px solid ${this._ta(0.1)};border-radius:14px;padding:14px 16px;font-size:12.5px;color:${this._ta(0.6)};text-align:center;">
        Couldn't find anything for "${this._escape(name)}".
      </div>`;
      return;
    }

    const tools = Array.isArray(result.tools_needed) ? result.tools_needed.filter(Boolean) : [];

    body.innerHTML = `
      <div style="background:${this._ta(0.05)};border:1px solid ${this._ta(0.1)};border-radius:16px;padding:14px 16px;margin-bottom:10px;">
        <div style="display:flex;gap:12px;margin-bottom:6px;">
          <div style="width:56px;height:56px;border-radius:12px;background:${this._ta(0.06)};border:1px solid ${this._ta(0.1)};display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">${this._taskCategoryEmoji(result.category)}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span style="font-size:16px;font-weight:700;min-width:0;">${this._escape(result.name || name)}</span>
              ${result.category ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.04em;padding:3px 9px;border-radius:20px;background:${accent}22;color:${accent};border:1px solid ${accent}44;text-transform:uppercase;flex-shrink:0;">${this._escape(result.category)}</span>` : ''}
            </div>
            ${result.best_time ? `<div style="font-size:12px;color:${this._ta(0.55)};margin-top:4px;">Best time: ${this._escape(result.best_time)}</div>` : ''}
          </div>
        </div>
        ${result.estimated_time ? `<div style="margin:10px 0;padding-top:8px;border-top:1px solid ${this._ta(0.07)};">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${this._ta(0.35)};margin-bottom:6px;">Estimated Time</div>
          <div style="font-size:20px;font-weight:700;color:${accent};">${this._escape(result.estimated_time)}</div>
        </div>` : ''}
        ${tools.length ? `<div style="margin-bottom:8px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${this._ta(0.35)};margin-bottom:5px;">Tools / Supplies</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">${tools.map(t => `<span style="font-size:11px;color:${this._ta(0.7)};background:${this._ta(0.06)};border:1px solid ${this._ta(0.1)};border-radius:20px;padding:3px 9px;">${this._escape(t)}</span>`).join('')}</div>
        </div>` : ''}
        ${result.note ? `<div style="font-size:11px;color:${this._ta(0.35)};line-height:1.4;padding-top:6px;border-top:1px solid ${this._ta(0.07)};">${this._escape(result.note)}</div>` : ''}
      </div>

      <div class="tiger-expand-card" style="background:${this._ta(0.05)};border:1px solid ${this._ta(0.1)};border-radius:16px;margin-bottom:8px;overflow:hidden;">
        <div class="tiger-expand-header" data-kind="tips" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <span style="font-size:13px;font-weight:600;">💡 How-To Tips</span>
          <svg class="tiger-expand-chevron" data-kind="tips" viewBox="0 0 24 24" style="width:16px;height:16px;fill:${this._ta(0.4)};transition:transform 0.2s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
        </div>
        <div class="tiger-expand-body" data-kind="tips" style="display:none;padding:0 14px 14px;"></div>
      </div>
      <div class="tiger-expand-card" style="background:${this._ta(0.05)};border:1px solid ${this._ta(0.1)};border-radius:16px;margin-bottom:8px;overflow:hidden;">
        <div class="tiger-expand-header" data-kind="related" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <span style="font-size:13px;font-weight:600;">🔗 Related Tasks</span>
          <svg class="tiger-expand-chevron" data-kind="related" viewBox="0 0 24 24" style="width:16px;height:16px;fill:${this._ta(0.4)};transition:transform 0.2s ease;flex-shrink:0;"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
        </div>
        <div class="tiger-expand-body" data-kind="related" style="display:none;padding:0 14px 14px;"></div>
      </div>

      <div style="font-size:10.5px;color:${this._ta(0.3)};line-height:1.5;padding:0 2px;">AI-generated general estimate — actual time and steps will vary.</div>
    `;

    body.querySelectorAll('.tiger-expand-header').forEach(header => {
      header.addEventListener('click', async () => {
        const kind = header.dataset.kind;
        const chevron = body.querySelector(`.tiger-expand-chevron[data-kind="${kind}"]`);
        const panel = body.querySelector(`.tiger-expand-body[data-kind="${kind}"]`);
        const isOpen = panel.style.display !== 'none';
        if (isOpen) {
          panel.style.display = 'none';
          chevron.style.transform = '';
          return;
        }
        panel.style.display = 'block';
        chevron.style.transform = 'rotate(90deg)';
        if (panel.dataset.loaded === '1') return; // already fetched this popup session

        panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:${this._ta(0.5)};padding:2px 0 10px;">
          <span style="width:14px;height:14px;border:2px solid ${this._ta(0.2)};border-top-color:${this._ta(0.8)};border-radius:50%;display:inline-block;animation:tigerSpin 0.7s linear infinite;"></span>
          Thinking…
        </div>`;

        const list = kind === 'tips'
          ? await this._fetchTaskTips(name, result.category)
          : await this._fetchRelatedTasks(name, result.category);
        if (!this._foodPopupOverlay) return; // closed while we were waiting

        if (!list || !list.length) {
          panel.innerHTML = `<div style="font-size:12px;color:${this._ta(0.4)};padding:0 0 10px;">Nothing to suggest for this one.</div>`;
          return;
        }
        panel.innerHTML = `<ul style="margin:2px 0 10px;padding-left:18px;">${list.map(s => `<li style="font-size:12.5px;color:${this._ta(0.75)};line-height:1.6;">${this._escape(s)}</li>`).join('')}</ul>`;
        panel.dataset.loaded = '1';
      });
    });
  }

  _findSimilarItem(text) {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const target = norm(text);
    const active = this._items.filter(i => i.status !== 'completed');
    for (const item of active) {
      const existing = norm(item.summary);
      if (existing === target) return item;
      const a = new Set(existing.split(/\s+/));
      const b = new Set(target.split(/\s+/));
      const overlap = [...a].filter(w => b.has(w)).length;
      if (overlap > 0 && overlap >= Math.min(a.size, b.size) * 0.6 && Math.min(a.size, b.size) > 0) {
        return item;
      }
    }
    return null;
  }

  _restockSuggestions() {
    if (!this._config.restock_suggestions) return [];
    const activeNames = new Set(this._items.filter(i => i.status !== 'completed').map(i => i.summary.trim().toLowerCase()));
    const suggestions = [];
    for (const [name, log] of Object.entries(this._completionLog)) {
      if (activeNames.has(name) || log.length < 2) continue;
      const lastCompleted = log[log.length - 1];
      const dismissedAt = this._dismissedRestock[name];
      if (dismissedAt != null && dismissedAt >= lastCompleted) continue; // dismissed since the last time it was bought
      const gaps = [];
      for (let i = 1; i < log.length; i++) gaps.push(log[i] - log[i - 1]);
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const sinceLast = Date.now() - lastCompleted;
      if (avgGap > 0 && sinceLast >= avgGap * 0.85) {
        suggestions.push(name);
      }
    }
    return suggestions.slice(0, 4);
  }

  _dismissRestockSuggestion(name) {
    this._dismissedRestock[name.trim().toLowerCase()] = Date.now();
    this._saveDismissedRestock();
    this._render();
  }

  _clearAllRestockSuggestions() {
    const now = Date.now();
    for (const name of this._restockSuggestions()) {
      this._dismissedRestock[name] = now;
    }
    this._saveDismissedRestock();
    this._render();
  }

  // ── Render ────────────────────────────────────────────────────────
  // Home Assistant's dashboard scrolls inside its own nested container deep
  // in shadow DOM (hui-view / ha-panel-lovelace, etc.) — it's not the
  // browser window or document. To find and restore the real scroll
  // position, walk up from this element through actual DOM ancestors and,
  // whenever a shadow root boundary is hit, jump to that root's host to
  // keep going — the first genuinely scrollable ancestor found this way is
  // the one that visually moved when the card's height changed.
  _findScrollableAncestor() {
    let node = this.parentElement || this.getRootNode?.()?.host || null;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.scrollHeight > node.clientHeight + 1) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY)) return node;
      }
      node = node.parentElement || node.getRootNode?.()?.host || null;
    }
    return document.scrollingElement || document.documentElement;
  }

  _render() {
    if (!this._config) return;
    this._openRowUid = null; // fresh DOM on every render — no row starts swiped open
    // Deliberately blur whatever's focused (e.g. the button just tapped)
    // before tearing down the DOM below, rather than letting it vanish
    // while still focused — on iOS WKWebView, a focused element being
    // abruptly removed can trigger an automatic scroll-to-top as the
    // browser tries to keep the newly-focused element (body) in view.
    this.shadowRoot.activeElement?.blur();
    // A full re-render replaces .scroll-region with a brand new element, so
    // its scroll position would otherwise silently reset to the top on
    // every state change (checking an item, expanding Tasks/Completed,
    // etc.) — capture it here and restore it after re-rendering below.
    const prevScrollTop = this.shadowRoot.querySelector('.scroll-region')?.scrollTop || 0;
    // Separately: replacing the DOM also shifts the whole card's height,
    // which can move (or in WKWebView, auto-scroll) the dashboard's own
    // scroll container — not window/document, see _findScrollableAncestor.
    const pageScroller = this._findScrollableAncestor();
    const pageScrollTop = pageScroller ? pageScroller.scrollTop : 0;
    const accent = this._config.accent_color || '#007AFF';
    const t = this._theme();
    const stateObj = this._hass?.states?.[this._config.entity];
    const active = this._items.filter(i => i.status !== 'completed');
    const completed = this._items.filter(i => i.status === 'completed');
    const grouped = this._groupItems(active);
    const suggestions = this._aiEnabled() ? this._restockSuggestions() : [];

    const hasTaskList = !!this._config.todo_entity;
    const tasksVisible = hasTaskList && this._effectiveShowTasks();
    const taskActive = this._taskItems.filter(i => i.status !== 'completed');
    const taskCompleted = this._taskItems.filter(i => i.status === 'completed');
    const tasksOnly = hasTaskList && this._tasksOnlyView;
    const taskGrouped = this._groupTasks(taskActive);
    const tasksOnlyTitle = this._hass?.states?.[this._config.todo_entity]?.attributes?.friendly_name || 'Tasks';
    const collapsed = this._effectiveCollapsed();
    const compact = this._effectiveCompactMode();
    const summaryParts = tasksOnly
      ? [`${taskActive.length} task${taskActive.length === 1 ? '' : 's'}`]
      : [`${active.length} to get`, ...(tasksVisible ? [`${taskActive.length} task${taskActive.length === 1 ? '' : 's'}`] : [])];
    const summaryText = summaryParts.join(', ');

    this.shadowRoot.innerHTML = `
      <style>${this._styles(accent, collapsed)}</style>
      <ha-card>
        <div class="header">
          <div class="title-row">
            <span class="title" id="tigerTitleToggle" style="cursor:pointer;">${this._escape(tasksOnly ? tasksOnlyTitle : this._config.title)}</span>
            <div class="header-right">
              ${!collapsed ? `
              <div class="menu-wrap">
                <button class="icon-btn menu-btn" id="tigerMenuBtn" title="More">${this._dotsIcon()}</button>
                <div class="menu-dropdown" id="tigerMenuDropdown" style="display:${this._menuOpen ? 'block' : 'none'};">
                  <div class="menu-section-label">View</div>
                  <div class="menu-item menu-toggle-item">
                    <span>Sort by Category</span>
                    <label class="toggle-switch small"><input type="checkbox" id="tigerMenuSortToggle" ${this._effectiveSortByCategory() ? 'checked' : ''}><span class="toggle-track"></span></label>
                  </div>
                  ${hasTaskList ? `
                  <div class="menu-item menu-toggle-item">
                    <span>Show Tasks Section</span>
                    <label class="toggle-switch small"><input type="checkbox" id="tigerMenuTasksToggle" ${tasksVisible ? 'checked' : ''}><span class="toggle-track"></span></label>
                  </div>` : ''}
                  ${hasTaskList && this._aiEnabled() ? `
                  <div class="menu-item menu-toggle-item">
                    <span>Tasks Only View</span>
                    <label class="toggle-switch small"><input type="checkbox" id="tigerMenuTasksOnlyToggle" ${tasksOnly ? 'checked' : ''}><span class="toggle-track"></span></label>
                  </div>` : ''}
                  <div class="menu-item menu-toggle-item">
                    <span>Compact Mode</span>
                    <label class="toggle-switch small"><input type="checkbox" id="tigerMenuCompactToggle" ${compact ? 'checked' : ''}><span class="toggle-track"></span></label>
                  </div>
                  <div class="menu-section-label menu-section-divider">Export</div>
                  <button class="menu-item" id="tigerMenuExportPdf">${this._pdfIcon()} <span>Shopping List</span></button>
                  ${hasTaskList ? `<button class="menu-item" id="tigerMenuExportTasksPdf">${this._pdfIcon()} <span>Tasks</span></button>` : ''}
                </div>
              </div>
              ` : ''}
              <button class="icon-btn" id="tigerCollapseBtn" title="${collapsed ? 'Expand' : 'Collapse'}" style="width:auto;height:auto;padding:0;margin-right:-2px;">
                <ha-icon icon="mdi:chevron-down" style="--mdc-icon-size:18px;color:${t.iconBtnColor};transform:${collapsed ? 'rotate(-90deg)' : 'none'};transition:transform 0.2s ease;"></ha-icon>
              </button>
            </div>
          </div>
          ${collapsed ? `<div style="font-size:13px;color:${t.textDim};margin-top:2px;">${this._escape(summaryText)}</div>` : ''}
          ${!collapsed && !stateObj ? `<div class="warn">Entity "${this._escape(this._config.entity)}" not found</div>` : ''}
        </div>

        ${!collapsed ? `
        ${tasksOnly ? `
        ${this._config.show_add_bar !== false ? `
        <div class="add-bar">
          <input type="text" class="add-input task-add-input" placeholder="Add a task" />
          <button class="icon-btn add-btn task-add-btn" title="Add">${this._plusIcon()}</button>
        </div>
        ` : ''}

        <div class="scroll-region">
        <div class="list primary-list">
          ${Object.keys(taskGrouped).length === 0 || taskActive.length === 0 ? `<div class="empty">All done 🎉</div>` : ''}
          ${Object.entries(taskGrouped).map(([cat, items]) => `
            ${cat !== '__none__' ? `<div class="cat-header">${this._escape(cat)}</div>` : ''}
            ${items.map(item => this._rowHtml(item, true)).join('')}
          `).join('')}
        </div>

        ${taskCompleted.length ? `
        <div class="completed-toggle">
          <button class="completed-btn tasks-completed-btn">${this._showCompletedTasks ? '▾' : '▸'} Completed (${taskCompleted.length})</button>
          <button class="clear-btn tasks-clear-btn" style="display:${this._showCompletedTasks ? 'inline-block' : 'none'};">Clear</button>
        </div>
        <div class="list completed-list tasks-completed-list" style="display:${this._showCompletedTasks ? 'flex' : 'none'};">${taskCompleted.map(item => this._rowHtml(item, true)).join('')}</div>
        ` : ''}
        </div>
        ` : `
        ${this._config.show_add_bar !== false ? `
        <div class="add-bar">
          <input type="text" class="add-input shopping-add-input" placeholder="Add an item" />
          <button class="icon-btn add-btn shopping-add-btn" title="Add">${this._plusIcon()}</button>
        </div>
        ` : ''}

        ${this._pendingDuplicate ? `
        <div class="dup-banner">
          <span>"${this._escape(this._pendingDuplicate.text)}" looks similar to "${this._escape(this._pendingDuplicate.existing.summary)}" — add anyway?</span>
          <div class="dup-actions">
            <button class="dup-add">Add anyway</button>
            <button class="dup-cancel">Cancel</button>
          </div>
        </div>` : ''}

        ${suggestions.length ? `
        <div class="suggest-row">
          <span class="suggest-label">Might be low:</span>
          ${suggestions.map(s => `
            <span class="suggest-chip">
              <button class="suggest-chip-add" data-item="${this._escape(s)}">+ ${this._escape(s)}</button>
              <button class="suggest-chip-x" data-item="${this._escape(s)}" title="Dismiss">✕</button>
            </span>
          `).join('')}
          ${suggestions.length > 1 ? `<button class="suggest-clear-all">Clear all</button>` : ''}
        </div>` : ''}

        <div class="scroll-region">
        <div class="list primary-list">
          ${Object.keys(grouped).length === 0 ? `<div class="empty">All done 🎉</div>` : ''}
          ${Object.entries(grouped).map(([cat, items]) => `
            ${cat !== '__none__' ? `<div class="cat-header">${this._escape(cat)}</div>` : ''}
            ${items.map(item => this._rowHtml(item)).join('')}
          `).join('')}
        </div>

        ${completed.length ? `
        <div class="completed-toggle">
          <button class="completed-btn shopping-completed-btn">${this._showCompleted ? '▾' : '▸'} Completed (${completed.length})</button>
          <button class="clear-btn shopping-clear-btn" style="display:${this._showCompleted ? 'inline-block' : 'none'};">Clear</button>
        </div>
        <div class="list completed-list shopping-completed-list" style="display:${this._showCompleted ? 'flex' : 'none'};">${completed.map(item => this._rowHtml(item)).join('')}</div>
        ` : ''}

        ${tasksVisible ? `
        <div class="tasks-section">
          <div class="completed-toggle tasks-toggle-row">
            <button class="completed-btn tasks-toggle-btn">${this._tasksExpanded ? '▾' : '▸'} Tasks (${taskActive.length})</button>
          </div>
          <div class="tasks-expand-body" style="display:${this._tasksExpanded ? 'block' : 'none'};">
            ${this._config.show_add_bar !== false ? `
            <div class="add-bar">
              <input type="text" class="add-input task-add-input" placeholder="Add a task" />
              <button class="icon-btn add-btn task-add-btn" title="Add">${this._plusIcon()}</button>
            </div>
            ` : ''}
            <div class="list primary-list">
              ${taskActive.length === 0 ? `<div class="empty">All done 🎉</div>` : ''}
              ${taskActive.map(item => this._rowHtml(item, true)).join('')}
            </div>
            ${taskCompleted.length ? `
            <div class="completed-toggle">
              <button class="completed-btn tasks-completed-btn">${this._showCompletedTasks ? '▾' : '▸'} Completed (${taskCompleted.length})</button>
              <button class="clear-btn tasks-clear-btn" style="display:${this._showCompletedTasks ? 'inline-block' : 'none'};">Clear</button>
            </div>
            <div class="list completed-list tasks-completed-list" style="display:${this._showCompletedTasks ? 'flex' : 'none'};">${taskCompleted.map(item => this._rowHtml(item, true)).join('')}</div>
            ` : ''}
          </div>
        </div>
        </div>
        ` : ''}
        `}
        ` : ''}

        <div class="tiger-toast" id="tigerToast">
          <div class="tiger-toast-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></div>
          <div class="tiger-toast-text" id="tigerToastText"></div>
        </div>
      </ha-card>
    `;

    this._attachEvents();
    const newScrollRegion = this.shadowRoot.querySelector('.scroll-region');
    if (newScrollRegion && prevScrollTop) newScrollRegion.scrollTop = prevScrollTop;

    // Restore the dashboard's own scroll position after the browser's own
    // focus-loss auto-scroll has already happened, so ours is the one that
    // sticks. A single rAF often runs before that correction settles, so
    // this uses two in a row. Re-find the ancestor fresh rather than reuse
    // `pageScroller` — the fresh render may sit under a different node.
    if (pageScrollTop) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const currentScroller = this._findScrollableAncestor();
          if (currentScroller) currentScroller.scrollTop = pageScrollTop;
        });
      });
    }
  }

  // The ⋮ menu's "Sort by Category" toggle overrides the editor's default
  // once the person has explicitly set it from the card itself.
  _effectiveSortByCategory() {
    return this._sortByCategory !== null ? this._sortByCategory : (this._config.group_by_category !== false);
  }

  // Same pattern for whether the card is collapsed to its header only.
  _effectiveCollapsed() {
    return this._collapsed !== null ? this._collapsed : (this._config.start_collapsed === true);
  }

  // Same pattern for tighter, single-line rows.
  _effectiveCompactMode() {
    return this._compactMode !== null ? this._compactMode : (this._config.compact_mode === true);
  }

  // Same pattern for whether the Tasks section shows at all.
  _effectiveShowTasks() {
    return this._showTasks !== null ? this._showTasks : (this._config.show_tasks_section !== false);
  }

  _groupItems(items) {
    if (!this._effectiveSortByCategory() || !this._config.ai_features_enabled) {
      return { __none__: items };
    }
    const groups = {};
    for (const item of items) {
      // A pinned category (set right after a rename) wins over the normal
      // text lookup — keeps the item in its old spot until the new text
      // has actually been categorized, instead of jumping to "Other".
      const cat = this._categoryPinByUid[item.uid] || this._categoryCache[item.summary.trim().toLowerCase()] || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }

  _rowHtml(item, isTask = false) {
    const done = item.status === 'completed';
    const compact = this._effectiveCompactMode();
    return `
      <div class="row ${done ? 'done' : ''}${compact ? ' compact' : ''}" data-uid="${this._escape(item.uid)}" data-source="${isTask ? 'task' : 'shopping'}">
        <div class="swipe-content">
          <button class="check ${done ? 'checked' : ''}">${done ? this._checkIcon() : ''}</button>
          <span class="item-text">${this._escape(item.summary)}</span>
        </div>
        <button class="delete-btn" title="Delete">${this._trashIcon()}</button>
      </div>
    `;
  }

  _attachEvents() {
    const root = this.shadowRoot;
    const input = root.querySelector('.shopping-add-input');
    const addBtn = root.querySelector('.shopping-add-btn');

    const submit = () => {
      if (!input) return;
      const val = input.value;
      if (!val.trim()) return;
      this._addItem(val);
      input.value = '';
    };

    if (addBtn) addBtn.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

    // ── Collapse — chevron and title both toggle it the same way ────────
    const toggleCollapsed = () => {
      this._collapsed = !this._effectiveCollapsed();
      this._saveCollapsedPreference();
      this._render();
    };
    const collapseBtn = root.getElementById('tigerCollapseBtn');
    if (collapseBtn) collapseBtn.addEventListener('click', toggleCollapsed);
    const titleToggle = root.getElementById('tigerTitleToggle');
    if (titleToggle) titleToggle.addEventListener('click', toggleCollapsed);

    // ── ⋮ menu: Export to PDF, Sort by Category toggle ──────────────────
    const menuBtn = root.getElementById('tigerMenuBtn');
    const menuDropdown = root.getElementById('tigerMenuDropdown');
    if (menuBtn && menuDropdown) {
      menuBtn.addEventListener('click', e => {
        e.stopPropagation();
        this._menuOpen = !this._menuOpen;
        menuDropdown.style.display = this._menuOpen ? 'block' : 'none';
      });
    }
    const exportPdfBtn = root.getElementById('tigerMenuExportPdf');
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', () => {
      this._menuOpen = false;
      if (menuDropdown) menuDropdown.style.display = 'none';
      this._exportShoppingListPdf();
    });
    const exportTasksPdfBtn = root.getElementById('tigerMenuExportTasksPdf');
    if (exportTasksPdfBtn) exportTasksPdfBtn.addEventListener('click', () => {
      this._menuOpen = false;
      if (menuDropdown) menuDropdown.style.display = 'none';
      this._exportTasksPdf();
    });
    const sortToggle = root.getElementById('tigerMenuSortToggle');
    if (sortToggle) sortToggle.addEventListener('change', e => {
      this._sortByCategory = e.target.checked;
      this._saveSortPreference();
      this._render();
    });
    const tasksToggle = root.getElementById('tigerMenuTasksToggle');
    if (tasksToggle) tasksToggle.addEventListener('change', e => {
      this._showTasks = e.target.checked;
      this._saveTasksVisibilityPreference();
      this._render();
    });
    const tasksOnlyToggle = root.getElementById('tigerMenuTasksOnlyToggle');
    if (tasksOnlyToggle) tasksOnlyToggle.addEventListener('change', e => {
      this._tasksOnlyView = e.target.checked;
      this._saveTasksOnlyViewPreference();
      if (this._tasksOnlyView) this._categorizeMissingTasks();
      this._render();
    });
    const compactToggle = root.getElementById('tigerMenuCompactToggle');
    if (compactToggle) compactToggle.addEventListener('change', e => {
      this._compactMode = e.target.checked;
      this._saveCompactModePreference();
      this._render();
    });

    root.querySelectorAll('.check').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.row');
        // A long press just fired a lookup — swallow the click that follows.
        if (row.dataset.longpress === '1') { delete row.dataset.longpress; return; }
        // If this row is swiped open, the first tap just closes it —
        // matches the standard iOS swipe-list convention.
        if (row.classList.contains('swiped-open')) { this._closeRow(row); return; }
        const isTask = row.dataset.source === 'task';
        const uid = row.dataset.uid;
        const item = (isTask ? this._taskItems : this._items).find(i => i.uid === uid);
        if (item) this._toggleItem(item, isTask);
      });
    });

    // Tapping the text of an active (not-yet-completed) row renames it in
    // place. Completed rows keep their existing "tap anywhere restores"
    // behavior instead — renaming only applies to active items.
    root.querySelectorAll('.row:not(.done) .item-text').forEach(span => {
      span.addEventListener('click', () => {
        const row = span.closest('.row');
        if (row.dataset.longpress === '1') { delete row.dataset.longpress; return; }
        if (row.classList.contains('swiped-open')) { this._closeRow(row); return; }
        this._beginRename(row, span);
      });
    });

    // In the Completed section, tapping anywhere on the row (not just the
    // small checkbox) restores the item to the active list.
    root.querySelectorAll('.completed-list .swipe-content').forEach(content => {
      content.addEventListener('click', e => {
        if (e.target.closest('.check')) return; // already handled above
        const row = content.closest('.row');
        if (row.dataset.longpress === '1') { delete row.dataset.longpress; return; }
        if (row.classList.contains('swiped-open')) { this._closeRow(row); return; }
        const isTask = row.dataset.source === 'task';
        const uid = row.dataset.uid;
        const item = (isTask ? this._taskItems : this._items).find(i => i.uid === uid);
        if (item) this._toggleItem(item, isTask);
      });
    });

    root.querySelectorAll('.row').forEach(row => {
      this._attachSwipe(row);
      row.querySelector('.delete-btn').addEventListener('click', () => {
        const isTask = row.dataset.source === 'task';
        const uid = row.dataset.uid;
        const item = (isTask ? this._taskItems : this._items).find(i => i.uid === uid);
        if (!item) return;
        this._showConfirmDialog({
          title: 'Delete Item?',
          message: `"${item.summary}" will be removed from the list. This can't be undone.`,
          confirmLabel: 'Delete',
          destructive: true,
          onConfirm: () => this._removeItem(item, isTask),
          onCancel: () => this._closeRow(row),
        });
      });
    });

    // Tapping anywhere outside the currently open row (or the ⋮ menu)
    // closes it.
    const cardEl = root.querySelector('ha-card');
    if (cardEl) cardEl.addEventListener('click', e => {
      const openRow = root.querySelector('.row.swiped-open');
      if (openRow && !openRow.contains(e.target)) this._closeRow(openRow);
      const menuWrap = root.querySelector('.menu-wrap');
      if (this._menuOpen && menuWrap && !menuWrap.contains(e.target)) {
        this._menuOpen = false;
        const dropdown = root.getElementById('tigerMenuDropdown');
        if (dropdown) dropdown.style.display = 'none';
      }
    });

    root.querySelectorAll('.suggest-chip-add').forEach(btn => {
      btn.addEventListener('click', () => this._addItem(btn.dataset.item));
    });
    root.querySelectorAll('.suggest-chip-x').forEach(btn => {
      btn.addEventListener('click', () => this._dismissRestockSuggestion(btn.dataset.item));
    });
    const clearAllBtn = root.querySelector('.suggest-clear-all');
    if (clearAllBtn) clearAllBtn.addEventListener('click', () => this._clearAllRestockSuggestions());

    // Scrolls the given toggle button to the top of the card's own
    // internal .scroll-region once its newly-revealed content has actually
    // been laid out. Deliberately NOT using native scrollIntoView() here —
    // it cascades up through every scrollable ancestor, including the
    // dashboard's own page scroll, which moved the whole page instead of
    // just this card. Scrolling .scroll-region's scrollTop directly can't
    // touch anything outside the card.
    const scrollToggleIntoView = btn => {
      requestAnimationFrame(() => {
        const scrollRegion = btn.closest('.scroll-region');
        if (!scrollRegion) return;
        const targetTop = btn.getBoundingClientRect().top - scrollRegion.getBoundingClientRect().top + scrollRegion.scrollTop;
        scrollRegion.scrollTo({ top: targetTop, behavior: 'smooth' });
      });
    };

    const completedBtn = root.querySelector('.shopping-completed-btn');
    if (completedBtn) completedBtn.addEventListener('click', () => {
      // Direct DOM toggle instead of a full _render() — replacing the whole
      // card's innerHTML for a pure show/hide destroys whatever was
      // focused (this button), which triggers an unwanted scroll-to-top in
      // some WebViews. The content already exists in the DOM either way
      // (rendered once, shown/hidden via display), so no data is missing.
      this._showCompleted = !this._showCompleted;
      const list = root.querySelector('.shopping-completed-list');
      const clear = root.querySelector('.shopping-clear-btn');
      if (list) list.style.display = this._showCompleted ? 'flex' : 'none';
      if (clear) clear.style.display = this._showCompleted ? 'inline-block' : 'none';
      completedBtn.textContent = `${this._showCompleted ? '▾' : '▸'} Completed (${this._items.filter(i => i.status === 'completed').length})`;
      if (this._showCompleted) scrollToggleIntoView(completedBtn);
    });
    const clearBtn = root.querySelector('.shopping-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      const completedCount = this._items.filter(i => i.status === 'completed').length;
      this._showConfirmDialog({
        title: 'Clear Completed?',
        message: `${completedCount} item${completedCount === 1 ? '' : 's'} will be removed from the list. This can't be undone.`,
        confirmLabel: 'Clear',
        destructive: true,
        onConfirm: () => this._clearCompleted(),
      });
    });

    // ── Tasks section (optional second list) ────────────────────────────
    const tasksToggleBtn = root.querySelector('.tasks-toggle-btn');
    if (tasksToggleBtn) tasksToggleBtn.addEventListener('click', () => {
      this._tasksExpanded = !this._tasksExpanded;
      const body = root.querySelector('.tasks-expand-body');
      if (body) body.style.display = this._tasksExpanded ? 'block' : 'none';
      tasksToggleBtn.textContent = `${this._tasksExpanded ? '▾' : '▸'} Tasks (${this._taskItems.filter(i => i.status !== 'completed').length})`;
      if (this._tasksExpanded) scrollToggleIntoView(tasksToggleBtn);
    });
    const tasksCompletedBtn = root.querySelector('.tasks-completed-btn');
    if (tasksCompletedBtn) tasksCompletedBtn.addEventListener('click', () => {
      this._showCompletedTasks = !this._showCompletedTasks;
      const list = root.querySelector('.tasks-completed-list');
      const clear = root.querySelector('.tasks-clear-btn');
      if (list) list.style.display = this._showCompletedTasks ? 'flex' : 'none';
      if (clear) clear.style.display = this._showCompletedTasks ? 'inline-block' : 'none';
      tasksCompletedBtn.textContent = `${this._showCompletedTasks ? '▾' : '▸'} Completed (${this._taskItems.filter(i => i.status === 'completed').length})`;
      if (this._showCompletedTasks) scrollToggleIntoView(tasksCompletedBtn);
    });
    const tasksClearBtn = root.querySelector('.tasks-clear-btn');
    if (tasksClearBtn) tasksClearBtn.addEventListener('click', () => {
      const completedCount = this._taskItems.filter(i => i.status === 'completed').length;
      this._showConfirmDialog({
        title: 'Clear Completed Tasks?',
        message: `${completedCount} task${completedCount === 1 ? '' : 's'} will be removed from the list. This can't be undone.`,
        confirmLabel: 'Clear',
        destructive: true,
        onConfirm: () => this._clearCompleted(true),
      });
    });
    const taskInput = root.querySelector('.task-add-input');
    const taskAddBtn = root.querySelector('.task-add-btn');
    const submitTask = () => {
      if (!taskInput) return;
      const val = taskInput.value;
      if (!val.trim()) return;
      this._addItem(val, true);
      taskInput.value = '';
    };
    if (taskAddBtn) taskAddBtn.addEventListener('click', submitTask);
    if (taskInput) taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitTask(); });

    const dupAdd = root.querySelector('.dup-add');
    const dupCancel = root.querySelector('.dup-cancel');
    if (dupAdd) dupAdd.addEventListener('click', async () => {
      const text = this._pendingDuplicate.text;
      this._pendingDuplicate = null;
      try {
        await this._hass.callService('todo', 'add_item', { entity_id: this._config.entity, item: text });
      } catch (e) {
        console.error('tiger-todo-card: add_item failed', e);
        this._showToast("Couldn't add that item");
      }
    });
    if (dupCancel) dupCancel.addEventListener('click', () => {
      this._pendingDuplicate = null;
      this._render();
    });
  }

  _attachSwipe(row) {
    const content = row.querySelector('.swipe-content');
    let startX = 0, startY = 0, currentX = 0, dragging = false;
    // Once a touch moves enough to tell, axisLock commits it to either a
    // horizontal swipe ('x') or a vertical scroll ('y') for the rest of
    // that gesture — without this, a few stray sideways pixels picked up
    // while scrolling down the list would peek the delete button open.
    let axisLock = null;
    let longPressTimer = null, longPressFired = false;
    const LONG_PRESS_MS = 550;

    const clearLongPress = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };

    const beginPress = (x, y) => {
      // A row being actively renamed shouldn't also swipe or long-press —
      // let the input handle its own touches undisturbed.
      if (row.classList.contains('editing')) return;
      // Starting a new press collapses whatever row was previously open,
      // so only one row is ever revealed at a time.
      this._closeOtherRows(row);
      startX = x; startY = y; dragging = true; currentX = 0;
      axisLock = null;
      longPressFired = false;
      clearLongPress();
      const isTaskRow = row.dataset.source === 'task';
      const lookupEnabled = isTaskRow
        ? (this._aiEnabled() && this._config.ai_task_lookup !== false)
        : (this._aiEnabled() && this._config.ai_food_lookup !== false);
      if (lookupEnabled) {
        const uid = row.dataset.uid;
        longPressTimer = setTimeout(() => {
          longPressFired = true;
          dragging = false;
          content.style.transform = 'translateX(0)';
          row.dataset.longpress = '1'; // consumed by the click handler that follows
          const item = (isTaskRow ? this._taskItems : this._items).find(i => i.uid === uid);
          if (!item) return;
          if (isTaskRow) this._openTaskInfoPopup(item.summary);
          else this._openFoodPopup(item.summary);
        }, LONG_PRESS_MS);
      }
    };

    const trackMove = (x, y) => {
      if (!dragging) return;
      const dx = x - startX, dy = y - startY;
      if (longPressTimer && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) clearLongPress();

      if (!axisLock) {
        // Not enough movement yet to tell which way this is going —
        // wait rather than guessing from the first jittery pixel.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axisLock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (axisLock === 'y') return; // committed to a vertical scroll — don't reveal delete

      currentX = dx;
      if (currentX < 0) content.style.transform = `translateX(${Math.max(currentX, -84)}px)`;
    };

    const endPress = () => {
      clearLongPress();
      dragging = false;
      if (longPressFired) { longPressFired = false; currentX = 0; axisLock = null; return; }
      const openNow = axisLock === 'x' && currentX < -40;
      content.style.transform = openNow ? 'translateX(-84px)' : 'translateX(0)';
      row.classList.toggle('swiped-open', openNow);
      this._openRowUid = openNow ? row.dataset.uid : null;
      currentX = 0;
      axisLock = null;
    };

    content.addEventListener('touchstart', e => { const t = e.touches[0]; beginPress(t.clientX, t.clientY); }, { passive: true });
    content.addEventListener('touchmove', e => { const t = e.touches[0]; trackMove(t.clientX, t.clientY); }, { passive: true });
    content.addEventListener('touchend', endPress);

    // Mouse parity — useful when previewing the card in a desktop browser.
    content.addEventListener('mousedown', e => beginPress(e.clientX, e.clientY));
    content.addEventListener('mousemove', e => trackMove(e.clientX, e.clientY));
    content.addEventListener('mouseup', endPress);
    content.addEventListener('mouseleave', () => { if (dragging) endPress(); });
  }

  // Collapses any row other than `exceptRow` that's currently swiped open.
  _closeOtherRows(exceptRow) {
    const root = this.shadowRoot;
    root.querySelectorAll('.row.swiped-open').forEach(r => {
      if (r !== exceptRow) this._closeRow(r);
    });
  }

  _closeRow(row) {
    const content = row.querySelector('.swipe-content');
    if (content) content.style.transform = 'translateX(0)';
    row.classList.remove('swiped-open');
    if (this._openRowUid === row.dataset.uid) this._openRowUid = null;
  }

  _escape(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  _plusIcon() { return `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg>`; }
  _dotsIcon() { return `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>`; }
  _pdfIcon() { return `<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-1.5h8V18zm0-3.5H8V13h8v1.5zM13 9V3.5L18.5 9H13z"/></svg>`; }
  _checkIcon() { return `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="#fff" d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z"/></svg>`; }
  _trashIcon() { return `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`; }

  // Home Assistant exposes dark/light mode via hass.themes.darkMode. Colors
  // throughout the card are drawn from this palette instead of being
  // hardcoded, so the card actually follows whichever mode the dashboard
  // is in, extended with a handful of tokens specific to this card's own
  // UI: the add bar, duplicate-item banner, restock suggestion chips,
  // swipeable rows, and the toast/confirm-dialog popups.
  _theme() {
    const dark = this._hass?.themes?.darkMode !== false;
    return dark ? {
      dark: true,
      cardBg: '#13131a', text: '#ffffff', textDim: 'rgba(255,255,255,0.4)',
      textFaint: 'rgba(255,255,255,0.35)',
      border: 'rgba(255,255,255,0.08)',
      iconBtnBg: 'rgba(255,255,255,0.1)', iconBtnColor: 'rgba(255,255,255,0.85)',
      menuBg: 'rgba(30,30,34,0.98)', menuBorder: 'rgba(255,255,255,0.12)',
      menuItemBorder: 'rgba(255,255,255,0.08)', menuItemActive: 'rgba(255,255,255,0.06)',
      menuLabel: 'rgba(255,255,255,0.35)',
      inputBg: 'rgba(255,255,255,0.07)', inputBorder: 'rgba(255,255,255,0.1)', placeholder: 'rgba(255,255,255,0.35)',
      dupBg: 'rgba(255,255,255,0.06)', dupBorder: 'rgba(255,255,255,0.1)', dupCancelBg: 'rgba(255,255,255,0.1)',
      suggestChipBg: 'rgba(255,255,255,0.08)', suggestChipBorder: 'rgba(255,255,255,0.12)',
      emptyText: 'rgba(255,255,255,0.4)', catHeader: 'rgba(255,255,255,0.35)',
      swipeBorder: 'rgba(255,255,255,0.06)',
      checkBorder: 'rgba(255,255,255,0.3)', doneText: 'rgba(255,255,255,0.4)',
      completedBtn: 'rgba(255,255,255,0.85)', tasksDivider: 'rgba(255,255,255,0.08)',
      toastBg: 'rgba(30,30,32,0.97)', toastBorder: 'rgba(255,255,255,0.14)', toastText: 'rgba(255,255,255,0.9)',
      confirmBg: 'rgba(40,40,42,0.94)', confirmBorder: 'rgba(255,255,255,0.12)', confirmDivider: 'rgba(255,255,255,0.14)',
      confirmTitle: '#fff', confirmMsg: 'rgba(255,255,255,0.6)', confirmCancelBorder: 'rgba(255,255,255,0.14)',
    } : {
      dark: false,
      cardBg: '#ffffff', text: '#1c1c1e', textDim: 'rgba(0,0,0,0.45)',
      textFaint: 'rgba(0,0,0,0.35)',
      border: 'rgba(0,0,0,0.08)',
      iconBtnBg: 'rgba(0,0,0,0.06)', iconBtnColor: 'rgba(0,0,0,0.65)',
      menuBg: 'rgba(255,255,255,0.98)', menuBorder: 'rgba(0,0,0,0.1)',
      menuItemBorder: 'rgba(0,0,0,0.08)', menuItemActive: 'rgba(0,0,0,0.05)',
      menuLabel: 'rgba(0,0,0,0.4)',
      inputBg: 'rgba(0,0,0,0.045)', inputBorder: 'rgba(0,0,0,0.1)', placeholder: 'rgba(0,0,0,0.35)',
      dupBg: 'rgba(0,0,0,0.045)', dupBorder: 'rgba(0,0,0,0.1)', dupCancelBg: 'rgba(0,0,0,0.06)',
      suggestChipBg: 'rgba(0,0,0,0.045)', suggestChipBorder: 'rgba(0,0,0,0.1)',
      emptyText: 'rgba(0,0,0,0.4)', catHeader: 'rgba(0,0,0,0.4)',
      swipeBorder: 'rgba(0,0,0,0.08)',
      checkBorder: 'rgba(0,0,0,0.25)', doneText: 'rgba(0,0,0,0.35)',
      completedBtn: 'rgba(0,0,0,0.75)', tasksDivider: 'rgba(0,0,0,0.08)',
      toastBg: 'rgba(255,255,255,0.98)', toastBorder: 'rgba(0,0,0,0.12)', toastText: 'rgba(0,0,0,0.85)',
      confirmBg: 'rgba(255,255,255,0.97)', confirmBorder: 'rgba(0,0,0,0.1)', confirmDivider: 'rgba(0,0,0,0.12)',
      confirmTitle: '#1c1c1e', confirmMsg: 'rgba(0,0,0,0.6)', confirmCancelBorder: 'rgba(0,0,0,0.12)',
    };
  }

  // Quick white-alpha/black-alpha swap for the many small text and panel
  // opacities scattered through the food/task lookup popups and PDF
  // viewer — same opacity value, inverted base colour, the same
  // convention every named token in _theme() above already follows. A
  // full redesign of those three popups around a smaller named-token set
  // (like the rest of this file uses) wasn't worth the churn given how
  // deep and mechanically repetitive that particular tree is; this gets
  // the same correct result with far less risk of missing a spot.
  _ta(opacity) {
    return this._theme().dark ? `rgba(255,255,255,${opacity})` : `rgba(0,0,0,${opacity})`;
  }

  _styles(accent, collapsed) {
    const t = this._theme();
    return `
      :host { display: block; --accent: ${accent}; --tiger-list-max-height: ${Number(this._config.max_list_height) > 0 ? this._config.max_list_height : 340}px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; }
      ha-card {
        background: var(--tiger-bg, ${t.cardBg});
        color: var(--tiger-text, ${t.text});
        border-radius: 24px;
        padding: 16px;
        backdrop-filter: blur(18px) saturate(150%);
        -webkit-backdrop-filter: blur(18px) saturate(150%);
        box-shadow: ${t.dark ? '0 8px 32px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)'};
        ${t.dark ? '' : `border: 1px solid ${t.border};`}
        overflow: hidden;
        position: relative;
        ${collapsed ? '' : 'min-height: 480px;'}
        box-sizing: border-box;
      }
      .header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
      .title-row { display: flex; align-items: center; justify-content: space-between; }
      .title { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
      .warn { color: #ff6b6b; font-size: 12px; }
      .header-right { display: flex; align-items: center; gap: 8px; }
      .menu-wrap { position: relative; }
      .menu-btn { width: 32px; height: 32px; }
      .menu-dropdown {
        position: absolute; top: 40px; right: 0; z-index: 60; min-width: 210px;
        background: ${t.menuBg}; border: 1px solid ${t.menuBorder};
        border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,0.3);
        overflow: hidden; backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
      }
      .menu-item {
        display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box;
        padding: 11px 14px; background: none; border: none; color: ${t.text}; font-size: 13px;
        font-weight: 500; font-family: inherit; cursor: pointer; text-align: left;
        border-bottom: 1px solid ${t.menuItemBorder}; -webkit-tap-highlight-color: transparent;
      }
      .menu-item:last-child { border-bottom: none; }
      .menu-item:active { background: ${t.menuItemActive}; }
      .menu-toggle-item { justify-content: space-between; cursor: default; }
      .menu-toggle-item:active { background: none; }
      .menu-section-label {
        padding: 9px 14px 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
        text-transform: uppercase; color: ${t.menuLabel};
      }
      .menu-section-divider { border-top: 1px solid ${t.menuItemBorder}; margin-top: 4px; }
      .toggle-switch { position: relative; flex-shrink: 0; width: 51px; height: 31px; }
      .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
      .toggle-track { position: absolute; inset: 0; border-radius: 31px; background: rgba(120,120,128,0.32); cursor: pointer; transition: background 0.25s ease; }
      .toggle-track::after { content: ''; position: absolute; width: 27px; height: 27px; border-radius: 50%; background: #fff; top: 2px; left: 2px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); transition: transform 0.25s ease; }
      .toggle-switch input:checked + .toggle-track { background: #34C759; }
      .toggle-switch input:checked + .toggle-track::after { transform: translateX(20px); }
      .toggle-switch.small { width: 38px; height: 22px; }
      .toggle-switch.small .toggle-track::after { width: 18px; height: 18px; top: 2px; left: 2px; }
      .toggle-switch.small input:checked + .toggle-track::after { transform: translateX(16px); }

      .add-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .add-input {
        flex: 1; background: ${t.inputBg}; border: 1px solid ${t.inputBorder};
        border-radius: 12px; padding: 10px 14px; color: ${t.text}; font-size: 15px;
        font-family: inherit; outline: none;
      }
      .add-input::placeholder { color: ${t.placeholder}; }
      .icon-btn {
        background: ${t.iconBtnBg}; border: none; color: ${t.iconBtnColor};
        width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: transform 0.15s ease, background 0.15s ease; flex-shrink: 0;
      }
      .icon-btn:active { transform: scale(0.9); }
      .add-btn { background: var(--accent); color: #fff; }

      .dup-banner {
        background: ${t.dupBg}; border: 1px solid ${t.dupBorder};
        border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; font-size: 13px;
      }
      .dup-actions { display: flex; gap: 8px; margin-top: 8px; }
      .dup-actions button {
        border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; font-family: inherit;
      }
      .dup-add { background: var(--accent); color: #fff; }
      .dup-cancel { background: ${t.dupCancelBg}; color: ${t.text}; }

      .suggest-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; }
      .suggest-label { font-size: 12px; color: ${t.textDim}; margin-right: 2px; }
      .suggest-chip {
        display: inline-flex; align-items: stretch; background: ${t.suggestChipBg};
        border: 1px solid ${t.suggestChipBorder}; border-radius: 14px; overflow: hidden;
      }
      .suggest-chip-add {
        background: none; border: none; color: ${t.text}; padding: 4px 8px 4px 10px;
        font-size: 12px; cursor: pointer; font-family: inherit;
      }
      .suggest-chip-x {
        background: none; border: none; border-left: 1px solid ${t.suggestChipBorder};
        color: ${t.textDim}; padding: 4px 8px; font-size: 10px; cursor: pointer; font-family: inherit;
        display: flex; align-items: center;
      }
      .suggest-chip-x:active { color: ${t.text}; }
      .suggest-clear-all {
        background: none; border: none; color: ${t.textDim}; font-size: 11px;
        cursor: pointer; font-family: inherit; margin-left: 2px; text-decoration: underline;
      }

      .list { display: flex; flex-direction: column; }
      .scroll-region { height: var(--tiger-list-max-height); overflow-y: auto; -webkit-overflow-scrolling: touch; }
      .empty { text-align: center; color: ${t.emptyText}; padding: 24px 0; font-size: 14px; }
      .cat-header {
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
        color: ${t.catHeader}; margin: 14px 0 4px 4px; flex-shrink: 0;
      }
      .cat-header:first-child { margin-top: 0; }

      .row {
        position: relative; overflow: hidden; border-radius: 12px; margin-bottom: 6px;
        width: 100%; box-sizing: border-box; isolation: isolate; -webkit-transform: translateZ(0);
        flex-shrink: 0;
      }
      .swipe-content {
        display: flex; align-items: center; gap: 12px; background: var(--tiger-bg, ${t.cardBg});
        border: 1px solid ${t.swipeBorder}; border-radius: 12px; padding: 12px 14px;
        transition: transform 0.2s ease; position: relative; z-index: 1;
        width: 100%; box-sizing: border-box;
      }
      .delete-btn {
        position: absolute; top: 0; right: 0; bottom: 0; width: 84px; background: #ff3b30;
        border: none; border-radius: 12px; color: #fff; display: flex; align-items: center; justify-content: center;
        cursor: pointer; z-index: 0;
      }
      .check {
        width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${t.checkBorder};
        background: transparent; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: all 0.18s cubic-bezier(0.4,0,0.2,1);
      }
      .check.checked { background: var(--accent); border-color: var(--accent); transform: scale(1.05); }
      .item-text { font-size: 15px; flex: 1; cursor: pointer; }
      .row.done .item-text { text-decoration: line-through; color: ${t.doneText}; }
      .row.compact { margin-bottom: 4px; }
      .row.compact .swipe-content { gap: 10px; padding: 7px 12px; }
      .row.compact .check { width: 19px; height: 19px; }
      .row.compact .item-text { font-size: 13.5px; }
      .item-rename-input {
        font-size: 15px; flex: 1; min-width: 0; font-family: inherit; color: ${t.text};
        background: ${t.inputBg}; border: 1px solid var(--accent); border-radius: 6px;
        padding: 3px 7px; outline: none;
      }

      .completed-toggle { display: flex; align-items: center; justify-content: space-between; margin: 10px 2px 6px; }
      .completed-btn, .clear-btn {
        background: none; border: none; color: ${t.completedBtn}; font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit;
      }
      .clear-btn { color: var(--accent); font-weight: 600; }
      .completed-list .swipe-content { cursor: pointer; }

      .tasks-section {
        margin-top: 14px; padding-top: 14px; border-top: 1px solid ${t.tasksDivider};
      }
      .tasks-toggle-row { margin-top: 0; }

      .tiger-toast {
        position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
        z-index: 50; pointer-events: none;
        background: ${t.toastBg}; border: 1px solid ${t.toastBorder};
        border-radius: 14px; padding: 10px 16px;
        display: flex; align-items: center; gap: 10px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.25);
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        min-width: 180px; max-width: 88%;
        opacity: 0; transition: opacity 0.22s ease; white-space: nowrap;
      }
      .tiger-toast.visible { opacity: 1; }
      .tiger-toast-icon { flex-shrink: 0; width: 18px; height: 18px; }
      .tiger-toast-icon svg { width: 18px; height: 18px; fill: rgba(255,180,50,0.9); display: block; }
      .tiger-toast-text { font-size: 13px; font-weight: 500; color: ${t.toastText}; line-height: 1.4; white-space: normal; }
    `;
  }
}

class TigerTodoCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._initialized = false;
    this._aiSectionOpen = false;
    this._activePicker = null; // 'entity' | 'agent' | null
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) this._render();
  }

  setConfig(config) {
    this._config = {
      title: 'Shopping List',
      accent_color: '#007AFF',
      show_add_bar: true,
      group_by_category: true,
      persistent_storage: false,
      restock_suggestions: true,
      max_list_height: 340,
      todo_entity: '',
      show_tasks_section: true,
      start_collapsed: false,
      compact_mode: false,
      ai_features_enabled: false,
      ai_conversation_agent: '',
      ai_categorize: true,
      ai_duplicate_check: true,
      ai_food_lookup: true,
      ai_task_lookup: true,
      ai_food_lookup_image: true,
      ...config
    };
    if (!this._initialized && this._hass) this._render();
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _updateUi() {
    const root = this.shadowRoot;
    if (!root) return;

    const swatch = root.getElementById('accent-swatch-preview');
    const dot = root.getElementById('accent-dot');
    const val = this._config.accent_color || '#007AFF';
    if (swatch) swatch.style.background = val;
    if (dot) dot.style.background = val;

    const entityVal = root.getElementById('entity-picker-value');
    if (entityVal) entityVal.textContent = this._entityLabel(this._config.entity) || 'Select…';

    const todoEntityVal = root.getElementById('todo-entity-picker-value');
    if (todoEntityVal) todoEntityVal.textContent = this._entityLabel(this._config.todo_entity) || 'None';

    const agentVal = root.getElementById('agent-picker-value');
    if (agentVal) agentVal.textContent = this._agentLabel(this._config.ai_conversation_agent) || 'Default';

    const aiOn = this._config.ai_features_enabled === true;
    root.querySelectorAll('.ai-sub-row').forEach(row => {
      row.style.opacity = aiOn ? '1' : '0.4';
      row.style.pointerEvents = aiOn ? '' : 'none';
    });
    const aiBody = root.getElementById('aiBody');
    if (aiBody) aiBody.style.display = this._aiSectionOpen ? 'flex' : 'none';
    const chevron = root.getElementById('aiChevron');
    if (chevron) chevron.style.transform = this._aiSectionOpen ? 'rotate(90deg)' : '';

    const entityPage = root.getElementById('entityPickerPage');
    if (entityPage) entityPage.style.display = this._activePicker === 'entity' ? 'block' : 'none';
    const todoEntityPage = root.getElementById('todoEntityPickerPage');
    if (todoEntityPage) todoEntityPage.style.display = this._activePicker === 'todo_entity' ? 'block' : 'none';
    const agentPage = root.getElementById('agentPickerPage');
    if (agentPage) agentPage.style.display = this._activePicker === 'agent' ? 'block' : 'none';

    if (this._activePicker === 'entity') this._renderPickerList('entityPickerList', this._todoEntities(), this._config.entity, v => { this._config = { ...this._config, entity: v }; this._activePicker = null; this._updateUi(); this._emit(); });
    if (this._activePicker === 'todo_entity') this._renderPickerList('todoEntityPickerList', this._todoEntities().filter(e => e !== this._config.entity), this._config.todo_entity, v => { this._config = { ...this._config, todo_entity: v }; this._activePicker = null; this._updateUi(); this._emit(); }, true, 'None');
    if (this._activePicker === 'agent') this._renderPickerList('agentPickerList', this._agents(), this._config.ai_conversation_agent, v => { this._config = { ...this._config, ai_conversation_agent: v }; this._activePicker = null; this._updateUi(); this._emit(); }, true);
  }

  _todoEntities() { return Object.keys(this._hass.states).filter(e => e.startsWith('todo.')); }
  _agents() { return Object.keys(this._hass.states).filter(e => e.startsWith('conversation.')); }
  _entityLabel(id) { return id ? (this._hass.states[id]?.attributes?.friendly_name || id) : ''; }
  _agentLabel(id) { return id ? (this._hass.states[id]?.attributes?.friendly_name || id) : ''; }

  _renderPickerList(listId, ids, currentVal, onSelect, allowNone, noneLabel = 'Default') {
    const root = this.shadowRoot;
    const list = root.getElementById(listId);
    if (!list) return;
    const rows = [];
    if (allowNone) {
      rows.push({ id: '', label: noneLabel });
    }
    ids.forEach(id => rows.push({ id, label: this._hass.states[id]?.attributes?.friendly_name || id }));
    list.innerHTML = rows.map(r => `
      <div class="picker-item" data-val="${this._escapeAttr(r.id)}">
        <span class="picker-item-label">${this._escapeHtml(r.label)}</span>
        ${r.id === (currentVal || '') ? `<svg class="picker-check" viewBox="0 0 24 24"><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z"/></svg>` : ''}
      </div>
    `).join('');
    list.querySelectorAll('.picker-item').forEach(el => {
      el.addEventListener('click', () => onSelect(el.dataset.val));
    });
  }

  _escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  _escapeAttr(str) { return this._escapeHtml(str); }

  _render() {
    if (!this._hass || !this._config) return;
    this._initialized = true;

    this.shadowRoot.innerHTML = `
      <style>
        .container { display: flex; flex-direction: column; gap: 20px; padding: 12px; color: var(--primary-text-color); font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; position: relative; }
        .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px; }
        .card-block { background: var(--card-background-color); border: 1px solid var(--divider-color, rgba(128,128,128,0.2)); border-radius: 12px; overflow: hidden; }

        .select-row { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
        .select-row label { font-size: 14px; font-weight: 500; }
        .select-row .hint { font-size: 11px; color: #888; margin-top: -2px; line-height: 1.4; }
        input[type="text"] {
          width: 100%; box-sizing: border-box; background: var(--card-background-color); color: var(--primary-text-color);
          border: 1px solid var(--divider-color, rgba(128,128,128,0.2)); border-radius: 8px;
          padding: 10px 12px; font-size: 14px; font-family: inherit;
        }

        /* Tap-to-open picker row (replaces native <select> — avoids the
           WKWebView bug where a native select inside shadow DOM can be
           dismissed the instant an option is tapped) */
        .picker-row {
          display: flex; align-items: center; justify-content: space-between; padding: 13px 16px;
          cursor: pointer; -webkit-tap-highlight-color: transparent; min-height: 52px;
        }
        .picker-row-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .picker-row-label { font-size: 14px; font-weight: 500; }
        .picker-row-hint { font-size: 11px; color: #888; line-height: 1.4; }
        .picker-row-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 12px; }
        .picker-row-value { font-size: 14px; color: #888; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .picker-chevron { width: 18px; height: 18px; fill: var(--secondary-text-color, rgba(0,0,0,0.4)); flex-shrink: 0; }

        .picker-page {
          display: none; position: absolute; inset: 0; background: var(--card-background-color, #1c1c1e);
          z-index: 20; overflow-y: auto; padding: 12px; box-sizing: border-box; border-radius: 12px;
        }
        .picker-page-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .picker-back-btn { background: none; border: none; padding: 6px; margin: -6px; cursor: pointer; display: flex; align-items: center; -webkit-tap-highlight-color: transparent; }
        .picker-back-icon { width: 22px; height: 22px; fill: var(--primary-color, #007AFF); }
        .picker-page-title { font-size: 17px; font-weight: 700; }
        .picker-list { border: 1px solid var(--divider-color, rgba(128,128,128,0.2)); border-radius: 12px; overflow: hidden; }
        .picker-item {
          display: flex; align-items: center; justify-content: space-between; padding: 13px 16px;
          border-bottom: 1px solid var(--divider-color, rgba(128,128,128,0.2)); cursor: pointer;
          -webkit-tap-highlight-color: transparent; min-height: 48px;
        }
        .picker-item:last-child { border-bottom: none; }
        .picker-item-label { font-size: 14px; }
        .picker-check { width: 18px; height: 18px; fill: var(--primary-color, #007AFF); flex-shrink: 0; }

        .colour-card { display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; }
        .colour-swatch { position: relative; width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; overflow: hidden; border: 1px solid var(--divider-color, rgba(0,0,0,0.12)); }
        .colour-swatch input[type="color"] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: none; padding: 0; }
        .colour-swatch-preview { position: absolute; inset: 0; pointer-events: none; }
        .colour-info { flex: 1; min-width: 0; }
        .colour-label { font-size: 14px; font-weight: 500; }
        .colour-hex-row { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
        .colour-dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.15); flex-shrink: 0; }
        .colour-hex { flex: 1; font-size: 12px; font-family: monospace; border: none; background: none; color: var(--secondary-text-color, #888); padding: 0; }
        .colour-hex:focus { outline: none; color: var(--primary-text-color); }

        .toggle-list { display: flex; flex-direction: column; }
        .toggle-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--divider-color, rgba(128,128,128,0.2)); min-height: 52px; }
        .toggle-item:last-child { border-bottom: none; }
        .toggle-label { font-size: 14px; font-weight: 500; }
        .toggle-hint { font-size: 11px; color: #888; margin-top: 2px; line-height: 1.4; }
        .toggle-switch { position: relative; width: 51px; height: 31px; flex-shrink: 0; margin-top: 2px; }
        .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .toggle-track { position: absolute; inset: 0; border-radius: 31px; background: rgba(120,120,128,0.32); cursor: pointer; transition: background 0.25s ease; }
        .toggle-track::after { content: ''; position: absolute; width: 27px; height: 27px; border-radius: 50%; background: #fff; top: 2px; left: 2px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); transition: transform 0.25s ease; }
        .toggle-switch input:checked + .toggle-track { background: #34C759; }
        .toggle-switch input:checked + .toggle-track::after { transform: translateX(20px); }

        .section-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; -webkit-tap-highlight-color: transparent; padding: 12px 16px; }
        .section-header-left { display: flex; align-items: center; gap: 10px; }
        .section-icon { width: 28px; height: 28px; border-radius: 8px; background: rgba(99,179,237,0.15); border: 1px solid rgba(99,179,237,0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .section-heading { font-size: 14px; font-weight: 600; }
        .section-subheading { font-size: 11px; color: #888; margin-top: 1px; }
        .chevron { width: 18px; height: 18px; fill: var(--secondary-text-color, rgba(0,0,0,0.5)); transition: transform 0.25s ease; flex-shrink: 0; }
      </style>

      <div class="container">
        <div>
          <div class="section-title">Todo List</div>
          <div class="card-block">
            <div class="picker-row" id="entityPickerRow">
              <div class="picker-row-left">
                <div class="picker-row-label">Entity</div>
              </div>
              <div class="picker-row-right">
                <span class="picker-row-value" id="entity-picker-value">${this._entityLabel(this._config.entity) || 'Select…'}</span>
                <svg class="picker-chevron" viewBox="0 0 24 24"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Tasks List (Optional)</div>
          <div class="card-block">
            <div class="picker-row" id="todoEntityPickerRow">
              <div class="picker-row-left">
                <div class="picker-row-label">Entity</div>
                <div class="picker-row-hint">A second, separate to-do list shown as its own collapsible section — plain checklist, no shopping-specific AI features.</div>
              </div>
              <div class="picker-row-right">
                <span class="picker-row-value" id="todo-entity-picker-value">${this._entityLabel(this._config.todo_entity) || 'None'}</span>
                <svg class="picker-chevron" viewBox="0 0 24 24"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
              </div>
            </div>
            <div class="toggle-list" style="border-top: 1px solid var(--divider-color, rgba(128,128,128,0.2));">
              <div class="toggle-item">
                <div><div class="toggle-label">Show Tasks Section</div><div class="toggle-hint">Only applies once a Tasks List entity is selected above.</div></div>
                <label class="toggle-switch"><input type="checkbox" id="show_tasks_section" ${this._config.show_tasks_section !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Appearance</div>
          <div class="card-block">
            <div class="select-row" style="border-bottom: 1px solid var(--divider-color, rgba(128,128,128,0.2));">
              <label>Title</label>
              <input type="text" id="title" value="${this._escapeHtml(this._config.title || '')}" placeholder="Shopping List" />
            </div>
            <div class="colour-card">
              <label class="colour-swatch">
                <input type="color" id="accent_color_picker" value="${/^#[0-9a-fA-F]{6}$/.test(this._config.accent_color || '') ? this._config.accent_color : '#007AFF'}">
                <span class="colour-swatch-preview" id="accent-swatch-preview" style="background:${this._config.accent_color || '#007AFF'};"></span>
              </label>
              <div class="colour-info">
                <div class="colour-label">Accent color</div>
                <div class="colour-hex-row">
                  <span class="colour-dot" id="accent-dot" style="background:${this._config.accent_color || '#007AFF'};"></span>
                  <input class="colour-hex" id="accent_color" value="${this._escapeHtml(this._config.accent_color || '#007AFF')}" spellcheck="false" autocomplete="off">
                </div>
              </div>
            </div>
            <div class="select-row" style="border-top: 1px solid var(--divider-color, rgba(128,128,128,0.2));">
              <label>Max List Height (px)</label>
              <div class="hint">The item list scrolls internally past this height, instead of the whole card growing as you add items.</div>
              <input type="text" inputmode="numeric" id="max_list_height" value="${this._config.max_list_height ?? 340}" placeholder="340" />
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">General</div>
          <div class="card-block">
            <div class="toggle-list">
              <div class="toggle-item">
                <div><div class="toggle-label">Show Add Bar</div><div class="toggle-hint">Shows the input for typing in new items.</div></div>
                <label class="toggle-switch"><input type="checkbox" id="show_add_bar" ${this._config.show_add_bar !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <div><div class="toggle-label">Group by Category</div><div class="toggle-hint">Groups active items into sections like Produce and Dairy.</div></div>
                <label class="toggle-switch"><input type="checkbox" id="group_by_category" ${this._config.group_by_category !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <div><div class="toggle-label">Restock Reminders</div><div class="toggle-hint">Suggests re-adding items you buy on a regular basis.</div></div>
                <label class="toggle-switch"><input type="checkbox" id="restock_suggestions" ${this._config.restock_suggestions !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <div><div class="toggle-label">Sync Across Devices</div><div class="toggle-hint">Keeps categories and history synced to your HA account, not just this device.</div></div>
                <label class="toggle-switch"><input type="checkbox" id="persistent_storage" ${this._config.persistent_storage ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <div><div class="toggle-label">Start Collapsed</div><div class="toggle-hint">Default when the card loads — shows just the title and a one-line summary instead of the full list. Can be changed anytime with the chevron (or by tapping the title) in the card's header, which remembers the last choice.</div></div>
                <label class="toggle-switch"><input type="checkbox" id="start_collapsed" ${this._config.start_collapsed === true ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <div><div class="toggle-label">Compact Mode</div><div class="toggle-hint">Default when the card loads — tighter single-line rows (smaller checkbox, less padding) to fit more items on screen. Can be changed anytime from the card's own ⋮ menu, which remembers the last choice.</div></div>
                <label class="toggle-switch"><input type="checkbox" id="compact_mode" ${this._config.compact_mode === true ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">AI Features</div>
          <div class="card-block">
            <div id="aiHeader" class="section-header">
              <div class="section-header-left">
                <div class="section-icon">
                  <svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:rgba(99,179,237,0.9);"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z"/></svg>
                </div>
                <div>
                  <div class="section-heading">AI Features</div>
                  <div class="section-subheading">Quick add · Categorize · Duplicates</div>
                </div>
              </div>
              <svg id="aiChevron" class="chevron" viewBox="0 0 24 24"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div id="aiBody" style="display:none; flex-direction: column;">
              <div class="toggle-list">
                <div class="toggle-item">
                  <div><div class="toggle-label">Enable AI Features</div><div class="toggle-hint">Master switch — off by default. Nothing AI-related happens until this is on and an assistant is selected below.</div></div>
                  <label class="toggle-switch"><input type="checkbox" id="ai_features_enabled" ${this._config.ai_features_enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
                </div>
              </div>
              <div class="ai-sub-row" style="border-top: 1px solid var(--divider-color, rgba(128,128,128,0.2));">
                <div class="picker-row" id="agentPickerRow">
                  <div class="picker-row-left">
                    <div class="picker-row-label">Conversation Agent</div>
                    <div class="picker-row-hint">Which HA assistant handles AI requests.</div>
                  </div>
                  <div class="picker-row-right">
                    <span class="picker-row-value" id="agent-picker-value">${this._agentLabel(this._config.ai_conversation_agent) || 'Default'}</span>
                    <svg class="picker-chevron" viewBox="0 0 24 24"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
                  </div>
                </div>
              </div>
              <div class="toggle-list ai-sub-row" style="border-top: 1px solid var(--divider-color, rgba(128,128,128,0.2));">
                <div class="toggle-item">
                  <div><div class="toggle-label">Auto-Sort by Aisle</div><div class="toggle-hint">Automatically groups items into store sections.</div></div>
                  <label class="toggle-switch"><input type="checkbox" id="ai_categorize" ${this._config.ai_categorize !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item">
                  <div><div class="toggle-label">Duplicate Warning</div><div class="toggle-hint">Warns before adding something already on the list.</div></div>
                  <label class="toggle-switch"><input type="checkbox" id="ai_duplicate_check" ${this._config.ai_duplicate_check !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item">
                  <div><div class="toggle-label">Product Lookup (Long-Press)</div><div class="toggle-hint">Long-press an item to see its category, pack size, and other general info.</div></div>
                  <label class="toggle-switch"><input type="checkbox" id="ai_food_lookup" ${this._config.ai_food_lookup !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
                </div>
                <div class="toggle-item">
                  <div><div class="toggle-label">Show Item Photo</div><div class="toggle-hint">Shows a freely-licensed thumbnail image in the lookup popup, when a decent match is found.</div></div>
                  <label class="toggle-switch"><input type="checkbox" id="ai_food_lookup_image" ${this._config.ai_food_lookup_image !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
                </div>
                ${this._config.todo_entity ? `
                <div class="toggle-item">
                  <div><div class="toggle-label">Task Info (Long-Press)</div><div class="toggle-hint">Long-press a task to see its category, estimated time, tools needed, and tips.</div></div>
                  <label class="toggle-switch"><input type="checkbox" id="ai_task_lookup" ${this._config.ai_task_lookup !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
                </div>` : ''}
              </div>
            </div>
          </div>
        </div>

        <!-- ── Picker pages (pushed over the editor, iOS Settings-style) ── -->
        <div id="entityPickerPage" class="picker-page">
          <div class="picker-page-header">
            <button class="picker-back-btn" id="entityPickerBack">
              <svg class="picker-back-icon" viewBox="0 0 24 24"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
            </button>
            <div class="picker-page-title">Entity</div>
          </div>
          <div class="picker-list" id="entityPickerList"></div>
        </div>

        <div id="todoEntityPickerPage" class="picker-page">
          <div class="picker-page-header">
            <button class="picker-back-btn" id="todoEntityPickerBack">
              <svg class="picker-back-icon" viewBox="0 0 24 24"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
            </button>
            <div class="picker-page-title">Tasks List Entity</div>
          </div>
          <div class="picker-list" id="todoEntityPickerList"></div>
        </div>

        <div id="agentPickerPage" class="picker-page">
          <div class="picker-page-header">
            <button class="picker-back-btn" id="agentPickerBack">
              <svg class="picker-back-icon" viewBox="0 0 24 24"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>
            </button>
            <div class="picker-page-title">Conversation Agent</div>
          </div>
          <div class="picker-list" id="agentPickerList"></div>
        </div>
      </div>
    `;

    const root = this.shadowRoot;
    const on = (id, evt, fn) => { const el = root.getElementById(id); if (el) el.addEventListener(evt, fn); };

    on('title', 'input', e => { this._config = { ...this._config, title: e.target.value }; this._emit(); });
    on('max_list_height', 'change', e => {
      const n = parseInt(e.target.value, 10);
      this._config = { ...this._config, max_list_height: Number.isFinite(n) && n > 0 ? n : 340 };
      this._emit();
    });
    on('accent_color', 'change', e => { this._config = { ...this._config, accent_color: e.target.value }; this._updateUi(); this._emit(); });
    on('accent_color_picker', 'input', e => {
      this._config = { ...this._config, accent_color: e.target.value };
      const hexInput = root.getElementById('accent_color');
      if (hexInput) hexInput.value = e.target.value;
      this._updateUi(); this._emit();
    });
    on('show_add_bar', 'change', e => { this._config = { ...this._config, show_add_bar: e.target.checked }; this._emit(); });
    on('group_by_category', 'change', e => { this._config = { ...this._config, group_by_category: e.target.checked }; this._emit(); });
    on('restock_suggestions', 'change', e => { this._config = { ...this._config, restock_suggestions: e.target.checked }; this._emit(); });
    on('show_tasks_section', 'change', e => { this._config = { ...this._config, show_tasks_section: e.target.checked }; this._emit(); });
    on('persistent_storage', 'change', e => { this._config = { ...this._config, persistent_storage: e.target.checked }; this._emit(); });
    on('start_collapsed', 'change', e => { this._config = { ...this._config, start_collapsed: e.target.checked }; this._emit(); });
    on('compact_mode', 'change', e => { this._config = { ...this._config, compact_mode: e.target.checked }; this._emit(); });
    on('ai_features_enabled', 'change', e => { this._config = { ...this._config, ai_features_enabled: e.target.checked }; this._updateUi(); this._emit(); });
    on('ai_categorize', 'change', e => { this._config = { ...this._config, ai_categorize: e.target.checked }; this._emit(); });
    on('ai_duplicate_check', 'change', e => { this._config = { ...this._config, ai_duplicate_check: e.target.checked }; this._emit(); });
    on('ai_food_lookup', 'change', e => { this._config = { ...this._config, ai_food_lookup: e.target.checked }; this._emit(); });
    on('ai_food_lookup_image', 'change', e => { this._config = { ...this._config, ai_food_lookup_image: e.target.checked }; this._emit(); });
    on('ai_task_lookup', 'change', e => { this._config = { ...this._config, ai_task_lookup: e.target.checked }; this._emit(); });

    on('aiHeader', 'click', () => { this._aiSectionOpen = !this._aiSectionOpen; this._updateUi(); });
    on('entityPickerRow', 'click', () => { this._activePicker = 'entity'; this._updateUi(); });
    on('todoEntityPickerRow', 'click', () => { this._activePicker = 'todo_entity'; this._updateUi(); });
    on('agentPickerRow', 'click', () => { this._activePicker = 'agent'; this._updateUi(); });
    on('entityPickerBack', 'click', () => { this._activePicker = null; this._updateUi(); });
    on('todoEntityPickerBack', 'click', () => { this._activePicker = null; this._updateUi(); });
    on('agentPickerBack', 'click', () => { this._activePicker = null; this._updateUi(); });

    this._updateUi();
  }
}

customElements.define('crow-todo-card', TigerTodoCard);
customElements.define('crow-todo-card-editor', TigerTodoCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'crow-todo-card',
  name: 'Crow Todo Card',
  description: 'Apple-style shopping/todo list card with optional AI quick-add, categorization, and duplicate detection.'
});
