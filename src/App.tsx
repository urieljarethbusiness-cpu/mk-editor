import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';

type BlockMap = {
  id: string;
  startLine: number;
  endLine: number;
};

type PreviewEditState = {
  id: string;
  startLine: number;
  endLine: number;
  value: string;
  top: number;
  left: number;
  width: number;
  height: number;
};

const STORAGE_KEY = 'mk-editor-autosave';

const sample = `# Advanced System Prompt\n\n## Objective\nDesign a robust assistant behavior policy with strict quality guarantees.\n\n## Constraints\n- Keep responses grounded and precise.\n- Use structured sections for clarity.\n- Validate assumptions before final output.\n\n## Response Contract\n\n\`\`\`md
### Output Template
- Intent Summary
- Action Plan
- Quality Checks
\`\`\`
`;

const activeLineEffect = StateEffect.define<number | null>();

const activeLineField = StateField.define<import('@codemirror/view').DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(activeLineEffect)) {
        if (effect.value === null) {
          return Decoration.none;
        }
        const line = tr.state.doc.line(effect.value);
        const builder = new RangeSetBuilder<Decoration>();
        builder.add(line.from, line.from, Decoration.line({ class: 'cm-active-track-line' }));
        return builder.finish();
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function lineFromPos(doc: EditorState['doc'], pos: number): number {
  return doc.lineAt(pos).number;
}

function normalizeMarkdownForPreview(markdownInput: string): string {
  return markdownInput
    .split('\n')
    .map((line) => {
      const multiDashListMatch = line.match(/^(\s*)(-{2,})\s+(.*)$/);
      if (!multiDashListMatch) {
        return line;
      }

      const [, baseIndent, dashes, content] = multiDashListMatch;
      const depth = dashes.length - 1;
      const nestedIndent = '  '.repeat(depth);

      return `${baseIndent}${nestedIndent}- ${content}`;
    })
    .join('\n');
}

function toHtmlAndMap(markdownInput: string): { html: string; map: BlockMap[] } {
  const normalizedMarkdown = normalizeMarkdownForPreview(markdownInput);
  const map: BlockMap[] = [];
  let idCount = 0;
  const tracked = new Set(['heading', 'paragraph', 'list', 'listItem', 'code', 'blockquote', 'table']);

  const attachMapPlugin = () => (tree: any) => {
    visit(tree, (node: any) => {
      if (!tracked.has(node.type) || !node.position?.start?.line || !node.position?.end?.line) {
        return;
      }
      idCount += 1;
      const id = `md-node-${idCount}`;
      node.data = node.data || {};
      node.data.hProperties = {
        ...(node.data.hProperties || {}),
        'data-node-id': id,
        'data-start-line': node.position.start.line,
        'data-end-line': node.position.end.line,
      };
      map.push({
        id,
        startLine: node.position.start.line,
        endLine: node.position.end.line,
      });
    });
  };

  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(attachMapPlugin)
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(normalizedMarkdown);

  return { html: String(file), map };
}

function findClosestMap(line: number, map: BlockMap[]): BlockMap | null {
  if (!map.length) return null;
  const exact = map.find((m) => line >= m.startLine && line <= m.endLine);
  if (exact) return exact;
  return map.reduce((prev, current) => {
    const prevDist = Math.min(Math.abs(line - prev.startLine), Math.abs(line - prev.endLine));
    const currDist = Math.min(Math.abs(line - current.startLine), Math.abs(line - current.endLine));
    return currDist < prevDist ? current : prev;
  });
}

export default function App() {
  const editorHost = useRef<HTMLDivElement | null>(null);
  const previewHost = useRef<HTMLDivElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewEditRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const mapRef = useRef<BlockMap[]>([]);
  const currentDocRef = useRef<string>('');

  const [markdownText, setMarkdownText] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || sample);
  const [{ html, map }, setRender] = useState(() => {
    const rendered = toHtmlAndMap(markdownText);
    mapRef.current = rendered.map;
    return rendered;
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeLine, setActiveLine] = useState<number>(1);
  const [saveLabel, setSaveLabel] = useState('Saved');
  const [editingSide, setEditingSide] = useState<'source' | 'preview'>('source');
  const [previewEdit, setPreviewEdit] = useState<PreviewEditState | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const rendered = toHtmlAndMap(markdownText);
      mapRef.current = rendered.map;
      setRender(rendered);
      localStorage.setItem(STORAGE_KEY, markdownText);
      setSaveLabel('Saved');
    }, 120);
    setSaveLabel('Saving...');
    return () => window.clearTimeout(timer);
  }, [markdownText]);

  useEffect(() => {
    if (!editorHost.current || editorRef.current) return;

    const updateListener = EditorView.updateListener.of((vu: ViewUpdate) => {
      if (vu.docChanged) {
        const next = vu.state.doc.toString();
        currentDocRef.current = next;
        setMarkdownText(next);
      }
      if (vu.selectionSet || vu.docChanged) {
        const line = lineFromPos(vu.state.doc, vu.state.selection.main.head);
        setActiveLine(line);
        const match = findClosestMap(line, mapRef.current);
        setActiveId(match?.id || null);
      }
    });

    const state = EditorState.create({
      doc: markdownText,
      extensions: [
        oneDark,
        history(),
        markdown(),
        activeLineField,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          { key: 'Mod-z', run: undo },
          { key: 'Mod-y', run: redo },
          { key: 'Mod-Shift-z', run: redo },
        ]),
        EditorView.lineWrapping,
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: editorHost.current,
    });

    const onFocusEditor = () => setEditingSide('source');
    view.dom.addEventListener('focusin', onFocusEditor);

    editorRef.current = view;
    currentDocRef.current = markdownText;

    return () => {
      view.dom.removeEventListener('focusin', onFocusEditor);
      view.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!previewEdit) return;
    previewEditRef.current?.focus();
    previewEditRef.current?.select();
  }, [previewEdit]);

  useEffect(() => {
    if (!editorRef.current) return;
    const doc = editorRef.current.state.doc;
    if (activeLine < 1 || activeLine > doc.lines) return;
    editorRef.current.dispatch({ effects: activeLineEffect.of(activeLine) });
  }, [activeLine]);

  useEffect(() => {
    if (!activeId || !previewHost.current) return;
    const el = previewHost.current.querySelector<HTMLElement>(`[data-node-id="${activeId}"]`);
    if (!el) return;
    previewHost.current.querySelectorAll('.preview-active').forEach((item) => item.classList.remove('preview-active'));
    el.classList.add('preview-active');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeId, html]);

  useEffect(() => {
    if (!previewHost.current) return;
    const node = previewHost.current;

    const onClick = (event: Event) => {
      const target = event.target as HTMLElement;
      const block = target.closest<HTMLElement>('[data-node-id]');
      if (!block || !editorRef.current) return;
      const id = block.dataset.nodeId;
      const startLine = Number(block.dataset.startLine || '1');
      if (!id || Number.isNaN(startLine)) return;
      setActiveId(id);
      setActiveLine(startLine);

      const doc = editorRef.current.state.doc;
      const safeLine = Math.min(Math.max(startLine, 1), doc.lines);
      const line = doc.line(safeLine);
      editorRef.current.dispatch({
        selection: EditorSelection.single(line.from),
        effects: [
          activeLineEffect.of(safeLine),
          EditorView.scrollIntoView(line.from, { y: 'center' }),
        ],
      });
      editorRef.current.focus();
    };

    const onDoubleClick = (event: Event) => {
      const target = event.target as HTMLElement;
      const block = target.closest<HTMLElement>('[data-node-id]');
      if (!block || !previewHost.current || !previewStageRef.current) return;

      const startLine = Number(block.dataset.startLine || '1');
      const endLine = Number(block.dataset.endLine || String(startLine));
      const id = block.dataset.nodeId;
      if (!id || Number.isNaN(startLine) || Number.isNaN(endLine)) return;

      const lines = markdownText.split('\n');
      const slice = lines.slice(startLine - 1, endLine);
      const value = slice.join('\n');

      const blockRect = block.getBoundingClientRect();
      const stageRect = previewStageRef.current.getBoundingClientRect();

      setEditingSide('preview');
      setActiveId(id);
      setActiveLine(startLine);
      setPreviewEdit({
        id,
        startLine,
        endLine,
        value,
        top: Math.max(blockRect.top - stageRect.top, 0),
        left: Math.max(blockRect.left - stageRect.left - 2, 0),
        width: blockRect.width + 4,
        height: Math.max(blockRect.height, 90),
      });
    };

    const closePreviewEditor = () => setPreviewEdit((prev) => (prev ? null : prev));

    node.addEventListener('click', onClick);
    node.addEventListener('dblclick', onDoubleClick);
    node.addEventListener('scroll', closePreviewEditor);
    return () => {
      node.removeEventListener('click', onClick);
      node.removeEventListener('dblclick', onDoubleClick);
      node.removeEventListener('scroll', closePreviewEditor);
    };
  }, [html, markdownText]);

  const commitPreviewEdit = () => {
    if (!previewEdit) return;
    const nextLines = markdownText.split('\n');
    const replacement = previewEdit.value.split('\n');
    nextLines.splice(previewEdit.startLine - 1, previewEdit.endLine - previewEdit.startLine + 1, ...replacement);
    const next = nextLines.join('\n');
    setMarkdownText(next);
    setSaveLabel('Saving...');
    setPreviewEdit(null);
  };

  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    if (markdownText === currentDocRef.current) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: markdownText },
    });
    currentDocRef.current = markdownText;
  }, [markdownText]);

  const status = useMemo(() => {
    const match = findClosestMap(activeLine, map);
    const sideLabel = editingSide === 'preview' ? 'Preview' : 'Source';
    if (!match) return `Line ${activeLine}`;
    return `${sideLabel} editing • Line ${activeLine} • Block ${match.startLine}-${match.endLine}`;
  }, [activeLine, map, editingSide]);

  const metrics = useMemo(() => {
    const lines = markdownText.split('\n').length;
    const words = markdownText
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const chars = markdownText.length;
    return { lines, words, chars };
  }, [markdownText]);

  const onExport = () => {
    const blob = new Blob([markdownText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'system-prompt.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setMarkdownText(text);
    setSaveLabel('Imported');
    event.target.value = '';
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="title-wrap">
          <h1>MK Prompt Editor</h1>
          <p>Dual-pane Markdown workflow for advanced system prompts</p>
          <div className="title-meta">
            <span className="meta-pill">Live sync</span>
            <span className="meta-pill meta-pill-soft">Bidirectional edit</span>
          </div>
        </div>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} aria-label="Import markdown file">
            Import .md
          </button>
          <button className="btn btn-primary" onClick={onExport} aria-label="Export markdown file">
            Export .md
          </button>
          <span className="save-status">
            <span className="status-dot" />
            {saveLabel}
          </span>
        </div>
        <input ref={fileInputRef} className="hidden-input" type="file" accept=".md,text/markdown" onChange={onImport} />
      </header>

      <section className="insight-bar" aria-label="Editor insights">
        <article className="insight-card">
          <span className="insight-label">Lines</span>
          <strong>{metrics.lines}</strong>
        </article>
        <article className="insight-card">
          <span className="insight-label">Words</span>
          <strong>{metrics.words}</strong>
        </article>
        <article className="insight-card">
          <span className="insight-label">Characters</span>
          <strong>{metrics.chars}</strong>
        </article>
      </section>

      <section className="workbench">
        <article className={`panel source-panel ${editingSide === 'source' ? 'panel-editing' : ''}`}>
          <div className="panel-head">
            Markdown Source
            <span className="panel-tag">CodeMirror</span>
          </div>
          <div ref={editorHost} className="editor-host" />
          <div className="sync-arrow sync-arrow-right">➜</div>
        </article>

        <article className={`panel preview-panel ${editingSide === 'preview' ? 'panel-editing' : ''}`}>
          <div className="panel-head">
            Rich Preview
            <span className="panel-tag">WYSIWYG Flow</span>
          </div>
          <div ref={previewStageRef} className="preview-stage">
            <div ref={previewHost} className="preview-host" dangerouslySetInnerHTML={{ __html: html }} />
            {previewEdit && (
              <div
                className="preview-inline-editor"
                style={{
                  top: previewEdit.top,
                  left: previewEdit.left,
                  width: previewEdit.width,
                  minHeight: previewEdit.height,
                }}
              >
                <textarea
                  ref={previewEditRef}
                  value={previewEdit.value}
                  onChange={(event) => setPreviewEdit((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                  onBlur={commitPreviewEdit}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault();
                      commitPreviewEdit();
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setPreviewEdit(null);
                      setEditingSide('source');
                    }
                  }}
                />
                <div className="preview-inline-hint">Ctrl/Cmd + Enter to save • Esc to cancel</div>
              </div>
            )}
          </div>
          <div className="sync-arrow sync-arrow-left">⬅</div>
        </article>
      </section>

      <footer className="statusbar">{status}</footer>
    </div>
  );
}
