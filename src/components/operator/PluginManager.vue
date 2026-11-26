<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import type { LuaBindingDocs } from 'webluabridge';
import { dashboardRequest } from '../../lib/dashboard-api';
import type { ActivityEvent } from '../../lib/activity/types';
import type { LuaPluginEntity, LuaSharedModule } from '../../lib/lua-host';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import JsonEditor from '../ui/JsonEditor.vue';
import LuaEditor from './LuaEditor.vue';

interface UnifiedPlugin {
    id: string;
    name: string;
    description: string;
    version: string;
    filename: string;
    entrypoint: string;
    fileCount: number;
    config: Record<string, unknown>;
    enabled: boolean;
    source: 'filesystem' | 'lua';
    status: 'active' | 'disabled' | 'error';
    error?: string;
}

interface PluginStatusResponse {
    plugins: UnifiedPlugin[];
    scheduler: { intervalMs: number; running: boolean };
}

const plugins = ref<UnifiedPlugin[]>([]);
const luaEntities = ref<LuaPluginEntity[]>([]);
const sharedModules = ref<LuaSharedModule[]>([]);
const luaDocs = ref<LuaBindingDocs[]>([]);
const scheduler = ref({ intervalMs: 0, running: false });
const interval = ref(0);

const selectedId = ref<string | null>(null);
const activeTab = ref<'logs' | 'configuration' | 'details'>('logs');
const configDraft = ref('{}');

// Live log stream state
const logs = ref<ActivityEvent[]>([]);
const logsPaused = ref(false);
const logLevel = ref<'all' | 'info' | 'warn' | 'error'>('all');
let eventSource: EventSource | undefined;

// Source Workspace Modal state (shared by Create & Source)
const workspace = reactive<{
    open: boolean;
    mode: 'create' | 'edit';
    id: string;
    name: string;
    description: string;
    version: string;
    entrypoint: string;
    files: { path: string; content: string }[];
    activeFile: string;
    newFileName: string;
    addingFile: boolean;
}>({
    open: false,
    mode: 'create',
    id: '',
    name: '',
    description: '',
    version: '1.0.0',
    entrypoint: 'main.lua',
    files: [],
    activeFile: 'main.lua',
    newFileName: '',
    addingFile: false,
});

// Shared Module Modal state
const moduleModal = reactive<{
    open: boolean;
    isNew: boolean;
    name: string;
    description: string;
    content: string;
}>({
    open: false,
    isNew: true,
    name: '',
    description: '',
    content: '',
});

const confirmDialog = ref<{ title: string; message: string; confirmLabel: string; run: () => Promise<void> } | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const base = '/api/v1/operator';
const timeFmt = new Intl.DateTimeFormat(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const selectedPlugin = computed(() => plugins.value.find(p => p.id === selectedId.value) ?? plugins.value[0] ?? null);
const selectedLuaEntity = computed(() => luaEntities.value.find(p => p.id === selectedPlugin.value?.id) ?? null);
const activeFileObj = computed(() => workspace.files.find(f => f.path === workspace.activeFile) ?? null);

const filteredLogs = computed(() => {
    const target = selectedPlugin.value;
    if (!target) return [];
    const sourceKey = target.source === 'lua' ? target.id : target.name;
    return logs.value.filter(ev => {
        if (ev.source !== sourceKey) return false;
        if (logLevel.value !== 'all' && (ev.level ?? 'info') !== logLevel.value) return false;
        return true;
    });
});

async function load() {
    try {
        const [pluginsRes, luaRes] = await Promise.all([
            dashboardRequest<PluginStatusResponse>(`${base}/plugins`),
            dashboardRequest<{ plugins: LuaPluginEntity[]; sharedModules: LuaSharedModule[]; docs: LuaBindingDocs[] }>(`${base}/lua`),
        ]);
        plugins.value = pluginsRes.plugins;
        scheduler.value = pluginsRes.scheduler;
        interval.value = pluginsRes.scheduler.intervalMs;
        luaEntities.value = luaRes.plugins;
        sharedModules.value = luaRes.sharedModules;
        luaDocs.value = luaRes.docs;

        if (!selectedId.value && plugins.value.length) {
            selectPlugin(plugins.value[0]!);
        } else if (selectedPlugin.value) {
            configDraft.value = JSON.stringify(selectedPlugin.value.config ?? {}, null, 2);
            await loadLogsFor(selectedPlugin.value);
        }
    } catch (cause) {
        error.value = (cause as Error).message;
    }
}

async function loadLogsFor(plugin: UnifiedPlugin) {
    const sourceKey = plugin.source === 'lua' ? plugin.id : plugin.name;
    try {
        const res = await dashboardRequest<{ events: ActivityEvent[] }>(`${base}/plugins?logs=${encodeURIComponent(sourceKey)}`);
        const existingIds = new Set(res.events.map(e => e.id));
        const others = logs.value.filter(e => !existingIds.has(e.id));
        logs.value = [...res.events, ...others].slice(0, 300);
    } catch { /* Non-fatal */ }
}

function selectPlugin(plugin: UnifiedPlugin) {
    selectedId.value = plugin.id;
    configDraft.value = JSON.stringify(plugin.config ?? {}, null, 2);
    if (activeTab.value === 'configuration' && plugin.source !== 'lua') {
        activeTab.value = 'logs';
    }
    void loadLogsFor(plugin);
}

function openCreateWorkspace() {
    workspace.mode = 'create';
    workspace.id = '';
    workspace.name = '';
    workspace.description = '';
    workspace.version = '1.0.0';
    workspace.entrypoint = 'main.lua';
    workspace.files = [
        {
            path: 'main.lua',
            content: `-- Substratum Lua Plugin\nlocal M = {}\n\nfunction M.init()\n  local stats = world.stats()\n  plugin.log("info", "Initialized · cells=" .. tostring(stats.cells))\nend\n\nfunction M.onSpatialChange(event)\n  -- Handle spatial:change events\nend\n\nreturn M\n`,
        },
    ];
    workspace.activeFile = 'main.lua';
    workspace.addingFile = false;
    workspace.newFileName = '';
    workspace.open = true;
}

function openSourceWorkspace() {
    const entity = selectedLuaEntity.value;
    if (!entity) return;
    workspace.mode = 'edit';
    workspace.id = entity.id;
    workspace.name = entity.name;
    workspace.description = entity.description;
    workspace.version = entity.version;
    workspace.entrypoint = entity.entrypoint;
    workspace.files = entity.files.map(f => ({ path: f.path, content: f.content }));
    workspace.activeFile = entity.entrypoint;
    workspace.addingFile = false;
    workspace.newFileName = '';
    workspace.open = true;
}

function addWorkspaceFile() {
    const path = workspace.newFileName.trim().replace(/^\/+/, '');
    if (!path) return;
    if (workspace.files.some(f => f.path === path)) {
        error.value = `File "${path}" already exists in this plugin.`;
        return;
    }
    workspace.files.push({
        path,
        content: path.endsWith('.lua') ? `local M = {}\n\nreturn M\n` : `# ${workspace.name || 'Plugin'}\n`,
    });
    workspace.activeFile = path;
    workspace.newFileName = '';
    workspace.addingFile = false;
}

function removeWorkspaceFile(path: string) {
    if (path === workspace.entrypoint) return;
    workspace.files = workspace.files.filter(f => f.path !== path);
    if (workspace.activeFile === path) workspace.activeFile = workspace.entrypoint;
}

async function saveWorkspace(closeAfter = false) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        const id = workspace.id.trim() || workspace.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
        const res = await dashboardRequest<{ plugin: LuaPluginEntity }>(`${base}/lua`, {
            method: 'POST',
            body: JSON.stringify({
                operation: workspace.mode === 'create' ? 'create-plugin' : 'save-plugin',
                id,
                name: workspace.name.trim() || id,
                description: workspace.description,
                version: workspace.version,
                entrypoint: workspace.entrypoint,
                files: workspace.files,
            }),
        });
        selectedId.value = res.plugin.id;
        notice.value = `Saved and reloaded "${res.plugin.name}".`;
        if (closeAfter) workspace.open = false;
        else workspace.mode = 'edit';
        await load();
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
    }
}

async function savePluginConfig() {
    const entity = selectedLuaEntity.value;
    if (!entity || busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        const parsed = JSON.parse(configDraft.value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new TypeError('Configuration must be a JSON object.');
        }
        await dashboardRequest(`${base}/lua`, {
            method: 'POST',
            body: JSON.stringify({
                operation: 'save-plugin',
                id: entity.id,
                name: entity.name,
                description: entity.description,
                version: entity.version,
                entrypoint: entity.entrypoint,
                files: entity.files.map(f => ({ path: f.path, content: f.content })),
                config: parsed,
            }),
        });
        notice.value = `Updated configuration for "${entity.name}".`;
        await load();
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
    }
}

async function toggleSelected() {
    const target = selectedPlugin.value;
    if (!target || busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        await dashboardRequest(`${base}/plugins`, {
            method: 'POST',
            body: JSON.stringify({ filename: target.id, enabled: !target.enabled }),
        });
        notice.value = `${target.name} ${target.enabled ? 'disabled' : 'enabled'}.`;
        await load();
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
    }
}

async function reloadSelected() {
    const target = selectedPlugin.value;
    if (!target || target.source !== 'lua' || busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        await dashboardRequest(`${base}/lua`, {
            method: 'POST',
            body: JSON.stringify({ operation: 'reload-plugin', id: target.id }),
        });
        notice.value = `Reloaded "${target.name}".`;
        await load();
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
    }
}

function promptDeletePlugin() {
    const target = selectedPlugin.value;
    if (!target || target.source !== 'lua') return;
    confirmDialog.value = {
        title: `Delete plugin "${target.name}"`,
        message: `Permanently delete "${target.name}" and all ${target.fileCount} of its source files?`,
        confirmLabel: 'Delete plugin',
        run: async () => {
            busy.value = true;
            try {
                await dashboardRequest(`${base}/lua`, {
                    method: 'POST',
                    body: JSON.stringify({ operation: 'delete-plugin', id: target.id }),
                });
                selectedId.value = null;
                notice.value = `Deleted "${target.name}".`;
                await load();
            } catch (cause) { error.value = (cause as Error).message; }
            finally { busy.value = false; confirmDialog.value = null; }
        },
    };
}

function openModuleEditor(mod?: LuaSharedModule) {
    moduleModal.isNew = !mod;
    moduleModal.name = mod?.name ?? '';
    moduleModal.description = mod?.description ?? '';
    moduleModal.content = mod?.content ?? `local M = {}\n\nreturn M\n`;
    moduleModal.open = true;
}

async function saveModule() {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        await dashboardRequest(`${base}/lua`, {
            method: 'POST',
            body: JSON.stringify({
                operation: 'save-module',
                name: moduleModal.name,
                description: moduleModal.description,
                content: moduleModal.content,
            }),
        });
        notice.value = `Saved shared module "${moduleModal.name}".`;
        moduleModal.open = false;
        await load();
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
    }
}

function promptDeleteModule(mod: LuaSharedModule) {
    confirmDialog.value = {
        title: `Delete shared module "${mod.name}"`,
        message: 'Plugins that require this module will fail on reload until updated.',
        confirmLabel: 'Delete module',
        run: async () => {
            busy.value = true;
            try {
                await dashboardRequest(`${base}/lua`, {
                    method: 'POST',
                    body: JSON.stringify({ operation: 'delete-module', name: mod.name }),
                });
                notice.value = `Deleted shared module "${mod.name}".`;
                await load();
            } catch (cause) { error.value = (cause as Error).message; }
            finally { busy.value = false; confirmDialog.value = null; }
        },
    };
}

async function saveScheduler() {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        await dashboardRequest(`${base}/scheduler`, {
            method: 'POST',
            body: JSON.stringify({ intervalMs: interval.value }),
        });
        notice.value = interval.value === 0 ? 'Scheduler stopped.' : `Scheduler set to ${interval.value} ms.`;
        await load();
    } catch (cause) { error.value = (cause as Error).message; }
    finally { busy.value = false; }
}

onMounted(() => {
    void load();
    eventSource = new EventSource('/api/v1/events?activity=1');
    eventSource.addEventListener('activity', event => {
        if (logsPaused.value) return;
        const item = JSON.parse(event.data) as ActivityEvent;
        if (item.category === 'diagnostic' && item.source) {
            if (!logs.value.some(existing => existing.id === item.id)) {
                logs.value = [item, ...logs.value].slice(0, 300);
            }
        }
    });
});
onUnmounted(() => eventSource?.close());
</script>

<template>
  <div class="workspace-stack">
    <ConfirmDialog
      :open="!!confirmDialog"
      :title="confirmDialog?.title ?? ''"
      :message="confirmDialog?.message ?? ''"
      :confirm-label="confirmDialog?.confirmLabel"
      danger
      :busy="busy"
      @cancel="confirmDialog = null"
      @confirm="confirmDialog?.run()"
    />

    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="workspace-notice" role="status">{{ notice }}</p>

    <!-- Top action bar -->
    <div class="plugins-topbar">
      <span class="badge" :class="scheduler.running ? 'ok' : ''">
        Scheduler: {{ scheduler.running ? `${scheduler.intervalMs} ms` : 'Stopped' }}
      </span>
      <button class="workspace-primary" type="button" @click="openCreateWorkspace">+ Create plugin</button>
    </div>

    <!-- Main 2-column Plugins Workspace -->
    <div class="plugins-grid">
      <aside class="workspace-panel plugins-list-panel">
        <div class="nav-heading" style="margin:0 0 10px">INSTALLED PLUGINS ({{ plugins.length }})</div>
        <p v-if="!plugins.length">No plugins installed yet.</p>
        <div v-else class="plugin-card-list">
          <button
            v-for="plugin in plugins"
            :key="plugin.id"
            type="button"
            class="plugin-card"
            :class="{ active: selectedPlugin?.id === plugin.id }"
            @click="selectPlugin(plugin)"
          >
            <strong>{{ plugin.name }}</strong>
            <div class="plugin-card-meta">
              <span class="status-dot" :class="plugin.status"></span>
              <span>{{ plugin.status === 'active' ? 'Running' : plugin.status === 'error' ? 'Error' : 'Disabled' }}</span>
              <span>·</span>
              <span>{{ plugin.source === 'lua' ? `Lua · v${plugin.version}` : 'TypeScript' }}</span>
            </div>
          </button>
        </div>
      </aside>

      <section class="workspace-panel plugin-detail-panel">
        <template v-if="selectedPlugin">
          <div class="plugin-detail-head">
            <div>
              <h2>{{ selectedPlugin.name }}</h2>
              <div class="plugin-card-meta">
                <span class="badge" :class="selectedPlugin.status === 'active' ? 'ok' : selectedPlugin.status === 'error' ? 'err' : ''">
                  {{ selectedPlugin.status === 'active' ? 'Running' : selectedPlugin.status === 'error' ? 'Error' : 'Disabled' }}
                </span>
                <span>{{ selectedPlugin.source === 'lua' ? `Lua · v${selectedPlugin.version}` : 'TypeScript (filesystem)' }}</span>
              </div>
            </div>
            <div class="workspace-actions">
              <button v-if="selectedPlugin.source === 'lua'" type="button" :disabled="busy" @click="reloadSelected">Reload</button>
              <button type="button" :disabled="busy" @click="toggleSelected">{{ selectedPlugin.enabled ? 'Disable' : 'Enable' }}</button>
              <button v-if="selectedPlugin.source === 'lua'" class="workspace-danger" type="button" :disabled="busy" @click="promptDeletePlugin">Delete</button>
            </div>
          </div>

          <p v-if="selectedPlugin.error" class="workspace-error" style="margin:12px 0">{{ selectedPlugin.error }}</p>

          <!-- Plugin Tabs -->
          <div class="plugin-tabs" role="tablist">
            <button v-if="selectedPlugin.source === 'lua'" type="button" class="plugin-tab" @click="openSourceWorkspace">Source</button>
            <button v-if="selectedPlugin.source === 'lua'" type="button" class="plugin-tab" :class="{ active: activeTab === 'configuration' }" @click="activeTab = 'configuration'">Configuration</button>
            <button type="button" class="plugin-tab" :class="{ active: activeTab === 'logs' }" @click="activeTab = 'logs'">Logs</button>
            <button type="button" class="plugin-tab" :class="{ active: activeTab === 'details' }" @click="activeTab = 'details'">Details</button>
          </div>

          <!-- Logs Tab -->
          <div v-if="activeTab === 'logs'" class="log-stream-box">
            <div class="log-stream-bar">
              <span class="live-indicator" :class="{ offline: logsPaused }"><i></i>{{ logsPaused ? 'Paused' : 'Live log stream' }} · {{ filteredLogs.length }} entries</span>
              <div class="workspace-actions" style="margin-left:auto">
                <button type="button" @click="logsPaused = !logsPaused">{{ logsPaused ? 'Resume' : 'Pause' }}</button>
                <button type="button" @click="logs = []">Clear view</button>
                <select v-model="logLevel" aria-label="Filter log level" style="width:auto">
                  <option value="all">All levels</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
              </div>
            </div>
            <div class="log-entries">
              <p v-if="!filteredLogs.length" class="empty-state">No log entries for this plugin yet.</p>
              <div v-for="entry in filteredLogs" :key="entry.id" class="log-line">
                <span class="log-time">[{{ timeFmt.format(entry.time) }}]</span>
                <span class="badge" :class="entry.level === 'error' ? 'err' : entry.level === 'warn' ? 'warn' : 'accent'">
                  {{ (entry.level ?? 'info').toUpperCase() }}
                </span>
                <span class="log-msg">{{ (entry.data as { message?: string; error?: string })?.message ?? (entry.data as { error?: string })?.error ?? JSON.stringify(entry.data) }}</span>
              </div>
            </div>
          </div>

          <!-- Configuration Tab -->
          <form v-else-if="activeTab === 'configuration'" class="workspace-stack" @submit.prevent="savePluginConfig">
            <p>Accessible from Lua via <code>plugin.getConfig(key, default)</code> and <code>plugin.setConfig(key, value)</code>.</p>
            <JsonEditor v-model="configDraft" label="Plugin configuration JSON" :rows="8" />
            <div><button class="workspace-primary" type="submit" :disabled="busy">Save &amp; apply</button></div>
          </form>

          <!-- Details Tab -->
          <div v-else class="workspace-stack">
            <table class="workspace-table">
              <tbody>
                <tr><th scope="row">Plugin ID</th><td><code>{{ selectedPlugin.id }}</code></td></tr>
                <tr><th scope="row">Source</th><td>{{ selectedPlugin.source === 'lua' ? 'Managed Lua Plugin (SQLite VFS)' : 'Filesystem Module' }}</td></tr>
                <tr><th scope="row">Entrypoint</th><td><code>{{ selectedPlugin.entrypoint }}</code></td></tr>
                <tr><th scope="row">Files</th><td>{{ selectedPlugin.fileCount }}</td></tr>
                <tr><th scope="row">Description</th><td>{{ selectedPlugin.description || '—' }}</td></tr>
              </tbody>
            </table>
          </div>
        </template>
        <p v-else class="empty-state">Select a plugin on the left or click <strong>+ Create plugin</strong> to build a new Lua plugin.</p>
      </section>
    </div>

    <!-- Shared Modules Table -->
    <section class="workspace-panel">
      <div class="workspace-panel-header">
        <div>
          <h2>Shared modules</h2>
          <p style="margin:2px 0 0">Reusable Lua modules available to all plugins via <code>require("name")</code>.</p>
        </div>
        <button class="workspace-primary" type="button" @click="openModuleEditor()">+ New</button>
      </div>
      <p v-if="!sharedModules.length">No shared modules created yet.</p>
      <div v-else class="workspace-table-scroll" style="max-height:280px">
        <table class="workspace-table">
          <thead><tr><th>Name</th><th>Description</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="mod in sharedModules" :key="mod.name">
              <th scope="row"><code>{{ mod.name }}</code></th>
              <td>{{ mod.description || '—' }}</td>
              <td>
                <div class="workspace-actions compact">
                  <button type="button" @click="openModuleEditor(mod)">Edit</button>
                  <button class="workspace-danger" type="button" @click="promptDeleteModule(mod)">Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Update Scheduler -->
    <section class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>Update scheduler</h2>
        <span class="badge" :class="scheduler.running ? 'ok' : ''">{{ scheduler.running ? `Running · ${scheduler.intervalMs} ms` : 'Stopped' }}</span>
      </div>
      <form class="workspace-inline" @submit.prevent="saveScheduler">
        <label>Interval in ms (0 to stop, 50–60000 active) <input v-model.number="interval" type="number" min="0" max="60000" step="1" required /></label>
        <button class="workspace-primary" :disabled="busy" type="submit">Save interval</button>
      </form>
    </section>

    <!-- Plugin Source Workspace Modal (Create & Edit) -->
    <div v-if="workspace.open" class="modal-backdrop" role="presentation" @click.self="workspace.open = false">
      <div class="source-modal" role="dialog" aria-modal="true" aria-label="Plugin Source Workspace">
        <header class="source-modal-head">
          <div class="workspace-actions">
            <strong>{{ workspace.name || 'New Lua Plugin' }}</strong>
            <span class="badge accent">Plugin Source Workspace</span>
          </div>
          <div class="workspace-actions">
            <button class="workspace-primary" type="button" :disabled="busy" @click="saveWorkspace(false)">Save &amp; Reload</button>
            <button type="button" :disabled="busy" @click="saveWorkspace(true)">Save &amp; Close</button>
            <button type="button" @click="workspace.open = false">Close</button>
          </div>
        </header>

        <div class="source-meta-bar">
          <label>Name <input v-model="workspace.name" required placeholder="Territory Monitor" /></label>
          <label>ID <input v-model="workspace.id" :readonly="workspace.mode === 'edit'" class="monospace" placeholder="territory-monitor" /></label>
          <label>Version <input v-model="workspace.version" class="monospace" placeholder="1.0.0" /></label>
          <label>Entrypoint <input v-model="workspace.entrypoint" class="monospace" placeholder="main.lua" /></label>
          <label style="grid-column: 1 / -1">Description <input v-model="workspace.description" placeholder="Short summary of what this plugin does" /></label>
        </div>

        <div class="source-modal-body">
          <aside class="source-file-tree">
            <div class="source-tree-head">
              <span>PLUGIN FILES</span>
              <button type="button" @click="workspace.addingFile = !workspace.addingFile">+ File</button>
            </div>
            <form v-if="workspace.addingFile" class="source-add-file" @submit.prevent="addWorkspaceFile">
              <input v-model="workspace.newFileName" class="monospace" placeholder="rules.lua" autofocus />
              <button type="submit">Add</button>
            </form>
            <div v-for="file in workspace.files" :key="file.path" class="source-file-row" :class="{ active: workspace.activeFile === file.path }">
              <button type="button" class="source-file-btn" @click="workspace.activeFile = file.path">
                <code>{{ file.path }}</code>
                <span v-if="file.path === workspace.entrypoint" class="badge accent">entry</span>
              </button>
              <button v-if="file.path !== workspace.entrypoint" type="button" class="source-file-del" title="Remove file" @click="removeWorkspaceFile(file.path)">×</button>
            </div>
          </aside>

          <div class="source-editor-pane">
            <LuaEditor v-if="activeFileObj" v-model="activeFileObj.content" :docs="luaDocs" @save="saveWorkspace(false)" />
          </div>
        </div>
      </div>
    </div>

    <!-- Shared Module Modal -->
    <div v-if="moduleModal.open" class="modal-backdrop" role="presentation" @click.self="moduleModal.open = false">
      <div class="source-modal" style="max-width:840px;height:auto" role="dialog" aria-modal="true" aria-label="Shared module editor">
        <header class="source-modal-head">
          <strong>{{ moduleModal.isNew ? 'New shared module' : `Edit module · ${moduleModal.name}` }}</strong>
          <div class="workspace-actions">
            <button class="workspace-primary" type="button" :disabled="busy" @click="saveModule">Save module</button>
            <button type="button" @click="moduleModal.open = false">Close</button>
          </div>
        </header>
        <div class="source-meta-bar" style="grid-template-columns: 1fr 2fr">
          <label>Module name <input v-model="moduleModal.name" :readonly="!moduleModal.isNew" class="monospace" placeholder="region_utils" required /></label>
          <label>Description <input v-model="moduleModal.description" placeholder="Spatial and region helper utilities" /></label>
        </div>
        <div style="padding:14px">
          <LuaEditor v-model="moduleModal.content" :docs="luaDocs" @save="saveModule" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugins-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.plugins-grid { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 16px; align-items: stretch; }
.plugin-card-list { display: grid; gap: 8px; }
.plugin-card {
  display: grid;
  gap: 5px;
  width: 100%;
  text-align: left;
  padding: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}
.plugin-card.active { border-color: var(--accent); background: var(--accent-soft); }
.plugin-card-meta { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-secondary); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
.status-dot.active { background: var(--teal); box-shadow: 0 0 8px var(--teal); }
.status-dot.error { background: var(--danger); }

.plugin-detail-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
.plugin-detail-head h2 { margin: 0 0 6px; font-size: 20px; }
.plugin-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border-subtle); margin: 14px 0; padding-bottom: 8px; }
.plugin-tab { background: transparent; border-color: transparent; color: var(--text-secondary); padding: 6px 12px; }
.plugin-tab.active { border-color: var(--accent); background: var(--accent-soft); color: var(--text-primary); }

.log-stream-box { border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--bg-input); overflow: hidden; }
.log-stream-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-elevated); }
.log-entries { max-height: 360px; overflow-y: auto; padding: 10px 12px; font: 12px/1.6 var(--font-mono); }
.log-line { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
.log-time { color: var(--text-muted); flex: none; }
.log-msg { color: var(--text-primary); overflow-wrap: anywhere; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(5, 8, 15, 0.78);
  backdrop-filter: blur(5px);
}
.source-modal {
  width: min(95vw, 1140px);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.65);
  overflow: hidden;
}
.source-modal-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}
.source-meta-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
}
.source-modal-body {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  min-height: 400px;
  overflow: hidden;
}
.source-file-tree {
  padding: 12px;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-input);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.source-tree-head { display: flex; align-items: center; justify-content: space-between; font: 600 10px var(--font-mono); color: var(--text-muted); margin-bottom: 4px; }
.source-tree-head button { padding: 3px 7px; font-size: 11px; }
.source-add-file { display: flex; gap: 4px; margin-bottom: 4px; }
.source-file-row { display: flex; align-items: center; gap: 4px; border: 1px solid transparent; border-radius: var(--radius-sm); }
.source-file-row.active { border-color: var(--accent); background: var(--accent-soft); }
.source-file-btn { flex: 1; display: flex; align-items: center; justify-content: space-between; background: transparent; border: 0; padding: 6px 8px; text-align: left; font-size: 12px; }
.source-file-del { background: transparent; border: 0; padding: 4px 8px; color: var(--text-muted); }
.source-editor-pane { padding: 12px; overflow: auto; }

@media (max-width: 900px) {
  .plugins-grid, .source-modal-body { grid-template-columns: 1fr; }
  .source-meta-bar { grid-template-columns: 1fr 1fr; }
}
</style>
