/** Runs the Python pipeline (scripts/refresh.py) as a single-flight background job and streams its progress. */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { ROOT, UV } from "./config.js";

export type JobState = {
  id: string; mode: "full" | "prices"; status: "running" | "done" | "error";
  step: number; steps: number; label: string; log: string[];
  started: number; finished: number | null;
};

const STEP_RE = /^STEP (\d+)\/(\d+) (.*)$/;
let current: JobState | null = null;
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export const currentJob = () => current;

export function startRefresh(mode: "full" | "prices"): { job: JobState; started: boolean } {
  if (current?.status === "running") return { job: current, started: false };
  const job: JobState = {
    id: Date.now().toString(36), mode, status: "running", step: 0, steps: 0,
    label: "Starting…", log: [], started: Date.now(), finished: null,
  };
  current = job;
  const args = ["run", "--quiet", "python", join(ROOT, "scripts", "refresh.py"), ...(mode === "prices" ? ["--prices-only"] : [])];
  const child = spawn(UV, args, { cwd: ROOT, env: process.env });
  let buf = "";
  const onData = (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const m = line.match(STEP_RE);
      if (m) Object.assign(job, { step: +m[1], steps: +m[2], label: m[3] });
      job.log = [...job.log, line].slice(-40);
      bus.emit("job", job);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => {
    job.status = code === 0 ? "done" : "error";
    job.finished = Date.now();
    bus.emit("job", job);
  });
  child.on("error", (e) => {
    job.status = "error";
    job.log.push(`ERROR: ${e.message}`);
    job.finished = Date.now();
    bus.emit("job", job);
  });
  return { job, started: true };
}
