import { Notification, app, BrowserWindow } from 'electron';

export function notifyInputNeeded(jobId: string, questionText: string, getWindow: () => BrowserWindow | null): void {
  const notification = new Notification({
    title: 'Claude needs your input',
    body: questionText.slice(0, 200),
    silent: false,
  });

  notification.on('click', () => {
    const win = getWindow();
    if (win) {
      win.show();
      win.focus();
      win.webContents.send('job:focus', { jobId });
    }
  });

  notification.show();

  // Bounce dock icon on macOS
  if (process.platform === 'darwin') {
    app.dock?.bounce('informational');
  }
}

export function notifyPlanReady(jobId: string, getWindow: () => BrowserWindow | null): void {
  const notification = new Notification({
    title: 'Plan ready for review',
    body: 'Claude has finished planning. Review and accept to start development.',
    silent: false,
  });

  notification.on('click', () => {
    const win = getWindow();
    if (win) {
      win.show();
      win.focus();
      win.webContents.send('job:focus', { jobId });
    }
  });

  notification.show();

  if (process.platform === 'darwin') {
    app.dock?.bounce('informational');
  }
}

export function notifyJobComplete(jobId: string, getWindow: () => BrowserWindow | null): void {
  const notification = new Notification({
    title: 'Job completed',
    body: 'Claude has finished the development task.',
    silent: false,
  });

  notification.on('click', () => {
    const win = getWindow();
    if (win) {
      win.show();
      win.focus();
      win.webContents.send('job:focus', { jobId });
    }
  });

  notification.show();
}

export function notifyJobError(jobId: string, error: string, getWindow: () => BrowserWindow | null): void {
  const notification = new Notification({
    title: 'Job failed',
    body: error.slice(0, 200),
    silent: false,
  });

  notification.on('click', () => {
    const win = getWindow();
    if (win) {
      win.show();
      win.focus();
      win.webContents.send('job:focus', { jobId });
    }
  });

  notification.show();
}
