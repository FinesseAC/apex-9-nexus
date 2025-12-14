
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  ShieldCheck, BrainCircuit, Sparkles,
  Send, Upload, Loader2, Trash2,
  X, Download,
  XCircle, Radio, Activity, Mic, MicOff, Video, VideoOff,
  ChevronLeft, ChevronRight, History as HistoryIcon 
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold, LiveServerMessage, Modality } from '@google/genai';

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants & Types ---
enum EngineId {
    ANALYST = 'analyst',
    ORACLE = 'oracle',
    STRATEGIST = 'strategist',
    CREATOR = 'creator',
    ANIMATOR = 'animator',
    LIVE = 'live_nexus'
}

interface MediaType {
    url: string; // Blob URL, Data URI, or IDB Reference (idb://key)
    type: 'image' | 'video' | 'audio';
    mimeType: string;
}

interface HistoryItem {
    id: string;
    engine: EngineId;
    prompt: string;
    response: string | any;
    media: MediaType[];
    timestamp: number;
    modelUsed: string;
    favorite?: boolean;
}

const MODELS = {
    TEXT_FAST: 'gemini-2.5-flash',
    TEXT_COMPLEX: 'gemini-3-pro-preview',
    IMAGE_GEN: 'gemini-3-pro-image-preview',
    VIDEO_GEN: 'veo-3.1-fast-generate-preview',
    AUDIO: 'gemini-2.5-flash-native-audio-preview-09-2025',
};

const SCHEMAS = {
    ANALYST: {
        type: Type.OBJECT,
        properties: {
            analysis: { type: Type.STRING },
            score: { type: Type.NUMBER },
            key_points: { type: Type.ARRAY, items: { type: Type.STRING } },
            confidence: { type: Type.NUMBER },
        },
        required: ["analysis", "score"]
    }
};

// --- Services / Gemini Helper Logic ---

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

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getGenerationConfig = (params: any) => {
    return {
        temperature: params.temperature ?? 0.7,
        topP: params.topP ?? 0.95,
        topK: params.topK ?? 40,
        maxOutputTokens: params.maxOutputTokens ?? 8192,
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ]
    };
};

// Audio Utils for Live API
function base64ToFloat32Array(base64: string): Float32Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
    }
    return float32;
}

// --- Store (Zustand + IndexedDB) ---

interface AppState {
    activeEngine: EngineId;
    setActiveEngine: (id: EngineId) => void;
    
    // API
    apiKey: string | undefined;
    
    // History
    history: HistoryItem[];
    addToHistory: (item: Omit<HistoryItem, 'id' | 'timestamp'>) => Promise<void>;
    clearHistory: () => void;
    removeHistoryItem: (id: string) => void;
    
    // UI
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
    
    // Settings
    temperature: number;
    setTemperature: (t: number) => void;
}

const useStore = create<AppState>()(
    persist(
        (set,) => ({
            activeEngine: EngineId.ANALYST,
            setActiveEngine: (id) => set({ activeEngine: id }),
            
            apiKey: import.meta.env.VITE_API_KEY || '',
            
            history: [],
            addToHistory: async (item) => {
                const id = crypto.randomUUID();
                // Store heavy media in IDB, keep metadata in State to avoid LocalStorage quota limits
                const mediaWithRefs = await Promise.all(item.media.map(async (m) => {
                    if (m.url.startsWith('data:')) {
                        // const blobKey = `media_${id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        try {
//                             await idbSet(blobKey, m.url);
//                             return { ...m, url: `idb://${blobKey}` }; 
                        } catch (e) {
                            console.error("IDB Write Failed", e);
                            return m; // Fallback to storing in state if IDB fails (risk of quota)
                        }
                    }
                    return m;
                }));

                set((state) => ({
                    history: [{ 
                        ...item, 
                        id, 
                        timestamp: Date.now(),
                        media: mediaWithRefs 
                    }, ...state.history]
                }));
            },
            clearHistory: async () => {
                set({ history: [] });
                //Ideally clear IDB keys here too, simplified for now
            },
            removeHistoryItem: (id) => set((state) => ({ 
                history: state.history.filter(i => i.id !== id) 
            })),
            
            isSidebarOpen: true,
            toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
            
            temperature: 0.7,
            setTemperature: (t) => set({ temperature: t })
        }),
        {
            name: 'apex9-v4-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ 
                history: state.history,
                temperature: state.temperature,
                isSidebarOpen: state.isSidebarOpen
            }) 
        }
    )
);

// Helper to hydrate IDB images
const hydrateMedia = async (url: string): Promise<string> => {
    if (url.startsWith('idb://')) {
//         const key = url.replace('idb://', '');
        try {
//             const data = await get(key);
//             return data || '';
        } catch (e) {
            console.error("IDB Read Failed", e);
            return '';
        }
    }
    return url;
};

// --- Components ---

// 1. Reusable Input Component
const CyberInput = ({ value, onChange, placeholder, onSend, disabled }: any) => (
    <div className="relative group flex-1 flex flex-col min-h-0">
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full flex-1 bg-[#0f172a] border border-[#1e293b] rounded-xl p-4 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none custom-scrollbar transition-all font-mono"
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                }
            }}
        />
        <div className="absolute bottom-3 right-3 flex gap-2">
             <button 
                onClick={onSend}
                disabled={disabled || !value.trim()}
                className="bg-primary hover:bg-primary-glow text-white p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-primary/20"
            >
                {disabled ? <Loader2 className="animate-spin w-4 h-4" /> : <Send className="w-4 h-4" />}
            </button>
        </div>
    </div>
);

// 2. Analyst Engine
const AnalystEngine = () => {
    const [input, setInput] = useState('');
    const [file, setFile] = useState<{data: string, mime: string} | null>(null);
    const { apiKey, addToHistory, temperature } = useStore();

    const mutation = useMutation({
        mutationFn: async () => {
            if (!apiKey) throw new Error("API Key Missing");
            const ai = getClient(apiKey);
            const parts: any[] = [{ text: input }];
            if (file) parts.push({ inlineData: { mimeType: file.mime, data: file.data } });

            const result = await ai.models.generateContent({
                model: MODELS.TEXT_COMPLEX,
                contents: { parts },
                config: {
                    ...getGenerationConfig({ temperature }),
                    systemInstruction: "You are APEX-9 Analyst. Perform rigorous technical analysis. If code is requested, provide it in markdown blocks. If analysis is requested, be structured and forensic.",
                    responseMimeType: "application/json",
                    responseSchema: SCHEMAS.ANALYST
                }
            });
            return JSON.parse(result.text!);
        },
        onSuccess: (data) => {
            addToHistory({
                engine: EngineId.ANALYST,
                prompt: input,
                response: data,
                media: file ? [{ url: `data:${file.mime};base64,${file.data}`, type: 'image', mimeType: file.mime }] : [],
                modelUsed: MODELS.TEXT_COMPLEX
            });
            setInput('');
            setFile(null);
        }
    });

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const f = e.target.files[0];
            const b64 = await fileToBase64(f);
            setFile({ data: b64, mime: f.type });
        }
    };

    return (
        <div className="flex flex-col h-full gap-4">
            <div className="flex-shrink-0">
                {file && (
                    <div className="relative inline-block mb-2 group animate-in fade-in zoom-in duration-200">
                        {file.mime.startsWith('image') ? (
                            <img src={`data:${file.mime};base64,${file.data}`} className="h-24 rounded-lg border border-primary/50 object-cover" />
                        ) : (
                            <div className="h-24 w-24 bg-slate-800 rounded-lg flex items-center justify-center border border-primary/50 text-xs font-mono">FILE</div>
                        )}
                        <button onClick={() => setFile(null)} className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity"><X size={12}/></button>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
                <label className="cursor-pointer hover:text-primary transition-colors flex items-center gap-1 bg-slate-900 px-3 py-1.5 rounded-full border border-slate-700 hover:border-primary">
                    <input type="file" className="hidden" onChange={handleFile} accept="image/*,application/pdf" />
                    <Upload size={14} /> <span>Upload Context</span>
                </label>
                <div className="h-4 w-px bg-slate-800"></div>
                <span>Gemini 1.5 Pro</span>
            </div>
            <CyberInput 
                value={input} 
                onChange={setInput} 
                onSend={() => mutation.mutate()} 
                disabled={mutation.isPending}
                placeholder="Paste code snippet, attach architecture diagram, or request forensic audit..."
            />
        </div>
    );
};

// 3. Creator Engine
const CreatorEngine = () => {
    const [input, setInput] = useState('');
    const { apiKey, addToHistory } = useStore();

    const mutation = useMutation({
        mutationFn: async () => {
            await ensurePaidKey();
            const ai = getClient(apiKey!);
            const result = await ai.models.generateContent({
                model: MODELS.IMAGE_GEN,
                contents: { parts: [{ text: input }] },
//                 config: { imageConfig: { aspectRatio: "16:9", imageSize: "1K" } }
            });
            // Extract image parts
            const images = result.candidates?.[0]?.content?.parts?.filter(p => p.inlineData).map(p => ({
                url: `data:image/png;base64,${p.inlineData?.data}`,
                type: 'image' as const,
                mimeType: 'image/png'
            })) || [];
            
            if (images.length === 0) throw new Error("No image generated");
            return images;
        },
        onSuccess: (images) => {
            addToHistory({
                engine: EngineId.CREATOR,
                prompt: input,
                response: "Generated Visual Asset",
                media: images,
                modelUsed: MODELS.IMAGE_GEN
            });
            setInput('');
        }
    });

    return (
        <div className="flex flex-col h-full gap-4">
            <div className="p-4 bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-lg text-xs text-purple-200 shadow-inner">
                <div className="flex items-center gap-2 mb-1 font-bold"><Sparkles size={14} /> IMAGEN 3 PRO ENGINE</div>
                <p className="opacity-70">High-fidelity generation active. Optimized for photorealism and text rendering.</p>
            </div>
            <div className="flex-1"></div>
            <CyberInput 
                value={input} 
                onChange={setInput} 
                onSend={() => mutation.mutate()} 
                disabled={mutation.isPending}
                placeholder="Describe the visual asset. Use keywords: 'Cinematic', '8k', 'Octane Render', 'Cyberpunk'..."
            />
        </div>
    );
};

// 4. Live Nexus (Real-time Audio/Video)
const LiveNexus = () => {
    const { apiKey } = useStore();
    const [isActive, setIsActive] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOn, setIsVideoOn] = useState(true);
    
    // Refs
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const videoIntervalRef = useRef<number | null>(null);
    const sessionRef = useRef<Promise<any> | null>(null);

    const startSession = async () => {
         if (!apiKey) return;
         const ai = new GoogleGenAI({ apiKey });
         
         const stream = await navigator.mediaDevices.getUserMedia({ 
             audio: { channelCount: 1, sampleRate: 16000 }, 
             video: true 
         });
         
         if(videoRef.current) videoRef.current.srcObject = stream;

         const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
         let nextStartTime = 0;

         const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: () => {
                     // Setup Input Pipeline
                     const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                     const source = inputCtx.createMediaStreamSource(stream);
                     const processor = inputCtx.createScriptProcessor(4096, 1, 1);
                     processor.onaudioprocess = (e) => {
                         if (isMuted) return;
                         const data = e.inputBuffer.getChannelData(0);
                         
                         // Convert Float32 to 16-bit PCM (Little Endian)
                         const l = data.length;
                         const int16 = new Int16Array(l);
                         for (let i = 0; i < l; i++) {
                             const s = Math.max(-1, Math.min(1, data[i]));
                             int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                         }
                         
                         const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
                         sessionPromise.then(s => s.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: base64 }}));
                     }
                     source.connect(processor);
                     processor.connect(inputCtx.destination);
                     processorRef.current = processor;
                },
                onmessage: async (msg: LiveServerMessage) => {
                    const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                    if (audioData) {
                        const float32 = base64ToFloat32Array(audioData);
                        const buffer = audioCtx.createBuffer(1, float32.length, 24000);
                        buffer.getChannelData(0).set(float32);
                        
                        const source = audioCtx.createBufferSource();
                        source.buffer = buffer;
                        source.connect(audioCtx.destination);
                        
                        const now = audioCtx.currentTime;
                        nextStartTime = Math.max(now, nextStartTime);
                        source.start(nextStartTime);
                        nextStartTime += buffer.duration;
                    }
                },
                onclose: () => setIsActive(false),
                onerror: (e) => {
                    console.error(e);
                    setIsActive(false);
                }
            },
            config: { 
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            }
         });
         
         setIsActive(true);
         sessionRef.current = sessionPromise;
         
         // Start Video Loop if active
         if (isVideoOn) {
            videoIntervalRef.current = window.setInterval(() => {
                if (!videoRef.current || !canvasRef.current) return;
                const ctx = canvasRef.current.getContext('2d');
                if (!ctx) return;
                
                canvasRef.current.width = videoRef.current.videoWidth || 320;
                canvasRef.current.height = videoRef.current.videoHeight || 240;
                
                ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
                const base64 = canvasRef.current.toDataURL('image/jpeg', 0.5).split(',')[1];
                
                sessionPromise.then(s => s.sendRealtimeInput({
                    media: { mimeType: 'image/jpeg', data: base64 }
                }));
            }, 1000); // 1 FPS analysis
         }
    };

    const stopSession = () => {
        setIsActive(false);
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (videoRef.current && videoRef.current.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        }
        if (videoIntervalRef.current) {
            clearInterval(videoIntervalRef.current);
            videoIntervalRef.current = null;
        }
        // Force reload to clear socket state cleanly
        window.location.reload(); 
    };

    return (
        <div className="h-full flex flex-col items-center justify-center bg-black/40 rounded-xl relative overflow-hidden border border-slate-800 shadow-2xl">
            {/* Visualizer / Video */}
            <div className="absolute inset-0 z-0 bg-black">
                <video ref={videoRef} muted autoPlay playsInline className={`w-full h-full object-cover opacity-60 ${isVideoOn ? 'block' : 'hidden'}`} />
                <canvas ref={canvasRef} width={320} height={240} className="hidden" />
                {!isVideoOn && <div className="w-full h-full flex items-center justify-center"><Activity className="w-32 h-32 text-primary/20 animate-pulse" /></div>}
                {/* Overlay Grid */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.05)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>
            </div>

            {/* HUD */}
            <div className="z-10 bg-slate-950/80 backdrop-blur-md border border-slate-700/50 p-8 rounded-3xl flex flex-col items-center gap-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] transform transition-all">
                <div className="flex items-center gap-3 mb-2">
                    <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-red-500 animate-pulse shadow-[0_0_10px_#ef4444]' : 'bg-slate-500'}`} />
                    <span className="font-mono text-sm tracking-widest uppercase text-slate-300">{isActive ? 'LIVE NEXUS ACTIVE' : 'SYSTEM STANDBY'}</span>
                </div>
                
                <div className="flex gap-6 items-center">
                    {!isActive ? (
                        <button onClick={startSession} className="group relative">
                            <div className="absolute inset-0 bg-primary/30 rounded-full blur-xl group-hover:bg-primary/50 transition-all"></div>
                            <div className="bg-primary hover:bg-primary-glow text-white w-20 h-20 rounded-full flex items-center justify-center transition-all hover:scale-110 shadow-xl relative z-10 border border-white/10">
                                <Mic size={32} />
                            </div>
                        </button>
                    ) : (
                        <button onClick={stopSession} className="bg-red-500 hover:bg-red-600 text-white w-20 h-20 rounded-full flex items-center justify-center transition-all hover:scale-110 shadow-xl border border-white/10">
                            <XCircle size={32} />
                        </button>
                    )}
                </div>

                <div className="flex gap-4">
                    <button onClick={() => setIsMuted(!isMuted)} className={`p-4 rounded-full border transition-all ${isMuted ? 'bg-red-500/20 border-red-500 text-red-500' : 'bg-slate-800/50 border-slate-600 text-slate-300 hover:bg-slate-700'}`}>
                        {isMuted ? <MicOff size={20}/> : <Mic size={20}/>}
                    </button>
                    <button onClick={() => setIsVideoOn(!isVideoOn)} className={`p-4 rounded-full border transition-all ${!isVideoOn ? 'bg-red-500/20 border-red-500 text-red-500' : 'bg-slate-800/50 border-slate-600 text-slate-300 hover:bg-slate-700'}`}>
                        {isVideoOn ? <Video size={20}/> : <VideoOff size={20}/>}
                    </button>
                </div>
            </div>
        </div>
    );
};

// 5. Sidebar
const Sidebar = () => {
    const { activeEngine, setActiveEngine, isSidebarOpen, toggleSidebar, history, removeHistoryItem } = useStore();
    
    return (
        <motion.div 
            initial={false}
            animate={{ width: isSidebarOpen ? 280 : 70 }}
            className="bg-[#0f172a] border-r border-[#1e293b] flex flex-col relative z-20 flex-shrink-0 transition-all duration-300"
        >
            <div className="p-5 border-b border-[#1e293b] flex items-center justify-between overflow-hidden whitespace-nowrap h-16">
                {isSidebarOpen && <h1 className="font-bold text-lg bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent tracking-tight">APEX-9 v4.0</h1>}
                <button onClick={toggleSidebar} className="p-2 hover:bg-slate-800 rounded text-slate-400 transition-colors mx-auto md:mx-0">
                    {isSidebarOpen ? <ChevronLeft size={18}/> : <ChevronRight size={18}/>}
                </button>
            </div>

            <nav className="flex-1 p-3 space-y-2">
                {[
                    { id: EngineId.ANALYST, icon: ShieldCheck, label: "Analyst", color: "text-blue-400" },
                    { id: EngineId.CREATOR, icon: Sparkles, label: "Creator", color: "text-purple-400" },
                    { id: EngineId.LIVE, icon: Radio, label: "Live Nexus", color: "text-red-400" },
                ].map(item => (
                    <button
                        key={item.id}
                        onClick={() => setActiveEngine(item.id)}
                        className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-lg transition-all group relative overflow-hidden",
                            activeEngine === item.id 
                                ? "bg-slate-800 text-white shadow-lg border border-slate-700" 
                                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                        )}
                        title={item.label}
                    >
                        <item.icon size={20} className={cn(activeEngine === item.id ? item.color : "group-hover:text-white transition-colors")} />
                        {isSidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
                        {item.id === EngineId.LIVE && isSidebarOpen && <span className="ml-auto flex h-2 w-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]"></span>}
                    </button>
                ))}
            </nav>

            {isSidebarOpen && (
                <div className="p-4 border-t border-[#1e293b] h-1/3 flex flex-col bg-[#0b1120]">
                    <div className="flex items-center mb-3 text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                        <HistoryIcon size={12} className="mr-2" />
                        <span>Session History</span>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                        {history.map(h => (
                            <div key={h.id} className="group p-2.5 bg-slate-900/50 rounded border border-slate-800 hover:border-primary/30 transition-all text-xs relative">
                                <div className="flex justify-between items-start">
                                    <div className={cn("font-bold text-[10px] uppercase mb-1", h.engine === EngineId.ANALYST ? "text-blue-400" : h.engine === EngineId.CREATOR ? "text-purple-400" : "text-red-400")}>{h.engine}</div>
                                    <button onClick={(e) => { e.stopPropagation(); removeHistoryItem(h.id); }} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={12}/></button>
                                </div>
                                <div className="text-slate-400 truncate font-mono">{h.prompt || "No prompt"}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </motion.div>
    );
};

// 6. Main Feed
const MainFeed = () => {
    const { history } = useStore();
    const [hydratedImages, setHydratedImages] = useState<Record<string, string>>({});

    // Effect to lazy load IDB images
    useEffect(() => {
        history.forEach(item => {
            item.media.forEach(async (m) => {
                if (m.url.startsWith('idb://') && !hydratedImages[m.url]) {
                    const blob = await hydrateMedia(m.url);
                    setHydratedImages(prev => ({ ...prev, [m.url]: blob }));
                }
            });
        });
    }, [history]);

    return (
        <div className="flex-1 bg-[#020617] relative overflow-hidden flex flex-col">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-900/10 via-slate-900/0 to-slate-900/0 pointer-events-none" />
            
            <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar space-y-6 md:space-y-8">
                <AnimatePresence mode="popLayout">
                    {history.length === 0 && (
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50"
                        >
                            <div className="w-24 h-24 rounded-full border-2 border-dashed border-slate-800 flex items-center justify-center mb-6">
                                <BrainCircuit className="w-12 h-12 text-slate-700 animate-pulse" />
                            </div>
                            <p className="font-mono text-sm tracking-widest">AWAITING NEURAL INPUT</p>
                        </motion.div>
                    )}
                    {history.map((item) => (
                        <motion.div 
                            key={item.id}
                            initial={{ opacity: 0, y: 20, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                            className="bg-[#0f172a]/80 backdrop-blur border border-[#1e293b] rounded-xl p-5 md:p-6 shadow-xl max-w-4xl mx-auto"
                        >
                            <div className="flex justify-between items-start mb-4 border-b border-slate-800/50 pb-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={cn(
                                            "text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider font-bold",
                                            item.engine === EngineId.ANALYST ? "bg-blue-900/30 text-blue-400" :
                                            item.engine === EngineId.CREATOR ? "bg-purple-900/30 text-purple-400" :
                                            "bg-red-900/30 text-red-400"
                                        )}>{item.engine}</span>
                                        <span className="text-[10px] text-slate-600 font-mono border border-slate-800 px-1.5 rounded">{item.modelUsed}</span>
                                    </div>
                                    <h3 className="text-slate-200 mt-1 font-medium leading-relaxed">{item.prompt}</h3>
                                </div>
                                <span className="text-xs text-slate-600 font-mono whitespace-nowrap ml-4">{new Date(item.timestamp).toLocaleTimeString()}</span>
                            </div>

                            {/* Media Grid */}
                            {item.media.length > 0 && (
                                <div className="grid grid-cols-2 gap-4 mb-6">
                                    {item.media.map((m, idx) => (
                                        <div key={idx} className="relative group rounded-lg overflow-hidden border border-slate-800 bg-black/50 aspect-video flex items-center justify-center">
                                            <img 
                                                src={hydratedImages[m.url] || m.url} 
                                                className="w-full h-full object-contain" 
                                                loading="lazy" 
                                            />
                                            <a 
                                                href={hydratedImages[m.url] || m.url} 
                                                download={`apex9_gen_${idx}.png`} 
                                                className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary backdrop-blur"
                                            >
                                                <Download size={14}/>
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="markdown-body text-slate-300 text-sm leading-relaxed">
                                <ReactMarkdown>
                                    {typeof item.response === 'string' 
                                        ? item.response 
                                        : (item.response.analysis || item.response.answer || JSON.stringify(item.response, null, 2))}
                                </ReactMarkdown>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
};

// 7. Root App
const App = () => {
    const { activeEngine } = useStore();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    if (!mounted) return null;

    return (
        <QueryClientProvider client={new QueryClient()}>
            <div className="flex h-screen w-screen bg-[#020617] text-white overflow-hidden font-sans selection:bg-primary/30 selection:text-white">
                <Sidebar />
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
                    
                    {/* Engine Input Panel */}
                    <div className="w-full md:w-[420px] bg-[#0f172a] border-r border-[#1e293b] p-6 flex flex-col z-10 shadow-2xl overflow-hidden relative">
                         {/* Background Decor */}
                         <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>

                        {activeEngine === EngineId.ANALYST && <AnalystEngine />}
                        {activeEngine === EngineId.CREATOR && <CreatorEngine />}
                        {activeEngine === EngineId.LIVE && <LiveNexus />}
                    </div>

                    {/* Output Feed */}
                    <MainFeed />
                </div>
            </div>
        </QueryClientProvider>
    );
};

export default App;

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
