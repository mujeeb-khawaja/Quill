import React, { useState, useRef } from 'react';
import {
  UploadCloud, FileText, Search, ShieldAlert, PenTool,
  CheckCircle, XCircle, Copy, Loader2, Check, History, LayoutDashboard, Clock, ExternalLink
} from 'lucide-react';

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
    setStatus('processing');
    setActiveStepIndex(0);
    setGatekeeperReason('');
    setProposal('');

    if (!selectedFile) return;
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const response = await fetch('http://localhost:8000/api/evaluate-rfp', { method: 'POST', body: formData });
      const data = await response.json();
      processResult(data.is_match, data.final_draft, data.gatekeeper_reasoning, selectedFile.name, data.rfp_text || "Original text not captured.");
    } catch (err) {
      setStatus('rejected');
      setGatekeeperReason("Connection Failed. Is the backend running?");
    }
  };

  const processResult = (is_match: boolean, draft: string | null, reasoning: string, title: string, originalText: string) => {
    if (is_match && draft) {
      setStatus('success');
      setProposal(draft);
      setActiveStepIndex(STEPS.length);
      addToHistory({ title, original_text: originalText, status: 'Drafted', is_match: true, reasoning, final_draft: draft });
    } else {
      setStatus('rejected');
      setGatekeeperReason(reasoning);
      setActiveStepIndex(2);
      addToHistory({ title, original_text: originalText, status: 'Rejected', is_match: false, reasoning, final_draft: null });
    }
  };

  const selectedHistory = history.find(h => h.id === selectedHistoryId);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">

      {/* --- TOP NAVIGATION --- */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 flex h-16 items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
              <ShieldAlert className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Quill</h1>
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-[400px]">
            <TabsList className="bg-muted/50 border border-border gap-1">
              <TabsTrigger value="dashboard" className="flex-1 gap-2 items-center">
                <LayoutDashboard className="h-4 w-4" /> Dashboard
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-1 gap-2 items-center">
                <History className="h-4 w-4" /> History
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="hidden md:flex items-center gap-2">
            <Badge variant="outline" className="text-muted-foreground border-border font-medium">v1.2.0-Alpha</Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-10">

        {/* --- VIEW 1: DASHBOARD --- */}
        {activeTab === 'dashboard' && (
          <div className="flex w-full items-start overflow-hidden">

            {/* SMOOTH CENTERING SPACER */}
            <div
              className="transition-[width] duration-700 ease-in-out flex-shrink-0 hidden lg:block"
              style={{ width: status === 'idle' ? 'calc(50% - 224px)' : '0px' }}
            />

            {/* INPUT SIDEBAR */}
            <div
              className={`transition-all duration-700 ease-in-out flex-shrink-0 space-y-6 z-10 w-full
                ${status === 'idle' ? 'max-w-md' : 'max-w-sm'}
              `}
            >
              <Card className="bg-card border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="text-xl">Upload RFP</CardTitle>
                  <CardDescription className="text-muted-foreground pt-1">Provide a PDF job description to begin.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div
                    onClick={triggerUpload}
                    className="group border-2 border-dashed border-border rounded-2xl p-12 flex flex-col items-center justify-center gap-4 hover:border-primary/50 hover:bg-muted/50 transition-all cursor-pointer relative"
                  >
                    <UploadCloud className="h-12 w-12 text-muted-foreground group-hover:text-primary transition-colors" />
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">
                        {selectedFile ? selectedFile.name : "Choose PDF File"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Maximum size: 50MB</p>
                    </div>
                    <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileChange} accept=".pdf,.txt" />
                  </div>

                  <div className="flex flex-col gap-3 pt-2">
                    <Button
                      onClick={() => runEvaluation()}
                      disabled={!selectedFile || status === 'processing'}
                      className="bg-primary text-primary-foreground font-bold h-12 shadow-sm"
                    >
                      {status === 'processing' ? <><Loader2 className="animate-spin h-5 w-5 mr-2" />Analyzing...</> : "Analyze RFP"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* MAIN STAGE (THE BRAIN) */}
            <div
              className={`transition-all duration-700 ease-in-out flex flex-col gap-8 flex-1
                ${status === 'idle'
                  ? 'max-w-0 opacity-0 ml-0 pointer-events-none'
                  : 'max-w-5xl opacity-100 lg:ml-8'
                }
              `}
            >
              <div className="flex items-center justify-between px-2">
                <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-muted-foreground">Internal Agent Logs</h2>
                <div className="flex gap-2">
                  {status === 'processing' && <Badge variant="outline" className="border-primary/50 text-primary animate-pulse">Running Pipeline</Badge>}
                  {status === 'success' && <Badge variant="outline" className="border-emerald-500/50 text-emerald-500">Processing Success</Badge>}
                  {status === 'rejected' && <Badge variant="outline" className="border-destructive/50 text-destructive">Process Halted</Badge>}
                </div>
              </div>

              <div className="space-y-12 animate-in fade-in slide-in-from-right-5 duration-500">

                {/* STEPPER */}
                <div className="relative border-l border-border ml-6 space-y-10 py-2">
                  {STEPS.map((step, index) => {
                    const Icon = step.icon;
                    const isPast = activeStepIndex > index || status === 'success' || (status === 'rejected' && activeStepIndex > index);
                    const isCurrent = activeStepIndex === index && status === 'processing';
                    const isFailed = status === 'rejected' && activeStepIndex === index;

                    return (
                      <div key={step.id} className="relative pl-10">
                        <span className={`absolute -left-[17px] p-2 rounded-full border bg-background transition-all duration-500 flex items-center justify-center
                          ${isPast ? 'border-emerald-500 text-emerald-500' :
                            isCurrent ? 'border-primary text-primary shadow-[0_0_15px_rgba(var(--primary),0.5)] scale-125' :
                              isFailed ? 'border-destructive text-destructive' : 'border-border text-muted-foreground opacity-50'}
                        `}>
                          {isCurrent ? <Loader2 className="h-4 w-4 animate-spin" /> : isPast ? <CheckCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                        </span>
                        <div className="flex flex-col">
                          <span className={`text-[10px] uppercase font-bold tracking-[0.2em] ${isCurrent ? 'text-primary' : isPast ? 'text-emerald-500' : isFailed ? 'text-destructive' : 'text-muted-foreground opacity-50'}`}>
                            Node: {step.label}
                          </span>
                          <span className={`text-sm mt-1 ${isCurrent ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                            {isCurrent ? 'Agent executing decision logic...' : isPast ? 'Task verified.' : isFailed ? 'Workflow Terminated.' : 'Pending activation...'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* RESULTS */}
                {status === 'rejected' && (
                  <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 py-8 px-8 rounded-2xl animate-in zoom-in-95">
                    <XCircle className="h-5 w-5" />
                    <AlertTitle className="font-bold mb-2">Gatekeeper Veto</AlertTitle>
                    <AlertDescription className="italic opacity-90">
                      "{gatekeeperReason}"
                    </AlertDescription>
                  </Alert>
                )}

                {status === 'success' && (
                  <Card className="bg-card border-border rounded-2xl overflow-hidden shadow-sm animate-in zoom-in-95 duration-500">
                    <div className="bg-muted/50 px-6 py-4 flex justify-between items-center border-b border-border">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Generated Response</span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleCopy(proposal)} className="h-8 gap-2 text-xs">
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? "Copied" : "Copy Draft"}
                      </Button>
                    </div>
                    <div className="p-8 text-sm leading-relaxed whitespace-pre-wrap text-card-foreground">
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
                <div className="space-y-3 px-2">
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
                  <CardHeader className="border-b border-border bg-muted/5 pb-8">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-2xl font-bold tracking-tight">{selectedHistory.title}</CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-2">
                          <Clock className="h-3 w-3" /> {selectedHistory.timestamp}
                        </CardDescription>
                      </div>
                      <Button variant="outline" size="sm" className="gap-2" onClick={() => setActiveTab('dashboard')}>
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
