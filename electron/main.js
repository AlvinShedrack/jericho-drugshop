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
let deferredPrompt = null;
const installAppBtn = document.getElementById('installAppBtn');

// Capture the install event if the browser allows installation
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
});

// Handle the button click
if (installAppBtn) {
  installAppBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      // The prompt is available, so show it
      deferredPrompt.prompt();
      
      // Wait for the user to respond
      const { outcome } = await deferredPrompt.userChoice;
      
      // Clear the prompt variable since it can only be used once
      deferredPrompt = null;
    } else {
      // The prompt is NOT available (app is likely already installed)
      alert("Jericho Drug Shop is already installed on this device, or your browser does not support automatic installation.");
    }
  });
}