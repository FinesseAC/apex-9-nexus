/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useRef, useEffect, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
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
  Square, Sliders, GitBranch, Plus, XCircle, Zap, Search,
  ArrowRight, Star, SplitSquareHorizontal
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from '@google/genai';

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim().slice(0, 32000); // Prevent massive payloads/XSS
}

// --- Constants & Schemas ---
const MODELS = {
  TEXT_FAST: 'gemini-2.5-flash',
  TEXT_LITE: 'gemini-2.5-flash-lite-latest',
  TEXT_COMPLEX: 'gemini-3-pro-preview',
  IMAGE_GEN: 'gemini-3-pro-image-preview',
  IMAGE_FAST: 'gemini-2.5-flash-image',
  VIDEO_GEN: 'veo-3.1-fast-generate-preview',
  VIDEO_HQ: 'veo-3.1-generate-preview',
  AUDIO: 'gemini-2.5-flash',
};

const SCHEMAS = {
  ANALYST: {
    type: Type.OBJECT,
    properties: {
      analysis: { type: Type.STRING, description: "Detailed markdown analysis/content." },
      score: { type: Type.NUMBER, description: "Quality/Relevance score from 0-100." },
      key_points: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Critical findings or data points." },
      confidence: { type: Type.NUMBER, description: "Confidence 0-1." },
    },
    required: ["analysis", "score", "key_points", "confidence"]
  },
  ORACLE: {
    type: Type.OBJECT,
    properties: {
      answer: { type: Type.STRING, description: "Direct answer in markdown." },
      sources: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            uri: { type: Type.STRING }
          }
        }
      },
      confidence: { type: Type.NUMBER },
    },
    required: ["answer", "sources", "confidence"]
  }
};

// --- Types ---
type EngineId = 'analyst' | 'oracle' | 'strategist' | 'creator' | 'animator';
type MediaType = 'image' | 'video' | 'audio';

interface StandardResponse {
  text?: string;
  analysis?: string;
  answer?: string;
  score?: number;
  confidence?: number;
  key_points?: string[];
  sources?: { title: string; uri: string }[];
  groundingChunks?: any[];
}

type HistoryItem = {
  id: string;
  engine: EngineId;
  prompt: string;
  response: StandardResponse | string;
  media?: { url: string; type: MediaType }[];
  timestamp: number;
  modelUsed?: string;
  usage?: { input: number; output: number; total: number };
  favorite?: boolean;
  collectionId?: string;
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
  mode?: string;
}

interface Collection {
  id: string;
  name: string;
  color: string;
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
  // Navigation & UI
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

  // Global Input State
  globalInput: string;
  setGlobalInput: (s: string) => void;
  globalFile: { base64: string; mimeType: string; preview: string; fileObj: File } | null;
  setGlobalFile: (f: { base64: string; mimeType: string; preview: string; fileObj: File } | null) => void;

  // Data
  history: HistoryItem[];
  addToHistory: (item: Omit<HistoryItem, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;
  removeHistoryItem: (id: string) => void;
  toggleFavorite: (id: string) => void;

  collections: Collection[];
  addCollection: (name: string) => void;
  addToCollection: (itemId: string, collectionId: string) => void;

  templates: Template[];
  addTemplate: (t: Omit<Template, 'id'>) => void;
  removeTemplate: (id: string) => void;

  // Features
  compareMode: boolean;
  toggleCompareMode: () => void;
  compareSelection: string[];
  toggleCompareSelection: (id: string) => void;

  // Settings
  apiKey: string | undefined;
  advancedParams: AdvancedParams;
  setAdvancedParams: (p: Partial<AdvancedParams>) => void;

  // Notifications
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
  apiUsage: number;
  incrementApiUsage: () => void;
}

const useStore = create<AppState>()(
  persist(
    (set) => ({
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
      globalFile: null,
      setGlobalFile: (f) => set({ globalFile: f }),

      history: [],
      addToHistory: (item) => set((state) => ({
        history: [{ ...item, id: crypto.randomUUID(), timestamp: Date.now() }, ...state.history]
      })),
      clearHistory: () => set({ history: [] }),
      removeHistoryItem: (id) => set((state) => ({ history: state.history.filter(i => i.id !== id) })),
      toggleFavorite: (id) => set((state) => ({
        history: state.history.map(h => h.id === id ? { ...h, favorite: !h.favorite } : h)
      })),

      collections: [
        { id: 'c1', name: 'Research', color: 'bg-blue-500' },
        { id: 'c2', name: 'Creative', color: 'bg-purple-500' },
        { id: 'c3', name: 'Code', color: 'bg-emerald-500' }
      ],
      addCollection: (name) => set((state) => ({
        collections: [...state.collections, { id: crypto.randomUUID(), name, color: 'bg-slate-500' }]
      })),
      addToCollection: (itemId, collectionId) => set((state) => ({
        history: state.history.map(h => h.id === itemId ? { ...h, collectionId } : h)
      })),

      templates: [
        { id: 't1', name: 'UI Audit', description: 'Analyze UI accessibility and aesthetics', engine: 'analyst', prompt: 'Conduct a forensic UI/UX audit of this interface. Identify accessibility violations (WCAG 2.1), visual hierarchy flaws, and provide hex code corrections.', mode: 'audit' },
        { id: 't2', name: 'Tech Blog Post', description: 'Draft a technical article', engine: 'strategist', prompt: 'Write a technical blog post about [TOPIC]. Structure: Hook, Problem Statement, Technical Solution (with code blocks), Trade-offs, Conclusion.', mode: 'default' },
        { id: 't3', name: 'Cinematic Scene', description: 'Video prompt structure', engine: 'animator', prompt: 'Cinematic shot, 35mm lens, golden hour. Subject: [SUBJECT]. Action: [ACTION]. Mood: Atmospheric, high contrast.', mode: 'default' }
      ],
      addTemplate: (t) => set((state) => ({ templates: [...state.templates, { ...t, id: crypto.randomUUID() }] })),
      removeTemplate: (id) => set((state) => ({ templates: state.templates.filter(t => t.id !== id) })),

      compareMode: false,
      toggleCompareMode: () => set((state) => ({ compareMode: !state.compareMode, compareSelection: [] })),
      compareSelection: [],
      toggleCompareSelection: (id) => set((state) => {
        if (state.compareSelection.includes(id)) {
          return { compareSelection: state.compareSelection.filter(s => s !== id) };
        }
        if (state.compareSelection.length >= 2) return state;
        return { compareSelection: [...state.compareSelection, id] };
      }),

      apiKey: process.env.API_KEY,
      advancedParams: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        safety: 'standard'
      },
      setAdvancedParams: (p) => set((state) => ({ advancedParams: { ...state.advancedParams, ...p } })),

      toasts: [],
      addToast: (message, type = 'info') => set((state) => {
        const id = crypto.randomUUID();
        setTimeout(() => state.removeToast(id), 4000);
        return { toasts: [...state.toasts, { id, message, type }] };
      }),
      removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),
      apiUsage: 0,
      incrementApiUsage: () => set((state) => ({ apiUsage: state.apiUsage + 1 })),
    }),
    {
      name: 'apex9-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        history: state.history,
        templates: state.templates,
        collections: state.collections,
        advancedParams: state.advancedParams,
        isFirstVisit: state.isFirstVisit
      }),
    }
  )
);

// --- Helpers ---
const getClient = (apiKey: string) => new GoogleGenAI({ apiKey });

const ensurePaidKey = async () => {
  const aistudio = (window as any).aistudio;
  if (aistudio && aistudio.hasSelectedApiKey && aistudio.openSelectKey) {
    const hasKey = await aistudio.hasSelectedApiKey();
    if (!hasKey) {
      await aistudio.openSelectKey();
    }
  }
};

const validateFile = (file: File, type: 'image' | 'video' | 'audio'): { valid: boolean; error?: string } => {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_SIZE) return { valid: false, error: `File exceeds 10MB limit.` };
  const validTypes = {
    image: ['image/jpeg', 'image/png', 'image/webp'],
    video: ['video/mp4', 'video/webm'],
    audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mpeg']
  };
  if (!validTypes[type].includes(file.type)) {
    return { valid: false, error: `Invalid file type: ${file.type}` };
  }
  return { valid: true };
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

async function generateWithRetry(
  ai: GoogleGenAI,
  model: string,
  params: any,
  retries = 2
): Promise<any> {
  const { incrementApiUsage, advancedParams } = useStore.getState();

  // Offline Check
  if (!navigator.onLine) {
    throw new Error("Network offline. Please check your connection.");
  }

  // Inject Advanced Params
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

  const finalParams = { ...params, config };

  for (let i = 0; i < retries; i++) {
    try {
      incrementApiUsage();
      const response = await ai.models.generateContent({ model, ...finalParams });

      if (params.config?.responseSchema) {
        try {
          const parsed = JSON.parse(response.text!);
          if (response.candidates?.[0]?.groundingMetadata) {
             parsed.groundingChunks = response.candidates[0].groundingMetadata.groundingChunks;
          }
          return parsed;
        } catch (e) {
          if (i === retries - 1) throw new Error("Failed to parse structured response.");
          console.warn("JSON Parse failed, retrying...");
          continue;
        }
      }
      return response;
    } catch (e: any) {
      if (e.message.includes("429")) {
         await new Promise(r => setTimeout(r, 2000 * (i + 1))); // Longer backoff for rate limits
         continue;
      }
      if (i === retries - 1) throw e;
      console.warn(`Attempt ${i + 1} failed: ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// --- Components ---

const SkipLink = () => (
  <a
    href="#main-content"
    className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-[100] px-4 py-2 bg-primary text-white font-bold rounded shadow-xl"
  >
    Skip to Content
  </a>
);

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
              "bg-slate-900/90 border-primary/50 text-primary-glow"
            )}
          >
            {toast.type === 'success' && <CheckCircle2 size={18} aria-hidden="true" />}
            {toast.type === 'error' && <AlertCircle size={18} aria-hidden="true" />}
            {toast.type === 'info' && <Info size={18} aria-hidden="true" />}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

const AdvancedSettingsPanel = () => {
  const { advancedParams, setAdvancedParams } = useStore();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative z-20">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className={cn("flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold uppercase border transition-all focus-visible:ring-2 focus-visible:ring-primary", isOpen ? "bg-primary/20 border-primary text-primary" : "bg-slate-900 border-slate-700 text-slate-500 hover:text-white")}
      >
        <Sliders size={14} aria-hidden="true" /> Advanced
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full right-0 mt-2 w-72 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl p-4 z-50">
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-4 border-b border-slate-800 pb-2">Generation Config</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                 <label className="flex justify-between text-xs text-slate-400"><span>Temperature</span><span>{advancedParams.temperature}</span></label>
                 <input type="range" min="0" max="2" step="0.1" value={advancedParams.temperature} onChange={e => setAdvancedParams({ temperature: parseFloat(e.target.value) })} className="w-full accent-primary h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="space-y-1">
                 <label className="flex justify-between text-xs text-slate-400"><span>Top P</span><span>{advancedParams.topP}</span></label>
                 <input type="range" min="0" max="1" step="0.05" value={advancedParams.topP} onChange={e => setAdvancedParams({ topP: parseFloat(e.target.value) })} className="w-full accent-primary h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="space-y-1">
                 <label className="flex justify-between text-xs text-slate-400"><span>Top K</span><span>{advancedParams.topK}</span></label>
                 <input type="range" min="1" max="40" step="1" value={advancedParams.topK} onChange={e => setAdvancedParams({ topK: parseFloat(e.target.value) })} className="w-full accent-primary h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="space-y-1">
                 <label className="flex justify-between text-xs text-slate-400"><span>Safety Filter</span></label>
                 <select value={advancedParams.safety} onChange={e => setAdvancedParams({ safety: e.target.value as any })} className="w-full bg-slate-900 border border-slate-700 rounded text-xs p-2 text-slate-300 focus:border-primary focus:outline-none">
                    <option value="standard">Standard (Default)</option>
                    <option value="strict">Strict</option>
                    <option value="none">None (Unrestricted)</option>
                 </select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const TemplatesModal = () => {
  const { isTemplatesOpen, setTemplatesOpen, templates, setActiveEngine, setGlobalInput, addTemplate } = useStore();

  if (!isTemplatesOpen) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-8" onClick={() => setTemplatesOpen(false)}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-slate-950 border border-slate-700 rounded-xl w-full max-w-4xl h-[600px] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="tmpl-title">
         <div className="p-6 border-b border-slate-800 flex justify-between items-center">
            <h2 id="tmpl-title" className="text-xl font-bold flex items-center gap-2"><LayoutTemplate className="text-primary"/> Template Library</h2>
            <button onClick={() => setTemplatesOpen(false)} aria-label="Close templates"><X className="text-slate-500 hover:text-white" /></button>
         </div>
         <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-900/50">
            {templates.map(t => (
               <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-primary/50 transition-all group cursor-pointer flex flex-col h-48 focus-within:border-primary" onClick={() => { setActiveEngine(t.engine); setGlobalInput(t.prompt); setTemplatesOpen(false); }}>
                  <div className="flex justify-between items-start mb-2">
                     <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded", t.engine === 'analyst' ? "bg-blue-900 text-blue-300" : "bg-purple-900 text-purple-300")}>{t.engine}</span>
                     <button onClick={(e) => { e.stopPropagation(); useStore.getState().removeTemplate(t.id); }} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100" aria-label="Delete template"><Trash2 size={14}/></button>
                  </div>
                  <h3 className="font-bold text-slate-200 mb-1">{t.name}</h3>
                  <p className="text-xs text-slate-500 line-clamp-3 mb-4 flex-1">{t.description || t.prompt}</p>
                  <div className="text-xs font-bold text-primary flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">Load Template <ArrowRight size={12}/></div>
               </div>
            ))}
            <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-lg p-4 flex flex-col justify-center items-center text-slate-500 hover:bg-slate-900 hover:border-primary/30 transition-all cursor-pointer">
               <Plus className="mb-2" />
               <span className="text-xs font-bold uppercase">Save Current State</span>
            </div>
         </div>
      </motion.div>
    </motion.div>
  );
};

const HistorySidebar = () => {
  const { isHistoryOpen, setHistoryOpen, history, activeEngine, addToCollection, collections, toggleFavorite, setActiveEngine, setGlobalInput, removeHistoryItem } = useStore();
  const [filter, setFilter] = useState('');

  const filteredHistory = history.filter(h => h.prompt.toLowerCase().includes(filter.toLowerCase()) || (typeof h.response === 'string' && h.response.toLowerCase().includes(filter.toLowerCase())));

  return (
    <AnimatePresence>
      {isHistoryOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={() => setHistoryOpen(false)} />
          <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 25 }} className="fixed top-0 left-0 bottom-0 w-80 bg-slate-950 border-r border-slate-800 z-50 flex flex-col shadow-2xl" role="dialog" aria-label="History">
             <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                <h2 className="font-bold flex items-center gap-2"><History size={18} className="text-primary"/> History</h2>
                <button onClick={() => setHistoryOpen(false)} aria-label="Close history"><X size={18} className="text-slate-500 hover:text-white"/></button>
             </div>
             <div className="p-4 border-b border-slate-800">
                <div className="relative">
                   <Search className="absolute left-3 top-2.5 text-slate-500" size={14} />
                   <input className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 pl-9 pr-4 text-xs text-slate-200 placeholder-slate-600 focus:border-primary outline-none" placeholder="Search history..." value={filter} onChange={e => setFilter(e.target.value)} />
                </div>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ contentVisibility: 'auto' }}>
                {filteredHistory.map(item => (
                   <div key={item.id} className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 hover:border-primary/30 transition-all group">
                      <div className="flex justify-between items-center mb-2">
                         <span className={cn("text-[10px] font-bold uppercase", item.engine === 'analyst' ? "text-blue-400" : "text-purple-400")}>{item.engine}</span>
                         <span className="text-[10px] text-slate-600 font-mono">{new Date(item.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs text-slate-300 font-mono truncate mb-2">{item.prompt}</p>
                      <div className="flex justify-between items-center pt-2 border-t border-slate-800/50">
                         <button onClick={() => { setActiveEngine(item.engine); setGlobalInput(item.prompt); setHistoryOpen(false); }} className="text-[10px] font-bold text-primary flex items-center gap-1 hover:underline"><RefreshCw size={10}/> Reuse</button>
                         <div className="flex gap-2">
                            <button onClick={() => toggleFavorite(item.id)} className={cn("hover:scale-110 transition-transform", item.favorite ? "text-yellow-500" : "text-slate-600 hover:text-yellow-500")} aria-label={item.favorite ? "Unfavorite" : "Favorite"}><Star size={12} fill={item.favorite ? "currentColor" : "none"}/></button>
                            <button onClick={() => removeHistoryItem(item.id)} className="text-slate-600 hover:text-red-400" aria-label="Delete item"><Trash2 size={12}/></button>
                         </div>
                      </div>
                   </div>
                ))}
             </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

class EngineErrorBoundary extends Component<
  { children: ReactNode; engineName: string },
  { hasError: boolean; error?: Error }
> {
  public state: { hasError: boolean; error?: Error } = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="flex flex-col items-center justify-center h-full p-6 text-center bg-slate-900/50 rounded-xl border border-red-900/30">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
          <h3 className="text-lg font-bold text-white mb-2">{this.props.engineName} Malfunction</h3>
          <p className="text-sm text-slate-400 mb-4">{this.state.error?.message || "Critical system failure."}</p>
          <button onClick={() => this.setState({ hasError: false, error: undefined })} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm font-medium transition-colors">Reboot Engine</button>
        </div>
      );
    }
    return this.props.children;
  }
}

class GlobalErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  public state: { hasError: boolean } = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-center p-8">
        <div className="w-24 h-24 bg-red-900/20 rounded-full flex items-center justify-center mb-6"><XCircle size={48} className="text-red-500" /></div>
        <h1 className="text-2xl font-bold text-white mb-2">System Critical Error</h1>
        <p className="text-slate-400 mb-8 max-w-md">The APEX-9 neural core has encountered an unrecoverable exception.</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Force System Reboot</button>
      </div>
    );
    return this.props.children;
  }
}

const ShortcutsModal = () => {
  const { isShortcutsOpen, setShortcutsOpen } = useStore();
  if (!isShortcutsOpen) return null;
  const shortcuts = [{ key: 'Ctrl + 1-5', desc: 'Switch Engines' }, { key: 'Ctrl + K', desc: 'Compare Mode' }, { key: 'Ctrl + H', desc: 'Toggle History' }, { key: '/', desc: 'Open Shortcuts' }];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center" onClick={() => setShortcutsOpen(false)}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="bg-slate-950 border border-slate-800 rounded-xl p-6 w-[400px] shadow-2xl" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div className="flex justify-between items-center mb-6"><h2 id="shortcuts-title" className="text-lg font-bold flex items-center gap-2"><Keyboard className="text-primary"/> Keyboard Shortcuts</h2><button onClick={() => setShortcutsOpen(false)} aria-label="Close shortcuts"><X className="text-slate-500 hover:text-white" /></button></div>
        <div className="space-y-3">{shortcuts.map(s => <div key={s.key} className="flex justify-between items-center text-sm p-3 rounded-lg bg-slate-900/50 border border-slate-800/50"><span className="text-slate-300 font-medium">{s.desc}</span><code className="bg-slate-800 border border-slate-700 px-2 py-1 rounded text-xs font-mono text-primary shadow-sm">{s.key}</code></div>)}</div>
      </motion.div>
    </motion.div>
  );
};

const OnboardingModal = () => {
  const { isFirstVisit, completeOnboarding } = useStore();
  if (!isFirstVisit) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-4">
       <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-8 shadow-2xl text-center">
          <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-6"><Zap size={32} className="text-primary" /></div>
          <h2 className="text-2xl font-bold text-white mb-2">Welcome to APEX-9 NEXUS</h2>
          <p className="text-slate-400 mb-8">Your elite multimodal AI orchestration platform. Audit code, generate 4K visuals, render cinematic video, and execute complex strategies from a single command center.</p>
          <div className="grid grid-cols-2 gap-4 text-left mb-8">
             <div className="p-3 bg-slate-950 rounded border border-slate-800"><div className="font-bold text-blue-400 mb-1">5 Neural Engines</div><div className="text-xs text-slate-500">Analyst, Oracle, Strategist, Creator, Animator</div></div>
             <div className="p-3 bg-slate-950 rounded border border-slate-800"><div className="font-bold text-purple-400 mb-1">Context Chaining</div><div className="text-xs text-slate-500">Pipe outputs between engines seamlessly</div></div>
          </div>
          <button onClick={completeOnboarding} className="btn-primary w-full py-3 text-lg">Initialize System</button>
       </motion.div>
    </motion.div>
  );
};

// --- Engines ---
// Wrapped in React.memo for performance

const AnalystEngine = React.memo(() => {
  const [mode, setMode] = useState<'audit' | 'research' | 'viz' | 'comp'>('audit');
  const { globalInput, setGlobalInput, globalFile, setGlobalFile, addToHistory, addToast } = useStore();
  const apiKey = useStore(s => s.apiKey!);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const ai = getClient(apiKey);
      let sysInstruct = "You are APEX-9 Analyst.";
      if (mode === 'audit') sysInstruct += " Perform forensic audit. Identify flaws, risks, and improvements.";
      if (mode === 'research') sysInstruct += " Conduct deep synthesis. Provide citation-worthy facts.";
      if (mode === 'viz') sysInstruct += " Analyze data to suggest visualizations.";
      if (mode === 'comp') sysInstruct += " Perform competitive analysis.";

      const parts: any[] = [];
      if (globalInput) parts.push({ text: sanitizeInput(globalInput) });
      if (globalFile) parts.push({ inlineData: { mimeType: globalFile.mimeType, data: globalFile.base64 } });

      return await generateWithRetry(ai, MODELS.TEXT_COMPLEX, {
        contents: { parts },
        config: { systemInstruction: sysInstruct, responseMimeType: "application/json", responseSchema: SCHEMAS.ANALYST }
      });
    },
    onSuccess: (data) => {
      addToHistory({ engine: 'analyst', prompt: `[${mode.toUpperCase()}] ${globalInput.slice(0, 50)}`, response: data, media: globalFile ? [{ url: globalFile.preview, type: globalFile.mimeType.startsWith('video') ? 'video' : 'image' }] : [], modelUsed: MODELS.TEXT_COMPLEX });
      setGlobalInput(''); setGlobalFile(null); addToast("Analysis Complete", 'success');
    },
    onError: (err) => addToast(err.message, 'error')
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      const val = validateFile(f, f.type.startsWith('video') ? 'video' : 'image');
      if (!val.valid) { addToast(val.error || "Invalid file", 'error'); return; }
      const b64 = await fileToBase64(f);
      setGlobalFile({ base64: b64, mimeType: f.type, preview: URL.createObjectURL(f), fileObj: f });
      addToast("Media Attached", 'success');
    }
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="grid grid-cols-4 gap-1 bg-slate-900/50 p-1 rounded-lg" role="radiogroup" aria-label="Analysis Mode">
        {[{ id: 'audit', icon: FileText, label: 'Audit' }, { id: 'research', icon: Globe, label: 'Research' }, { id: 'viz', icon: BarChart3, label: 'Viz' }, { id: 'comp', icon: Layers, label: 'Comp' }].map(m => (
          <button key={m.id} onClick={() => setMode(m.id as any)} aria-checked={mode === m.id} role="radio" className={cn("flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase rounded transition-all focus-visible:ring-2 focus-visible:ring-primary", mode === m.id ? "bg-slate-800 text-primary shadow-sm" : "text-slate-500 hover:text-slate-300")}>
            <m.icon size={16} /> {m.label}
          </button>
        ))}
      </div>
      <textarea className="input-cyber w-full flex-1 resize-none min-h-[100px]" placeholder={`Enter context for ${mode} analysis...`} value={globalInput} onChange={e => setGlobalInput(e.target.value)} aria-label="Analysis Input" />
      <div onClick={() => fileInputRef.current?.click()} className={cn("border-2 border-dashed border-slate-800 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-colors group relative overflow-hidden h-24 focus-within:ring-2 focus-within:ring-primary", globalFile ? "bg-slate-900 border-primary/50" : "hover:bg-slate-900/50 hover:border-slate-600")} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}>
        <input ref={fileInputRef} multiple type="file" className="hidden" onChange={handleFile} accept="image/*,video/*,audio/*" />
        {globalFile ? <div className="flex items-center gap-2 text-primary z-10"><CheckCircle2 size={20} /><span className="text-xs font-mono truncate max-w-[200px]">{globalFile.fileObj.name}</span><button onClick={(e) => { e.stopPropagation(); setGlobalFile(null); }} className="p-1 hover:bg-slate-800 rounded-full" aria-label="Remove file"><X size={14}/></button></div> : <div className="text-center"><Upload className="mx-auto mb-1 text-slate-500 group-hover:text-primary" size={20} /><span className="text-[10px] font-bold text-slate-500 uppercase">Attach Evidence</span></div>}
      </div>
      <div className="flex justify-between items-center"><AdvancedSettingsPanel/><button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary w-1/2">{mutation.isPending ? <Loader2 className="animate-spin" /> : <Zap size={18} />} EXECUTE</button></div>
    </div>
  );
});

const OracleEngine = React.memo(() => {
  const [useSearch, setUseSearch] = useState(true);
  const { globalInput, setGlobalInput, addToHistory, addToast } = useStore();
  const apiKey = useStore(s => s.apiKey!);
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
    onError: (e) => addToast(e.message, 'error')
  });

  return (
    <div className="space-y-4 h-full flex flex-col justify-center">
      <div className="flex justify-end"><button onClick={() => setUseSearch(!useSearch)} className={cn("text-xs font-bold uppercase flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all focus-visible:ring-2 focus-visible:ring-primary", useSearch ? "bg-primary/10 border-primary text-primary" : "bg-slate-900 border-slate-700 text-slate-500")}><Globe size={12} /> Google Search {useSearch ? "ON" : "OFF"}</button></div>
      <input className="input-cyber w-full text-lg mb-4" placeholder="Ask the Oracle..." value={globalInput} onChange={e => setGlobalInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && mutation.mutate()} aria-label="Oracle Query" />
      <div className="flex justify-between items-center"><AdvancedSettingsPanel/><button onClick={() => mutation.mutate()} disabled={mutation.isPending || !globalInput} className="btn-primary w-1/2">{mutation.isPending ? <Loader2 className="animate-spin" /> : <Search size={18} />} CONSULT ORACLE</button></div>
    </div>
  );
});

const StrategistEngine = React.memo(() => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const { globalInput, setGlobalInput, addToHistory, addToast, history: globalHistory, incrementApiUsage } = useStore();
  const apiKey = useStore(s => s.apiKey!);
  const history = globalHistory.filter(h => h.engine === 'strategist').slice(0, 5).reverse();

  const handleSend = async () => {
    if (!globalInput) return;
    setIsStreaming(true); setStreamText(''); incrementApiUsage();
    abortControllerRef.current = new AbortController();
    try {
      const ai = getClient(apiKey);
      const context = history.map(h => `User: ${h.prompt}\nAI: ${typeof h.response === 'string' ? h.response : JSON.stringify(h.response)}`).join('\n');
      const stream = await ai.models.generateContentStream({ model: MODELS.TEXT_COMPLEX, contents: `${context}\nUser: ${sanitizeInput(globalInput)}`, config: { thinkingConfig: { thinkingBudget: 1024 } } });
      let final = '';
      for await (const chunk of stream) { if (abortControllerRef.current?.signal.aborted) break; final += chunk.text; setStreamText(final); }
      if (!abortControllerRef.current?.signal.aborted) { addToHistory({ engine: 'strategist', prompt: globalInput, response: final, modelUsed: MODELS.TEXT_COMPLEX }); setGlobalInput(''); setStreamText(''); addToast("Strategy Computed", 'success'); }
    } catch (e: any) { if (e.name !== 'AbortError') addToast("Strategy failed: " + e.message, 'error'); } finally { setIsStreaming(false); abortControllerRef.current = null; }
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="relative flex-1">
        <textarea className="input-cyber w-full h-full resize-none font-mono" placeholder="Initialize strategic planning sequence..." value={globalInput} onChange={e => setGlobalInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()} aria-label="Strategy Input" />
        {isStreaming && <div className="absolute inset-0 bg-slate-900/95 backdrop-blur border border-primary/30 p-4 overflow-y-auto"><div className="flex items-center justify-between mb-4 sticky top-0 bg-slate-900/90 pb-2 border-b border-slate-800"><div className="flex items-center gap-2 text-primary text-xs uppercase animate-pulse"><BrainCircuit size={14}/> Neural Processing...</div><button onClick={() => abortControllerRef.current?.abort()} className="text-red-400 hover:text-red-300" aria-label="Stop generation"><Square size={14} fill="currentColor"/></button></div><div className="markdown-body text-sm"><ReactMarkdown>{streamText}</ReactMarkdown></div></div>}
      </div>
      <div className="flex justify-between items-center"><AdvancedSettingsPanel/><button onClick={handleSend} disabled={isStreaming || !globalInput} className="btn-primary w-1/2">{isStreaming ? <Loader2 className="animate-spin" /> : <Send size={18} />} EXECUTE</button></div>
    </div>
  );
});

const CreatorEngine = React.memo(() => {
  const [ar, setAr] = useState('1:1');
  const [style, setStyle] = useState('Photorealistic');
  const { globalInput, setGlobalInput, addToHistory, addToast } = useStore();
  const apiKey = useStore(s => s.apiKey!);

  const mutation = useMutation({
    mutationFn: async () => {
      await ensurePaidKey();
      const ai = getClient(apiKey);
      const response = await ai.models.generateContent({
        model: MODELS.IMAGE_GEN,
        contents: { parts: [{ text: `${style} style. ${sanitizeInput(globalInput)}` }] },
        config: { imageConfig: { aspectRatio: ar, imageSize: "1K" } }
      });
      const media = response.candidates?.[0]?.content?.parts?.filter((p: any) => p.inlineData).map((p: any) => ({ url: `data:image/png;base64,${p.inlineData.data}`, type: 'image' })) || [];
      if (media.length === 0) throw new Error("Image generation failed.");
      return { text: globalInput, media };
    },
    onSuccess: (data) => { addToHistory({ engine: 'creator', prompt: data.text, response: "Image Generated", media: data.media as any, modelUsed: MODELS.IMAGE_GEN }); addToast("Image Generated", 'success'); },
    onError: (e) => addToast(e.message, 'error')
  });

  return (
     <div className="space-y-4 h-full flex flex-col">
        <textarea className="input-cyber w-full flex-1 resize-none" placeholder="Describe the visual asset..." value={globalInput} onChange={e => setGlobalInput(e.target.value)} aria-label="Image Prompt" />
        <div className="grid grid-cols-2 gap-3"><select className="input-cyber" value={style} onChange={e => setStyle(e.target.value)} aria-label="Style">{['Photorealistic', 'Cyberpunk', 'Minimalist', 'Watercolor'].map(s => <option key={s}>{s}</option>)}</select><select className="input-cyber" value={ar} onChange={e => setAr(e.target.value)} aria-label="Aspect Ratio">{['1:1', '16:9', '9:16'].map(r => <option key={r} value={r}>{r}</option>)}</select></div>
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !globalInput} className="btn-primary w-full">{mutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />} GENERATE</button>
     </div>
  );
});

const AnimatorEngine = React.memo(() => {
  const [ar, setAr] = useState('16:9');
  const [duration, setDuration] = useState('5');
  const { globalInput, setGlobalInput, addToHistory, addToast } = useStore();
  const apiKey = useStore(s => s.apiKey!);

  const mutation = useMutation({
    mutationFn: async () => {
      await ensurePaidKey();
      const ai = getClient(apiKey);
      let op = await ai.models.generateVideos({ model: MODELS.VIDEO_GEN, prompt: `Cinematic video, ${duration}s. ${sanitizeInput(globalInput)}`, config: { numberOfVideos: 1, aspectRatio: ar as any, resolution: '720p' } });
      while (!op.done) { await new Promise(r => setTimeout(r, 5000)); op = await ai.operations.getVideosOperation({ operation: op }); }
      const uri = op.response?.generatedVideos?.[0]?.video?.uri;
      if (!uri) throw new Error("Video generation failed.");
      return { text: globalInput, media: [{ url: `${uri}&key=${apiKey}`, type: 'video' }] };
    },
    onSuccess: (data) => { addToHistory({ engine: 'animator', prompt: data.text, response: "Video Rendered", media: data.media as any, modelUsed: MODELS.VIDEO_GEN }); addToast("Video Render Complete", 'success'); },
    onError: (e) => addToast(e.message, 'error')
  });

  return (
     <div className="space-y-4 h-full flex flex-col">
        <textarea className="input-cyber w-full flex-1 resize-none" placeholder="Describe motion and scene..." value={globalInput} onChange={e => setGlobalInput(e.target.value)} aria-label="Video Prompt" />
        <div className="grid grid-cols-2 gap-3"><select className="input-cyber" value={ar} onChange={e => setAr(e.target.value)} aria-label="Aspect Ratio">{['16:9', '9:16'].map(r => <option key={r} value={r}>{r}</option>)}</select><select className="input-cyber" value={duration} onChange={e => setDuration(e.target.value)} aria-label="Duration"><option value="5">5s (Std)</option><option value="8">8s (Long)</option></select></div>
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !globalInput} className="btn-primary w-full">{mutation.isPending ? <Loader2 className="animate-spin" /> : <Film size={18} />} RENDER VIDEO</button>
     </div>
  );
});

// --- Main App ---
const App = () => {
  const {
    activeEngine, setActiveEngine, history, compareMode, toggleCompareMode,
    compareSelection, toggleCompareSelection, removeHistoryItem, addToast,
    apiUsage, setShortcutsOpen, setHistoryOpen, setTemplatesOpen, setGlobalInput
  } = useStore();

  const queryClient = new QueryClient();

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        if (['1','2','3','4','5'].includes(e.key)) setActiveEngine(['analyst', 'oracle', 'strategist', 'creator', 'animator'][parseInt(e.key)-1] as EngineId);
        if (e.key === 'k') toggleCompareMode();
        if (e.key === 'h') setHistoryOpen(true);
      }
      if (e.key === '/') setShortcutsOpen(true);
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); addToast("Copied", 'success'); }
    catch { addToast("Copy failed", 'error'); }
  };

  const handleChain = (response: any, targetEngine: EngineId) => {
    const text = typeof response === 'string' ? response : JSON.stringify(response);
    setGlobalInput(`Based on the following output, continue: \n\n${text.slice(0, 1000)}...`);
    setActiveEngine(targetEngine);
    addToast(`Chained to ${targetEngine}`, 'info');
  };

  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <div className="flex h-full w-full bg-[#0f172a] text-slate-200 font-sans">
          <SkipLink />
          <ToastContainer />
          <ShortcutsModal />
          <TemplatesModal />
          <HistorySidebar />
          <OnboardingModal />

          <div className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col z-20 shadow-2xl flex-shrink-0" role="navigation" aria-label="Main Menu">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h1 className="font-bold text-lg tracking-tight text-white flex items-center gap-2"><div className="w-8 h-8 rounded bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">9</div>APEX-9 <span className="text-[10px] text-slate-500 ml-1">v5.0</span></h1>
              <button onClick={() => setShortcutsOpen(true)} className="text-slate-500 hover:text-primary" aria-label="Help & Shortcuts"><HelpCircle size={18}/></button>
            </div>
            <nav className="flex-1 py-6 space-y-1">
               {[{ id: 'analyst', icon: ShieldCheck, label: 'The Analyst' }, { id: 'oracle', icon: Library, label: 'The Oracle' }, { id: 'strategist', icon: BrainCircuit, label: 'The Strategist' }, { id: 'creator', icon: Sparkles, label: 'The Creator' }, { id: 'animator', icon: Film, label: 'The Animator' }].map(item => (
                  <button key={item.id} onClick={() => setActiveEngine(item.id as EngineId)} className={cn("w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all duration-200 border-l-2 group focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary", activeEngine === item.id ? "bg-slate-800/50 border-primary text-primary-glow" : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900")}>
                     <item.icon size={18} className={activeEngine === item.id ? "text-primary" : "group-hover:text-white"} /><span>{item.label}</span>
                  </button>
               ))}
            </nav>
            <div className="p-4 border-t border-slate-800 space-y-3">
               <div className="flex justify-between items-center text-xs font-mono text-slate-500 mb-2"><span>SESSION TOKENS</span><span className={cn(apiUsage > 50 ? "text-red-400" : "text-primary")}>{apiUsage} Reqs</span></div>
               <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden mb-2"><div className="h-full bg-primary transition-all duration-500" style={{ width: `${Math.min((apiUsage/60)*100, 100)}%` }} /></div>
               <button onClick={() => setHistoryOpen(true)} className="w-full py-2 rounded text-xs font-bold uppercase border border-slate-700 text-slate-500 hover:text-white flex justify-center gap-2 focus-visible:ring-2 focus-visible:ring-primary"><History size={14} /> Full History</button>
               <button onClick={toggleCompareMode} className={cn("w-full py-2 rounded text-xs font-bold uppercase border flex justify-center gap-2 transition-all focus-visible:ring-2 focus-visible:ring-primary", compareMode ? "bg-primary text-white border-primary" : "border-slate-700 text-slate-500 hover:border-primary/50 hover:text-primary")}><SplitSquareHorizontal size={14} /> Compare</button>
            </div>
          </div>

          <main id="main-content" className="flex-1 flex overflow-hidden relative">
             <div className="absolute inset-0 pointer-events-none overflow-hidden"><div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-blue-900/10 blur-[100px] rounded-full" /><div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] bg-cyan-900/10 blur-[100px] rounded-full" /></div>

             <div className="w-[420px] flex flex-col border-r border-slate-800 bg-slate-950/30 backdrop-blur-sm z-10 p-6 gap-6 overflow-y-auto">
                <div className="glass-panel p-5 rounded-xl border-slate-800 h-full relative shadow-lg">
                   <button onClick={() => setTemplatesOpen(true)} className="absolute top-4 right-4 text-xs font-bold uppercase flex items-center gap-1 text-slate-500 hover:text-white focus-visible:ring-2 focus-visible:ring-primary rounded"><LayoutTemplate size={12}/> Templates</button>
                   <EngineErrorBoundary engineName={activeEngine.toUpperCase()}>
                      {activeEngine === 'analyst' && <AnalystEngine />}
                      {activeEngine === 'oracle' && <OracleEngine />}
                      {activeEngine === 'strategist' && <StrategistEngine />}
                      {activeEngine === 'creator' && <CreatorEngine />}
                      {activeEngine === 'animator' && <AnimatorEngine />}
                   </EngineErrorBoundary>
                </div>
             </div>

             <div className="flex-1 bg-slate-900/50 p-6 overflow-y-auto relative custom-scrollbar" aria-label="Output Feed">
                {compareMode && <div className="sticky top-0 z-50 mb-4 bg-slate-900/90 border border-primary/30 p-3 rounded flex justify-between items-center shadow-lg backdrop-blur"><span className="text-xs font-bold text-primary">COMPARE MODE ({compareSelection.length}/2)</span>{compareSelection.length === 2 && <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded">READY</span>}</div>}
                <AnimatePresence mode='popLayout'>
                   {history.map(item => (
                      <motion.div layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} key={item.id} onClick={() => compareMode && toggleCompareSelection(item.id)} className={cn("mb-6 rounded-xl border bg-slate-950/80 overflow-hidden group relative transition-all", compareMode && compareSelection.includes(item.id) ? "border-primary ring-2 ring-primary/30" : "border-slate-800 hover:border-slate-700")}>
                         <div className="bg-slate-900/50 p-3 flex justify-between items-center border-b border-slate-800">
                            <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded text-slate-900", item.engine === 'analyst' ? "bg-blue-400" : item.engine === 'oracle' ? "bg-emerald-400" : "bg-purple-400")}>{item.engine}</span>
                            <span className="text-xs text-slate-500 font-mono truncate max-w-[200px]">{item.prompt}</span>
                            <div className="flex items-center gap-2">
                               <div className="relative group/chain">
                                  <button className="text-slate-500 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100" aria-label="Chain Output"><GitBranch size={14}/></button>
                                  <div className="absolute right-0 top-full mt-2 w-32 bg-slate-900 border border-slate-700 rounded shadow-xl hidden group-hover/chain:block z-50">
                                     <div className="p-2 text-[10px] font-bold uppercase text-slate-500">Chain To...</div>
                                     {['analyst','strategist','creator'].map(e => <button key={e} onClick={(ev) => { ev.stopPropagation(); handleChain(item.response, e as EngineId); }} className="w-full text-left px-2 py-1 text-xs hover:bg-slate-800 text-slate-300 capitalize">{e}</button>)}
                                  </div>
                               </div>
                               <button onClick={(e) => { e.stopPropagation(); copyToClipboard(typeof item.response === 'string' ? item.response : JSON.stringify(item.response)); }} className="text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100" aria-label="Copy output"><Copy size={14}/></button>
                               <button onClick={(e) => { e.stopPropagation(); removeHistoryItem(item.id); }} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100" aria-label="Delete item"><X size={14}/></button>
                            </div>
                         </div>
                         <div className="p-5 text-sm font-mono text-slate-300">
                            {item.media?.length > 0 && <div className="grid grid-cols-2 gap-2 mb-4">{item.media.map((m, i) => <div key={i} className="rounded-lg overflow-hidden border border-slate-800 bg-black/50 relative group/media">{m.type === 'video' ? <video src={m.url} controls className="w-full h-auto" /> : <img src={m.url} className="w-full h-auto object-contain" alt="Generated content" />}<a href={m.url} download className="absolute top-2 right-2 p-1 bg-black/50 rounded opacity-0 group-hover/media:opacity-100 transition-opacity text-white hover:bg-primary" aria-label="Download media"><Download size={14}/></a></div>)}</div>}
                            {typeof item.response === 'string' ? <div className="markdown-body"><ReactMarkdown>{item.response}</ReactMarkdown></div> : (
                               <div className="space-y-4">
                                  {'analysis' in item.response && <div className="markdown-body"><ReactMarkdown>{(item.response as any).analysis ? String((item.response as any).analysis) : ''}</ReactMarkdown></div>}
                                  {'answer' in item.response && <div className="markdown-body"><ReactMarkdown>{(item.response as any).answer ? String((item.response as any).answer) : ''}</ReactMarkdown></div>}
                               </div>
                            )}
                         </div>
                      </motion.div>
                   ))}
                   {history.length === 0 && <div className="h-full flex flex-col items-center justify-center opacity-30 select-none"><LayoutTemplate size={48} className="text-slate-500 mb-4" /><div className="text-sm font-mono text-slate-600">APEX-9 READY</div></div>}
                </AnimatePresence>
             </div>
          </main>
        </div>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
