import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  FileDown,
  FilePlus2,
  FileText,
  FolderOpen,
  Info,
  Menu,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import starterContent from '@assets/Pasted--DOCTYPE-html-html-lang-de-head-meta-charset-UTF-8-meta_1786373842251.txt?raw';

type Note = {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
  source?: 'sample' | 'upload' | 'note';
  fileName?: string;
};
type Finding = { line: number; kind: 'warning' | 'error'; message: string; excerpt?: string };
type Validation = {
  status: 'valid' | 'warning' | 'error' | 'idle';
  findings: Finding[];
  lines: number;
  chars: number;
  language?: 'html' | 'python' | 'text';
  summary?: string;
};

const isLikelyHtml = (content: string) =>
  /<!doctype\s+html|<html\b|<(head|body|meta|title|style|script|div|main|section|article)\b/i.test(content);

const isLikelyPython = (content: string, fileName = '', title = '') =>
  /\.py$/i.test(fileName)
  || /\.py$/i.test(title)
  || /^\s*#!.*\bpython(?:\d+(?:\.\d+)*)?\b/m.test(content)
  || /^\s*(?:from\s+\w+\s+import|import\s+(?:json|os|threading|time|webbrowser|requests|ui|console|keychain)\b)/m.test(content)
  || /^\s*(?:def|class)\s+\w+/m.test(content)
  || /^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:/m.test(content);

const getLanguage = (content: string, fileName = '', title = ''): 'html' | 'python' | 'text' =>
  isLikelyHtml(content) ? 'html' : isLikelyPython(content, fileName, title) ? 'python' : 'text';

const supportedExtensions = [
  'txt', 'html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'css', 'json', 'xml',
  'md', 'csv', 'svg', 'yaml', 'yml', 'sql', 'sh', 'py', 'java', 'c', 'cpp',
  'vue', 'svelte',
];
const supportedFileAccept = supportedExtensions.map((extension) => `.${extension}`).concat([
  'text/plain', 'text/html', 'text/css', 'text/javascript', 'application/javascript',
  'application/json', 'application/xml', 'text/xml', 'text/markdown',
]).join(',');

const getFileExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() ?? '';
const isSupportedTextFile = (file: File) =>
  supportedExtensions.includes(getFileExtension(file.name))
  || file.type.startsWith('text/')
  || ['application/javascript', 'application/json', 'application/xml'].includes(file.type);

function repairHtml(content: string) {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return { content, changed: false };
  const parsed = new DOMParser().parseFromString(normalized, 'text/html');
  const repaired = `<!DOCTYPE html>\n${parsed.documentElement.outerHTML}`;
  return { content: repaired, changed: repaired !== normalized };
}

const queryClient = new QueryClient();
const STORAGE_KEY = 'script-validator-v4-notes';
const sampleNote: Note = {
  id: 'starter-reference',
  title: 'App Portal reference',
  content: starterContent,
  updatedAt: Date.now(),
  source: 'sample',
};

const isNote = (value: unknown): value is Note => {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<Note>;
  return typeof note.id === 'string'
    && typeof note.title === 'string'
    && typeof note.content === 'string'
    && typeof note.updatedAt === 'number';
};

const formatUpdated = (date: number) => {
  const diff = Date.now() - date;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
};

function validateText(content: string): Validation {
  if (!content.trim()) return { status: 'warning', findings: [{ line: 1, kind: 'warning', message: 'The note is empty. Add some text before validating.' }], lines: 0, chars: 0 };
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.length > 120) findings.push({ line: lineNo, kind: 'warning', message: 'This line is longer than 120 characters.', excerpt: line.slice(0, 92) });
    if (/\t/.test(line)) findings.push({ line: lineNo, kind: 'warning', message: 'Tab character found; use spaces for consistent indentation.', excerpt: line.trim().slice(0, 92) });
    if (/\uFFFD/.test(line)) findings.push({ line: lineNo, kind: 'warning', message: 'A replacement character (�) suggests an encoding problem. Re-save the original file as UTF-8; the missing character cannot be reconstructed safely.', excerpt: line.trim().slice(0, 92) });
    if (/\b(TODO|FIXME)\b/i.test(line)) findings.push({ line: lineNo, kind: 'warning', message: 'Unresolved marker found in script.', excerpt: line.trim().slice(0, 92) });
  });

  const lineNumberAt = (position: number) => content.slice(0, position).split(/\r?\n/).length;
  const scriptOpenings = /<script\b[^>]*>/gi;
  let scriptOpening: RegExpExecArray | null;
  while ((scriptOpening = scriptOpenings.exec(content))) {
    const tag = scriptOpening[0];
    const bodyStart = scriptOpening.index + tag.length;
    if (!/src\s*=/i.test(tag) && !/<\/script\s*>/i.test(content.slice(bodyStart))) {
      findings.push({
        line: lineNumberAt(scriptOpening.index),
        kind: 'error',
        message: 'Script tag is missing its closing </script> tag.',
        excerpt: tag.trim().slice(0, 92),
      });
    }
  }

  const voidTags = new Set(['meta', 'link', 'input', 'img', 'br', 'hr', 'source', 'area', 'base', 'embed', 'param', 'track', 'wbr']);
  const tagTokens = /<!--[\s\S]*?-->|<\/?[a-z][\w-]*(?:\s[^<>]*?)?\/?>/gi;
  const tagStack: { name: string; position: number }[] = [];
  let tagToken: RegExpExecArray | null;
  while ((tagToken = tagTokens.exec(content))) {
    const token = tagToken[0];
    if (token.startsWith('<!--')) continue;
    const name = token.match(/<\/?\s*([a-z][\w-]*)/i)?.[1]?.toLowerCase();
    if (!name || voidTags.has(name) || /\/\s*>$/.test(token)) continue;
    if (/^<\//.test(token)) {
      const openIndex = tagStack.findLastIndex((entry) => entry.name === name);
      if (openIndex === -1) {
        findings.push({ line: lineNumberAt(tagToken.index), kind: 'error', message: `Unexpected closing tag </${name}>.` });
      } else {
        tagStack.splice(openIndex, 1);
      }
    } else {
      tagStack.push({ name, position: tagToken.index });
    }
  }
  tagStack.forEach(({ name, position }) => {
    findings.push({ line: lineNumberAt(position), kind: 'error', message: `Missing closing tag for <${name}>.` });
  });
  const status = findings.some((finding) => finding.kind === 'error') ? 'error' : findings.length ? 'warning' : 'valid';
  return { status, findings: findings.slice(0, 24), lines: lines.length, chars: content.length, language: 'text' };
}

function validatePython(content: string): Validation {
  if (!content.trim()) {
    return {
      status: 'warning',
      findings: [{ line: 1, kind: 'warning', message: 'The Python file is empty. Add code before validating.' }],
      lines: 0,
      chars: 0,
      language: 'python',
      summary: 'No Python code is available to inspect.',
    };
  }

  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];
  const styleFindings: Finding[] = [];
  let longLineCount = 0;
  const addFinding = (line: number, kind: Finding['kind'], message: string, excerpt?: string) =>
    findings.push({ line, kind, message, excerpt });

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (line.length > 120) {
      longLineCount += 1;
      if (longLineCount <= 3) styleFindings.push({ line: lineNo, kind: 'warning', message: 'Style suggestion: this Python line is longer than 120 characters.', excerpt: line.slice(0, 92) });
    }
    if (/\uFFFD/.test(line)) addFinding(lineNo, 'error', 'A replacement character (�) indicates possible decoding loss. Re-save the original file as UTF-8; the missing character cannot be reconstructed safely.', trimmed.slice(0, 92));
    if (/\b(TODO|FIXME)\b/i.test(line)) styleFindings.push({ line: lineNo, kind: 'warning', message: 'Unresolved marker found in Python code.', excerpt: trimmed.slice(0, 92) });
  });

  const importsPythonista = [
    { name: 'ui', pattern: /^\s*(?:import\s+.*\bui\b|from\s+ui\s+import\b)/m },
    { name: 'console', pattern: /^\s*(?:import\s+.*\bconsole\b|from\s+console\s+import\b)/m },
    { name: 'keychain', pattern: /^\s*(?:import\s+.*\bkeychain\b|from\s+keychain\s+import\b)/m },
  ].filter(({ pattern }) => pattern.test(content)).map(({ name }) => name);
  const requestsLine = lines.findIndex((line) => /^\s*(?:import\s+requests\b|from\s+requests\s+import\b)/.test(line));
  const pythonistaLine = lines.findIndex((line) => importsPythonista.some((name) => new RegExp(`\\b${name}\\b`).test(line)));

  if (importsPythonista.length) {
    addFinding(
      pythonistaLine >= 0 ? pythonistaLine + 1 : 1,
      'warning',
      `This is Pythonista 3 code (${importsPythonista.join(', ')}). ScriptValidator can inspect and export it, but it cannot run it in the browser. Run it in Pythonista on iPhone.`,
    );
  }
  if (requestsLine >= 0) {
    addFinding(
      requestsLine + 1,
      'warning',
      'The script requires the requests package and network access. Pythonista must have requests installed and be allowed to access the internet.',
    );
  }
  if (/\b(?:load_key|save_key|test_provider|test_all)\b/.test(content) && !/\bkeychain\b/.test(content)) {
    addFinding(1, 'warning', 'The API-key functions are present, but no keychain module was detected. Keys will not persist outside Pythonista.');
  }

  const stack: { character: string; line: number }[] = [];
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  let quote: '"' | "'" | null = null;
  let tripleQuote: '"""' | "'''" | null = null;
  let escaped = false;
  lines.forEach((line, lineIndex) => {
    let commentStarted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      const next = line.slice(index, index + 3);
      if (commentStarted) continue;
      if (tripleQuote) {
        if (next === tripleQuote) {
          tripleQuote = null;
          index += 2;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '#') {
        commentStarted = true;
      } else if (next === '"""' || next === "'''") {
        tripleQuote = next;
        index += 2;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (pairs[character]) {
        stack.push({ character, line: lineIndex + 1 });
      } else if (Object.values(pairs).includes(character)) {
        const opening = stack.pop();
        if (!opening || pairs[opening.character] !== character) {
          addFinding(lineIndex + 1, 'error', `Unmatched closing delimiter "${character}". Check the brackets, parentheses, or braces on this line.`);
        }
      }
    }
  });
  stack.forEach(({ character, line }) => {
    addFinding(line, 'error', `Missing closing delimiter for "${character}". The Python expression is not balanced.`);
  });
  if (longLineCount > 3) {
    styleFindings.push({ line: 1, kind: 'warning', message: `${longLineCount - 3} additional long-line style hint${longLineCount - 3 === 1 ? '' : 's'} hidden to keep the important findings visible.` });
  }
  findings.push(...styleFindings);

  const status = findings.some((finding) => finding.kind === 'error') ? 'error' : findings.length ? 'warning' : 'valid';
  const summary = status === 'error'
    ? 'Python code needs correction before it can be trusted.'
    : importsPythonista.length
      ? 'The Python syntax looks consistent. This file is a Pythonista 3 app and must be run in Pythonista, not in this browser.'
      : 'The Python syntax looks consistent. ScriptValidator performs a local static check; it does not execute the script or call its APIs.';
  return { status, findings: findings.slice(0, 24), lines: lines.length, chars: content.length, language: 'python', summary };
}

const validateContent = (content: string, fileName = '', title = '') => {
  const language = getLanguage(content, fileName, title);
  if (language === 'python') return validatePython(content);
  const result = validateText(content);
  return { ...result, language };
};

function StatusPill({ status }: { status: Validation['status'] }) {
  if (status === 'idle') return <span className="font-mono-app text-[10px] uppercase tracking-[.18em] text-muted-foreground">not checked</span>;
  const copy = { valid: 'valid', warning: 'review', error: 'issues' }[status];
  const styles = { valid: 'border-teal-700/20 bg-teal-700/10 text-teal-800', warning: 'border-amber-700/20 bg-amber-700/10 text-amber-800', error: 'border-red-700/20 bg-red-700/10 text-red-800' }[status];
  const Icon = status === 'valid' ? CheckCircle2 : status === 'warning' ? CircleAlert : XCircle;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-mono-app text-[10px] uppercase tracking-[.12em] ${styles}`}><Icon className="h-3 w-3" />{copy}</span>;
}

function NoteRow({ note, active, onSelect, onDelete, index, validation }: { note: Note; active: boolean; onSelect: () => void; onDelete: () => void; index: number; validation?: Validation }) {
  return (
    <div className={`group relative animate-rise stagger-${Math.min(index + 1, 4)} ${active ? 'bg-sidebar-accent' : ''}`} data-testid={`note-row-${note.id}`}>
      <button onClick={onSelect} className="flex min-h-[76px] w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-sidebar-accent/70" data-testid={`button-select-note-${note.id}`}>
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'bg-sidebar-accent text-sidebar-foreground/75'}`}><FileText className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><p className={`truncate text-sm font-semibold ${active ? 'text-sidebar-foreground' : 'text-sidebar-foreground/90'}`}>{note.title}</p>{note.source === 'sample' && <span className="shrink-0 rounded bg-sidebar-primary/15 px-1.5 py-0.5 font-mono-app text-[9px] uppercase tracking-wider text-sidebar-primary">starter</span>}</div>
          <p className="mt-1 truncate text-xs text-sidebar-foreground/55">{note.content.replace(/\s+/g, ' ').trim() || 'Empty note'}</p>
          <div className="mt-1.5 flex items-center gap-2"><span className="font-mono-app text-[10px] text-sidebar-foreground/45">{formatUpdated(note.updatedAt)}</span>{validation && <StatusPill status={validation.status} />}</div>
        </div>
        {active && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-sidebar-primary" />}
      </button>
      <button onClick={(event) => { event.stopPropagation(); onDelete(); }} className="absolute right-10 top-3 hidden rounded-md p-1.5 text-sidebar-foreground/40 transition-colors hover:bg-red-400/15 hover:text-red-200 group-hover:block" aria-label={`Delete ${note.title}`} data-testid={`button-delete-note-${note.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function ValidationCard({ result, onJump }: { result: Validation; onJump: (line: number) => void }) {
  if (result.status === 'idle') return <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-card/45 px-4 py-3 text-sm text-muted-foreground"><Info className="h-4 w-4 shrink-0 text-primary" /><span>Run a check when you are ready. Findings will appear here.</span></div>;
  const config = {
    valid: { icon: CheckCircle2, title: 'Looks good', text: 'No issues found in this text.', color: 'text-teal-800', bg: 'bg-teal-800/8 border-teal-800/15' },
    warning: { icon: CircleAlert, title: `${result.findings.length} thing${result.findings.length === 1 ? '' : 's'} to review`, text: 'Nothing is blocking, but a closer look is worthwhile.', color: 'text-amber-900', bg: 'bg-amber-800/8 border-amber-800/15' },
    error: { icon: XCircle, title: `${result.findings.length} issue${result.findings.length === 1 ? '' : 's'} found`, text: 'Fix these items before using the script.', color: 'text-red-900', bg: 'bg-red-800/8 border-red-800/15' },
    idle: { icon: Info, title: 'Ready to check', text: '', color: 'text-muted-foreground', bg: 'bg-card border-border' },
  }[result.status];
  const Icon = config.icon;
  const isPython = result.language === 'python';
  const title = isPython && result.status !== 'error' ? 'Python check complete' : config.title;
  const text = result.summary || config.text;
  return <div className={`rounded-xl border p-4 ${config.bg}`} data-testid="validation-feedback"><div className="flex items-start gap-3"><Icon className={`mt-0.5 h-5 w-5 shrink-0 ${config.color}`} /><div className="min-w-0 flex-1"><p className={`font-semibold ${config.color}`}>{title}</p><p className="mt-0.5 text-sm leading-relaxed text-foreground/65">{text}</p>{result.findings.length > 0 && <div className="mt-3 space-y-1.5">{result.findings.map((finding, index) => <button key={`${finding.line}-${index}`} onClick={() => onJump(finding.line)} className="flex w-full items-start gap-2 rounded-lg bg-background/45 px-2.5 py-2 text-left text-xs transition-colors hover:bg-background/80" data-testid={`button-jump-finding-${index}`}><span className={`font-mono-app text-[10px] font-medium ${finding.kind === 'error' ? 'text-red-800' : 'text-amber-800'}`}>L{finding.line}</span><span className="text-foreground/75">{finding.message}</span></button>)}</div>}</div></div></div>;
}

function Workspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [validation, setValidation] = useState<Validation>({ status: 'idle', findings: [], lines: 0, chars: 0 });
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [mobileList, setMobileList] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      const storedNotes = Array.isArray(parsed) ? parsed.filter(isNote) : [];
      const initial = storedNotes.length ? storedNotes : [sampleNote];
      setNotes(initial);
      setSelectedId(initial[0].id);
    } catch {
      setNotes([sampleNote]); setSelectedId(sampleNote.id);
    }
  }, []);

  const selected = notes.find((note) => note.id === selectedId);
  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setContent(selected.content);
      setValidation({ status: 'idle', findings: [], lines: 0, chars: selected.content.length });
      setPreviewOpen(false);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch {
      setNotice({ type: 'error', text: 'Changes could not be saved in this browser.' });
    }
  }, [notes]);
  useEffect(() => { const timer = window.setTimeout(() => setNotice(null), 4000); return () => window.clearTimeout(timer); }, [notice]);

  const filteredNotes = useMemo(() => notes.filter((note) => `${note.title} ${note.content}`.toLowerCase().includes(search.toLowerCase())), [notes, search]);
  const saveContent = (nextContent: string, nextTitle = title) => {
    if (!selected) return;
    setNotes((current) => current.map((note) => note.id === selected.id ? { ...note, title: nextTitle.trim() || 'Untitled note', content: nextContent, updatedAt: Date.now(), source: note.source === 'sample' ? 'note' : note.source } : note));
    setNotice({ type: 'success', text: 'Saved locally' });
  };
  const saveCurrent = () => saveContent(content, title);
  const selectNote = (id: string) => { saveCurrent(); setSelectedId(id); setMobileList(false); };
  const addNote = () => {
    const note: Note = { id: `note-${Date.now()}`, title: 'Untitled note', content: '', updatedAt: Date.now(), source: 'note' };
    setNotes((current) => [note, ...current]); setSelectedId(note.id); setTitle(note.title); setContent(''); setValidation({ status: 'idle', findings: [], lines: 0, chars: 0 }); setMobileList(false); setNotice({ type: 'success', text: 'New note created' });
  };
  const deleteNote = (id: string) => {
    const target = notes.find((note) => note.id === id);
    if (!target || !window.confirm(`Delete “${target.title}”? This cannot be undone.`)) return;
    const remaining = notes.filter((note) => note.id !== id);
    setNotes(remaining);
    if (id === selectedId) { const next = remaining[0]; setSelectedId(next?.id ?? ''); if (next) setMobileList(false); }
    setNotice({ type: 'success', text: 'Note deleted' });
  };
  const readFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const unsupported = files.filter((file) => !isSupportedTextFile(file));
    if (unsupported.length) setNotice({ type: 'error', text: `${unsupported.length} file${unsupported.length > 1 ? 's were' : ' was'} skipped — only text and source files are supported.` });
    const supported = files.filter((file) => !unsupported.includes(file));
    if (!supported.length) { event.target.value = ''; return; }
    setReading(true);
    Promise.all(supported.map((file) => new Promise<Note>((resolve, reject) => {
      const reader = new FileReader();
       reader.onload = () => resolve({ id: `upload-${Date.now()}-${file.name}`, title: file.name.replace(/\.[^.]+$/, '') || 'Untitled upload', content: String(reader.result ?? ''), updatedAt: Date.now(), source: 'upload', fileName: file.name });
      reader.onerror = () => reject(new Error(file.name));
      reader.readAsText(file);
    }))).then((incoming) => { setNotes((current) => [...incoming, ...current]); setSelectedId(incoming[0].id); setTitle(incoming[0].title); setContent(incoming[0].content); setMobileList(false); setNotice({ type: 'success', text: `${incoming.length} note${incoming.length > 1 ? 's' : ''} added` }); }).catch(() => setNotice({ type: 'error', text: 'One of the files could not be read.' })).finally(() => { setReading(false); event.target.value = ''; });
  };
  const runValidation = () => {
    const initial = validateContent(content, selected?.fileName, title);
    if (initial.status === 'error' && isLikelyHtml(content)) {
      const repaired = repairHtml(content);
      if (repaired.changed) {
        const repairedResult = validateContent(repaired.content, selected?.fileName, title);
        setContent(repaired.content);
        setValidation(repairedResult);
        saveContent(repaired.content);
        setPreviewOpen(true);
        setPreviewKey((key) => key + 1);
        setNotice({
          type: repairedResult.status === 'error' ? 'error' : 'success',
          text: repairedResult.status === 'error'
            ? 'Some issues remain. Review the findings below.'
            : 'HTML structure repaired automatically and preview started.',
        });
        return;
      }
    }
    setValidation(initial);
    if (isLikelyHtml(content)) {
      setPreviewOpen(true);
      setPreviewKey((key) => key + 1);
      setNotice({ type: 'success', text: 'Check complete. HTML preview started.' });
    }
  };
  const openHtmlFile = () => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' }));
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) setNotice({ type: 'error', text: 'The browser blocked the new tab. Use the preview in this page instead.' });
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const saveHtmlFile = async () => {
    if (!selected) return;
    const importedHtmlName = selected.fileName && /\.(html?|HTML?)$/i.test(selected.fileName) ? selected.fileName : '';
    const safeTitle = title.trim().replace(/\.(html?|HTML?)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim() || 'document';
    const fileName = importedHtmlName || `${safeTitle}.html`;
    const file = new File([content], fileName, { type: 'text/html;charset=utf-8' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName, text: 'HTML file exported from ScriptValidator.' });
        setNotice({ type: 'success', text: 'HTML file ready to save from the iOS share sheet.' });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setNotice({ type: 'success', text: `Downloaded ${fileName}. Use Files or FileBrowser Pro to store it.` });
  };
  const saveSourceFile = async () => {
    if (!selected) return;
    const language = getLanguage(content, selected.fileName, title);
    const importedName = selected.fileName && !(language === 'python' && /\.txt$/i.test(selected.fileName)) ? selected.fileName : '';
    const safeTitle = title.trim()
      .replace(/\.(html?|py|txt|jsx?|tsx?|css|json|xml|md|csv|svg|ya?ml|sql|sh|java|c(?:pp)?|vue|svelte)$/i, '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .trim() || 'script';
    const extension = language === 'python' ? 'py' : getFileExtension(selected.fileName || title) || 'txt';
    const fileName = importedName || `${safeTitle}.${extension}`;
    const fileType = language === 'python' ? 'text/x-python;charset=utf-8' : 'text/plain;charset=utf-8';
    const file = new File([content], fileName, { type: fileType });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName, text: `${fileName} exported from ScriptValidator.` });
        setNotice({ type: 'success', text: `${fileName} is ready in the iOS share sheet.` });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setNotice({ type: 'success', text: `Downloaded ${fileName}. Use Files or FileBrowser Pro to store it.` });
  };
  const startRename = () => {
    const titleInput = document.querySelector<HTMLInputElement>('[data-testid="input-note-title"]');
    titleInput?.focus();
    titleInput?.select();
  };
  const jumpToLine = (line: number) => { const lineStarts = content.split(/\r?\n/).slice(0, line - 1).reduce((sum, row) => sum + row.length + 1, 0); textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(lineStarts, lineStarts); };

  return (
    <div className="workspace-shell grain flex flex-col md:flex-row">
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="HTML preview">
          <div className="flex h-[min(88vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <div>
                <p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">Live preview</p>
                <p className="mt-1 text-sm text-muted-foreground">Repaired HTML runs locally in an isolated frame.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={openHtmlFile} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-secondary" data-testid="button-open-html">Open in new tab</button>
                <button onClick={() => setPreviewOpen(false)} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" data-testid="button-close-preview">Close</button>
              </div>
            </div>
            <iframe key={previewKey} title="HTML preview" srcDoc={content} sandbox="allow-scripts allow-forms" className="min-h-0 flex-1 bg-white" />
          </div>
        </div>
      )}
      <aside className={`flex w-full shrink-0 flex-col bg-sidebar text-sidebar-foreground md:h-[100dvh] md:w-[292px] ${!mobileList ? 'hidden md:flex' : 'flex'}`} data-testid="notes-sidebar">
        <div className="px-5 pt-4 md:hidden"><button onClick={() => fileInputRef.current?.click()} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-sidebar-primary/35 bg-sidebar-primary/10 text-sm font-semibold text-sidebar-primary" data-testid="button-upload-files-mobile"><Upload className="h-4 w-4" />Import files</button></div>
        <div className="border-b border-sidebar-border px-5 pb-5 pt-7">
          <div className="flex items-center justify-between"><div className="flex items-center gap-2.5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><ShieldCheck className="h-5 w-5" /></div><div><p className="font-display text-lg leading-none">ScriptValidator</p><p className="mt-1 font-mono-app text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/45">workspace / v4</p></div></div><button className="rounded-md p-2 text-sidebar-foreground/45 hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden" onClick={() => setMobileList(false)} aria-label="Open selected note" data-testid="button-close-notes"><ChevronRight className="h-4 w-4" /></button></div>
          <div className="mt-6 flex items-center justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-sidebar-primary">Your notes</p><p className="mt-1 text-xs text-sidebar-foreground/45">{notes.length} {notes.length === 1 ? 'note' : 'notes'} stored locally</p></div><button onClick={addNote} className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground transition-transform hover:scale-105" aria-label="Create new note" data-testid="button-create-note"><Plus className="h-4 w-4" /></button></div>
          <label className="mt-5 flex h-10 items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/55 px-3 text-sidebar-foreground/45 focus-within:border-sidebar-primary/65 focus-within:text-sidebar-primary"><Search className="h-4 w-4 shrink-0" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" className="min-w-0 flex-1 bg-transparent text-sm text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40" data-testid="input-search-notes" /></label>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto py-2">{reading && <div className="mx-4 my-2 flex items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-3 text-xs text-sidebar-foreground/65"><span className="h-2 w-2 animate-breathe rounded-full bg-sidebar-primary" />Reading text files…</div>}{filteredNotes.map((note, index) => <NoteRow key={note.id} note={note} active={note.id === selectedId} onSelect={() => selectNote(note.id)} onDelete={() => deleteNote(note.id)} index={index} validation={note.id === selectedId ? validation : undefined} />)}{!filteredNotes.length && <div className="mx-5 my-12 text-center"><Search className="mx-auto h-7 w-7 text-sidebar-foreground/25" /><p className="mt-3 text-sm text-sidebar-foreground/65">No notes match that search.</p><button onClick={() => setSearch('')} className="mt-2 text-xs text-sidebar-primary hover:underline" data-testid="button-clear-search">Clear search</button></div>}</div>
           <div className="border-t border-sidebar-border p-4"><p className="text-center font-mono-app text-[9px] uppercase tracking-[.12em] text-sidebar-foreground/35">Private by design · browser only</p><p className="mt-2 text-center text-[10px] leading-relaxed text-sidebar-foreground/45" data-testid="text-storage-info">Drafts stay in this browser. Use Save HTML or Save file to export to Files or FileBrowser Pro.</p></div>
      </aside>
       <main className={`min-w-0 flex-1 ${mobileList ? 'hidden md:block' : 'block'}`} data-testid="editor-workspace">
         <div className="flex items-center justify-between gap-3 border-b border-border bg-card/70 px-5 py-3 md:px-10">
           <div>
             <p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-muted-foreground">File actions</p>
             <p className="mt-1 text-xs text-muted-foreground">Text, web and source files stay local in this browser.</p>
           </div>
             <div className="flex flex-wrap items-center justify-end gap-2">
               {selected && isLikelyHtml(content) && <button onClick={saveHtmlFile} className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-secondary" data-testid="button-save-html"><FileDown className="h-3.5 w-3.5" />Save HTML</button>}
               {selected && !isLikelyHtml(content) && <button onClick={saveSourceFile} className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-secondary" data-testid="button-save-file"><FileDown className="h-3.5 w-3.5" />Save file</button>}
             {selected && <button onClick={startRename} className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-secondary" data-testid="button-rename-note"><Pencil className="h-3.5 w-3.5" />Rename</button>}
             <button onClick={() => fileInputRef.current?.click()} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90" data-testid="button-upload-files-top"><Upload className="h-3.5 w-3.5" />Import files</button>
             <input ref={fileInputRef} type="file" accept={supportedFileAccept} multiple onChange={readFiles} className="hidden" data-testid="input-upload-files" />
           </div>
         </div>
        <header className="flex min-h-[72px] items-center justify-between border-b border-border bg-background/80 px-5 backdrop-blur-sm md:px-10"><div className="flex items-center gap-3"><button className="rounded-lg border border-border bg-card p-2 text-muted-foreground md:hidden" onClick={() => setMobileList(true)} aria-label="Show all notes" data-testid="button-show-notes"><Menu className="h-4 w-4" /></button><div className="hidden h-8 w-px bg-border md:block" /><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-muted-foreground">Plain-text inspection</p><p className="mt-0.5 text-sm text-foreground/70">{selected ? 'Editing in your local workspace' : 'Select a note to begin'}</p></div></div><div className="flex items-center gap-2"><span className="hidden items-center gap-1.5 rounded-full border border-teal-800/15 bg-teal-800/5 px-2.5 py-1.5 font-mono-app text-[10px] uppercase tracking-[.12em] text-teal-800 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-teal-700" />local only</span><button onClick={addNote} className="rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden" aria-label="Create note" data-testid="button-mobile-create-note"><FilePlus2 className="h-4 w-4" /></button></div></header>
          {notice && <div className={`mx-5 mt-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm animate-rise md:mx-10 ${notice.type === 'error' ? 'border-red-800/20 bg-red-800/5 text-red-900' : 'border-teal-800/20 bg-teal-800/5 text-teal-900'}`} role="status" data-testid="status-notice">{notice.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <Check className="h-4 w-4" />}{notice.text}<button className="ml-auto p-1 opacity-60 hover:opacity-100" onClick={() => setNotice(null)} aria-label="Dismiss message" data-testid="button-dismiss-notice"><X className="h-4 w-4" /></button></div>}
         {selected ? <div className="mx-auto max-w-[1120px] px-5 pb-16 pt-7 md:px-10 md:pt-10"><div className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-mono-app text-[10px] uppercase tracking-[.18em] text-muted-foreground"><FolderOpen className="h-3.5 w-3.5 text-primary" />Local note <span className="text-border">/</span> {selected.source === 'upload' ? 'Imported file' : 'Text document'}</div><input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={saveCurrent} className="mt-3 w-full truncate bg-transparent font-display text-4xl leading-tight text-foreground outline-none placeholder:text-muted-foreground/50 md:text-5xl" placeholder="Untitled note" data-testid="input-note-title" /><p className="mt-2 text-sm text-muted-foreground">Changes are saved to this browser automatically.</p></div><div className="flex shrink-0 items-center gap-2"><button onClick={() => deleteNote(selected.id)} className="flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-red-800/25 hover:bg-red-800/5 hover:text-red-900" data-testid="button-delete-current"><Trash2 className="h-4 w-4" /><span className="hidden sm:inline">Delete</span></button><button onClick={saveCurrent} className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02]" data-testid="button-save-note"><Check className="h-4 w-4" />Save</button></div></div><div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_315px]"><section><div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm"><div className="flex h-10 items-center justify-between border-b border-border bg-secondary/35 px-4"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="font-mono-app text-[10px] uppercase tracking-[.16em] text-muted-foreground">{getLanguage(content, selected.fileName, title)} editor</span></div><span className="font-mono-app text-[10px] text-muted-foreground/70">{content.length.toLocaleString()} chars</span></div><textarea ref={textareaRef} value={content} onChange={(event) => { setContent(event.target.value); setValidation({ status: 'idle', findings: [], lines: event.target.value.split(/\r?\n/).length, chars: event.target.value.length, language: getLanguage(event.target.value, selected.fileName, title) }); }} onBlur={saveCurrent} spellCheck={false} placeholder="Start writing or import a text/source file…" className="editor-textarea block min-h-[420px] w-full resize-y bg-card px-5 py-5 font-mono-app text-[13px] leading-[1.8] text-foreground outline-none md:min-h-[510px]" data-testid="textarea-note-content" /></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><div className="flex items-center gap-4"><span data-testid="text-line-count">{content.split(/\r?\n/).length} lines</span><span>{content.trim() ? 'Text ready' : 'Empty document'}</span></div><span className="font-mono-app text-[10px] uppercase tracking-[.12em]">local static check / UTF-8</span></div></section><aside className="space-y-4"><div className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">Validator</p><h2 className="mt-1 font-display text-2xl">Check this file</h2></div><div className="rounded-lg bg-secondary p-2 text-primary"><ClipboardCheck className="h-5 w-5" /></div></div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{getLanguage(content, selected.fileName, title) === 'python' ? 'Checks Python delimiters, encoding, style, and Pythonista runtime requirements without executing the script.' : 'A quick local pass for structure, readability, and common script issues.'}</p><button onClick={runValidation} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent font-semibold text-accent-foreground transition-transform hover:scale-[1.01]" data-testid="button-validate"><ShieldCheck className="h-4 w-4" />Validate current file</button></div><ValidationCard result={validation} onJump={jumpToLine} /><div className="rounded-xl border border-border bg-secondary/35 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Info className="h-4 w-4 text-primary" />What is checked?</div><ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">{getLanguage(content, selected.fileName, title) === 'python' ? <><li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Balanced Python brackets and delimiters</li><li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Pythonista 3 modules and required requests/network access</li><li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Encoding loss, TODO markers, and long-line style hints</li><li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />No execution, API calls, or API keys are performed in the browser</li></> : <><li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Long lines and inconsistent indentation</li><li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Unresolved TODO markers</li><li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />Unclosed HTML-style tags</li><li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />UTF-8 replacement characters that indicate a decoding problem</li></>}</ul></div></aside></div></div> : <div className="flex min-h-[calc(100dvh-72px)] items-center justify-center p-8"><div className="max-w-sm text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/35 text-primary"><FileText className="h-8 w-8" /></div><h1 className="mt-6 font-display text-3xl">Your workspace is clear.</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Create a text note or bring in a local .txt file to start validating.</p><div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center"><button onClick={addNote} className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="button-empty-create"><Plus className="h-4 w-4" />New note</button><button onClick={() => fileInputRef.current?.click()} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold" data-testid="button-empty-upload"><Upload className="h-4 w-4" />Import file</button></div></div></div>}
      </main>
    </div>
  );
}

function Router() { return <Switch><Route path="/" component={Workspace} /><Route component={() => <div className="p-10"><h1 className="font-display text-4xl">Page not found</h1></div>} /></Switch>; }
function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><Router /></RoutedErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>; }
export default App;