import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  FileText,
  TrendingUp,
  Calendar,
  LogOut,
  Sun,
  Moon,
  RefreshCw,
  CheckCircle,
  XCircle,
  Eye,
  BarChart2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { useTheme } from "@/components/theme-provider";

const API = "https://ox3qtvivf1.execute-api.eu-north-1.amazonaws.com";

// ── Types ────────────────────────────────────────────────────────────────────

interface AdminStats {
  total_evaluations: number;
  unique_users: number;
  total_visits: number;
  drafted: number;
  rejected: number;
  success_rate: number;
  today_evaluations: number;
  daily_breakdown: Record<string, number>;
}

interface LogItem {
  user_id: string;
  timestamp: string;
  filename: string;
  status: "Drafted" | "Rejected";
  is_match: boolean;
  gatekeeper_reasoning?: string;
}

interface Props {
  onLogout: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function authFormData(extra?: Record<string, string>) {
  const fd = new FormData();
  fd.append("token", localStorage.getItem("quill_admin_token") || "");
  if (extra) Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  return fd;
}

function truncateId(id: string) {
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function getLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" }).format(
    new Date(iso)
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  delay?: number;
}

function StatCard({ icon: Icon, label, value, sub, delay = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
    >
      <Card className="ring-1 ring-foreground/10 rounded-xl">
        <CardContent className="px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {label}
              </span>
              <span className="text-2xl font-semibold tracking-tight">{value}</span>
              {sub && (
                <span className="text-[10px] text-muted-foreground">{sub}</span>
              )}
            </div>
            <div className="mt-0.5 rounded-lg bg-muted p-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminDashboard({ onLogout }: Props) {
  const { theme, setTheme } = useTheme();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const adminUsername = localStorage.getItem("quill_admin_username") || "admin";

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const [statsRes, logsRes] = await Promise.all([
          fetch(`${API}/api/admin/stats`, { method: "POST", body: authFormData() }),
          fetch(`${API}/api/admin/logs`, { method: "POST", body: authFormData({ limit: "100" }) }),
        ]);

        if (statsRes.status === 401 || logsRes.status === 401) {
          localStorage.removeItem("quill_admin_token");
          onLogout();
          return;
        }

        if (!statsRes.ok || !logsRes.ok) {
          throw new Error("Failed to fetch admin data");
        }

        const [statsData, logsData] = await Promise.all([
          statsRes.json(),
          logsRes.json(),
        ]);

        setStats(statsData);
        setLogs(logsData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onLogout]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derived user table
  const userMap = logs.reduce<
    Record<string, { count: number; success: number; lastActive: string }>
  >((acc, item) => {
    const uid = item.user_id;
    if (!acc[uid]) acc[uid] = { count: 0, success: 0, lastActive: "" };
    acc[uid].count++;
    if (item.status === "Drafted") acc[uid].success++;
    if (!acc[uid].lastActive || item.timestamp > acc[uid].lastActive)
      acc[uid].lastActive = item.timestamp;
    return acc;
  }, {});

  const users = Object.entries(userMap).sort(([, a], [, b]) => b.count - a.count);

  // 7-day chart
  const last7 = getLast7Days();
  const chartMax = Math.max(...last7.map((d) => stats?.daily_breakdown?.[d] ?? 0), 1);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          className="h-14 w-14"
        >
          <img
            src="/logo_cleaned.png"
            alt="Quill"
            className="h-full w-full object-contain brightness-0 dark:invert"
          />
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(8px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="min-h-screen bg-background"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 md:px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo + title */}
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 shrink-0">
              <img
                src="/logo_cleaned.png"
                alt="Quill"
                className="h-full w-full object-contain brightness-0 dark:invert"
              />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight">Quill</span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground hidden sm:inline">
                Admin Panel
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground hidden md:inline">
              {adminUsername}
            </span>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="rounded-lg"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-lg"
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={onLogout}
              className="rounded-lg gap-1.5 text-xs"
            >
              <LogOut className="h-3 w-3" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 md:px-6 py-6 md:py-8 flex flex-col gap-6 md:gap-8">

        {/* ── Error banner ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Stat cards ───────────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard
            icon={Eye}
            label="Total Visitors"
            value={stats?.total_visits ?? 0}
            sub="Unique page loads"
            delay={0}
          />
          <StatCard
            icon={FileText}
            label="Evaluations"
            value={stats?.total_evaluations ?? 0}
            sub={`${stats?.drafted ?? 0} drafted · ${stats?.rejected ?? 0} rejected`}
            delay={0.07}
          />
          <StatCard
            icon={TrendingUp}
            label="Success Rate"
            value={`${stats?.success_rate ?? 0}%`}
            sub="Proposals drafted"
            delay={0.14}
          />
          <StatCard
            icon={Calendar}
            label="Today"
            value={stats?.today_evaluations ?? 0}
            sub="Evaluations run"
            delay={0.21}
          />
        </section>

        {/* ── Middle row: logs + chart ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">

          {/* Recent evaluations */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.28 }}
            className="lg:col-span-2"
          >
            <Card className="ring-1 ring-foreground/10 rounded-2xl">
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Recent Evaluations
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-4">
                {logs.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-5 py-6 text-center">
                    No evaluations yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left px-5 py-2 font-semibold uppercase tracking-widest text-[10px] text-muted-foreground">
                            File
                          </th>
                          <th className="text-left px-3 py-2 font-semibold uppercase tracking-widest text-[10px] text-muted-foreground hidden sm:table-cell">
                            User
                          </th>
                          <th className="text-left px-3 py-2 font-semibold uppercase tracking-widest text-[10px] text-muted-foreground">
                            Status
                          </th>
                          <th className="text-left px-3 py-2 font-semibold uppercase tracking-widest text-[10px] text-muted-foreground hidden md:table-cell">
                            Date
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.slice(0, 30).map((item, i) => (
                          <motion.tr
                            key={`${item.user_id}-${item.timestamp}`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: i * 0.02 }}
                            className="border-b border-border/50 hover:bg-muted/40 transition-colors"
                          >
                            <td className="px-5 py-2.5 max-w-[160px] truncate font-medium">
                              {item.filename || "—"}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-muted-foreground hidden sm:table-cell">
                              {truncateId(item.user_id)}
                            </td>
                            <td className="px-3 py-2.5">
                              {item.status === "Drafted" ? (
                                <Badge
                                  variant="secondary"
                                  className="gap-1 text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0"
                                >
                                  <CheckCircle className="h-2.5 w-2.5" />
                                  Drafted
                                </Badge>
                              ) : (
                                <Badge
                                  variant="destructive"
                                  className="gap-1 text-[10px] bg-destructive/10 text-destructive border-0"
                                >
                                  <XCircle className="h-2.5 w-2.5" />
                                  Rejected
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden md:table-cell">
                              {formatDate(item.timestamp)}
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                    {logs.length > 30 && (
                      <p className="text-[10px] text-muted-foreground text-center pt-3">
                        Showing 30 of {logs.length} evaluations
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* 7-day activity chart */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.35 }}
          >
            <Card className="ring-1 ring-foreground/10 rounded-2xl h-full">
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-muted-foreground" />
                  Last 7 Days
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="flex flex-col gap-3">
                  {last7.map((date, i) => {
                    const count = stats?.daily_breakdown?.[date] ?? 0;
                    const pct = Math.round((count / chartMax) * 100);
                    return (
                      <motion.div
                        key={date}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.4 + i * 0.05 }}
                        className="flex items-center gap-3"
                      >
                        <span className="text-[10px] text-muted-foreground w-16 shrink-0">
                          {dayLabel(date)}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, delay: 0.5 + i * 0.05, ease: "easeOut" }}
                            className="h-full rounded-full bg-foreground/70"
                          />
                        </div>
                        <span className="text-[10px] font-medium w-5 text-right shrink-0">
                          {count}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* ── Users table ──────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.42 }}
        >
          <Card className="ring-1 ring-foreground/10 rounded-2xl">
            <CardHeader className="px-5 pt-5 pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Users&nbsp;
                <Badge variant="secondary" className="text-[10px]">
                  {users.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-4">
              {users.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-6 text-center">
                  No users yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-5 py-2 font-semibold uppercase tracking-widest text-[10px] text-muted-foreground">
                          User ID
                        </th>
                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-widest text-[10px] text-muted-foreground">
                          Evals
                        </th>
                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-widest text-[10px] text-muted-foreground hidden sm:table-cell">
                          Drafted
                        </th>
                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-widest text-[10px] text-muted-foreground hidden md:table-cell">
                          Success
                        </th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-widest text-[10px] text-muted-foreground hidden lg:table-cell">
                          Last Active
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(([uid, data], i) => {
                        const successPct =
                          data.count > 0
                            ? Math.round((data.success / data.count) * 100)
                            : 0;
                        return (
                          <motion.tr
                            key={uid}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: i * 0.02 }}
                            className="border-b border-border/50 hover:bg-muted/40 transition-colors"
                          >
                            <td className="px-5 py-2.5 font-mono text-muted-foreground">
                              {truncateId(uid)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium">
                              {data.count}
                            </td>
                            <td className="px-3 py-2.5 text-right text-emerald-600 dark:text-emerald-400 hidden sm:table-cell">
                              {data.success}
                            </td>
                            <td className="px-3 py-2.5 text-right hidden md:table-cell">
                              <span
                                className={
                                  successPct >= 60
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : successPct >= 30
                                    ? "text-muted-foreground"
                                    : "text-destructive"
                                }
                              >
                                {successPct}%
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                              {formatDate(data.lastActive)}
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </motion.div>
  );
}
