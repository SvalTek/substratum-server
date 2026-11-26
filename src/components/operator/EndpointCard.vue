<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EndpointDoc } from '../../lib/api-contracts';

const props = defineProps<{
  endpoint: EndpointDoc;
  expanded: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  load: [endpoint: EndpointDoc];
}>();

const copiedBlock = ref<'request' | 'response' | 'footer' | null>(null);

const methodClass = computed(() => `method-${props.endpoint.method.toLowerCase()}`);

const copyTargetText = computed(() => {
  if (props.endpoint.requestExample) return props.endpoint.requestExample;
  if (props.endpoint.primaryResponse?.example) return props.endpoint.primaryResponse.example;
  return `${props.endpoint.method} ${props.endpoint.loadPath}`;
});

async function copyText(text: string, target: 'request' | 'response' | 'footer') {
  try {
    await navigator.clipboard.writeText(text);
    copiedBlock.value = target;
    setTimeout(() => {
      if (copiedBlock.value === target) copiedBlock.value = null;
    }, 1400);
  } catch { /* Clipboard optional */ }
}

function statusClass(status: string, isError: boolean) {
  if (isError) return 'status-err';
  if (status === '204') return 'status-neutral';
  return 'status-ok';
}

function mediaLabel(contentType?: string) {
  if (!contentType) return 'TEXT';
  if (contentType.includes('json')) return 'JSON';
  if (contentType.includes('event-stream')) return 'SSE';
  return 'TEXT';
}
</script>

<template>
  <article class="endpoint-card" :class="{ expanded }">
    <div
      class="endpoint-header"
      role="button"
      tabindex="0"
      :aria-expanded="expanded"
      @click="emit('toggle')"
      @keydown.enter.prevent="emit('toggle')"
      @keydown.space.prevent="emit('toggle')"
    >
      <span class="method-pill" :class="methodClass">{{ endpoint.method }}</span>
      <code class="endpoint-path">{{ endpoint.path }}</code>
      <span class="endpoint-summary">{{ endpoint.summary }}</span>
      <span v-if="endpoint.authKind !== 'standard'" class="badge" :class="endpoint.authKind === 'public' ? 'ok' : 'warn'">
        {{ endpoint.authKind === 'public' ? 'Public' : 'Management' }}
      </span>
      <button type="button" class="endpoint-load-btn" @click.stop="emit('load', endpoint)">Load</button>
      <svg class="endpoint-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>

    <div v-if="expanded" class="endpoint-body">
      <p class="endpoint-desc">{{ endpoint.description }}</p>

      <section v-if="endpoint.parameters.length" class="doc-section">
        <h3>Parameters</h3>
        <div class="workspace-table-scroll">
          <table class="doc-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>In</th>
                <th>Type</th>
                <th>Required</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="param in endpoint.parameters" :key="param.in + ':' + param.name">
                <td><code>{{ param.name }}</code></td>
                <td><span class="badge">{{ param.in }}</span></td>
                <td><code>{{ param.type }}</code></td>
                <td>{{ param.required ? 'Yes' : 'No' }}</td>
                <td class="doc-cell-desc">{{ param.description }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="endpoint.requestFields.length" class="doc-section">
        <h3>Request schema</h3>
        <p v-if="endpoint.requestSchemaNote" class="doc-note">{{ endpoint.requestSchemaNote }}</p>
        <div class="workspace-table-scroll">
          <table class="doc-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Required</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="field in endpoint.requestFields" :key="field.name">
                <td><code>{{ field.name }}</code></td>
                <td><code>{{ field.type }}</code></td>
                <td>{{ field.required ? 'Yes' : 'No' }}</td>
                <td class="doc-cell-desc">{{ field.description }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="endpoint.requestExample" class="doc-section">
        <h3>Example request</h3>
        <div class="code-card">
          <div class="code-card-bar">
            <span class="code-lang">&lt;/&gt; JSON</span>
            <div class="code-card-actions">
              <button type="button" class="icon-btn" title="Load into request builder" @click="emit('load', endpoint)">
                Load
              </button>
              <button type="button" class="icon-btn" @click="copyText(endpoint.requestExample!, 'request')">
                {{ copiedBlock === 'request' ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>
          <pre class="code-pre">{{ endpoint.requestExample }}</pre>
        </div>
      </section>

      <section v-if="endpoint.primaryResponse" class="doc-section">
        <h3>Response</h3>
        <div class="response-status-line">
          <span class="status-pill" :class="statusClass(endpoint.primaryResponse.status, endpoint.primaryResponse.isError)">
            {{ endpoint.primaryResponse.status }}
          </span>
          <span>{{ endpoint.primaryResponse.description }}</span>
        </div>

        <div v-if="endpoint.primaryResponse.example" class="code-card">
          <div class="code-card-bar">
            <span class="code-lang">&lt;/&gt; {{ mediaLabel(endpoint.primaryResponse.contentType) }}</span>
            <div class="code-card-actions">
              <button type="button" class="icon-btn" @click="copyText(endpoint.primaryResponse!.example!, 'response')">
                {{ copiedBlock === 'response' ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>
          <pre class="code-pre">{{ endpoint.primaryResponse.example }}</pre>
        </div>

        <div v-if="endpoint.otherResponses.length" class="error-responses">
          <div v-for="resp in endpoint.otherResponses" :key="resp.status" class="response-status-line compact">
            <span class="status-pill" :class="statusClass(resp.status, resp.isError)">{{ resp.status }}</span>
            <span class="error-resp-desc">{{ resp.description }}</span>
          </div>
        </div>
      </section>

      <footer class="endpoint-footer">
        <span class="endpoint-meta">{{ endpoint.authLabel }} · Request validation · Response codes</span>
        <div class="endpoint-footer-actions">
          <button type="button" class="workspace-primary" @click="emit('load', endpoint)">Load in builder</button>
          <button type="button" @click="copyText(copyTargetText, 'footer')">
            {{ copiedBlock === 'footer' ? 'Copied' : 'Copy example' }}
          </button>
        </div>
      </footer>
    </div>
  </article>
</template>

<style scoped>
.endpoint-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  overflow: hidden;
  transition: border-color 0.14s;
}
.endpoint-card.expanded,
.endpoint-card:hover {
  border-color: var(--border-strong);
}

.endpoint-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  cursor: pointer;
  user-select: none;
  background: var(--bg-elevated);
}
.endpoint-header:hover {
  background: var(--bg-hover);
}

.method-pill {
  flex: none;
  min-width: 58px;
  text-align: center;
  padding: 3px 8px;
  border-radius: 999px;
  font: 700 11px var(--font-mono);
  letter-spacing: 0.04em;
  border: 1px solid transparent;
}
.method-get { background: var(--accent-soft); border-color: rgba(139, 124, 255, 0.45); color: #cfc7ff; }
.method-post { background: var(--teal-soft); border-color: rgba(88, 213, 186, 0.45); color: var(--teal); }
.method-patch { background: var(--warn-soft); border-color: rgba(240, 184, 101, 0.45); color: var(--warn); }
.method-delete { background: var(--danger-soft); border-color: rgba(240, 123, 130, 0.45); color: var(--danger); }

.endpoint-path {
  font: 600 13px var(--font-mono);
  color: var(--text-primary);
  white-space: nowrap;
}
.endpoint-summary {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.endpoint-load-btn {
  padding: 4px 10px;
  font-size: 12px;
  flex: none;
}
.endpoint-chevron {
  width: 16px;
  height: 16px;
  flex: none;
  color: var(--text-secondary);
  transition: transform 0.16s ease;
}
.endpoint-card.expanded .endpoint-chevron {
  transform: rotate(180deg);
}

.endpoint-body {
  padding: 16px 18px;
  border-top: 1px solid var(--border-subtle);
  display: grid;
  gap: 18px;
}
.endpoint-desc {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.doc-section {
  display: grid;
  gap: 8px;
}
.doc-section h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.doc-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 12px;
}
.doc-table th,
.doc-table td {
  padding: 8px 8px;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: top;
}
.doc-table thead th {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.doc-table tbody tr:last-child td {
  border-bottom: 0;
}
.doc-cell-desc {
  color: var(--text-secondary);
}

.code-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  overflow: hidden;
}
.code-card-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}
.code-lang {
  font: 600 11px var(--font-mono);
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}
.code-card-actions {
  display: flex;
  gap: 6px;
}
.icon-btn {
  padding: 3px 8px;
  font-size: 11px;
}
.code-pre {
  margin: 0;
  padding: 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  font: 12px/1.5 var(--font-mono);
  color: var(--text-primary);
  white-space: pre-wrap;
  max-height: 320px;
  overflow: auto;
}

.response-status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
}
.response-status-line.compact {
  font-size: 12px;
  color: var(--text-secondary);
}
.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  padding: 2px 8px;
  border-radius: 999px;
  font: 700 11px var(--font-mono);
  border: 1px solid transparent;
}
.status-ok { background: var(--teal-soft); border-color: rgba(88, 213, 186, 0.45); color: var(--teal); }
.status-err { background: var(--danger-soft); border-color: rgba(240, 123, 130, 0.45); color: var(--danger); }
.status-neutral { background: var(--bg-elevated); border-color: var(--border-strong); color: var(--text-secondary); }

.error-responses {
  display: grid;
  gap: 6px;
  padding-top: 4px;
}

.endpoint-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.endpoint-meta {
  font-size: 12px;
  color: var(--text-muted);
}
.endpoint-footer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 720px) {
  .endpoint-summary {
    display: none;
  }
}
</style>
