import React, { useState, useRef } from 'react';
import {
  UploadCloud, FileText, Search, ShieldAlert, PenTool,
  CheckCircle, XCircle, Copy, Loader2, Check, History, LayoutDashboard, Clock, ExternalLink,
  Sun, Moon, ChevronDown, ChevronUp, ArrowLeft, Files
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@workspace/ui/components/sheet";

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

interface BatchJob {
  id: string;
  filename: string;
  /** idle = queued, processing = running, success = drafted, rejected = gatekeeper veto */
  status: 'idle' | 'processing' | 'success' | 'rejected';
  is_match: boolean;
  is_valid_rfp: boolean;
  document_type: string;
  reasoning: string;
  final_draft: string | null;
  // For single-file streaming — stepper state
  activeStepIndex: number;
  gatekeeperReason: string;
  proposal: string;
}

const STEPS = [
  { id: 'extractor', label: 'Extractor', icon: FileText },
  { id: 'researcher', label: 'Researcher', icon: Search },
  { id: 'gatekeeper', label: 'Gatekeeper', icon: ShieldAlert },
  { id: 'drafter', label: 'Drafter', icon: PenTool },
  { id: 'reviewer', label: 'Reviewer', icon: CheckCircle },
];

// ─── helpers ────────────────────────────────────────────────────────────────
function makeBatchJob(file: File): BatchJob {
  return {
    id: Math.random().toString(36).substr(2, 9),
    filename: file.name,
    status: 'idle',
    is_match: false,
    is_valid_rfp: false,
    document_type: '',
    reasoning: '',
    final_draft: null,
    activeStepIndex: -1,
    gatekeeperReason: '',
    proposal: '',
  };
}

export default function Dashboard() {
  // --- GLOBAL STATE ---
  const [activeTab, setActiveTab] = useState('dashboard');
  const { theme, setTheme } = useTheme();

  // History
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);

  // --- FILE + BATCH STATE ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // batchMode = true when 2+ files are selected/running
  const [batchMode, setBatchMode] = useState(false);
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  // Which job is being drilled-down into (batch)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  // Overall batch running state
  const [batchRunning, setBatchRunning] = useState(false);

  // --- SAAS ONBOARDING STATE ---
  const [userId] = useState(() => localStorage.getItem('quill_user_id') ?? crypto.randomUUID());

  // Persist user_id
  React.useEffect(() => {
    if (!localStorage.getItem('quill_user_id')) {
      localStorage.setItem('quill_user_id', userId);
    }
  }, [userId]);

  // Fetch history from DynamoDB when history tab opens
  React.useEffect(() => {
    if (activeTab !== 'history') return;
    setHistoryLoading(true);
    fetch(`https://ox3qtvivf1.execute-api.eu-north-1.amazonaws.com/api/history/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const mapped: HistoryItem[] = data.map((item: any) => ({
            id: item.timestamp,
            timestamp: new Date(item.timestamp).toLocaleString(),
            title: item.filename,
            original_text: '',
            status: item.status as 'Drafted' | 'Rejected',
            is_match: item.is_match,
            reasoning: item.gatekeeper_reasoning,
            final_draft: item.final_draft || null,
          }));
          setHistory(mapped);
        }
      })
      .catch(err => console.error('History fetch error:', err))
      .finally(() => setHistoryLoading(false));
  }, [activeTab, userId]);

  const [hasActiveCV, setHasActiveCV] = useState(false);
  const [activeCVName, setActiveCVName] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cvUploading, setCvUploading] = useState(false);
  const [cvUploadSuccess, setCvUploadSuccess] = useState<string | null>(null);
  const [cvUploadError, setCvUploadError] = useState<string | null>(null);
  const cvInputRef = useRef<HTMLInputElement>(null);
  const [cvDragging, setCvDragging] = useState(false);
  const [rfpDragging, setRfpDragging] = useState(false);

  // --- SINGLE FILE STATE (for backwards-compat with stepper) ---
  const [singleJob, setSingleJob] = useState<BatchJob | null>(null);

  // --- HANDLERS ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
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

  const processCVFile = async (file: File) => {
    setCvUploading(true);
    setCvUploadSuccess(null);
    setCvUploadError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', userId);

    try {
      const res = await fetch('https://ox3qtvivf1.execute-api.eu-north-1.amazonaws.com/api/upload-cv', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (res.ok && data.status === 'success') {
        setHasActiveCV(true);
        setActiveCVName(file.name);
        setCvUploadSuccess(`Success! Your profile has been analyzed and your AI is ready to work.`);
        setTimeout(() => setSheetOpen(false), 2000);
      } else {
        setCvUploadError(data.message || data.error || "CV Upload Failed");
      }
    } catch (err) {
      setCvUploadError("Failed to connect to server during CV upload.");
    } finally {
      setCvUploading(false);
      if (cvInputRef.current) cvInputRef.current.value = '';
    }
  };

  const handleCVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processCVFile(file);
  };

  const handleCvDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!cvUploading) setCvDragging(true);
  };

  const handleCvDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setCvDragging(false);
  };

  const handleCvDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setCvDragging(false);
    if (cvUploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processCVFile(file);
    }
  };

  const handleRfpDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (hasActiveCV) setRfpDragging(true);
  };

  const handleRfpDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setRfpDragging(false);
  };

  const handleRfpDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setRfpDragging(false);
    if (!hasActiveCV) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  // ─── SINGLE FILE (streaming) ─────────────────────────────────────────────
  const runSingleEvaluation = async (file: File) => {
    const job = makeBatchJob(file);
    job.status = 'processing';
    job.activeStepIndex = 0;
    setSingleJob({ ...job });

    let finalIsMatch = false;
    let finalDraft = '';
    let finalReasoning = '';
    let extractedRfpText = '';

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('user_id', userId);

      const response = await fetch('https://ox3qtvivf1.execute-api.eu-north-1.amazonaws.com/api/evaluate-rfp', {
        method: 'POST',
        body: formData,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);

            if (data.event === 'init') {
              extractedRfpText = data.rfp_text;
            }
            else if (data.event === 'node_update') {
              const { node, updates } = data;

              if (node === 'extractor') {
                if (updates.is_valid_rfp === false) {
                  const docType = updates.document_type || 'Unknown Document';
                  const reason = `Document Error: This appears to be a '${docType}', not a valid Job RFP or Freelance Gig description. Please upload a proper RFP or job posting for evaluation.`;
                  finalIsMatch = false;
                  finalReasoning = reason;
                  setSingleJob(prev => prev ? { ...prev, status: 'rejected', activeStepIndex: 0, gatekeeperReason: reason } : prev);
                } else {
                  setSingleJob(prev => prev ? { ...prev, activeStepIndex: 1 } : prev);
                }
              } else {
                if (nodeToStepMap[node] !== undefined) {
                  setSingleJob(prev => prev ? { ...prev, activeStepIndex: nodeToStepMap[node] } : prev);
                }

                if (node === 'evaluator') {
                  if (updates.is_match === false) {
                    finalIsMatch = false;
                    finalReasoning = updates.evaluator_reasoning;
                    setSingleJob(prev => prev ? { ...prev, status: 'rejected', gatekeeperReason: updates.evaluator_reasoning } : prev);
                  } else {
                    finalIsMatch = true;
                    finalReasoning = updates.evaluator_reasoning;
                  }
                }

                if (node === 'drafter') {
                  setSingleJob(prev => prev ? { ...prev, proposal: updates.current_draft } : prev);
                  finalDraft = updates.current_draft;
                }

                if (node === 'reviewer' && updates.review_feedback === 'PASS') {
                  setSingleJob(prev => prev ? { ...prev, status: 'success' } : prev);
                }
              }
            }
            else if (data.event === 'done') {
              addToHistory({
                title: file.name,
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
      setSingleJob(prev => prev ? {
        ...prev, status: 'rejected',
        gatekeeperReason: "Connection Failed or streaming interrupted."
      } : prev);
    }
  };

  // ─── BATCH JOB STATE UPDATE HELPER ─────────────────────────────────────
  const updateBatchJob = (id: string, updater: (j: BatchJob) => BatchJob) => {
    setBatchJobs(prev => prev.map(j => j.id === id ? updater(j) : j));
  };

  // ─── STREAM ONE JOB (used inside batch mode per-file) ───────────────────
  const streamSingleBatchJob = async (file: File, jobId: string) => {
    const nodeToStepMap: Record<string, number> = {
      'extractor': 1, 'researcher': 2, 'evaluator': 3, 'drafter': 4, 'reviewer': 5
    };

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('user_id', userId);

      const response = await fetch('https://ox3qtvivf1.execute-api.eu-north-1.amazonaws.com/api/evaluate-rfp', {
        method: 'POST',
        body: formData,
      });
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let extractedRfpText = '';
      let finalIsMatch = false;
      let finalDraft = '';
      let finalReasoning = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);

            if (data.event === 'init') {
              extractedRfpText = data.rfp_text;
            } else if (data.event === 'node_update') {
              const { node, updates } = data;

              if (node === 'extractor') {
                if (updates.is_valid_rfp === false) {
                  const docType = updates.document_type || 'Unknown Document';
                  const reason = `Document Error: This appears to be a '${docType}', not a valid Job RFP or Freelance Gig description.`;
                  finalIsMatch = false;
                  finalReasoning = reason;
                  updateBatchJob(jobId, j => ({ ...j, status: 'rejected', activeStepIndex: 0, gatekeeperReason: reason, reasoning: reason }));
                } else {
                  updateBatchJob(jobId, j => ({ ...j, activeStepIndex: 1 }));
                }
              } else {
                if (nodeToStepMap[node] !== undefined) {
                  updateBatchJob(jobId, j => ({ ...j, activeStepIndex: nodeToStepMap[node] }));
                }
                if (node === 'evaluator') {
                  if (updates.is_match === false) {
                    finalIsMatch = false;
                    finalReasoning = updates.evaluator_reasoning;
                    updateBatchJob(jobId, j => ({ ...j, status: 'rejected', gatekeeperReason: updates.evaluator_reasoning, reasoning: updates.evaluator_reasoning }));
                  } else {
                    finalIsMatch = true;
                    finalReasoning = updates.evaluator_reasoning;
                  }
                }
                if (node === 'drafter') {
                  finalDraft = updates.current_draft;
                  updateBatchJob(jobId, j => ({ ...j, proposal: updates.current_draft }));
                }
                if (node === 'reviewer' && updates.review_feedback === 'PASS') {
                  updateBatchJob(jobId, j => ({ ...j, status: 'success' }));
                }
              }
            } else if (data.event === 'done') {
              updateBatchJob(jobId, j => ({ ...j, final_draft: finalDraft || null, is_match: finalIsMatch }));
              addToHistory({
                title: file.name,
                original_text: extractedRfpText,
                status: finalIsMatch && finalDraft ? 'Drafted' : 'Rejected',
                is_match: finalIsMatch,
                reasoning: finalReasoning,
                final_draft: finalDraft || null,
              });
            }
          } catch (e) {
            console.error('Batch stream parse error:', e);
          }
        }
      }
    } catch (err) {
      console.error(`Batch error for ${file.name}:`, err);
      updateBatchJob(jobId, j => ({
        ...j, status: 'rejected',
        gatekeeperReason: 'Connection failed or streaming interrupted.',
        reasoning: 'Connection failed or streaming interrupted.',
      }));
    }
  };

  // ─── BATCH (parallel streaming, staggered to avoid rate limits) ─────────
  const runBatchEvaluation = async (files: File[]) => {
    // Build initial job cards — all 'processing' from the start
    const jobs: BatchJob[] = files.map(f => ({ ...makeBatchJob(f), status: 'processing', activeStepIndex: 0 }));
    setBatchJobs(jobs);
    setBatchRunning(true);

    // Fire N parallel streams, staggered 400ms apart to avoid burst rate-limit errors
    await Promise.all(
      files.map((file, idx) => {
        const jobId = jobs[idx].id;
        return new Promise<void>(resolve =>
          setTimeout(() => streamSingleBatchJob(file, jobId).then(resolve), idx * 400)
        );
      })
    );

    setBatchRunning(false);
  };

  // ─── MAIN ENTRY ─────────────────────────────────────────────────────────
  const runEvaluation = () => {
    if (selectedFiles.length === 0 || !hasActiveCV) return;

    if (selectedFiles.length === 1) {
      setBatchMode(false);
      setSingleJob(null);
      runSingleEvaluation(selectedFiles[0]);
    } else {
      setBatchMode(true);
      setSelectedJobId(null);
      runBatchEvaluation(selectedFiles);
    }
  };

  const resetToIdle = () => {
    setSingleJob(null);
    setBatchMode(false);
    setBatchJobs([]);
    setSelectedJobId(null);
    setSelectedFiles([]);
  };

  // ─── DERIVED ────────────────────────────────────────────────────────────
  const selectedHistory = history.find(h => h.id === selectedHistoryId);
  const selectedBatchJob = batchJobs.find(j => j.id === selectedJobId);
  const singleStatus = singleJob?.status ?? 'idle';
  const isIdle = !batchMode && singleStatus === 'idle';

  // ─── BADGE HELPERS ──────────────────────────────────────────────────────
  const statusBadge = (status: BatchJob['status']) => {
    if (status === 'processing') return <Badge variant="outline" className="text-[9px] border-primary/50 text-primary animate-pulse gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" />Processing</Badge>;
    if (status === 'success') return <Badge variant="outline" className="text-[9px] border-emerald-500/50 text-emerald-500">✅ Drafted</Badge>;
    if (status === 'rejected') return <Badge variant="outline" className="text-[9px] border-destructive/50 text-destructive">❌ Rejected</Badge>;
    return <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">Queued</Badge>;
  };

  // ─── STEPPER (shared between single and drill-down) ──────────────────────
  const renderStepper = (job: BatchJob) => (
    <div className="relative border-l border-border ml-4 md:ml-6 space-y-8 md:space-y-10 py-2">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        const isPast = job.activeStepIndex > index || job.status === 'success' || (job.status === 'rejected' && job.activeStepIndex > index);
        const isCurrent = job.activeStepIndex === index && job.status === 'processing';
        const isFailed = job.status === 'rejected' && job.activeStepIndex === index;

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
  );

  // ─── DETAIL PANEL (shared between single and drill-down) ─────────────────
  const renderDetailPanel = (job: BatchJob) => (
    <div className={`transition-all duration-700 ease-in-out flex flex-col gap-6 md:gap-8 flex-1 w-full lg:w-auto max-h-[5000px] lg:max-h-none opacity-100 lg:ml-8 pb-10`}>
      <div className="flex items-center justify-between px-2 cursor-pointer lg:cursor-default" onClick={() => window.innerWidth < 1024 && setIsLogsExpanded(!isLogsExpanded)}>
        <div className="flex items-center gap-3">
          <h2 className="text-[10px] md:text-sm font-bold tracking-[0.2em] uppercase text-muted-foreground">Internal Agent Logs</h2>
          <div className="lg:hidden text-muted-foreground">
            {isLogsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
        <div className="flex gap-2">
          {job.status === 'processing' && <Badge variant="outline" className="text-[9px] md:text-[10px] border-primary/50 text-primary animate-pulse">Running</Badge>}
          {job.status === 'success' && <Badge variant="outline" className="text-[9px] md:text-[10px] border-emerald-500/50 text-emerald-500">Success</Badge>}
          {job.status === 'rejected' && <Badge variant="outline" className="text-[9px] md:text-[10px] border-destructive/50 text-destructive">Halted</Badge>}
        </div>
      </div>

      <div className={`space-y-8 md:space-y-12 animate-in fade-in slide-in-from-right-5 duration-500 transition-all ${!isLogsExpanded && 'hidden lg:block'}`}>
        {renderStepper(job)}

        {job.status === 'rejected' && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 py-4 md:py-8 px-4 md:px-8 rounded-xl md:rounded-2xl animate-in zoom-in-95">
            <XCircle className="h-4 w-4 md:h-5 md:w-5" />
            <AlertTitle className="text-xs md:text-sm font-bold mb-2 uppercase tracking-widest">Gatekeeper Veto</AlertTitle>
            <AlertDescription className="text-[11px] md:text-sm italic opacity-90 leading-relaxed">
              "{job.gatekeeperReason}"
            </AlertDescription>
          </Alert>
        )}

        {job.status === 'success' && (
          <Card className="bg-card border-border rounded-xl md:rounded-2xl overflow-hidden shadow-sm animate-in zoom-in-95 duration-500">
            <div className="bg-muted/50 px-4 md:px-6 py-3 md:py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-border">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Generated Response</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleCopy(job.proposal)} className="h-8 gap-2 text-xs w-full md:w-auto justify-start md:justify-center">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy Draft"}
              </Button>
            </div>
            <div className="p-4 md:p-8 text-[11px] md:text-sm leading-relaxed whitespace-pre-wrap text-card-foreground">
              {job.proposal}
            </div>
          </Card>
        )}
      </div>
    </div>
  );

  // ─── UPLOAD SIDEBAR ──────────────────────────────────────────────────────
  const renderUploadCard = (compact = false) => (
    <div className={`transition-all duration-700 ease-in-out flex-shrink-0 space-y-6 z-10 w-full mb-8 lg:mb-0 ${compact ? 'max-w-full lg:max-w-sm' : 'max-w-md mx-auto lg:mx-0'}`}>
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg md:text-xl">Upload RFP</CardTitle>
          <CardDescription className="text-xs md:text-sm text-muted-foreground pt-1">
            Provide one or more PDF job descriptions to begin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div
            onClick={() => hasActiveCV && triggerUpload()}
            onDragOver={handleRfpDragOver}
            onDragLeave={handleRfpDragLeave}
            onDrop={handleRfpDrop}
            className={`group border-2 border-dashed rounded-xl md:rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center gap-4 transition-all relative ${!hasActiveCV
                ? 'border-border/50 bg-muted/20 opacity-50 cursor-not-allowed pointer-events-none'
                : rfpDragging
                  ? 'border-primary bg-primary/10 cursor-copy scale-[1.02]'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50 cursor-pointer'
              }`}
          >
            {selectedFiles.length > 1
              ? <Files className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground group-hover:text-primary transition-colors" />
              : <UploadCloud className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground group-hover:text-primary transition-colors" />
            }
            <div className="text-center">
              <p className="text-xs md:text-sm font-bold text-foreground">
                {selectedFiles.length === 0
                  ? "Drag & Drop or Choose PDF File(s)"
                  : selectedFiles.length === 1
                    ? selectedFiles[0].name
                    : `${selectedFiles.length} files selected`}
              </p>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">Maximum size: 50MB each</p>
            </div>
            <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileChange} accept=".pdf,.txt" multiple disabled={!hasActiveCV} />

            {!hasActiveCV && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-[2px] rounded-xl pointer-events-auto">
                <Button
                  onClick={(e) => { e.stopPropagation(); setSheetOpen(true); }}
                  variant="default"
                  className="shadow-xl"
                >
                  Upload CV to Unlock
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 pt-2">
            <Button
              onClick={runEvaluation}
              disabled={selectedFiles.length === 0 || batchRunning || (!batchMode && singleStatus === 'processing') || !hasActiveCV}
              className="bg-primary text-primary-foreground font-bold h-10 md:h-12 shadow-sm text-sm"
            >
              {(batchRunning || (!batchMode && singleStatus === 'processing'))
                ? <><Loader2 className="animate-spin h-5 w-5 mr-2" />Analyzing...</>
                : selectedFiles.length > 1 ? `Analyze ${selectedFiles.length} RFPs` : "Analyze RFP"}
            </Button>
            {(batchMode || singleStatus !== 'idle') && (
              <Button variant="ghost" size="sm" onClick={resetToIdle} className="text-muted-foreground text-xs h-8">
                ↩ Start over
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">

      {/* --- TOP NAVIGATION --- */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-6">
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
              {/* --- TOP NAV HUD --- */}
              <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <SheetTrigger asChild>
                  <div className="cursor-pointer transition-transform hover:scale-105">
                    {hasActiveCV ? (
                      <Badge variant="outline" className="hidden sm:inline-flex text-[10px] md:text-xs border-emerald-500/50 bg-emerald-500/10 text-emerald-500 font-bold px-3 py-1 gap-2 shadow-sm">
                        <CheckCircle className="h-3 w-3" /> Active: {activeCVName}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="hidden sm:inline-flex text-[10px] md:text-xs border-destructive/50 bg-destructive/10 text-destructive font-bold px-3 py-1 gap-2 shadow-sm animate-pulse">
                        <ShieldAlert className="h-3 w-3" /> Profile Incomplete
                      </Badge>
                    )}
                  </div>
                </SheetTrigger>
                <SheetContent side="right" className="w-[400px] sm:w-[540px] border-l border-border bg-background p-0 flex flex-col">
                  <SheetHeader className="p-6 border-b border-border bg-muted/30">
                    <SheetTitle>Manage AI Knowledge Base</SheetTitle>
                    <SheetDescription>
                      Upload your standard CV or Resume. Our AI will securely analyze your experience, skills, and background to automatically match you with the best jobs.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="p-6 flex-1 overflow-y-auto">

                    {hasActiveCV && !cvUploading && (
                      <Alert className="mb-6 bg-emerald-500/5 border-emerald-500/30">
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                        <span className="text-emerald-500 font-bold text-sm ml-2 tracking-wide uppercase">Profile Active</span>
                        <AlertDescription className="mt-2 text-xs text-emerald-500/80">
                          {activeCVName} is active and acting as your AI's brain. Uploading a new document will replace your current profile.
                        </AlertDescription>
                      </Alert>
                    )}

                    <div
                      onClick={() => !cvUploading && cvInputRef.current?.click()}
                      onDragOver={handleCvDragOver}
                      onDragLeave={handleCvDragLeave}
                      onDrop={handleCvDrop}
                      className={`group border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center gap-4 transition-all relative
                        ${cvUploading ? 'border-primary/50 bg-muted/20 cursor-wait' : ''}
                        ${!cvUploading && cvDragging ? 'border-primary bg-primary/10 cursor-copy scale-[1.02]' : ''}
                        ${!cvUploading && !cvDragging && cvUploadError ? 'border-destructive/50 bg-destructive/5 animate-pulse' : ''}
                        ${!cvUploading && !cvDragging && !cvUploadError ? 'border-border hover:border-primary/50 hover:bg-muted/50 cursor-pointer' : ''}
                      `}
                    >
                      {cvUploading ? (
                        <Loader2 className="h-12 w-12 text-primary animate-spin" />
                      ) : cvUploadError ? (
                        <ShieldAlert className="h-12 w-12 text-destructive" />
                      ) : (
                        <FileText className="h-12 w-12 text-muted-foreground group-hover:text-primary transition-colors" />
                      )}
                      <div className="text-center">
                        <p className={`text-sm font-bold ${cvUploadError ? 'text-destructive' : 'text-foreground'}`}>
                          {cvUploading ? "Securely analyzing your experience..." : cvUploadError ? "Click to try a different file" : "Will replace your existing profile"}
                        </p>
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        ref={cvInputRef}
                        onChange={handleCVUpload}
                        accept=".pdf"
                        disabled={cvUploading}
                      />
                    </div>

                    {cvUploadSuccess && (
                      <div className="mt-4 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-500 text-center animate-in zoom-in-95">
                        {cvUploadSuccess}
                      </div>
                    )}

                    {cvUploadError && (
                      <div className="mt-4 p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-[11px] font-medium text-destructive text-center animate-in zoom-in-95 leading-relaxed">
                        <ShieldAlert className="h-4 w-4 inline mr-2 mb-0.5" />
                        {cvUploadError}
                      </div>
                    )}

                  </div>
                </SheetContent>
              </Sheet>

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

      <main className="container mx-auto xl:max-w-[1400px] px-5 sm:px-6 py-10">

        {/* ══════════════════════════════════════════════════════════════════
            VIEW: DASHBOARD
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'dashboard' && (
          <>
            {/* ── IDLE / SINGLE-FILE MODE ─────────────────────────────── */}
            {!batchMode && (
              <div className={`flex flex-col lg:flex-row w-full transition-all duration-700 ${isIdle ? 'lg:items-center min-h-[60vh]' : 'items-start'}`}>

                {/* SMOOTH CENTERING SPACER (Desktop only) */}
                <div
                  className="transition-[width] duration-700 ease-in-out flex-shrink-0 hidden lg:block"
                  style={{ width: isIdle ? 'calc(50% - 224px)' : '0px' }}
                />

                {renderUploadCard(!isIdle)}

                {/* MAIN STAGE */}
                <div className={`transition-all duration-700 ease-in-out flex flex-col gap-6 md:gap-8 flex-1
                  ${isIdle
                    ? 'max-h-0 lg:max-h-none lg:max-w-0 opacity-0 ml-0 pointer-events-none'
                    : 'max-h-[5000px] lg:max-h-none lg:max-w-4xl xl:max-w-5xl opacity-100 lg:ml-10 pb-10'
                  }
                `}>
                  {singleJob && renderDetailPanel(singleJob)}
                </div>
              </div>
            )}

            {/* ── BATCH MODE ──────────────────────────────────────────── */}
            {batchMode && (
              <div className="space-y-8">

                {/* ── VIEW B: DRILL-DOWN ── */}
                {selectedJobId && selectedBatchJob && (
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mb-6 gap-2 text-muted-foreground hover:text-foreground -ml-2"
                      onClick={() => setSelectedJobId(null)}
                    >
                      <ArrowLeft className="h-4 w-4" /> Back to Batch Overview
                    </Button>

                    <p className="text-xs text-muted-foreground font-mono mb-6 truncate">{selectedBatchJob.filename}</p>

                    <div className="flex flex-col lg:flex-row gap-8 items-start">
                      {renderUploadCard(true)}
                      {renderDetailPanel(selectedBatchJob)}
                    </div>
                  </div>
                )}

                {/* ── VIEW A: BATCH OVERVIEW GRID ── */}
                {!selectedJobId && (
                  <div className="space-y-8">
                    {/* UPLOAD CARD + SUMMARY ROW */}
                    <div className="flex flex-col lg:flex-row gap-8 items-start">
                      {renderUploadCard(true)}

                      {/* Batch summary panel */}
                      <div className="flex-1 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h2 className="text-sm font-bold tracking-[0.15em] uppercase text-muted-foreground">Batch Overview</h2>
                            <p className="text-xs text-muted-foreground mt-1">
                              {batchRunning
                                ? `Processing ${batchJobs.length} document${batchJobs.length > 1 ? 's' : ''}...`
                                : `${batchJobs.filter(j => j.status === 'success').length} drafted · ${batchJobs.filter(j => j.status === 'rejected').length} rejected`}
                            </p>
                          </div>
                          {batchRunning && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                        </div>

                        {/* BATCH PROGRESS BAR */}
                        {batchRunning && (
                          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-500 animate-pulse"
                              style={{ width: `${(batchJobs.filter(j => j.status !== 'processing' && j.status !== 'idle').length / batchJobs.length) * 100}%` }}
                            />
                          </div>
                        )}

                        {/* JOB CARDS GRID */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {batchJobs.map(job => (
                            <div
                              key={job.id}
                              onClick={() => setSelectedJobId(job.id)}
                              className={`group p-4 rounded-xl border transition-all duration-300 cursor-pointer hover:border-primary/50 hover:bg-muted/30
                                ${job.status === 'success' ? 'border-l-4 border-l-emerald-500 border-border' : ''}
                                ${job.status === 'rejected' ? 'border-l-4 border-l-destructive border-border' : ''}
                                ${job.status === 'processing' || job.status === 'idle' ? 'border-border' : ''}
                              `}
                            >
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div className={`p-2 rounded-lg bg-muted/50 flex-shrink-0 ${job.status === 'processing' ? 'animate-pulse' : ''}`}>
                                  {job.status === 'processing'
                                    ? <Loader2 className="h-4 w-4 text-primary animate-spin" />
                                    : job.status === 'success'
                                      ? <CheckCircle className="h-4 w-4 text-emerald-500" />
                                      : <XCircle className="h-4 w-4 text-destructive" />
                                  }
                                </div>
                                {statusBadge(job.status)}
                              </div>
                              <p className="text-xs font-bold truncate text-foreground">{job.filename}</p>
                              {job.status !== 'processing' && job.status !== 'idle' && (
                                <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed line-clamp-2 italic">
                                  {job.reasoning || 'No reasoning provided.'}
                                </p>
                              )}
                              {(job.status === 'success' || job.status === 'rejected') && (
                                <p className="text-[9px] text-primary/70 mt-2 font-medium">Click to view details →</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            VIEW: HISTORY
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'history' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 min-h-[600px]">

            {/* LIST */}
            <div className="lg:col-span-4 lg:border-r border-border lg:pr-6 space-y-4">
              <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-muted-foreground px-2">Session Log</h3>
              <ScrollArea className="h-[700px] w-full">
                <div className="space-y-3 px-0 sm:px-2">
                  {historyLoading && (
                    <div className="flex items-center justify-center py-20 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading history...
                    </div>
                  )}
                  {!historyLoading && history.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground opacity-40">
                      <History className="h-10 w-10 mb-3" />
                      <p className="text-xs uppercase tracking-widest font-bold">No evaluations yet</p>
                      <p className="text-[10px] mt-1">Run an RFP evaluation to see history here.</p>
                    </div>
                  )}
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
                        {selectedHistory.original_text || 'Source text not captured for this entry.'}
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