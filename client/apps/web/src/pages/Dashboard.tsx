import React, { useState, useRef } from 'react';
import {
  UploadCloud, FileText, Search, ShieldAlert, PenTool,
  CheckCircle, XCircle, Copy, Loader2, Check, History, LayoutDashboard, Clock, ExternalLink,
  Sun, Moon, ChevronDown, ChevronUp
} from 'lucide-react';

import { useTheme } from "@/components/theme-provider";

// shadcn / workspace imports
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";

// --- TYPES ---
interface HistoryItem {
  id: string;
  timestamp: string;
  title: string;
  original_text: string;
  status: 'Drafted' | 'Rejected';
  is_match: boolean;
  reasoning: string;
  final_draft: string | null;
}

const STEPS = [
  { id: 'extractor', label: 'Extractor', icon: FileText },
  { id: 'researcher', label: 'Researcher', icon: Search },
  { id: 'gatekeeper', label: 'Gatekeeper', icon: ShieldAlert },
  { id: 'drafter', label: 'Drafter', icon: PenTool },
  { id: 'reviewer', label: 'Reviewer', icon: CheckCircle },
];

export default function Dashboard() {
  // --- STATE ---
  const [activeTab, setActiveTab] = useState('dashboard');
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'rejected'>('idle');
  const [activeStepIndex, setActiveStepIndex] = useState(-1);
  const [gatekeeperReason, setGatekeeperReason] = useState('');
  const [proposal, setProposal] = useState('');
  const [copied, setCopied] = useState(false);
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);
  const { theme, setTheme } = useTheme();

  // History State
  const [history, setHistory] = useState<HistoryItem[]>([
    {
      id: '1',
      timestamp: '2024-03-23 14:20',
      title: 'Senior AWS Architect - Fintech',
      original_text: 'Looking for an AWS expert with deep experience in Lambda and Qdrant...',
      status: 'Drafted',
      is_match: true,
      reasoning: 'Matches all core infrastructure requirements.',
      final_draft: 'Dear Hiring Manager, I am writing to express my interest in the Senior AWS Architect position using my experience in Python and AWS CDK...'
    },
    {
      id: '2',
      timestamp: '2024-03-23 15:45',
      title: 'SAP ABAP Specialist',
      original_text: 'Must have 10+ years in SAP ABAP and module development.',
      status: 'Rejected',
      is_match: false,
      reasoning: 'Match Failed: Lacks strictly required SAP ABAP experience.',
      final_draft: null
    }
  ]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // --- HANDLERS ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const triggerUpload = () => fileInputRef.current?.click();

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addToHistory = (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
    const newItem: HistoryItem = {
      ...item,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleString(),
    };
    setHistory(prev => [newItem, ...prev]);
  };

  const runEvaluation = async () => {
    if (!selectedFile) return;

    // Reset UI for fresh run
    setStatus('processing');
    setActiveStepIndex(0); // Show first step as active
    setGatekeeperReason('');
    setProposal('');

    // We'll track these to update history at the very end
    let finalIsMatch = false;
    let finalDraft = '';
    let finalReasoning = '';
    let extractedRfpText = '';

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch('http://localhost:8000/api/evaluate-rfp', {
        method: 'POST',
        body: formData,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // MAPPING: node_name -> activeStepIndex for the NEXT step
      const nodeToStepMap: Record<string, number> = {
        'extractor': 1,
        'researcher': 2,
        'evaluator': 3,
        'drafter': 4,
        'reviewer': 5
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep the last partial line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            console.log("Stream Event:", data);

            if (data.event === 'init') {
              extractedRfpText = data.rfp_text;
            }
            else if (data.event === 'node_update') {
              const { node, updates } = data;

              // --- EXTRACTOR: check classification result first ---
              if (node === 'extractor') {
                if (updates.is_valid_rfp === false) {
                  // Keep activeStepIndex at 0 so Extractor shows as the FAILED step
                  setActiveStepIndex(0);
                  const docType = updates.document_type || 'Unknown Document';
                  const reason = `Document Error: This appears to be a '${docType}', not a valid Job RFP or Freelance Gig description. Please upload a proper RFP or job posting for evaluation.`;
                  finalIsMatch = false;
                  finalReasoning = reason;
                  setStatus('rejected');
                  setGatekeeperReason(reason);
                } else {
                  // Valid RFP — advance to Researcher step
                  setActiveStepIndex(1);
                }
                // Don't fall through to the generic map below
              } else {
                // For all other nodes, advance the progress indicator normally
                if (nodeToStepMap[node] !== undefined) {
                  setActiveStepIndex(nodeToStepMap[node]);
                }

                // Specific Node handling
                if (node === 'evaluator') {
                  if (updates.is_match === false) {
                    finalIsMatch = false;
                    finalReasoning = updates.evaluator_reasoning;
                    setStatus('rejected');
                    setGatekeeperReason(updates.evaluator_reasoning);
                  } else {
                    finalIsMatch = true;
                    finalReasoning = updates.evaluator_reasoning;
                  }
                }

                if (node === 'drafter') {
                  setProposal(updates.current_draft);
                  finalDraft = updates.current_draft;
                }

                if (node === 'reviewer') {
                  if (updates.review_feedback === 'PASS') {
                    setStatus('success');
                  }
                }
              }
            }
            else if (data.event === 'done') {
              // Final check if we completed successfully
              // addToHistory after streaming is fully complete
              addToHistory({
                title: selectedFile.name,
                original_text: extractedRfpText,
                status: finalIsMatch && finalDraft ? 'Drafted' : 'Rejected',
                is_match: finalIsMatch,
                reasoning: finalReasoning,
                final_draft: finalDraft || null
              });
            }
          } catch (e) {
            console.error("Error parsing stream line:", e);
          }
        }
      }
    } catch (err) {
      console.error("Evaluation error:", err);
      setStatus('rejected');
      setGatekeeperReason("Connection Failed or streaming interrupted.");
    }
  };

  const selectedHistory = history.find(h => h.id === selectedHistoryId);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">

      {/* --- TOP NAVIGATION --- */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-6">
          {/* Main Row: Logo and Actions */}
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-1">
              <div className="h-8 w-8 md:h-10 md:w-10 flex items-center justify-center">
                <img
                  src={theme === 'dark' ? "/logo_cleaned.png" : "/light_theme_logo.png"}
                  alt="Quill Logo"
                  className="h-full w-full object-contain"
                />
              </div>
              <h1 className="text-lg md:text-xl font-bold tracking-tight">Quill</h1>
            </div>

            {/* Desktop Center Tabs */}
            <div className="hidden md:block">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-[300px] lg:w-[400px]">
                <TabsList className="bg-muted/50 border border-border gap-1">
                  <TabsTrigger value="dashboard" className="flex-1 gap-2 items-center">
                    <LayoutDashboard className="h-4 w-4" /> Dashboard
                  </TabsTrigger>
                  <TabsTrigger value="history" className="flex-1 gap-2 items-center">
                    <History className="h-4 w-4" /> History
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex items-center gap-2 md:gap-4">
              <Badge variant="outline" className="hidden sm:inline-flex text-[10px] md:text-xs text-muted-foreground border-border font-medium px-2 py-0">v1.2.0-Alpha</Badge>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="h-8 w-8 md:h-9 md:w-9 border border-border bg-muted/20"
              >
                <Sun className="h-4 w-4 md:h-[1.2rem] md:w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 md:h-[1.2rem] md:w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </div>
          </div>

          {/* Mobile Tab Row */}
          <div className="md:hidden pb-3">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-full bg-muted/50 border border-border grid grid-cols-2 h-10">
                <TabsTrigger value="dashboard" className="gap-2 items-center text-[10px] font-bold">
                  <LayoutDashboard className="h-3 w-3" /> Dashboard
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-2 items-center text-[10px] font-bold">
                  <History className="h-3 w-3" /> History
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-5 sm:px-6 py-10">

        {/* --- VIEW 1: DASHBOARD --- */}
        {activeTab === 'dashboard' && (
          <div className={`flex flex-col lg:flex-row w-full overflow-hidden transition-all duration-700 ${status === 'idle' ? 'lg:items-center min-h-[60vh]' : 'items-start'}`}>

            {/* SMOOTH CENTERING SPACER (Desktop only) */}
            <div
              className="transition-[width] duration-700 ease-in-out flex-shrink-0 hidden lg:block"
              style={{ width: status === 'idle' ? 'calc(50% - 224px)' : '0px' }}
            />

            {/* INPUT SIDEBAR */}
            <div
              className={`transition-all duration-700 ease-in-out flex-shrink-0 space-y-6 z-10 w-full mb-8 lg:mb-0
                ${status === 'idle' ? 'max-w-md mx-auto lg:mx-0' : 'max-w-full lg:max-w-sm'}
              `}
            >
              <Card className="bg-card border-border shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg md:text-xl">Upload RFP</CardTitle>
                  <CardDescription className="text-xs md:text-sm text-muted-foreground pt-1">Provide a PDF job description to begin.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div
                    onClick={triggerUpload}
                    className="group border-2 border-dashed border-border rounded-xl md:rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center gap-4 hover:border-primary/50 hover:bg-muted/50 transition-all cursor-pointer relative"
                  >
                    <UploadCloud className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground group-hover:text-primary transition-colors" />
                    <div className="text-center">
                      <p className="text-xs md:text-sm font-bold text-foreground">
                        {selectedFile ? selectedFile.name : "Choose PDF File"}
                      </p>
                      <p className="text-[10px] md:text-xs text-muted-foreground mt-1">Maximum size: 50MB</p>
                    </div>
                    <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileChange} accept=".pdf,.txt" />
                  </div>

                  <div className="flex flex-col gap-3 pt-2">
                    <Button
                      onClick={() => runEvaluation()}
                      disabled={!selectedFile || status === 'processing'}
                      className="bg-primary text-primary-foreground font-bold h-10 md:h-12 shadow-sm text-sm"
                    >
                      {status === 'processing' ? <><Loader2 className="animate-spin h-5 w-5 mr-2" />Analyzing...</> : "Analyze RFP"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* MAIN STAGE (THE BRAIN) */}
            <div
              className={`transition-all duration-700 ease-in-out flex flex-col gap-6 md:gap-8 flex-1 w-full
                ${status === 'idle'
                  ? 'max-h-0 lg:max-h-none lg:max-w-0 opacity-0 ml-0 pointer-events-none'
                  : 'max-h-[5000px] lg:max-h-none lg:max-w-5xl opacity-100 lg:ml-8 pb-10'
                }
              `}
            >
              <div className="flex items-center justify-between px-2 cursor-pointer lg:cursor-default" onClick={() => window.innerWidth < 1024 && setIsLogsExpanded(!isLogsExpanded)}>
                <div className="flex items-center gap-3">
                  <h2 className="text-[10px] md:text-sm font-bold tracking-[0.2em] uppercase text-muted-foreground">Internal Agent Logs</h2>
                  <div className="lg:hidden text-muted-foreground">
                    {isLogsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
                <div className="flex gap-2">
                  {status === 'processing' && <Badge variant="outline" className="text-[9px] md:text-[10px] border-primary/50 text-primary animate-pulse">Running</Badge>}
                  {status === 'success' && <Badge variant="outline" className="text-[9px] md:text-[10px] border-emerald-500/50 text-emerald-500">Success</Badge>}
                  {status === 'rejected' && <Badge variant="outline" className="text-[9px] md:text-[10px] border-destructive/50 text-destructive">Halted</Badge>}
                </div>
              </div>

              <div className={`space-y-8 md:space-y-12 animate-in fade-in slide-in-from-right-5 duration-500 transition-all ${!isLogsExpanded && 'hidden lg:block'}`}>

                {/* STEPPER */}
                <div className="relative border-l border-border ml-4 md:ml-6 space-y-8 md:space-y-10 py-2">
                  {STEPS.map((step, index) => {
                    const Icon = step.icon;
                    const isPast = activeStepIndex > index || status === 'success' || (status === 'rejected' && activeStepIndex > index);
                    const isCurrent = activeStepIndex === index && status === 'processing';
                    const isFailed = status === 'rejected' && activeStepIndex === index;

                    return (
                      <div key={step.id} className="relative pl-8 md:pl-10">
                        <span className={`absolute -left-[17px] p-1.5 md:p-2 rounded-full border bg-background transition-all duration-500 flex items-center justify-center
                          ${isPast ? 'border-emerald-500 text-emerald-500' :
                            isCurrent ? 'border-primary text-primary shadow-[0_0_15px_rgba(var(--primary),0.5)] scale-110 md:scale-125' :
                              isFailed ? 'border-destructive text-destructive' : 'border-border text-muted-foreground opacity-50'}
                        `}>
                          {isCurrent ? <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" /> : isPast ? <CheckCircle className="h-3 w-3 md:h-4 md:w-4" /> : <Icon className="h-3 w-3 md:h-4 md:w-4" />}
                        </span>
                        <div className="flex flex-col">
                          <span className={`text-[9px] md:text-[10px] uppercase font-bold tracking-[0.2em] ${isCurrent ? 'text-primary' : isPast ? 'text-emerald-500' : isFailed ? 'text-destructive' : 'text-muted-foreground opacity-50'}`}>
                            Node: {step.label}
                          </span>
                          <span className={`text-[12px] md:text-sm mt-0.5 md:mt-1 ${isCurrent ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                            {isCurrent ? 'Agent executing decision logic...' : isPast ? 'Task verified.' : isFailed ? 'Workflow Terminated.' : 'Pending activation...'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* RESULTS */}
                {status === 'rejected' && (
                  <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 py-4 md:py-8 px-4 md:px-8 rounded-xl md:rounded-2xl animate-in zoom-in-95">
                    <XCircle className="h-4 w-4 md:h-5 md:w-5" />
                    <AlertTitle className="text-xs md:text-sm font-bold mb-2 uppercase tracking-widest">Gatekeeper Veto</AlertTitle>
                    <AlertDescription className="text-[11px] md:text-sm italic opacity-90 leading-relaxed">
                      "{gatekeeperReason}"
                    </AlertDescription>
                  </Alert>
                )}

                {status === 'success' && (
                  <Card className="bg-card border-border rounded-xl md:rounded-2xl overflow-hidden shadow-sm animate-in zoom-in-95 duration-500">
                    <div className="bg-muted/50 px-4 md:px-6 py-3 md:py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-border">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Generated Response</span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleCopy(proposal)} className="h-8 gap-2 text-xs w-full md:w-auto justify-start md:justify-center">
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? "Copied" : "Copy Draft"}
                      </Button>
                    </div>
                    <div className="p-4 md:p-8 text-[11px] md:text-sm leading-relaxed whitespace-pre-wrap text-card-foreground">
                      {proposal}
                    </div>
                  </Card>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- VIEW 2: HISTORY --- */}
        {activeTab === 'history' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 min-h-[600px]">

            {/* LIST */}
            <div className="lg:col-span-4 lg:border-r border-border lg:pr-6 space-y-4">
              <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-muted-foreground px-2">Session Log</h3>
              <ScrollArea className="h-[700px] w-full">
                <div className="space-y-3 px-0 sm:px-2">
                  {history.map(item => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedHistoryId(item.id)}
                      className={`group p-4 rounded-xl border transition-all cursor-pointer hover:bg-muted/50
                          ${selectedHistoryId === item.id ? 'bg-muted border-primary/50' : 'bg-card border-border'}
                          ${item.status === 'Drafted' ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-destructive'}
                        `}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {item.timestamp}
                        </span>
                        <Badge variant="outline" className={`${item.status === 'Drafted' ? 'text-emerald-500 border-emerald-500/20' : 'text-destructive border-destructive/20'} text-[9px]`}>
                          {item.status}
                        </Badge>
                      </div>
                      <h4 className="font-bold text-sm truncate">{item.title}</h4>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* DETAIL */}
            <div className="lg:col-span-8">
              {selectedHistory ? (
                <Card className="bg-card border-border shadow-sm overflow-hidden h-fit">
                  <CardHeader className="border-b border-border bg-muted/5 p-4 md:p-8">
                    <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                      <div>
                        <CardTitle className="text-xl md:text-2xl font-bold tracking-tight">{selectedHistory.title}</CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-2 text-[10px] md:text-xs">
                          <Clock className="h-3 w-3" /> {selectedHistory.timestamp}
                        </CardDescription>
                      </div>
                      <Button variant="outline" size="sm" className="gap-2 w-full md:w-auto h-8 md:h-9 text-[10px] md:text-xs" onClick={() => setActiveTab('dashboard')}>
                        Repeat Evaluation <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardHeader>

                  <Tabs defaultValue="output" className="w-full">
                    <TabsList className="w-full justify-start rounded-none bg-transparent border-b border-border p-1 gap-2">
                      <TabsTrigger value="output" className="flex-1">AI Verdict</TabsTrigger>
                      <TabsTrigger value="input" className="flex-1">Source RFP</TabsTrigger>
                    </TabsList>

                    <TabsContent value="output" className="p-8">
                      {selectedHistory.is_match ? (
                        <div className="space-y-6">
                          <div className="p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                            <p className="text-xs uppercase font-bold text-emerald-500 tracking-widest mb-2">Gatekeeper Summary</p>
                            <p className="text-sm italic opacity-90">{selectedHistory.reasoning}</p>
                          </div>
                          <Separator />
                          <div className="flex justify-between items-center">
                            <h5 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Proposal Draft</h5>
                            <Button variant="secondary" size="sm" onClick={() => handleCopy(selectedHistory.final_draft || '')}>
                              Copy Text
                            </Button>
                          </div>
                          <div className="text-sm leading-relaxed whitespace-pre-wrap p-2">{selectedHistory.final_draft}</div>
                        </div>
                      ) : (
                        <div className="p-10 text-center animate-in zoom-in-95">
                          <XCircle className="h-16 w-16 text-destructive/30 mx-auto mb-4" />
                          <h4 className="text-lg font-bold">Proposal Rejected</h4>
                          <p className="text-sm text-muted-foreground mt-2 italic px-8">"{selectedHistory.reasoning}"</p>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="input" className="p-8">
                      <div className="p-8 rounded-xl bg-muted/30 border border-border text-xs leading-relaxed font-mono whitespace-pre-wrap text-muted-foreground min-h-[300px]">
                        {selectedHistory.original_text}
                      </div>
                    </TabsContent>
                  </Tabs>
                </Card>
              ) : (
                <div className="h-[500px] border border-dashed border-border rounded-3xl flex flex-col items-center justify-center text-muted-foreground opacity-30">
                  <History className="h-16 w-16 mb-4" />
                  <p className="text-xs font-bold uppercase tracking-[0.3em]">Select a log entry</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
