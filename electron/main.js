const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    title: "My Rx Pharmacy Software",
    backgroundColor: "#f8fafc",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../index.html"));
}

ipcMain.handle("save-pdf", async (event, filename) => {
  if (!mainWindow) return { canceled: true };

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Save PDF",
    defaultPath: filename,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });

  if (canceled || !filePath) return { canceled: true };

  const pdfBuffer = await mainWindow.webContents.printToPDF({
    marginsType: 1,
    printBackground: true,
    pageSize: "A4"
  });

  await fs.promises.writeFile(filePath, pdfBuffer);
  return { canceled: false, filePath };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
let deferredPrompt;
const installAppBtn = document.getElementById('installAppBtn');

// Listen for the event that allows installation
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  // Remove the hidden class to show the install button
  if (installAppBtn) {
    installAppBtn.classList.remove('hidden');
  }
});

// Handle the install button click
if (installAppBtn) {
  installAppBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      // Show the install prompt
      deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      // We've used the prompt, and can't use it again, throw it away
      deferredPrompt = null;
      // Hide the button again
      installAppBtn.classList.add('hidden');
    }
  });
}

// Optional: Hide the button if the user successfully installs it
window.addEventListener('appinstalled', () => {
  // Clear the deferredPrompt so it can be garbage collected
  deferredPrompt = null;
  // Hide the install button
  if (installAppBtn) {
    installAppBtn.classList.add('hidden');
  }
  console.log('PWA was installed');
});