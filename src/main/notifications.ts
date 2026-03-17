import { Notification, app, BrowserWindow } from "electron";
import { getSettings } from "./store";

interface NotifyOptions {
  jobId: string;
  projectName: string;
  jobTitle: string;
  subtitle: string;
  body?: string;
  getWindow: () => BrowserWindow | null;
}

function showNotification({ jobId, projectName, jobTitle, subtitle, body, getWindow }: NotifyOptions): void {
  if (getSettings().notificationsEnabled === false) return;

  const notification = new Notification({
    title: projectName,
    subtitle,
    body: body ? `${jobTitle}\n${body}` : jobTitle,
    silent: false,
  });

  notification.on("click", () => {
    const win = getWindow();
    if (win) {
      win.show();
      win.focus();
      win.webContents.send("job:focus", { jobId });
    }
  });

  notification.show();

  if (process.platform === "darwin") {
    app.dock?.bounce("informational");
  } else if (process.platform === "win32") {
    const win = getWindow();
    if (win && !win.isFocused()) {
      win.flashFrame(true);
    }
  }
}

export function notifyInputNeeded(
  jobId: string,
  projectName: string,
  jobTitle: string,
  questionText: string,
  getWindow: () => BrowserWindow | null,
): void {
  showNotification({
    jobId,
    projectName,
    jobTitle,
    subtitle: "Claude needs your input",
    body: questionText.slice(0, 200),
    getWindow,
  });
}

export function notifyJobComplete(
  jobId: string,
  projectName: string,
  jobTitle: string,
  getWindow: () => BrowserWindow | null,
): void {
  showNotification({
    jobId,
    projectName,
    jobTitle,
    subtitle: "Job completed",
    getWindow,
  });
}

export function notifyJobError(
  jobId: string,
  projectName: string,
  jobTitle: string,
  error: string,
  getWindow: () => BrowserWindow | null,
): void {
  showNotification({
    jobId,
    projectName,
    jobTitle,
    subtitle: "Job failed",
    body: error.slice(0, 200),
    getWindow,
  });
}

export function notifyPlanReady(
  jobId: string,
  projectName: string,
  jobTitle: string,
  getWindow: () => BrowserWindow | null,
): void {
  showNotification({
    jobId,
    projectName,
    jobTitle,
    subtitle: "Plan ready for review",
    body: "Approve it to start development or request changes.",
    getWindow,
  });
}
