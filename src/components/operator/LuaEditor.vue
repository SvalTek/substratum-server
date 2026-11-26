<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import type { LuaBindingDocs } from 'webluabridge';

const props = defineProps<{
  modelValue: string;
  docs: LuaBindingDocs[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  save: [];
}>();

const container = ref<HTMLDivElement>();
let view: EditorView | undefined;
let applyingExternal = false;

const lifecycleCompletions: Completion[] = [
  { label: 'OnInit', type: 'function', detail: 'lifecycle hook', info: 'Called once when the Lua plugin entrypoint is enabled or reloaded.' },
  { label: 'OnShutdown', type: 'function', detail: 'lifecycle hook', info: 'Called when the Lua plugin entrypoint is disabled or unloaded.' },
  { label: 'OnSpatialChange', type: 'function', detail: '(event)', info: 'Called when Substratum emits spatial:change ({ regions, changes }).' },
  { label: 'Update', type: 'function', detail: '(dt)', info: 'Called on each scheduler tick when update interval > 0.' },
  { label: 'Events:On', type: 'method', detail: '(name, fn)', info: 'Subscribe to WebLuaBridge events.' },
  { label: 'Events:Emit', type: 'method', detail: '(name, data)', info: 'Emit an event on the WebLuaBridge bus.' },
];

function buildCompletions(docs: LuaBindingDocs[]): Completion[] {
  const items: Completion[] = [...lifecycleCompletions];
  for (const group of docs) {
    const ns = group.namespace ?? group.className;
    items.push({ label: ns, type: 'namespace', detail: 'Substratum API' });
    for (const method of group.methods) {
      const args = (method.args ?? []).map(arg => arg.name).join(', ');
      items.push({
        label: `${ns}.${method.name}`,
        type: 'function',
        detail: `(${args})${method.returnType ? ` -> ${method.returnType}` : ''}`,
        info: method.description,
      });
    }
  }
  return items;
}

function luaAutocomplete(context: CompletionContext) {
  const word = context.matchBefore(/[\w.:]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: buildCompletions(props.docs),
  };
}

onMounted(() => {
  if (!container.value) return;
  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      StreamLanguage.define(lua),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      oneDark,
      autocompletion({ override: [luaAutocomplete] }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
        { key: 'Mod-s', run: () => { emit('save'); return true; } },
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged && !applyingExternal) {
          emit('update:modelValue', update.state.doc.toString());
        }
      }),
      EditorView.theme({
        '&': { height: '380px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-strong)' },
        '.cm-scroller': { fontFamily: 'var(--font-mono)' },
      }),
    ],
  });
  view = new EditorView({ state, parent: container.value });
});

watch(() => props.modelValue, next => {
  if (!view) return;
  const current = view.state.doc.toString();
  if (current === next) return;
  applyingExternal = true;
  view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
  applyingExternal = false;
});

onUnmounted(() => view?.destroy());
</script>

<template>
  <div ref="container" class="lua-cm-host" aria-label="Lua source editor"></div>
</template>
