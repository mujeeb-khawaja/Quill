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
  const [currentRfpText, setCurrentRfpText] = useState('');
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
      final_draft: 'Dear Hiring Manager, I am writing to express my interest in the Senior AWS Architect position...'
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

  const runEvaluation = async (mode: 'real' | 'mock-success' | 'mock-fail') => {
    setStatus('processing');
    setActiveStepIndex(0);
    setGatekeeperReason('');
    setProposal('');

    if (mode === 'real') {
       if (!selectedFile) return;
       try {
          const formData = new FormData();
          formData.append('file', selectedFile);
          const response = await fetch('http://localhost:8000/api/evaluate-rfp', { method: 'POST', body: formData });
          const data = await response.json();
          processResult(data.is_match, data.final_draft, data.gatekeeper_reasoning, selectedFile.name, "Actual RFP Body Content Placeholder");
       } catch (err) {
          setStatus('rejected');
          setGatekeeperReason("Connection Failed. Is the backend running?");
       }
    } else {
       // Mock Visual Loop
       const isSuccess = mode === 'mock-success';
       const runStep = (index: number) => {
         if (index >= STEPS.length) {
            processResult(true, "Mock proposal generated for your testing...", "Matches requirements perfectly.", "Mock Job Title", "Original Job Description Text Content...");
            return;
         }
         setActiveStepIndex(index);
         if (!isSuccess && STEPS[index].id === 'gatekeeper') {
            setTimeout(() => {
               processResult(false, null, "Match Failed: Lacks specialized experience in the required domain.", "Mock Job Title (Rejected)", "Original Mock Text...");
            }, 2000);
            return;
         }
         setTimeout(() => runStep(index + 1), 2000);
       };
       runStep(0);
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
    <div className="dark min-h-screen bg-background text-foreground font-sans selection:bg-blue-500/30">
      
      {/* --- TOP NAVIGATION --- */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 flex h-16 items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <ShieldAlert className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight italic">AutoBid <span className="text-blue-500">AI</span></h1>
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-[400px]">
            <TabsList className="bg-muted/50 border border-border">
              <TabsTrigger value="dashboard" className="flex gap-2 items-center data-[state=active]:bg-background">
                <LayoutDashboard className="h-4 w-4" /> Dashboard
              </TabsTrigger>
              <TabsTrigger value="history" className="flex gap-2 items-center data-[state=active]:bg-background">
                <History className="h-4 w-4" /> History
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/5">Cloud Native</Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-10">
        
        {/* --- VIEW 1: DASHBOARD --- */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            
            {/* INPUT SIDEBAR */}
            <div className="lg:col-span-4 space-y-6">
              <Card className="bg-card border-border shadow-2xl">
                <CardHeader>
                  <CardTitle className="text-xl">Evaluation Center</CardTitle>
                  <CardDescription className="text-muted-foreground pt-1">Upload a PDF to trigger the Agentic Pipeline.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div 
                    onClick={triggerUpload}
                    className="group border-2 border-dashed border-border rounded-2xl p-12 flex flex-col items-center justify-center gap-4 hover:border-blue-500/50 hover:bg-muted/50 transition-all cursor-pointer relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <UploadCloud className="h-12 w-12 text-muted-foreground group-hover:text-blue-500 transition-colors" />
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">
                        {selectedFile ? selectedFile.name : "Select RFP Document"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">.pdf or .txt (Max 50MB)</p>
                    </div>
                    <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileChange} accept=".pdf,.txt" />
                  </div>

                  <div className="flex flex-col gap-3 pt-2">
                    <Button 
                      onClick={() => runEvaluation('real')} 
                      disabled={!selectedFile || status === 'processing'}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-12 shadow-[0_0_20px_rgba(37,99,235,0.3)]"
                    >
                      {status === 'processing' ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : "🚀 Run Agentic Workflow"}
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" onClick={() => runEvaluation('mock-success')} className="text-xs h-10 border border-border">Mock Pass</Button>
                      <Button variant="secondary" onClick={() => runEvaluation('mock-fail')} className="text-xs h-10 border border-border text-red-500">Mock Fail</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* MAIN STAGE (THE BRAIN) */}
            <div className="lg:col-span-8 flex flex-col gap-8">
              
              <div className="flex items-center justify-between px-2">
                <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-muted-foreground">Internal Reasoning Engine</h2>
                <div className="flex gap-2">
                  {status === 'processing' && <Badge variant="outline" className="border-blue-500/50 text-blue-500 animate-pulse">Thinking...</Badge>}
                  {status === 'success' && <Badge variant="outline" className="border-emerald-500/50 text-emerald-500">Completed</Badge>}
                  {status === 'rejected' && <Badge variant="outline" className="border-red-500/50 text-red-500">Terminated</Badge>}
                </div>
              </div>

              {status === 'idle' ? (
                <div className="flex-grow border border-dashed border-border rounded-3xl flex flex-col items-center justify-center text-center p-20">
                  <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-6">
                    <LayoutDashboard className="h-8 w-8 text-muted-foreground opacity-50" />
                  </div>
                  <h3 className="text-lg font-bold">Awaiting Workflow</h3>
                  <p className="text-sm text-muted-foreground mt-2 max-w-xs">Upload an RFP to start the multi-agent analysis and drafting pipeline.</p>
                </div>
              ) : (
                <div className="space-y-12 animate-in fade-in slide-in-from-bottom-5 duration-700">
                  
                  {/* STEPPER */}
                  <div className="relative border-l border-border ml-6 space-y-12 py-2">
                    {STEPS.map((step, index) => {
                      const Icon = step.icon;
                      const isPast = activeStepIndex > index || status === 'success' || (status === 'rejected' && activeStepIndex > index);
                      const isCurrent = activeStepIndex === index && status === 'processing';
                      const isFailed = status === 'rejected' && activeStepIndex === index;

                      return (
                        <div key={step.id} className="relative pl-10">
                          <span className={`absolute -left-[17px] p-2 rounded-full border bg-background transition-all duration-500 flex items-center justify-center
                            ${isPast ? 'border-emerald-500 text-emerald-500' : 
                              isCurrent ? 'border-blue-500 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-125' : 
                              isFailed ? 'border-red-500 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'border-border text-muted-foreground opacity-50'}
                          `}>
                            {isCurrent ? <Loader2 className="h-4 w-4 animate-spin" /> : isPast ? <CheckCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                          </span>
                          <div className="flex flex-col gap-1">
                            <span className={`text-[10px] uppercase font-bold tracking-[0.2em] ${isCurrent ? 'text-blue-500' : isPast ? 'text-emerald-500' : isFailed ? 'text-red-500' : 'text-muted-foreground opacity-50'}`}>
                              Agent: {step.label}
                            </span>
                            <span className={`text-sm ${isCurrent ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                              {isCurrent ? 'Analyzing requirements and generating context tokens...' : isPast ? 'Validation completed successfully.' : isFailed ? 'Workflow halted by Gatekeeper.' : 'Waiting to start...'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* RESULTS */}
                  {status === 'rejected' && (
                    <Alert variant="destructive" className="bg-red-500/5 border-red-500/20 py-6 px-6 rounded-2xl animate-in zoom-in-95 duration-500">
                      <XCircle className="h-5 w-5" />
                      <AlertTitle className="text-red-500 font-bold mb-2">Rejection Verdict</AlertTitle>
                      <AlertDescription className="text-red-200/80 leading-relaxed italic">
                        "{gatekeeperReason}"
                      </AlertDescription>
                    </Alert>
                  )}

                  {status === 'success' && (
                    <Card className="bg-muted/30 border-border rounded-2xl overflow-hidden animate-in zoom-in-95 duration-700 shadow-2xl">
                      <div className="bg-muted px-6 py-4 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <PenTool className="h-4 w-4 text-emerald-500" />
                          <span className="text-[10px] font-bold uppercase tracking-widest">Final Approved Asset</span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleCopy(proposal)} className="h-8 gap-2 text-xs">
                          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied ? "Copied" : "Copy to Clipboard"}
                        </Button>
                      </div>
                      <div className="p-8 text-sm leading-relaxed font-serif whitespace-pre-wrap text-foreground/90">
                        {proposal}
                      </div>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- VIEW 2: HISTORY --- */}
        {activeTab === 'history' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 min-h-[600px]">
            
            {/* LEFT COLUMN: MASTER LIST */}
            <div className="lg:col-span-4 border-r border-border pr-6 space-y-4">
               <h3 className="text-sm font-bold tracking-[0.2em] uppercase text-muted-foreground mb-4">Past Sessions</h3>
               <ScrollArea className="h-[700px]">
                  <div className="space-y-3">
                    {history.map(item => (
                      <div 
                        key={item.id}
                        onClick={() => setSelectedHistoryId(item.id)}
                        className={`group p-4 rounded-xl border transition-all cursor-pointer hover:bg-muted/50
                          ${selectedHistoryId === item.id ? 'bg-muted border-blue-500/50 ring-1 ring-blue-500/50' : 'bg-card border-border'}
                          ${item.status === 'Drafted' ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-red-500'}
                        `}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 uppercase">
                            <Clock className="h-3 w-3" /> {item.timestamp}
                          </span>
                          <Badge className={`${item.status === 'Drafted' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'} border-none text-[10px]`}>
                            {item.status}
                          </Badge>
                        </div>
                        <h4 className="font-bold text-sm truncate group-hover:text-blue-500 transition-colors">{item.title}</h4>
                      </div>
                    ))}
                  </div>
               </ScrollArea>
            </div>

            {/* RIGHT COLUMN: DETAIL VIEW */}
            <div className="lg:col-span-8">
              {selectedHistory ? (
                <div className="space-y-6 animate-in fade-in duration-500">
                  <div className="flex justify-between items-end border-b border-border pb-6">
                    <div>
                      <h2 className="text-2xl font-bold italic">{selectedHistory.title}</h2>
                      <p className="text-sm text-muted-foreground mt-1">Processed on {selectedHistory.timestamp}</p>
                    </div>
                    <Button variant="outline" className="gap-2 text-xs border-border" onClick={() => setActiveTab('dashboard')}>
                      Re-run Evaluation <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>

                  <Tabs defaultValue="output" className="w-full mt-6">
                    <TabsList className="bg-muted border border-border w-full justify-start rounded-none bg-transparent border-t-0 border-x-0 border-b pb-0 h-auto">
                      <TabsTrigger value="output" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent pb-3 px-6 text-xs font-bold uppercase tracking-widest">AI Output</TabsTrigger>
                      <TabsTrigger value="input" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent pb-3 px-6 text-xs font-bold uppercase tracking-widest">Original RFP</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="output" className="py-6 space-y-6">
                      {selectedHistory.is_match ? (
                        <Card className="bg-muted/10 border-border rounded-2xl overflow-hidden shadow-2xl">
                          <div className="bg-muted/50 px-6 py-4 flex justify-between items-center border-b border-border">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Proposal Result</span>
                            <Button size="sm" variant="ghost" onClick={() => handleCopy(selectedHistory.final_draft || '')} className="h-8 gap-2 text-xs">
                               <Copy className="h-3.5 w-3.5" /> Copy Draft
                            </Button>
                          </div>
                          <div className="p-8 text-sm leading-relaxed font-serif whitespace-pre-wrap">
                            {selectedHistory.final_draft}
                          </div>
                        </Card>
                      ) : (
                        <div className="space-y-4">
                           <Alert variant="destructive" className="bg-red-500/5 border-red-500/20 py-8 px-8 rounded-2xl">
                              <XCircle className="h-5 w-5" />
                              <AlertTitle className="text-red-500 font-bold mb-2">Gatekeeper Veto</AlertTitle>
                              <AlertDescription className="text-red-200/80 leading-relaxed italic">
                                "{selectedHistory.reasoning}"
                              </AlertDescription>
                           </Alert>
                           <p className="text-xs text-muted-foreground text-center italic">This RFP was filtered out to protect against low-matching submissions.</p>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="input" className="py-6">
                      <div className="p-8 rounded-2xl bg-muted/20 border border-border text-xs leading-relaxed font-mono whitespace-pre-wrap text-muted-foreground">
                        {selectedHistory.original_text}
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-30 text-center">
                  <History className="h-16 w-16 mb-4" />
                  <p className="text-sm font-bold uppercase tracking-widest">Select a session from the list</p>
                </div>
              )}
            </div>

          </div>
        )}

      </main>
    </div>
  );
}
