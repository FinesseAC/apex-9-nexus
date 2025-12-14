/**
 * @license SPDX-License-Identifier: Apache-2.0
 * APEX-9 NEXUS - Elite Multimodal AI Orchestration Platform
 */
import React, { useState, useRef, useEffect, Component, type ReactNode } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  ShieldCheck, Library, BrainCircuit, Sparkles, Film, 
  Send, Upload, Loader2, AlertTriangle, FileText, Trash2, 
  Copy, CheckCircle2, X, History, Download, RefreshCw, LayoutTemplate,
  HelpCircle, Keyboard, Info, AlertCircle, BarChart3, Globe, Layers,
  Square, Sliders, Plus, XCircle, Zap, Search,
  ArrowRight, Star, FileAudio, Video
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from '@google/genai';

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim().slice(0, 32000);
}

// --- Constants ---
const MODELS = {
  TEXT_FAST: 'gemini-2.0-flash',
  TEXT_COMPLEX: 'gemini-1.5-pro',
  IMAGE_GEN: 'imagen-3.0-generate-001',
};

const SCHEMAS = {
  ANALYST: {
    type: Type.OBJECT,
    properties: {
      analysis: { type: Type.STRING, description: "Detailed markdown analysis." },
      score: { type: Type.NUMBER, description: "Quality score 0-100." },
      key_points: { type: Type.ARRAY, items: { type: Type.STRING } },
      confidence: { type: Type.NUMBER, description: "Confidence 0-1." },
    },
    required: ["analysis", "score", "key_points", "confidence"]
  },
  ORACLE: {
    type: Type.OBJECT,
    properties: {
      answer: { type: Type.STRING, description: "Direct answer in markdown." },
      sources: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, uri: { type: Type.STRING } } } },
      confidence: { type: Type.NUMBER },
    },
    required: ["answer", "sources", "confidence"]
  }
};

// --- Types ---
type EngineId = 'analyst' | 'oracle' | 'strategist' | 'creator' | 'animator';
type MediaType = 'image' | 'video' | 'audio';

interface GlobalFile {
  base64: string;
  mimeType: string;
  preview: string;
  fileObj: File;
}

interface StandardResponse {
  text?: string;
  analysis?: string;
  answer?: string;
  score?: number;
  confidence?: number;
  key_points?: string[];
  sources?: { title: string; uri: string }[];
}

type HistoryItem = {
  id: string;
  engine: EngineId;
  prompt: string;
  response: StandardResponse | string;
  media?: { url: string; type: MediaType }[];
  timestamp: number;
  modelUsed?: string;
  favorite?: boolean;
};

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface Template {
  id: string;
  name: string;
  description: string;
  engine: EngineId;
  prompt: string;
}

interface AdvancedParams {
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
  safety: 'standard' | 'strict' | 'none';
}


// --- Zustand Store ---
interface AppState {
  activeEngine: EngineId;
  setActiveEngine: (id: EngineId) => void;
  isShortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  isHistoryOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  isTemplatesOpen: boolean;
  setTemplatesOpen: (open: boolean) => void;
  isFirstVisit: boolean;
  completeOnboarding: () => void;
  globalInput: string;
  setGlobalInput: (s: string) => void;
  globalFiles: GlobalFile[];
  setGlobalFiles: (files: GlobalFile[]) => void;
  removeGlobalFile: (index: number) => void;
  history: HistoryItem[];
  addToHistory: (item: Omit<HistoryItem, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;
  removeHistoryItem: (id: string) => void;
  toggleFavorite: (id: string) => void;
  templates: Template[];
  addTemplate: (t: Omit<Template, 'id'>) => void;
  removeTemplate: (id: string) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  advancedParams: AdvancedParams;
  setAdvancedParams: (p: Partial<AdvancedParams>) => void;
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
}

const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeEngine: 'analyst',
      setActiveEngine: (id) => set({ activeEngine: id }),
      isShortcutsOpen: false,
      setShortcutsOpen: (open) => set({ isShortcutsOpen: open }),
      isHistoryOpen: false,
      setHistoryOpen: (open) => set({ isHistoryOpen: open }),
      isTemplatesOpen: false,
      setTemplatesOpen: (open) => set({ isTemplatesOpen: open }),
      isFirstVisit: true,
      completeOnboarding: () => set({ isFirstVisit: false }),
      globalInput: '',
      setGlobalInput: (s) => set({ globalInput: s }),
      globalFiles: [],
      setGlobalFiles: (files) => set({ globalFiles: files }),
      removeGlobalFile: (index) => set((state) => ({ globalFiles: state.globalFiles.filter((_, i) => i !== index) })),
      history: [],
      addToHistory: (item) => set((state) => ({ 
        history: [{ ...item, id: crypto.randomUUID(), timestamp: Date.now() }, ...state.history] 
      })),
      clearHistory: () => set({ history: [] }),
      removeHistoryItem: (id) => set((state) => ({ history: state.history.filter(i => i.id !== id) })),
      toggleFavorite: (id) => set((state) => ({
        history: state.history.map(h => h.id === id ? { ...h, favorite: !h.favorite } : h)
      })),
      templates: [
        { id: 't1', name: 'UI Audit', description: 'Analyze UI accessibility', engine: 'analyst', prompt: 'Conduct a forensic UI/UX audit. Identify accessibility violations (WCAG 2.1), visual hierarchy flaws.' },
        { id: 't2', name: 'Tech Blog', description: 'Draft technical article', engine: 'strategist', prompt: 'Write a technical blog post about [TOPIC]. Structure: Hook, Problem, Solution, Conclusion.' },
        { id: 't3', name: 'Cinematic Scene', description: 'Video prompt', engine: 'animator', prompt: 'Cinematic shot, 35mm lens, golden hour. Subject: [SUBJECT]. Mood: Atmospheric.' }
      ],
      addTemplate: (t) => set((state) => ({ templates: [...state.templates, { ...t, id: crypto.randomUUID() }] })),
      removeTemplate: (id) => set((state) => ({ templates: state.templates.filter(t => t.id !== id) })),
      apiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
      setApiKey: (key) => set({ apiKey: key }),
      advancedParams: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        safety: 'standard'
      },
      setAdvancedParams: (p) => set((state) => ({ advancedParams: { ...state.advancedParams, ...p } })),
      toasts: [],
      addToast: (message, type = 'info') => {
        const id = crypto.randomUUID();
        set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
        setTimeout(() => get().removeToast(id), 4000);
      },
      removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),
    }),
    {
      name: 'apex9-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ 
        history: state.history, 
        templates: state.templates,
        advancedParams: state.advancedParams,
        isFirstVisit: state.isFirstVisit,
        apiKey: state.apiKey
      }),
    }
  )
);

// --- Helpers ---
const getClient = (apiKey: string) => new GoogleGenAI({ apiKey });

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

async function generateWithRetry(ai: GoogleGenAI, model: string, params: any, retries = 2): Promise<any> {
  const { advancedParams } = useStore.getState();
  if (!navigator.onLine) throw new Error("Network offline.");

  const config = {
    ...params.config,
    temperature: advancedParams.temperature,
    topP: advancedParams.topP,
    topK: advancedParams.topK,
    maxOutputTokens: advancedParams.maxOutputTokens,
  };

  if (advancedParams.safety === 'none') {
    config.safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];
  }

  for (let i = 0; i < retries; i++) {
    try {
      const response = await ai.models.generateContent({ model, ...params, config });
      if (params.config?.responseSchema) {
        return JSON.parse(response.text!);
      }
      return response;
    } catch (e: any) {
      if (e.message.includes("429")) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}


// --- UI Components ---
const ToastContainer = () => {
  const toasts = useStore(s => s.toasts);
  return (
    <div role="status" aria-live="polite" className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={cn(
              "pointer-events-auto px-4 py-3 rounded-lg shadow-2xl border flex items-center gap-3 min-w-[300px]",
              toast.type === 'success' ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-200" :
              toast.type === 'error' ? "bg-red-950/90 border-red-500/50 text-red-200" :
              "bg-slate-900/90 border-blue-500/50 text-blue-200"
            )}
          >
            {toast.type === 'success' && <CheckCircle2 size={18} />}
            {toast.type === 'error' && <AlertCircle size={18} />}
            {toast.type === 'info' && <Info size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

const ApiKeyModal = () => {
  const { apiKey, setApiKey, addToast } = useStore();
  const [inputKey, setInputKey] = useState(apiKey);
  const [isOpen, setIsOpen] = useState(!apiKey);

  if (!isOpen && apiKey) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-8 shadow-2xl">
        <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <Zap size={32} className="text-blue-400" />
        </div>
        <h2 className="text-2xl font-bold text-center mb-2">API Key Required</h2>
        <p className="text-slate-400 text-center mb-6 text-sm">Enter your Google AI API key to activate APEX-9</p>
        <input
          type="password"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          placeholder="AIza..."
          className="input-cyber w-full mb-4"
        />
        <button
          onClick={() => {
            if (inputKey.length > 10) {
              setApiKey(inputKey);
              setIsOpen(false);
              addToast("API Key configured", 'success');
            } else {
              addToast("Invalid API key", 'error');
            }
          }}
          className="btn-primary w-full"
        >
          Initialize System
        </button>
        <p className="text-xs text-slate-500 text-center mt-4">
          Get your key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="text-blue-400 hover:underline">AI Studio</a>
        </p>
      </motion.div>
    </motion.div>
  );
};

const AdvancedSettingsPanel = () => {
  const { advancedParams, setAdvancedParams } = useStore();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative z-20">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className={cn("flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold uppercase border transition-all", 
          isOpen ? "bg-blue-500/20 border-blue-500 text-blue-400" : "bg-slate-900 border-slate-700 text-slate-500 hover:text-white")}
      >
        <Sliders size={14} /> Advanced
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} 
            className="absolute top-full right-0 mt-2 w-72 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl p-4 z-50">
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-4 border-b border-slate-800 pb-2">Generation Config</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="flex justify-between text-xs text-slate-400"><span>Temperature</span><span>{advancedParams.temperature}</span></label>
                <input type="range" min="0" max="2" step="0.1" value={advancedParams.temperature} 
                  onChange={e => setAdvancedParams({ temperature: parseFloat(e.target.value) })} 
                  className="w-full accent-blue-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
              </div>
              <div className="space-y-1">
                <label className="flex justify-between text-xs text-slate-400"><span>Top P</span><span>{advancedParams.topP}</span></label>
                <input type="range" min="0" max="1" step="0.05" value={advancedParams.topP} 
                  onChange={e => setAdvancedParams({ topP: parseFloat(e.target.value) })} 
                  className="w-full accent-blue-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
              </div>
              <div className="space-y-1">
                <label className="flex justify-between text-xs text-slate-400"><span>Safety</span></label>
                <select value={advancedParams.safety} onChange={e => setAdvancedParams({ safety: e.target.value as any })} 
                  className="w-full bg-slate-900 border border-slate-700 rounded text-xs p-2 text-slate-300">
                  <option value="standard">Standard</option>
                  <option value="strict">Strict</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ShortcutsModal = () => {
  const { isShortcutsOpen, setShortcutsOpen } = useStore();
  if (!isShortcutsOpen) return null;
  const shortcuts = [
    { key: 'Ctrl + 1-5', desc: 'Switch Engines' },
    { key: 'Ctrl + H', desc: 'Toggle History' },
    { key: '/', desc: 'Open Shortcuts' }
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center" onClick={() => setShortcutsOpen(false)}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="bg-slate-950 border border-slate-800 rounded-xl p-6 w-[400px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold flex items-center gap-2"><Keyboard className="text-blue-400"/> Shortcuts</h2>
          <button onClick={() => setShortcutsOpen(false)}><X className="text-slate-500 hover:text-white" /></button>
        </div>
        <div className="space-y-3">
          {shortcuts.map(s => (
            <div key={s.key} className="flex justify-between items-center text-sm p-3 rounded-lg bg-slate-900/50 border border-slate-800/50">
              <span className="text-slate-300">{s.desc}</span>
              <code className="bg-slate-800 border border-slate-700 px-2 py-1 rounded text-xs font-mono text-blue-400">{s.key}</code>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

const HistorySidebar = () => {
  const { isHistoryOpen, setHistoryOpen, history, toggleFavorite, setActiveEngine, setGlobalInput, removeHistoryItem } = useStore();
  const [filter, setFilter] = useState('');
  const filtered = history.filter(h => h.prompt.toLowerCase().includes(filter.toLowerCase()));

  return (
    <AnimatePresence>
      {isHistoryOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={() => setHistoryOpen(false)} />
          <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 25 }} 
            className="fixed top-0 left-0 bottom-0 w-80 bg-slate-950 border-r border-slate-800 z-50 flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2"><History size={18} className="text-blue-400"/> History</h2>
              <button onClick={() => setHistoryOpen(false)}><X size={18} className="text-slate-500 hover:text-white"/></button>
            </div>
            <div className="p-4 border-b border-slate-800">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-500" size={14} />
                <input className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 pl-9 pr-4 text-xs text-slate-200 placeholder-slate-600" 
                  placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
              {filtered.map(item => (
                <div key={item.id} className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 hover:border-blue-500/30 transition-all group">
                  <div className="flex justify-between items-center mb-2">
                    <span className={cn("text-[10px] font-bold uppercase", 
                      item.engine === 'analyst' ? "text-blue-400" : 
                      item.engine === 'oracle' ? "text-purple-400" : 
                      item.engine === 'strategist' ? "text-emerald-400" : 
                      item.engine === 'creator' ? "text-amber-400" : "text-pink-400"
                    )}>{item.engine}</span>
                    <span className="text-[10px] text-slate-600 font-mono">{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-xs text-slate-300 font-mono truncate mb-2">{item.prompt}</p>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-800/50">
                    <button onClick={() => { setActiveEngine(item.engine); setGlobalInput(item.prompt); setHistoryOpen(false); }} 
                      className="text-[10px] font-bold text-blue-400 flex items-center gap-1 hover:underline">
                      <RefreshCw size={10}/> Reuse
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => toggleFavorite(item.id)} className={cn("hover:scale-110 transition-transform", item.favorite ? "text-yellow-500" : "text-slate-600 hover:text-yellow-500")}>
                        <Star size={12} fill={item.favorite ? "currentColor" : "none"}/>
                      </button>
                      <button onClick={() => removeHistoryItem(item.id)} className="text-slate-600 hover:text-red-400"><Trash2 size={12}/></button>
                    </div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && <p className="text-center text-slate-500 text-sm py-8">No history yet</p>}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

class GlobalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-center p-8">
        <div className="w-24 h-24 bg-red-900/20 rounded-full flex items-center justify-center mb-6"><XCircle size={48} className="text-red-500" /></div>
        <h1 className="text-2xl font-bold text-white mb-2">System Critical Error</h1>
        <p className="text-slate-400 mb-8">APEX-9 encountered an unrecoverable exception.</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Force Reboot</button>
      </div>
    );
    return this.props.children;
  }
}


// --- Engine Components ---
const AnalystEngine = React.memo(() => {
  const [mode, setMode] = useState<'audit' | 'research' | 'viz' | 'comp'>('audit');
  const { globalInput, setGlobalInput, globalFiles, setGlobalFiles, removeGlobalFile, addToHistory, addToast, apiKey } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const ai = getClient(apiKey);
      let sysInstruct = "You are APEX-9 Analyst. ";
      if (mode === 'audit') sysInstruct += "Perform forensic audit. Identify flaws, risks, improvements.";
      if (mode === 'research') sysInstruct += "Conduct deep synthesis with citations.";
      if (mode === 'viz') sysInstruct += "Analyze data and suggest visualizations.";
      if (mode === 'comp') sysInstruct += "Perform competitive analysis.";

      const parts: any[] = [];
      if (globalInput) parts.push({ text: sanitizeInput(globalInput) });
      globalFiles.forEach(file => {
        parts.push({ inlineData: { mimeType: file.mimeType, data: file.base64 } });
      });

      return await generateWithRetry(ai, MODELS.TEXT_COMPLEX, {
        contents: { parts },
        config: { systemInstruction: sysInstruct, responseMimeType: "application/json", responseSchema: SCHEMAS.ANALYST }
      });
    },
    onSuccess: (data) => {
      addToHistory({ engine: 'analyst', prompt: `[${mode.toUpperCase()}] ${globalInput.slice(0, 50)}`, response: data, modelUsed: MODELS.TEXT_COMPLEX });
      setGlobalInput(''); setGlobalFiles([]); addToast("Analysis Complete", 'success');
    },
    onError: (err: Error) => addToast(err.message, 'error')
  });

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newFiles: GlobalFile[] = [];
    for (const f of Array.from(files)) {
      if (f.size > 10 * 1024 * 1024) { addToast("File too large (max 10MB)", 'error'); continue; }
      const b64 = await fileToBase64(f);
      newFiles.push({ base64: b64, mimeType: f.type, preview: URL.createObjectURL(f), fileObj: f });
    }
    setGlobalFiles([...globalFiles, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="grid grid-cols-4 gap-1 bg-slate-900/50 p-1 rounded-lg">
        {[{ id: 'audit', icon: FileText, label: 'Audit' }, { id: 'research', icon: Globe, label: 'Research' }, { id: 'viz', icon: BarChart3, label: 'Viz' }, { id: 'comp', icon: Layers, label: 'Comp' }].map(m => (
          <button key={m.id} onClick={() => setMode(m.id as any)} 
            className={cn("flex flex-col items-center gap-1 py-2 text-[10px] font-bold uppercase rounded transition-all", 
              mode === m.id ? "bg-slate-800 text-blue-400 shadow-sm" : "text-slate-500 hover:text-slate-300")}>
            <m.icon size={16} /> {m.label}
          </button>
        ))}
      </div>
      <textarea className="input-cyber w-full flex-1 resize-none min-h-[100px]" placeholder={`Enter context for ${mode} analysis...`} 
        value={globalInput} onChange={e => setGlobalInput(e.target.value)} />
      
      {globalFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {globalFiles.map((f, i) => (
            <div key={i} className="relative bg-slate-900 border border-slate-700 rounded-md p-2 flex items-center gap-2 max-w-[200px]">
              {f.mimeType.startsWith('image') ? <img src={f.preview} className="w-8 h-8 object-cover rounded" alt="" /> : 
               f.mimeType.startsWith('video') ? <Video size={20} className="text-blue-400" /> : <FileAudio size={20} className="text-purple-400" />}
              <span className="text-xs truncate flex-1">{f.fileObj.name}</span>
              <button onClick={() => removeGlobalFile(i)} className="text-slate-500 hover:text-red-400"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <div onClick={() => fileInputRef.current?.click()} 
        className="border-2 border-dashed border-slate-800 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:border-slate-600 transition-colors">
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFiles} accept="image/*,video/*,audio/*" />
        <Upload className="mb-1 text-slate-500" size={20} />
        <span className="text-[10px] font-bold text-slate-500 uppercase">Attach Files</span>
      </div>
      <div className="flex justify-between items-center">
        <AdvancedSettingsPanel/>
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !globalInput} className="btn-primary w-1/2">
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Zap size={18} />} EXECUTE
        </button>
      </div>
    </div>
  );
});

const OracleEngine = React.memo(() => {
  const [useSearch, setUseSearch] = useState(true);
  const { globalInput, setGlobalInput, addToHistory, addToast, apiKey } = useStore();
  
  const mutation = useMutation({
    mutationFn: async () => {
      const ai = getClient(apiKey);
      return await generateWithRetry(ai, MODELS.TEXT_FAST, {
        contents: sanitizeInput(globalInput),
        config: { tools: useSearch ? [{ googleSearch: {} }] : [], responseMimeType: "application/json", responseSchema: SCHEMAS.ORACLE }
      });
    },
    onSuccess: (data) => {
      addToHistory({ engine: 'oracle', prompt: globalInput, response: data, modelUsed: MODELS.TEXT_FAST });
      setGlobalInput(''); addToast("Insight Retrieved", 'success');
    },
    onError: (e: Error) => addToast(e.message, 'error')
  });

  return (
    <div className="space-y-4 h-full flex flex-col justify-center">
      <div className="flex justify-end">
        <button onClick={() => setUseSearch(!useSearch)} 
          className={cn("text-xs font-bold uppercase flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all", 
            useSearch ? "bg-blue-500/10 border-blue-500 text-blue-400" : "bg-slate-900 border-slate-700 text-slate-500")}>
          <Globe size={12} /> Search {useSearch ? "ON" : "OFF"}
        </button>
      </div>
      <input className="input-cyber w-full text-lg" placeholder="Ask the Oracle..." 
        value={globalInput} onChange={e => setGlobalInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && mutation.mutate()} />
      <div className="flex justify-between items-center">
        <AdvancedSettingsPanel/>
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !globalInput} className="btn-primary w-1/2">
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Search size={18} />} CONSULT
        </button>
      </div>
    </div>
  );
});

const StrategistEngine = React.memo(() => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const { globalInput, setGlobalInput, addToHistory, addToast, apiKey } = useStore();

  const handleSend = async () => {
    if (!globalInput) return;
    setIsStreaming(true); setStreamText('');
    abortRef.current = new AbortController();
    try {
      const ai = getClient(apiKey);
      const stream = await ai.models.generateContentStream({ model: MODELS.TEXT_COMPLEX, contents: sanitizeInput(globalInput) });
      let final = '';
      for await (const chunk of stream) {
        if (abortRef.current?.signal.aborted) break;
        final += chunk.text;
        setStreamText(final);
      }
      if (!abortRef.current?.signal.aborted) {
        addToHistory({ engine: 'strategist', prompt: globalInput, response: final, modelUsed: MODELS.TEXT_COMPLEX });
        setGlobalInput(''); setStreamText(''); addToast("Strategy Computed", 'success');
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') addToast(e.message, 'error');
    } finally { setIsStreaming(false); abortRef.current = null; }
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="relative flex-1">
        <textarea className="input-cyber w-full h-full resize-none font-mono" placeholder="Initialize strategic planning..." 
          value={globalInput} onChange={e => setGlobalInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()} />
        {isStreaming && (
          <div className="absolute inset-0 bg-slate-900/95 backdrop-blur border border-blue-500/30 p-4 overflow-y-auto rounded-lg">
            <div className="flex items-center justify-between mb-4 sticky top-0 bg-slate-900/90 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2 text-blue-400 text-xs uppercase animate-pulse"><BrainCircuit size={14}/> Processing...</div>
              <button onClick={() => abortRef.current?.abort()} className="text-red-400 hover:text-red-300"><Square size={14} fill="currentColor"/></button>
            </div>
            <div className="prose prose-invert prose-sm max-w-none"><ReactMarkdown>{streamText}</ReactMarkdown></div>
          </div>
        )}
      </div>
      <div className="flex justify-between items-center">
        <AdvancedSettingsPanel/>
        <button onClick={handleSend} disabled={isStreaming || !globalInput} className="btn-primary w-1/2">
          {isStreaming ? <Loader2 className="animate-spin" /> : <Send size={18} />} EXECUTE
        </button>
      </div>
    </div>
  );
});

const CreatorEngine = React.memo(() => {
  const [ar, setAr] = useState('1:1');
  const [style, setStyle] = useState('Photorealistic');
  const { globalInput, setGlobalInput, addToHistory, addToast, apiKey } = useStore();

  const mutation = useMutation({
    mutationFn: async () => {
      const ai = getClient(apiKey);
      const response = await ai.models.generateContent({
        model: MODELS.IMAGE_GEN,
        contents: { parts: [{ text: `${style} style. ${sanitizeInput(globalInput)}` }] },
        config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ar } } as any
      });
      const media = response.candidates?.[0]?.content?.parts?.filter((p: any) => p.inlineData)
        .map((p: any) => ({ url: `data:image/png;base64,${p.inlineData.data}`, type: 'image' as MediaType })) || [];
      if (media.length === 0) throw new Error("Image generation failed.");
      return { text: globalInput, media };
    },
    onSuccess: (data) => {
      addToHistory({ engine: 'creator', prompt: data.text, response: "Image Generated", media: data.media, modelUsed: MODELS.IMAGE_GEN });
      addToast("Image Generated", 'success');
    },
    onError: (e: Error) => addToast(e.message, 'error')
  });

  return (
    <div className="space-y-4 h-full flex flex-col">
      <textarea className="input-cyber w-full flex-1 resize-none" placeholder="Describe the visual..." 
        value={globalInput} onChange={e => setGlobalInput(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <select className="input-cyber" value={style} onChange={e => setStyle(e.target.value)}>
          {['Photorealistic', 'Cyberpunk', 'Minimalist', 'Watercolor', 'Oil Painting'].map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="input-cyber" value={ar} onChange={e => setAr(e.target.value)}>
          {['1:1', '16:9', '9:16', '4:3', '3:4'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !globalInput} className="btn-primary w-full">
        {mutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />} GENERATE
      </button>
    </div>
  );
});

const AnimatorEngine = React.memo(() => {
  const { globalInput, setGlobalInput, addToast } = useStore();
  const [ar, setAr] = useState('16:9');

  return (
    <div className="space-y-4 h-full flex flex-col">
      <textarea className="input-cyber w-full flex-1 resize-none" placeholder="Describe motion and scene..." 
        value={globalInput} onChange={e => setGlobalInput(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <select className="input-cyber" value={ar} onChange={e => setAr(e.target.value)}>
          {['16:9', '9:16', '1:1'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="input-cyber">
          <option value="5">5s Standard</option>
          <option value="8">8s Extended</option>
        </select>
      </div>
      <button onClick={() => addToast("Video generation requires Veo API access", 'info')} className="btn-primary w-full">
        <Film size={18} /> RENDER VIDEO
      </button>
      <p className="text-xs text-slate-500 text-center">Video generation requires Google Veo API access</p>
    </div>
  );
});


// --- Result Display ---
const ResultDisplay = () => {
  const { history, addToast } = useStore();
  const latest = history[0];
  
  if (!latest) return (
    <div className="h-full flex flex-col items-center justify-center text-slate-500">
      <BrainCircuit size={48} className="mb-4 opacity-50" />
      <p className="text-sm">Results will appear here</p>
    </div>
  );

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); addToast("Copied", 'success'); }
    catch { addToast("Copy failed", 'error'); }
  };

  const response = latest.response;
  const text = typeof response === 'string' ? response : 
    (response as StandardResponse).analysis || (response as StandardResponse).answer || (response as StandardResponse).text || JSON.stringify(response, null, 2);

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-bold uppercase px-2 py-1 rounded",
            latest.engine === 'analyst' ? "bg-blue-900/50 text-blue-400" :
            latest.engine === 'oracle' ? "bg-purple-900/50 text-purple-400" :
            latest.engine === 'strategist' ? "bg-emerald-900/50 text-emerald-400" :
            latest.engine === 'creator' ? "bg-amber-900/50 text-amber-400" : "bg-pink-900/50 text-pink-400"
          )}>{latest.engine}</span>
          <span className="text-xs text-slate-500">{latest.modelUsed}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => copyToClipboard(text)} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded transition-colors">
            <Copy size={14} />
          </button>
          <button className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded transition-colors">
            <Download size={14} />
          </button>
        </div>
      </div>
      
      {/* Score/Confidence badges */}
      {typeof response === 'object' && (
        <div className="flex gap-2 mb-4">
          {(response as StandardResponse).score !== undefined && (
            <span className="text-xs bg-blue-900/30 text-blue-300 px-2 py-1 rounded">Score: {(response as StandardResponse).score}/100</span>
          )}
          {(response as StandardResponse).confidence !== undefined && (
            <span className="text-xs bg-emerald-900/30 text-emerald-300 px-2 py-1 rounded">Confidence: {Math.round(((response as StandardResponse).confidence || 0) * 100)}%</span>
          )}
        </div>
      )}

      {/* Media display */}
      {latest.media && latest.media.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          {latest.media.map((m, i) => (
            <div key={i} className="relative group">
              {m.type === 'image' ? (
                <img src={m.url} alt="Generated" className="w-full rounded-lg border border-slate-700" />
              ) : m.type === 'video' ? (
                <video src={m.url} controls className="w-full rounded-lg border border-slate-700" />
              ) : (
                <audio src={m.url} controls className="w-full" />
              )}
              <a href={m.url} download className="absolute top-2 right-2 p-2 bg-slate-900/80 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                <Download size={14} />
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Text content */}
      <div className="flex-1 overflow-y-auto prose prose-invert prose-sm max-w-none scrollbar-thin">
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>

      {/* Key points */}
      {typeof response === 'object' && (response as StandardResponse).key_points && (
        <div className="mt-4 pt-4 border-t border-slate-800">
          <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Key Points</h4>
          <ul className="space-y-1">
            {(response as StandardResponse).key_points?.map((p, i) => (
              <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sources */}
      {typeof response === 'object' && (response as StandardResponse).sources && (response as StandardResponse).sources!.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-800">
          <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Sources</h4>
          <div className="space-y-1">
            {(response as StandardResponse).sources?.map((s, i) => (
              <a key={i} href={s.uri} target="_blank" rel="noopener" className="text-xs text-blue-400 hover:underline block truncate">
                {s.title || s.uri}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Main App ---
const App = () => {
  const { activeEngine, setActiveEngine, setShortcutsOpen, setHistoryOpen, apiKey } = useStore();
  const queryClient = new QueryClient();

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        if (['1','2','3','4','5'].includes(e.key)) {
          e.preventDefault();
          setActiveEngine(['analyst', 'oracle', 'strategist', 'creator', 'animator'][parseInt(e.key)-1] as EngineId);
        }
        if (e.key === 'h') { e.preventDefault(); setHistoryOpen(true); }
      }
      if (e.key === '/') setShortcutsOpen(true);
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [setActiveEngine, setHistoryOpen, setShortcutsOpen]);

  const engines = [
    { id: 'analyst', icon: ShieldCheck, label: 'Analyst', color: 'blue' },
    { id: 'oracle', icon: Library, label: 'Oracle', color: 'purple' },
    { id: 'strategist', icon: BrainCircuit, label: 'Strategist', color: 'emerald' },
    { id: 'creator', icon: Sparkles, label: 'Creator', color: 'amber' },
    { id: 'animator', icon: Film, label: 'Animator', color: 'pink' },
  ];

  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <div className="flex h-screen w-screen bg-slate-950 text-slate-200">
          <ToastContainer />
          <ShortcutsModal />
          <HistorySidebar />
          {!apiKey && <ApiKeyModal />}

          {/* Sidebar */}
          <div className="w-64 bg-slate-900/50 border-r border-slate-800 flex flex-col flex-shrink-0">
            <div className="p-6 border-b border-slate-800">
              <h1 className="font-bold text-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center font-black text-white">9</div>
                <div>
                  <span className="text-white">APEX-9</span>
                  <span className="block text-[10px] text-slate-500 uppercase tracking-wider">Neural Command</span>
                </div>
              </h1>
            </div>
            
            <nav className="flex-1 py-6 space-y-1 px-3">
              {engines.map(item => (
                <button key={item.id} onClick={() => setActiveEngine(item.id as EngineId)} 
                  className={cn("w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all rounded-lg group",
                    activeEngine === item.id 
                      ? `bg-${item.color}-500/10 text-${item.color}-400 border border-${item.color}-500/30` 
                      : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                  )}>
                  <item.icon size={18} />
                  <span>The {item.label}</span>
                  <span className="ml-auto text-[10px] opacity-50">⌘{engines.indexOf(item)+1}</span>
                </button>
              ))}
            </nav>

            <div className="p-4 border-t border-slate-800 space-y-2">
              <button onClick={() => setHistoryOpen(true)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-500 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors">
                <History size={16} /> History
              </button>
              <button onClick={() => setShortcutsOpen(true)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-500 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors">
                <HelpCircle size={16} /> Help
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex">
            {/* Engine Panel */}
            <div className="w-1/2 border-r border-slate-800 p-6 flex flex-col">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-white mb-1">The {engines.find(e => e.id === activeEngine)?.label}</h2>
                <p className="text-sm text-slate-500">
                  {activeEngine === 'analyst' && "Forensic analysis, audits, and deep research synthesis"}
                  {activeEngine === 'oracle' && "Grounded answers with real-time search capabilities"}
                  {activeEngine === 'strategist' && "Strategic planning with extended thinking"}
                  {activeEngine === 'creator' && "High-fidelity image generation"}
                  {activeEngine === 'animator' && "Cinematic video rendering"}
                </p>
              </div>
              
              <div className="flex-1">
                {activeEngine === 'analyst' && <AnalystEngine />}
                {activeEngine === 'oracle' && <OracleEngine />}
                {activeEngine === 'strategist' && <StrategistEngine />}
                {activeEngine === 'creator' && <CreatorEngine />}
                {activeEngine === 'animator' && <AnimatorEngine />}
              </div>
            </div>

            {/* Results Panel */}
            <div className="w-1/2 p-6 bg-slate-900/30">
              <ResultDisplay />
            </div>
          </div>
        </div>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
};

export default App;
